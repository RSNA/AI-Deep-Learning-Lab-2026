import { fileURLToPath } from 'node:url'
import { loadPack, type Pack } from '@lab02/content-schema'
import { advance, apply, createSession, type Command, type SessionState } from '../src/index.ts'

export const DEMO_DIR = fileURLToPath(new URL('../../../content-demo', import.meta.url))

let cached: Pack | null = null
export function demoPack(): Pack {
  if (cached) return cached
  const r = loadPack(DEMO_DIR)
  if (!r.ok) throw new Error(JSON.stringify(r.errors))
  cached = r.pack
  return cached
}

export function newSession(mode: 'test' | 'rehearsal' | 'event' = 'test'): SessionState {
  return createSession(demoPack(), { code: 'TEST01', label: 'Test', mode })
}

export function run(s: SessionState, cmd: Command, now: number) {
  const pack = demoPack()
  advance(s, pack, now)
  return apply(s, pack, cmd, now)
}

export const join = (s: SessionState, id: string, name: string, now = 0, avatar: string | null = null) =>
  run(s, { actor: 'system', type: 'join', payload: { playerId: id, name, avatar } }, now)

export const host = (s: SessionState, type: string, payload: unknown = {}, now = 0) =>
  run(s, { actor: 'host', type, payload }, now)
