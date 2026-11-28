// The server process: HTTP routes, the socket hub and the session manager
// (engineering spec, sections 7.1 to 7.8).
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { extname, join, resolve, sep } from 'node:path'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import fastifyStatic from '@fastify/static'
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import { WebSocketServer, type WebSocket } from 'ws'
import { loadPack, type Pack } from '@lab02/content-schema'
import { gunzipSync } from 'node:zlib'
import { canPickSystem, checkName, createSession, deckSlides, joinOpen, joinWaitsFor, kindOf, project } from '@lab02/engine'
import {
  CLOSE, CmdEnvelope, Hello, JoinBody, PHASES, PhaseContent, RejoinBody, ReportCard, ResultBody, ResultsBody, Review, SoloBody, normalizeCode,
  type GameSummary, type OpenSession, type PhaseId, type SessionPublic,
} from '@lab02/protocol'
import { CreateSessionBody, HostCmdEnvelope, HostDeck, HostSlides, RenameSessionBody, SoloGate, type SessionSummary, type SoloOverview } from '@lab02/protocol/host'
import { hashToken, newToken, samePasscode } from './auth.ts'
import { configFromEnv, type Config } from './config.ts'
import { Storage } from './db.ts'
import { exportSession } from './export.ts'
import { createLogger, type Logger } from './log.ts'
import { Manager } from './manager.ts'
import type { Room, Sock } from './room.ts'
import { soloPasscodeAsked } from './soloGate.ts'

export type App = {
  config: Config
  pack: Pack
  manager: Manager
  db: Storage
  log: Logger
  listen(): Promise<string>
  close(): Promise<void>
  /** Base URL once listening. */
  url(): string
}

const MAX_MESSAGE = 16 * 1024
const RATE_WINDOW_MS = 5000
const RATE_MAX = 20

/** A counter of events in a sliding window of one minute, for the whole server. */
function minuteLimiter(max: number, wallNow: () => number) {
  const times: number[] = []
  return () => {
    const now = wallNow()
    while (times.length && now - times[0]! > 60_000) times.shift()
    if (times.length >= max) return false
    times.push(now)
    return true
  }
}

/** A browser runs an old client when its build differs from the server's. Bots send other names. */
export function needsReload(clientBuild: string, serverBuild: string): boolean {
  return clientBuild.startsWith('web-') && serverBuild !== 'dev' && clientBuild !== `web-${serverBuild}`
}

