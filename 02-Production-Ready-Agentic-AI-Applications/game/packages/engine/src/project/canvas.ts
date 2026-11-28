// Projection of the canvas (engineering spec, section 9): what Phases 2 and 3 both send about
// the board, a map, a validation and a missed case. Built field by field, like everything that
// leaves the server. Nothing here spreads, passes through or strips a pack object.
import { copyLine, copySourceOrder, referenceMaps, type BuildFile, type CanvasMap as PackCanvasMap, type Pack, type ReadyDetail as PackReadyDetail, type SystemPack, type Tile as PackTile } from '@lab02/content-schema'
import type { BoardMark, CanvasLegend, CanvasMap, DevelopmentContent, ReadyDetail, ReferenceMap, Running, Tile } from '@lab02/protocol'
import { bestReaders, evaluate, type Running as EngineRunning } from '../canvas.ts'

export function tileView(t: PackTile): Tile {
  switch (t.type) {
    case 'stat': {
      const d = t.data
      const data: Extract<Tile, { type: 'stat' }>['data'] = { value: d.value, label: d.label }
      if (d.unit !== undefined) data.unit = d.unit
      if (d.comparison !== undefined) data.comparison = d.comparison
      return { type: 'stat', headline: t.headline, body: t.body, data }
    }
    case 'chart': {
      const d = t.data
      const data: Extract<Tile, { type: 'chart' }>['data'] = {
        kind: d.kind, xLabel: d.x_label, yLabel: d.y_label,
        series: d.series.map((sr) => ({ name: sr.name, points: sr.points.map(([x, y]) => [x, y] as [string | number, number]) })),
      }
      if (d.note !== undefined) data.note = d.note
      return { type: 'chart', headline: t.headline, body: t.body, data }
    }
    case 'quote':
      return { type: 'quote', headline: t.headline, body: t.body, data: { speaker: t.data.speaker, lines: t.data.text.split('\n') } }
    case 'audit': {
      const d = t.data
      const data: Extract<Tile, { type: 'audit' }>['data'] = {
        sampleSize: d.sample_size, findings: d.findings.map((f) => ({ label: f.label, count: f.count })),
      }
      if (d.note !== undefined) data.note = d.note
      return { type: 'audit', headline: t.headline, body: t.body, data }
    }
  }
}

/** A map in the form of the protocol. Field by field, like everything that leaves the server. */
export function mapView(m: PackCanvasMap): CanvasMap {
  return {
    tiles: m.tiles.map((t) => ({ id: t.id, kind: t.kind, col: t.col, row: t.row, model: t.model, runsOn: t.runsOn, prompt: t.prompt })),
    lines: m.lines.map(copyLine),
    ...copySourceOrder(m),
  }
}

/** The grid and the public names of what can stand on it, to draw a map read-only. */
export function canvasLegend(b: BuildFile): CanvasLegend {
  return {
    cols: b.grid.cols, rows: b.grid.rows, columns: columnsView(b),
    sources: b.sources.map((x) => ({ id: x.id, label: x.public.label, icon: x.public.icon, privateData: x.private_data })),
    result: { id: b.result.id, label: b.result.public.label },
    workers: b.workers.map((x) => ({ id: x.id, kind: x.kind, label: x.public.label, short: x.public.short, icon: x.public.icon, task: x.public.task ?? null })),
    models: b.models.map((x) => ({ id: x.id, label: x.public.label, short: x.public.short })),
    compute: b.compute.map((x) => ({ id: x.id, label: x.public.label, short: x.public.short, protectsPrivateData: x.protects_private_data })),
    prompts: b.prompts.map((x) => ({ id: x.id, label: x.public.short ?? x.public.label })),
  }
}

export function columnsView(b: BuildFile): { label: string; hint: string }[] | null {
  return b.grid.columns ? b.grid.columns.map((c) => ({ label: c.label, hint: c.hint })) : null
}

/** One action of the list, as a player sees it. */
export function actionView(x: BuildFile['actions'][number]): DevelopmentContent['actions'][number] {
  return {
    id: x.id, group: x.group, title: x.public.title, teaser: x.public.teaser,
    money: x.money, developers: x.developers, seconds: x.seconds,
    requires: [...x.requires], unlocks: [...x.unlocks], storyTime: x.story_time ?? null,
    inPlace: (x.marks?.length ?? 0) > 0,
  }
}

/** The tags of the actions that are done, one for every item each of them names, in the order of the list of actions. */
export function marksView(b: BuildFile, done: readonly string[]): BoardMark[] {
  const out: BoardMark[] = []
  for (const a of b.actions) {
    if (!a.marks || !done.includes(a.id)) continue
    for (const m of a.marks) for (const id of m.on) out.push({ id, tag: m.tag, short: m.short ?? m.tag, tip: m.tip })
  }
  return out
}

