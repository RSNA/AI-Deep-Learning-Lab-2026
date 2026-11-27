// npm run loadtest: bot clients play a whole game against a running server (engineering spec,
// section 12.7). One session with a facilitator, in which every bot plays the three phases
// through the public API, and beside it any number of single-player games. It measures what a
// player would feel: how long an answer to a command takes, and whether anybody is lost.
//
//   BASE=http://127.0.0.1:3000 PASS=<facilitator passcode> npm run loadtest
//
// Settings, all from the environment:
//   CLIENTS   players who join in the lobby (150)
//   LATE      players who join while Phase 1 and Phase 2 are played, half in each (10)
//   REFRESH   players who drop their connection in the middle of every phase and come back (10)
//   SOLO      single-player games played at the same time (0). The server allows 20 from one
//             address in ten minutes unless it runs with SOLO_PER_ADDRESS raised
//   SCALE     the game speed of the session (10). Use 1 for the real pace
//   EXTEND    seconds added in the last phase: 0, 30, 60 or 300 (0)
//   HOLD      seconds to stand still in the middle of Phase 2, with the game paused, so that the
//             server can be restarted by hand (0). Every client must come back by itself
//   KEEP      1 keeps the session. By default it is ended and deleted with its results
//
// It opens a rehearsal session, and a server that already has a session open ends that one: do
// not run it while a real session is played. It exits with 1 when a client was lost, a bot
// finished without a result, or the answers were slow.
import { GameConnection, playerApi } from '@lab02/protocol'
import { attach, hostConn, playDevelopment, playMaintaining, playPlanning, type Bot } from '../packages/server/test/bots.ts'

const env = process.env
const BASE = (env.BASE ?? 'http://127.0.0.1:3000').replace(/\/$/, '')
const PASS = env.PASS ?? ''
const num = (name: string, fallback: number) => (env[name] === undefined ? fallback : Number(env[name]))
const CLIENTS = num('CLIENTS', 150), LATE = num('LATE', 10), REFRESH = num('REFRESH', 10), SOLO = num('SOLO', 0)
const SCALE = num('SCALE', 10), EXTEND = num('EXTEND', 0), HOLD = num('HOLD', 0)
const ACK_P95_MS = num('ACK_P95_MS', 300)
const WS = `${BASE.replace(/^http/, 'ws')}/ws`
const api = playerApi(BASE)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a)
if (!PASS) { console.error('PASS is not set: the facilitator passcode of the server.'); process.exit(1) }

// ------------------------------------------------------------------------------------------
// What is measured
// ------------------------------------------------------------------------------------------
const acks: number[] = []
const refusals = new Map<string, number>()
const turnedAway = new Map<string, number>()
let commands = 0, reconnects = 0
/** Every command of a connection is timed from the moment it is sent to its answer. */
function timed(conn: GameConnection): void {
  const send = conn.command.bind(conn)
  conn.command = async (type: string, payload?: unknown) => {
    const t0 = performance.now()
    const r = await send(type, payload)
    acks.push(performance.now() - t0)
    commands++
    if (!r.ok) { const key = `${type} ${r.error ?? 'unknown'}`; refusals.set(key, (refusals.get(key) ?? 0) + 1) }
    return r
  }
  let opened = false
  conn.onStatus((s) => {
    if (s === 'open') { if (opened) reconnects++; opened = true }
    // A connection that the server turned away for good, apart from the end of the session.
    if (s === 'unauthorized' || s === 'superseded' || s === 'removed') turnedAway.set(s, (turnedAway.get(s) ?? 0) + 1)
    if (process.env.TRACE === '1') log('connection', s)
  })
}
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]! : 0 }

