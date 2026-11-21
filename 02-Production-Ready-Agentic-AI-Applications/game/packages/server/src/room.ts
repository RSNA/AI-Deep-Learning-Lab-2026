// One session in memory: its state, its clock, its sockets, and its log on disk
// (engineering spec, sections 3, 7.3 to 7.7).
import { existsSync } from 'node:fs'
import type { Pack } from '@lab02/content-schema'
import {
  advance, apply, createSession, project,
  type Command, type Outcome, type PlayerId, type SessionState,
} from '@lab02/engine'
import { ENGINE_HOST_COMMANDS } from '@lab02/engine'
import {
  CLOSE, PLAY_STAGES, PROTOCOL_VERSION, PlayerCommand, PlayerServerMessage, ScreenServerMessage, normalizeCode,
  type ErrorCode, type Mode, type StageId,
} from '@lab02/protocol'
import { HostServerMessage } from '@lab02/protocol/host'
import { hashToken, newCode, newPlayerId, newToken } from './auth.ts'
import type { Config } from './config.ts'
import type { CommandRow, Storage } from './db.ts'
import type { Logger } from './log.ts'

export type Sock = {
  send(data: string): void
  close(code?: number, reason?: string): void
  readonly bufferedAmount: number
  role: 'player' | 'host' | 'screen'
  playerId?: string
  spectating?: string | null
  hostName?: string
  hostSeq?: number
  consoleId?: string
}

/** Section 7.10: control stays with a console that drops for this long, then it is free. */
export const CONTROL_GRACE_MS = 20_000

/** Host commands a console may send without holding control: they change nothing in the session. */
const VIEW_ONLY_OK = new Set(['take_control', 'spectate', 'rejoin_code'])

export type Deps = { pack: Pack; db: Storage; config: Config; log: Logger }
type ClockState = { gameMs: number; running: boolean; scale: number; wallAt: number }
type AckRecord = { ok: boolean; error?: ErrorCode; data?: unknown }

const SEND_BUFFER_LIMIT = 1024 * 1024
const DEDUP_SIZE = 50

export class Room {
  readonly code: string
  state: SessionState
  private clock: ClockState
  private readonly players = new Map<PlayerId, Sock>()
  private readonly hosts = new Set<Sock>()
  /**
   * The one console that drives the session (section 7.10). `sock` is null while it has dropped
   * and may come back within the grace time. Null altogether: control is free.
   */
  private controller: { id: string; name: string; sock: Sock | null; droppedAt: number } | null = null
  private everControlled = false
  private hostSeqN = 0
  private readonly screens = new Set<Sock>()
  private readonly dedup = new Map<string, Map<string, AckRecord>>()
  private rejoinCodes: Map<PlayerId, string>
  private stageWall: Partial<Record<StageId, number>> = {}
  private seq: number
  private changed = false
  private hostDirty = true
  private screenDirty = true
  private lastSnapshotWall: number
  private lastClockWrite = 0
  private lastClockSend = 0
  private lastHostSend = 0
  private lastScreenSend = 0

  private constructor(private readonly deps: Deps, state: SessionState, clock: ClockState, seq: number) {
    this.code = state.code
    this.state = state
    this.clock = clock
    this.seq = seq
    this.rejoinCodes = deps.db.rejoinCodes(state.code)
    this.lastSnapshotWall = deps.config.wallNow()
    for (const e of deps.db.events(state.code, 'stage')) {
      const st = (JSON.parse(e.data) as { stage: StageId }).stage
      if (this.stageWall[st] === undefined) this.stageWall[st] = e.wall_ms
    }
  }

