// Server tests (engineering spec, section 12.4).
import WebSocket from 'ws'
import { afterEach, describe, expect, it } from 'vitest'
import { STAGES } from '@lab02/protocol'
import { needsReload } from '../src/index.ts'
import { attach, hostConn, hostToken, joinBot, sleep, startServer, step, until, type Bot } from './helpers.ts'

type Srv = Awaited<ReturnType<typeof startServer>>
const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c()
})

async function server(dataDir?: string): Promise<Srv> {
  const srv = await startServer({ dataDir })
  cleanups.push(() => srv.app.close().catch(() => {}))
  return srv
}

function session(srv: Srv, mode: 'test' | 'rehearsal' = 'test'): string {
  const r = srv.app.manager.create('Test session', mode)
  if (!r.ok) throw new Error(r.error)
  return r.room.code
}

describe('a whole game', () => {
  it('40 headless clients play the demo pack from join to winners at time scale 50', async () => {
    const srv = await server()
    cleanups.push(srv.cleanup)
    const code = session(srv)
    const token = await hostToken(srv.url)
    const host = hostConn(srv.ws, token, code)
    cleanups.push(() => host.close())
    await until(() => host.status === 'open', 5000, 'host')
    expect((await host.command('set_scale', { scale: 50 })).ok).toBe(true)

    const bots: Bot[] = []
    for (let i = 0; i < 40; i++) bots.push(await joinBot(srv, code, `Practice ${String(i).padStart(2, '0')}`))
    cleanups.push(() => bots.forEach((b) => b.conn.close()))
    await until(() => bots.every((b) => b.stage === 'lobby'), 5000, 'welcomes')

    const room = srv.app.manager.get(code)!
    const counts = room.state.systems.map((s) => room.state.order.filter((id) => room.state.players[id]!.system === s).length)
    expect(counts).toEqual([20, 20])

    // Play stages end by themselves at time scale 50. Everything else waits for the host.
    while (room.state.stage !== 'winners') {
      const before = room.state.stage
      if (room.state.stageEndsAtMs === null) await step(srv.app, host, code)
      await until(() => room.state.stage !== before, 15_000, `leaving ${before}`)
    }
    await until(() => bots.every((b) => b.stage === 'winners'), 5000, 'bots at winners')
    const stagesSeen = new Set(bots[0]!.messages.filter((m) => m.t === 'view' || m.t === 'welcome').map((m) => (JSON.parse(m.raw) as { view: { stage: string } }).view.stage))
    expect(STAGES.slice(0, STAGES.indexOf('winners') + 1).filter((st) => !stagesSeen.has(st))).toEqual([])
    for (const b of bots) {
      expect(b.messages.some((m) => m.t === 'standing')).toBe(true)
      const pts = (b.view as { points: Record<string, unknown> }).points
      expect(pts.planning).not.toBeNull()
      expect(pts.maintaining).not.toBeNull()
    }
  })
})

describe('restart', () => {
  it('a server restarted in the middle of a phase gives the same state and every client returns', async () => {
    const srv1 = await server()
    const code = session(srv1)
    const token = await hostToken(srv1.url)
    const host1 = hostConn(srv1.ws, token, code)
    await until(() => host1.status === 'open')
    const bots: Bot[] = []
    for (let i = 0; i < 6; i++) bots.push(await joinBot(srv1, code, `Restart Branch ${i}`))
    await step(srv1.app, host1, code)
    await step(srv1.app, host1, code)
    expect(srv1.app.manager.get(code)!.state.stage).toBe('planning.play')
    await host1.command('remove_player', { playerId: bots[5]!.playerId })
    await host1.command('screen_theme', { theme: 'dark' })
    const before = srv1.app.manager.get(code)!.state
    const snapshot = JSON.parse(JSON.stringify(before)) as typeof before
    host1.close()
    for (const b of bots) b.conn.close()
    await srv1.app.close()
    cleanups.length = 0

    const srv2 = await server(srv1.dataDir)
    cleanups.push(srv2.cleanup)
    const after = srv2.app.manager.get(code)!.state
    expect(after.stage).toBe('planning.play')
    expect(after.order).toEqual(snapshot.order)
    expect(after.players[bots[5]!.playerId]!.removed).toBe(true)
    expect(after.screen.theme).toBe('dark')
    for (const id of snapshot.order) expect(after.players[id]!.system).toBe(snapshot.players[id]!.system)
    expect(after.stageEndsAtMs).toBe(snapshot.stageEndsAtMs)

    // Old tokens still work after the restart, and so does a rejoin with the code.
    const back = attach(srv2.ws, bots[0]!.token)
    cleanups.push(() => back.conn.close())
    await until(() => back.stage === 'planning.play', 5000, 'rejoin after restart')
    const rj = await srv2.api.rejoin({ code, rejoinCode: bots[1]!.rejoinCode })
    expect(rj.ok).toBe(true)
  })
})

