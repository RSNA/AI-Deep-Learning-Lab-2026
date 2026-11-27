// All sessions of the server process (engineering spec, sections 7.2 and 7.6).
//
// A session with a facilitator (`multi`) stays in memory from the moment it is opened, and one
// is open at a time. A single-player game (`solo`) is in memory only while somebody plays it:
// it leaves when its player has been away for a while and comes back from its snapshot when
// they return, and it leaves for good once it has ended and its results are stored.
import { CLOSE, type Mode } from '@lab02/protocol'
import type { SessionRunning } from '@lab02/protocol/host'
import { ProvisionalAnchorsError } from '@lab02/engine'
import { newCode } from './auth.ts'
import { Room, type Deps } from './room.ts'

export type CreateOptions = {
  code?: string
  /** The facilitator who opens it. */
  by?: string
  /** End the session that runs. See `CreateSessionBody` of the protocol. */
  replace?: { code?: string; confirm?: string }
}
export type CreateResult =
  | { ok: true; room: Room }
  | { ok: false; error: 'provisional_anchors' | 'code_taken' | 'confirm_mismatch' }
  | { ok: false; error: 'session_running'; running: SessionRunning }

const SOLO_SETTING = 'solo'
/** Who may start a single-player game: `facilitator` (the default), `none`, or `custom:` with the hash of a passcode of its own. */
const SOLO_GATE_SETTING = 'solo_gate'
const SOLO_LABEL = 'Single player'

export class Manager {
  readonly rooms = new Map<string, Room>()
  /** Sessions that cannot resume, with the reason (for example a changed pack). */
  readonly broken = new Map<string, string>()
  private timer: ReturnType<typeof setInterval> | null = null
  private lastHousekeeping = 0

  constructor(readonly deps: Deps) {}

  /** The sessions with a facilitator that are open come back at once. A single-player game comes back when its player does. */
  restoreAll(): void {
    for (const row of this.deps.db.sessions('multi')) {
      if (row.closed === null) this.restore(row.code)
    }
  }

  private restore(code: string): Room | undefined {
    const row = this.deps.db.session(code)
    if (!row || row.closed !== null) return undefined
    if (row.content_hash !== this.deps.pack.hash) {
      this.broken.set(code, 'This session was started on older content and cannot be opened again.')
      this.deps.log.warn('session not resumed: content hash differs', { code })
      return undefined
    }
    try {
      const room = Room.restore(this.deps, code)
      this.rooms.set(code, room)
      return room
    } catch (err) {
      this.broken.set(code, 'This session could not be restored after a restart and cannot be opened again.')
      this.deps.log.error('session restore failed', { code, error: (err as Error).message })
      return undefined
    }
  }

  // ----------------------------------------------------------------------------------------
  // Sessions with a facilitator
  // ----------------------------------------------------------------------------------------
  /** The sessions with a facilitator that are open, newest first. There is one, unless an older database held more. */
  running(): Room[] {
    const created = (r: Room) => this.deps.db.session(r.code)?.created ?? 0
    return [...this.rooms.values()].filter((r) => r.kind === 'multi' && !r.state.closed).sort((a, b) => created(b) - created(a))
  }

  describe(room: Room): SessionRunning {
    const row = this.deps.db.session(room.code)
    const players = room.state.order.filter((id) => !room.state.players[id]!.removed).length
    return {
      code: room.code, label: room.state.label, mode: room.state.mode, stage: room.state.stage, players,
      createdAt: row?.created ?? 0, createdBy: row?.created_by ?? '',
      needsCode: room.state.mode === 'event' && players > 0,
    }
  }