  // ----------------------------------------------------------------------------------------
  // Creation and recovery
  // ----------------------------------------------------------------------------------------
  static create(deps: Deps, opts: { code: string; label: string; mode: Mode }): Room {
    const state = createSession(deps.pack, { code: opts.code, label: opts.label, mode: opts.mode, nowMs: 0 })
    const wall = deps.config.wallNow()
    const scale = opts.mode === 'test' ? deps.pack.game.clock.time_scale_default : 1
    deps.db.transaction(() => {
      deps.db.insertSession({ code: opts.code, label: opts.label, mode: opts.mode, content_hash: deps.pack.hash, created: wall, closed: null })
      deps.db.writeClock(opts.code, 0, true, scale)
      deps.db.writeSnapshot(opts.code, 0, 0, JSON.stringify(state), true)
      deps.db.logEvent(opts.code, 'stage', 0, wall, { stage: 'lobby' })
    })
    const room = new Room(deps, state, { gameMs: 0, running: true, scale, wallAt: wall }, 0)
    deps.log.info('session created', { code: opts.code, mode: opts.mode })
    return room
  }

  /** Rebuild a session from its newest snapshot and the commands after it. */
  static restore(deps: Deps, code: string): Room {
    const { db, pack } = deps
    const row = db.session(code)!
    const snap = db.latestSnapshot(code)
    const state: SessionState = snap ? (JSON.parse(snap.state) as SessionState) : createSession(pack, { code, label: row.label, mode: row.mode, nowMs: 0 })
    const cmds = db.commandsAfter(code, snap?.seq ?? 0)
    for (const c of cmds) {
      advance(state, pack, c.game_ms)
      apply(state, pack, toCommand(c), c.game_ms)
    }
    const clk = db.clock(code)
    const gameMs = Math.max(clk?.game_ms ?? 0, cmds.at(-1)?.game_ms ?? 0, snap?.game_ms ?? 0)
    advance(state, pack, gameMs)
    const room = new Room(deps, state, { gameMs, running: !!clk?.running && !state.closed, scale: clk?.scale ?? 1, wallAt: deps.config.wallNow() }, db.lastSeq(code))
    for (const c of cmds) {
      if (c.cid && c.result) room.remember(c.player_id ?? 'host', c.cid, JSON.parse(c.result) as AckRecord)
    }
    room.changed = true
    deps.log.info('session restored', { code, commands: cmds.length, gameMs })
    return room
  }

  // ----------------------------------------------------------------------------------------
  // Clock
  // ----------------------------------------------------------------------------------------
  now(): number {
    const c = this.clock
    return c.running ? c.gameMs + (this.deps.config.wallNow() - c.wallAt) * c.scale : c.gameMs
  }

  clockInfo() {
    return { gameMs: Math.round(this.now()), running: this.clock.running, scale: this.clock.scale }
  }

  private setClock(running: boolean, scale = this.clock.scale): void {
    const gameMs = this.now()
    this.clock = { gameMs, running, scale, wallAt: this.deps.config.wallNow() }
    this.deps.db.writeClock(this.code, gameMs, running, scale)
    this.broadcastClock()
    this.hostDirty = true
  }

  // ----------------------------------------------------------------------------------------
  // The tick: timers, persistence and throttled views
  // ----------------------------------------------------------------------------------------
  tick(): void {
    const wall = this.deps.config.wallNow()
    this.checkControl()
    if (!this.state.closed) this.handle(advance(this.state, this.deps.pack, this.now()))
    if (this.clock.running && wall - this.lastClockWrite >= 1000) {
      this.deps.db.writeClock(this.code, this.now(), true, this.clock.scale)
      this.lastClockWrite = wall
    }
    if (wall - this.lastClockSend >= 5000) this.broadcastClock()
    if (this.changed && wall - this.lastSnapshotWall >= 10_000) this.snapshot(false)
    if (this.hosts.size && (this.hostDirty || wall - this.lastHostSend >= 2000) && wall - this.lastHostSend >= 1000) this.sendHostViews()
    if (this.screens.size && this.screenDirty && wall - this.lastScreenSend >= 1000) this.sendScreenViews()
  }

  snapshot(stageChange: boolean): void {
    this.deps.db.writeSnapshot(this.code, this.seq, this.now(), JSON.stringify(this.state), stageChange)
    if (this.clock.running) this.deps.db.writeClock(this.code, this.now(), true, this.clock.scale)
    this.changed = false
    this.lastSnapshotWall = this.deps.config.wallNow()
  }

