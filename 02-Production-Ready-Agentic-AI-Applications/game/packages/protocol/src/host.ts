// Host socket messages (engineering spec, section 8.5). Only sockets that proved the host token
// receive these.
import { z } from 'zod'
import { AvatarId, ErrorCode, Mode, PhaseId, SceneId, StageId, Theme } from './ids.ts'
import { Board, CanvasLegend, CanvasMap, Clock, Running, Rung, ScreenView, SessionInfo, SlideView, Text } from './views.ts'

const S = <T extends Record<string, z.ZodType>>(shape: T) => z.strictObject(shape)
const Int = z.number().int()

export const HostCommand = z.discriminatedUnion('type', [
  S({ type: z.literal('next'), payload: S({}) }),
  S({ type: z.literal('pause'), payload: S({}) }),
  S({ type: z.literal('resume'), payload: S({}) }),
  S({ type: z.literal('extend'), payload: S({ seconds: z.union([z.literal(30), z.literal(60)]) }) }),
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
    classify: z.number().nullable(), flagship: z.number().nullable(),
  }).nullable(),
  // Phase 2 (section 10.8): the draft drawn read-only, the money, the actions, every validation,
  // and beside them the key: the share solved of every case for the draft, the flags, the reference map.
  development: S({
    status: z.enum(['playing', 'closed']),
    money: z.number(), developers: S({ total: Int, free: Int }),
    legend: CanvasLegend,
    actions: z.array(S({ id: z.string(), title: Text, group: z.string(), state: z.enum(['open', 'running', 'done']) })),
    map: CanvasMap,
    ready: S({ ok: z.boolean(), reasons: z.array(z.string()) }),
    validations: z.array(S({ id: z.string(), atMs: z.number(), accuracy: z.number(), map: CanvasMap })),
    submitId: z.string().nullable(),
    key: S({
      accuracy: z.number().nullable(),        // of the draft, when it is ready
      cases: z.array(S({ id: z.string(), title: Text, weight: z.number(), solved: z.number().nullable() })),
      flags: S({ privateData: z.array(z.string()), overloaded: z.array(z.string()), distracting: z.array(z.string()), prompt: z.array(z.string()), stray: z.array(z.string()) }),
      running: Running,
      reference: S({ map: CanvasMap, summary: Text, accuracy: z.number() }),
    }),
  }).nullable(),
})
export type HostInspect = z.infer<typeof HostInspect>

export const SpectateMsg = S({ t: z.literal('spectate'), playerId: z.string(), view: HostInspect.nullable() })

/** Every slide of the deck with its notes, for a host who looks through it alone (section 10.8). */
export const HostDeck = S({
  slides: z.array(S({ slide: SlideView, notes: Text.nullable(), placeholder: z.boolean(), section: z.string() })),
})
export type HostDeck = z.infer<typeof HostDeck>

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
})
export type CreateSessionBody = z.infer<typeof CreateSessionBody>
export const SessionSummary = S({
  code: z.string(), label: Text, mode: Mode, stage: StageId, players: Int, closed: z.boolean(), createdAt: z.number(),
})
export type SessionSummary = z.infer<typeof SessionSummary>
