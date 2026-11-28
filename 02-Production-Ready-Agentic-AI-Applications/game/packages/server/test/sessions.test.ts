// Sessions (engineering spec, sections 6.4, 6.14, 7.2, 7.5 and 7.6): one session with a
// facilitator at a time, its name, single-player games from start to cleanup, the games a
// browser kept, a game to look at again, and a late joiner who waits for the next phase.
import { afterEach, describe, expect, it } from 'vitest'
import { Review, type GameSummary, type PlayerView, type Standing } from '@lab02/protocol'
import type { Config } from '../src/index.ts'
import { attach, hostConn, hostToken, joinBot, sleep, startServer, step, until, type Bot } from './helpers.ts'

type Srv = Awaited<ReturnType<typeof startServer>>
const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c()
})

async function server(config: Partial<Config> = {}, dataDir?: string): Promise<Srv> {
  const srv = await startServer({ dataDir, config })
  cleanups.push(() => srv.app.close().catch(() => {}))
  if (!dataDir) cleanups.unshift(srv.cleanup)
  return srv
}

/** The facilitator passcode of the test server, which a single-player game asks for until a facilitator says otherwise. */
const PASS = 'test-passcode'
const json = (token?: string) => ({ 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) })
const post = (srv: Srv, path: string, body: unknown, token?: string, method = 'POST') =>
  fetch(`${srv.url}${path}`, { method, headers: json(token), body: JSON.stringify(body) })
const view = (b: Bot) => b.view as unknown as PlayerView

async function solo(srv: Srv, name: string): Promise<Bot> {
  const r = await srv.api.solo({ passcode: PASS, name })
  if (!r.ok) throw new Error(`solo refused: ${r.error}`)
  const bot = attach(srv.ws, r.data.token, { playerId: r.data.playerId, rejoinCode: r.data.rejoinCode })
  cleanups.push(() => bot.conn.close())
  await until(() => bot.stage !== null, 5000, 'solo welcome')
  return Object.assign(bot, { session: r.data.session })
}
const codeOf = (b: Bot) => (b as Bot & { session: string }).session

/** The player of a single-player game moves it on until `stage`: through the slides, and out of each phase at once. */
async function soloTo(bot: Bot, stage: string): Promise<void> {
  for (let i = 0; i < 80 && bot.stage !== stage; i++) {
    const s = view(bot).solo!
    const before = `${bot.stage}:${view(bot).slide?.index ?? ''}`
    const type = s.timed ? 'solo.end_now' : s.slide && !s.slide.last ? 'solo.slide' : 'solo.next'
    const r = await bot.conn.command(type, type === 'solo.slide' ? { delta: 1 } : {})
    if (!r.ok) throw new Error(`${type} refused at ${bot.stage}: ${r.error}`)
    await until(() => `${bot.stage}:${view(bot).slide?.index ?? ''}` !== before, 5000, `leaving ${before}`)
  }
  expect(bot.stage).toBe(stage)
}

