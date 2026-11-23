// When each chat last tried to post into Slack itself, by its pane key: `orca bot reply` and a
// connector reply (into its own conversation), or a post or attach (anywhere). Noted before the cloud
// call, so a failed or uncertain post counts too. Memory only: after a restart no live turn end
// retries anything.

/** Where a chat's turn tried to post: into the conversation it answers, or somewhere else. */
export type ConnectorPostAttempt = 'here' | 'elsewhere'

// Read once per ended turn; chats that never get one are dropped oldest first past this many.
const MAX_CHATS = 1000

export class ConnectorPostAttempts {
  private readonly last = new Map<string, { at: number; here: boolean }>()

  constructor(private readonly now: () => number = Date.now) {}

  note(paneKey: string, where: ConnectorPostAttempt): void {
    const here = where === 'here' || this.last.get(paneKey)?.here === true
    this.last.delete(paneKey)
    this.last.set(paneKey, { at: this.now(), here })
    if (this.last.size > MAX_CHATS) {
      this.last.delete(this.last.keys().next().value!)
    }
  }

  /** What the chat tried at or after `at` (its ended turn's start), forgotten once read. */
  takeSince(paneKey: string, at: number): ConnectorPostAttempt | null {
    const last = this.last.get(paneKey)
    this.last.delete(paneKey)
    return last && last.at >= at ? (last.here ? 'here' : 'elsewhere') : null
  }
}

/** The running app's record: the post paths note into it, the reply fill reads it. */
export const connectorPostAttempts = new ConnectorPostAttempts()
