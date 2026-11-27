// Persistence (engineering spec, section 7.5). SQLite through node:sqlite, WAL mode, behind a
// small interface so that better-sqlite3 could replace it.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Kind, Mode, StageId } from '@lab02/protocol'

/** `created_by`: the facilitator who opened a session, or the practice of a single-player game. */
export type SessionRow = {
  code: string; label: string; mode: Mode; content_hash: string; created: number; closed: number | null
  kind: Kind; created_by: string; stage: StageId
}
export type ResultRow = { player_id: string; card: string; review: Uint8Array | null; base: string | null }
export type ClockRow = { code: string; game_ms: number; running: number; scale: number }
export type CommandRow = {
  seq: number; code: string; actor: string; player_id: string | null; cid: string | null
  game_ms: number; wall_ms: number; type: string; payload: string; result: string | null
}
export type SnapshotRow = { id: number; code: string; seq: number; game_ms: number; state: string; stage_change: number }
export type AuthRow = { token_hash: string; role: 'player' | 'host' | 'screen'; code: string | null; player_id: string | null; rejoin_code: string | null; created: number }

const SESSION_TABLES = ['command', 'snapshot', 'event_log', 'clock', 'auth', 'result', 'review_base', 'session'] as const

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
      CREATE TABLE IF NOT EXISTS result (
        code TEXT NOT NULL, player_id TEXT NOT NULL, card TEXT NOT NULL, updated INTEGER NOT NULL,
        PRIMARY KEY (code, player_id)
      );
      CREATE TABLE IF NOT EXISTS review_base (
        code TEXT NOT NULL, hash TEXT NOT NULL, data BLOB NOT NULL,
        PRIMARY KEY (code, hash)
      );
      CREATE TABLE IF NOT EXISTS setting (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `)
    // Columns added after the first release. A database made before them gets them here.
    this.addColumn('session', 'kind', "TEXT NOT NULL DEFAULT 'multi'")
    this.addColumn('session', 'created_by', "TEXT NOT NULL DEFAULT ''")
    this.addColumn('session', 'stage', "TEXT NOT NULL DEFAULT 'lobby'")
    this.addColumn('result', 'review', 'BLOB')
    this.addColumn('result', 'base', 'TEXT')
    this.db.exec('CREATE INDEX IF NOT EXISTS session_kind ON session (kind, created)')
  }

  private addColumn(table: string, column: string, type: string): void {
    const cols = this.db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
    if (!cols.some((c) => c.name === column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
  }

  close(): void {
    this.db.close()
  }

  // Sessions -------------------------------------------------------------------------------
  insertSession(r: SessionRow): void {
    this.db.prepare('INSERT INTO session (code, label, mode, content_hash, created, closed, kind, created_by, stage) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(r.code, r.label, r.mode, r.content_hash, r.created, r.closed, r.kind, r.created_by, r.stage)
  }
  /** The sessions of one kind, oldest first. */
  sessions(kind: Kind = 'multi'): SessionRow[] {
    return this.db.prepare('SELECT * FROM session WHERE kind = ? ORDER BY created').all(kind) as unknown as SessionRow[]
  }
  /** The newest single-player games, and how many there are: all, and those that ended. */
  soloRecent(limit: number): SessionRow[] {
    return this.db.prepare("SELECT * FROM session WHERE kind = 'solo' ORDER BY created DESC LIMIT ?").all(limit) as unknown as SessionRow[]
  }
  soloCounts(): { total: number; finished: number } {
    const r = this.db.prepare("SELECT COUNT(*) AS total, COUNT(closed) AS finished FROM session WHERE kind = 'solo'").get() as { total: number; finished: number }
    return { total: Number(r.total), finished: Number(r.finished) }
  }
  setStage(code: string, stage: StageId): void {
    this.db.prepare('UPDATE session SET stage = ? WHERE code = ?').run(stage, code)
  }
  renameSession(code: string, label: string): void {
    this.db.prepare('UPDATE session SET label = ? WHERE code = ?').run(label, code)
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
      for (const t of SESSION_TABLES) this.db.prepare(`DELETE FROM ${t} WHERE code = ?`).run(code)
    })
  }
  /** Remove every single-player game and everything stored for them. Returns how many there were. */
  deleteSolo(): number {
    return this.transaction(() => {
      const n = this.soloCounts().total
      for (const t of SESSION_TABLES.filter((x) => x !== 'session')) this.db.prepare(`DELETE FROM ${t} WHERE code IN (SELECT code FROM session WHERE kind = 'solo')`).run()
      this.db.prepare("DELETE FROM session WHERE kind = 'solo'").run()
      return n
    })
  }

  /**
   * The sessions a player may mean by what they typed: the one with that code, and every
   * session with a facilitator that has that label (letter case and outer spaces aside), newest
   * first. Single-player games all carry one label, so they are found by their code.
   */
  sessionsNamed(code: string, label: string): SessionRow[] {
    return this.db.prepare("SELECT * FROM session WHERE code = ? OR (kind = 'multi' AND trim(label) = trim(?) COLLATE NOCASE) ORDER BY created DESC")
      .all(code, label) as unknown as SessionRow[]
  }

  // Results (section 7.5): the report card of every practice, kept after the session is closed ---
  /**
   * Make the stored cards of a session equal to `cards` (player id to JSON). A practice that is
   * no longer in the set loses its row, and an empty set clears the session. A card that is
   * written again keeps the game to look at again that is stored beside it.
   */
  writeResults(code: string, cards: Map<string, string>, wall: number): void {
    this.transaction(() => {
      const had = this.db.prepare('SELECT player_id FROM result WHERE code = ?').all(code) as { player_id: string }[]
      const del = this.db.prepare('DELETE FROM result WHERE code = ? AND player_id = ?')
      for (const r of had) if (!cards.has(r.player_id)) del.run(code, r.player_id)
      const put = this.db.prepare('INSERT INTO result (code, player_id, card, updated) VALUES (?, ?, ?, ?) ON CONFLICT(code, player_id) DO UPDATE SET card = excluded.card, updated = excluded.updated')
      for (const [id, card] of cards) put.run(code, id, card, wall)
      if (!cards.size) this.db.prepare('DELETE FROM review_base WHERE code = ?').run(code)
    })
  }
  result(code: string, playerId: string): string | undefined {
    const r = this.db.prepare('SELECT card FROM result WHERE code = ? AND player_id = ?').get(code, playerId) as { card: string } | undefined
    return r?.card
  }
  results(code: string): { player_id: string; card: string }[] {
    return this.db.prepare('SELECT player_id, card FROM result WHERE code = ? ORDER BY rowid').all(code) as unknown as { player_id: string; card: string }[]
  }
  /** How many practices have a stored result, for every session that has any. */
  resultCounts(): Map<string, number> {
    const rows = this.db.prepare('SELECT code, COUNT(*) AS n FROM result GROUP BY code').all() as { code: string; n: number }[]
    return new Map(rows.map((r) => [r.code, Number(r.n)]))
  }
  /** Put the label of a session into its stored cards, after the session was renamed. */
  relabelResults(code: string, label: string): void {
    this.transaction(() => {
      const put = this.db.prepare('UPDATE result SET card = ? WHERE code = ? AND player_id = ?')
      for (const r of this.results(code)) {
        try {
          const card = JSON.parse(r.card) as { session?: { label?: string } }
          if (card.session) { card.session.label = label; put.run(JSON.stringify(card), code, r.player_id) }
        } catch { /* a card that does not parse is left as it is */ }
      }
    })
  }

  // Games to look at again (section 7.5): beside a card, the practice's own part, and once per
  // session the part that every practice of a health system shares. Both are gzipped JSON.
  writeReview(code: string, playerId: string, base: { hash: string; data: Uint8Array }, review: Uint8Array): void {
    this.transaction(() => {
      // Empty data: the caller stored this shared part with the practice before.
      if (base.data.length) this.db.prepare('INSERT OR IGNORE INTO review_base (code, hash, data) VALUES (?, ?, ?)').run(code, base.hash, base.data)
      this.db.prepare('UPDATE result SET review = ?, base = ? WHERE code = ? AND player_id = ?').run(review, base.hash, code, playerId)
      // The shared part grows with every phase that opens. One that no practice points to any more goes.
      this.db.prepare('DELETE FROM review_base WHERE code = ? AND hash NOT IN (SELECT base FROM result WHERE code = ? AND base IS NOT NULL)').run(code, code)
    })
  }
  review(code: string, playerId: string): { review: Uint8Array; base: Uint8Array } | undefined {
    const r = this.db.prepare('SELECT review, base FROM result WHERE code = ? AND player_id = ?').get(code, playerId) as { review: Uint8Array | null; base: string | null } | undefined
    if (!r?.review || !r.base) return undefined
    const b = this.db.prepare('SELECT data FROM review_base WHERE code = ? AND hash = ?').get(code, r.base) as { data: Uint8Array } | undefined
    return b ? { review: r.review, base: b.data } : undefined
  }
  hasReview(code: string, playerId: string): boolean {
    const r = this.db.prepare('SELECT review IS NOT NULL AS has FROM result WHERE code = ? AND player_id = ?').get(code, playerId) as { has: number } | undefined
    return !!r?.has
  }

  // Settings of the server that a facilitator changes in the console -----------------------
  setting(key: string): string | undefined {
    return (this.db.prepare('SELECT value FROM setting WHERE key = ?').get(key) as { value: string } | undefined)?.value
  }
  setSetting(key: string, value: string): void {
    this.db.prepare('INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
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
  /** Keep only the newest snapshot of a session that has ended and will not be opened again. */
  pruneSnapshots(code: string): void {
    this.db.prepare('DELETE FROM snapshot WHERE code = ? AND id NOT IN (SELECT id FROM snapshot WHERE code = ? ORDER BY id DESC LIMIT 1)').run(code, code)
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
