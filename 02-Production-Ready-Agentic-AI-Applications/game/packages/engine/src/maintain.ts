// Scoring a period of Phase 3 (engineering spec, section 6.7). A deployed map is scored with
// `evaluate` of ../canvas.ts on tables that the events of the year have changed, and its
// reliability is a product over every part that can fail. Everything is an expected value, so
// one map in one period with one set of actions always gets one report. The executable
// reference is `tools/maintain_scoring.py` of the private folder, and the parity vectors hold
// these functions to it.
import { fromPackMap, rushFactors, type CanvasMap, type CanvasTables } from '@lab02/content-schema'
import { evaluate, type Evaluation } from './canvas.ts'
import type { EventLoss, PeriodScore, RiskEntry } from './state.ts'

/** A factor: a number, or a list by periods since the event began (the last one holds). */
export type Factor = number | readonly number[]
/** A change to the tables while it holds. The pack schema checks the shape of each. */
export type TablePatch =
  | { op: 'weights'; cases: Readonly<Record<string, number>> }
  | { op: 'fetch_as'; effort: string; as: string; factor: number }
  | { op: 'worker'; worker: string; fetch?: Readonly<Record<string, Factor>>; decide?: Readonly<Record<string, Factor>>; catch?: Factor }
  | { op: 'knows'; fact: string; factor: number; workers: readonly string[] }
  | { op: 'gives'; source: string; fact: string; factor: number; unless_through?: string }
  | { op: 'compute'; compute: string; run_fixed?: number; price_factor?: number }
  | { op: 'model'; model: string; run?: Factor; fetch?: Readonly<Record<string, Factor>>; decide?: Readonly<Record<string, Factor>>; catch?: Factor }

export type EventRule = {
  id: string
  from: number
  to?: number
  needs?: { workers?: readonly string[]; sources?: readonly string[]; compute?: readonly string[]; models?: readonly string[]; flag?: string }
  patches?: readonly TablePatch[]
  risks?: readonly { sources?: readonly string[]; line?: number; behind_connector?: number; workers?: readonly string[]; models?: readonly string[]; tile?: number; all?: number }[]
  fine?: number
  repaired_by?: readonly string[]
}

/** Everything of a maintain.yaml that the scoring reads. A `MaintainFile` is one, and so is the toy year of the vectors. */
export type MaintainRules = {
  baseline: { map: Parameters<typeof fromPackMap>[0] }
  score: { cost_per_point: number; pool: string; extra_look?: number; rushed?: number }
  reliability: {
    workers?: Readonly<Record<string, number>>; default_worker?: number
    sources?: Readonly<Record<string, number>>; handoff?: number
    compute?: Readonly<Record<string, number>>; connectors?: Readonly<Record<string, number>>
    new_map?: { risk?: number; spared_by?: readonly string[] }
    hardening?: readonly { action: string; workers?: readonly string[]; factor: number }[]
    interruption?: number
  }
  lenses?: Readonly<Partial<Record<string, readonly string[]>>>
  actions?: readonly { id: string; run?: number }[]
  world?: readonly TablePatch[]
  events?: readonly EventRule[]
}

/** An action a player holds: the reports held when it started and when it finished (0 for Phase 2). */
export type HeldAction = { id: string; started: number; done: number }

const FLAG: Record<string, keyof Evaluation['flags']> = {
  private_data: 'privateData', overloaded: 'overloaded', distracting: 'distracting', prompt: 'prompt', stray: 'stray', rushed: 'rushed',
}

/**
 * Whether one of the actions `ids` finished before the report of period `p` was made. A repair
 * must also have started when the player had seen report `startedFrom`.
 */
export function counts(actions: readonly HeldAction[], ids: readonly string[], p: number, startedFrom: number | null = null): boolean {
  return actions.some((a) => ids.includes(a.id) && a.done < p && (startedFrom === null || a.started >= startedFrom))
}

export function lensHeld(rules: MaintainRules, name: string, actions: readonly HeldAction[], p: number): boolean {
  return counts(actions, rules.lenses?.[name] ?? [], p)
}

/** Whether an event has anything to act on in this map. */
export function touches(e: EventRule, m: CanvasMap, t3: CanvasTables): boolean {
  const need = e.needs
  if (!need) return true
  if (need.workers?.length && m.tiles.some((t) => need.workers!.includes(t.kind))) return true
  if (need.sources?.length && m.lines.some((l) => need.sources!.includes(l.from))) return true
  if (need.compute?.length && m.tiles.some((t) => t.runsOn !== null && need.compute!.includes(t.runsOn))) return true
  if (need.models?.length && m.tiles.some((t) => t.model !== null && need.models!.includes(t.model))) return true
  if (need.flag) {
    const key = FLAG[need.flag]
    if (key && evaluate(m, t3).flags[key].length > 0) return true
  }
  return false
}

