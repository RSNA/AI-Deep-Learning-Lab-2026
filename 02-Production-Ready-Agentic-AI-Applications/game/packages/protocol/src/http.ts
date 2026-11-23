// HTTP shapes of the player API (engineering spec, section 7.2) and small helpers to call it.
import { z } from 'zod'
import { AvatarId, StageId } from './ids.ts'
import { PhaseContent, SystemRef, Text } from './views.ts'

const S = <T extends Record<string, z.ZodType>>(shape: T) => z.strictObject(shape)

export const SessionPublic = S({
  code: z.string(), label: Text, title: Text.nullable(), stage: StageId, joinOpen: z.boolean(),
  systems: z.array(S({ ...SystemRef.shape, players: z.number().int() })),
  nameRule: S({ min: z.number().int(), max: z.number().int() }),
  /** The health systems a player may pick from, in a session whose mode allows it. Otherwise null. */
  pickSystem: z.array(S({ id: z.string(), index: z.number().int(), name: Text, setting: Text })).nullable(),
})
export type SessionPublic = z.infer<typeof SessionPublic>

/** The session that takes players now: the newest one that is not closed, or null. */
export const OpenSession = S({ session: S({ code: z.string(), label: Text, title: Text.nullable() }).nullable() })
export type OpenSession = z.infer<typeof OpenSession>

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
    join: (body: JoinBody) => call(fetchImpl, `${base}/api/join`, json(body), JoinResult),
    rejoin: (body: RejoinBody) => call(fetchImpl, `${base}/api/rejoin`, json(body), JoinResult),
    content: (token: string, phase: string) =>
      call(fetchImpl, `${base}/api/content/${phase}`, { headers: { authorization: `Bearer ${token}` } }, PhaseContent),
  }
}

export const AvatarList = z.array(AvatarId)
