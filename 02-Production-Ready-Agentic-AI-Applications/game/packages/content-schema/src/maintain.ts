// Phase 3 on the canvas (engineering spec, sections 5.5 and 6.7): the build file of Phase 3 and
// the checks of a maintain.yaml that need no scoring. The scoring of a period is in
// `engine/src/maintain.ts`.
import { fromPackMap, mapErrors, readyReasons, type CanvasMap } from './canvas.ts'
import type { BuildFile, MaintainFile, Patch } from './schema.ts'

const built = new WeakMap<MaintainFile, BuildFile>()

/**
 * The build file of Phase 3: build.yaml with the workers, line rules and actions that
 * maintain.yaml adds. Phase 3 judges and scores every map on it. Without a maintain.yaml it is
 * the build file itself.
 */
export function phase3Build(build: BuildFile, maintain: MaintainFile | null | undefined): BuildFile {
  if (!maintain) return build
  const cached = built.get(maintain)
  if (cached) return cached
  // A model of Phase 3 joins the shelf, and every worker it names can carry it.
  const workers = [...build.workers, ...maintain.workers].map((w) => {
    const more = maintain.models.filter((mo) => mo.by_worker[w.id] !== undefined)
    if (!more.length) return w
    return { ...w, by_model: { ...(w.by_model ?? {}), ...Object.fromEntries(more.map((mo) => [mo.id, mo.by_worker[w.id]!])) } }
  })
  const out: BuildFile = {
    ...build,
    workers,
    models: [...build.models, ...maintain.models.map((mo) => ({ id: mo.id, public: mo.public, run: mo.run ?? 0, runs_on: mo.runs_on, ...(mo.key !== undefined ? { key: mo.key } : {}) }))],
    line_rules: [...build.line_rules, ...maintain.line_rules],
    actions: [...build.actions, ...maintain.actions],
  }
  built.set(maintain, out)
  return out
}

/** One reference map of a pack: `key.references`, or `key.reference` alone when the list is absent. */
export type ReferenceEntry = { id: string; label: string; summary: string; map: CanvasMap; needsActions: string[] }

export function referenceMaps(build: BuildFile): ReferenceEntry[] {
  const refs = build.key.references
  if (refs?.length) {
    return refs.map((r) => ({ id: r.id, label: r.public.label, summary: r.public.summary, map: fromPackMap(r.map), needsActions: [...r.needs_actions] }))
  }
  const r = build.key.reference
  return [{ id: 'reference', label: 'Reference map', summary: r.public_summary, map: fromPackMap(r.map), needsActions: [...r.needs_actions] }]
}

/** What a period is called: in full, in short, under its slot of the chart, and the year that begins with it. */
export type PeriodName = { label: string; short: string; tick: string; mark: string | null }

/**
 * The name of period `n`, from 1. The listed periods carry their own. Time that the facilitator
 * adds brings reports after them, named by the calendar of the file: the months of the cycle
 * with the year they fall in. Without a calendar such a period is called by its number.
 */
export function periodName(m: Pick<MaintainFile, 'periods' | 'calendar'>, n: number): PeriodName {
  const listed = m.periods[n - 1]
  const cal = m.calendar
  if (!cal) return listed ? { label: listed.label, short: listed.short, tick: listed.short, mark: null } : { label: `Period ${n}`, short: `P${n}`, tick: `P${n}`, mark: null }
  const base = m.periods[(n - 1) % cal.cycle]!
  const year = cal.first_year + Math.floor((n - 1) / cal.cycle)
  const mark = (n - 1) % cal.cycle === 0 ? String(year) : null
  if (listed) return { label: listed.label, short: listed.short, tick: base.short, mark }
  return { label: `${base.label} ${year}`, short: `${base.short} ’${String(year % 100).padStart(2, '0')}`, tick: base.short, mark }
}

type Report = (path: string, message: string) => void

