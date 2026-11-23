import { expect, it } from 'vitest'
import { ConnectorPostAttempts } from './connector-post-attempts'

// A turn that went quiet because it "answered" must have answered in that turn itself.
it('reads only what the turn that started at a time posted', () => {
  let now = 100
  const posts = new ConnectorPostAttempts(() => now)
  posts.answered('pane')
  now = 200
  expect(posts.since('pane', 150)).toBeNull()
  posts.attempted('pane')
  expect(posts.since('pane', 150)).toBe('attempted')
  now = 300
  posts.answered('pane')
  expect(posts.since('pane', 250)).toBe('answered')
})