/** The events that act on a player in period `p`: in their window, not repaired, with a part of the map to act on. */
export function actingEvents(t3: CanvasTables, rules: MaintainRules, p: number, m: CanvasMap, actions: readonly HeldAction[]): EventRule[] {
  // An event with no end holds for good, also in the periods that added time brings after the planned year.
  return (rules.events ?? []).filter((e) =>
    e.from <= p && p <= (e.to ?? Infinity)
    && !counts(actions, e.repaired_by ?? [], p, e.from)
    && touches(e, m, t3))
}

// ------------------------------------------------------------------------------------------
// The tables of a period
// ------------------------------------------------------------------------------------------
type Q = { fetch: Record<string, number>; decide: { plain: number; hard: number }; catch?: number; knows?: Record<string, number> }
type MutableTables = Omit<CanvasTables, 'cases' | 'workers' | 'sources' | 'compute' | 'models'> & {
  cases: { id: string; weight: number; needs: readonly string[]; difficulty: 'plain' | 'hard' }[]
  workers: (Omit<CanvasTables['workers'][number], 'quality' | 'by_model'> & { quality?: Q; by_model?: Record<string, Q> })[]
  sources: (Omit<CanvasTables['sources'][number], 'gives'> & { gives: Record<string, number> })[]
  compute: { id: string; protects_private_data?: boolean; price_factor?: number; run_fixed?: number }[]
  models: { id: string; run?: number; runs_on: readonly string[] }[]
}

function copyQ(q: NonNullable<CanvasTables['workers'][number]['quality']>): Q {
  const out: Q = { fetch: { ...q.fetch }, decide: { plain: q.decide.plain, hard: q.decide.hard } }
  if (q.catch !== undefined) out.catch = q.catch
  if (q.knows !== undefined) out.knows = { ...q.knows }
  return out
}

/** A copy of the tables whose numbers a patch may change. Everything a patch never touches is shared. */
function copyTables(t: CanvasTables): MutableTables {
  return {
    ...t,
    cases: t.cases.map((c) => ({ ...c })),
    workers: t.workers.map((w) => {
      const { quality, by_model: byModel, ...rest } = w
      const out: MutableTables['workers'][number] = { ...rest }
      if (quality) out.quality = copyQ(quality)
      if (byModel) out.by_model = Object.fromEntries(Object.entries(byModel).map(([k, q]) => [k, copyQ(q)]))
      return out
    }),
    sources: t.sources.map((s) => ({ ...s, gives: { ...s.gives } })),
    compute: (t.compute ?? []).map((c) => ({ ...c })),
    models: (t.models ?? []).map((x) => ({ ...x })),
  }
}

const qualities = (w: MutableTables['workers'][number]): Q[] => [...(w.quality ? [w.quality] : []), ...Object.values(w.by_model ?? {})]

/** The factor of a patch at `step` periods since its event began. */
const at = (x: Factor, step: number): number => (typeof x === 'number' ? x : x[Math.min(step, x.length - 1)]!)

/** Multiplies the numbers of one quality by the factors of a patch of a worker or a model. */
function scaleQ(q: Q, patch: { fetch?: Readonly<Record<string, Factor>>; decide?: Readonly<Record<string, Factor>>; catch?: Factor }, step: number): void {
  for (const [key, x] of Object.entries(patch.fetch ?? {})) for (const name of Object.keys(q.fetch)) if (key === '*' || key === name) q.fetch[name] = q.fetch[name]! * at(x, step)
  for (const [key, x] of Object.entries(patch.decide ?? {})) for (const name of ['plain', 'hard'] as const) if (key === '*' || key === name) q.decide[name] = q.decide[name] * at(x, step)
  if (patch.catch !== undefined && q.catch !== undefined) q.catch = q.catch * at(patch.catch, step)
}

