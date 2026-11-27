// Export of results, commands and timing, as JSON or CSV (engineering spec, 7.2 and 12.7).
import { PHASES, ReportCard } from '@lab02/protocol'
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
  let rows: Record<string, unknown>[]
  if (what === 'commands') {
    rows = db.allCommands(code).map((c) => ({ seq: c.seq, actor: c.actor, player: c.player_id, type: c.type, game_ms: c.game_ms, wall_ms: c.wall_ms, payload: c.payload }))
  } else if (what === 'timing') {
    rows = timing(db, code)
  } else if (what === 'cards') {
    // The report cards as the players see them (section 6.12), one row per practice.
    rows = cards(db, room, code).map(({ card }) => {
      const r: Record<string, unknown> = { practice: card.practice.name, system: card.practice.system, rejoin_code: card.practice.rejoinCode, final: card.final, total: card.total, rank: card.rank, of: card.of }
      for (const ph of card.phases) {
        r[`${ph.phase}_points`] = ph.points
        r[`${ph.phase}_band`] = ph.band
        r[`${ph.phase}_rank`] = ph.rank
        r[`${ph.phase}_facts`] = ph.facts.map((f) => `${f.label}: ${f.value}`).join(' | ')
      }
      return r
    })
  } else {
    // Results: every practice of a session in memory, also a removed one, with its raw scores.
    // A session that is no longer in memory (closed before a restart) answers from its kept cards.
    const byId = new Map(cards(db, room, code).map((c) => [c.playerId, c.card]))
    const ranks = (card: ReportCard | undefined) => {
      const r: Record<string, unknown> = { rank: card?.rank ?? null }
      for (const ph of PHASES) {
        const x = card?.phases.find((y) => y.phase === ph)
        r[`${ph}_band`] = x?.band ?? null
        r[`${ph}_rank`] = x?.rank ?? null
      }
      return r
    }
    if (room) {
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
        return { ...r, ...ranks(byId.get(id)) }
      })
    } else {
      rows = [...byId.values()].map((card) => {
        const r: Record<string, unknown> = { practice: card.practice.name, system: card.practice.system, avatar: card.practice.avatar, removed: false, joined_ms: null }
        for (const ph of PHASES) {
          r[`${ph}_raw`] = null
          r[`${ph}_points`] = card.phases.find((y) => y.phase === ph)?.points ?? null
        }
        r.total = card.total
        return { ...r, ...ranks(card) }
      })
    }
  }
  const name = `lab02-${code}-${what}`
  if (format === 'csv') return { body: csv(rows), type: 'text/csv; charset=utf-8', filename: `${name}.csv` }
  return { body: JSON.stringify(rows, null, 1), type: 'application/json', filename: `${name}.json` }
}

/** The report card of every practice: from the session in memory, or else the cards the database kept. */
function cards(db: Storage, room: Room | null, code: string): { playerId: string; card: ReportCard }[] {
  const out: { playerId: string; card: ReportCard }[] = []
  if (room) {
    for (const id of room.state.order) {
      const card = room.reportCard(id)
      if (card) out.push({ playerId: id, card })
    }
    return out
  }
  for (const row of db.results(code)) {
    let raw: unknown = null
    try { raw = JSON.parse(row.card) } catch { /* a card that does not parse is left out */ }
    const card = ReportCard.safeParse(raw)
    if (card.success) out.push({ playerId: row.player_id, card: card.data })
  }
  return out
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