// ------------------------------------------------------------------------------------------
// The facilitator
// ------------------------------------------------------------------------------------------
async function hostJson<T>(path: string, token: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<{ status: number; data: T }> {
  const r = await fetch(BASE + path, { method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  return { status: r.status, data: (await r.json().catch(() => ({}))) as T }
}
const PLAY_STAGES = ['planning.play', 'development.play', 'maintaining.year']
const stageOf = async (code: string): Promise<string | null> => { const r = await api.session(code).catch(() => null); return r && r.ok ? r.data.stage : null }

/** A bot with the three players of the phases attached, so that it plays whatever stage it is in. */
function player(token: string, extra: Partial<Bot> = {}): Bot {
  const bot = attach(WS, token, extra)
  timed(bot.conn)
  playPlanning(bot, BASE, bots.length + 1)
  playDevelopment(bot, BASE)
  playMaintaining(bot, BASE, bots.length % 2 === 0)
  return bot
}
const bots: Bot[] = []
async function join(code: string, name: string): Promise<boolean> {
  const r = await api.join({ code, name })
  if (!r.ok) { refusals.set(`join:${r.error}`, (refusals.get(`join:${r.error}`) ?? 0) + 1); return false }
  bots.push(player(r.data.token, { playerId: r.data.playerId, rejoinCode: r.data.rejoinCode }))
  return true
}

async function room(): Promise<{ code: string; lost: number; unscored: number }> {
  const token = (await hostJson<{ token: string }>('/api/host/login', '', { passcode: PASS })).data.token
  if (!token) throw new Error('The server refused the passcode.')
  const made = await hostJson<{ code: string }>('/api/host/session', token, { label: `Load test ${new Date().toISOString().slice(0, 16)}`, mode: 'rehearsal', by: 'Load test', replace: {} })
  const code = made.data.code
  if (!code) throw new Error(`The server did not open a session (${made.status}).`)
  const host = hostConn(WS, token, code)
  timed(host)
  /** A command of the facilitator. A console that came back after a restart takes charge again first. */
  const drive = async (type: string, payload: unknown = {}) => {
    let r = await host.command(type, payload)
    if (!r.ok && r.error === 'not_in_control') { await host.command('take_control', { passcode: PASS }); r = await host.command(type, payload) }
    return r
  }
  await drive('take_control', { passcode: PASS })
  await drive('set_scale', { scale: SCALE })
  log(`session ${code}: ${CLIENTS} players join`)
  for (let i = 0; i < CLIENTS; i += 25) {
    await Promise.all(Array.from({ length: Math.min(25, CLIENTS - i) }, (_x, k) => join(code, `Load ${String(i + k + 1).padStart(3, '0')}`)))
  }
  log(`${bots.length} joined`)

  let lateNumber = 0
  /** In the middle of a phase: late players join, a few players refresh, and one player types far too fast. */
  const middle = async (stage: string) => {
    await sleep(Math.max(1500, 20_000 / SCALE))
    if (stage !== 'maintaining.year') {
      const n = Math.floor(LATE / 2)
      const ok = await Promise.all(Array.from({ length: n }, () => join(code, `Late ${String(++lateNumber).padStart(2, '0')}`)))
      log(`${stage}: ${ok.filter(Boolean).length} of ${n} late players joined and wait`)
    }
    for (const b of bots.slice(0, REFRESH)) {
      // A refresh: the page goes, and the same browser comes back with its token.
      b.conn.close()
      const at = bots.indexOf(b)
      bots[at] = player(b.token, { playerId: b.playerId, rejoinCode: b.rejoinCode })
    }
    if (REFRESH) log(`${stage}: ${Math.min(REFRESH, bots.length)} players refreshed`)
    if (stage === 'planning.play' && bots[REFRESH]) {
      const fast = await Promise.all(Array.from({ length: 40 }, () => bots[REFRESH]!.conn.command('planning.set_report', { picks: {} })))
      log(`${stage}: a player sent 40 commands at once, ${fast.filter((r) => !r.ok && r.error === 'rate_limited').length} were turned away, and the connection is ${bots[REFRESH]!.status}`)
    }
    if (stage === 'development.play' && HOLD) {
      await drive('pause')
      log(`paused for ${HOLD} seconds: restart the server now`)
      await sleep(HOLD * 1000)
      for (let i = 0; i < 60 && (await stageOf(code)) === null; i++) await sleep(1000)
      log('resume', JSON.stringify(await drive('resume')))
    }
    if (stage === 'maintaining.year' && EXTEND) log(`added ${EXTEND} seconds`, JSON.stringify(await drive('extend', { seconds: EXTEND })))
  }

  let stage = await stageOf(code)
  let seen = ''
  for (let guard = 0; stage !== 'winners' && stage !== 'closed' && guard < 100_000; guard++) {
    if (stage !== null && stage !== seen) {
      seen = stage
      log(`stage ${stage}`)
      if (PLAY_STAGES.includes(stage)) await middle(stage)
      else { await sleep(1000); await drive('next') }
    } else await sleep(500)
    stage = await stageOf(code)
  }
  // Everybody should hold a result of the last phase, and every connection should be open.
  await sleep(2000)
  const lost = bots.filter((b) => b.status !== 'open').length
  const unscored = bots.filter((b) => (b.view as { points?: { maintaining?: number | null } } | null)?.points?.maintaining == null).length
  const closed = await drive('close', { confirm: code })
  log(`session closed: ${closed.ok}`)
  for (const b of bots) b.conn.close()
  host.close()
  if (env.KEEP !== '1') log(`session deleted: ${(await hostJson(`/api/host/session/${code}`, token, undefined, 'DELETE')).status}`)
  return { code, lost, unscored }
}

// ------------------------------------------------------------------------------------------
// Single-player games
// ------------------------------------------------------------------------------------------
/** One game from its start to its report card. The player moves it on, and ends each phase after a while. */
async function solo(n: number): Promise<'done' | string> {
  const r = await api.solo({ name: `Solo load ${String(n).padStart(3, '0')}` })
  if (!r.ok) return `start:${r.error}`
  const bot = player(r.data.token, { playerId: r.data.playerId, rejoinCode: r.data.rejoinCode })
  const playFor = Math.max(4000, 60_000 / SCALE)
  for (let i = 0; i < 400; i++) {
    await sleep(400)
    const v = bot.view as { stage?: string; solo?: { next: string | null; timed: boolean; slide: { last: boolean } | null } | null } | null
    if (!v?.solo) { if (v?.stage === 'closed') break; continue }
    if (v.solo.timed) { await sleep(playFor); await bot.conn.command('solo.end_now', {}); continue }
    if (v.solo.slide && !v.solo.slide.last) { await bot.conn.command('solo.slide', { delta: 1 }); continue }
    if (v.solo.next) await bot.conn.command('solo.next', {})
  }
  const stage = (bot.view as { stage?: string } | null)?.stage
  const card = await api.result({ session: r.data.session, rejoinCode: r.data.rejoinCode })
  bot.conn.close()
  return stage === 'closed' && card.ok ? 'done' : `ended at ${stage ?? 'nothing'}${card.ok ? '' : ', no report card'}`
}

// ------------------------------------------------------------------------------------------
const t0 = Date.now()
const health = async () => (await fetch(`${BASE}/healthz`).then((r) => r.json()).catch(() => null)) as { build?: string; content?: string; uptime?: number } | null
const before = await health()
log(`server ${BASE}: build ${before?.build}, content ${before?.content}. ${CLIENTS} players, ${LATE} late, ${REFRESH} refresh, ${SOLO} single-player games, speed ${SCALE}`)
const [game, solos] = await Promise.all([
  CLIENTS > 0 ? room() : Promise.resolve({ code: '', lost: 0, unscored: 0 }),
  Promise.all(Array.from({ length: SOLO }, async (_x, i) => { await sleep(i * 250); return solo(i + 1).catch((e: unknown) => `failed: ${String(e).slice(0, 80)}`) })),
])
const after = await health()
const soloBad = solos.filter((x) => x !== 'done')
const p95 = pct(acks, 95)
console.log('\n--- load test ---')
console.log(`time                 ${Math.round((Date.now() - t0) / 1000)} s`)
console.log(`players              ${bots.length} (${game.lost} lost, ${game.unscored} without a result of Phase 3)`)
console.log(`single-player games  ${SOLO} (${soloBad.length} not finished${soloBad.length ? `: ${[...new Set(soloBad)].slice(0, 4).join('; ')}` : ''})`)
console.log(`commands             ${commands}, answered in ${pct(acks, 50).toFixed(0)} ms (median), ${p95.toFixed(0)} ms (95th), ${pct(acks, 99).toFixed(0)} ms (99th), ${Math.max(0, ...acks).toFixed(0)} ms (slowest)`)
console.log(`refused              ${[...refusals].map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`)
console.log(`reconnects           ${reconnects}${turnedAway.size ? `, turned away: ${[...turnedAway].map(([k, v]) => `${k} ${v}`).join(', ')}` : ''}`)
// A server that was up for the whole run has aged by the length of the run.
console.log(`server restarted     ${before?.uptime !== undefined && after?.uptime !== undefined && after.uptime < before.uptime + (Date.now() - t0) / 1000 - 5 ? 'yes' : 'no'}`)
const failed = game.lost > 0 || game.unscored > 0 || soloBad.length > 0 || p95 > ACK_P95_MS
console.log(failed ? 'FAILED' : 'PASSED')
process.exit(failed ? 1 : 0)