  /** Act on what the engine returned: views to the players that changed, announcements. */
  private handle(out: Outcome): void {
    if (out.dirty === 'all' || out.dirty.length || out.events.length) {
      this.changed = true
      this.hostDirty = true
    }
    const dirty = out.dirty === 'all' ? [...this.players.keys()] : out.dirty
    // In a play stage the projector lists what the room does, so it follows every player's move.
    if (dirty.length && PLAY_STAGES.includes(this.state.stage)) this.screenDirty = true
    for (const id of dirty) this.sendView(id)
    let stageChanged = false
    let beat = false
    const wall = this.deps.config.wallNow()
    for (const ev of out.events) {
      switch (ev.kind) {
        case 'stage':
          stageChanged = true
          if (this.stageWall[ev.stage] === undefined) this.stageWall[ev.stage] = wall
          this.deps.db.logEvent(this.code, 'stage', ev.atMs, wall, { stage: ev.stage })
          this.deps.log.info('stage', { code: this.code, stage: ev.stage })
          break
        case 'beat':
          beat = true
          break
        case 'joined':
        case 'renamed':
          this.screenDirty = true
          break
        case 'removed': {
          this.screenDirty = true
          const sock = this.players.get(ev.playerId)
          if (sock) {
            this.players.delete(ev.playerId)
            sock.close(CLOSE.removed, 'removed')
          }
          break
        }
        case 'screen':
          this.screenDirty = true
          break
        case 'moment': {
          const sock = this.players.get(ev.playerId)
          const m = sock ? project.moment(this.state, this.deps.pack, ev.playerId, ev.ref) : null
          if (sock && m) this.sendPlayerMsg(sock, { t: 'moment', moment: m })
          break
        }
        case 'closed':
          this.deps.db.closeSession(this.code, wall)
          this.setClock(false)
          break
      }
      // Interview lines are many and say nothing the tile does not: they are not logged.
      if (ev.kind !== 'beat' && !(ev.kind === 'moment' && ev.ref.type === 'interview_line')) this.deps.db.logEvent(this.code, ev.kind, ev.atMs, wall, ev)
    }
    if (stageChanged) {
      this.snapshot(true)
      this.broadcastClock()
      this.screenDirty = true
      for (const id of this.players.keys()) this.sendStanding(id)
      this.sendScreenViews()
    } else if (beat) {
      for (const id of this.players.keys()) this.sendStanding(id)
      this.screenDirty = true
    }
  }

  // ----------------------------------------------------------------------------------------
  // Sending
  // ----------------------------------------------------------------------------------------
  private sendRaw(sock: Sock, data: string): void {
    if (sock.bufferedAmount > SEND_BUFFER_LIMIT) {
      sock.close(CLOSE.tooSlow, 'send buffer full')
      return
    }
    sock.send(data)
  }

  /** Every message to a player or a screen passes its strict schema first. */
  private sendPlayerMsg(sock: Sock, msg: unknown): void {
    const r = PlayerServerMessage.safeParse(msg)
    if (!r.success) {
      this.deps.log.error('player message refused by its schema', { code: this.code, t: (msg as { t: string }).t, issue: r.error.issues[0]?.path.join('.') })
      return
    }
    this.sendRaw(sock, JSON.stringify(msg))
  }

  private sendScreenMsg(sock: Sock, msg: unknown): void {
    const r = ScreenServerMessage.safeParse(msg)
    if (!r.success) {
      this.deps.log.error('screen message refused by its schema', { code: this.code, t: (msg as { t: string }).t, issue: r.error.issues[0]?.path.join('.') })
      return
    }
    this.sendRaw(sock, JSON.stringify(msg))
  }

  private sendHostMsg(sock: Sock, msg: unknown): void {
    const r = HostServerMessage.safeParse(msg)
    if (!r.success) {
      this.deps.log.error('host message refused by its schema', { code: this.code, t: (msg as { t: string }).t, issue: r.error.issues[0]?.path.join('.') })
      return
    }
    this.sendRaw(sock, JSON.stringify(msg))
  }

