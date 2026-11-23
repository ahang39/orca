// When each chat, by its pane key, last tried to post into Slack itself, and last answered its own
// conversation with a confirmed reply. An attempt is noted before the cloud call, so a failed or
// uncertain post still counts as one. Memory only: after a restart no live turn end retries anything.

/** A turn's own posts: a confirmed reply into the conversation it answers, or only an attempt. */
export type ConnectorPostAttempt = 'answered' | 'attempted'

// One entry per chat that posted; past this many, the longest idle goes first.
const MAX_CHATS = 1000

export class ConnectorPostAttempts {
  private readonly last = new Map<string, { attemptAt: number; answeredAt?: number }>()

  constructor(private readonly now: () => number = Date.now) {}

  /** Before the cloud call. */
  attempted(paneKey: string): void {
    this.write(paneKey, { ...this.last.get(paneKey), attemptAt: this.now() })
  }

  /** The cloud confirmed a reply into the chat's own conversation. */
  answered(paneKey: string): void {
    const at = this.now()
    this.write(paneKey, { attemptAt: at, answeredAt: at })
  }

  /** What the chat's turn that started at `at` posted itself. */
  since(paneKey: string, at: number): ConnectorPostAttempt | null {
    const last = this.last.get(paneKey)
    if (!last || last.attemptAt < at) {
      return null
    }
    return last.answeredAt !== undefined && last.answeredAt >= at ? 'answered' : 'attempted'
  }

  private write(paneKey: string, entry: { attemptAt: number; answeredAt?: number }): void {
    this.last.delete(paneKey)
    this.last.set(paneKey, entry)
    if (this.last.size > MAX_CHATS) {
      this.last.delete(this.last.keys().next().value!)
    }
  }
}

/** The running app's record: the post paths note into it, the reply fill reads it. */
export const connectorPostAttempts = new ConnectorPostAttempts()
