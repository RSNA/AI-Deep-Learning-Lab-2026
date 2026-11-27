// The projector's programme (engineering spec, section 6.13). While a phase is played, "Follow
// the game" rotates through a short list of views in a loop. The loop runs on seconds that
// every screen of the session agrees on, so the projector and the host's preview show the same.
import type { ProgrammeShow } from '@lab02/protocol'

export type ProgrammeItem = { show: ProgrammeShow; seconds: number }

/** The view that is on after `t` seconds, its place in the loop, and how often the loop has run. */
export function programmeSlot(programme: readonly ProgrammeItem[], t: number): { show: ProgrammeShow; index: number; round: number } {
  const total = programme.reduce((n, x) => n + Math.max(1, x.seconds), 0)
  if (programme.length === 0 || total <= 0) return { show: 'activity', index: 0, round: 0 }
  const at = Math.max(0, t)
  const round = Math.floor(at / total)
  let left = at - round * total
  for (let i = 0; i < programme.length; i++) {
    const len = Math.max(1, programme[i]!.seconds)
    if (left < len) return { show: programme[i]!.show, index: i, round }
    left -= len
  }
  return { show: programme[programme.length - 1]!.show, index: programme.length - 1, round }
}

/**
 * The practice a turn of the programme shows, or null when the turn shows something else or has
 * nobody. `player`: one practice at work, the next one each time the loop comes round. `news`:
 * a practice that got a letter of its own, and with no such practice another one at work, half
 * the list away from the one the `player` turn just showed.
 */
export function practiceTurn<T>(show: ProgrammeShow, round: number, cards: readonly T[], newsCards: readonly T[]): T | null {
  if (show === 'player') return cards.length ? cards[round % cards.length]! : null
  if (show !== 'news') return null
  if (newsCards.length) return newsCards[round % newsCards.length]!
  return cards.length ? cards[(round + Math.ceil(cards.length / 2)) % cards.length]! : null
}

/** How long ago something happened, in the words of the activity list. */
export function ago(seconds: number): string {
  if (seconds < 5) return 'now'
  if (seconds < 60) return `${Math.floor(seconds / 5) * 5} s ago`
  const m = Math.floor(seconds / 60)
  return `${m} min ago`
}