  playerView(id: PlayerId) {
    return project.playerView(this.state, this.deps.pack, id, this.rejoinCodes.get(id) ?? '')
  }

  private sendView(id: PlayerId): void {
    const sock = this.players.get(id)
    const view = sock || [...this.hosts].some((h) => h.spectating === id) ? this.playerView(id) : null
    if (sock && view) this.sendPlayerMsg(sock, { t: 'view', view })
    for (const h of this.hosts) if (h.spectating === id) this.sendHostMsg(h, { t: 'spectate', playerId: id, view })
  }

  private sendStanding(id: PlayerId): void {
    const sock = this.players.get(id)
    if (sock) this.sendPlayerMsg(sock, { t: 'standing', standing: project.standing(this.state, this.deps.pack, id) })
  }

  private clockMsg() {
    return { t: 'clock' as const, clock: project.clockView(this.state, this.deps.pack, this.clockInfo()) }
  }

  broadcastClock(): void {
    const msg = this.clockMsg()
    for (const s of this.players.values()) this.sendPlayerMsg(s, msg)
    for (const s of this.screens) this.sendScreenMsg(s, msg)
    for (const s of this.hosts) this.sendHostMsg(s, msg)
    this.lastClockSend = this.deps.config.wallNow()
  }

  hostView() {
    return project.hostView(this.state, this.deps.pack, {
      clock: this.clockInfo(),
      connected: (id) => this.players.has(id),
      publicUrl: this.deps.config.publicUrl,
      wallNowMs: this.deps.config.wallNow(),
      stageWall: this.stageWall,
      answerKey: !!this.deps.config.answerKeyFile && existsSync(this.deps.config.answerKeyFile),
      screens: this.screens.size,
    })
  }

  private controlFor(sock: Sock) {
    const c = this.controller
    return {
      you: !!c && c.sock === sock,
      state: (c ? (c.sock ? 'held' : 'reconnecting') : 'free') as 'held' | 'reconnecting' | 'free',
      holder: c?.name ?? null,
      watchers: [...this.hosts].filter((h) => h !== sock && h !== c?.sock).map((h) => h.hostName ?? ''),
    }
  }

  /** After the grace time a dropped controller loses control. A lone console then takes it. */
  private checkControl(): void {
    const c = this.controller
    const wall = this.deps.config.wallNow()
    if (c && !c.sock && wall - c.droppedAt >= CONTROL_GRACE_MS) {
      this.controller = null
      this.hostDirty = true
    }
    if (!this.controller && this.hosts.size === 1 && this.everControlled) {
      const only = [...this.hosts][0]!
      this.controller = { id: only.consoleId!, name: only.hostName!, sock: only, droppedAt: 0 }
      this.hostDirty = true
    }
  }

  private sendHostViews(): void {
    const base = this.hostView()
    for (const h of this.hosts) this.sendHostMsg(h, { t: 'host_view', view: { ...base, control: this.controlFor(h) } })
    this.hostDirty = false
    this.lastHostSend = this.deps.config.wallNow()
  }

  screenView() {
    return project.screenView(this.state, this.deps.pack, this.deps.config.publicUrl)
  }

  private sendScreenViews(): void {
    const msg = { t: 'screen_view', view: this.screenView() }
    for (const s of this.screens) this.sendScreenMsg(s, msg)
    this.screenDirty = false
    this.lastScreenSend = this.deps.config.wallNow()
  }

