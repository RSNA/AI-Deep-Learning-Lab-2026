// The rules of a map on the canvas (engineering spec, sections 6.6 and 5.5): what `set_map`
// refuses, when a map is ready to validate, and the minutes it asks of the people. The loader
// uses them to check the reference map of a pack, the engine to judge every map a player sends.
// The executable reference is `tools/canvas_scoring.py` of the private folder; the parity
// vectors check these functions and the scoring of `engine/src/canvas.ts` against it.

export type CanvasTile = {
  id: string; kind: string; col: number; row: number
  model: string | null; runsOn: string | null; prompt: string | null
}
/** The four sides of a tile. A line may name the side it leaves and the side it enters. */
export const SIDES = ['top', 'right', 'bottom', 'left'] as const
export type Side = (typeof SIDES)[number]
/**
 * A line. `fromSide` and `toSide` are where the player attached it: they change how the line is
 * drawn and never a score. Without them the line joins the sides that face each other.
 */
export type CanvasLine = { from: string; to: string; fromSide?: Side; toSide?: Side }
/** A copy of a line that keeps its sides and nothing else. */
export function copyLine(l: CanvasLine): CanvasLine {
  return { from: l.from, to: l.to, ...(l.fromSide ? { fromSide: l.fromSide } : {}), ...(l.toSide ? { toSide: l.toSide } : {}) }
}
export type CanvasMap = { tiles: CanvasTile[]; lines: CanvasLine[] }

// `knows` is what a worker holds of a fact without a line to any source (a person who knows the
// guideline by heart, a model that has read about it).
type Quality = { fetch: Readonly<Record<string, number>>; decide: { plain: number; hard: number }; catch?: number; knows?: Readonly<Record<string, number>> }

/**
 * Everything of a build file that the rules and the scoring read. A `BuildFile` is one, and so is
 * the toy pack of the parity vectors. Phase 3 will pass tables that its events have changed.
 */
export type CanvasTables = {
  grid: { cols: number; rows: number }
  pools?: readonly { id: string; max: number; over?: 'refuse' | 'rush' }[]
  handoff?: { keep: number }
  quality_cap?: number
  // A model is paid for what it reads. With `reading`, every kind of effort has a `size` in
  // reading units, `handoff` is the size of whatever a tile hands on that is not a prepared
  // source, and the price of a model is per unit. Without it a model is paid per call
  // (`calls` of the worker). `tokens_per_unit` only turns units into tokens on the screen.
  reading?: { handoff: number; tokens_per_unit?: number }
  efforts?: readonly { id: string; size?: number }[]
  facts: readonly { id: string }[]
  sources: readonly {
    id: string; gives: Readonly<Record<string, number>>; effort: string
    private_data?: boolean; distracts?: number; run?: number
  }[]
  result: { id: string }
  workers: readonly {
    id: string; kind: string; needs_model?: boolean
    by_model?: Readonly<Record<string, Quality>>; quality?: Quality
    load?: { free: number; factor: number }; calls?: number; run?: number; complexity?: number
    pool?: string; minutes?: { decide: number; check: number; per_line: Readonly<Record<string, number>> }
    // A tool that prepares its sources for the worker behind it, by kind of effort: that worker
    // reads the source itself, as the kind of effort `as` (its own number for it), and nothing is
    // lost at a handoff. The source counts toward the load of that worker with the weight `load`
    // (1 when absent), and a person pays the minutes of the kind `as`.
    prepares?: Readonly<Record<string, { as: string; load?: number }>>
  }[]
  models?: readonly { id: string; run?: number; runs_on: readonly string[] }[]
  compute?: readonly { id: string; protects_private_data?: boolean; price_factor?: number; run_fixed?: number }[]
  prompts?: readonly { id: string; fetch?: number; decide?: number; by_worker?: Readonly<Record<string, { fetch?: number; decide?: number }>> }[]
  actions?: readonly { id: string; unlocks?: readonly string[] }[]
  cases: readonly { id: string; weight: number; needs: readonly string[]; difficulty: 'plain' | 'hard' }[]
  notes?: readonly { id: string }[]
  line_rules?: readonly LineRule[]
  required?: readonly { workers: readonly string[]; text: string }[]
}

