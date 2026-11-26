// Wire messages of the player and screen sockets (engineering spec, section 8.2).
import { z } from 'zod'
import { ErrorCode, PhaseId } from './ids.ts'
import { Board, CanvasMap, Clock, LadderRung, PackArt, PlayerView, ScreenView, SessionInfo, Standing, SystemPublic, Text } from './views.ts'

const S = <T extends Record<string, z.ZodType>>(shape: T) => z.strictObject(shape)

// ------------------------------------------------------------------------------------------
// Commands a player may send. Each phase step adds its commands here.
// ------------------------------------------------------------------------------------------
export const PlayerCommand = z.discriminatedUnion('type', [
  S({ type: z.literal('planning.investigate'), payload: S({ id: z.string().max(80) }) }),
  S({ type: z.literal('planning.set_report'), payload: S({ picks: z.record(z.string().max(80), z.string().max(40)) }) }),
  S({ type: z.literal('planning.submit'), payload: S({}) }),
  S({ type: z.literal('development.set_map'), payload: S({ map: CanvasMap }) }),
  S({ type: z.literal('development.act'), payload: S({ id: z.string().max(80) }) }),
  S({ type: z.literal('development.validate'), payload: S({}) }),
  S({ type: z.literal('development.choose'), payload: S({ id: z.string().max(16).nullable() }) }),
  // Phase 3 (section 6.7): the same board, a reference map taken into the list, and the map that runs.
  S({ type: z.literal('maintaining.set_map'), payload: S({ map: CanvasMap }) }),
  S({ type: z.literal('maintaining.act'), payload: S({ id: z.string().max(80) }) }),
  S({ type: z.literal('maintaining.validate'), payload: S({}) }),
  S({ type: z.literal('maintaining.adopt'), payload: S({ id: z.string().max(80) }) }),
  S({ type: z.literal('maintaining.deploy'), payload: S({ id: z.string().max(16).nullable() }) }),
])
export type PlayerCommand = z.infer<typeof PlayerCommand>
export type PlayerCommandType = PlayerCommand['type']

// ------------------------------------------------------------------------------------------
// Client to server
// ------------------------------------------------------------------------------------------
const Cid = z.string().min(1).max(64)

export const Hello = S({
  t: z.literal('hello'),
  token: z.string().min(10).max(200),
  build: z.string().max(80),
  session: z.string().max(16).optional(),   // a host names the session it drives
  name: z.string().max(40).optional(),      // a host console's name, shown to the other consoles
  console: z.string().max(40).optional(),   // a host console's id, random per browser tab
})
export type Hello = z.infer<typeof Hello>

export const CmdEnvelope = S({ t: z.literal('cmd'), cid: Cid, type: z.string().max(64), payload: z.unknown() })
export type CmdEnvelope = z.infer<typeof CmdEnvelope>

export const ClientMessage = z.discriminatedUnion('t', [Hello, CmdEnvelope])
export type ClientMessage = z.infer<typeof ClientMessage>

// ------------------------------------------------------------------------------------------
// Server to client
// ------------------------------------------------------------------------------------------
export const Welcome = S({
  t: z.literal('welcome'),
  protocol: z.number().int(),
  build: z.string(),
  role: z.literal('player'),
  session: SessionInfo,
  system: SystemPublic,
  ladder: z.array(LadderRung),
  art: PackArt,
  clock: Clock,
  view: PlayerView,
})
export type Welcome = z.infer<typeof Welcome>

export const ScreenWelcome = S({
  t: z.literal('welcome'),
  protocol: z.number().int(),
  build: z.string(),
  role: z.literal('screen'),
  clock: Clock,
  art: PackArt,
  view: ScreenView,
})
export type ScreenWelcome = z.infer<typeof ScreenWelcome>

/** What a refusal names, when it names something: a line of the map that a rule of the pack refuses, and why. */
export const AckData = S({ line: S({ from: z.string(), to: z.string() }), text: Text })
export type AckData = z.infer<typeof AckData>
export const Ack = S({ t: z.literal('ack'), cid: Cid, ok: z.boolean(), error: ErrorCode.optional(), data: AckData.optional() })
export type Ack = z.infer<typeof Ack>

export const ViewMsg = S({ t: z.literal('view'), view: PlayerView })
export const ClockMsg = S({ t: z.literal('clock'), clock: Clock })
export const StandingMsg = S({ t: z.literal('standing'), standing: Standing })
export const ScreenViewMsg = S({ t: z.literal('screen_view'), view: ScreenView })
export const ReloadMsg = S({ t: z.literal('reload') })
export const SupersededMsg = S({ t: z.literal('superseded') })
export const ErrorMsg = S({ t: z.literal('error'), error: ErrorCode, message: Text.optional() })

export const Moment = z.discriminatedUnion('kind', [
  S({ kind: z.literal('interview_line'), investigation: z.string(), speaker: z.string(), index: z.number().int(), text: Text }),
  S({ kind: z.literal('tile'), investigation: z.string() }),
  S({ kind: z.literal('insight'), action: z.string() }),       // Phase 2: an action ended and brought an insight
  S({ kind: z.literal('validated'), id: z.string() }),         // Phase 2: a validation has its result
  S({ kind: z.literal('dialogue'), id: z.string(), speaker: z.string(), text: Text }),
  S({ kind: z.literal('announcement'), from: z.string(), text: Text }),
  S({ kind: z.literal('letter'), phase: PhaseId }),
  S({ kind: z.literal('report'), period: z.number().int() }),   // Phase 3: the report of a period has arrived
  S({ kind: z.literal('news'), id: z.string() }),              // Phase 3: a letter or a memo is in the inbox, by its id there
  S({ kind: z.literal('stage'), stage: z.string() }),
])
export type Moment = z.infer<typeof Moment>
export const MomentMsg = S({ t: z.literal('moment'), moment: Moment })

export const PlayerServerMessage = z.discriminatedUnion('t', [
  Welcome, Ack, ViewMsg, ClockMsg, StandingMsg, MomentMsg, ReloadMsg, SupersededMsg, ErrorMsg,
])
export type PlayerServerMessage = z.infer<typeof PlayerServerMessage>

export const ScreenServerMessage = z.discriminatedUnion('t', [
  ScreenWelcome, ScreenViewMsg, ClockMsg, ReloadMsg, SupersededMsg, ErrorMsg,
])
export type ScreenServerMessage = z.infer<typeof ScreenServerMessage>

export type { Board }
