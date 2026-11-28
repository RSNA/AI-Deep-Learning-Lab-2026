// Host socket messages (engineering spec, section 8.5). Only sockets that proved the host token
// receive these.
import { z } from 'zod'
import { AvatarId, ErrorCode, Mode, PhaseId, SceneId, StageId, Theme } from './ids.ts'
import { Board, CanvasLegend, CanvasMap, Clock, MaintainingSpent, ModelRead, Running, Rung, ScreenView, SessionInfo, SlideView, Text } from './views.ts'

const S = <T extends Record<string, z.ZodType>>(shape: T) => z.strictObject(shape)
const Int = z.number().int()

export const HostCommand = z.discriminatedUnion('type', [
  S({ type: z.literal('next'), payload: S({}) }),
  S({ type: z.literal('pause'), payload: S({}) }),
  S({ type: z.literal('resume'), payload: S({}) }),
  S({ type: z.literal('extend'), payload: S({ seconds: z.union([z.literal(30), z.literal(60), z.literal(300)]) }) }),
  S({ type: z.literal('end_now'), payload: S({}) }),
  S({ type: z.literal('rename_player'), payload: S({ playerId: z.string(), name: z.string().max(100) }) }),
  S({ type: z.literal('remove_player'), payload: S({ playerId: z.string() }) }),
  S({ type: z.literal('reset_stage'), payload: S({ confirm: z.string() }) }),
  S({ type: z.literal('restart_game'), payload: S({ confirm: z.string() }) }),
  S({ type: z.literal('close'), payload: S({ confirm: z.string() }) }),
  S({ type: z.literal('rejoin_code'), payload: S({ playerId: z.string() }) }),
  S({ type: z.literal('screen_scene'), payload: S({ scene: SceneId, mirror: z.boolean().optional() }) }),
  S({ type: z.literal('screen_mirror'), payload: S({ mirror: z.boolean() }) }),
  S({ type: z.literal('slide_to'), payload: S({ index: Int.min(0) }) }),
  S({ type: z.literal('screen_theme'), payload: S({ theme: Theme }) }),
  // `phase` picks the leaderboard of one phase, with the health systems side by side.
  S({ type: z.literal('screen_filter'), payload: S({ system: z.string().nullable(), phase: PhaseId.nullable().optional() }) }),
  S({ type: z.literal('slide'), payload: S({ delta: z.union([z.literal(1), z.literal(-1)]) }) }),
  S({ type: z.literal('spotlight'), payload: S({ playerId: z.string().nullable() }) }),
  S({ type: z.literal('spectate'), payload: S({ playerId: z.string().nullable() }) }),
  S({ type: z.literal('set_scale'), payload: S({ scale: z.number().positive().max(100) }) }),
  // A console takes charge. The passcode is asked again when another console holds control.
  S({ type: z.literal('take_control'), payload: S({ passcode: z.string().max(200).optional() }) }),
  // A new name for the session, while it waits in the lobby (section 6.4).
  S({ type: z.literal('rename_session'), payload: S({ label: z.string().min(1).max(80) }) }),
])
export type HostCommand = z.infer<typeof HostCommand>

export const HostCmdEnvelope = S({ t: z.literal('hostcmd'), cid: z.string().min(1).max(64), type: z.string().max(64), payload: z.unknown() })

export const HostPlayerRow = S({
  id: z.string(), name: Text, avatar: AvatarId, system: z.string(),
  connected: z.boolean(), removed: z.boolean(),
  status: Text,
  points: S({ planning: Int.nullable(), development: Int.nullable(), maintaining: Int.nullable(), total: Int }),
  idleSeconds: z.number().nullable(),
  joinedAtMs: z.number(),
})
export type HostPlayerRow = z.infer<typeof HostPlayerRow>

export const ScheduleSegment = S({
  segment: z.string(), label: Text, start: z.number(), end: z.number(),
  state: z.enum(['done', 'now', 'later']),
})