/** A line the practice cannot draw (`refuse`), or one that comes with a word of advice. */
export type LineRule = { from: string; to: string; refuse: boolean; text: string }

export const TILE_ID = /^t[0-9a-z]{1,8}$/
export const MAX_LINES = 80

export type MapError =
  | 'bad_tile_id' | 'bad_kind' | 'off_grid' | 'cell_taken' | 'no_parts_here' | 'bad_model' | 'bad_compute'
  | 'bad_prompt' | 'model_cannot_run_there' | 'too_many_lines' | 'line_twice' | 'bad_line_end'
  | 'source_locked' | 'source_to_result' | 'line_loop' | 'result_takes_one_line' | 'line_refused'

/** The items that some action unlocks. Every other item is open from the start. */
export function lockedItems(t: CanvasTables): Set<string> {
  const out = new Set<string>()
  for (const a of t.actions ?? []) for (const id of a.unlocks ?? []) out.add(id)
  return out
}

/** Every item of the tables: sources, worker kinds, models, computes, prompts. */
export function allItems(t: CanvasTables): string[] {
  return [
    ...t.sources.map((x) => x.id), ...t.workers.map((x) => x.id), ...(t.models ?? []).map((x) => x.id),
    ...(t.compute ?? []).map((x) => x.id), ...(t.prompts ?? []).map((x) => x.id),
  ]
}

export function startUnlocked(t: CanvasTables): Set<string> {
  const locked = lockedItems(t)
  return new Set(allItems(t).filter((id) => !locked.has(id)))
}

/**
 * Where the tiles of a player run once some actions are done: every place that an action
 * `moves` away from, with the place it moves to. A place that was moved from is off the shelf.
 */
export function movedPlaces(t: { actions?: readonly { id: string; moves?: Readonly<Record<string, string>> }[] }, done: readonly string[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const a of t.actions ?? []) if (a.moves && done.includes(a.id)) for (const [from, to] of Object.entries(a.moves)) out.set(from, to)
  return out
}

/** The map with every tile on a moved place put on the place it moved to. The same map when nothing moves. */
export function movedMap(m: CanvasMap, moved: ReadonlyMap<string, string>): CanvasMap {
  if (!m.tiles.some((x) => x.runsOn !== null && moved.has(x.runsOn))) return m
  return { tiles: m.tiles.map((x) => (x.runsOn !== null && moved.has(x.runsOn) ? { ...x, runsOn: moved.get(x.runsOn)! } : x)), lines: m.lines }
}

/** The first prompt of the pack is the default: a tile whose prompt is null carries it. */
export function defaultPrompt(t: CanvasTables): string | null {
  return t.prompts?.[0]?.id ?? null
}

/** A map of a pack file (`runs_on`) in the form of the engine (`runsOn`). */
export function fromPackMap(m: { tiles: readonly { id: string; kind: string; col: number; row: number; model?: string | null; runs_on?: string | null; prompt?: string | null }[]; lines: readonly { from: string; to: string; from_side?: Side; to_side?: Side }[] }): CanvasMap {
  return {
    tiles: m.tiles.map((t) => ({ id: t.id, kind: t.kind, col: t.col, row: t.row, model: t.model ?? null, runsOn: t.runs_on ?? null, prompt: t.prompt ?? null })),
    lines: m.lines.map((l) => copyLine({ from: l.from, to: l.to, fromSide: l.from_side, toSide: l.to_side })),
  }
}

const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x)

/**
 * The rule of `line_rules` that a line matches, or null: `from` is the id of its source or the
 * kind of the tile it starts at, `to` the kind of the tile it ends at. A line into the result
 * matches no rule. The first rule of the list that matches counts.
 */
export function lineRuleOf(line: CanvasLine, m: CanvasMap, t: CanvasTables): LineRule | null {
  const rules = t.line_rules
  if (!rules?.length || line.to === t.result.id) return null
  const to = m.tiles.find((x) => x.id === line.to)
  if (!to) return null
  const fromTile = m.tiles.find((x) => x.id === line.from)
  const from = fromTile ? fromTile.kind : line.from
  return rules.find((r) => r.from === from && r.to === to.kind) ?? null
}