function applyPatch(t: MutableTables, patch: TablePatch, m: CanvasMap, step = 0): void {
  switch (patch.op) {
    case 'weights':
      for (const c of t.cases) { const n = patch.cases[c.id]; if (n !== undefined) c.weight = n }
      return
    case 'fetch_as':
      for (const w of t.workers) for (const q of qualities(w)) {
        const from = q.fetch[patch.as]
        if (from !== undefined) q.fetch[patch.effort] = from * patch.factor
      }
      return
    case 'worker':
      for (const w of t.workers) if (w.id === patch.worker) for (const q of qualities(w)) scaleQ(q, patch, step)
      return
    case 'knows':
      for (const w of t.workers) {
        if (!patch.workers.includes(w.id)) continue
        for (const q of qualities(w)) if (q.knows && q.knows[patch.fact] !== undefined) q.knows[patch.fact] = q.knows[patch.fact]! * patch.factor
      }
      return
    case 'gives': {
      if (patch.unless_through !== undefined) {
        // The change is spared when every line from the source enters a tile of that kind.
        const kinds = new Map(m.tiles.map((x) => [x.id, x.kind]))
        const lines = m.lines.filter((l) => l.from === patch.source)
        if (lines.length && lines.every((l) => kinds.get(l.to) === patch.unless_through)) return
      }
      for (const s of t.sources) if (s.id === patch.source && s.gives[patch.fact] !== undefined) s.gives[patch.fact] = s.gives[patch.fact]! * patch.factor
      return
    }
    case 'compute':
      for (const c of t.compute) {
        if (c.id !== patch.compute) continue
        if (patch.run_fixed !== undefined) c.run_fixed = (c.run_fixed ?? 0) * patch.run_fixed
        if (patch.price_factor !== undefined) c.price_factor = (c.price_factor ?? 0) * patch.price_factor
      }
      return
    case 'model':
      if (patch.run !== undefined) for (const x of t.models) if (x.id === patch.model) x.run = (x.run ?? 0) * at(patch.run, step)
      // What every worker does with that model: the same shape as the patch of a worker.
      for (const w of t.workers) { const q = w.by_model?.[patch.model]; if (q) scaleQ(q, patch, step) }
      return
  }
}

/**
 * The tables of period `p`: `world`, then the patches of every acting event, in file order. A
 * factor given as a list is read at the number of periods since its event began.
 */
export function tablesFor(t3: CanvasTables, rules: MaintainRules, m: CanvasMap, acting: readonly EventRule[], p: number, skip: string | null = null): CanvasTables {
  const t = copyTables(t3)
  for (const patch of rules.world ?? []) applyPatch(t, patch, m)
  for (const e of acting) {
    if (e.id === skip) continue
    for (const patch of e.patches ?? []) applyPatch(t, patch, m, Math.max(0, p - e.from))
  }
  return t
}

// ------------------------------------------------------------------------------------------
// Reliability
// ------------------------------------------------------------------------------------------
/** Every part of a deployed map that can fail in period `p`, with its risk. Entries with no risk are left out. */
export function riskList(t3: CanvasTables, rules: MaintainRules, p: number, m: CanvasMap, actions: readonly HeldAction[], acting: readonly EventRule[], newMap: boolean): RiskEntry[] {
  const R = rules.reliability
  const workers = new Map(t3.workers.map((w) => [w.id, w]))
  const sources = new Set(t3.sources.map((s) => s.id))
  const kinds = new Map(m.tiles.map((x) => [x.id, x.kind]))
  const out: RiskEntry[] = []
  const add = (e: RiskEntry) => { if (e.risk > 0) out.push(e) }

  for (const tile of m.tiles) {
    const kind = tile.kind
    let base = R.workers?.[kind] ?? R.default_worker ?? 0
    for (const h of R.hardening ?? []) if (counts(actions, [h.action], p) && (!h.workers?.length || h.workers.includes(kind))) base = base * h.factor
    add({ part: 'worker', id: kind, tile: tile.id, risk: base, event: null })
    // A risk of an event on kinds of worker, or on the tiles that carry one of some models.
    for (const e of acting) for (const r of e.risks ?? []) {
      if (r.workers?.includes(kind) || (tile.model !== null && r.models?.includes(tile.model))) add({ part: 'worker', id: kind, tile: tile.id, risk: r.tile ?? 0, event: e.id })
    }
  }
  const handoffs: RiskEntry[] = []
  for (const ln of m.lines) {
    if (ln.to === t3.result.id) continue
    if (sources.has(ln.from)) {
      const kind = kinds.get(ln.to)
      // A person reads a source with their own eyes: nothing to break.
      if (kind !== undefined && workers.get(kind)?.kind === 'person') continue
      const connector = kind !== undefined ? R.connectors?.[kind] : undefined
      const share = connector ?? 1
      add({ part: 'source', id: ln.from, line: [ln.from, ln.to], risk: (R.sources?.[ln.from] ?? 0) * share, event: null })
      for (const e of acting) for (const r of e.risks ?? []) {
        if (!r.sources?.includes(ln.from)) continue
        // Behind a connector the event takes the connector's share, or the share the event
        // names for itself (`behind_connector`, often 0).
        const mine = connector !== undefined ? r.behind_connector ?? share : 1
        add({ part: 'source', id: ln.from, line: [ln.from, ln.to], risk: (r.line ?? 0) * mine, event: e.id })
      }
    } else {
      handoffs.push({ part: 'handoff', id: null, line: [ln.from, ln.to], risk: R.handoff ?? 0, event: null })
    }
  }
  for (const h of handoffs) add(h)
  const places: string[] = []
  for (const tile of m.tiles) {
    const w = workers.get(tile.kind)
    if (w?.needs_model && tile.model && tile.runsOn && !places.includes(tile.runsOn)) places.push(tile.runsOn)
  }
  for (const c of places) add({ part: 'compute', id: c, risk: R.compute?.[c] ?? 0, event: null })
  const nm = R.new_map
  if (nm && p >= 2 && newMap && !counts(actions, nm.spared_by ?? [], p)) add({ part: 'new_map', id: null, risk: nm.risk ?? 0, event: null })
  for (const e of acting) for (const r of e.risks ?? []) if (r.all !== undefined) add({ part: 'event', id: e.id, risk: r.all, event: e.id })
  return out
}