export const HostView = S({
  session: SessionInfo,
  closed: z.boolean(),
  contentHash: z.string(),
  phasesAvailable: S({ planning: z.boolean(), development: z.boolean(), maintaining: z.boolean() }),
  provisional: z.boolean(),
  clock: Clock,
  stage: StageId,
  timed: z.boolean(),
  next: StageId.nullable(),
  schedule: S({ segments: z.array(ScheduleSegment), behindSeconds: z.number().nullable() }),
  players: z.array(HostPlayerRow),
  counts: S({ total: Int, connected: Int, bySystem: z.array(S({ id: z.string(), players: Int, connected: Int })) }),
  board: Board,
  screen: S({
    scene: SceneId, theme: Theme, slide: Int, spotlight: z.string().nullable(), filter: z.string().nullable(), screens: Int,
    phase: PhaseId.nullable(),      // the leaderboard shows this phase only, by health system
    rotates: z.boolean(),           // "Follow the game" is rotating through its programme now
    shown: SceneId,                 // what the projector shows now: the scene, or what 'auto' resolves to
    mirror: z.boolean(),            // the slides are on every player's screen too
    available: S({ play: z.boolean(), winners: z.boolean(), slides: z.boolean() }),
  }),
  preview: ScreenView,              // exactly what the projector draws, for the small live preview
  deck: S({
    count: Int,
    sections: z.array(S({ id: z.string(), title: Text, stage: StageId, start: Int, count: Int })),
    current: S({ slide: SlideView, notes: Text.nullable(), placeholder: z.boolean() }).nullable(),
    next: S({ slide: SlideView, notes: Text.nullable(), placeholder: z.boolean() }).nullable(),
  }),
  /** Which console holds control. Filled per console by the server. */
  control: S({
    you: z.boolean(),
    state: z.enum(['held', 'reconnecting', 'free']),   // reconnecting: the controller dropped less than 20 s ago
    holder: Text.nullable(),
    watchers: z.array(Text),                          // the names of the other consoles that watch
  }),
  answerKey: z.boolean(),
  guide: z.boolean(),                // the server has a facilitator guide to open
  phaseLive: PhaseId.nullable(),
  pickModes: z.array(Mode),         // session modes in which a player may pick the health system
})
export type HostView = z.infer<typeof HostView>

export const HostWelcome = S({ t: z.literal('welcome'), protocol: Int, build: z.string(), role: z.literal('host'), view: HostView })
export const HostViewMsg = S({ t: z.literal('host_view'), view: HostView })
export const HostAck = S({ t: z.literal('ack'), cid: z.string(), ok: z.boolean(), error: ErrorCode.optional(), data: z.unknown().optional() })
/**
 * One player as a host sees them (section 10.8): what they did in each phase so far, beside the
 * key. Only a host socket receives this, in any stage, so a host can help a player who is stuck.
 */