/** The lines of a map that a rule refuses (`refuse: true`) or advises on (`refuse: false`), with the rule. */
export function ruledLines(m: CanvasMap, t: CanvasTables): { line: CanvasLine; rule: LineRule }[] {
  if (!t.line_rules?.length) return []
  const out: { line: CanvasLine; rule: LineRule }[] = []
  for (const line of m.lines) {
    const rule = lineRuleOf(line, m, t)
    if (rule) out.push({ line: { from: line.from, to: line.to }, rule })
  }
  return out
}

/**
 * Why `set_map` refuses a map (section 6.6), sorted, without repeats. Empty when it is accepted.
 * `unlocked` is the set of items the practice may use; null means everything.
 */
export function mapErrors(m: CanvasMap, t: CanvasTables, unlocked: ReadonlySet<string> | null = null): MapError[] {
  const ok = (id: string) => unlocked === null || unlocked.has(id)
  const sources = new Map(t.sources.map((s) => [s.id, s]))
  const workers = new Map(t.workers.map((w) => [w.id, w]))
  const models = new Map((t.models ?? []).map((x) => [x.id, x]))
  const compute = new Set((t.compute ?? []).map((x) => x.id))
  const prompts = new Set((t.prompts ?? []).map((x) => x.id))
  const errs = new Set<MapError>()
  const tiles = new Map<string, CanvasTile>()
  const cells = new Set<string>()
  for (const tile of m.tiles) {
    const tid = tile.id
    if (typeof tid !== 'string' || !TILE_ID.test(tid) || tiles.has(tid)) { errs.add('bad_tile_id'); continue }
    tiles.set(tid, tile)
    const w = workers.get(tile.kind)
    if (!w || !ok(w.id)) { errs.add('bad_kind'); continue }
    if (!(isInt(tile.col) && isInt(tile.row) && tile.col >= 1 && tile.col <= t.grid.cols && tile.row >= 1 && tile.row <= t.grid.rows)) errs.add('off_grid')
    else if (cells.has(`${tile.col},${tile.row}`)) errs.add('cell_taken')
    else cells.add(`${tile.col},${tile.row}`)
    const model = tile.model ?? null, where = tile.runsOn ?? null, prompt = tile.prompt ?? null
    if (!w.needs_model) {
      if (model !== null || where !== null || prompt !== null) errs.add('no_parts_here')
      continue
    }
    // A model this kind of worker has no numbers for cannot be carried. The reference scorer
    // does not name this case, because its toy pack gives every worker every model.
    if (model !== null && (!models.has(model) || !ok(model) || !w.by_model?.[model])) errs.add('bad_model')
    if (where !== null && (!compute.has(where) || !ok(where))) errs.add('bad_compute')
    if (prompt !== null && (!prompts.has(prompt) || !ok(prompt))) errs.add('bad_prompt')
    if (model !== null && where !== null && models.has(model) && compute.has(where) && !models.get(model)!.runs_on.includes(where)) errs.add('model_cannot_run_there')
  }
  const seen = new Set<string>()
  const between: [string, string][] = []      // the lines between two tiles
  let intoResult = 0
  if (m.lines.length > MAX_LINES) errs.add('too_many_lines')
  for (const ln of m.lines) {
    const a = ln.from, b = ln.to
    // A side is one of the four, on a tile. A source and the result have one place for a line.
    const sideOk = (x: unknown) => x === undefined || (SIDES as readonly unknown[]).includes(x)
    if (!sideOk(ln.fromSide) || !sideOk(ln.toSide) || (ln.fromSide !== undefined && sources.has(a)) || (ln.toSide !== undefined && b === t.result.id)) errs.add('bad_line_end')
    const key = `${a}\u0000${b}`
    if (seen.has(key)) { errs.add('line_twice'); continue }
    seen.add(key)
    const fromSource = sources.has(a)
    if (!fromSource && !tiles.has(a)) { errs.add('bad_line_end'); continue }
    if (fromSource && !ok(a)) errs.add('source_locked')
    if (b === t.result.id) {
      if (fromSource) errs.add('source_to_result')
      intoResult++
      continue
    }
    if (!tiles.has(b)) { errs.add('bad_line_end'); continue }
    if (!fromSource) between.push([a, b])
    if (t.line_rules?.length && lineRuleOf(ln, m, t)?.refuse) errs.add('line_refused')
  }
  if (intoResult > 1) errs.add('result_takes_one_line')
  // Lines between tiles may run in any direction. They must not form a loop.
  if (between.some(([a, b]) => a === b) || handoffOrder(tiles, between) === null) errs.add('line_loop')
  return [...errs].sort()
}

