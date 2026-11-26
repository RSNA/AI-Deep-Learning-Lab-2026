// The personal report card (engineering spec, sections 6.12 and 10.7). One record per player,
// made by the server at the end of the game and kept after the session is closed, so that a
// player can come back to it. It is complete in itself: the page that shows it needs nothing
// else from the server, and nothing in it is more than the reveals already sent.
import { z } from 'zod'
import { AvatarId, PhaseId } from './ids.ts'

const S = <T extends Record<string, z.ZodType>>(shape: T) => z.strictObject(shape)
const Text = z.string()
const Int = z.number().int()

export const ReportCardPhase = S({
  phase: PhaseId,
  number: Int,                      // 1 to 3
  label: Text,
  scored: z.boolean(),              // the phase was closed while the practice was in the game
  points: Int.nullable(),           // null when the phase was not scored
  max: Int,
  band: Text.nullable(),            // the label of the band
  rank: Int.nullable(), of: Int,    // the rank in the column of that phase
  facts: z.array(S({ label: Text, value: Text })),
  // Phase 3: one row per period of the year, when the phase kept them.
  periods: z.array(S({ label: Text, validity: z.number().nullable(), reliability: z.number().nullable(), value: z.number().nullable() })),
})
export type ReportCardPhase = z.infer<typeof ReportCardPhase>

export const ReportCard = S({
  session: S({ code: z.string(), label: Text, title: Text.nullable(), playedAtMs: z.number().nullable() }),
  practice: S({ name: Text, avatar: AvatarId, system: Text, rejoinCode: z.string() }),
  final: z.boolean(),               // every phase is scored. Otherwise the card says "so far"
  total: Int, maxTotal: Int,
  rank: Int.nullable(), of: Int,    // overall
  systems: Int,                     // health systems in the session. With more than one the card shows the rank inside its own
  systemRank: Int.nullable(), ofSystem: Int,
  phases: z.array(ReportCardPhase),
  lines: z.array(S({ section: Text, text: Text, source: Text.nullable() })),   // of the pack's report card file, when it has one
  closing: Text.nullable(),
  readMore: z.array(Text),          // the papers behind the game, by their public labels
  links: z.array(S({ label: Text, url: z.string() })),
})
export type ReportCard = z.infer<typeof ReportCard>

/** `POST /api/result`: the session by its code or its label, and the rejoin code of the practice. */
export const ResultBody = S({ session: z.string().max(120), rejoinCode: z.string().max(16) })
export type ResultBody = z.infer<typeof ResultBody>
export const ResultReply = S({ card: ReportCard })
export type ResultReply = z.infer<typeof ResultReply>
