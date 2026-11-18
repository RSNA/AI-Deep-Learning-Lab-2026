// Session state. Plain JSON data: no classes, maps, sets or dates (engineering spec, 6.1).
import type { AvatarId, ColumnId, ErrorCode, InboxItem, Mode, PhaseId, SceneId, StageId, Theme } from '@lab02/protocol'

export type PlayerId = string
export type GameMs = number

export type PhaseResult = { raw: number; points: number; band: string; provisional: boolean }

export type PlanningResult = {
  graded: { problem: string; picked: string | null; points: number }[]   // every problem, in pack order
  classify: number
  flagship: number
  raw: number
}

export type PlanningState = {
  done: { id: string; atMs: GameMs }[]
  /** `released`: interview lines out so far. Free bandwidth is the total minus what these hold. */
  running: { id: string; startedAtMs: GameMs; completesAtMs: GameMs; released: number }[]
  /** Problem id to class id. A problem without an entry is unsorted. */
  picks: Record<string, string>
  submittedAtMs: GameMs | null
  result: PlanningResult | null
}

export type PlayerState = {
  id: PlayerId
  name: string
  avatar: AvatarId
  system: string
  joinSeq: number
  joinedAtMs: GameMs
  removed: boolean
  rev: number
  lastCmdMs: GameMs | null
  /** The engine accepted at least one command from the player in that phase. */
  acted: Record<PhaseId, boolean>
  submittedAtMs: Record<PhaseId, GameMs | null>
  /** Value of the live leaderboard column, and since when the player holds it. */
  live: Record<PhaseId, { value: number; sinceMs: GameMs }>
  results: Record<PhaseId, PhaseResult | null>
  planning: PlanningState | null
  development: null
  maintaining: null
  inbox: InboxItem[]
  /** Dialogue lines that have fired for this player (each fires once). */
  said: string[]
}

export type BoardState = {
  atMs: GameMs
  live: PhaseId | null
  /** Player ids in rank order, per column. A column that has not opened is empty. */
  order: Record<ColumnId, PlayerId[]>
  /** The value each ranked player shows, per column. */
  values: Record<ColumnId, Record<PlayerId, number>>
  systems: { id: string; score: number; rank: number }[]
}

export type ScreenState = {
  scene: SceneId
  theme: Theme
  slide: number                     // the slide shown last, across the whole deck
  spotlight: PlayerId | null
  filter: string | null
  mirror?: boolean                  // the slides are on every player's screen too (outside play only)
}

export type SessionState = {
  v: 1
  code: string
  label: string
  mode: Mode
  contentHash: string
  /** Health systems in play, in pack order. */
  systems: string[]
  createdAtMs: GameMs
  stage: StageId
  stageStartedMs: GameMs
  stageEndsAtMs: GameMs | null
  stageLog: { stage: StageId; atMs: GameMs }[]
  rev: number
  joinSeq: number
  players: Record<PlayerId, PlayerState>
  order: PlayerId[]
  opened: PhaseId[]
  closedPhases: PhaseId[]
  board: BoardState
  nextBeatMs: GameMs
  screen: ScreenState
  closed: boolean
}

export type EngineEvent =
  | { kind: 'stage'; stage: StageId; atMs: GameMs }
  | { kind: 'beat'; atMs: GameMs }
  | { kind: 'joined'; playerId: PlayerId; atMs: GameMs }
  | { kind: 'removed'; playerId: PlayerId; atMs: GameMs }
  | { kind: 'renamed'; playerId: PlayerId; atMs: GameMs }
  | { kind: 'screen'; atMs: GameMs }
  | { kind: 'closed'; atMs: GameMs }
  | { kind: 'moment'; playerId: PlayerId; atMs: GameMs; ref: MomentRef }

/** What a moment refers to. The projection turns it into the protocol's Moment. */
export type MomentRef =
  | { type: 'interview_line'; investigation: string; index: number }
  | { type: 'tile'; investigation: string }
  | { type: 'dialogue'; id: string }
  | { type: 'letter'; phase: PhaseId }

export type Outcome = { dirty: PlayerId[] | 'all'; events: EngineEvent[] }
export type ApplyResult = (Outcome & { ok: true }) | (Outcome & { ok: false; error: ErrorCode })

/** Commands the engine applies. The server stamps each with the game time it handles it. */
export type Command =
  | { actor: 'system'; type: 'join'; payload: { playerId: PlayerId; name: string; avatar?: string | null; system?: string | null } }
  | { actor: 'player'; playerId: PlayerId; type: string; payload: unknown }
  | { actor: 'host'; type: string; payload: unknown }