  /**
   * Open a session with a facilitator. One is open at a time: while another runs the call is
   * refused with what runs, and with `replace` the one that runs is ended first. Ending an event
   * session that has players asks for its code typed out, so the room's game is never ended by
   * a slip of the hand.
   */
  create(label: string, mode: Mode, opts: CreateOptions = {}): CreateResult {
    let c = opts.code?.toUpperCase()
    if (c && this.deps.db.session(c)) return { ok: false, error: 'code_taken' }
    if (mode === 'event' && this.deps.pack.provisional) return { ok: false, error: 'provisional_anchors' }
    const running = this.running()
    if (running.length) {
      const newest = this.describe(running[0]!)
      // Without `replace`, and when another session runs than the one the facilitator was warned about.
      if (!opts.replace || (opts.replace.code !== undefined && opts.replace.code.toUpperCase() !== newest.code)) return { ok: false, error: 'session_running', running: newest }
      if (newest.needsCode && opts.replace.confirm?.toUpperCase() !== newest.code) return { ok: false, error: 'confirm_mismatch' }
      for (const room of running) {
        room.end(opts.by ?? '')
        this.deps.log.info('session ended by a new one', { code: room.code })
      }
    }
    while (!c || this.deps.db.session(c)) c = newCode()
    try {
      const room = Room.create(this.deps, { code: c, label, mode, by: opts.by?.trim().slice(0, 40) ?? '' })
      this.rooms.set(c, room)
      return { ok: true, room }
    } catch (err) {
      if (err instanceof ProvisionalAnchorsError) return { ok: false, error: 'provisional_anchors' }
      throw err
    }
  }

  /**
   * End an open session from the list of sessions. An event session is refused: it is ended
   * from its own console, by the host in charge, who types its code.
   */
  end(code: string, by: string): 'ok' | 'unknown_session' | 'wrong_stage' | 'event_session' {
    const room = this.rooms.get(code)
    if (!room) return this.deps.db.session(code) ? 'wrong_stage' : 'unknown_session'
    if (room.state.closed) return 'wrong_stage'
    if (room.state.mode === 'event') return 'event_session'
    const r = room.end(by)
    if (r === 'ok') this.deps.log.info('session ended from the list', { code })
    return r
  }

  /**
   * A new name for a session with a facilitator: before its first stage starts, or after it has
   * ended. In between the name stands on every screen, so it is refused.
   */
  rename(code: string, label: string): 'ok' | 'unknown_session' | 'wrong_stage' {
    const row = this.deps.db.session(code)
    if (!row || row.kind !== 'multi') return 'unknown_session'
    const room = this.rooms.get(code)
    if (room) return room.rename(label)
    // Open but not in memory: a session that could not be restored. It keeps its name.
    if (row.closed === null) return 'wrong_stage'
    this.deps.db.renameSession(code, label)
    this.deps.db.relabelResults(code, label)
    return 'ok'
  }

  /**
   * Delete a session for good. An open session with a facilitator is refused: it is ended
   * first. A single-player game is ended and deleted in one step.
   */
  remove(code: string): 'ok' | 'unknown_session' | 'session_open' {
    const row = this.deps.db.session(code)
    if (!row) return 'unknown_session'
    const room = this.rooms.get(code)
    if (row.kind === 'multi' && room && !room.state.closed) return 'session_open'
    room?.closeAll(CLOSE.closed)
    this.rooms.delete(code)
    this.broken.delete(code)
    this.deps.db.deleteSession(code)
    this.deps.log.info('session deleted', { code })
    return 'ok'
  }

  // ----------------------------------------------------------------------------------------
  // Single-player games
  // ----------------------------------------------------------------------------------------
  soloEnabled(): boolean {
    return this.deps.db.setting(SOLO_SETTING) !== 'off'
  }

  setSoloEnabled(on: boolean): void {
    this.deps.db.setSetting(SOLO_SETTING, on ? 'on' : 'off')
    this.deps.log.info('single player switched', { on })
  }

  /**
   * Who may start a single-player game. Until a facilitator says otherwise it takes the
   * facilitator passcode, so that nobody outside plays before an event. `hash` is the hash of
   * a passcode of its own.
   */
  soloGate(): { mode: 'facilitator' | 'custom' | 'none'; hash: string | null } {
    const v = this.deps.db.setting(SOLO_GATE_SETTING)
    if (v === 'none') return { mode: 'none', hash: null }
    if (v?.startsWith('custom:')) return { mode: 'custom', hash: v.slice(7) }
    return { mode: 'facilitator', hash: null }
  }