/**
 * The tiles in the order of the handoffs: a tile comes after every tile that hands to it. Among
 * tiles that are free to come next, the one nearer the top left comes first (column, row, id).
 * `pairs` are the lines between tiles, `only` limits the order to a set of tiles. Null when the
 * lines form a loop.
 */
export function handoffOrder(tiles: ReadonlyMap<string, CanvasTile>, pairs: readonly (readonly [string, string])[], only: ReadonlySet<string> | null = null): string[] | null {
  const ids = [...tiles.keys()].filter((id) => only === null || only.has(id))
  const num = (x: unknown) => (typeof x === 'number' ? x : 0)
  const before = (a: string, b: string) => {
    const x = tiles.get(a)!, y = tiles.get(b)!
    return num(x.col) - num(y.col) || num(x.row) - num(y.row) || (a < b ? -1 : a > b ? 1 : 0)
  }
  const waits = new Map<string, number>(ids.map((id) => [id, 0]))
  const out = new Map<string, string[]>(ids.map((id) => [id, []]))
  for (const [a, b] of pairs) {
    if (!waits.has(a) || !waits.has(b)) continue
    waits.set(b, waits.get(b)! + 1)
    out.get(a)!.push(b)
  }
  const free = ids.filter((id) => waits.get(id) === 0).sort(before)
  const order: string[] = []
  while (free.length) {
    const n = free.shift()!
    order.push(n)
    for (const b of out.get(n)!) {
      waits.set(b, waits.get(b)! - 1)
      if (waits.get(b) === 0) free.push(b)
    }
    free.sort(before)
  }
  return order.length === ids.length ? order : null
}

/** The shape of an accepted map: who reads where, who hands to whom, the signer, the live tiles. */
export type MapShape = {
  tiles: Map<string, CanvasTile>
  srcIn: Map<string, string[]>          // sources with a line into the tile
  wrkIn: Map<string, string[]>          // tiles with a line into the tile
  signer: string | null
  live: Set<string>
  order: string[]                       // live tiles in the order of the handoffs
}

const byCell = (tiles: Map<string, CanvasTile>) => (a: string, b: string) => {
  const x = tiles.get(a)!, y = tiles.get(b)!
  return x.col - y.col || x.row - y.row
}

export function mapShape(m: CanvasMap, t: CanvasTables): MapShape {
  const sourceIds = new Set(t.sources.map((s) => s.id))
  const tiles = new Map(m.tiles.map((x) => [x.id, x]))
  const srcIn = new Map<string, string[]>([...tiles.keys()].map((id) => [id, []]))
  const wrkIn = new Map<string, string[]>([...tiles.keys()].map((id) => [id, []]))
  let signer: string | null = null
  for (const ln of m.lines) {
    if (ln.to === t.result.id) signer = ln.from
    else if (sourceIds.has(ln.from)) srcIn.get(ln.to)!.push(ln.from)
    else wrkIn.get(ln.to)!.push(ln.from)
  }
  const live = new Set<string>()
  const stack = signer ? [signer] : []
  while (stack.length) {
    const n = stack.pop()!
    if (live.has(n)) continue
    live.add(n)
    stack.push(...wrkIn.get(n)!)
  }
  const pairs: [string, string][] = []
  for (const [n, from] of wrkIn) for (const u of from) pairs.push([u, n])
  const order = handoffOrder(tiles, pairs, live) ?? []
  return { tiles, srcIn, wrkIn, signer, live, order }
}

