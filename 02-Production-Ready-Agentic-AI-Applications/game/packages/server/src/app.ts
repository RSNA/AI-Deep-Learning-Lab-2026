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
import { canPickSystem, joinOpen, project } from '@lab02/engine'
import {
  CLOSE, CmdEnvelope, Hello, JoinBody, PHASES, PhaseContent, RejoinBody, normalizeCode,
  type PhaseId, type SessionPublic,
} from '@lab02/protocol'
import { CreateSessionBody, HostCmdEnvelope, type SessionSummary } from '@lab02/protocol/host'
import { hashToken, newToken, samePasscode } from './auth.ts'
import { configFromEnv, type Config } from './config.ts'
import { Storage } from './db.ts'
import { exportSession } from './export.ts'
import { createLogger, type Logger } from './log.ts'
import { Manager } from './manager.ts'
import type { Room, Sock } from './room.ts'

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
      code: s.code, label: s.label, title: pack.game.game.title, stage: s.stage,
      joinOpen: joinOpen(s, pack, room.now()),
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

  const rejoinLimit = minuteLimiter(60, config.wallNow)
  fastify.post('/api/rejoin', async (req, reply) => {
    const body = RejoinBody.safeParse(req.body)
    if (!body.success) return bad(reply, 400, 'bad_message')
    if (!rejoinLimit()) return bad(reply, 429, 'rate_limited')
    const room = manager.get(normalizeCode(body.data.code))
    if (!room || room.state.closed) return bad(reply, 404, 'unknown_session')
    const r = room.rejoin(body.data.rejoinCode)
    if (!r.ok) return bad(reply, r.error === 'removed' ? 403 : 404, r.error === 'unknown_player' ? 'not_found' : r.error)
    return { playerId: r.playerId, token: r.token, rejoinCode: r.rejoinCode, session: room.code }
  })

  const bearer = (req: FastifyRequest) => {
    const h = req.headers.authorization
    return h && h.startsWith('Bearer ') ? h.slice(7).trim() : null
  }

  fastify.get<{ Params: { phase: string } }>('/api/content/:phase', async (req, reply) => {
    const token = bearer(req)
    const row = token ? db.auth(hashToken(token)) : undefined
    if (!row || row.role !== 'player' || !row.code || !row.player_id) return bad(reply, 401, 'unauthorized')
    const room = manager.get(row.code)
    const phase = req.params.phase as PhaseId
    if (!room || !(PHASES as readonly string[]).includes(phase)) return bad(reply, 404, 'not_found')
    const p = room.state.players[row.player_id]
    if (!p || p.removed) return bad(reply, 403, 'removed')
    if (!room.state.opened.includes(phase)) return bad(reply, 403, 'not_open')
    if (phase !== 'planning') return bad(reply, 404, 'not_available')
    const content = project.planningContent(room.state, pack, row.player_id)
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

  fastify.get('/healthz', async () => ({
    build: config.build,
    uptime: Math.round((config.wallNow() - startedAt) / 1000),
    content: pack.hash.slice(0, 12),
    sessions: [...manager.rooms.values()].filter((r) => !r.state.closed).map((r) => ({ code: r.code, stage: r.state.stage, players: r.state.order.length })),
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
    const out: (SessionSummary & { broken?: string })[] = db.sessions().reverse().map((row) => {
      const room = manager.get(row.code)
      const summary: SessionSummary & { broken?: string } = {
        code: row.code, label: row.label, mode: row.mode, stage: room?.state.stage ?? 'closed',
        players: room ? room.state.order.length : 0, closed: row.closed !== null || !room, createdAt: row.created,
      }
      const reason = manager.broken.get(row.code)
      if (reason) summary.broken = reason
      return summary
    })
    return {
      sessions: out,
      pack: {
        title: pack.game.game.title, hash: pack.hash.slice(0, 12), systems: pack.systemIds,
        systemNames: pack.systemIds.map((id) => pack.systems[id]!.system.public.name),
        placeholders: (pack.deck?.sections ?? []).reduce((n, sec) => n + sec.slides.filter((sl) => sl.placeholder).length, 0),
        phasesAvailable: pack.phasesAvailable, provisional: pack.provisional,
        pickModes: pack.game.join.choose_system_in_modes ?? [],
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
    const r = manager.create(body.data.label, body.data.mode, body.data.code)
    if (!r.ok) return bad(reply, 409, r.error)
    return { code: r.room.code }
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
    if (!manager.get(code)) return bad(reply, 404, 'unknown_session')
    const token = newToken()
    db.insertAuth({ token_hash: hashToken(token), role: 'screen', code, player_id: null, rejoin_code: null, created: config.wallNow() })
    return { path: `/screen#${token}` }
  })

  // The answer key: only to a host who entered the passcode again in the last five minutes.
  const tickets = new Map<string, number>()
  fastify.post('/api/host/key-ticket', async (req, reply) => {
    if (!isHost(req)) return bad(reply, 401, 'unauthorized')
    if (!config.answerKeyFile || !existsSync(config.answerKeyFile)) return bad(reply, 404, 'no_answer_key')
    if (!(await checkPasscode((req.body as { passcode?: unknown } | null)?.passcode))) return bad(reply, 401, 'wrong_passcode')
    const ticket = randomBytes(24).toString('base64url')
    tickets.set(ticket, config.wallNow() + 5 * 60_000)
    return { ticket }
  })
  fastify.get<{ Querystring: { ticket?: string } }>('/api/host/key', async (req, reply) => {
    const t = req.query.ticket ?? ''
    const until = tickets.get(t)
    if (!until || until < config.wallNow() || !config.answerKeyFile || !existsSync(config.answerKeyFile)) return bad(reply, 401, 'unauthorized')
    reply.header('cache-control', 'no-store')
    // The key page carries its own inline styles and scripts.
    reply.header('content-security-policy-override', '1')
    return reply.type('text/html; charset=utf-8').send(readFileSync(config.answerKeyFile))
  })

  fastify.get<{ Params: { code: string }; Querystring: { what?: string; format?: string } }>('/api/host/export/:code', async (req, reply) => {
    if (!isHost(req)) return bad(reply, 401, 'unauthorized')
    const room = manager.get(normalizeCode(req.params.code))
    if (!db.session(normalizeCode(req.params.code))) return bad(reply, 404, 'unknown_session')
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
  for (const route of ['/j/:code', '/play', '/host', '/host/manual', '/screen', '/rejoin']) fastify.get(route, async (_req, reply) => sendIndex(reply))

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
          const room = h.session ? manager.get(h.session) : undefined
          if (!room) return refuse(CLOSE.closed, 'unknown_session')
          conn.room = room
          room.attachHost(sock, h.name ?? '', h.console ?? '')
          return
        }
        const room = row.code ? manager.get(row.code) : undefined
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
