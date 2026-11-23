// Export of results, commands and timing, as JSON or CSV (engineering spec, 7.2 and 12.7).
import { PHASES } from '@lab02/protocol'
import type { Storage } from './db.ts'
import type { Room } from './room.ts'

type Out = { body: string; type: string; filename: string }

function csv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return ''
  const cols = Object.keys(rows[0]!)
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n') + '\n'
}

export function exportSession(db: Storage, room: Room | null, code: string, what: string, format: string): Out {
  let rows: Record<string, unknown>[] = []
  if (what === 'commands') {
    rows = db.allCommands(code).map((c) => ({ seq: c.seq, actor: c.actor, player: c.player_id, type: c.type, game_ms: c.game_ms, wall_ms: c.wall_ms, payload: c.payload }))
  } else if (what === 'timing') {
    rows = timing(db, code)
  } else if (room) {
    const s = room.state
    rows = s.order.map((id) => {
      const p = s.players[id]!
      const r: Record<string, unknown> = { practice: p.name, system: p.system, avatar: p.avatar, removed: p.removed, joined_ms: p.joinedAtMs }
      let total = 0
      for (const ph of PHASES) {
        r[`${ph}_raw`] = p.results[ph]?.raw ?? null
        r[`${ph}_points`] = p.results[ph]?.points ?? null
        total += p.results[ph]?.points ?? 0
      }
      r.total = total
      return r
    })
  }
  const name = `lab02-${code}-${what}`
  if (format === 'csv') return { body: csv(rows), type: 'text/csv; charset=utf-8', filename: `${name}.csv` }
  return { body: JSON.stringify(rows, null, 1), type: 'application/json', filename: `${name}.json` }
}

/** Per player and stage: time to the first command, commands, the longest idle time. */
function timing(db: Storage, code: string): Record<string, unknown>[] {
  const stages = db.events(code, 'stage').map((e) => ({ stage: (JSON.parse(e.data) as { stage: string }).stage, at: e.game_ms }))
  const cmds = db.allCommands(code).filter((c) => c.actor === 'player')
  const out: Record<string, unknown>[] = []
  const players = [...new Set(cmds.map((c) => c.player_id!))]
  stages.forEach((st, i) => {
    const end = stages[i + 1]?.at ?? Infinity
    for (const pid of players) {
      const mine = cmds.filter((c) => c.player_id === pid && c.game_ms >= st.at && c.game_ms < end).map((c) => c.game_ms)
      if (!mine.length) continue
      let longest = mine[0]! - st.at
      for (let k = 1; k < mine.length; k++) longest = Math.max(longest, mine[k]! - mine[k - 1]!)
      out.push({ player: pid, stage: st.stage, first_command_s: (mine[0]! - st.at) / 1000, commands: mine.length, longest_idle_s: longest / 1000 })
    }
  })
  return out
}