describe('reconnect and rejoin', () => {
  it('a repeated cid acts once', async () => {
    const srv = await server()
    cleanups.push(srv.cleanup)
    const code = session(srv)
    const token = await hostToken(srv.url)
    const ws = new WebSocket(srv.ws)
    cleanups.push(() => ws.close())
    const got: Record<string, unknown>[] = []
    ws.on('message', (d) => got.push(JSON.parse(d.toString()) as Record<string, unknown>))
    await new Promise((r) => ws.on('open', r))
    ws.send(JSON.stringify({ t: 'hello', token, build: 'bot', session: code }))
    await until(() => got.some((m) => m.t === 'welcome'))
    const frame = JSON.stringify({ t: 'hostcmd', cid: 'same-cid', type: 'next', payload: {} })
    ws.send(frame)
    ws.send(frame)
    await until(() => got.filter((m) => m.t === 'ack').length === 2)
    expect(got.filter((m) => m.t === 'ack').map((m) => m.ok)).toEqual([true, true])
    expect(srv.app.manager.get(code)!.state.stage).toBe('intro')
  })

  it('a client that drops comes back to the same practice', async () => {
    const srv = await server()
    cleanups.push(srv.cleanup)
    const code = session(srv)
    const bot = await joinBot(srv, code, 'Dropping Branch')
    cleanups.push(() => bot.conn.close())
    await until(() => bot.status === 'open')
    const welcomes = () => bot.messages.filter((m) => m.t === 'welcome').length
    // Kill every socket from the server side; the client reconnects by itself.
    const room = srv.app.manager.get(code)!
    room.closeAll(1011)
    await until(() => welcomes() === 2, 5000, 'second welcome')
    expect((bot.view as { me: { id: string } }).me.id).toBe(bot.playerId)
  })

  it('a rejoin with the code gives the same view and refuses the old token', async () => {
    const srv = await server()
    cleanups.push(srv.cleanup)
    const code = session(srv)
    const token = await hostToken(srv.url)
    const host = hostConn(srv.ws, token, code)
    cleanups.push(() => host.close())
    await until(() => host.status === 'open')
    const bot = await joinBot(srv, code, 'Lost Browser')
    await until(() => bot.status === 'open')
    await step(srv.app, host, code)
    await step(srv.app, host, code)
    await until(() => bot.stage === 'planning.play')
    const before = bot.view
    const r = await srv.api.rejoin({ code, rejoinCode: bot.rejoinCode.toLowerCase() })
    expect(r.ok).toBe(true)
    await until(() => bot.status === 'superseded', 5000, 'old socket superseded')
    if (!r.ok) return
    const again = attach(srv.ws, r.data.token)
    cleanups.push(() => again.conn.close())
    await until(() => again.stage === 'planning.play')
    const strip = (v: unknown) => JSON.stringify({ ...(v as object), rev: 0 })
    expect(strip(again.view)).toBe(strip(before))
    const old = attach(srv.ws, bot.token)
    cleanups.push(() => old.conn.close())
    await until(() => old.status === 'unauthorized', 5000, 'old token refused')
  })

  it('a join with a name that exists is refused with name_taken and creates nothing', async () => {
    const srv = await server()
    cleanups.push(srv.cleanup)
    const code = session(srv)
    expect((await srv.api.join({ code, name: 'Same Name' })).ok).toBe(true)
    const r = await srv.api.join({ code, name: 'same name' })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.status).toBe(409)
      expect(r.error).toBe('name_taken')
    }
    expect(srv.app.manager.get(code)!.state.order).toHaveLength(1)
  })

  it('a removed player is closed and cannot come back', async () => {
    const srv = await server()
    cleanups.push(srv.cleanup)
    const code = session(srv)
    const token = await hostToken(srv.url)
    const host = hostConn(srv.ws, token, code)
    cleanups.push(() => host.close())
    const bot = await joinBot(srv, code, 'Removed Branch')
    await until(() => bot.status === 'open' && host.status === 'open')
    expect((await host.command('remove_player', { playerId: bot.playerId })).ok).toBe(true)
    await until(() => bot.status === 'removed')
    const r = await srv.api.rejoin({ code, rejoinCode: bot.rejoinCode })
    expect(r.ok).toBe(false)
  })
})