/** The reliability: the product over every entry of what does not fail. `without` leaves out the entries of one event. */
export function reliabilityOf(risks: readonly RiskEntry[], without: string | null = null): number {
  let rel = 1
  for (const r of risks) {
    if (without !== null && r.event === without) continue
    rel *= 1 - r.risk
  }
  return rel
}

export function interruptionsOf(rules: MaintainRules, rel: number): number {
  const unit = rules.reliability.interruption ?? 0.025
  if (rel >= 1 - 1e-12) return 0
  return Math.max(1, Math.floor((1 - rel) / unit + 0.5))
}

// ------------------------------------------------------------------------------------------
// A period, a validation, a year
// ------------------------------------------------------------------------------------------
const baselines = new WeakMap<object, CanvasMap>()
/** The map of a practice with no deployed map, in the form of the engine. */
export function baselineMap(rules: MaintainRules): CanvasMap {
  let m = baselines.get(rules.baseline)
  if (!m) { m = fromPackMap(rules.baseline.map); baselines.set(rules.baseline, m) }
  return m
}

/**
 * The scoring of period `p` (1 is the first) for the deployed map `m`, or for no map (null).
 * `newMap`: the map is not the one that ran in the period before.
 */
/** An event counts as a change for the worse, and as a hit, when it costs this much of a period (a share). */
const WORST_IMPACT = 0.005

export function period(
  t3: CanvasTables, rules: MaintainRules, p: number, m: CanvasMap | null, actions: readonly HeldAction[],
  newMap = false, shownCases: readonly string[] = [], shownNotes: readonly string[] = [],
): PeriodScore {
  if (m === null) {
    const base = baselineMap(rules)
    const acting = actingEvents(t3, rules, p, base, []).filter((e) => (e.patches?.length ?? 0) > 0)
    const ev = evaluate(base, tablesFor(t3, rules, base, acting, p), shownCases, shownNotes)
    return {
      noMap: true, validity: ev.accuracy, test: evaluate(base, t3).accuracy,
      reliability: 1, interruptions: 0, off: 0, poolTiles: 0, hurry: 1,
      value: 100 * ev.accuracy, runCost: 0, fine: 0,
      components: [], worstPart: null, events: [], worstEvent: null,
      perCase: ev.perCase, missed: ev.missed, note: null,
    }
  }
  const acting = actingEvents(t3, rules, p, m, actions)
  const tables = tablesFor(t3, rules, m, acting, p)
  const ev = evaluate(m, tables, shownCases, shownNotes)
  const validity = ev.accuracy
  const risks = riskList(t3, rules, p, m, actions, acting, newMap)
  const rel = reliabilityOf(risks)

  const events: EventLoss[] = []
  let worstEvent: string | null = null
  let worstImpact = WORST_IMPACT
  for (const e of acting) {
    // What the period would have been without this event: validity, reliability, running cost.
    let vLoss = 0, cLoss = 0
    if (e.patches?.length) {
      const wo = evaluate(m, tablesFor(t3, rules, m, acting, p, e.id))
      vLoss = wo.accuracy - validity
      cLoss = 2 * (ev.running.money - wo.running.money)
    }
    const rLoss = reliabilityOf(risks, e.id) - rel
    const impact = vLoss * rel + rLoss * validity
    const fine = e.fine ?? 0
    // `hit`: the event cost this player something in this period (the reveal says so).
    const hit = impact > WORST_IMPACT || cLoss > 1e-9 || fine > 0
    events.push({ id: e.id, validityLoss: vLoss, reliabilityLoss: rLoss, costLoss: cLoss, fine, impact, hit })
    if (impact > worstImpact) { worstEvent = e.id; worstImpact = impact }
  }

  let worstPart: number | null = null
  risks.forEach((r, i) => { if (worstPart === null || r.risk > risks[worstPart]!.risk + 1e-12) worstPart = i })

  const S = rules.score
  const workers = new Map(t3.workers.map((w) => [w.id, w]))
  const poolTiles = m.tiles.filter((x) => workers.get(x.kind)?.pool === S.pool).length
  const hurry = rushFactors(m, tables)[S.pool] ?? 1
  const off = (S.extra_look ?? 0) * Math.max(0, poolTiles - 1) + (S.rushed ?? 0) * (1 - hurry)

  let upkeep = 0
  const seen = new Set<string>()
  for (const a of rules.actions ?? []) {
    if (a.run && !seen.has(a.id) && counts(actions, [a.id], p)) { upkeep += a.run; seen.add(a.id) }
  }
  return {
    noMap: false, validity, test: evaluate(m, t3).accuracy,
    reliability: rel, interruptions: interruptionsOf(rules, rel),
    off, poolTiles, hurry,
    value: 100 * validity * rel - off,
    runCost: 2 * ev.running.money + 2 * upkeep,
    fine: acting.reduce((sum, e) => sum + (e.fine ?? 0), 0),
    components: risks, worstPart,
    events, worstEvent,
    perCase: ev.perCase, missed: ev.missed, note: ev.note,
  }
}