  // ----------------------------------------------------------------------------------------
  // Sockets
  // ----------------------------------------------------------------------------------------
  attachPlayer(sock: Sock, playerId: PlayerId, build: string): void {
    const old = this.players.get(playerId)
    if (old && old !== sock) {
      this.sendPlayerMsg(old, { t: 'superseded' })
      old.close(CLOSE.superseded, 'superseded')
    }
    sock.role = 'player'
    sock.playerId = playerId
    this.players.set(playerId, sock)
    this.handle(advance(this.state, this.deps.pack, this.now()))
    const p = this.state.players[playerId]!
    const { pack } = this.deps
    this.sendPlayerMsg(sock, {
      t: 'welcome',
      protocol: PROTOCOL_VERSION,
      build: this.deps.config.build,
      role: 'player',
      session: project.sessionInfo(this.state, pack, this.deps.config.publicUrl),
      system: project.systemPublic(this.state, pack, p.system),
      ladder: project.ladder(pack),
      art: project.packArt(pack),
      clock: project.clockView(this.state, pack, this.clockInfo()),
      view: this.playerView(playerId),
    })
    this.sendStanding(playerId)
    this.hostDirty = true
    void build
  }

  detach(sock: Sock): void {
    if (sock.role === 'player' && sock.playerId && this.players.get(sock.playerId) === sock) {
      this.players.delete(sock.playerId)
      this.hostDirty = true
    }
    if (this.hosts.delete(sock)) {
      this.hostDirty = true
      // A controller that drops keeps control for the grace time, so a reload changes nothing.
      if (this.controller?.sock === sock) this.controller = { ...this.controller, sock: null, droppedAt: this.deps.config.wallNow() }
    }
    if (this.screens.delete(sock)) this.hostDirty = true
  }

  attachHost(sock: Sock, name = '', consoleId = ''): void {
    sock.role = 'host'
    sock.spectating = null
    sock.hostName = name.trim().slice(0, 40) || 'Host console'
    sock.hostSeq = ++this.hostSeqN
    sock.consoleId = consoleId || `c${sock.hostSeq}-${Math.random().toString(36).slice(2, 8)}`
    this.hosts.add(sock)
    const c = this.controller
    if (c && !c.sock && c.id === sock.consoleId) {
      // The controller came back within the grace time.
      this.controller = { ...c, sock, name: sock.hostName }
    } else if (!c && (!this.everControlled || this.hosts.size === 1)) {
      // The first console in holds control, and so does a console that is alone when control is free.
      this.controller = { id: sock.consoleId, name: sock.hostName, sock, droppedAt: 0 }
      this.everControlled = true
    }
    this.sendHostMsg(sock, { t: 'welcome', protocol: PROTOCOL_VERSION, build: this.deps.config.build, role: 'host', view: { ...this.hostView(), control: this.controlFor(sock) } })
    this.sendHostMsg(sock, this.clockMsg())
    this.hostDirty = true
  }

  /** Tell every console that control moved, then send them their views at once. */
  private moveControl(from: string | null, to: Sock): void {
    for (const h of this.hosts) this.sendHostMsg(h, { t: 'control', from, to: to.hostName ?? '' })
    this.sendHostViews()
  }

  /** Whether this console may change the session. */
  private inControl(sock: Sock): boolean {
    return !!this.controller && this.controller.sock === sock
  }

  attachScreen(sock: Sock): void {
    sock.role = 'screen'
    this.screens.add(sock)
    this.hostDirty = true
    this.sendScreenMsg(sock, {
      t: 'welcome', protocol: PROTOCOL_VERSION, build: this.deps.config.build, role: 'screen',
      clock: project.clockView(this.state, this.deps.pack, this.clockInfo()),
      art: project.packArt(this.deps.pack),
      view: this.screenView(),
    })
  }

  isConnected(id: PlayerId): boolean {
    return this.players.has(id)
  }

