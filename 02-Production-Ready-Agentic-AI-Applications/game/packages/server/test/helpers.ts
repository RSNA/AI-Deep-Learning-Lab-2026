import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { playerApi, type GameConnection } from '@lab02/protocol'
import { createApp, type App, type Config } from '../src/index.ts'

export { attach, hostConn, joinBot, playDevelopment, playMaintaining, playPlanning, type Bot } from './bots.ts'

export const DEMO = fileURLToPath(new URL('../../../content-demo', import.meta.url))

export async function startServer(opts: { dataDir?: string; contentDir?: string; systems?: string[]; wallNow?: () => number; answerKeyFile?: string; config?: Partial<Config> } = {}) {
  const dataDir = opts.dataDir ?? mkdtempSync(join(tmpdir(), 'lab02-db-'))
  const app = createApp({ dataDir, port: 0, host: '127.0.0.1', logLevel: 'silent', contentDir: opts.contentDir ?? DEMO, tickMs: 20, hostPasscode: 'test-passcode', systems: opts.systems, ...(opts.wallNow ? { wallNow: opts.wallNow } : {}), ...(opts.answerKeyFile ? { answerKeyFile: opts.answerKeyFile } : {}), ...opts.config })
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

/** Drives the session to its next stage: end_now in a timed stage, next otherwise. */
export async function step(app: App, host: GameConnection, code: string): Promise<void> {
  const room = app.manager.get(code)!
  const r = await host.command(room.state.stageEndsAtMs !== null ? 'end_now' : 'next')
  if (!r.ok) throw new Error(`host command refused: ${r.error}`)
}