/** What a tool makes of a source for the worker behind it: the kind of effort it becomes and its weight in that worker's load. */
export type Prepared = { effort: string; load: number }

/**
 * The sources that tile `u` prepares for the worker behind it, each with its candidates: the
 * kind of effort it becomes and its weight in the load of that worker. They are the sources with
 * a line into `u` whose effort its worker names in `prepares`. Empty for a tile of any other
 * worker.
 *
 * Tools may stand in a row. A source that reaches `u` through another tile that prepares goes on
 * through `u`, with one more candidate when `u` names its effort and unchanged when it does not.
 * A tool behind a tool works on what the one before it made of the source: it looks up the kind
 * of the last candidate first, and the raw effort of the source when it has no entry for that.
 * The candidates stand in the order of the row, from the source to the reader, and the reader
 * takes one of them (`pickPrepared`). So a second tool on the same source earns nothing and
 * loses nothing. `wrkIn` are the tiles with a line into each tile.
 */
export function preparedBy(
  u: string, tiles: ReadonlyMap<string, CanvasTile>, srcIn: ReadonlyMap<string, readonly string[]>,
  wrkIn: ReadonlyMap<string, readonly string[]>,
  sources: ReadonlyMap<string, CanvasTables['sources'][number]>, workers: ReadonlyMap<string, CanvasTables['workers'][number]>,
  path: ReadonlySet<string> = new Set(),
): { source: string; candidates: Prepared[] }[] {
  const prep = workers.get(tiles.get(u)?.kind ?? '')?.prepares
  // `path` only guards a draft whose lines form a loop: an accepted map has none.
  if (!prep || path.has(u)) return []
  const out: { source: string; candidates: Prepared[] }[] = []
  for (const s of srcIn.get(u) ?? []) {
    const p = prep[sources.get(s)!.effort]
    if (p !== undefined) out.push({ source: s, candidates: [{ effort: p.as, load: p.load ?? 1 }] })
  }
  const next = new Set(path).add(u)
  for (const v of wrkIn.get(u) ?? []) {
    for (const got of preparedBy(v, tiles, srcIn, wrkIn, sources, workers, next)) {
      const p = prep[got.candidates[got.candidates.length - 1]!.effort] ?? prep[sources.get(got.source)!.effort]
      out.push({ source: got.source, candidates: p === undefined ? got.candidates : [...got.candidates, { effort: p.as, load: p.load ?? 1 }] })
    }
  }
  return out
}

/**
 * The candidate a reader takes of a source behind a row of tools: the kind it fetches best,
 * among equals the lighter one, among equals the first of the row. `fetch` are the reader's own
 * numbers by kind of effort.
 */
export function pickPrepared(candidates: readonly Prepared[], fetch: Readonly<Record<string, number>>): Prepared {
  let best = candidates[0]!
  for (const c of candidates.slice(1)) {
    const x = fetch[c.effort] ?? 0, y = fetch[best.effort] ?? 0
    if (x > y + 1e-12 || (Math.abs(x - y) <= 1e-12 && c.load < best.load - 1e-12)) best = c
  }
  return best
}

/**
 * How much the model of tile `n` reads for one case, in reading units, or null when the pack
 * prices a model by a fixed number of calls (no `reading` block). A source on a direct line
 * counts with the size of its effort. A source behind a tool counts with the size of the kind
 * the reader takes of it (`pickPrepared`, by the reader's own numbers `fetch`). Whatever else is
 * handed on (the summary of an agent, the note of a person, the number of a narrow model) counts
 * `reading.handoff`.
 */