  // ----------------------------------------------------------------------------------------
  // Joining
  // ----------------------------------------------------------------------------------------
  join(name: string, avatar: string | null | undefined, system: string | null | undefined = null):
    | { ok: true; playerId: string; token: string; rejoinCode: string }
    | { ok: false; error: ErrorCode } {
    const { db, pack, config } = this.deps
    const now = this.now()
    this.handle(advance(this.state, pack, now))
    const playerId = newPlayerId()
    const res = apply(this.state, pack, { actor: 'system', type: 'join', payload: { playerId, name, avatar: avatar ?? null, system: system ?? null } }, now)
    if (!res.ok) return { ok: false, error: res.error }
    const token = newToken()
    let rejoinCode = newCode()
    const used = new Set(this.rejoinCodes.values())
    while (used.has(rejoinCode)) rejoinCode = newCode()
    const p = this.state.players[playerId]!
    db.transaction(() => {
      this.seq = db.insertCommand({
        code: this.code, actor: 'system', player_id: playerId, cid: null, game_ms: now, wall_ms: config.wallNow(),
        type: 'join', payload: JSON.stringify({ playerId, name: p.name, avatar: p.avatar, system: system ?? null }), result: null,
      })
      db.insertAuth({ token_hash: hashToken(token), role: 'player', code: this.code, player_id: playerId, rejoin_code: rejoinCode, created: config.wallNow() })
    })
    this.rejoinCodes.set(playerId, rejoinCode)
    this.handle(res)
    return { ok: true, playerId, token, rejoinCode }
  }

  rejoin(rejoinCode: string): { ok: true; playerId: string; token: string; rejoinCode: string } | { ok: false; error: ErrorCode } {
    const { db } = this.deps
    const code = normalizeCode(rejoinCode)
    const row = db.authByRejoin(this.code, code)
    if (!row || !row.player_id) return { ok: false, error: 'unknown_player' }
    const p = this.state.players[row.player_id]
    if (!p) return { ok: false, error: 'unknown_player' }
    if (p.removed) return { ok: false, error: 'removed' }
    const token = newToken()
    db.replacePlayerToken(this.code, row.player_id, hashToken(token))
    const old = this.players.get(row.player_id)
    if (old) {
      this.players.delete(row.player_id)
      this.sendPlayerMsg(old, { t: 'superseded' })
      old.close(CLOSE.superseded, 'superseded')
    }
    this.deps.db.logEvent(this.code, 'rejoin', this.now(), this.deps.config.wallNow(), { playerId: row.player_id })
    return { ok: true, playerId: row.player_id, token, rejoinCode: code }
  }

  // ----------------------------------------------------------------------------------------
  // Commands
  // ----------------------------------------------------------------------------------------
  private remember(actor: string, cid: string, ack: AckRecord): void {
    let m = this.dedup.get(actor)
    if (!m) this.dedup.set(actor, (m = new Map()))
    m.set(cid, ack)
    if (m.size > DEDUP_SIZE) m.delete(m.keys().next().value!)
  }

  private recall(actor: string, cid: string): AckRecord | undefined {
    return this.dedup.get(actor)?.get(cid)
  }

  playerCommand(sock: Sock, cid: string, type: string, payload: unknown): void {
    const id = sock.playerId!
    const ack = (r: AckRecord) => this.sendPlayerMsg(sock, { t: 'ack', cid, ok: r.ok, ...(r.error ? { error: r.error } : {}) })
    const seen = this.recall(id, cid)
    if (seen) return ack(seen)
    const parsed = PlayerCommand.safeParse({ type, payload })
    if (!parsed.success) return ack({ ok: false, error: 'bad_message' })
    const { pack, db, config } = this.deps
    const now = this.now()
    this.handle(advance(this.state, pack, now))
    const res = apply(this.state, pack, { actor: 'player', playerId: id, type, payload: parsed.data.payload }, now)
    const rec: AckRecord = res.ok ? { ok: true } : { ok: false, error: res.error }
    if (res.ok) {
      this.seq = db.insertCommand({
        code: this.code, actor: 'player', player_id: id, cid, game_ms: now, wall_ms: config.wallNow(),
        type, payload: JSON.stringify(parsed.data.payload), result: JSON.stringify(rec),
      })
      this.remember(id, cid, rec)
    }
    ack(rec)
    if (res.ok) this.handle(res)
  }

