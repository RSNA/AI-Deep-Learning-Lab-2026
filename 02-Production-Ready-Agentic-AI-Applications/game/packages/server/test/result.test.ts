// A result to come back to (engineering spec, sections 7.2, 7.5 and 7.7): the report card of a
// practice, during the game, after the session is closed, and after a restart of the server.
import { afterEach, describe, expect, it } from 'vitest'
import { ReportCard } from '@lab02/protocol'
import { hostConn, hostToken, joinBot, playPlanning, startServer, step, until, type Bot } from './helpers.ts'

type Srv = Awaited<ReturnType<typeof startServer>>
const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c()
})

async function server(dataDir?: string, wallNow?: () => number): Promise<Srv> {
  const srv = await startServer({ dataDir, wallNow })
  cleanups.push(() => srv.app.close().catch(() => {}))
  return srv
}

/** A session with `n` bots, played at time scale 50 until `stage`. */
async function playTo(srv: Srv, label: string, stage: string, n = 3) {
  const made = srv.app.manager.create(label, 'test')
  if (!made.ok) throw new Error(made.error)
  const code = made.room.code
  const host = hostConn(srv.ws, await hostToken(srv.url), code)
  cleanups.push(() => host.close())
  await until(() => host.status === 'open', 5000, 'host')
  expect((await host.command('set_scale', { scale: 50 })).ok).toBe(true)
  const bots: Bot[] = []
  for (let i = 0; i < n; i++) bots.push(await joinBot(srv, code, `${label} ${i + 1}`))
  for (const [i, b] of bots.entries()) playPlanning(b, srv.url, i + 1)
  cleanups.push(() => bots.forEach((b) => b.conn.close()))
  const room = srv.app.manager.get(code)!
  while (room.state.stage !== stage) {
    const before = room.state.stage
    if (room.state.stageEndsAtMs === null) await step(srv.app, host, code)
    await until(() => room.state.stage !== before, 15_000, `leaving ${before}`)
  }
  return { code, host, bots, room }
}