export function readingUnits(
  n: string, t: CanvasTables, tiles: ReadonlyMap<string, CanvasTile>, srcIn: ReadonlyMap<string, readonly string[]>,
  wrkIn: ReadonlyMap<string, readonly string[]>,
  sources: ReadonlyMap<string, CanvasTables['sources'][number]>, workers: ReadonlyMap<string, CanvasTables['workers'][number]>,
  fetch: Readonly<Record<string, number>>,
): number | null {
  if (!t.reading) return null
  const size = new Map((t.efforts ?? []).map((e) => [e.id, e.size ?? 0]))
  let units = 0
  for (const s of srcIn.get(n) ?? []) units += size.get(sources.get(s)!.effort) ?? 0
  for (const u of wrkIn.get(n) ?? []) {
    const got = preparedBy(u, tiles, srcIn, wrkIn, sources, workers)
    if (got.length) for (const p of got) units += size.get(pickPrepared(p.candidates, fetch).effort) ?? 0
    else units += t.reading.handoff
  }
  return units
}

/** Minutes per case that a map asks of each pool of people. Every placed person counts. */
export function peopleMinutes(m: CanvasMap, t: CanvasTables): Record<string, number> {
  const sources = new Map(t.sources.map((s) => [s.id, s]))
  const workers = new Map(t.workers.map((w) => [w.id, w]))
  const tiles = new Map(m.tiles.map((x) => [x.id, x]))
  const srcIn = new Map<string, string[]>([...tiles.keys()].map((id) => [id, []]))
  const wrkIn = new Map<string, string[]>([...tiles.keys()].map((id) => [id, []]))
  for (const ln of m.lines) {
    if (ln.to === t.result.id) continue
    if (sources.has(ln.from)) srcIn.get(ln.to)!.push(ln.from)
    else wrkIn.get(ln.to)!.push(ln.from)
  }
  const out: Record<string, number> = {}
  for (const n of [...tiles.keys()].sort(byCell(tiles))) {
    const w = workers.get(tiles.get(n)!.kind)!
    const mn = w.minutes
    if (!mn) continue
    let used = wrkIn.get(n)!.length ? mn.check : mn.decide
    for (const s of srcIn.get(n)!) used += mn.per_line[sources.get(s)!.effort] ?? 0
    // What a tile that prepares hands a person is still hers to read.
    for (const u of wrkIn.get(n)!) for (const p of preparedBy(u, tiles, srcIn, wrkIn, sources, workers)) used += mn.per_line[pickPrepared(p.candidates, w.quality?.fetch ?? {}).effort] ?? 0
    const pool = w.pool!
    out[pool] = (out[pool] ?? 0) + used
  }
  return out
}

export type ReadyReason =
  | 'nothing_reaches_result' | 'no_source_connected' | 'tile_incomplete'
  | `required_missing:${number}` | `too_many_minutes:${string}`

/**
 * One reason a map cannot be validated, with what it names: the tile and its missing parts, the
 * entry of `required` with its text, or the pool with its minutes. `readyReasons` is the list of
 * their codes, each once.
 */
export type ReadyDetail =
  | { reason: 'nothing_reaches_result' }
  | { reason: 'no_source_connected' }
  | { reason: 'tile_incomplete'; tile: string; missing: ('model' | 'runsOn')[] }
  | { reason: 'required_missing'; index: number; workers: string[]; text: string }
  | { reason: 'too_many_minutes'; pool: string; used: number; max: number; tiles: string[] }

/**
 * Why an accepted map cannot be validated yet (section 6.6), in the order of `readyReasons`, with
 * every incomplete live tile in the order of the map. Empty when it can.
 */
export function readyDetails(m: CanvasMap, t: CanvasTables): ReadyDetail[] {
  const sh = mapShape(m, t)
  if (sh.signer === null) return [{ reason: 'nothing_reaches_result' }]
  const workers = new Map(t.workers.map((w) => [w.id, w]))
  const out: ReadyDetail[] = []
  if (![...sh.live].some((n) => sh.srcIn.get(n)!.length > 0)) out.push({ reason: 'no_source_connected' })
  for (const n of sh.order) {
    const tile = sh.tiles.get(n)!
    if (!workers.get(tile.kind)!.needs_model) continue
    const missing: ('model' | 'runsOn')[] = []
    if (tile.model === null) missing.push('model')
    if (tile.runsOn === null) missing.push('runsOn')
    if (missing.length) out.push({ reason: 'tile_incomplete', tile: n, missing })
  }
  ;(t.required ?? []).forEach((r, index) => {
    if (![...sh.live].some((n) => r.workers.includes(sh.tiles.get(n)!.kind))) {
      out.push({ reason: 'required_missing', index, workers: [...r.workers], text: r.text })
    }
  })
  for (const o of overPools(m, t)) if (!o.rush) out.push({ reason: 'too_many_minutes', pool: o.pool, used: o.used, max: o.max, tiles: o.tiles })
  return out
}

