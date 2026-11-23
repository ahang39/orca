import type { AgentJournalRenderItem } from '../journal/agent-session-journal-types'
import { isRootAgentJournalItem } from '../journal/agent-session-journal-producer'
import { rootAssistantProse } from './structured-agent-session-latest-request'

/** What a turn's end tells the request it answered: its newest root prose written after the root
 *  agent's last tool call (text before a call was commentary, so a turn that wrote only that answered
 *  nothing; a child's calls run beside the answer), and whether any tool call ran inside it. */
export function structuredAgentSessionTurnReply(
  items: readonly AgentJournalRenderItem[],
  turnItemId: string
): { prose: string; toolsRan: boolean } {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item?.turnScope?.kind !== 'turn' || item.turnScope.turnItemId !== turnItemId) {
      continue
    }
    if (item.body.kind === 'tool-call' && isRootAgentJournalItem(item)) {
      return { prose: '', toolsRan: true }
    }
    const prose = rootAssistantProse(item)
    if (prose.trim()) {
      const toolsRan = items.some(
        (each) =>
          each.body.kind === 'tool-call' &&
          each.turnScope?.kind === 'turn' &&
          each.turnScope.turnItemId === turnItemId
      )
      return { prose, toolsRan }
    }
  }
  return { prose: '', toolsRan: false }
}
