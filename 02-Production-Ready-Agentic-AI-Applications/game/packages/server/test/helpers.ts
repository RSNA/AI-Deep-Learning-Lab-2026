import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GameConnection, playerApi, type ConnStatus } from '@lab02/protocol'
import { createApp, type App } from '../src/index.ts'

export const DEMO = fileURLToPath(new URL('../../../content-demo', import.meta.url))

export async function startServer(opts: { dataDir?: string; contentDir?: string; systems?: string[] } = {}) {
  const dataDir = opts.dataDir ?? mkdtempSync(join(tmpdir(), 'lab02-db-'))
  const app = createApp({ dataDir, port: 0, host: '127.0.0.1', logLevel: 'silent', contentDir: opts.contentDir ?? DEMO, tickMs: 20, hostPasscode: 'test-passcode', systems: opts.systems })
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
