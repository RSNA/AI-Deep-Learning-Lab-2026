// The checks of a build file beyond its shape (engineering spec, sections 5.4 and 12.3): every id
// resolves, every case can be fed, every person has a pool and minutes, every action does
// something, and the reference map is accepted and ready once its actions are done.
import { fromPackMap, mapErrors, readyReasons, startUnlocked } from './canvas.ts'
import type { BuildFile } from './schema.ts'

type Report = (path: string, message: string) => void

export function checkBuild(
  b: BuildFile,
  ctx: { problemIds: Set<string>; groups: string[]; insightTileOk: (speaker: string) => boolean },
  err: Report, warn: Report,
): void {
  if (!ctx.problemIds.has(b.problem)) err('problem', `unknown problem "${b.problem}"`)

  // One namespace for the items that can be placed, chosen or unlocked, and the result.
  const items = new Map<string, string>()
  const item = (id: string, path: string) => {
    if (items.has(id)) err(path, `id "${id}" is used twice (also at ${items.get(id)})`)
    else items.set(id, path)
  }
  item(b.result.id, 'result.id')
  b.sources.forEach((s, i) => item(s.id, `sources[${i}].id`))
  b.workers.forEach((w, i) => item(w.id, `workers[${i}].id`))
  b.models.forEach((m, i) => item(m.id, `models[${i}].id`))
  b.compute.forEach((c, i) => item(c.id, `compute[${i}].id`))
  b.prompts.forEach((p, i) => item(p.id, `prompts[${i}].id`))

  const once = <T extends { id: string }>(list: readonly T[], name: string) => {
    const seen = new Set<string>()
    list.forEach((x, i) => { if (seen.has(x.id)) err(`${name}[${i}].id`, `id "${x.id}" is used twice`); seen.add(x.id) })
    return seen
  }
  const factIds = once(b.facts, 'facts')
  const poolIds = once(b.pools, 'pools')
  const actionIds = once(b.actions, 'actions')
  once(b.cases, 'cases')
  once(b.notes, 'notes')
  const modelIds = new Set(b.models.map((m) => m.id))
  const computeIds = new Set(b.compute.map((c) => c.id))
  const workerIds = new Set(b.workers.map((w) => w.id))

  b.sources.forEach((s, i) => {
    for (const f of Object.keys(s.gives)) if (!factIds.has(f)) err(`sources[${i}].gives.${f}`, `unknown fact "${f}"`)
  })
  b.workers.forEach((w, i) => {
    const at = `workers[${i}]`
    if (w.needs_model) {
      if (w.kind !== 'ai') err(`${at}.needs_model`, 'only an AI worker carries a model')
      const keys = Object.keys(w.by_model ?? {})
      if (!keys.length) err(`${at}.by_model`, 'a worker that needs a model has an entry for every model it may carry')
      for (const m of keys) if (!modelIds.has(m)) err(`${at}.by_model.${m}`, `unknown model "${m}"`)
      if (w.quality) err(`${at}.quality`, 'a worker that needs a model takes its numbers from by_model')
    } else {
      if (!w.quality) err(`${at}.quality`, 'a worker without a model needs quality')
      if (w.by_model) err(`${at}.by_model`, 'a worker without a model has no by_model')
    }
    if (w.kind === 'person') {
      if (!w.pool) err(`${at}.pool`, 'a person needs a pool')
      else if (!poolIds.has(w.pool)) err(`${at}.pool`, `unknown pool "${w.pool}"`)
      if (!w.minutes) err(`${at}.minutes`, 'a person needs minutes')
    } else if (w.pool || w.minutes) err(`${at}.pool`, 'only a person takes minutes from a pool')
  })
  b.models.forEach((m, i) => m.runs_on.forEach((c, j) => { if (!computeIds.has(c)) err(`models[${i}].runs_on[${j}]`, `unknown compute "${c}"`) }))
  b.prompts.forEach((p, i) => {
    for (const w of Object.keys(p.by_worker ?? {})) if (!workerIds.has(w)) err(`prompts[${i}].by_worker.${w}`, `unknown worker "${w}"`)
  })
  if (b.workers.some((w) => w.needs_model) && (b.prompts.length < 1)) err('prompts', 'a pack with AI workers needs at least one prompt')
  if (b.prompts.length && (b.prompts.length < 3 || b.prompts.length > 4)) warn('prompts', `${b.prompts.length} prompts: a pack offers three or four`)

  const given = new Set(b.sources.flatMap((s) => Object.keys(s.gives)))
  b.cases.forEach((c, i) => c.needs.forEach((f, j) => {
    if (!factIds.has(f)) err(`cases[${i}].needs[${j}]`, `unknown fact "${f}"`)
    else if (!given.has(f)) err(`cases[${i}].needs[${j}]`, `no source gives fact "${f}"`)
  }))

  b.actions.forEach((a, i) => {
    const at = `actions[${i}]`
    if (ctx.groups.length && !ctx.groups.includes(a.group)) err(`${at}.group`, `unknown group "${a.group}"`)
    a.requires.forEach((r, j) => { if (!actionIds.has(r)) err(`${at}.requires[${j}]`, `unknown action "${r}"`); else if (r === a.id) err(`${at}.requires[${j}]`, 'an action cannot require itself') })
    a.unlocks.forEach((u, j) => { if (!items.has(u) || u === b.result.id) err(`${at}.unlocks[${j}]`, `unknown item "${u}"`) })
    if (!a.unlocks.length && !a.insight) err(at, 'an action unlocks nothing and has no insight')
    if (a.insight?.type === 'quote' && !ctx.insightTileOk(a.insight.data.speaker)) err(`${at}.insight.data.speaker`, `unknown character "${a.insight.data.speaker}"`)
    if (a.developers > b.budget.developers) err(`${at}.developers`, `needs ${a.developers} developers, the practice has ${b.budget.developers}`)
  })
  // `requires` never loops.
  const req = new Map(b.actions.map((a) => [a.id, a.requires]))
  const loops = (id: string, path: string[]): boolean => path.includes(id) || (req.get(id) ?? []).some((r) => loops(r, [...path, id]))
  b.actions.forEach((a, i) => { if (a.requires.some((r) => loops(r, [a.id]))) err(`actions[${i}].requires`, 'the requirements form a loop') })

  // The reference map is accepted and ready once its actions (and what they require) are done,
  // and the practice can pay for them.
  const ref = b.key.reference
  ref.needs_actions.forEach((id, j) => { if (!actionIds.has(id)) err(`key.reference.needs_actions[${j}]`, `unknown action "${id}"`) })
  const need = new Set<string>()
  const add = (id: string) => { if (need.has(id) || !actionIds.has(id)) return; need.add(id); for (const r of req.get(id) ?? []) add(r) }
  ref.needs_actions.forEach(add)
  const unlocked = startUnlocked(b)
  let money = 0
  for (const a of b.actions) if (need.has(a.id)) { money += a.money; for (const u of a.unlocks) unlocked.add(u) }
  if (money > b.budget.money) err('key.reference.needs_actions', `the actions cost ${money}, the budget is ${b.budget.money}`)
  const refMap = fromPackMap(ref.map)
  const errs = mapErrors(refMap, b, unlocked)
  if (errs.length) err('key.reference.map', `the reference map is refused: ${errs.join(', ')}`)
  else {
    const reasons = readyReasons(refMap, b)
    if (reasons.length) err('key.reference.map', `the reference map is not ready: ${reasons.join(', ')}`)
  }
  b.key.traps?.forEach((t, i) => {
    const e = mapErrors(fromPackMap(t.map), b, null)
    if (e.length) warn(`key.traps[${i}].map`, `the trap map is refused: ${e.join(', ')}`)
  })
  const noteIds = new Set(b.notes.map((n) => n.id))
  for (const n of ['private_data', 'overloaded', 'distracting', 'prompt', 'stray']) if (!noteIds.has(n as never)) warn('notes', `no note for "${n}"`)
}