describe('one session with a facilitator at a time', () => {
  it('refuses a second one with what runs, and ends the one that runs when the facilitator says so', async () => {
    const srv = await server()
    const token = await hostToken(srv.url)
    const make = (body: Record<string, unknown>) => post(srv, '/api/host/session', { mode: 'rehearsal', ...body }, token)
    expect((await make({ label: 'Morning', code: 'FIRST1', by: 'Ada' })).status).toBe(200)
    await joinBot(srv, 'FIRST1', 'Practice One').then((b) => cleanups.push(() => b.conn.close()))

    const refused = await make({ label: 'Noon', code: 'SECOND' })
    expect(refused.status).toBe(409)
    expect(await refused.json()).toMatchObject({ error: 'session_running', running: { code: 'FIRST1', label: 'Morning', createdBy: 'Ada', players: 1, stage: 'lobby', needsCode: false } })
    expect(srv.app.db.session('SECOND')).toBeUndefined()
    // The facilitator was warned about another session than the one that runs now: asked again.
    expect(await (await make({ label: 'Noon', code: 'SECOND', replace: { code: 'OTHER1' } })).json()).toMatchObject({ error: 'session_running', running: { code: 'FIRST1' } })

    expect((await make({ label: 'Noon', code: 'SECOND', by: 'Grace', replace: { code: 'FIRST1' } })).status).toBe(200)
    expect(srv.app.manager.get('FIRST1')!.state.closed).toBe(true)
    expect(srv.app.db.session('FIRST1')!.closed).not.toBeNull()
    expect(srv.app.manager.running().map((r) => r.code)).toEqual(['SECOND'])
    // The players of the one that ended are led to the new one.
    const next = await srv.api.open('FIRST1')
    expect(next.ok && next.data.session?.code).toBe('SECOND')

    // The list names who opened each session and how many results it keeps.
    const list = (await (await fetch(`${srv.url}/api/host/sessions`, { headers: json(token) })).json()) as { sessions: { code: string; createdBy: string; results: number }[] }
    expect(list.sessions.map((s) => [s.code, s.createdBy, s.results])).toEqual([['SECOND', 'Grace', 0], ['FIRST1', 'Ada', 0]])
  })

  it('asks for the code of an event session that has players, typed out', async () => {
    const srv = await server()
    const token = await hostToken(srv.url)
    const made = srv.app.manager.create('The event', 'rehearsal', { code: 'EVENT1' })
    if (!made.ok) throw new Error(made.error)
    // The demo pack has no measured anchors, so no event session can be opened on it: the mode is set here.
    made.room.state.mode = 'event'
    const make = (replace: unknown) => post(srv, '/api/host/session', { label: 'By a slip', mode: 'rehearsal', replace }, token)
    // An event session without players ends like any other.
    expect(srv.app.manager.describe(made.room).needsCode).toBe(false)
    await joinBot(srv, 'EVENT1', 'Practice One').then((b) => cleanups.push(() => b.conn.close()))
    expect(await (await make(undefined)).json()).toMatchObject({ error: 'session_running', running: { code: 'EVENT1', needsCode: true } })
    expect(await (await make({ code: 'EVENT1' })).json()).toEqual({ error: 'confirm_mismatch' })
    expect(await (await make({ code: 'EVENT1', confirm: 'NOPE12' })).json()).toEqual({ error: 'confirm_mismatch' })
    expect(made.room.state.closed).toBe(false)
    expect((await make({ code: 'EVENT1', confirm: 'event1' })).status).toBe(200)
    expect(made.room.state.closed).toBe(true)
  })

  it('renames a session before it starts and after it has ended, and not in between', async () => {
    const srv = await server()
    const token = await hostToken(srv.url)
    const made = srv.app.manager.create('First name', 'test', { code: 'NAME01' })
    if (!made.ok) throw new Error(made.error)
    const rename = (label: unknown, code = 'NAME01') => post(srv, `/api/host/session/${code}`, { label }, token, 'PATCH')
    expect((await post(srv, '/api/host/session/NAME01', { label: 'x' }, undefined, 'PATCH')).status).toBe(401)
    expect(await (await rename('   ')).json()).toEqual({ error: 'bad_message' })
    expect(await (await rename('Nobody', 'NOPE12')).json()).toEqual({ error: 'unknown_session' })
    expect((await rename('Sunday lab')).status).toBe(200)
    expect(srv.app.db.session('NAME01')!.label).toBe('Sunday lab')
    const info = await srv.api.session('NAME01')
    expect(info.ok && info.data.label).toBe('Sunday lab')

    const host = hostConn(srv.ws, token, 'NAME01')
    cleanups.push(() => host.close())
    await until(() => host.status === 'open')
    const bot = await joinBot(srv, 'NAME01', 'Practice One')
    cleanups.push(() => bot.conn.close())
    await step(srv.app, host, 'NAME01')
    expect(await (await rename('While it runs')).json()).toEqual({ error: 'rename_running' })
    expect(made.room.state.label).toBe('Sunday lab')
    // Played until a phase is scored, then ended: the new name reaches the stored card too.
    while (made.room.state.stage !== 'planning.reveal') await step(srv.app, host, 'NAME01')
    expect((await host.command('close', { confirm: 'NAME01' })).ok).toBe(true)
    expect((await rename('Kept name')).status).toBe(200)
    const card = await srv.api.result({ session: 'Kept name', rejoinCode: bot.rejoinCode })
    expect(card.ok && card.data.card.session.label).toBe('Kept name')

    // After a restart the ended session is no longer in memory. Its name and its cards still follow.
    await srv.app.close()
    const srv2 = await server({}, srv.dataDir)
    expect(srv2.app.manager.get('NAME01')).toBeUndefined()
    expect((await post(srv2, '/api/host/session/NAME01', { label: 'After the restart' }, await hostToken(srv2.url), 'PATCH')).status).toBe(200)
    const again = await srv2.api.result({ session: 'NAME01', rejoinCode: bot.rejoinCode })
    expect(again.ok && again.data.card.session.label).toBe('After the restart')
  })
})

