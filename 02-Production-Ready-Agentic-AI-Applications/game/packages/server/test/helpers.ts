import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GameConnection, playerApi, type CanvasMap, type ConnStatus, type DevelopmentContent, type DevelopmentView, type PlanningContent } from '@lab02/protocol'
import { createApp, type App } from '../src/index.ts'

export const DEMO = fileURLToPath(new URL('../../../content-demo', import.meta.url))

export async function startServer(opts: { dataDir?: string; contentDir?: string; systems?: string[]; wallNow?: () => number; answerKeyFile?: string } = {}) {
  const dataDir = opts.dataDir ?? mkdtempSync(join(tmpdir(), 'lab02-db-'))
  const app = createApp({ dataDir, port: 0, host: '127.0.0.1', logLevel: 'silent', contentDir: opts.contentDir ?? DEMO, tickMs: 20, hostPasscode: 'test-passcode', systems: opts.systems, ...(opts.wallNow ? { wallNow: opts.wallNow } : {}), ...(opts.answerKeyFile ? { answerKeyFile: opts.answerKeyFile } : {}) })
  const url = await app.listen()
  return { app, url, ws: `${url.replace('http', 'ws')}/ws`, dataDir, api: playerApi(url), cleanup: () => rmSync(dataDir, { recursive: true, force: true }) }
}

export async function hostToken(url: string): Promise<string> {
  const r = await fetch(`${url}/api/host/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ passcode: 'test-passcode' }) })
  return ((await r.json()) as { token: string }).token
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function until(cond: () => boolean, ms = 10_000, what = 'condition'): Promise<void> {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`)
    await sleep(15)
  }
}

export type Bot = {
  conn: GameConnection
  token: string
  playerId: string
  rejoinCode: string
  stage: string | null
  view: Record<string, unknown> | null
  messages: { t: string; raw: string }[]
  status: ConnStatus
}

export function attach(ws: string, token: string, extra: Partial<Bot> = {}): Bot {
  const conn = new GameConnection({ url: ws, token, build: 'bot', minDelayMs: 20, maxDelayMs: 100 })
  const bot: Bot = { conn, token, playerId: '', rejoinCode: '', stage: null, view: null, messages: [], status: 'connecting', ...extra }
  conn.on('*', (m) => {
    bot.messages.push({ t: m.t, raw: JSON.stringify(m) })
    const v = (m as { view?: { stage?: string } }).view
    if ((m.t === 'welcome' || m.t === 'view') && v) { bot.view = v as Record<string, unknown>; bot.stage = v.stage ?? bot.stage }
  })
  conn.onStatus((s) => { bot.status = s })
  return bot
}

export async function joinBot(srv: { api: ReturnType<typeof playerApi>; ws: string }, code: string, name: string): Promise<Bot> {
  const r = await srv.api.join({ code, name })
  if (!r.ok) throw new Error(`join failed: ${r.error}`)
  return attach(srv.ws, r.data.token, { playerId: r.data.playerId, rejoinCode: r.data.rejoinCode })
}

export function hostConn(ws: string, token: string, code: string): GameConnection {
  return new GameConnection({ url: ws, token, build: 'bot', session: code, commandFrame: 'hostcmd', minDelayMs: 20, maxDelayMs: 100 })
}

/** Drives the session to its next stage: end_now in a timed stage, next otherwise. */
export async function step(app: App, host: GameConnection, code: string): Promise<void> {
  const room = app.manager.get(code)!
  const r = await host.command(room.state.stageEndsAtMs !== null ? 'end_now' : 'next')
  if (!r.ok) throw new Error(`host command refused: ${r.error}`)
}

/**
 * A bot that plays Phase 1 the way a player could: it fetches the content when the phase
 * opens, starts every investigation that fits its free bandwidth, and keeps a board that fills
 * the spots in pack order with a shuffle seeded by its name.
 */
