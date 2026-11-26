// All sessions of the server process.
import type { Mode } from '@lab02/protocol'
import { ProvisionalAnchorsError } from '@lab02/engine'
import { newCode } from './auth.ts'
import { Room, type Deps } from './room.ts'

export class Manager {
  readonly rooms = new Map<string, Room>()
  /** Sessions that cannot resume, with the reason (for example a changed pack). */
  readonly broken = new Map<string, string>()
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(readonly deps: Deps) {}

  restoreAll(): void {
    for (const row of this.deps.db.sessions()) {
      if (row.closed !== null) continue
      if (row.content_hash !== this.deps.pack.hash) {
        this.broken.set(row.code, 'This session was started on older content and cannot be opened again.')
        this.deps.log.warn('session not resumed: content hash differs', { code: row.code })
        continue
      }
      try {
        this.rooms.set(row.code, Room.restore(this.deps, row.code))
      } catch (err) {
        this.broken.set(row.code, 'This session could not be restored after a restart and cannot be opened again.')
        this.deps.log.error('session restore failed', { code: row.code, error: (err as Error).message })
      }
    }
  }

  create(label: string, mode: Mode, code?: string): { ok: true; room: Room } | { ok: false; error: 'provisional_anchors' | 'code_taken' } {
    let c = code?.toUpperCase()
    if (c && this.deps.db.session(c)) return { ok: false, error: 'code_taken' }
    while (!c || this.deps.db.session(c)) c = newCode()
    try {
      const room = Room.create(this.deps, { code: c, label, mode })
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

  /** Delete a closed or broken session for good. An open session is refused. */
  remove(code: string): 'ok' | 'unknown_session' | 'session_open' {
    const row = this.deps.db.session(code)
    if (!row) return 'unknown_session'
    const room = this.rooms.get(code)
    if (room && !room.state.closed) return 'session_open'
    room?.closeAll(1000)
    this.rooms.delete(code)
    this.broken.delete(code)
    this.deps.db.deleteSession(code)
    this.deps.log.info('session deleted', { code })
    return 'ok'
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase())
  }

  /**
   * The newest session that is not closed. The root URL sends visitors there. With `after`, only
   * a session opened later than that one counts: the next game for the players of a game that ended.
   */
  newestOpen(after?: string): Room | undefined {
    const since = after ? this.deps.db.session(after.toUpperCase())?.created ?? -Infinity : -Infinity
    let best: Room | undefined
    let bestCreated = -Infinity
    for (const room of this.rooms.values()) {
      if (room.state.closed || room.code === after?.toUpperCase()) continue
      const created = this.deps.db.session(room.code)?.created ?? 0
      if (created < since) continue
      if (created >= bestCreated) {
        best = room
        bestCreated = created
      }
    }
    return best
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
  }

  /** Snapshot every session and close the sockets. */
  shutdown(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    for (const room of this.rooms.values()) {
      room.snapshot(false)
      room.closeAll()
    }
  }
}
