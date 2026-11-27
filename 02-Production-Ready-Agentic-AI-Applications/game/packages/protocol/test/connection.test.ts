// The connection of a player, a console or a bot (engineering spec, section 8.2): it comes back
// by itself, also when the server cannot be reached at all for a while.
import { describe, expect, it } from 'vitest'
import { CLOSE, GameConnection } from '../src/connection.ts'

type Handlers = { onopen: ((ev: unknown) => void) | null; onmessage: ((ev: { data: unknown }) => void) | null; onclose: ((ev: { code: number }) => void) | null; onerror: ((ev: unknown) => void) | null }

/** A socket that the test opens, fails or closes by hand. */
function sockets() {
  const made: (Handlers & { readyState: number; sent: string[]; send(d: string): void; close(): void })[] = []
  class Fake {
    readyState = 0
    sent: string[] = []
    onopen: Handlers['onopen'] = null
    onmessage: Handlers['onmessage'] = null
    onclose: Handlers['onclose'] = null
    onerror: Handlers['onerror'] = null
    constructor(_url: string) { made.push(this) }
    send(d: string) { this.sent.push(d) }
    close() { this.readyState = 3 }
  }
  return { made, Fake }
}
const tick = () => new Promise((r) => setTimeout(r, 5))
const welcome = (s: Handlers & { readyState: number }) => { s.readyState = 1; s.onopen?.({}); s.onmessage?.({ data: JSON.stringify({ t: 'welcome' }) }) }

describe('a connection', () => {
  it('tries again after a socket that failed without ever closing, as the WebSocket of Node does when the server is down', async () => {
    const { made, Fake } = sockets()
    const conn = new GameConnection({ url: 'ws://x/ws', token: 't', build: 'bot', WebSocketImpl: Fake, minDelayMs: 1, maxDelayMs: 2 })
    welcome(made[0]!)
    expect(conn.status).toBe('open')
    const answer = conn.command('ping')
    made[0]!.onclose?.({ code: 1006 })
    expect(conn.status).toBe('reconnecting')
    await tick()
    // The server is down: an error, and no close.
    expect(made).toHaveLength(2)
    made[1]!.onerror?.({})
    await tick()
    expect(made).toHaveLength(3)
    // A browser sends both. The second one must not start a second retry.
    made[2]!.onerror?.({})
    made[2]!.onclose?.({ code: 1006 })
    await tick()
    expect(made).toHaveLength(4)
    welcome(made[3]!)
    expect(conn.status).toBe('open')
    // The command that waited is sent again with its id, and its answer arrives.
    const frame = JSON.parse(made[3]!.sent.at(-1)!) as { cid: string; type: string }
    expect(frame.type).toBe('ping')
    made[3]!.onmessage?.({ data: JSON.stringify({ t: 'ack', cid: frame.cid, ok: true }) })
    expect(await answer).toMatchObject({ ok: true })
    conn.close()
  })
  it('stops for good when the server says that the session is gone', async () => {
    const { made, Fake } = sockets()
    const conn = new GameConnection({ url: 'ws://x/ws', token: 't', build: 'bot', WebSocketImpl: Fake, minDelayMs: 1, maxDelayMs: 2 })
    welcome(made[0]!)
    made[0]!.onclose?.({ code: CLOSE.closed })
    await tick()
    expect(conn.status).toBe('ended')
    expect(made).toHaveLength(1)
  })
})