/** What of the board a player has: the items that are unlocked, the actions on the list, and the models that do not exist yet. */
export type BoardShown = { unlocked: ReadonlySet<string>; actions: readonly { id: string }[]; unseen?: ReadonlySet<string> }

/** The number a view and its content share: it grows whenever more comes onto the board. */
export function boardNumber(shown: BoardShown): number {
  return shown.unlocked.size + shown.actions.length
}

/**
 * What Phases 2 and 3 both send about the board, for the build file `b` (that of Phase 3 holds
 * what Phase 3 adds). The phase gives its own brief, number of validations and groups of actions.
 * `shown` is what this player has on the board: an item that is not unlocked comes with its
 * names and none of its words, and a model that does not exist yet does not come at all.
 */
export function canvasContent(
  pack: Pack, sp: SystemPack, b: BuildFile,
  own: { brief: { from: string; title: string; text: string } | undefined; validations: number; freeValidations?: number; validateSeconds: number; actionGroups: readonly { id: string; label: string }[] },
  shown: BoardShown,
): Omit<DevelopmentContent, 'phase' | 'actions'> {
  const rules = pack.game.phases.development
  const problem = sp.problems?.find((x) => x.id === b.problem)
  const open = (id: string) => shown.unlocked.has(id)
  const exists = (id: string) => !shown.unseen?.has(id)
  const listed = new Set(shown.actions.map((a) => a.id))
  const models = b.models.filter((x) => exists(x.id))
  return {
    board: boardNumber(shown),
    brief: own.brief ? { from: own.brief.from, title: own.brief.title, text: own.brief.text } : null,
    problem: { id: b.problem, title: problem?.public.title ?? '', description: problem?.public.description ?? '' },
    rules: {
      cols: b.grid.cols, rows: b.grid.rows, money: b.budget.money, developers: b.budget.developers,
      columns: columnsView(b),
      validations: own.validations, freeValidations: own.freeValidations ?? 0, validateSeconds: own.validateSeconds, showRunning: rules.show_running ?? true,
      moneyUnit: rules.money_unit ?? null,
      pools: b.pools.map((x) => ({ id: x.id, label: x.public.label, max: x.max })),
      actionGroups: own.actionGroups.map((g) => ({ id: g.id, label: g.label })),
      toolboxGroups: b.toolbox_groups.map((g) => ({ id: g.id, label: g.label })),
      more: {
        toolbox: [...new Set(b.workers.filter((x) => !open(x.id)).map((x) => x.group ?? ''))],
        // Only what another action opens: an action that waits for a round or a finding is a surprise.
        actions: [...new Set(b.actions.filter((a) => !listed.has(a.id) && a.requires.length > 0).map((a) => a.group))],
        models: models.some((x) => !open(x.id)),
        compute: b.compute.some((x) => !open(x.id)),
        prompts: b.prompts.some((x) => !open(x.id)),
      },
    },
    sources: b.sources.map((x) => ({ id: x.id, label: x.public.label, description: x.public.description, icon: x.public.icon, privateData: x.private_data })),
    result: { id: b.result.id, label: b.result.public.label, description: b.result.public.description },
    workers: b.workers.map((x) => ({
      id: x.id, kind: x.kind, label: x.public.label, short: x.public.short, description: open(x.id) ? x.public.description : '', icon: x.public.icon,
      task: open(x.id) ? x.public.task ?? null : null, group: x.group ?? null,
      costLine: open(x.id) ? x.public.cost_line ?? null : null, needsModel: x.needs_model,
      models: Object.keys(x.by_model ?? {}).filter(exists),
      pool: x.pool ?? null,
      // `per_line` stays here: its keys are the efforts, which say which source asks for what.
      minutes: x.minutes ? { decide: x.minutes.decide, check: x.minutes.check } : null,
    })),
    models: models.map((x) => ({ id: x.id, label: x.public.label, short: x.public.short, description: open(x.id) ? x.public.description : '', costLine: open(x.id) ? x.public.cost_line ?? null : null, runsOn: [...x.runs_on] })),
    compute: b.compute.map((x) => ({ id: x.id, label: x.public.label, short: x.public.short, description: open(x.id) ? x.public.description : '', costLine: open(x.id) ? x.public.cost_line ?? null : null, protectsPrivateData: x.protects_private_data })),
    prompts: b.prompts.map((x) => ({
      id: x.id, label: x.public.label, short: x.public.short ?? null, description: open(x.id) ? x.public.description : '',
      sample: !open(x.id) || x.public.samples ? null : x.public.sample ?? null,
      samples: open(x.id) ? (x.public.samples ?? []).map((y) => ({ label: y.label, text: y.text })) : [],
    })),
  }
}