/** The checks of a maintain.yaml against its build file. Errors stop the pack, warnings do not. */
export function checkMaintain(
  m: MaintainFile, b: BuildFile,
  opts: { rounds: number; groups: string[]; characterOk: (id: string) => boolean; prefix: string },
  err: Report, warn: Report,
): void {
  const b3 = phase3Build(b, m)
  const workers = new Set(b3.workers.map((w) => w.id))
  const sources = new Set(b.sources.map((s) => s.id))
  const compute = new Set(b.compute.map((c) => c.id))
  const models = new Set(b3.models.map((x) => x.id))
  const facts = new Set(b.facts.map((f) => f.id))
  const cases = new Set(b.cases.map((k) => k.id))
  const actions = new Set(b3.actions.map((a) => a.id))
  const own = new Set(m.actions.map((a) => a.id))
  const efforts = new Set<string>()
  for (const w of b3.workers) for (const q of [w.quality, ...Object.values(w.by_model ?? {})]) for (const e of Object.keys(q?.fetch ?? {})) efforts.add(e)
  const items = new Set([...sources, ...workers, ...models, ...compute, ...b.prompts.map((x) => x.id)])
  const need = (set: Set<string>, id: string, path: string, what: string) => { if (!set.has(id)) err(path, `unknown ${what} "${id}"`) }
  const last = m.periods.length

  if (last !== opts.rounds + 1) err('periods', `holds ${last} periods, game.yaml asks for rounds + 1 = ${opts.rounds + 1}`)
  m.periods.forEach((p, i) => { if (m.periods.findIndex((x) => x.id === p.id) !== i) err(`periods[${i}].id`, `period "${p.id}" is listed twice`) })
  if (m.calendar && m.calendar.cycle > last) err('calendar.cycle', `a cycle of ${m.calendar.cycle} periods, and only ${last} are listed`)
  m.grants.forEach((g, i) => { if (g.round > opts.rounds) err(`grants[${i}].round`, `round ${g.round} is after the last round, ${opts.rounds}`) })
  if (!b.pools.some((p) => p.id === m.score.pool)) err('score.pool', `unknown pool "${m.score.pool}"`)

  // The map of a practice with no deployed map is scored like any other.
  const base = fromPackMap(m.baseline.map)
  const baseErrs = mapErrors(base, b3)
  if (baseErrs.length) err('baseline.map', `the map is not accepted: ${baseErrs.join(', ')}`)
  else if (readyReasons(base, b3).length) err('baseline.map', `the map is not ready: ${readyReasons(base, b3).join(', ')}`)

  const R = m.reliability
  for (const id of Object.keys(R.workers)) need(workers, id, `reliability.workers.${id}`, 'worker')
  for (const id of Object.keys(R.sources)) need(sources, id, `reliability.sources.${id}`, 'source')
  for (const id of Object.keys(R.compute)) need(compute, id, `reliability.compute.${id}`, 'place to run')
  for (const id of Object.keys(R.connectors)) need(workers, id, `reliability.connectors.${id}`, 'worker')
  R.new_map?.spared_by.forEach((id, i) => need(actions, id, `reliability.new_map.spared_by[${i}]`, 'action'))
  R.hardening.forEach((h, i) => {
    need(actions, h.action, `reliability.hardening[${i}].action`, 'action')
    h.workers?.forEach((id, j) => need(workers, id, `reliability.hardening[${i}].workers[${j}]`, 'worker'))
  })
  for (const [name, ids] of Object.entries(m.lenses)) ids?.forEach((id, i) => need(actions, id, `lenses.${name}[${i}]`, 'action'))

  m.workers.forEach((w, i) => {
    if (!w.id.startsWith(opts.prefix)) err(`workers[${i}].id`, `id "${w.id}" must start with "${opts.prefix}"`)
    if (b.workers.some((x) => x.id === w.id)) err(`workers[${i}].id`, `worker "${w.id}" is in build.yaml already`)
    if (w.needs_model ? !w.by_model : !w.quality) err(`workers[${i}]`, 'a worker needs `by_model` with a model, or `quality` without one')
    if (w.kind === 'person' && (!w.pool || !w.minutes)) err(`workers[${i}]`, 'a person needs a pool and minutes')
    const numbers = w.needs_model ? Object.values(w.by_model ?? {}) : w.quality ? [w.quality] : []
    for (const q of numbers) for (const e of efforts) if (q.fetch[e] === undefined) err(`workers[${i}]`, `no fetch number for the effort "${e}"`)
    if (!items.has(w.id)) return
    if (!m.actions.some((a) => a.unlocks.includes(w.id))) warn(`workers[${i}].id`, 'no action of Phase 3 unlocks this worker: it is open from the start')
  })
  m.line_rules.forEach((r, i) => {
    if (!sources.has(r.from) && !workers.has(r.from)) err(`line_rules[${i}].from`, `unknown source or worker "${r.from}"`)
    need(workers, r.to, `line_rules[${i}].to`, 'worker')
  })
  const groups = new Set(opts.groups)
  m.actions.forEach((a, i) => {
    if (!a.id.startsWith(opts.prefix)) err(`actions[${i}].id`, `id "${a.id}" must start with "${opts.prefix}"`)
    if (b.actions.some((x) => x.id === a.id)) err(`actions[${i}].id`, `action "${a.id}" is in build.yaml already`)
    if (m.actions.findIndex((x) => x.id === a.id) !== i) err(`actions[${i}].id`, `action "${a.id}" is listed twice`)
    if (!groups.has(a.group)) err(`actions[${i}].group`, `unknown group "${a.group}"`)
    a.requires.forEach((id, j) => need(actions, id, `actions[${i}].requires[${j}]`, 'action'))
    a.unlocks.forEach((id, j) => need(items, id, `actions[${i}].unlocks[${j}]`, 'item'))
    if (a.repeat && a.unlocks.length) warn(`actions[${i}].repeat`, 'an action that unlocks an item gains nothing from being done again')
    if (a.insight?.type === 'quote' && !opts.characterOk(a.insight.data.speaker)) err(`actions[${i}].insight.data.speaker`, `unknown character "${a.insight.data.speaker}"`)
  })

  const patch = (p: Patch, path: string) => {
    switch (p.op) {
      case 'weights': for (const id of Object.keys(p.cases)) need(cases, id, `${path}.cases.${id}`, 'case'); break
      case 'fetch_as': need(efforts, p.effort, `${path}.effort`, 'effort'); need(efforts, p.as, `${path}.as`, 'effort'); break
      case 'worker':
        need(workers, p.worker, `${path}.worker`, 'worker')
        for (const k of Object.keys(p.fetch ?? {})) if (k !== '*') need(efforts, k, `${path}.fetch.${k}`, 'effort')
        for (const k of Object.keys(p.decide ?? {})) if (k !== '*' && k !== 'plain' && k !== 'hard') err(`${path}.decide.${k}`, 'a difficulty is plain or hard')
        break
      case 'knows': need(facts, p.fact, `${path}.fact`, 'fact'); p.workers.forEach((id, j) => need(workers, id, `${path}.workers[${j}]`, 'worker')); break
      case 'gives':
        need(sources, p.source, `${path}.source`, 'source'); need(facts, p.fact, `${path}.fact`, 'fact')
        if (p.unless_through !== undefined) need(workers, p.unless_through, `${path}.unless_through`, 'worker')
        break
      case 'compute': need(compute, p.compute, `${path}.compute`, 'place to run'); break
      case 'model':
        need(models, p.model, `${path}.model`, 'model')
        for (const k of Object.keys(p.fetch ?? {})) if (k !== '*') need(efforts, k, `${path}.fetch.${k}`, 'effort')
        for (const k of Object.keys(p.decide ?? {})) if (k !== '*' && k !== 'plain' && k !== 'hard') err(`${path}.decide.${k}`, 'a difficulty is plain or hard')
        if (p.run === undefined && !p.fetch && !p.decide && p.catch === undefined) err(path, 'the patch of a model changes its price, or what the workers do with it')
        break
    }
  }
  m.world.forEach((p, i) => {
    patch(p, `world[${i}]`)
    if (JSON.stringify(p).includes('[')) err(`world[${i}]`, 'a factor that grows by the period belongs to an event: `world` holds all year')
  })
  m.events.forEach((e, i) => {
    const at = `events[${i}]`
    if (!e.id.startsWith(opts.prefix)) err(`${at}.id`, `id "${e.id}" must start with "${opts.prefix}"`)
    if (m.events.findIndex((x) => x.id === e.id) !== i) err(`${at}.id`, `event "${e.id}" is listed twice`)
    if (e.from > last) err(`${at}.from`, `period ${e.from} is after the last period, ${last}`)
    if (e.to !== undefined && (e.to < e.from || e.to > last)) err(`${at}.to`, `must lie between from (${e.from}) and the last period (${last})`)
    e.needs?.workers?.forEach((id, j) => need(workers, id, `${at}.needs.workers[${j}]`, 'worker'))
    e.needs?.sources?.forEach((id, j) => need(sources, id, `${at}.needs.sources[${j}]`, 'source'))
    e.needs?.compute?.forEach((id, j) => need(compute, id, `${at}.needs.compute[${j}]`, 'place to run'))
    e.needs?.models?.forEach((id, j) => need(models, id, `${at}.needs.models[${j}]`, 'model'))
    e.patches.forEach((p, j) => patch(p, `${at}.patches[${j}]`))
    e.risks.forEach((r, j) => {
      const path = `${at}.risks[${j}]`
      r.sources?.forEach((id, k) => need(sources, id, `${path}.sources[${k}]`, 'source'))
      r.workers?.forEach((id, k) => need(workers, id, `${path}.workers[${k}]`, 'worker'))
      r.models?.forEach((id, k) => need(models, id, `${path}.models[${k}]`, 'model'))
      if (r.sources && r.line === undefined) err(path, 'a risk on sources needs `line`')
      if ((r.workers || r.models) && r.tile === undefined) err(path, 'a risk on workers or models needs `tile`')
      if (!r.sources && !r.workers && !r.models && r.all === undefined) err(path, 'a risk names sources, workers, models or `all`')
    })
    e.repaired_by.forEach((id, j) => {
      need(actions, id, `${at}.repaired_by[${j}]`, 'action')
      // A repair must be startable after the break: an action of Phase 3 that may be done again,
      // or one that the player had no reason to do before.
      if (own.has(id) && !m.actions.find((a) => a.id === id)!.repeat) warn(`${at}.repaired_by[${j}]`, `"${id}" is not a repeat action: a player who did it before the event began cannot repair it`)
    })
    if (!e.patches.length && !e.risks.length && !e.fine) warn(at, 'the event changes nothing: no patch, no risk and no fine')
    if (e.symptom === undefined) warn(`${at}.symptom`, 'no symptom: a report cannot name this event as the worst change')
    if (e.reveal === undefined) warn(`${at}.reveal`, 'no reveal text: the event is left out of the reveal')
    if (e.cause?.lens !== undefined && !m.lenses[e.cause.lens]?.length) warn(`${at}.cause.lens`, `no action holds the lens "${e.cause.lens}", so the cause is never shown`)
    if (e.cause && e.cause.lens === undefined && !m.actions.some((a) => a.finds?.some((f) => f.event === e.id))) warn(`${at}.cause`, 'a cause without a lens is shown once an action has found the event, and no action finds it')
    if (e.alarm !== undefined && e.cause?.lens === undefined) warn(`${at}.alarm`, 'an alarm needs a cause with a lens: it is said when an action of that lens finishes')
  })
  const events = new Set(m.events.map((e) => e.id))
  const appears = (a: { round?: number; requires?: string[]; found?: string[] } | undefined, path: string) => {
    if (!a) return
    if (a.round !== undefined && a.round > opts.rounds) err(`${path}.round`, `round ${a.round} is after the last round, ${opts.rounds}`)
    a.requires?.forEach((id, j) => need(actions, id, `${path}.requires[${j}]`, 'action'))
    a.found?.forEach((id, j) => {
      need(events, id, `${path}.found[${j}]`, 'event')
      if (!m.actions.some((x) => x.finds?.some((f) => f.event === id))) err(`${path}.found[${j}]`, `no action finds the event "${id}", so this never appears`)
    })
  }
  m.actions.forEach((a, i) => {
    appears(a.appears, `actions[${i}].appears`)
    a.finds?.forEach((f, j) => {
      need(events, f.event, `actions[${i}].finds[${j}].event`, 'event')
      if (f.insight.type === 'quote' && !opts.characterOk(f.insight.data.speaker)) err(`actions[${i}].finds[${j}].insight.data.speaker`, `unknown character "${f.insight.data.speaker}"`)
    })
    if (a.finds?.length && !a.repeat) warn(`actions[${i}].finds`, 'a look action that is not a repeat action can be spent before there is anything to find')
  })
  m.models.forEach((mo, i) => {
    const at = `models[${i}]`
    if (!mo.id.startsWith(opts.prefix)) err(`${at}.id`, `id "${mo.id}" must start with "${opts.prefix}"`)
    if (b.models.some((x) => x.id === mo.id)) err(`${at}.id`, `model "${mo.id}" is in build.yaml already`)
    if (m.models.findIndex((x) => x.id === mo.id) !== i) err(`${at}.id`, `model "${mo.id}" is listed twice`)
    mo.runs_on.forEach((id, j) => need(compute, id, `${at}.runs_on[${j}]`, 'place to run'))
    for (const [id, q] of Object.entries(mo.by_worker)) {
      const w = b3.workers.find((x) => x.id === id)
      if (!w) { err(`${at}.by_worker.${id}`, `unknown worker "${id}"`); continue }
      if (!w.needs_model) err(`${at}.by_worker.${id}`, `the worker "${id}" carries no model`)
      for (const e of efforts) if (q.fetch[e] === undefined) err(`${at}.by_worker.${id}`, `no fetch number for the effort "${e}"`)
    }
    if (!Object.keys(mo.by_worker).length) err(`${at}.by_worker`, 'no worker can carry this model')
    appears(mo.appears, `${at}.appears`)
  })
  m.news.forEach((n, i) => {
    if (n.if_event !== undefined) need(events, n.if_event, `news[${i}].if_event`, 'event')
    if (!n.id.startsWith(opts.prefix)) err(`news[${i}].id`, `id "${n.id}" must start with "${opts.prefix}"`)
    if (m.news.findIndex((x) => x.id === n.id) !== i) err(`news[${i}].id`, `news item "${n.id}" is listed twice`)
    if (n.round > opts.rounds) err(`news[${i}].round`, `round ${n.round} is after the last round, ${opts.rounds}`)
    if (!opts.characterOk(n.from)) err(`news[${i}].from`, `unknown character "${n.from}"`)
  })
  if (m.alarm_from !== undefined && !opts.characterOk(m.alarm_from)) err('alarm_from', `unknown character "${m.alarm_from}"`)
  if (m.events.some((e) => e.alarm !== undefined) && m.alarm_from === undefined) err('alarm_from', 'an event has an alarm, and nobody is named to say it')

  // Every part that can fail has its sentence, or the report has nothing to say about it.
  const inc = m.incidents
  for (const id of Object.keys(inc.workers)) need(workers, id, `incidents.workers.${id}`, 'worker')
  for (const id of Object.keys(inc.sources)) need(sources, id, `incidents.sources.${id}`, 'source')
  for (const id of Object.keys(inc.compute)) need(compute, id, `incidents.compute.${id}`, 'place to run')
  for (const w of b3.workers) {
    const risk = R.workers[w.id] ?? R.default_worker
    if (risk > 0 && inc.workers[w.id] === undefined && inc.default_worker === undefined) warn('incidents.workers', `no sentence for the worker "${w.id}" and no default`)
  }
  for (const [id, risk] of Object.entries(R.sources)) if (risk > 0 && inc.sources[id] === undefined) warn('incidents.sources', `no sentence for the source "${id}"`)
  for (const [id, risk] of Object.entries(R.compute)) if (risk > 0 && inc.compute[id] === undefined) warn('incidents.compute', `no sentence for the place "${id}"`)
  if (R.handoff > 0 && inc.handoff === undefined) warn('incidents.handoff', 'handoffs can fail, and there is no sentence for one')
  if (R.new_map && R.new_map.risk > 0 && inc.new_map === undefined) warn('incidents.new_map', 'a new map can fail, and there is no sentence for it')
  for (const name of ['validity', 'reliability'] as const) {
    const bands = m.report[name]
    if (!bands.some((x) => x.min <= 0)) err(`report.${name}`, 'the bands must reach down to 0')
    bands.forEach((x, i) => { if (i > 0 && x.min >= bands[i - 1]!.min) err(`report.${name}[${i}].min`, 'the bands are listed from the highest `min` down') })
  }
  for (const name of ['gap', 'radiologists', 'steady', 'no_map'] as const) if (m.report[name] === undefined) warn(`report.${name}`, 'this sentence is missing')
  for (const id of Object.keys(m.key?.guide ?? {})) if (!workers.has(id) && !actions.has(id) && !models.has(id)) err(`key.guide.${id}`, `unknown worker, action or model "${id}"`)
}

/** The reference maps of a build file must be accepted and ready on the board of Phase 3 with everything unlocked. */
export function checkReferences(b: BuildFile, m: MaintainFile | null, err: Report): void {
  const b3 = phase3Build(b, m)
  const actions = new Set(b3.actions.map((a) => a.id))
  const refs = b.key.references ?? []
  refs.forEach((r, i) => {
    if (refs.findIndex((x) => x.id === r.id) !== i) err(`key.references[${i}].id`, `reference map "${r.id}" is listed twice`)
    r.needs_actions.forEach((id, j) => { if (!actions.has(id)) err(`key.references[${i}].needs_actions[${j}]`, `unknown action "${id}"`) })
    const map = fromPackMap(r.map)
    const errs = mapErrors(map, b3)
    if (errs.length) err(`key.references[${i}].map`, `the map is not accepted: ${errs.join(', ')}`)
    else if (readyReasons(map, b3).length) err(`key.references[${i}].map`, `the map is not ready: ${readyReasons(map, b3).join(', ')}`)
  })
}
