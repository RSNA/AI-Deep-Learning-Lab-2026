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
        this.broken.set(row.code, 'The content pack changed since this session started. It stays closed to play.')
        this.deps.log.warn('session not resumed: content hash differs', { code: row.code })
        continue
      }
      try {
        this.rooms.set(row.code, Room.restore(this.deps, row.code))
      } catch (err) {
        this.broken.set(row.code, `Could not be restored: ${(err as Error).message}`)
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

  get(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase())
  }

  /** The newest session that is not closed. The root URL sends visitors there. */
  newestOpen(): Room | undefined {
    let best: Room | undefined
    let bestCreated = -Infinity
    for (const room of this.rooms.values()) {
      if (room.state.closed) continue
      const created = this.deps.db.session(room.code)?.created ?? 0
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
