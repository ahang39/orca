import { randomUUID } from 'node:crypto'
import type { AgentJournalMessageItem } from '../../shared/agent-session/journal/agent-session-journal-types'
import type { JournalConnectorReplyRow } from '../../shared/agent-session/journal/journal-connector-reply'
import { connectorReplyTurnOutcome } from '../../shared/agent-session/journal/journal-connector-reply-turn'
import { structuredAgentSessionMessageSendMutation } from '../../shared/agent-session/requests/structured-agent-session-send-mutation'
import { BOT_QUIET_MARKER } from '../../shared/bot-quiet-result'
import { createStructuredAgentSessionOperationId } from '../../shared/agent-session/lifecycle/operations/structured-agent-session-mutation'
import type { ConnectorReplyCutJournal } from '../connector-cloud/connector-reply-outbox'
import { callerFor, chatIsIdle, type ConversationChat } from './external-conversation-chat'
import type { EndedTurnReplies } from './external-conversation-reply-fill'

// A bot's Slack request whose turn succeeded with nothing written after its last tool call is asked
// once more, in the same chat, before the thread is told there was no answer. Only a live turn end
// asks; a turn found at boot closes with no answer. The thread never sees the ask.

const RETRY_PROMPT = `Your last turn ended without a written answer. Continue from where you are and write the answer now; don't start over. If nothing needs saying, answer exactly ${BOT_QUIET_MARKER}.`
const RETRY_AFTER_TOOLS_PROMPT = `Your last turn ran tools but ended without a written answer after them. Don't call any more tools and don't repeat what already ran: answer now from the results you have, and if you wrote the answer before those tools, write it again. If nothing needs saying, answer exactly ${BOT_QUIET_MARKER}.`

/** How the ask's send went: accepted (the retry's turn fills its rows), refused (it never ran), or
 *  unknown (it may have). */
export type EmptyRetrySend = (
  sessionId: string,
  body: AgentJournalMessageItem,
  /** The empty turn: a chat whose newest turn is another by then has moved on. */
  turnItemId: string
) => Promise<'accepted' | 'refused' | 'unknown'>

export type EmptyTurnRetry = {
  /** Holds an empty turn's rows for its one retry and sends it; false fills them as they are. */
  hold: (turn: EndedTurnReplies, own: readonly JournalConnectorReplyRow[]) => Promise<boolean>
  /** A row held for a retry not yet sent: recovery leaves it. */
  sending: (row: Pick<JournalConnectorReplyRow, 'account' | 'deliveryId'>) => boolean
}

const keyOf = (row: Pick<JournalConnectorReplyRow, 'account' | 'deliveryId'>) =>
  `${row.account}\0${row.deliveryId}`

export function emptyTurnRetry(deps: {
  journal: () => ConnectorReplyCutJournal | null
  /** Whether the chat tried to post into Slack itself since `at` (ConnectorPostAttempts). */
  postedSince: (sessionId: string, at: number) => boolean
  send: EmptyRetrySend
  /** The ask is settled: recovery reads the rows again (a refused ask closes them as no answer). */
  settled: (sessionId: string) => void
}): EmptyTurnRetry {
  const sending = new Set<string>()
  return {
    sending: (row) => sending.has(keyOf(row)),
    hold: async (turn, own) => {
      const store = deps.journal()
      if (
        !store ||
        !turn.live ||
        !turn.bot ||
        own.length === 0 ||
        connectorReplyTurnOutcome(turn).outcome !== 'no_answer' ||
        turn.turnStartedAt === undefined
      ) {
        return false
      }
      if (
        deps.postedSince(turn.sessionId, turn.turnStartedAt) ||
        own.some((row) => row.emptyRetried)
      ) {
        return false
      }
      const keys = own.map(keyOf)
      keys.forEach((key) => sending.add(key))
      const release = () => keys.forEach((key) => sending.delete(key))
      const cut = { turnId: turn.turnItemId, kind: 'restart' as const }
      const held = await store
        .holdForRetry({
          keys: own
            .filter((row) => row.claimMessageId === undefined)
            .map(({ account, deliveryId }) => ({ account, deliveryId })),
          claims: [...new Set(own.flatMap((row) => row.claimMessageId ?? []))],
          cut,
          toolsRan: turn.toolsRan === true
        })
        .catch(() => false)
      if (!held) {
        release()
        return false
      }
      const body: AgentJournalMessageItem = {
        kind: 'message',
        role: 'user',
        blocks: [{ type: 'text', text: turn.toolsRan ? RETRY_AFTER_TOOLS_PROMPT : RETRY_PROMPT }],
        // Asked for whoever asked the turn, where they asked it.
        ...turn.askedBy,
        connectorClaim: {
          cutTurnId: cut.turnId,
          cutKind: cut.kind,
          // The stored claim keeps only a delivery's own fields.
          origin: turn.stamps.map(({ account, conversation, deliveryId, carried }) => ({
            account,
            conversation,
            deliveryId,
            ...(carried ? { carried } : {})
          }))
        }
      }
      // Not awaited: the turn end goes on, and the retry's own turn fills the rows it claims.
      void deps
        .send(turn.sessionId, body, turn.turnItemId)
        .catch(() => 'unknown' as const)
        .finally(() => {
          release()
          deps.settled(turn.sessionId)
        })
      return true
    }
  }
}

/** The ask, sent only into an idle chat whose newest turn is still the empty one: a running turn
 *  would take it in as a steer, and a newer one would be the turn it asks about. A continuation, so
 *  no Slack mirror posts it as the owner's. */
export function emptyRetrySend(
  chat: () => ConversationChat | null,
  /** Connectors turned off: nothing is sent, and the next recovery closes what was held. */
  signal: AbortSignal
): EmptyRetrySend {
  return async (sessionId, body, turnItemId) => {
    const host = chat()
    const record = host?.deps.store.getConversation(sessionId)
    const ready = () =>
      !signal.aborted &&
      chatIsIdle(host, sessionId) &&
      host?.publishedWork(sessionId)?.latestTurn?.itemId === turnItemId
    if (!host || !record || !ready()) {
      return 'refused'
    }
    let admitted = false
    try {
      const sent = await host.send(callerFor({ sessionId }), {
        ...structuredAgentSessionMessageSendMutation({
          sessionId,
          clientOperationId: createStructuredAgentSessionOperationId(randomUUID),
          expectedRuntimeFence: record.currentFence,
          body
        }),
        continuation: true,
        beforeRun: () => {
          if (!ready()) {
            throw new Error('chat_moved_on')
          }
          admitted = true
        }
      })
      return sent.ok ? 'accepted' : 'refused'
    } catch {
      return admitted ? 'unknown' : 'refused'
    }
  }
}