  setSoloGate(mode: 'facilitator' | 'custom' | 'none', hash: string | null = null): void {
    this.deps.db.setSetting(SOLO_GATE_SETTING, mode === 'custom' ? `custom:${hash ?? ''}` : mode)
    this.deps.log.info('single player passcode changed', { mode })
  }

  /** The single-player games in memory. */
  soloLive(): number {
    let n = 0
    for (const r of this.rooms.values()) if (r.kind === 'solo') n++
    return n
  }

  /** A single-player game for the practice `by`. The caller has checked the switch and the name. */
  createSolo(by: string): { ok: true; room: Room } | { ok: false; error: 'solo_full' } {
    if (this.soloLive() >= this.deps.config.soloMax) return { ok: false, error: 'solo_full' }
    let c = newCode()
    while (this.deps.db.session(c)) c = newCode()
    // Named by when it started: the row holds the time, and every screen shows it in the reader's own time zone.
    const room = Room.create(this.deps, { code: c, label: SOLO_LABEL, mode: 'rehearsal', kind: 'solo', by })
    this.rooms.set(c, room)
    return { ok: true, room }
  }

  /** Delete every single-player game. Returns how many there were. */
  removeAllSolo(): number {
    for (const [code, room] of this.rooms) {
      if (room.kind !== 'solo') continue
      room.closeAll(CLOSE.closed)
      this.rooms.delete(code)
    }
    for (const code of [...this.broken.keys()]) if (this.deps.db.session(code)?.kind === 'solo') this.broken.delete(code)
    const n = this.deps.db.deleteSolo()
    this.deps.log.info('single-player games deleted', { count: n })
    return n
  }

  /** Every few seconds: a single-player game that ended or whose player stays away leaves the memory. */
  private housekeeping(): void {
    for (const [code, room] of this.rooms) {
      if (room.kind !== 'solo') continue
      if (room.state.closed) {
        // Its results and its game to look at again are stored: nothing of it is needed in memory.
        room.flushReviews()
        this.deps.db.pruneSnapshots(code)
        room.closeAll(CLOSE.closed)
        this.rooms.delete(code)
      } else if (room.emptyFor() >= this.deps.config.soloIdleMs) {
        room.snapshot(false)
        this.rooms.delete(code)
        this.deps.log.info('single-player game set aside', { code })
      }
    }
  }

  // ----------------------------------------------------------------------------------------
  // Lookup
  // ----------------------------------------------------------------------------------------
  /** A session in memory. */
  get(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase())
  }

  /** A session in memory, or a single-player game that was set aside and is brought back. */
  wake(code: string): Room | undefined {
    const c = code.toUpperCase()
    const room = this.rooms.get(c)
    if (room) return room
    const row = this.deps.db.session(c)
    if (!row || row.kind !== 'solo' || row.closed !== null || this.broken.has(c)) return undefined
    return this.restore(c)
  }

  /**
   * The session with a facilitator that takes players now. The root URL sends visitors there.
   * With `after`, only a session opened later than that one counts: the next game for the
   * players of a game that ended.
   */
  newestOpen(after?: string): Room | undefined {
    const since = after ? this.deps.db.session(after.toUpperCase())?.created ?? -Infinity : -Infinity
    return this.running().find((room) => room.code !== after?.toUpperCase() && (this.deps.db.session(room.code)?.created ?? 0) >= since)
  }

  start(): void {
    this.timer = setInterval(() => this.tick(), this.deps.config.tickMs)
  }

  tick(): void {
    for (const room of this.rooms.values()) {
      try {
        room.tick()
      } catch (err) {
        this.deps.log.error('tick failed', { code: room.code, error: (err as Error).message })
      }
    }
    const wall = this.deps.config.wallNow()
    if (wall - this.lastHousekeeping >= this.deps.config.soloSweepMs) {
      this.lastHousekeeping = wall
      this.housekeeping()
    }
  }

  /** Snapshot every session and close the sockets. */
  shutdown(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    for (const room of this.rooms.values()) {
      room.flushReviews()
      room.snapshot(false)
      room.closeAll()
    }
  }
}