export const HostInspect = S({
  id: z.string(), name: Text, avatar: AvatarId, system: z.string(), connected: z.boolean(),
  points: S({ planning: Int.nullable(), development: Int.nullable(), maintaining: Int.nullable(), total: Int }),
  planning: S({
    status: z.enum(['playing', 'submitted', 'closed']),
    insights: Int, investigations: Int,       // insights in hand, of how many
    running: z.array(Text),                   // titles of what runs now
    done: z.array(Text),                      // titles of the investigations that are done
    classes: z.array(S({ id: z.string(), label: Text, short: Text, capacity: Int })),   // in class_order
    problems: z.array(S({
      id: z.string(), title: Text,
      picked: z.string().nullable(),          // the player's class now, or as sent
      mark: z.enum(['right', 'near', 'wrong', 'unsorted']),
      truth: z.string(), tier: Rung.nullable(), flagship: z.boolean(), rationale: Text,
      points: z.number().nullable(),          // once the phase is scored
    })),
    classify: z.number().nullable(), flagship: z.number().nullable(), economy: z.number().nullable(),
  }).nullable(),
  // Phase 2 (section 10.8): the draft drawn read-only, the money, the actions, every validation,
  // and beside them the key: the share solved of every case for the draft, the flags, the reference map.
  development: S({
    status: z.enum(['playing', 'closed']),
    moneyUnit: Text.nullable(),               // written after a sum of money, such as k$
    money: z.number(), developers: S({ total: Int, free: Int }),
    legend: CanvasLegend,
    pools: z.array(S({ id: z.string(), label: Text, max: z.number() })),
    actions: z.array(S({ id: z.string(), title: Text, group: z.string(), state: z.enum(['open', 'running', 'done']) })),
    map: CanvasMap,
    ready: S({ ok: z.boolean(), reasons: z.array(z.string()) }),
    validations: z.array(S({ id: z.string(), atMs: z.number(), accuracy: z.number(), map: CanvasMap })),
    submitId: z.string().nullable(),
    key: S({
      accuracy: z.number().nullable(),        // of the draft, when it is ready
      cases: z.array(S({ id: z.string(), title: Text, weight: z.number(), solved: z.number().nullable() })),
      flags: S({ privateData: z.array(z.string()), overloaded: z.array(z.string()), distracting: z.array(z.string()), prompt: z.array(z.string()), stray: z.array(z.string()), rushed: z.array(z.string()) }),
      running: Running,
      reference: S({ map: CanvasMap, summary: Text, accuracy: z.number() }),
    }),
    // What a host needs to help this player, in a few lines (section 10.8): the map that the
    // coaching is about (the draft when it is ready, else the chosen map), why it loses cases,
    // who would read each of those sources best, and how its tiles compare with the reference map.
    coach: S({
      of: z.enum(['draft', 'chosen']).nullable(),          // null: no map to judge yet
      accuracy: z.number().nullable(),
      chosen: S({ id: z.string(), accuracy: z.number() }).nullable(),
      total: z.number(),                                    // the weight of all cases
      losses: z.array(S({
        reason: z.enum(['missing', 'weak', 'decision']), source: z.string().nullable(),
        lost: z.number(), kinds: Int,
        best: S({ worker: z.string(), model: z.string().nullable(), via: z.string().nullable(), quality: z.number() }).nullable(),
      })),
      shared: z.array(z.string()),                          // kinds on this map that the reference map has too
      missing: z.array(z.string()),                         // kinds of the reference map that this map lacks
      extra: z.array(z.string()),                           // kinds on this map that the reference map does not use
      guide: z.array(S({ id: z.string(), best: Text, wrong: Text })),   // for the kinds named above
    }),
  }).nullable(),
  // Phase 3 (section 10.8): the year so far as numbers, the map that runs, and beside them the
  // key: what acts on this player, the reference maps, and a few lines for a host who helps.
  maintaining: S({
    status: z.enum(['playing', 'closed']),
    moneyUnit: Text.nullable(),               // written after a sum of money, such as k$
    money: z.number(), developers: S({ total: Int, free: Int }),
    legend: CanvasLegend,
    pools: z.array(S({ id: z.string(), label: Text, max: z.number() })),
    // `times`: how often it finished in Phase 3 (a repeat action may be more than once).
    actions: z.array(S({ id: z.string(), title: Text, group: z.string(), state: z.enum(['open', 'running', 'done']), times: Int })),
    map: CanvasMap,                           // the draft
    ready: S({ ok: z.boolean(), reasons: z.array(z.string()) }),
    validations: z.array(S({ id: z.string(), atMs: z.number(), accuracy: z.number(), map: CanvasMap, origin: z.enum(['phase2', 'phase3', 'reference']), label: Text.nullable() })),
    deployed: z.string().nullable(),
    // What the models of the system in service read for a patient and cost a month, at the
    // prices of the last report. Empty when no system runs or the pack prices a model per call.
    reads: z.array(ModelRead),
    round: S({ index: Int, of: Int }),
    reports: z.array(S({
      period: Int, short: Text, map: z.string().nullable(),
      validity: z.number(), test: z.number(), reliability: z.number(), interruptions: Int,
      value: z.number(), off: z.number(), runCost: z.number(), fine: z.number(), score: z.number(),
      worstPart: Text.nullable(),             // the label of the part that failed most
      // Every event that acted on the player in the period, with what it cost.
      events: z.array(S({ id: z.string(), title: Text, validityLoss: z.number(), reliabilityLoss: z.number() })),
    })),
    spent: MaintainingSpent,
    score: z.number(),
    key: S({
      references: z.array(S({ id: z.string(), label: Text, map: CanvasMap, accuracy: z.number() })),
      // For the kinds on the map that runs and for what Phase 3 adds: the best use and the wrong choices.
      guide: z.array(S({ id: z.string(), best: Text, wrong: Text })),
    }),
    // What holds this player back, what to say, and what is good. A few lines each, for a host.
    glimpse: S({ holds: z.array(Text), say: z.array(Text), good: z.array(Text) }),
  }).nullable(),
})
export type HostInspect = z.infer<typeof HostInspect>

