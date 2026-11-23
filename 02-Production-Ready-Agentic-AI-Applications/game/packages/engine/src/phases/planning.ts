// Phase 1: Planning (engineering spec, section 6.5). The player investigates with bandwidth and
// time, and sorts every problem into a class on a board with one spot per problem.
import type { Pack, PlanningRules } from '@lab02/content-schema'
import type { ErrorCode } from '@lab02/protocol'
import type { EngineEvent, FeedEntry, GameMs, PlanningResult, PlanningState, PlayerState } from '../state.ts'
import { roundHalfUp } from '../scoring.ts'
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

/** How a pick stands against the true class: right, one class off among the real ones, wrong, or not sorted. */
export function markOf(picked: string | null, truth: string, rules: PlanningRules): 'right' | 'near' | 'wrong' | 'unsorted' {
  if (picked === null) return 'unsorted'
  if (picked === truth) return 'right'
  const real = (id: string) => (rules.classes.find((c) => c.id === id)?.rungs.length ?? 0) > 0
  const order = rules.class_order
  return real(picked) && real(truth) && Math.abs(order.indexOf(picked) - order.indexOf(truth)) === 1 ? 'near' : 'wrong'
}

/**
 * Score one board. The caller has checked it with boardError. `started` is how many
 * investigations the player started. With `scoring.economy` in the rules, the ones that were not
 * started pay up to its `max`, in proportion to how well the board is sorted (section 6.5).
 */
export function scoreBoard(picks: Record<string, string>, problems: readonly ProblemKey[], rules: PlanningRules, started = 0): PlanningResult {
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
  let economy = 0
  let total = 0
  const eco = sc.economy
  if (eco) {
    total = rules.investigations.per_system
    const used = Math.max(0, Math.min(total, started))
    const sortMax = sc.classify.exact * problems.length + sc.flagship.bonus
    if (sortMax > 0 && total > 0) economy = roundHalfUp((eco.max * (classify + flagship) * (total - used)) / (sortMax * total))
  }
  return { graded, classify, flagship, economy, investigations: { started, total }, raw: classify + flagship + economy }
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
    // An investigation counts once it is started, so one that still runs counts too.
    const started = st.done.length + st.running.length
    st.running = []
    const problems = pack.systems[p.system]?.problems ?? []
    st.result = scoreBoard(st.picks, problems, pack.game.phases.planning, started)
    return st.result.raw
  },
  liveValue(_s, _pack, p) {
    const st = p.planning
    return st ? st.done.length + Object.keys(st.picks).length : 0
  },
  feed(_s, pack, p) {
    const st = p.planning
    if (!st) return []
    const title = (id: string) => investigation(pack, p, id)?.public.title ?? null
    const out: FeedEntry[] = []
    for (const d of st.done) out.push({ kind: 'finished', text: title(d.id), atMs: d.atMs })
    for (const r of st.running) out.push({ kind: 'started', text: title(r.id), atMs: r.startedAtMs })
    if (st.submittedAtMs !== null) out.push({ kind: 'sent', text: null, atMs: st.submittedAtMs })
    return out
  },
  card(_s, pack, p) {
    const st = p.planning
    const pl = pack.game.phases.planning
    const now = (st?.running ?? []).map((r) => investigation(pack, p, r.id)?.public.title ?? '').filter(Boolean)
    return {
      now,
      facts: [
        { label: 'Insights found', value: `${st?.done.length ?? 0} of ${pl.investigations.per_system}` },
        { label: 'Problems sorted', value: `${Object.keys(st?.picks ?? {}).length} of ${pl.candidates}` },
        { label: 'Assessment', value: st && st.submittedAtMs !== null ? 'Sent' : 'Not sent yet' },
      ],
    }
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
