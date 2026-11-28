// Who may start a single-player game (engineering spec, section 7.2), kept as two settings of the
// database. `facilitator` (the default) asks for the facilitator passcode, so that nobody outside
// plays before an event. `custom` asks for a passcode of its own. `none` asks for nothing.
//
// A passcode of its own is kept as its hash, which is what a start is checked against, and as
// its text, because a slide of the deck may show the room which passcode to use (`solo_passcode`
// in the deck). It is a word for a room full of people and not a secret of the server.
import { hashToken } from './auth.ts'
import type { Config } from './config.ts'
import type { Storage } from './db.ts'

const GATE = 'solo_gate'
const GATE_TEXT = 'solo_gate_text'

export type SoloGate = { mode: 'facilitator' | 'custom' | 'none'; hash: string | null }

export function soloGate(db: Storage): SoloGate {
  const v = db.setting(GATE)
  if (v === 'none') return { mode: 'none', hash: null }
  if (v?.startsWith('custom:')) return { mode: 'custom', hash: v.slice(7) }
  return { mode: 'facilitator', hash: null }
}

/** `passcode` is the text of a passcode of its own, and is ignored for the two other choices. */
export function setSoloGate(db: Storage, mode: SoloGate['mode'], passcode = ''): void {
  db.setSetting(GATE, mode === 'custom' ? `custom:${hashToken(passcode)}` : mode)
  db.setSetting(GATE_TEXT, mode === 'custom' ? passcode : '')
}

/**
 * The passcode that a single-player game asks for right now, as a slide shows it: the
 * facilitator passcode, the passcode of its own, or null when anybody may play. Null as well for
 * a passcode of its own that was set before its text was kept.
 */
export function soloPasscodeAsked(db: Storage, config: Config): string | null {
  const gate = soloGate(db)
  if (gate.mode === 'none') return null
  if (gate.mode === 'facilitator') return config.hostPasscode
  return db.setting(GATE_TEXT) || null
}
