// Phase 1: Planning (engineering spec, section 6.5). The player investigates with bandwidth and
// time, and sorts every problem into a class on a board with one spot per problem.
import type { Pack, PlanningRules } from '@lab02/content-schema'
import type { ErrorCode } from '@lab02/protocol'
import type { EngineEvent, GameMs, PlanningResult, PlanningState, PlayerState } from '../state.ts'
import { fireDialogue } from '../story.ts'
import type { PhaseModule } from './types.ts'

type ProblemKey = { id: string; key: { class: string; flagship: boolean } }

/** Why a board breaks the rules, or null when it is valid. */
export function boardError(picks: Record<string, string>, problems: readonly { id: string }[], rules: PlanningRules): string | null {
  const ids = new Set(problems.map((p) => p.id))
  const classes = new Map(rules.classes.map((c) => [c.id, c.capacity]))
  const count = new Map<string, number>()
  for (const [pid, cid] of Object.entries(picks)) {
    if (!ids.has(pid)) return `unknown problem ${pid}`
    if (!classes.has(cid)) return `unknown class ${cid}`
    count.set(cid, (count.get(cid) ?? 0) + 1)
  }
  for (const [cid, n] of count) if (n > classes.get(cid)!) return `class ${cid} holds ${n} problems and has ${classes.get(cid)} spots`
  return null
}

/** Score one board. The caller has checked it with boardError. */
export function scoreBoard(picks: Record<string, string>, problems: readonly ProblemKey[], rules: PlanningRules): PlanningResult {
  const order = rules.class_order
  const real = new Set(rules.classes.filter((c) => c.rungs.length > 0).map((c) => c.id))
  const sc = rules.scoring
  let classify = 0
  let flagship = 0
  const graded = problems.map((p) => {
    const picked = picks[p.id] ?? null
    let points = 0
    if (picked !== null) {
      const truth = p.key.class
      if (picked === truth) points = sc.classify.exact
      else if (real.has(picked) && real.has(truth) && Math.abs(order.indexOf(picked) - order.indexOf(truth)) === 1) points = sc.classify.adjacent
      if (p.key.flagship && picked === rules.flagship_class) flagship = sc.flagship.bonus
    }
    classify += points
    return { problem: p.id, picked, points }
  })
  return { graded, classify, flagship, raw: classify + flagship }
}

// ------------------------------------------------------------------------------------------
// Timers
// ------------------------------------------------------------------------------------------
function investigation(pack: Pack, p: PlayerState, id: string) {
  return pack.systems[p.system]?.insights?.find((x) => x.id === id)
}

function lineCount(pack: Pack, p: PlayerState, id: string): number {
  const inv = investigation(pack, p, id)
  return inv && inv.method === 'interview' && inv.tile.type === 'quote' ? inv.tile.data.text.split('\n').length : 0
}

/** Release time of line k (from 1) of n over a wait from start to end: start + k × s ÷ (n + 1). */
export function lineAt(startedAtMs: GameMs, completesAtMs: GameMs, k: number, n: number): GameMs {
  return startedAtMs + Math.floor((k * (completesAtMs - startedAtMs)) / (n + 1))
}

function nextOf(pack: Pack, p: PlayerState, r: PlanningState['running'][number]): GameMs {
  const n = lineCount(pack, p, r.id)
  return r.released < n ? lineAt(r.startedAtMs, r.completesAtMs, r.released + 1, n) : r.completesAtMs
}

const fail = (error: ErrorCode) => ({ ok: false as const, error })
const ok = (p: PlayerState, events: EngineEvent[] = []) => ({ ok: true as const, dirty: [p.id], events })

export function bandwidthFree(pack: Pack, p: PlayerState): number {
  const st = p.planning
  const held = st ? st.running.reduce((sum, r) => sum + (investigation(pack, p, r.id)?.bandwidth ?? 0), 0) : 0
  return pack.game.phases.planning.investigations.bandwidth - held
}