describe('a single-player game', () => {
  it('is offered while the switch is on, and refused with a reason otherwise', async () => {
    const srv = await server({ soloPerAddress: 3 })
    const token = await hostToken(srv.url)
    const open = await srv.api.open()
    expect(open.ok && open.data).toMatchObject({ session: null, solo: true })
    expect((await post(srv, '/api/host/solo', { enabled: false })).status).toBe(401)
    expect((await post(srv, '/api/host/solo', { enabled: 'no' }, token)).status).toBe(400)
    expect(await (await post(srv, '/api/host/solo', { enabled: false }, token)).json()).toEqual({ enabled: false, gate: 'facilitator' })
    const off = await srv.api.open()
    expect(off.ok && off.data.solo).toBe(false)
    expect(await srv.api.solo({ passcode: PASS, name: 'Practice One' })).toMatchObject({ ok: false, status: 403, error: 'solo_off' })
    await post(srv, '/api/host/solo', { enabled: true }, token)
    expect(await srv.api.solo({ passcode: PASS, name: 'ab' })).toMatchObject({ ok: false, status: 400, error: 'name_invalid' })
    // One address starts a few games in ten minutes, and no more.
    for (let i = 0; i < 3; i++) expect((await srv.api.solo({ passcode: PASS, name: `Practice ${i}` })).ok).toBe(true)
    expect(await srv.api.solo({ passcode: PASS, name: 'Practice Four' })).toMatchObject({ ok: false, status: 429, error: 'rate_limited' })
  })

  it('asks for a passcode: the facilitator passcode at first, then one of its own, or none', async () => {
    const srv = await server()
    const token = await hostToken(srv.url)
    const gate = async () => ((await (await fetch(`${srv.url}/api/host/sessions`, { headers: json(token) })).json()) as { solo: { gate: string } }).solo.gate
    const open = async () => { const r = await srv.api.open(); return r.ok && r.data.soloPasscode }
    // At first the facilitator passcode, and nothing without it.
    expect(await gate()).toBe('facilitator')
    expect(await open()).toBe(true)
    expect(await srv.api.solo({ name: 'Practice One' })).toMatchObject({ ok: false, status: 401, error: 'wrong_passcode' })
    expect(await srv.api.solo({ name: 'Practice One', passcode: 'not this one' })).toMatchObject({ ok: false, status: 401, error: 'wrong_passcode' })
    expect((await srv.api.solo({ name: 'Practice One', passcode: PASS })).ok).toBe(true)
    // A wrong try here never slows a facilitator's sign-in.
    const t0 = Date.now()
    await hostToken(srv.url)
    expect(Date.now() - t0).toBeLessThan(900)
    // A passcode of its own: six characters or more, and the facilitator passcode no longer opens a game.
    expect((await post(srv, '/api/host/solo', { gate: 'custom', passcode: 'abc' }, token)).status).toBe(400)
    expect((await post(srv, '/api/host/solo', { gate: 'elsewhere' }, token)).status).toBe(400)
    expect((await post(srv, '/api/host/solo', { gate: 'custom', passcode: 'after the lab' })).status).toBe(401)
    expect(await (await post(srv, '/api/host/solo', { gate: 'custom', passcode: 'after the lab' }, token)).json()).toEqual({ enabled: true, gate: 'custom' })
    expect(await gate()).toBe('custom')
    expect(await srv.api.solo({ name: 'Practice Two', passcode: PASS })).toMatchObject({ ok: false, status: 401, error: 'wrong_passcode' })
    expect((await srv.api.solo({ name: 'Practice Two', passcode: ' after the lab ' })).ok).toBe(true)
    // Anybody.
    expect(await (await post(srv, '/api/host/solo', { gate: 'none' }, token)).json()).toEqual({ enabled: true, gate: 'none' })
    expect(await open()).toBe(false)
    expect((await srv.api.solo({ name: 'Practice Three' })).ok).toBe(true)
    // The switch and the passcode are set apart or together.
    expect(await (await post(srv, '/api/host/solo', { enabled: false, gate: 'facilitator' }, token)).json()).toEqual({ enabled: false, gate: 'facilitator' })
  }, 30_000)

  it('holds a limited number in memory', async () => {
    const srv = await server({ soloMax: 1 })
    expect((await srv.api.solo({ passcode: PASS, name: 'Practice One' })).ok).toBe(true)
    expect(await srv.api.solo({ passcode: PASS, name: 'Practice Two' })).toMatchObject({ ok: false, status: 503, error: 'solo_full' })
  })

  it('is a room of its own with no facilitator, driven by its player from the lobby to the report card', async () => {
    const srv = await server({ soloSweepMs: 40 })
    const token = await hostToken(srv.url)
    const bot = await solo(srv, 'Alone Branch')
    const code = codeOf(bot)
    const room = srv.app.manager.get(code)!
    expect(srv.app.db.session(code)).toMatchObject({ kind: 'solo', created_by: 'Alone Branch', mode: 'rehearsal' })
    expect(room.state.label).toBe('Single player')
    // It is nobody else's: no second player, no console, no projector, and the root of the site does not lead to it.
    const info = await srv.api.session(code)
    expect(info.ok && info.data).toMatchObject({ kind: 'solo', joinOpen: false })
    expect(await srv.api.join({ code, name: 'A Stranger' })).toMatchObject({ ok: false, error: 'join_closed' })
    expect((await post(srv, '/api/host/screen-link', { code }, token)).status).toBe(404)
    const host = hostConn(srv.ws, token, code)
    cleanups.push(() => host.close())
    await until(() => host.status === 'ended', 5000, 'the console is refused')
    const open = await srv.api.open()
    expect(open.ok && open.data.session).toBeNull()
    expect((await fetch(`${srv.url}/api/board/${code}`)).status).toBe(404)

    // The lobby waits for the player, and so does every slide.
    expect(view(bot).solo).toEqual({ next: 'intro', timed: false, slide: null })
    expect((await bot.conn.command('solo.end_now')).error).toBe('wrong_stage')
    await soloTo(bot, 'planning.play')
    expect(room.state.shown!.length).toBeGreaterThan(1)
    expect(view(bot).solo).toEqual({ next: null, timed: true, slide: null })
    expect((await bot.conn.command('solo.next')).error).toBe('wrong_stage')

    // The clock stands still while the player is away, and runs again when they are back.
    expect(room.clockInfo().running).toBe(true)
    bot.conn.close()
    await until(() => !room.clockInfo().running, 5000, 'the clock stops')
    const at = room.clockInfo().gameMs
    await sleep(120)
    expect(room.clockInfo().gameMs).toBe(at)
    const back = attach(srv.ws, bot.token, { playerId: bot.playerId, rejoinCode: bot.rejoinCode })
    cleanups.push(() => back.conn.close())
    await until(() => back.stage === 'planning.play' && room.clockInfo().running, 5000, 'the clock runs again')

    await soloTo(back, 'winners')
    expect(view(back).reportCard?.final).toBe(true)
    expect(view(back).solo).toEqual({ next: 'closed', timed: false, slide: null })
    expect((await back.conn.command('solo.next')).ok).toBe(true)
    // Ended and stored, it leaves the memory, and its player is told that the session is over.
    await until(() => srv.app.manager.get(code) === undefined, 5000, 'the room leaves the memory')
    await until(() => back.status === 'ended', 5000, 'the player is told')
    expect(srv.app.db.session(code)!.closed).not.toBeNull()

    // What the browser kept brings the game back: its card, and every phase to look at again.
    const kept = await srv.api.results({ games: [{ session: code, rejoinCode: bot.rejoinCode }, { session: 'NOPE12', rejoinCode: 'ABCDEF' }, { session: code, rejoinCode: 'WRONG2' }] })
    expect(kept.ok).toBe(true)
    const games = (kept as { data: { games: GameSummary[] } }).data.games
    expect(games).toHaveLength(1)
    expect(games[0]).toMatchObject({ session: code, kind: 'solo', open: false, stage: 'closed', name: 'Alone Branch', review: true })
    expect(games[0]!.card!.final).toBe(true)
    expect(games[0]!.startedAtMs).toBe(srv.app.db.session(code)!.created)

    const review = await srv.api.review({ session: code, rejoinCode: bot.rejoinCode })
    expect(review.ok).toBe(true)
    const r = (review as { data: { card: unknown; review: Review } }).data
    expect(Review.safeParse(r.review).success).toBe(true)
    expect(r.card).not.toBeNull()
    expect(r.review.session).toMatchObject({ code, kind: 'solo' })
    expect(r.review.content.map((c) => c.phase)).toEqual(['planning', 'development', 'maintaining'])
    expect(r.review.view.planning!.reveal).not.toBeNull()
    expect(r.review.view.maintaining!.reveal).not.toBeNull()
    expect(r.review.view).toMatchObject({ slide: null, solo: null, waiting: null })
    expect(await srv.api.review({ session: code, rejoinCode: 'WRONG2' })).toMatchObject({ ok: false, status: 404 })
    // One shared part is kept, the one of the whole game, and one snapshot.
    expect((srv.app.db.db.prepare('SELECT COUNT(*) AS n FROM review_base WHERE code = ?').get(code) as { n: number }).n).toBe(1)
    expect((srv.app.db.db.prepare('SELECT COUNT(*) AS n FROM snapshot WHERE code = ?').get(code) as { n: number }).n).toBe(1)
  })

  it('refuses the commands of a single-player game in a session with a facilitator', async () => {
    const srv = await server()
    const made = srv.app.manager.create('With a facilitator', 'test', { code: 'MULTI1' })
    if (!made.ok) throw new Error(made.error)
    const bot = await joinBot(srv, 'MULTI1', 'Practice One')
    cleanups.push(() => bot.conn.close())
    await until(() => bot.stage === 'lobby')
    expect(view(bot).solo).toBeNull()
    for (const type of ['solo.next', 'solo.end_now']) expect((await bot.conn.command(type)).error).toBe('not_solo')
    expect((await bot.conn.command('solo.slide', { delta: 1 })).error).toBe('not_solo')
    expect((await bot.conn.command('solo.speed', { speed: 2 })).error).toBe('not_solo')
    expect(made.room.clockInfo().scale).toBe(srv.app.pack.game.clock.time_scale_default)
    expect(made.room.state.stage).toBe('lobby')
  })

  it('runs its clock at the speed its player sets, keeps the speed while the player is away, and takes no other speed', async () => {
    const srv = await server({ soloSweepMs: 40, soloIdleMs: 150 })
    const bot = await solo(srv, 'Fast Branch')
    const code = codeOf(bot)
    await soloTo(bot, 'planning.play')
    const room = () => srv.app.manager.get(code)!
    expect(room().clockInfo().scale).toBe(1)
    for (const speed of [3, 0, -1, 100, '2']) expect((await bot.conn.command('solo.speed', { speed })).error).toBe('bad_message')
    expect(room().clockInfo().scale).toBe(1)
    // Four times as fast: the clock of the game gains about four seconds in one.
    expect((await bot.conn.command('solo.speed', { speed: 4 })).ok).toBe(true)
    expect(room().clockInfo()).toMatchObject({ running: true, scale: 4 })
    const from = room().now()
    await sleep(500)
    const gained = room().now() - from
    expect(gained).toBeGreaterThan(1600)
    expect(gained).toBeLessThan(3200)
    // The engine does not know the speed: the state of the game holds no trace of it.
    expect(JSON.stringify(room().state)).not.toMatch(/"(scale|speed)"/)
    // Set aside and back: the same speed.
    bot.conn.close()
    await until(() => srv.app.manager.get(code) === undefined, 5000, 'set aside')
    const back = attach(srv.ws, bot.token, { playerId: bot.playerId, rejoinCode: bot.rejoinCode })
    cleanups.push(() => back.conn.close())
    await until(() => back.stage === 'planning.play', 5000, 'back in the game')
    expect(room().clockInfo()).toMatchObject({ running: true, scale: 4 })
    expect((await back.conn.command('solo.speed', { speed: 0.25 })).ok).toBe(true)
    expect(room().clockInfo().scale).toBe(0.25)
  })

  it('is set aside when its player stays away, and comes back as it was', async () => {
    const srv = await server({ soloSweepMs: 40, soloIdleMs: 150 })
    const bot = await solo(srv, 'Away Branch')
    const code = codeOf(bot)
    await soloTo(bot, 'planning.play')
    const content = await srv.api.content(bot.token, 'planning')
    expect(content.ok).toBe(true)
    const inv = (content as { data: { investigations: { id: string }[] } }).data.investigations[0]!.id
    expect((await bot.conn.command('planning.investigate', { id: inv })).ok).toBe(true)
    bot.conn.close()
    await until(() => srv.app.manager.get(code) === undefined, 5000, 'set aside')
    // Still open: the browser's list says the game can be gone back into.
    expect(srv.app.db.session(code)).toMatchObject({ closed: null, stage: 'planning.play' })
    const kept = await srv.api.results({ games: [{ session: code, rejoinCode: bot.rejoinCode }] })
    expect((kept as { data: { games: GameSummary[] } }).data.games[0]).toMatchObject({ open: true, stage: 'planning.play', name: 'Away Branch', card: null, review: false })
    expect(srv.app.manager.get(code)).toBeUndefined()

    const back = attach(srv.ws, bot.token, { playerId: bot.playerId, rejoinCode: bot.rejoinCode })
    cleanups.push(() => back.conn.close())
    await until(() => back.stage === 'planning.play', 5000, 'back in the game')
    const room = srv.app.manager.get(code)!
    expect(room.clockInfo().running).toBe(true)
    const p = view(back).planning!
    expect([...p.running.map((x) => x.id), ...p.tiles.map((x) => x.investigation)]).toContain(inv)
    // From another browser the rejoin code brings it back too.
    back.conn.close()
    await until(() => srv.app.manager.get(code) === undefined, 5000, 'set aside again')
    const rejoined = await srv.api.rejoin({ code, rejoinCode: bot.rejoinCode })
    expect(rejoined.ok).toBe(true)
    expect(srv.app.manager.get(code)).toBeDefined()
  })

  it('is listed for the facilitator, deleted one at a time or all at once, and a session with a facilitator is not touched', async () => {
    const srv = await server({ soloSweepMs: 40 })
    const token = await hostToken(srv.url)
    const multi = srv.app.manager.create('Stays', 'test', { code: 'STAYS1' })
    expect(multi.ok).toBe(true)
    const a = await solo(srv, 'First Branch')
    const b = await solo(srv, 'Second Branch')
    await soloTo(a, 'planning.reveal')
    const list = async () => (await (await fetch(`${srv.url}/api/host/sessions`, { headers: json(token) })).json()) as { sessions: { code: string }[]; solo: { enabled: boolean; total: number; finished: number; unfinished: number; live: number; cap: number; recent: Record<string, unknown>[] } }
    const before = await list()
    expect(before.sessions.map((s) => s.code)).toEqual(['STAYS1'])
    expect(before.solo).toMatchObject({ enabled: true, total: 2, finished: 0, unfinished: 2, live: 2, cap: srv.app.config.soloMax })
    // The list is for deleting: whose game, since when, over or not. Nothing about how it goes.
    expect(before.solo.recent).toEqual([
      { code: codeOf(b), name: 'Second Branch', createdAt: srv.app.db.session(codeOf(b))!.created, closed: false, live: true },
      { code: codeOf(a), name: 'First Branch', createdAt: srv.app.db.session(codeOf(a))!.created, closed: false, live: true },
    ])
    for (const what of ['results', 'cards', 'commands']) expect((await fetch(`${srv.url}/api/host/export/${codeOf(a)}?what=${what}`, { headers: json(token) })).status).toBe(404)
    expect((await fetch(`${srv.url}/api/host/deck/${codeOf(a)}`, { headers: json(token) })).status).toBe(404)

    // One game, while it is being played: it ends and goes in one step.
    expect((await fetch(`${srv.url}/api/host/session/${codeOf(b)}`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } })).status).toBe(200)
    await until(() => b.status === 'ended', 5000, 'its player is told')
    expect(srv.app.db.session(codeOf(b))).toBeUndefined()

    expect(await (await post(srv, '/api/host/solo/delete-all', { confirm: 'delete' }, token)).json()).toEqual({ error: 'confirm_delete' })
    expect((await post(srv, '/api/host/solo/delete-all', { confirm: 'DELETE' })).status).toBe(401)
    await solo(srv, 'Third Branch')
    expect(await (await post(srv, '/api/host/solo/delete-all', { confirm: 'DELETE' }, token)).json()).toEqual({ deleted: 2 })
    const after = await list()
    expect(after.solo).toMatchObject({ total: 0, live: 0 })
    expect(after.sessions.map((s) => s.code)).toEqual(['STAYS1'])
    expect(srv.app.manager.get('STAYS1')!.state.closed).toBe(false)
    for (const t of ['auth', 'command', 'snapshot', 'result', 'review_base', 'clock']) {
      expect((srv.app.db.db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE code = ?`).get(codeOf(a)) as { n: number }).n).toBe(0)
    }
    const gone = await srv.api.results({ games: [{ session: codeOf(a), rejoinCode: a.rejoinCode }] })
    expect((gone as { data: { games: GameSummary[] } }).data.games).toEqual([])
  })
})

describe('a late joiner', () => {
  it('waits for the next phase with the leaderboard and the slides shown so far, and enters when it starts', async () => {
    const srv = await server()
    const token = await hostToken(srv.url)
    const made = srv.app.manager.create('Late', 'test', { code: 'LATE01' })
    if (!made.ok) throw new Error(made.error)
    const room = made.room
    const host = hostConn(srv.ws, token, 'LATE01')
    cleanups.push(() => host.close())
    await until(() => host.status === 'open')
    const first = await joinBot(srv, 'LATE01', 'On Time Branch')
    cleanups.push(() => first.conn.close())
    await step(srv.app, host, 'LATE01')
    expect((await host.command('slide', { delta: 1 })).ok).toBe(true)
    await step(srv.app, host, 'LATE01')
    expect(room.state.stage).toBe('planning.play')

    const info = await srv.api.session('LATE01')
    expect(info.ok && info.data).toMatchObject({ joinOpen: true, joinWaits: true, kind: 'multi' })
    const late = await joinBot(srv, 'LATE01', 'Late Branch')
    cleanups.push(() => late.conn.close())
    await until(() => late.stage === 'planning.play' && late.messages.some((m) => m.t === 'standing'))
    expect(view(late).planning).toBeNull()
    expect(view(late).waiting!.phase).toBe('planning')
    expect(view(late).waiting!.slides.map((s) => s.index)).toEqual(room.state.shown)
    expect(view(late).waiting!.slides.length).toBe(2)
    expect(view(first).waiting).toBeNull()
    const standing = (JSON.parse(late.messages.filter((m) => m.t === 'standing').at(-1)!.raw) as { standing: Standing }).standing
    expect(standing.board.columns.planning.rows.map((r) => r.name)).toContain('On Time Branch')
    expect((await late.conn.command('planning.submit')).error).toBe('wrong_stage')

    // The phase ends: 0 points for it, still in the waiting room at its reveal, and in the game with Phase 2.
    await step(srv.app, host, 'LATE01')
    await until(() => late.stage === 'planning.reveal')
    expect(view(late).points.planning).toMatchObject({ points: 0 })
    expect(view(late).waiting!.phase).toBe('planning')
    await step(srv.app, host, 'LATE01')
    await step(srv.app, host, 'LATE01')
    await until(() => late.stage === 'development.play')
    expect(view(late).waiting).toBeNull()
    expect(view(late).development).not.toBeNull()

    // Once the last phase runs nobody joins. The leaderboard is there for who stands outside.
    while (room.state.stage !== 'maintaining.year') await step(srv.app, host, 'LATE01')
    const closed = await srv.api.session('LATE01')
    expect(closed.ok && closed.data).toMatchObject({ joinOpen: false, joinWaits: false })
    expect(await srv.api.join({ code: 'LATE01', name: 'Too Late Branch' })).toMatchObject({ ok: false, error: 'join_closed' })
    const board = await srv.api.board('LATE01')
    expect(board.ok && board.data.board.columns.overall.rows.map((r) => r.name).sort()).toEqual(['Late Branch', 'On Time Branch'])
  })
})

describe('a game to look at again', () => {
  it('is stored when a phase is scored, a few practices at a time, and answers after a restart', async () => {
    const srv = await server()
    const token = await hostToken(srv.url)
    const made = srv.app.manager.create('Review', 'test', { code: 'REVW01' })
    if (!made.ok) throw new Error(made.error)
    const host = hostConn(srv.ws, token, 'REVW01')
    cleanups.push(() => host.close())
    await until(() => host.status === 'open')
    const bots: Bot[] = []
    for (let i = 0; i < 11; i++) bots.push(await joinBot(srv, 'REVW01', `Practice ${i + 1}`))
    cleanups.push(() => bots.forEach((b) => b.conn.close()))
    const stored = () => (srv.app.db.db.prepare('SELECT COUNT(review) AS n FROM result WHERE code = ?').get('REVW01') as { n: number }).n
    // Before a phase is scored there is nothing to look at.
    expect(await srv.api.review({ session: 'REVW01', rejoinCode: bots[0]!.rejoinCode })).toMatchObject({ ok: false, status: 404 })
    while (made.room.state.stage !== 'planning.reveal') await step(srv.app, host, 'REVW01')
    await until(() => stored() === 11, 5000, 'every practice stored')
    // The part that the practices of a health system share is stored once for each system.
    expect((srv.app.db.db.prepare('SELECT COUNT(*) AS n FROM review_base WHERE code = ?').get('REVW01') as { n: number }).n).toBe(2)
    const live = await srv.api.review({ session: 'REVW01', rejoinCode: bots[3]!.rejoinCode })
    expect(live.ok && live.data.review.view.me.name).toBe('Practice 4')

    // The server stops with the session open, and comes back on other content: the session cannot
    // be opened again, and what was stored still answers.
    await srv.app.close()
    const { DatabaseSync } = await import('node:sqlite')
    const raw = new DatabaseSync(`${srv.dataDir}/lab02.sqlite`)
    raw.prepare("UPDATE session SET content_hash = 'older' WHERE code = 'REVW01'").run()
    raw.close()
    const srv2 = await server({}, srv.dataDir)
    expect(srv2.app.manager.get('REVW01')).toBeUndefined()
    const kept = await srv2.api.review({ session: 'REVW01', rejoinCode: bots[3]!.rejoinCode })
    expect(kept.ok).toBe(true)
    const r = (kept as { data: { card: { total: number } | null; review: Review } }).data
    expect(r.review.view.me.name).toBe('Practice 4')
    expect(r.review.view.planning!.reveal).not.toBeNull()
    expect(r.review.content.map((c) => c.phase)).toEqual(['planning'])
    expect(r.card).not.toBeNull()
    const list = await srv2.api.results({ games: [{ session: 'REVW01', rejoinCode: bots[3]!.rejoinCode }] })
    expect((list as { data: { games: GameSummary[] } }).data.games[0]).toMatchObject({ open: false, review: true, kind: 'multi', name: 'Practice 4' })
  })
})

