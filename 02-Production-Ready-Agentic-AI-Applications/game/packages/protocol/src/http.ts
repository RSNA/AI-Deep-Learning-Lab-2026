// HTTP shapes of the player API (engineering spec, section 7.2) and small helpers to call it.
import { z } from 'zod'
import { AvatarId, Kind, Mode, StageId } from './ids.ts'
import { ReportCard, ResultReply, type ResultBody } from './report.ts'
import { ReviewReply } from './review.ts'
import { Board, PhaseContent, SystemRef, Text } from './views.ts'

const S = <T extends Record<string, z.ZodType>>(shape: T) => z.strictObject(shape)

export const SessionPublic = S({
  code: z.string(), label: Text, title: Text.nullable(), mode: Mode, kind: Kind, stage: StageId, joinOpen: z.boolean(),
  /** A phase is in play: who joins now waits for the next one (section 6.4). */
  joinWaits: z.boolean(),
  systems: z.array(S({ ...SystemRef.shape, players: z.number().int() })),
  nameRule: S({ min: z.number().int(), max: z.number().int() }),
  /** The health systems a player may pick from, in a session whose mode allows it. Otherwise null. */
  pickSystem: z.array(S({ id: z.string(), index: z.number().int(), name: Text, setting: Text })).nullable(),
})
export type SessionPublic = z.infer<typeof SessionPublic>

/**
 * The session with a facilitator that takes players now, or null, and whether anyone may start
 * a single-player game (section 7.2).
 */
export const OpenSession = S({
  session: S({ code: z.string(), label: Text, title: Text.nullable() }).nullable(),
  solo: z.boolean(),
  soloPasscode: z.boolean(),        // a single-player game asks for a passcode
  title: Text.nullable(),
  nameRule: S({ min: z.number().int(), max: z.number().int() }),
})
export type OpenSession = z.infer<typeof OpenSession>

/** `POST /api/solo`: a single-player game for this practice. The reply is a join result. */
export const SoloBody = S({ name: z.string().max(200), avatar: z.string().max(16).optional(), passcode: z.string().max(200).optional() })
export type SoloBody = z.infer<typeof SoloBody>

/**
 * `POST /api/results`: the games a browser kept, each by its session code and the rejoin code of
 * its practice. The reply holds the ones the server still has, in the order asked.
 */
export const ResultsBody = S({ games: z.array(S({ session: z.string().max(16), rejoinCode: z.string().max(16) })).max(40) })
export type ResultsBody = z.infer<typeof ResultsBody>
export const GameSummary = S({
  session: z.string(), label: Text, kind: Kind, startedAtMs: z.number(),
  open: z.boolean(),                // the game is not closed: its practice can go back in
  stage: StageId,
  name: Text,
  card: ReportCard.nullable(),      // null before any phase is scored
  review: z.boolean(),              // the phases can be looked at again (`POST /api/review`)
})
export type GameSummary = z.infer<typeof GameSummary>
export const ResultsReply = S({ games: z.array(GameSummary) })
export type ResultsReply = z.infer<typeof ResultsReply>

/** `GET /api/board/:code`: the leaderboard of a session, for someone who waits outside it. */
export const BoardReply = S({ board: Board })
export type BoardReply = z.infer<typeof BoardReply>

export const JoinBody = S({
  code: z.string().max(16), name: z.string().max(200), avatar: z.string().max(16).optional(),
  system: z.string().max(40).optional(),   // honored only where the session allows a pick
})
export type JoinBody = z.infer<typeof JoinBody>
export const RejoinBody = S({ code: z.string().max(16), rejoinCode: z.string().max(16) })
export type RejoinBody = z.infer<typeof RejoinBody>
export const JoinResult = S({ playerId: z.string(), token: z.string(), rejoinCode: z.string(), session: z.string() })
export type JoinResult = z.infer<typeof JoinResult>
export const ApiError = S({ error: z.string(), message: Text.optional() })
export type ApiError = z.infer<typeof ApiError>

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string; message?: string }

async function call<T>(fetchImpl: typeof fetch, url: string, init: RequestInit, schema: z.ZodType<T>): Promise<ApiResult<T>> {
  let res: Response
  try {
    res = await fetchImpl(url, init)
  } catch {
    return { ok: false, status: 0, error: 'network' }
  }
  let body: unknown = null
  try { body = await res.json() } catch { /* not JSON */ }
  if (!res.ok) {
    const e = ApiError.safeParse(body)
    return { ok: false, status: res.status, error: e.success ? e.data.error : `http_${res.status}`, message: e.success ? e.data.message : undefined }
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) return { ok: false, status: res.status, error: 'bad_response' }
  return { ok: true, data: parsed.data }
}

/** The player API over HTTP. `base` is the server origin, '' in a browser on the same origin. */
export function playerApi(base: string, fetchImpl: typeof fetch = fetch) {
  const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return {
    session: (code: string) => call(fetchImpl, `${base}/api/session/${encodeURIComponent(code)}`, {}, SessionPublic),
    /** The open session, or with `after` the open session that was opened later than that one. */
    open: (after?: string) => call(fetchImpl, `${base}/api/open${after ? `?after=${encodeURIComponent(after)}` : ''}`, {}, OpenSession),
    solo: (body: SoloBody) => call(fetchImpl, `${base}/api/solo`, json(body), JoinResult),
    results: (body: ResultsBody) => call(fetchImpl, `${base}/api/results`, json(body), ResultsReply),
    review: (body: ResultBody) => call(fetchImpl, `${base}/api/review`, json(body), ReviewReply),
    board: (code: string) => call(fetchImpl, `${base}/api/board/${encodeURIComponent(code)}`, {}, BoardReply),
    join: (body: JoinBody) => call(fetchImpl, `${base}/api/join`, json(body), JoinResult),
    rejoin: (body: RejoinBody) => call(fetchImpl, `${base}/api/rejoin`, json(body), JoinResult),
    /** The report card of a practice, by the session (its code or its label) and the rejoin code. */
    result: (body: ResultBody) => call(fetchImpl, `${base}/api/result`, json(body), ResultReply),
    content: (token: string, phase: string) =>
      call(fetchImpl, `${base}/api/content/${phase}`, { headers: { authorization: `Bearer ${token}` } }, PhaseContent),
  }
}

export const AvatarList = z.array(AvatarId)