export type MaintainValidation = Pick<Evaluation, 'accuracy' | 'unhurried' | 'missed' | 'note' | 'running' | 'flags'> & {
  /** Scored on the cases of the period in progress, not on the test set. */
  fresh: boolean
  /** The reliability the map would have in the period in progress, or null without the lens. */
  reliability: number | null
}

/**
 * A validation in Phase 3 by a player who holds `seen` reports. On the test set, or with the
 * lens `fresh_test_set` on the cases of the period in progress. With the lens `dry_run` it
 * carries the reliability the map would have in that period.
 */
export function validation(
  t3: CanvasTables, rules: MaintainRules, seen: number, m: CanvasMap, actions: readonly HeldAction[],
  newMap = false, shownCases: readonly string[] = [], shownNotes: readonly string[] = [],
): MaintainValidation {
  const p = seen + 1
  const fresh = lensHeld(rules, 'fresh_test_set', actions, p)
  const acting = actingEvents(t3, rules, p, m, actions)
  const ev = evaluate(m, fresh ? tablesFor(t3, rules, m, acting, p) : t3, shownCases, shownNotes)
  const reliability = lensHeld(rules, 'dry_run', actions, p) ? reliabilityOf(riskList(t3, rules, p, m, actions, acting, newMap)) : null
  return { accuracy: ev.accuracy, unhurried: ev.unhurried, fresh, reliability, missed: ev.missed, note: ev.note, running: ev.running, flags: ev.flags }
}

export type YearScore = { mean: number; spent: number; score: number; raw: number }

/**
 * The score over the reports held so far. `paid`: the money of the actions and of what the
 * reference maps needed, up to now.
 */
export function live(rules: MaintainRules, reports: readonly { value: number; runCost: number; fine: number }[], paid: number): YearScore {
  if (!reports.length) return { mean: 0, spent: paid, score: 0, raw: 0 }
  let sum = 0, cost = 0
  for (const r of reports) { sum += r.value; cost += r.runCost + r.fine }
  const mean = sum / reports.length
  const spent = paid + cost
  const score = mean - spent / rules.score.cost_per_point
  return { mean, spent, score, raw: Math.max(0, 10 * score) }
}

/** A whole year: one deployed map, set of actions and `newMap` per period, in order. */
export function year(
  t3: CanvasTables, rules: MaintainRules,
  periods: readonly { map: CanvasMap | null; actions: readonly HeldAction[]; newMap: boolean }[], paid: number,
): YearScore & { values: number[]; validity: number[]; reliability: number[]; reports: PeriodScore[] } {
  const reports = periods.map((x, i) => period(t3, rules, i + 1, x.map, x.actions, x.newMap))
  return {
    ...live(rules, reports, paid),
    values: reports.map((r) => r.value), validity: reports.map((r) => r.validity), reliability: reports.map((r) => r.reliability),
    reports,
  }
}