export const planning: PhaseModule = {
  phase: 'planning',
  implemented: true,
  open(_s, _pack, p) {
    p.planning = { done: [], running: [], picks: {}, submittedAtMs: null, result: null }
  },
  close(_s, pack, p, now) {
    const st = p.planning
    if (!st) return 0
    // A draft that was not sent is sent as it stands. Investigations still running are dropped.
    if (st.submittedAtMs === null) {
      st.submittedAtMs = now
      p.submittedAtMs.planning = now
    }
    st.running = []
    const problems = pack.systems[p.system]?.problems ?? []
    st.result = scoreBoard(st.picks, problems, pack.game.phases.planning)
    return st.result.raw
  },
  liveValue(_s, _pack, p) {
    const st = p.planning
    return st ? st.done.length + Object.keys(st.picks).length : 0
  },
  liveMax(pack) {
    const pl = pack.game.phases.planning
    return pl.investigations.per_system + pl.candidates
  },
  nextDue(s, pack, p) {
    const st = p.planning
    if (!st || s.stage !== 'planning.play') return null
    let due: GameMs | null = null
    for (const r of st.running) {
      const t = nextOf(pack, p, r)
      if (due === null || t < due) due = t
    }
    return due
  },
  fire(_s, pack, p, at) {
    const st = p.planning!
    const events: EngineEvent[] = []
    // Lines first, then completions, each in the order the investigations started.
    for (const r of st.running) {
      const n = lineCount(pack, p, r.id)
      while (r.released < n && lineAt(r.startedAtMs, r.completesAtMs, r.released + 1, n) <= at) {
        events.push({ kind: 'moment', playerId: p.id, atMs: lineAt(r.startedAtMs, r.completesAtMs, r.released + 1, n), ref: { type: 'interview_line', investigation: r.id, index: r.released } })
        r.released++
      }
    }
    const finished = st.running.filter((r) => r.completesAtMs <= at)
    if (finished.length) {
      st.running = st.running.filter((r) => r.completesAtMs > at)
      for (const r of finished) {
        st.done.push({ id: r.id, atMs: r.completesAtMs })
        events.push({ kind: 'moment', playerId: p.id, atMs: r.completesAtMs, ref: { type: 'tile', investigation: r.id } })
        events.push(...fireDialogue(pack, p, 'planning', `insight:${r.id}`, r.completesAtMs))
      }
    }
    return events
  },
  commands: {
    'planning.investigate'(s, pack, p, payload, now) {
      if (s.stage !== 'planning.play') return fail('wrong_stage')
      const st = p.planning
      if (!st) return fail('wrong_stage')
      if (st.submittedAtMs !== null) return fail('already_submitted')
      const id = (payload as { id: string }).id
      const inv = investigation(pack, p, id)
      if (!inv) return fail('unknown_id')
      if (st.done.some((d) => d.id === id) || st.running.some((r) => r.id === id)) return fail('already_done')
      if (inv.bandwidth > bandwidthFree(pack, p)) return fail('no_bandwidth')
      st.running.push({ id, startedAtMs: now, completesAtMs: now + inv.seconds * 1000, released: 0 })
      return ok(p)
    },
    'planning.set_report'(s, pack, p, payload) {
      if (s.stage !== 'planning.play') return fail('wrong_stage')
      const st = p.planning
      if (!st) return fail('wrong_stage')
      if (st.submittedAtMs !== null) return fail('already_submitted')
      const picks = (payload as { picks: Record<string, string> }).picks
      if (boardError(picks, pack.systems[p.system]?.problems ?? [], pack.game.phases.planning) !== null) return fail('invalid_report')
      st.picks = Object.fromEntries(Object.entries(picks))
      return ok(p)
    },
    'planning.submit'(s, _pack, p, _payload, now) {
      if (s.stage !== 'planning.play') return fail('wrong_stage')
      const st = p.planning
      if (!st) return fail('wrong_stage')
      if (st.submittedAtMs !== null) return fail('already_submitted')
      st.submittedAtMs = now
      p.submittedAtMs.planning = now
      return ok(p)
    },
  },
}