export function createApp(overrides: Partial<Config> = {}, env: NodeJS.ProcessEnv = process.env): App {
  const config = { ...configFromEnv(env), ...overrides }
  const log = createLogger(config.logLevel, config.wallNow)
  if (config.weakPasscode) log.warn('the host passcode is shorter than 16 characters (ALLOW_WEAK_PASSCODE). Set a long one before the event')
  const res = loadPack(config.contentDir, { systems: config.systems })
  for (const w of res.warnings) log.warn('pack warning', { file: w.file, path: w.path, message: w.message })
  if (!res.ok) {
    for (const e of res.errors) log.error('pack error', { file: e.file, path: e.path, message: e.message })
    throw new Error(`The content pack in ${config.contentDir} does not load. ${res.errors.length} error(s).`)
  }
  const pack = res.pack
  const db = new Storage(config.dataDir === ':memory:' ? ':memory:' : config.dataDir)
  const manager = new Manager({ pack, db, config, log })
  manager.restoreAll()
  const startedAt = config.wallNow()

  const fastify = Fastify({ logger: false, bodyLimit: 16 * 1024, trustProxy: true })

  // Security headers on every response (section 7.8).
  const pub = new URL(config.publicUrl)
  const wsOrigin = `${pub.protocol === 'https:' ? 'wss' : 'ws'}://${pub.host}`
  const csp = [
    "default-src 'self'", "img-src 'self' data: blob:", "style-src 'self' 'unsafe-inline'",
    "script-src 'self'", `connect-src 'self' ${wsOrigin}`, "font-src 'self'", "object-src 'none'",
    "base-uri 'none'", "frame-ancestors 'none'", "form-action 'self'",
  ].join('; ')
  fastify.addHook('onSend', async (_req, reply, payload) => {
    reply.header('content-security-policy', csp)
    reply.header('x-content-type-options', 'nosniff')
    reply.header('referrer-policy', 'no-referrer')
    return payload
  })
  fastify.addHook('onResponse', async (req, reply) => {
    log.debug('http', { method: req.method, path: req.url.split('?')[0], status: reply.statusCode, ms: Math.round(reply.elapsedTime) })
  })

  const bad = (reply: FastifyReply, status: number, error: string, message?: string) =>
    reply.code(status).send(message ? { error, message } : { error })

  // ----------------------------------------------------------------------------------------
  // Player API
  // ----------------------------------------------------------------------------------------
  const sessionPublic = (room: Room): SessionPublic => {
    const s = room.state
    const active = s.order.map((id) => s.players[id]!).filter((p) => !p.removed)
    const rule = pack.game.join.practice_name
    return {
      code: s.code, label: s.label, title: pack.game.game.title, mode: s.mode, kind: kindOf(s), stage: s.stage,
      joinOpen: joinOpen(s, pack), joinWaits: joinOpen(s, pack) && joinWaitsFor(s) !== null,
      systems: project.systemRefs(s, pack).map((r) => ({ ...r, players: active.filter((p) => p.system === r.id).length })),
      nameRule: { min: rule.min_chars, max: rule.max_chars },
      pickSystem: canPickSystem(s, pack)
        ? s.systems.map((id, index) => ({ id, index, name: pack.systems[id]!.system.public.name, setting: pack.systems[id]!.system.public.setting }))
        : null,
    }
  }

  fastify.get<{ Params: { code: string } }>('/api/session/:code', async (req, reply) => {
    const room = manager.get(normalizeCode(req.params.code))
    if (!room) return bad(reply, 404, 'unknown_session', manager.broken.get(normalizeCode(req.params.code)))
    return sessionPublic(room)
  })

  // The session that takes players now. A browser left on a game that has ended asks for the
  // session opened after it, so its player can move on to the next game without a new link
  // (section 7.2).
  fastify.get<{ Querystring: { after?: string } }>('/api/open', async (req): Promise<OpenSession> => {
    const after = typeof req.query.after === 'string' && /^[A-Za-z0-9]{4,8}$/.test(req.query.after) ? req.query.after : undefined
    const room = manager.newestOpen(after)
    const rule = pack.game.join.practice_name
    return {
      session: room ? { code: room.code, label: room.state.label, title: pack.game.game.title } : null,
      solo: manager.soloEnabled(), soloPasscode: manager.soloGate().mode !== 'none', title: pack.game.game.title, nameRule: { min: rule.min_chars, max: rule.max_chars },
    }
  })

  // The leaderboard of a session, for someone who stands outside it: the last phase is in play
  // and joining is closed (section 6.4). It says what the projector says, and nothing else.
  fastify.get<{ Params: { code: string } }>('/api/board/:code', async (req, reply) => {
    const room = manager.get(normalizeCode(req.params.code))
    if (!room || room.kind !== 'multi') return bad(reply, 404, 'unknown_session')
    reply.header('cache-control', 'no-store')
    return { board: project.boardView(room.state, pack, { system: null, rows: 10 }) }
  })

  const joinLimit = minuteLimiter(300, config.wallNow)
  fastify.post('/api/join', async (req, reply) => {
    const body = JoinBody.safeParse(req.body)
    if (!body.success) return bad(reply, 400, 'bad_message')
    if (!joinLimit()) return bad(reply, 429, 'rate_limited')
    const room = manager.get(normalizeCode(body.data.code))
    if (!room) return bad(reply, 404, 'unknown_session')
    const r = room.join(body.data.name, body.data.avatar, body.data.system)
    if (!r.ok) {
      const status = r.error === 'name_taken' ? 409 : r.error === 'name_invalid' || r.error === 'unknown_system' ? 400 : r.error === 'session_full' ? 503 : 403
      return bad(reply, status, r.error)
    }
    return { playerId: r.playerId, token: r.token, rejoinCode: r.rejoinCode, session: room.code }
  })

  // As many as the joins: a room whose network failed may come back on other devices together.
  const rejoinLimit = minuteLimiter(300, config.wallNow)
  fastify.post('/api/rejoin', async (req, reply) => {
    const body = RejoinBody.safeParse(req.body)
    if (!body.success) return bad(reply, 400, 'bad_message')
    if (!rejoinLimit()) return bad(reply, 429, 'rate_limited')
    const room = manager.wake(normalizeCode(body.data.code))
    if (!room || room.state.closed) return bad(reply, 404, 'unknown_session')
    const r = room.rejoin(body.data.rejoinCode)
    if (!r.ok) return bad(reply, r.error === 'removed' ? 403 : 404, r.error === 'unknown_player' ? 'not_found' : r.error)
    return { playerId: r.playerId, token: r.token, rejoinCode: r.rejoinCode, session: room.code }
  })

  // A single-player game (section 6.14): a session of its own for one practice, with no
  // facilitator. Refused while the switch is off, while too many are being played, and for an
  // address that starts them faster than a person would.
  const soloLimit = minuteLimiter(120, config.wallNow)
  const soloByAddress = new Map<string, number[]>()
  const addressAllowed = (address: string): boolean => {
    const now = config.wallNow()
    for (const [a, times] of soloByAddress) if (!times.length || now - times.at(-1)! > 600_000) soloByAddress.delete(a)
    const times = (soloByAddress.get(address) ?? []).filter((t) => now - t <= 600_000)
    if (times.length >= config.soloPerAddress) return false
    soloByAddress.set(address, [...times, now])
    return true
  }
  // The passcode of a single-player game. A wrong one delays the next attempt by a second
  // more, up to 30, with a count of its own: guessing here never slows a facilitator's sign-in.
  let soloFailures = 0
  let nextSoloAt = 0
  const soloPasscodeOk = async (given: string | undefined): Promise<boolean> => {
    const gate = manager.soloGate()
    if (gate.mode === 'none') return true
    const wait = nextSoloAt - config.wallNow()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    const ok = typeof given === 'string' && (gate.mode === 'facilitator' ? samePasscode(given, config.hostPasscode) : samePasscode(hashToken(given.trim()), gate.hash ?? ''))
    if (ok) soloFailures = 0
    else {
      soloFailures++
      nextSoloAt = config.wallNow() + Math.min(30, soloFailures) * 1000
    }
    return ok
  }
  fastify.post('/api/solo', async (req, reply) => {
    const body = SoloBody.safeParse(req.body)
    if (!body.success) return bad(reply, 400, 'bad_message')
    if (!manager.soloEnabled()) return bad(reply, 403, 'solo_off')
    const named = checkName(body.data.name, pack.game.join.practice_name, () => false)
    if (!named.ok) return bad(reply, 400, named.error)
    if (!soloLimit() || !addressAllowed(req.ip)) return bad(reply, 429, 'rate_limited')
    if (!(await soloPasscodeOk(body.data.passcode))) return bad(reply, 401, 'wrong_passcode')
    const made = manager.createSolo(named.name)
    if (!made.ok) return bad(reply, 503, made.error)
    const r = made.room.join(named.name, body.data.avatar)
    if (!r.ok) {
      manager.remove(made.room.code)
      return bad(reply, 400, r.error)
    }
    return { playerId: r.playerId, token: r.token, rejoinCode: r.rejoinCode, session: made.room.code }
  })

  // The games a browser kept (section 7.7), each named by its session code and the rejoin code
  // of its practice. A game the server no longer holds is left out of the reply.
  const resultsLimit = minuteLimiter(240, config.wallNow)
  fastify.post('/api/results', async (req, reply) => {
    const body = ResultsBody.safeParse(req.body)
    if (!body.success) return bad(reply, 400, 'bad_message')
    if (!resultsLimit()) return bad(reply, 429, 'rate_limited')
    const games: GameSummary[] = []
    for (const g of body.data.games) {
      const row = db.session(normalizeCode(g.session))
      const auth = row ? db.authByRejoin(row.code, normalizeCode(g.rejoinCode)) : undefined
      if (!row || !auth?.player_id) continue
      const room = manager.get(row.code)
      let card: unknown = room ? room.reportCard(auth.player_id) : null
      const stored = room ? undefined : db.result(row.code, auth.player_id)
      if (stored) { try { card = JSON.parse(stored) } catch { card = null } }
      const checked = ReportCard.safeParse(card)
      const p = room?.state.players[auth.player_id]
      if (p?.removed) continue
      // Open: its practice can go back in. A single-player game that was set aside counts, unless the content changed since.
      const open = row.closed === null && (room ? !room.state.closed : row.kind === 'solo' && row.content_hash === pack.hash)
      games.push({
        session: row.code, label: row.label, kind: row.kind, startedAtMs: row.created, open,
        stage: room ? room.state.stage : row.closed !== null ? 'closed' : row.stage,
        name: p?.name ?? (checked.success ? checked.data.practice.name : row.kind === 'solo' ? row.created_by : ''),
        card: checked.success ? checked.data : null,
        review: room ? room.state.closedPhases.length > 0 : db.hasReview(row.code, auth.player_id),
      })
    }
    reply.header('cache-control', 'no-store')
    return { games }
  })

  // A game to look at again (section 7.5): the report card and every phase as the practice saw
  // it at its reveal. Asked like a result. A session in memory answers from its state.
  fastify.post('/api/review', async (req, reply) => {
    const body = ResultBody.safeParse(req.body)
    if (!body.success) return bad(reply, 400, 'bad_message')
    if (!resultLimit()) return bad(reply, 429, 'rate_limited')
    const rejoin = normalizeCode(body.data.rejoinCode)
    for (const row of db.sessionsNamed(normalizeCode(body.data.session), body.data.session)) {
      const auth = rejoin ? db.authByRejoin(row.code, rejoin) : undefined
      if (!auth?.player_id) continue
      const room = manager.get(row.code)
      let review: unknown = null
      let card: unknown = null
      if (room) {
        const r = room.review(auth.player_id)
        review = r ? { ...r.base, ...r.mine } : null
        card = room.reportCard(auth.player_id)
      } else {
        const kept = db.review(row.code, auth.player_id)
        const stored = db.result(row.code, auth.player_id)
        try {
          if (kept) review = { ...(JSON.parse(gunzipSync(kept.base).toString()) as object), ...(JSON.parse(gunzipSync(kept.review).toString()) as object) }
          if (stored) card = JSON.parse(stored)
        } catch { review = null }
      }
      const checked = Review.safeParse(review)
      if (review && !checked.success) log.error('review refused by its schema', { code: row.code, issue: checked.error.issues[0]?.path.join('.') })
      if (!checked.success) continue
      const cardOk = ReportCard.safeParse(card)
      reply.header('cache-control', 'no-store')
      return { card: cardOk.success ? cardOk.data : null, review: checked.data }
    }
    return bad(reply, 404, 'not_found')
  })

  // A player's report card, during the game once a phase is scored and for as long as the
  // session is kept (section 7.2). The session is named by its code or its label, the practice
  // by its rejoin code. A wrong session and a wrong code get the same answer. The limit leaves
  // room for a whole room that opens its report cards and looks at the phases again in the same
  // minute, and is still far too low to guess a code.
  const resultLimit = minuteLimiter(600, config.wallNow)
  fastify.post('/api/result', async (req, reply) => {
    const body = ResultBody.safeParse(req.body)
    if (!body.success) return bad(reply, 400, 'bad_message')
    if (!resultLimit()) return bad(reply, 429, 'rate_limited')
    const rejoin = normalizeCode(body.data.rejoinCode)
    for (const row of db.sessionsNamed(normalizeCode(body.data.session), body.data.session)) {
      const auth = rejoin ? db.authByRejoin(row.code, rejoin) : undefined
      if (!auth?.player_id) continue
      const room = manager.get(row.code)
      // A session in memory answers from its state, so a card is never older than the game.
      const stored = room ? null : db.result(row.code, auth.player_id)
      let card: unknown = room ? room.reportCard(auth.player_id) : null
      if (stored) { try { card = JSON.parse(stored) } catch { card = null } }
      const checked = ReportCard.safeParse(card)
      if (card && !checked.success) log.error('report card refused by its schema', { code: row.code, issue: checked.error.issues[0]?.path.join('.') })
      if (checked.success) {
        reply.header('cache-control', 'no-store')
        return { card: checked.data }
      }
    }
    return bad(reply, 404, 'not_found')
  })

  const bearer = (req: FastifyRequest) => {
    const h = req.headers.authorization
    return h && h.startsWith('Bearer ') ? h.slice(7).trim() : null
  }

  fastify.get<{ Params: { phase: string } }>('/api/content/:phase', async (req, reply) => {
    const token = bearer(req)
    const row = token ? db.auth(hashToken(token)) : undefined
    if (!row || row.role !== 'player' || !row.code || !row.player_id) return bad(reply, 401, 'unauthorized')
    const room = manager.wake(row.code)
    const phase = req.params.phase as PhaseId
    if (!room || !(PHASES as readonly string[]).includes(phase)) return bad(reply, 404, 'not_found')
    const p = room.state.players[row.player_id]
    if (!p || p.removed) return bad(reply, 403, 'removed')
    if (!room.state.opened.includes(phase)) return bad(reply, 403, 'not_open')
    const content = phase === 'planning' ? project.planningContent(room.state, pack, row.player_id)
      : phase === 'development' ? project.developmentContent(room.state, pack, row.player_id)
        : project.maintainingContent(room.state, pack, row.player_id)
    const checked = PhaseContent.safeParse(content)
    if (!checked.success) {
      log.error('content refused by its schema', { phase, issue: checked.error.issues[0]?.path.join('.') })
      return bad(reply, 500, 'internal')
    }
    const body = JSON.stringify(content)
    const etag = `"${createHash('sha256').update(body).digest('hex').slice(0, 20)}"`
    reply.header('etag', etag).header('cache-control', 'private, no-cache')
    if (req.headers['if-none-match'] === etag) return reply.code(304).send()
    return reply.type('application/json').send(body)
  })

  // Pack art: public by definition.
  const artRoot = resolve(config.contentDir, 'art')
  const ART_TYPES: Record<string, string> = { '.png': 'image/png', '.json': 'application/json', '.webp': 'image/webp' }
  fastify.get<{ Params: { hash: string; '*': string } }>('/pack-art/:hash/*', async (req, reply) => {
    if (req.params.hash !== pack.hash.slice(0, 12)) return bad(reply, 404, 'not_found')
    const file = resolve(artRoot, req.params['*'])
    const type = ART_TYPES[extname(file)]
    if (!file.startsWith(artRoot + sep) || !type || !existsSync(file)) return bad(reply, 404, 'not_found')
    reply.header('cache-control', 'public, max-age=31536000, immutable')
    return reply.type(type).send(readFileSync(file))
  })

  // Anyone can read this address, so it never carries a join code, a label or a name (section 7).
  fastify.get('/healthz', async () => ({
    build: config.build,
    uptime: Math.round((config.wallNow() - startedAt) / 1000),
    content: pack.hash.slice(0, 12),
    sessions: manager.running().map((r) => ({ stage: r.state.stage, players: r.state.order.length })),
    solo: manager.soloLive(),
  }))

  // ----------------------------------------------------------------------------------------
  // Host API
  // ----------------------------------------------------------------------------------------
  let failures = 0
  let nextLoginAt = 0
  const checkPasscode = async (given: unknown): Promise<boolean> => {
    const wait = nextLoginAt - config.wallNow()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    const ok = typeof given === 'string' && samePasscode(given, config.hostPasscode)
    if (ok) failures = 0
    else {
      failures++
      nextLoginAt = config.wallNow() + Math.min(30, failures) * 1000
    }
    return ok
  }
  const isHost = (req: FastifyRequest) => {
    const token = bearer(req)
    return !!token && db.auth(hashToken(token))?.role === 'host'
  }

  fastify.post('/api/host/login', async (req, reply) => {
    const passcode = (req.body as { passcode?: unknown } | null)?.passcode
    if (!(await checkPasscode(passcode))) return bad(reply, 401, 'wrong_passcode')
    const token = newToken()
    db.insertAuth({ token_hash: hashToken(token), role: 'host', code: null, player_id: null, rejoin_code: null, created: config.wallNow() })
    return { token }
  })

  fastify.get('/api/host/sessions', async (req, reply) => {
    if (!isHost(req)) return bad(reply, 401, 'unauthorized')
    const kept = db.resultCounts()
    const out: (SessionSummary & { broken?: string })[] = db.sessions('multi').reverse().map((row) => {
      const room = manager.get(row.code)
      const summary: SessionSummary & { broken?: string } = {
        code: row.code, label: row.label, mode: row.mode, stage: room?.state.stage ?? 'closed',
        players: room ? room.state.order.length : 0, closed: row.closed !== null || !room, createdAt: row.created,
        createdBy: row.created_by, results: kept.get(row.code) ?? 0,
      }
      const reason = manager.broken.get(row.code)
      if (reason) summary.broken = reason
      return summary
    })
    // Single-player games are many, so the console gets their numbers and the newest fifty.
    const counts = db.soloCounts()
    const solo: SoloOverview = {
      enabled: manager.soloEnabled(), gate: manager.soloGate().mode, total: counts.total, finished: counts.finished, unfinished: counts.total - counts.finished,
      live: manager.soloLive(), cap: config.soloMax,
      recent: db.soloRecent(50).map((row) => ({ code: row.code, name: row.created_by, createdAt: row.created, closed: row.closed !== null, live: !!manager.get(row.code) })),
    }
    return {
      sessions: out,
      solo,
      pack: {
        title: pack.game.game.title, hash: pack.hash.slice(0, 12), systems: pack.systemIds,
        systemNames: pack.systemIds.map((id) => pack.systems[id]!.system.public.name),
        placeholders: (pack.deck?.sections ?? []).reduce((n, sec) => n + sec.slides.filter((sl) => sl.placeholder).length, 0),
        phasesAvailable: pack.phasesAvailable, provisional: pack.provisional,
        pickModes: pack.game.join.choose_system_in_modes ?? [],
        guide: !!config.facilitatorGuideFile && existsSync(config.facilitatorGuideFile),
        slides: deckSlides(pack).length,
      },
    }
  })

  fastify.post('/api/host/session', async (req, reply) => {
    if (!isHost(req)) return bad(reply, 401, 'unauthorized')
    const body = CreateSessionBody.safeParse(req.body)
    if (!body.success) {
      // Name the field that is wrong, so the console can say so beside it.
      const field = body.error.issues[0]?.path[0]
      return bad(reply, 400, field === 'code' ? 'code_invalid' : 'bad_message')
    }
    const r = manager.create(body.data.label, body.data.mode, { code: body.data.code, by: body.data.by, replace: body.data.replace })
    // One session with a facilitator at a time: the refusal says what runs, so the console can ask.
    if (!r.ok && r.error === 'session_running') return reply.code(409).send({ error: r.error, running: r.running })
    if (!r.ok) return bad(reply, 409, r.error)
    return { code: r.room.code }
  })

  fastify.patch<{ Params: { code: string } }>('/api/host/session/:code', async (req, reply) => {
    if (!isHost(req)) return bad(reply, 401, 'unauthorized')
    const body = RenameSessionBody.safeParse(req.body)
    if (!body.success || !body.data.label.trim()) return bad(reply, 400, 'bad_message')
    const r = manager.rename(normalizeCode(req.params.code), body.data.label.trim())
    if (r === 'unknown_session') return bad(reply, 404, r)
    if (r !== 'ok') return bad(reply, 409, 'rename_running')
    return { ok: true }
  })

  // Single-player games: the switch, who may start one, and the cleanup of all of them at once
  // (section 7.2). A passcode of its own has four characters or more. Its text is kept beside its
  // hash, because a slide of the deck may show it to the room (`solo_passcode`).
  fastify.post('/api/host/solo', async (req, reply) => {
    if (!isHost(req)) return bad(reply, 401, 'unauthorized')
    const b = (req.body ?? {}) as { enabled?: unknown; gate?: unknown; passcode?: unknown }
    const gate = b.gate === undefined ? null : SoloGate.safeParse(b.gate)
    if ((b.enabled === undefined && gate === null) || (b.enabled !== undefined && typeof b.enabled !== 'boolean') || (gate !== null && !gate.success)) return bad(reply, 400, 'bad_message')
    if (gate?.success && gate.data === 'custom') {
      if (typeof b.passcode !== 'string' || b.passcode.trim().length < 4 || b.passcode.length > 200) return bad(reply, 400, 'passcode_short')
      manager.setSoloGate('custom', b.passcode.trim())
    } else if (gate?.success) manager.setSoloGate(gate.data)
    if (typeof b.enabled === 'boolean') manager.setSoloEnabled(b.enabled)
    return { enabled: manager.soloEnabled(), gate: manager.soloGate().mode }
  })
  fastify.post('/api/host/solo/delete-all', async (req, reply) => {
    if (!isHost(req)) return bad(reply, 401, 'unauthorized')
    if ((req.body as { confirm?: unknown } | null)?.confirm !== 'DELETE') return bad(reply, 409, 'confirm_delete')
    return { deleted: manager.removeAllSolo() }
  })

  fastify.post<{ Params: { code: string } }>('/api/host/session/:code/end', async (req, reply) => {
    if (!isHost(req)) return bad(reply, 401, 'unauthorized')
    const by = (req.body as { name?: unknown } | null)?.name
    const r = manager.end(normalizeCode(req.params.code), typeof by === 'string' ? by.slice(0, 80) : '')
    if (r === 'unknown_session') return bad(reply, 404, r)
    if (r !== 'ok') return bad(reply, 409, r)
    return { ok: true }
  })

  fastify.delete<{ Params: { code: string } }>('/api/host/session/:code', async (req, reply) => {
    if (!isHost(req)) return bad(reply, 401, 'unauthorized')
    const r = manager.remove(normalizeCode(req.params.code))
    if (r === 'unknown_session') return bad(reply, 404, r)
    if (r === 'session_open') return bad(reply, 409, 'wrong_stage')
    return { ok: true }
  })

  fastify.post('/api/host/screen-link', async (req, reply) => {
    if (!isHost(req)) return bad(reply, 401, 'unauthorized')
    const code = normalizeCode(String((req.body as { code?: unknown } | null)?.code ?? ''))
    // A single-player game has no projector.
    if (manager.get(code)?.kind !== 'multi') return bad(reply, 404, 'unknown_session')
    const token = newToken()
    db.insertAuth({ token_hash: hashToken(token), role: 'screen', code, player_id: null, rejoin_code: null, created: config.wallNow() })
    return { path: `/screen#${token}` }
  })

  // The two private pages, the answer key and the facilitator guide: to any signed-in host, with
  // one press (section 7.2). A page opens in a window of its own, which cannot send the host
  // token, so the console first asks for a ticket that is valid for five minutes.
  const tickets = new Map<string, { until: number; file: string }>()
  const privatePage = (name: 'key' | 'guide', file: () => string | null, missing: 'no_answer_key' | 'no_guide') => {
    fastify.post(`/api/host/${name}-ticket`, async (req, reply) => {
      if (!isHost(req)) return bad(reply, 401, 'unauthorized')
      const path = file()
      if (!path || !existsSync(path)) return bad(reply, 404, missing)
      for (const [t, x] of tickets) if (x.until < config.wallNow()) tickets.delete(t)
      const ticket = randomBytes(24).toString('base64url')
      tickets.set(ticket, { until: config.wallNow() + 5 * 60_000, file: path })
      return { ticket }
    })
    fastify.get<{ Querystring: { ticket?: string } }>(`/api/host/${name}`, async (req, reply) => {
      const x = tickets.get(req.query.ticket ?? '')
      if (!x || x.until < config.wallNow() || x.file !== file() || !existsSync(x.file)) return bad(reply, 401, 'unauthorized')
      reply.header('cache-control', 'no-store')
      // A private page carries its own inline styles and scripts.
      reply.header('content-security-policy-override', '1')
      return reply.type('text/html; charset=utf-8').send(readFileSync(x.file))
    })
  }
  privatePage('key', () => config.answerKeyFile, 'no_answer_key')
  privatePage('guide', () => config.facilitatorGuideFile, 'no_guide')

  // What the pages of a facilitator can link to (section 10.8): the two private pages that this
  // server holds, and the number of slides in the deck.
  fastify.get('/api/host/pages', async (req, reply) => {
    if (!isHost(req)) return bad(reply, 401, 'unauthorized')
    reply.header('cache-control', 'no-store')
    return {
      guide: !!config.facilitatorGuideFile && existsSync(config.facilitatorGuideFile),
      key: !!config.answerKeyFile && existsSync(config.answerKeyFile),
      slides: deckSlides(pack).length,
    }
  })

  // Every slide of the deck from the first to the last, for the page /host/slides (section 10.8).
  // It needs no session. While a session with a facilitator is open, the slides carry the numbers
  // of that room. Otherwise they are drawn as they stand before anybody has joined.
  fastify.get('/api/host/slides', async (req, reply) => {
    if (!isHost(req)) return bad(reply, 401, 'unauthorized')
    const room = manager.newestOpen()
    const deck = room
      ? room.hostDeck()
      : project.hostDeck(createSession(pack, { code: 'SLIDES', label: '', mode: 'rehearsal', nowMs: 0 }), pack, { soloPasscode: soloPasscodeAsked(db, config) })
    const out = { slides: deck.slides, joinUrl: config.publicUrl.replace(/\/$/, '') }
    const checked = HostSlides.safeParse(out)
    if (!checked.success) {
      log.error('slides refused by their schema', { issue: checked.error.issues[0]?.path.join('.') })
      return bad(reply, 500, 'internal')
    }
    reply.header('cache-control', 'no-store')
    return out
  })

  // The whole deck with its notes, for a host who looks through the slides alone (section 10.8).
  fastify.get<{ Params: { code: string } }>('/api/host/deck/:code', async (req, reply) => {
    if (!isHost(req)) return bad(reply, 401, 'unauthorized')
    const room = manager.get(normalizeCode(req.params.code))
    if (!room || room.kind !== 'multi') return bad(reply, 404, 'unknown_session')
    const deck = room.hostDeck()
    const checked = HostDeck.safeParse(deck)
    if (!checked.success) {
      log.error('deck refused by its schema', { issue: checked.error.issues[0]?.path.join('.') })
      return bad(reply, 500, 'internal')
    }
    reply.header('cache-control', 'no-store')
    return deck
  })

  fastify.get<{ Params: { code: string }; Querystring: { what?: string; format?: string } }>('/api/host/export/:code', async (req, reply) => {
    if (!isHost(req)) return bad(reply, 401, 'unauthorized')
    const room = manager.get(normalizeCode(req.params.code))
    // A single-player game has no facilitator, and nothing of it is handed to one (section 6.14).
    if (db.session(normalizeCode(req.params.code))?.kind !== 'multi') return bad(reply, 404, 'unknown_session')
    const out = exportSession(db, room ?? null, normalizeCode(req.params.code), req.query.what ?? 'results', req.query.format ?? 'json')
    reply.header('content-disposition', `attachment; filename="${out.filename}"`)
    return reply.type(out.type).send(out.body)
  })

  // ----------------------------------------------------------------------------------------
  // The client application
  // ----------------------------------------------------------------------------------------
  const clientDir = config.clientDir
  const indexHtml = clientDir && existsSync(join(clientDir, 'index.html')) ? join(clientDir, 'index.html') : null
  if (clientDir && existsSync(clientDir)) {
    fastify.register(fastifyStatic, {
      root: clientDir, prefix: '/', index: false, wildcard: true, decorateReply: false,
      setHeaders: (res, path) => {
        res.header('cache-control', path.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'public, max-age=3600')
      },
    })
  }
  const sendIndex = (reply: FastifyReply) => {
    if (!indexHtml) return reply.type('text/plain').send('The client is not built. Run npm run dev, or npm run build.')
    reply.header('cache-control', 'no-cache')
    return reply.type('text/html; charset=utf-8').send(readFileSync(indexHtml))
  }
  fastify.get('/', async (_req, reply) => {
    const room = manager.newestOpen()
    if (room) return reply.redirect(`/j/${room.code}`)
    return sendIndex(reply)
  })
  for (const route of ['/j/:code', '/home', '/play', '/host', '/host/manual', '/host/guide', '/host/slides', '/screen', '/rejoin', '/result', '/result/:code']) fastify.get(route, async (_req, reply) => sendIndex(reply))

  // The key page keeps its own scripts, so it gets a looser policy than the game.
  fastify.addHook('onSend', async (_req, reply, payload) => {
    if (reply.getHeader('content-security-policy-override')) {
      reply.removeHeader('content-security-policy-override')
      reply.header('content-security-policy', "default-src 'self' 'unsafe-inline' data:; frame-ancestors 'none'")
    }
    return payload
  })

  // ----------------------------------------------------------------------------------------
  // Sockets (section 7.3)
  // ----------------------------------------------------------------------------------------
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE, perMessageDeflate: false })
  const allowedOrigin = (origin: string | undefined) => {
    if (!origin) return true // not a browser
    if (origin === pub.origin) return true
    if (!config.production) {
      try {
        const h = new URL(origin).hostname
        return h === 'localhost' || h === '127.0.0.1' || /^\d+\.\d+\.\d+\.\d+$/.test(h) || h.endsWith('.local')
      } catch { return false }
    }
    return false
  }
  fastify.server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const path = (req.url ?? '').split('?')[0]
    if (path !== '/ws' || !allowedOrigin(req.headers.origin)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
  })

  type Live = { ws: WebSocket; sock: Sock; room: Room | null; alive: boolean; missed: number; times: number[] }
  const live = new Set<Live>()

  wss.on('connection', (ws: WebSocket) => {
    const sock: Sock = {
      send: (d) => { if (ws.readyState === ws.OPEN) ws.send(d) },
      close: (c, r) => ws.close(c, r),
      get bufferedAmount() { return ws.bufferedAmount },
      role: 'player',
    }
    const conn: Live = { ws, sock, room: null, alive: true, missed: 0, times: [] }
    live.add(conn)
    const helloTimer = setTimeout(() => ws.close(CLOSE.helloTimeout, 'no hello'), 5000)
    const refuse = (code: number, error: string) => {
      ws.send(JSON.stringify({ t: 'error', error }))
      ws.close(code, error)
    }

    ws.on('error', () => { /* a protocol error closes the socket; close follows */ })
    ws.on('pong', () => { conn.alive = true; conn.missed = 0 })
    ws.on('close', () => {
      clearTimeout(helloTimer)
      conn.room?.detach(sock)
      live.delete(conn)
    })
    ws.on('message', (data, isBinary) => {
      if (isBinary) return ws.close(1003, 'binary')
      let msg: unknown
      try { msg = JSON.parse(data.toString()) } catch { return ws.close(1007, 'not JSON') }

      if (!conn.room) {
        const hello = Hello.safeParse(msg)
        if (!hello.success) return ws.close(1008, 'hello expected')
        clearTimeout(helloTimer)
        const h = hello.data
        if (needsReload(h.build, config.build)) {
          ws.send(JSON.stringify({ t: 'reload' }))
          return ws.close(1000, 'reload')
        }
        const row = db.auth(hashToken(h.token))
        if (!row) return refuse(CLOSE.unauthorized, 'unauthorized')
        if (row.role === 'host') {
          // A single-player game has no console: nobody watches it or helps in it.
          const room = h.session ? manager.get(h.session) : undefined
          if (!room || room.kind !== 'multi') return refuse(CLOSE.closed, 'unknown_session')
          conn.room = room
          room.attachHost(sock, h.name ?? '', h.console ?? '')
          return
        }
        const room = row.code ? manager.wake(row.code) : undefined
        if (!room) return refuse(CLOSE.closed, 'unknown_session')
        if (row.role === 'screen') {
          conn.room = room
          room.attachScreen(sock)
          return
        }
        const p = row.player_id ? room.state.players[row.player_id] : undefined
        if (!p) return refuse(CLOSE.unauthorized, 'unauthorized')
        if (p.removed) return refuse(CLOSE.removed, 'removed')
        conn.room = room
        room.attachPlayer(sock, p.id, h.build)
        return
      }

      // After hello: rate limit, then commands.
      const now = config.wallNow()
      while (conn.times.length && now - conn.times[0]! > RATE_WINDOW_MS) conn.times.shift()
      conn.times.push(now)
      const limited = conn.times.length > RATE_MAX
      if (sock.role === 'player') {
        const env = CmdEnvelope.safeParse(msg)
        if (!env.success) return sock.send(JSON.stringify({ t: 'error', error: 'bad_message' }))
        if (limited) return sock.send(JSON.stringify({ t: 'ack', cid: env.data.cid, ok: false, error: 'rate_limited' }))
        conn.room.playerCommand(sock, env.data.cid, env.data.type, env.data.payload)
      } else if (sock.role === 'host') {
        const env = HostCmdEnvelope.safeParse(msg)
        if (!env.success) return sock.send(JSON.stringify({ t: 'error', error: 'bad_message' }))
        if (limited) return sock.send(JSON.stringify({ t: 'ack', cid: env.data.cid, ok: false, error: 'rate_limited' }))
        conn.room.hostCommand(sock, env.data.cid, env.data.type, env.data.payload)
      }
      else {
        // A screen sends nothing after hello (section 7.10): one that does is closed.
        ws.close(1008, 'a screen sends nothing')
      }
    })
  })

  const pinger = setInterval(() => {
    for (const c of live) {
      if (!c.alive) {
        c.missed++
        if (c.missed >= 2) { c.ws.terminate(); continue }
      }
      c.alive = false
      try { c.ws.ping() } catch { /* closing */ }
    }
  }, 15_000)

  let address = ''
  return {
    config, pack, manager, db, log,
    async listen() {
      address = await fastify.listen({ port: config.port, host: config.host })
      manager.start()
      log.info('listening', { address, build: config.build, content: pack.hash.slice(0, 12), systems: pack.systemIds })
      return address
    },
    url: () => address,
    async close() {
      clearInterval(pinger)
      manager.shutdown()
      for (const c of live) c.ws.terminate()
      wss.close()
      await fastify.close()
      db.close()
    },
  }
}
