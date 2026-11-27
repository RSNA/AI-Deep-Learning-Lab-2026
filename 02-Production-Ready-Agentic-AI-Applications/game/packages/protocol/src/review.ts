// A game to look at again (engineering spec, sections 7.5 and 10.7). What a practice saw at the
// reveals of its phases, kept with its report card so that the result page can show each phase
// again after the session has left the server's memory. Nothing in it is more than the views
// and the phase content that the player's own browser already received during the game.
import { z } from 'zod'
import { ReportCard } from './report.ts'
import { LadderRung, PackArt, PhaseContent, PlayerView, SessionInfo, Standing, SystemPublic } from './views.ts'

const S = <T extends Record<string, z.ZodType>>(shape: T) => z.strictObject(shape)

/** The part every practice of one health system shares in a session. */
export const ReviewBase = S({
  session: SessionInfo,
  system: SystemPublic,
  ladder: z.array(LadderRung),
  art: PackArt,
  content: z.array(PhaseContent),   // of the phases that opened
})
export type ReviewBase = z.infer<typeof ReviewBase>

/** The part of one practice: its last view and its standing. */
export const ReviewMine = S({ view: PlayerView, standing: Standing })
export type ReviewMine = z.infer<typeof ReviewMine>

export const Review = S({ ...ReviewBase.shape, ...ReviewMine.shape })
export type Review = z.infer<typeof Review>

/** `POST /api/review`: asked like a result, by the session and the rejoin code of the practice. */
export const ReviewReply = S({ card: ReportCard.nullable(), review: Review })
export type ReviewReply = z.infer<typeof ReviewReply>