describe('builds', () => {
  it('asks a browser on an old build to reload, and never a bot or a dev server', () => {
    expect(needsReload('web-123', '123')).toBe(false)
    expect(needsReload('web-122', '123')).toBe(true)
    expect(needsReload('web-dev', 'dev')).toBe(false)
    expect(needsReload('bot', '123')).toBe(false)
  })
})

describe('limits', () => {
  it('refuses a wrong token, a missing hello and an oversized message', async () => {
    const srv = await server()
    cleanups.push(srv.cleanup)
    session(srv)
    const closeCode = (send: (ws: WebSocket) => void) => new Promise<number>((resolve) => {
      const ws = new WebSocket(srv.ws)
      ws.on('open', () => send(ws))
      ws.on('close', (c) => resolve(c))
      ws.on('error', () => {})
    })
    expect(await closeCode((ws) => ws.send(JSON.stringify({ t: 'hello', token: 'x'.repeat(40), build: 'bot' })))).toBe(4001)
    expect(await closeCode((ws) => ws.send(JSON.stringify({ t: 'cmd', cid: 'a', type: 'x', payload: {} })))).toBe(1008)
    expect(await closeCode((ws) => ws.send('x'.repeat(17 * 1024)))).toBe(1009)
  })

  it('rate limits commands per connection', async () => {
    const srv = await server()
    cleanups.push(srv.cleanup)
    const code = session(srv)
    const bot = await joinBot(srv, code, 'Fast Clicker')
    cleanups.push(() => bot.conn.close())
    await until(() => bot.status === 'open')
    const results = await Promise.all(Array.from({ length: 30 }, () => bot.conn.command('planning.submit', {})))
    expect(results.filter((r) => r.error === 'rate_limited').length).toBeGreaterThan(0)
  })

  it('a player command on a host socket is refused', async () => {
    const srv = await server()
    cleanups.push(srv.cleanup)
    const code = session(srv)
    const token = await hostToken(srv.url)
    const host = hostConn(srv.ws, token, code)
    cleanups.push(() => host.close())
    await until(() => host.status === 'open')
    const r = await host.command('planning.submit', {})
    expect(r.ok).toBe(false)
  })

  it('serves content only once its phase opens', async () => {
    const srv = await server()
    cleanups.push(srv.cleanup)
    const code = session(srv)
    const r = await srv.api.join({ code, name: 'Early Reader' })
    if (!r.ok) throw new Error('join')
    const early = await srv.api.content(r.data.token, 'planning')
    expect(early.ok).toBe(false)
    if (!early.ok) expect(early.status).toBe(403)
    const room = srv.app.manager.get(code)!
    const token = await hostToken(srv.url)
    const host = hostConn(srv.ws, token, code)
    cleanups.push(() => host.close())
    await until(() => host.status === 'open')
    await step(srv.app, host, code)
    await step(srv.app, host, code)
    expect(room.state.stage).toBe('planning.play')
    const later = await srv.api.content(r.data.token, 'planning')
    expect(later.ok && later.data.problems.length).toBe(6)
  })

  it('refuses the host API without a token and slows down wrong passcodes', async () => {
    const srv = await server()
    cleanups.push(srv.cleanup)
    expect((await fetch(`${srv.url}/api/host/sessions`)).status).toBe(401)
    const wrong = () => fetch(`${srv.url}/api/host/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ passcode: 'nope' }) })
    expect((await wrong()).status).toBe(401)
    const t0 = Date.now()
    expect((await wrong()).status).toBe(401)
    expect(Date.now() - t0).toBeGreaterThanOrEqual(900)
  })
})

void sleep