export const SpectateMsg = S({ t: z.literal('spectate'), playerId: z.string(), view: HostInspect.nullable() })

/** Every slide of the deck with its notes, for a host who looks through it alone (section 10.8). */
export const HostDeck = S({
  slides: z.array(S({ slide: SlideView, notes: Text.nullable(), placeholder: z.boolean(), section: z.string() })),
})
export type HostDeck = z.infer<typeof HostDeck>

/** Every slide of the deck for the page of all slides, with the address a join slide shows (section 10.8). */
export const HostSlides = S({ slides: HostDeck.shape.slides, joinUrl: z.string() })
export type HostSlides = z.infer<typeof HostSlides>

/** Control of the session moved from one console to another. */
export const ControlMsg = S({ t: z.literal('control'), from: Text.nullable(), to: Text })

export const HostServerMessage = z.discriminatedUnion('t', [
  HostWelcome, HostViewMsg, HostAck, SpectateMsg, ControlMsg,
  S({ t: z.literal('clock'), clock: Clock }),
  S({ t: z.literal('reload') }),
  S({ t: z.literal('error'), error: ErrorCode, message: Text.optional() }),
])
export type HostServerMessage = z.infer<typeof HostServerMessage>

// HTTP shapes of the host API
export const CreateSessionBody = S({
  label: z.string().min(1).max(80),
  mode: Mode,
  code: z.string().regex(/^[A-Za-z0-9]{4,8}$/).optional(),
  by: z.string().max(40).optional(),          // the facilitator who opens it
  // One session with a facilitator is open at a time (section 7.2). `replace` ends the one that
  // runs: `code` names the session the facilitator was warned about, and `confirm` is its code
  // typed out, which an event session with players asks for.
  replace: S({ code: z.string().max(16).optional(), confirm: z.string().max(16).optional() }).optional(),
})
export type CreateSessionBody = z.infer<typeof CreateSessionBody>
export const RenameSessionBody = S({ label: z.string().min(1).max(80) })
export const SessionSummary = S({
  code: z.string(), label: Text, mode: Mode, stage: StageId, players: Int, closed: z.boolean(), createdAt: z.number(),
  createdBy: Text,                  // the facilitator who opened it, or ''
  results: Int,                     // practices whose result is kept
})
export type SessionSummary = z.infer<typeof SessionSummary>
/** What a refused `POST /api/host/session` says about the session that runs. */
export const SessionRunning = S({
  code: z.string(), label: Text, mode: Mode, stage: StageId, players: Int, createdAt: z.number(), createdBy: Text,
  needsCode: z.boolean(),           // ending it asks for its code typed out
})
export type SessionRunning = z.infer<typeof SessionRunning>
/**
 * One single-player game in the facilitator's list. The list is there to delete games, so it
 * says whose game it is and whether it is over, and nothing about how it goes.
 */
export const SoloSummary = S({ code: z.string(), name: Text, createdAt: z.number(), closed: z.boolean(), live: z.boolean() })
export type SoloSummary = z.infer<typeof SoloSummary>
/**
 * Who may start a single-player game: whoever knows the facilitator passcode (the default),
 * whoever knows a passcode of its own, or anybody.
 */
export const SOLO_GATES = ['facilitator', 'custom', 'none'] as const
export const SoloGate = z.enum(SOLO_GATES)
export type SoloGate = z.infer<typeof SoloGate>
export const SoloOverview = S({
  enabled: z.boolean(), gate: SoloGate, total: Int, finished: Int, unfinished: Int, live: Int, cap: Int,
  recent: z.array(SoloSummary),     // the newest fifty
})
export type SoloOverview = z.infer<typeof SoloOverview>
