// Leaderboards (engineering spec, section 6.9): four columns, each its own ranking, recomputed
// on a beat of game time and at every stage change.
import type { Pack } from '@lab02/content-schema'
import { COLUMNS, PHASES, type ColumnId, type PhaseId } from '@lab02/protocol'
import { PHASE_MODULES } from './phases/index.ts'
import type { BoardState, GameMs, PlayerId, PlayerState, SessionState } from './state.ts'

export function livePhase(s: SessionState): PhaseId | null {
  for (const p of PHASES) if (s.opened.includes(p) && !s.closedPhases.includes(p)) return p
  return null
}

function phasePoints(p: PlayerState, phase: PhaseId): number {
  return p.results[phase]?.points ?? 0
}

export function overallPoints(s: SessionState, p: PlayerState): number {
  return s.closedPhases.reduce((sum, ph) => sum + phasePoints(p, ph), 0)
}

type Key = { get: (p: PlayerState) => number; desc: boolean }

function tieKey(name: string, column: ColumnId, s: SessionState): Key {
  const phase = column === 'overall' ? null : column
  switch (name) {
    case 'total_points': return { get: (p) => overallPoints(s, p), desc: true }
    case 'planning_points': return { get: (p) => phasePoints(p, 'planning'), desc: true }
    case 'development_points': return { get: (p) => phasePoints(p, 'development'), desc: true }
    case 'maintaining_points': return { get: (p) => phasePoints(p, 'maintaining'), desc: true }
    case 'points': return { get: (p) => (phase ? phasePoints(p, phase) : overallPoints(s, p)), desc: true }
    case 'earlier_join': return { get: (p) => p.joinSeq, desc: false }
    case 'earlier_submit': return { get: (p) => (phase ? p.submittedAtMs[phase] ?? Number.MAX_SAFE_INTEGER : 0), desc: false }
    // Phase 2: fewer validations used. `fewer_pilot_runs` is its name from the first version.
    case 'fewer_validations':
    case 'fewer_pilot_runs': return { get: (p) => p.development?.validations.length ?? 0, desc: false }
    // The phase steps fill these in. Until then every practice ties on them.
    case 'fewer_credits_spent': return { get: () => 0, desc: false }
    case 'higher_final_month_health': return { get: () => 0, desc: true }
    default: return { get: () => 0, desc: false }
  }
}

function sortBy(players: PlayerState[], keys: Key[]): PlayerState[] {
  const withFallback = [...keys, { get: (p: PlayerState) => p.joinSeq, desc: false }]
  return [...players].sort((a, b) => {
    for (const k of withFallback) {
      const x = k.get(a), y = k.get(b)
      if (x !== y) return k.desc ? y - x : x - y
    }
    return 0
  })
}

export function computeBoard(s: SessionState, pack: Pack, atMs: GameMs): BoardState {
  const players = s.order.map((id) => s.players[id]!).filter((p) => !p.removed)
  const live = livePhase(s)
  const order = {} as Record<ColumnId, PlayerId[]>
  const values = {} as Record<ColumnId, Record<PlayerId, number>>
  const tb = pack.game.leaderboards.tie_breaks

  for (const col of COLUMNS) {
    let ranked: PlayerState[] = []
    const vals: Record<PlayerId, number> = {}
    if (col === 'overall') {
      if (s.closedPhases.length > 0) {
        ranked = sortBy(players, tb.overall.map((k) => tieKey(k, col, s)))
        for (const p of ranked) vals[p.id] = overallPoints(s, p)
      }
    } else if (s.closedPhases.includes(col)) {
      ranked = sortBy(players, tb[col].map((k) => tieKey(k, col, s)))
      for (const p of ranked) vals[p.id] = phasePoints(p, col)
    } else if (live === col) {
      const mod = PHASE_MODULES[col]
      for (const p of players) {
        const v = mod.liveValue(s, pack, p)
        if (p.live[col].value !== v) p.live[col] = { value: v, sinceMs: atMs }
        vals[p.id] = v
      }
      ranked = sortBy(players, [
        { get: (p) => vals[p.id]!, desc: true },
        { get: (p) => p.live[col].sinceMs, desc: false },
      ])
    }
    order[col] = ranked.map((p) => p.id)
    values[col] = vals
  }

  // The strip of health systems: over closed phases, the mean points of the practices that acted.
  const systems = s.systems.map((id, idx) => {
    let score = 0
    for (const ph of s.closedPhases) {
      const acted = players.filter((p) => p.system === id && p.acted[ph])
      if (acted.length) score += acted.reduce((sum, p) => sum + phasePoints(p, ph), 0) / acted.length
    }
    return { id, score: Math.round(score * 10) / 10, idx }
  })
  systems.sort((a, b) => b.score - a.score || a.idx - b.idx)
  return {
    atMs, live, order, values,
    systems: systems.map((x, i) => ({ id: x.id, score: x.score, rank: i + 1 })),
  }
}

/** A player's rank in a column, overall or inside their health system. */
export function rankOf(s: SessionState, col: ColumnId, playerId: PlayerId, withinSystem: boolean): number | null {
  const ids = s.board.order[col]
  const me = s.players[playerId]
  if (!me) return null
  let rank = 0
  for (const id of ids) {
    const p = s.players[id]
    if (!p || p.removed) continue
    if (withinSystem && p.system !== me.system) continue
    rank++
    if (id === playerId) return rank
  }
  return null
}