/** Every reference map of a pack with its accuracy on the test set, scored on the tables `t`. */
export function referenceViews(b: BuildFile, t: BuildFile): ReferenceMap[] {
  return referenceMaps(b).map((r) => ({ id: r.id, label: r.label, summary: r.summary, map: mapView(r.map), accuracy: evaluate(r.map, t).accuracy }))
}

export function runningView(r: EngineRunning): Running {
  const minutes: Record<string, number> = {}
  for (const [k, v] of Object.entries(r.minutes)) minutes[k] = v
  return { money: r.money, minutes, complexity: r.complexity }
}

/** The words of a missed case: its public text and why the map missed it. */
type MissedCase = { case: string; reason: 'missing' | 'weak' | 'decision'; fact: string | null }

const readersOf = new WeakMap<object, ReturnType<typeof bestReaders>>()

/**
 * One sentence or two for a player: what would have saved the case that the map lost. It names
 * the source, and a tool, an operator or an action only when that is on the player's board, so
 * that nothing hidden is given away.
 */
export function hintOf(b: BuildFile, m: MissedCase, map: PackCanvasMap, shown: BoardShown): string {
  if (m.reason === 'decision' || m.fact === null) {
    return evaluate(map, b).flags.overloaded.length
      ? 'Everything this patient needed arrived, and the decision was still wrong. The tile that decides reads too many things at once. Hand it fewer of them, already sorted.'
      : 'Everything this patient needed arrived, and the decision was still wrong. A stronger model on the tile that decides, or a prompt written for deciding, would help.'
  }
  const fact = m.fact
  const source = b.sources.find((x) => (x.gives[fact] ?? 0) >= 1) ?? b.sources.find((x) => x.gives[fact] !== undefined)
  if (!source) return 'Nothing your practice can reach holds what this patient needed.'
  const name = source.public.label
  // How to get something that is not on the board yet: by the action that opens it, when the player can see that action.
  const opener = (item: string): string => {
    const a = b.actions.find((x) => x.unlocks.includes(item))
    return a && shown.actions.some((x) => x.id === a.id)
      ? `"${a.public.title}" in your actions opens it.`
      : 'Keep learning, and the way to it will show up in your actions.'
  }
  if (!shown.unlocked.has(source.id)) return `This patient needed ${name}, which your practice cannot reach yet. ${opener(source.id)}`
  if (!map.lines.some((ln) => ln.from === source.id)) return `Nothing on this map reads ${name}. Give it a line to a tile that can read it.`
  let readers = readersOf.get(b)
  if (!readers) { readers = bestReaders(b); readersOf.set(b, readers) }
  const best = readers[source.id]
  const kinds = new Set(map.tiles.map((x) => x.kind))
  const label = (id: string) => b.workers.find((w) => w.id === id)?.public.label ?? 'a better tool'
  const start = `${name} was read, and too little came out of it.`
  if (best?.via && !kinds.has(best.via)) {
    return shown.unlocked.has(best.via)
      ? `${start} Put the tool "${label(best.via)}" between ${name} and the tile that reads it.`
      : `${start} There is a tool that readies it for its reader. ${opener(best.via)}`
  }
  if (best && !kinds.has(best.worker)) {
    return shown.unlocked.has(best.worker)
      ? `${start} ${label(best.worker)} gets more out of it.`
      : `${start} Something else reads it better. ${opener(best.worker)}`
  }
  return `${start} A stronger model on the tile that reads it, or fewer other things on that tile, would help.`
}

/** A lost case for the player: what it was, why the map lost it, and what would have saved it. */
export function missedView(b: BuildFile, m: MissedCase | null, map: PackCanvasMap, shown: BoardShown) {
  if (!m) return null
  const k = b.cases.find((x) => x.id === m.case)
  if (!k) return null
  const f = m.fact ? b.facts.find((x) => x.id === m.fact) : undefined
  const why = m.reason === 'missing' ? f?.miss.missing : m.reason === 'weak' ? f?.miss.weak : k.decision_miss
  return { title: k.public.title, text: k.public.text, why: why ?? k.decision_miss, hint: hintOf(b, m, map, shown) }
}

/** A reason the draft cannot be validated, field by field (the index of a required entry stays here). */
export function detailView(d: PackReadyDetail): ReadyDetail {
  switch (d.reason) {
    case 'tile_incomplete': return { reason: d.reason, tile: d.tile, missing: [...d.missing] }
    case 'required_missing': return { reason: d.reason, workers: [...d.workers], text: d.text }
    case 'too_many_minutes': return { reason: d.reason, pool: d.pool, used: d.used, max: d.max, tiles: [...d.tiles] }
    default: return { reason: d.reason }
  }
}

/** The tiles that need a model and lack a model or a place to run. */
export function incompleteTiles(b: BuildFile, m: PackCanvasMap): string[] {
  return m.tiles.filter((t) => b.workers.find((w) => w.id === t.kind)?.needs_model && (t.model === null || t.runsOn === null)).map((t) => t.id)
}

