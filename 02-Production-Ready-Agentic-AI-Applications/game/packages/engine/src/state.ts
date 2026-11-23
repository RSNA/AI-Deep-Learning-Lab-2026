// Session state. Plain JSON data: no classes, maps, sets or dates (engineering spec, 6.1).
import type { CanvasMap } from '@lab02/content-schema'
import type { AckData, AvatarId, ColumnId, ErrorCode, InboxItem, Mode, PhaseId, SceneId, StageId, Theme } from '@lab02/protocol'
import type { Missed, NoteId, Running } from './canvas.ts'

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

/** One validation of a map (section 6.6). The map is the copy that was validated. */
export type DevelopmentValidation = {
  id: string
  atMs: GameMs
  map: CanvasMap
  accuracy: number
  missed: Missed | null
  note: NoteId | null
  running: Running
  /** The rank in the live column right after this validation, of how many players. */
  rank: number | null
  of: number
}

export type DevelopmentResult = {
  /** The validation that was submitted, or null for a player who never validated. */
  validation: string | null
  accuracy: number
  raw: number
  perCase: Record<string, number>
  map: CanvasMap | null
}

export type DevelopmentState = {
  money: number
  actionsDone: { id: string; atMs: GameMs }[]
  actionsRunning: { id: string; startedAtMs: GameMs; completesAtMs: GameMs }[]
  /** The draft. */
  map: CanvasMap
  validating: { id: string; startedAtMs: GameMs; completesAtMs: GameMs; map: CanvasMap } | null
  validations: DevelopmentValidation[]
  shownCases: string[]
  shownNotes: string[]
  /** The validation the player chose to submit, or null for the default. */
  chosen: string | null
  /** Set when the stage ends. With the money, the actions and the shown items it goes into Phase 3. */
  result: DevelopmentResult | null
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
  development: DevelopmentState | null
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
  phase?: PhaseId | null            // the leaderboard shows one phase, by health system
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
  /** How often the host started a phase or the game again. A browser drops what it kept for the run before. */
  run?: number
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
  | { type: 'insight'; action: string }
  | { type: 'validated'; id: string }

/** One line of the room's activity for the projector. `text` is public wording from the pack. */
export type FeedEntry = { kind: 'started' | 'finished' | 'sent' | 'validated'; text: string | null; atMs: GameMs }
/** What the projector may say about one practice during play: counts and what runs, and in Phase 2 its map. */
export type PlayerCard = { now: string[]; facts: { label: string; value: string }[]; map?: CanvasMap | null }

export type Outcome = { dirty: PlayerId[] | 'all'; events: EngineEvent[] }
export type ApplyResult = (Outcome & { ok: true }) | (Outcome & { ok: false; error: ErrorCode; data?: AckData })

/** Commands the engine applies. The server stamps each with the game time it handles it. */
export type Command =
  | { actor: 'system'; type: 'join'; payload: { playerId: PlayerId; name: string; avatar?: string | null; system?: string | null } }
  | { actor: 'player'; playerId: PlayerId; type: string; payload: unknown }
  | { actor: 'host'; type: string; payload: unknown }