/** A pool of people that a map asks more minutes of than it has, with its person tiles by cell. */
export type OverPool = { pool: string; used: number; max: number; tiles: string[]; rush: boolean }

/**
 * The pools a map asks too much of, in the order of the pack. With `over: rush` the map can still
 * be validated and the people of the pool rush (`rush` is true); otherwise it cannot.
 */
export function overPools(m: CanvasMap, t: CanvasTables): OverPool[] {
  const used = peopleMinutes(m, t)
  const workers = new Map(t.workers.map((w) => [w.id, w]))
  const out: OverPool[] = []
  for (const pool of t.pools ?? []) {
    if ((used[pool.id] ?? 0) > pool.max + 1e-9) {
      const tiles = m.tiles.filter((x) => workers.get(x.kind)?.pool === pool.id).sort((a, b) => a.col - b.col || a.row - b.row).map((x) => x.id)
      out.push({ pool: pool.id, used: used[pool.id]!, max: pool.max, tiles, rush: pool.over === 'rush' })
    }
  }
  return out
}

/**
 * For every pool with `over: rush` that the map asks more minutes of than it has: the share of
 * the asked minutes that the pool gives, `max / used`, below 1. Its people get through that share
 * of the cases. Other pools are not listed.
 */
export function rushFactors(m: CanvasMap, t: CanvasTables): Record<string, number> {
  const out: Record<string, number> = {}
  for (const o of overPools(m, t)) if (o.rush) out[o.pool] = o.max / o.used
  return out
}

/** Why an accepted map cannot be validated yet (section 6.6). Empty when it can. */
export function readyReasons(m: CanvasMap, t: CanvasTables): ReadyReason[] {
  const out: ReadyReason[] = []
  for (const d of readyDetails(m, t)) {
    const code: ReadyReason = d.reason === 'required_missing' ? `required_missing:${d.index}` : d.reason === 'too_many_minutes' ? `too_many_minutes:${d.pool}` : d.reason
    if (!out.includes(code)) out.push(code)
  }
  return out
}

/** The minutes a case each person tile asks in this map: the parts that `peopleMinutes` adds up. */
export function tileMinutes(m: CanvasMap, t: CanvasTables): Record<string, number> {
  const sources = new Map(t.sources.map((s) => [s.id, s]))
  const workers = new Map(t.workers.map((w) => [w.id, w]))
  const tiles = new Map(m.tiles.map((x) => [x.id, x]))
  const srcIn = new Map<string, string[]>([...tiles.keys()].map((id) => [id, []]))
  const wrkIn = new Map<string, string[]>([...tiles.keys()].map((id) => [id, []]))
  for (const l of m.lines) {
    if (!tiles.has(l.to)) continue
    if (sources.has(l.from)) srcIn.get(l.to)!.push(l.from)
    else if (tiles.has(l.from)) wrkIn.get(l.to)!.push(l.from)
  }
  const out: Record<string, number> = {}
  for (const tile of m.tiles) {
    const mn = workers.get(tile.kind)?.minutes
    if (!mn) continue
    const into = m.lines.filter((l) => l.to === tile.id)
    let used = into.some((l) => tiles.has(l.from)) ? mn.check : mn.decide
    for (const l of into) {
      const s = sources.get(l.from)
      if (s) used += mn.per_line[s.effort] ?? 0
      else if (tiles.has(l.from)) for (const p of preparedBy(l.from, tiles, srcIn, wrkIn, sources, workers)) used += mn.per_line[pickPrepared(p.candidates, workers.get(tile.kind)?.quality?.fetch ?? {}).effort] ?? 0
    }
    out[tile.id] = used
  }
  return out
}
