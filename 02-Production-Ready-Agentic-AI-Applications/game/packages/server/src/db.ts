// Persistence (engineering spec, section 7.5). SQLite through node:sqlite, WAL mode, behind a
// small interface so that better-sqlite3 could replace it.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Mode } from '@lab02/protocol'

export type SessionRow = { code: string; label: string; mode: Mode; content_hash: string; created: number; closed: number | null }
export type ClockRow = { code: string; game_ms: number; running: number; scale: number }
export type CommandRow = {
  seq: number; code: string; actor: string; player_id: string | null; cid: string | null
  game_ms: number; wall_ms: number; type: string; payload: string; result: string | null
}
export type SnapshotRow = { id: number; code: string; seq: number; game_ms: number; state: string; stage_change: number }
export type AuthRow = { token_hash: string; role: 'player' | 'host' | 'screen'; code: string | null; player_id: string | null; rejoin_code: string | null; created: number }

export class Storage {
  readonly db: DatabaseSync

  constructor(dataDir: string | ':memory:') {
    if (dataDir === ':memory:') this.db = new DatabaseSync(':memory:')
    else {
      mkdirSync(dataDir, { recursive: true })
      this.db = new DatabaseSync(join(dataDir, 'lab02.sqlite'))
      this.db.exec('PRAGMA journal_mode = WAL')
    }
    this.db.exec('PRAGMA synchronous = NORMAL')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS session (
        code TEXT PRIMARY KEY, label TEXT NOT NULL, mode TEXT NOT NULL, content_hash TEXT NOT NULL,
        created INTEGER NOT NULL, closed INTEGER
      );
      CREATE TABLE IF NOT EXISTS clock (
        code TEXT PRIMARY KEY, game_ms INTEGER NOT NULL, running INTEGER NOT NULL, scale REAL NOT NULL
      );
      CREATE TABLE IF NOT EXISTS command (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL, actor TEXT NOT NULL, player_id TEXT,
        cid TEXT, game_ms INTEGER NOT NULL, wall_ms INTEGER NOT NULL, type TEXT NOT NULL,
        payload TEXT NOT NULL, result TEXT
      );
      CREATE INDEX IF NOT EXISTS command_code ON command (code, seq);
      CREATE TABLE IF NOT EXISTS snapshot (
        id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL, seq INTEGER NOT NULL,
        game_ms INTEGER NOT NULL, state TEXT NOT NULL, stage_change INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS snapshot_code ON snapshot (code, id);
      CREATE TABLE IF NOT EXISTS auth (
        token_hash TEXT PRIMARY KEY, role TEXT NOT NULL, code TEXT, player_id TEXT,
        rejoin_code TEXT, created INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS auth_player ON auth (code, player_id);
      CREATE TABLE IF NOT EXISTS event_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL, kind TEXT NOT NULL,
        game_ms INTEGER NOT NULL, wall_ms INTEGER NOT NULL, data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS event_code ON event_log (code, id);
    `)
  }

  close(): void {
    this.db.close()
  }

  // Sessions -------------------------------------------------------------------------------
  insertSession(r: SessionRow): void {
    this.db.prepare('INSERT INTO session (code, label, mode, content_hash, created, closed) VALUES (?, ?, ?, ?, ?, ?)')
      .run(r.code, r.label, r.mode, r.content_hash, r.created, r.closed)
  }
  sessions(): SessionRow[] {
    return this.db.prepare('SELECT * FROM session ORDER BY created').all() as unknown as SessionRow[]
  }
  session(code: string): SessionRow | undefined {
    return this.db.prepare('SELECT * FROM session WHERE code = ?').get(code) as unknown as SessionRow | undefined
  }
  closeSession(code: string, wall: number): void {
    this.db.prepare('UPDATE session SET closed = ? WHERE code = ?').run(wall, code)
  }
  /** Remove a session and everything stored for it. */
  deleteSession(code: string): void {
    this.transaction(() => {
      for (const t of ['command', 'snapshot', 'event_log', 'clock', 'auth', 'session']) this.db.prepare(`DELETE FROM ${t} WHERE code = ?`).run(code)
    })
  }

  // Clock ----------------------------------------------------------------------------------
  writeClock(code: string, gameMs: number, running: boolean, scale: number): void {
    this.db.prepare('INSERT INTO clock (code, game_ms, running, scale) VALUES (?, ?, ?, ?) ON CONFLICT(code) DO UPDATE SET game_ms = excluded.game_ms, running = excluded.running, scale = excluded.scale')
      .run(code, Math.round(gameMs), running ? 1 : 0, scale)
  }
  clock(code: string): ClockRow | undefined {
    return this.db.prepare('SELECT * FROM clock WHERE code = ?').get(code) as unknown as ClockRow | undefined
  }

  // Commands -------------------------------------------------------------------------------
  insertCommand(r: Omit<CommandRow, 'seq'>): number {
    const res = this.db.prepare('INSERT INTO command (code, actor, player_id, cid, game_ms, wall_ms, type, payload, result) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(r.code, r.actor, r.player_id, r.cid, Math.round(r.game_ms), r.wall_ms, r.type, r.payload, r.result)
    return Number(res.lastInsertRowid)
  }
  commandsAfter(code: string, seq: number): CommandRow[] {
    return this.db.prepare('SELECT * FROM command WHERE code = ? AND seq > ? ORDER BY seq').all(code, seq) as unknown as CommandRow[]
  }
  lastSeq(code: string): number {
    const r = this.db.prepare('SELECT MAX(seq) AS s FROM command WHERE code = ?').get(code) as { s: number | null }
    return r.s ?? 0
  }

  // Snapshots ------------------------------------------------------------------------------
  writeSnapshot(code: string, seq: number, gameMs: number, state: string, stageChange: boolean): void {
    this.db.prepare('INSERT INTO snapshot (code, seq, game_ms, state, stage_change) VALUES (?, ?, ?, ?, ?)')
      .run(code, seq, Math.round(gameMs), state, stageChange ? 1 : 0)
    // Keep the newest five, plus the one of each stage change.
    this.db.prepare(`DELETE FROM snapshot WHERE code = ? AND stage_change = 0 AND id NOT IN
      (SELECT id FROM snapshot WHERE code = ? ORDER BY id DESC LIMIT 5)`).run(code, code)
  }
  latestSnapshot(code: string): SnapshotRow | undefined {
    return this.db.prepare('SELECT * FROM snapshot WHERE code = ? ORDER BY id DESC LIMIT 1').get(code) as unknown as SnapshotRow | undefined
  }

  // Auth -----------------------------------------------------------------------------------
  insertAuth(r: AuthRow): void {
    this.db.prepare('INSERT INTO auth (token_hash, role, code, player_id, rejoin_code, created) VALUES (?, ?, ?, ?, ?, ?)')
      .run(r.token_hash, r.role, r.code, r.player_id, r.rejoin_code, r.created)
  }
  auth(tokenHash: string): AuthRow | undefined {
    return this.db.prepare('SELECT * FROM auth WHERE token_hash = ?').get(tokenHash) as unknown as AuthRow | undefined
  }
  playerAuth(code: string, playerId: string): AuthRow | undefined {
    return this.db.prepare("SELECT * FROM auth WHERE code = ? AND player_id = ? AND role = 'player'").get(code, playerId) as unknown as AuthRow | undefined
  }
  authByRejoin(code: string, rejoinCode: string): AuthRow | undefined {
    return this.db.prepare("SELECT * FROM auth WHERE code = ? AND rejoin_code = ? AND role = 'player'").get(code, rejoinCode) as unknown as AuthRow | undefined
  }
  rejoinCodes(code: string): Map<string, string> {
    const rows = this.db.prepare("SELECT player_id, rejoin_code FROM auth WHERE code = ? AND role = 'player'").all(code) as { player_id: string; rejoin_code: string }[]
    return new Map(rows.map((r) => [r.player_id, r.rejoin_code]))
  }
  /** A rejoin gives a new token. The old one stops working. */
  replacePlayerToken(code: string, playerId: string, newHash: string): void {
    this.db.prepare("UPDATE auth SET token_hash = ? WHERE code = ? AND player_id = ? AND role = 'player'").run(newHash, code, playerId)
  }

  // Event log ------------------------------------------------------------------------------
  logEvent(code: string, kind: string, gameMs: number, wallMs: number, data: unknown): void {
    this.db.prepare('INSERT INTO event_log (code, kind, game_ms, wall_ms, data) VALUES (?, ?, ?, ?, ?)')
      .run(code, kind, Math.round(gameMs), wallMs, JSON.stringify(data))
  }
  events(code: string, kind?: string): { kind: string; game_ms: number; wall_ms: number; data: string }[] {
    if (kind) return this.db.prepare('SELECT kind, game_ms, wall_ms, data FROM event_log WHERE code = ? AND kind = ? ORDER BY id').all(code, kind) as never
    return this.db.prepare('SELECT kind, game_ms, wall_ms, data FROM event_log WHERE code = ? ORDER BY id').all(code) as never
  }
  allCommands(code: string): CommandRow[] {
    return this.commandsAfter(code, 0)
  }

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN')
    try {
      const r = fn()
      this.db.exec('COMMIT')
      return r
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }
}
