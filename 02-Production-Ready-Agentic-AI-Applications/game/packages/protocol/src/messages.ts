// Wire messages of the player and screen sockets (engineering spec, section 8.2).
import { z } from 'zod'
import { ErrorCode, PhaseId } from './ids.ts'
import { Board, Clock, LadderRung, PackArt, PlayerView, Rung, ScreenView, SessionInfo, Standing, SystemPublic, Text } from './views.ts'

const S = <T extends Record<string, z.ZodType>>(shape: T) => z.strictObject(shape)

// ------------------------------------------------------------------------------------------
// Commands a player may send. Each phase step adds its commands here.
// ------------------------------------------------------------------------------------------
export const PlayerCommand = z.discriminatedUnion('type', [
  S({ type: z.literal('planning.investigate'), payload: S({ id: z.string().max(80) }) }),
  S({ type: z.literal('planning.set_report'), payload: S({ picks: z.record(z.string().max(80), Rung) }) }),
  S({ type: z.literal('planning.submit'), payload: S({}) }),
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

export const Ack = S({ t: z.literal('ack'), cid: Cid, ok: z.boolean(), error: ErrorCode.optional() })
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
  S({ kind: z.literal('dialogue'), speaker: z.string(), text: Text }),
  S({ kind: z.literal('announcement'), from: z.string(), text: Text }),
  S({ kind: z.literal('letter'), phase: PhaseId }),
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
