import type { AgentJournalRenderItem } from '../journal/agent-session-journal-types'
import { isRootAgentJournalItem } from '../journal/agent-session-journal-producer'
import {
  rootAssistantProse,
  structuredAgentSessionTurnAssistantMessage
} from './structured-agent-session-latest-request'

/** What a turn's end tells the request it answered. A bot's answer is its newest root prose written
 *  after the root agent's last tool call: text before a call was commentary, so a turn that wrote
 *  only that answered nothing (a child's calls run beside the answer). Any other chat's is its
 *  newest root prose. toolsRan: any tool call ran inside the turn. */
export function structuredAgentSessionTurnReply(
  items: readonly AgentJournalRenderItem[],
  turnItemId: string,
  bot: boolean
): { prose: string; toolsRan: boolean } {
  const inTurn = (item: AgentJournalRenderItem) =>
    item.turnScope?.kind === 'turn' && item.turnScope.turnItemId === turnItemId
  const toolsRan = items.some((item) => item.body.kind === 'tool-call' && inTurn(item))
  if (!bot) {
    return { prose: structuredAgentSessionTurnAssistantMessage(items, turnItemId), toolsRan }
  }
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (!item || !inTurn(item)) {
      continue
    }
    if (item.body.kind === 'tool-call' && isRootAgentJournalItem(item)) {
      return { prose: '', toolsRan }
    }
    const prose = rootAssistantProse(item)
    if (prose.trim()) {
      return { prose, toolsRan }
    }
  }
  return { prose: '', toolsRan }
}