const post = (srv: Srv, body: unknown) => fetch(`${srv.url}/api/result`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

describe('the report card of a practice', () => {
  it('is on the screen at winners, and comes back by the session code or its label with the rejoin code', async () => {
    const srv = await server()
    cleanups.push(srv.cleanup)
    const { code, bots, room } = await playTo(srv, 'Spring Game', 'winners')
    await until(() => bots.every((b) => b.stage === 'winners'), 5000, 'bots at winners')
    const b = bots[0]!
    const shown = (b.view as { reportCard: ReportCard | null }).reportCard!
    expect(ReportCard.safeParse(shown).success).toBe(true)
    expect(shown.final).toBe(true)
    expect(shown.practice).toMatchObject({ name: 'Spring Game 1', rejoinCode: b.rejoinCode })
    expect(shown.session).toMatchObject({ code, label: 'Spring Game', playedAtMs: srv.app.db.session(code)!.created })
    expect(shown.phases.map((p) => p.points)).toEqual(['planning', 'development', 'maintaining'].map((ph) => room.state.players[b.playerId]!.results[ph as 'planning']!.points))
    expect(shown.of).toBe(3)

    // By the code of the session, typed in any case, and by its label.
    for (const session of [code, code.toLowerCase(), 'Spring Game', '  spring game ']) {
      const r = await srv.api.result({ session, rejoinCode: b.rejoinCode.toLowerCase() })
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.data.card).toEqual(shown)
    }
    // A wrong code and a wrong session get one and the same answer.
    const wrongCode = await post(srv, { session: code, rejoinCode: 'ZZZZZZ' })
    const wrongSession = await post(srv, { session: 'NOPE99', rejoinCode: b.rejoinCode })
    expect([wrongCode.status, wrongSession.status]).toEqual([404, 404])
    expect(await wrongCode.json()).toEqual(await wrongSession.json())
    expect((await post(srv, { session: code })).status).toBe(400)
    expect((await post(srv, { session: code, rejoinCode: '' })).status).toBe(404)
    // The code of one practice opens that practice only.
    const other = await srv.api.result({ session: code, rejoinCode: bots[1]!.rejoinCode })
    expect(other.ok && other.data.card.practice.name).toBe('Spring Game 2')
  })

  it('exists once the first phase is scored, as the result so far, and not before', async () => {
    const srv = await server()
    cleanups.push(srv.cleanup)
    const { code, bots, host } = await playTo(srv, 'Early Game', 'planning.play', 2)
    const b = bots[0]!
    expect((await post(srv, { session: code, rejoinCode: b.rejoinCode })).status).toBe(404)
    expect(srv.app.db.results(code)).toEqual([])
    await step(srv.app, host, code)
    await until(() => srv.app.manager.get(code)!.state.stage === 'planning.reveal', 5000, 'the reveal')
    const r = await srv.api.result({ session: code, rejoinCode: b.rejoinCode })
    expect(r.ok && r.data.card.final).toBe(false)
    expect(r.ok && r.data.card.phases.map((p) => p.scored)).toEqual([true, false, false])
    expect(srv.app.db.results(code).length).toBe(2)
    // The player's own view carries no card before the end of the game.
    expect((b.view as { reportCard: unknown }).reportCard).toBeNull()
  })

  it('stays after the session is closed and after a restart, also when later sessions were played', async () => {
    const srv1 = await server()
    const first = await playTo(srv1, 'Monday Game', 'winners', 2)
    const b = first.bots[0]!
    const before = await srv1.api.result({ session: first.code, rejoinCode: b.rejoinCode })
    expect(before.ok).toBe(true)
    expect((await first.host.command('close', { confirm: first.code })).ok).toBe(true)
    await until(() => first.room.state.stage === 'closed', 5000, 'closed')
    // Closed, and still in memory.
    const closed = await srv1.api.result({ session: first.code, rejoinCode: b.rejoinCode })
    expect(closed.ok && closed.data.card).toEqual(before.ok && before.data.card)
    // A later game with a practice that got the same kind of code.
    const second = await playTo(srv1, 'Tuesday Game', 'break.planning', 2)
    const b2 = second.bots[0]!
    for (const c of cleanups.splice(0).reverse()) await c()

    // After a restart the closed session is not loaded. Its cards are in the database.
    const srv2 = await server(srv1.dataDir)
    cleanups.push(srv2.cleanup)
    expect(srv2.app.manager.get(first.code)).toBeUndefined()
    const after = await srv2.api.result({ session: first.code, rejoinCode: b.rejoinCode })
    expect(after.ok && after.data.card).toEqual(before.ok && before.data.card)
    const byLabel = await srv2.api.result({ session: 'monday game', rejoinCode: b.rejoinCode })
    expect(byLabel.ok && byLabel.data.card.practice.name).toBe('Monday Game 1')
    // A code belongs to one session: the code of Tuesday's practice opens nothing of Monday.
    expect((await post(srv2, { session: first.code, rejoinCode: b2.rejoinCode })).status).toBe(404)
    const tuesday = await srv2.api.result({ session: second.code, rejoinCode: b2.rejoinCode })
    expect(tuesday.ok && tuesday.data.card.session.label).toBe('Tuesday Game')
    // The host's downloads of the closed session hold what the cards show.
    const token = await hostToken(srv2.url)
    const get = async (what: string) => (await (await fetch(`${srv2.url}/api/host/export/${first.code}?what=${what}&format=json`, { headers: { authorization: `Bearer ${token}` } })).json()) as Record<string, unknown>[]
    const cards = await get('cards')
    expect(cards.map((r) => r.practice).sort()).toEqual(['Monday Game 1', 'Monday Game 2'])
    expect(cards[0]).toMatchObject({ final: true, rejoin_code: expect.any(String), planning_points: expect.any(Number), planning_rank: expect.any(Number) })
    const results = await get('results')
    expect(results.length).toBe(2)
    expect(results[0]).toMatchObject({ practice: 'Monday Game 1', total: before.ok ? before.data.card.total : -1, rank: before.ok ? before.data.card.rank : -1 })
    // Deleting the session is the one thing that removes its results.
    expect((await fetch(`${srv2.url}/api/host/session/${first.code}`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } })).status).toBe(200)
    expect((await post(srv2, { session: first.code, rejoinCode: b.rejoinCode })).status).toBe(404)
    expect(srv2.app.db.results(first.code)).toEqual([])
  })

  it('follows a rename and a removal, and goes when the game starts again', async () => {
    const srv = await server()
    cleanups.push(srv.cleanup)
    const { code, bots, host, room } = await playTo(srv, 'Changing Game', 'break.planning', 2)
    const [a, b] = bots as [Bot, Bot]
    expect((await host.command('rename_player', { playerId: a.playerId, name: 'Renamed Branch' })).ok).toBe(true)
    await until(() => srv.app.db.results(code).some((r) => r.card.includes('Renamed Branch')), 5000, 'the kept card follows the rename')
    expect((await host.command('remove_player', { playerId: b.playerId })).ok).toBe(true)
    await until(() => srv.app.db.results(code).length === 1, 5000, 'the card of a removed practice goes')
    expect((await post(srv, { session: code, rejoinCode: b.rejoinCode })).status).toBe(404)
    const kept = await srv.api.result({ session: code, rejoinCode: a.rejoinCode })
    expect(kept.ok && [kept.data.card.practice.name, kept.data.card.of]).toEqual(['Renamed Branch', 1])
    expect((await host.command('restart_game', { confirm: code })).ok).toBe(true)
    await until(() => room.state.stage === 'lobby', 5000, 'the lobby')
    expect(srv.app.db.results(code)).toEqual([])
    expect((await post(srv, { session: code, rejoinCode: a.rejoinCode })).status).toBe(404)
  })

  it('limits the lookups of a minute, like the rejoin', async () => {
    let wall = 1_000_000
    const srv = await server(undefined, () => wall)
    cleanups.push(srv.cleanup)
    for (let i = 0; i < 600; i++) expect((await post(srv, { session: 'NOPE99', rejoinCode: 'ABCDEF' })).status).toBe(404)
    const limited = await post(srv, { session: 'NOPE99', rejoinCode: 'ABCDEF' })
    expect(limited.status).toBe(429)
    expect(await limited.json()).toEqual({ error: 'rate_limited' })
    wall += 61_000
    expect((await post(srv, { session: 'NOPE99', rejoinCode: 'ABCDEF' })).status).toBe(404)
  })
})
