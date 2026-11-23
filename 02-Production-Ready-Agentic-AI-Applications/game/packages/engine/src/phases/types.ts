import type { Pack } from '@lab02/content-schema'
import type { AckData, ErrorCode, PhaseId } from '@lab02/protocol'
import type { EngineEvent, FeedEntry, GameMs, Outcome, PlayerCard, PlayerState, SessionState } from '../state.ts'

export type CommandHandler = (
  s: SessionState, pack: Pack, p: PlayerState, payload: unknown, now: GameMs,
) => (Outcome & { ok: true }) | { ok: false; error: ErrorCode; data?: AckData }

/** What each phase adds to the engine. The foundation builds every phase as a stub. */
export type PhaseModule = {
  phase: PhaseId
  /** False while the phase is a stub: it opens and closes but has no rules yet. */
  implemented: boolean
  /** Give a player the state of the phase, at its opening or when they join during it. */
  open(s: SessionState, pack: Pack, p: PlayerState, now: GameMs): void
  /** Raw score of the player when the phase closes. */
  close(s: SessionState, pack: Pack, p: PlayerState, now: GameMs): number
  /** The player's value in the live leaderboard column. */
  liveValue(s: SessionState, pack: Pack, p: PlayerState): number
  /** The largest value the live column can reach, when it has one ("17 of 22"). */
  liveMax?(pack: Pack): number | null
  /** The earliest timer of this player that has not run yet, or null. */
  nextDue?(s: SessionState, pack: Pack, p: PlayerState): GameMs | null
  /** Run the timers of this player that are due at or before `at`, in order. */
  fire?(s: SessionState, pack: Pack, p: PlayerState, at: GameMs): EngineEvent[]
  /** What this player did in the phase, for the projector. Public wording only (section 6.13). */
  feed?(s: SessionState, pack: Pack, p: PlayerState): FeedEntry[]
  /** What the projector may show of this player during play: what runs and how far they are. */
  card?(s: SessionState, pack: Pack, p: PlayerState): PlayerCard
  commands: Record<string, CommandHandler>
}