export function playPlanning(bot: Bot, base: string, seed = 1): () => void {
  let content: PlanningContent | null = null
  let fetching = false
  let boardSent = false
  let x = seed >>> 0
  const rand = () => { x = (Math.imul(x ^ (x >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0; return x / 2 ** 32 }
  let last: unknown = null
  const act = (msg?: unknown) => {
    const fromMsg = (msg as { view?: unknown } | undefined)?.view
    if (fromMsg) last = fromMsg
    const v = (last ?? bot.view) as { stage?: string; planning?: { status: string; bandwidthFree: number; running: { id: string }[]; tiles: { investigation: string }[] } | null } | null
    if (!v || v.stage !== 'planning.play' || !v.planning || v.planning.status !== 'playing') return
    if (!content) {
      if (fetching) return
      fetching = true
      void playerApi(base).content(bot.token, 'planning').then((r) => { fetching = false; if (r.ok && r.data.phase === 'planning') { content = r.data; act() } })
      return
    }
    const started = new Set([...v.planning.running.map((r) => r.id), ...v.planning.tiles.map((t) => t.investigation)])
    let free = v.planning.bandwidthFree
    for (const inv of content.investigations) {
      if (started.has(inv.id) || inv.bandwidth > free) continue
      free -= inv.bandwidth
      void bot.conn.command('planning.investigate', { id: inv.id })
    }
    if (!boardSent) {
      boardSent = true
      const spots = content.rules.classes.flatMap((c) => Array<string>(c.capacity).fill(c.id))
      for (let i = spots.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [spots[i], spots[j]] = [spots[j]!, spots[i]!] }
      const picks: Record<string, string> = {}
      content.problems.forEach((p, i) => { if (rand() > 0.15) picks[p.id] = spots[i]! })
      void bot.conn.command('planning.set_report', { picks })
    }
  }
  bot.conn.on('view', act)
  bot.conn.on('welcome', act)
  return act
}

/**
 * A bot that plays Phase 2 the way a player could: it starts every action it can afford, builds
 * one AI tile on every open source with the first model and place that fit, joins it to the
 * result, and validates whenever the map is ready and a validation is left.
 */
export function playDevelopment(bot: Bot, base: string): () => void {
  let content: DevelopmentContent | null = null
  let fetching = false
  let last: unknown = null
  let sentMap = ''
  const act = (msg?: unknown) => {
    const fromMsg = (msg as { view?: unknown } | undefined)?.view
    if (fromMsg) last = fromMsg
    const v = (last ?? bot.view) as { stage?: string; development?: DevelopmentView | null } | null
    const dv = v?.development
    if (!v || v.stage !== 'development.play' || !dv) return
    if (!content) {
      if (fetching) return
      fetching = true
      void playerApi(base).content(bot.token, 'development').then((r) => { fetching = false; if (r.ok && r.data.phase === 'development') { content = r.data; act() } })
      return
    }
    const open = new Set(dv.unlocked)
    let money = dv.money, free = dv.developers.free
    const busy = new Set([...dv.actionsDone, ...dv.actionsRunning].map((a) => a.id))
    for (const a of content.actions) {
      if (busy.has(a.id) || a.money > money || a.developers > free || a.requires.some((r) => !dv.actionsDone.some((d) => d.id === r))) continue
      money -= a.money; free -= a.developers
      void bot.conn.command('development.act', { id: a.id })
    }
    const w = content.workers.find((x) => x.needsModel && open.has(x.id))
    const m = w && content.models.find((x) => open.has(x.id) && w.models.includes(x.id) && x.runsOn.some((c) => open.has(c)))
    const c = m && m.runsOn.find((x) => open.has(x))
    if (w && m && c) {
      const map: CanvasMap = {
        tiles: [{ id: 't1', kind: w.id, col: 2, row: 2, model: m.id, runsOn: c, prompt: null }],
        lines: [...content.sources.filter((x) => open.has(x.id)).map((x) => ({ from: x.id, to: 't1' })), { from: 't1', to: content.result.id }],
      }
      const key = JSON.stringify(map)
      if (key !== sentMap) { sentMap = key; void bot.conn.command('development.set_map', { map }) }
    }
    if (dv.ready.ok && !dv.validating && dv.validationsLeft > 0) void bot.conn.command('development.validate', {})
  }
  bot.conn.on('view', act)
  bot.conn.on('welcome', act)
  return act
}