  hostCommand(sock: Sock, cid: string, type: string, payload: unknown): void {
    const ack = (r: AckRecord) => this.sendHostMsg(sock, { t: 'ack', cid, ok: r.ok, ...(r.error ? { error: r.error } : {}), ...(r.data !== undefined ? { data: r.data } : {}) })
    const seen = this.recall('host', cid)
    if (seen) return ack(seen)
    const { pack, db, config } = this.deps
    const p = (payload ?? {}) as Record<string, unknown>
    if (!VIEW_ONLY_OK.has(type) && !this.inControl(sock)) return ack({ ok: false, error: 'not_in_control' })
    // Commands that act on the clock or the sockets, not on the engine.
    switch (type) {
      case 'take_control': {
        const prev = this.controller
        if (prev?.sock === sock) return ack({ ok: true })
        this.controller = { id: sock.consoleId!, name: sock.hostName!, sock, droppedAt: 0 }
        this.everControlled = true
        db.logEvent(this.code, 'control', this.now(), config.wallNow(), { from: prev?.name ?? null, to: sock.hostName ?? '' })
        ack({ ok: true })
        this.moveControl(prev?.name ?? null, sock)
        return
      }
      case 'pause':
        if (!this.clock.running || this.state.closed) return ack({ ok: false, error: 'wrong_stage' })
        this.setClock(false)
        db.logEvent(this.code, 'pause', this.now(), config.wallNow(), {})
        return ack({ ok: true })
      case 'resume':
        if (this.clock.running || this.state.closed) return ack({ ok: false, error: 'wrong_stage' })
        this.setClock(true)
        db.logEvent(this.code, 'resume', this.now(), config.wallNow(), {})
        return ack({ ok: true })
      case 'set_scale': {
        const scale = Number(p.scale)
        if (!(scale > 0 && scale <= 100)) return ack({ ok: false, error: 'bad_message' })
        if (this.state.mode === 'event') return ack({ ok: false, error: 'not_available' })
        if (this.state.stage !== 'lobby' && this.clock.running) return ack({ ok: false, error: 'pause_first' })
        this.setClock(this.clock.running, scale)
        return ack({ ok: true })
      }
      case 'rejoin_code': {
        const code = this.rejoinCodes.get(String(p.playerId))
        return code ? ack({ ok: true, data: { code } }) : ack({ ok: false, error: 'unknown_player' })
      }
      case 'spectate': {
        const id = p.playerId === null ? null : String(p.playerId)
        if (id !== null && !this.state.players[id]) return ack({ ok: false, error: 'unknown_player' })
        sock.spectating = id
        ack({ ok: true })
        if (id) this.sendHostMsg(sock, { t: 'spectate', playerId: id, view: this.playerView(id) })
        return
      }
    }
    if (!ENGINE_HOST_COMMANDS.has(type)) return ack({ ok: false, error: 'bad_message' })
    const now = this.now()
    this.handle(advance(this.state, pack, now))
    const res = apply(this.state, pack, { actor: 'host', type, payload }, now)
    const rec: AckRecord = res.ok ? { ok: true } : { ok: false, error: res.error }
    if (res.ok) {
      this.seq = db.insertCommand({
        code: this.code, actor: 'host', player_id: null, cid, game_ms: now, wall_ms: config.wallNow(),
        type, payload: JSON.stringify(payload ?? {}), result: JSON.stringify(rec),
      })
      this.remember('host', cid, rec)
    }
    ack(rec)
    if (res.ok) {
      this.handle(res)
      this.broadcastClock()
      this.sendHostViews()
      if (this.screenDirty) this.sendScreenViews()
    }
  }

  /** Close the sockets of this room (shutdown). */
  closeAll(code: number = 1001): void {
    for (const s of [...this.players.values(), ...this.hosts, ...this.screens]) s.close(code, 'server shutting down')
  }
}

function toCommand(c: CommandRow): Command {
  const payload = JSON.parse(c.payload) as unknown
  if (c.actor === 'system') return { actor: 'system', type: 'join', payload: payload as { playerId: string; name: string; avatar?: string | null; system?: string | null } }
  if (c.actor === 'player') return { actor: 'player', playerId: c.player_id!, type: c.type, payload }
  return { actor: 'host', type: c.type, payload }
}

export { newCode }
