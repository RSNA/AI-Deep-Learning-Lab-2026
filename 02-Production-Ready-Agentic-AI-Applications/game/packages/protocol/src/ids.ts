// Names shared by the server and every client.
import { z } from 'zod'

export const PROTOCOL_VERSION = 1

export const STAGES = [
  'lobby', 'intro',
  'planning.play', 'planning.reveal', 'break.planning',
  'development.play', 'development.reveal', 'break.development',
  'maintaining.setup', 'maintaining.year', 'maintaining.reveal', 'break.maintaining',
  'reflection', 'winners', 'closed',
] as const
export const StageId = z.enum(STAGES)
export type StageId = z.infer<typeof StageId>

export const PHASES = ['planning', 'development', 'maintaining'] as const
export const PhaseId = z.enum(PHASES)
export type PhaseId = z.infer<typeof PhaseId>

export const METRICS = ['validity', 'reliability', 'cost', 'complexity'] as const
export const Metric = z.enum(METRICS)
export type Metric = z.infer<typeof Metric>

export const METHODS = ['interview', 'data_pull', 'audit', 'observation'] as const
export const Method = z.enum(METHODS)
export type Method = z.infer<typeof Method>

export const MODES = ['test', 'rehearsal', 'event'] as const
export const Mode = z.enum(MODES)
export type Mode = z.infer<typeof Mode>

/** The characters a practice can pick at join. Display only. */
export const AVATARS = ['av01', 'av02', 'av03', 'av04', 'av05', 'av06', 'av07', 'av08', 'av09', 'av10', 'av11', 'av12'] as const
export const AvatarId = z.enum(AVATARS)
export type AvatarId = z.infer<typeof AvatarId>

export const ERROR_CODES = [
  'bad_message', 'rate_limited', 'wrong_stage', 'already_submitted', 'busy', 'unknown_id',
  'already_done', 'no_bandwidth', 'not_enough_credits', 'invalid_report', 'invalid_design',
  'not_buildable', 'no_runs_left', 'offer_closed', 'offer_full', 'not_available', 'window_closed',
  'action_used', 'removed',
  // Host and join
  'name_taken', 'name_invalid', 'join_closed', 'session_full', 'unknown_player', 'unknown_system',
  // Host console
  'not_in_control', 'no_scores_yet', 'no_deck', 'not_during_play', 'confirm_mismatch', 'pause_first',
] as const
export const ErrorCode = z.enum(ERROR_CODES)
export type ErrorCode = z.infer<typeof ErrorCode>

export const SCENES = ['auto', 'lobby', 'intro', 'play', 'reveal', 'slides', 'reflection', 'winners', 'spotlight'] as const
export const SceneId = z.enum(SCENES)
export type SceneId = z.infer<typeof SceneId>

export const THEMES = ['light', 'dark'] as const
export const Theme = z.enum(THEMES)
export type Theme = z.infer<typeof Theme>

/** Stages in which a phase is being played. Slides never reach a player's screen then. */
export const PLAY_STAGES: readonly StageId[] = ['planning.play', 'development.play', 'maintaining.setup', 'maintaining.year']

/** The phase a stage belongs to, if any. */
export function phaseOfStage(stage: StageId): PhaseId | null {
  const head = stage.split('.')[0]
  return (PHASES as readonly string[]).includes(head!) ? (head as PhaseId) : null
}

/** Alphabet of rejoin and session codes: no 0, O, 1, I or L. */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const CODE_LENGTH = 6
export function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, '')
}
