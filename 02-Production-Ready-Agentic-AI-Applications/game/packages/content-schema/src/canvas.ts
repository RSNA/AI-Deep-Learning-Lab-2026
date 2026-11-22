// The rules of a map on the canvas (engineering spec, sections 6.6 and 5.5): what `set_map`
// refuses, when a map is ready to validate, and the minutes it asks of the people. The loader
// uses them to check the reference map of a pack, the engine to judge every map a player sends.
// The executable reference is `tools/canvas_scoring.py` of the private folder; the parity
// vectors check these functions and the scoring of `engine/src/canvas.ts` against it.

export type CanvasTile = {
  id: string; kind: string; col: number; row: number
  model: string | null; runsOn: string | null; prompt: string | null
}
export type CanvasLine = { from: string; to: string }
export type CanvasMap = { tiles: CanvasTile[]; lines: CanvasLine[] }

type Quality = { fetch: Readonly<Record<string, number>>; decide: { plain: number; hard: number }; catch?: number }

/**
 * Everything of a build file that the rules and the scoring read. A `BuildFile` is one, and so is
 * the toy pack of the parity vectors. Phase 3 will pass tables that its events have changed.
 */
export type CanvasTables = {
  grid: { cols: number; rows: number }
  pools?: readonly { id: string; max: number }[]
  handoff?: { keep: number }
  quality_cap?: number
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
  }[]
  models?: readonly { id: string; run?: number; runs_on: readonly string[] }[]
  compute?: readonly { id: string; protects_private_data?: boolean; price_factor?: number; run_fixed?: number }[]
  prompts?: readonly { id: string; fetch?: number; decide?: number; by_worker?: Readonly<Record<string, { fetch?: number; decide?: number }>> }[]
  actions?: readonly { id: string; unlocks?: readonly string[] }[]
  cases: readonly { id: string; weight: number; needs: readonly string[]; difficulty: 'plain' | 'hard' }[]
  notes?: readonly { id: string }[]
}

export const TILE_ID = /^t[0-9a-z]{1,8}$/
export const MAX_LINES = 80

export type MapError =
  | 'bad_tile_id' | 'bad_kind' | 'off_grid' | 'cell_taken' | 'no_parts_here' | 'bad_model' | 'bad_compute'
  | 'bad_prompt' | 'model_cannot_run_there' | 'too_many_lines' | 'line_twice' | 'bad_line_end'
  | 'source_locked' | 'source_to_result' | 'line_backward' | 'result_takes_one_line'

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

/** The first prompt of the pack is the default: a tile whose prompt is null carries it. */
export function defaultPrompt(t: CanvasTables): string | null {
  return t.prompts?.[0]?.id ?? null
}

/** A map of a pack file (`runs_on`) in the form of the engine (`runsOn`). */
export function fromPackMap(m: { tiles: readonly { id: string; kind: string; col: number; row: number; model?: string | null; runs_on?: string | null; prompt?: string | null }[]; lines: readonly { from: string; to: string }[] }): CanvasMap {
  return {
    tiles: m.tiles.map((t) => ({ id: t.id, kind: t.kind, col: t.col, row: t.row, model: t.model ?? null, runsOn: t.runs_on ?? null, prompt: t.prompt ?? null })),
    lines: m.lines.map((l) => ({ from: l.from, to: l.to })),
  }
}

const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x)

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
  let intoResult = 0
  if (m.lines.length > MAX_LINES) errs.add('too_many_lines')
  for (const ln of m.lines) {
    const a = ln.from, b = ln.to
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
    if (!fromSource) {
      const ca = tiles.get(a)!.col, cb = tiles.get(b)!.col
      if (typeof ca === 'number' && typeof cb === 'number' && !(ca < cb)) errs.add('line_backward')
    }
  }
  if (intoResult > 1) errs.add('result_takes_one_line')
  return [...errs].sort()
}

/** The shape of an accepted map: who reads where, who hands to whom, the signer, the live tiles. */
export type MapShape = {
  tiles: Map<string, CanvasTile>
  srcIn: Map<string, string[]>          // sources with a line into the tile
  wrkIn: Map<string, string[]>          // tiles with a line into the tile
  signer: string | null
  live: Set<string>
  order: string[]                       // live tiles by column, then row
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
  const order = [...live].sort(byCell(tiles))
  return { tiles, srcIn, wrkIn, signer, live, order }
}

/** Minutes per case that a map asks of each pool of people. Every placed person counts. */
export function peopleMinutes(m: CanvasMap, t: CanvasTables): Record<string, number> {
  const sources = new Map(t.sources.map((s) => [s.id, s]))
  const workers = new Map(t.workers.map((w) => [w.id, w]))
  const tiles = new Map(m.tiles.map((x) => [x.id, x]))
  const srcIn = new Map<string, string[]>([...tiles.keys()].map((id) => [id, []]))
  const hasWorkerIn = new Set<string>()
  for (const ln of m.lines) {
    if (ln.to === t.result.id) continue
    if (sources.has(ln.from)) srcIn.get(ln.to)!.push(ln.from)
    else hasWorkerIn.add(ln.to)
  }
  const out: Record<string, number> = {}
  for (const n of [...tiles.keys()].sort(byCell(tiles))) {
    const w = workers.get(tiles.get(n)!.kind)!
    const mn = w.minutes
    if (!mn) continue
    let used = hasWorkerIn.has(n) ? mn.check : mn.decide
    for (const s of srcIn.get(n)!) used += mn.per_line[sources.get(s)!.effort] ?? 0
    const pool = w.pool!
    out[pool] = (out[pool] ?? 0) + used
  }
  return out
}

export type ReadyReason = 'nothing_reaches_result' | 'no_source_connected' | 'tile_incomplete' | `too_many_minutes:${string}`

/** Why an accepted map cannot be validated yet (section 6.6). Empty when it can. */
export function readyReasons(m: CanvasMap, t: CanvasTables): ReadyReason[] {
  const sh = mapShape(m, t)
  if (sh.signer === null) return ['nothing_reaches_result']
  const workers = new Map(t.workers.map((w) => [w.id, w]))
  const out: ReadyReason[] = []
  if (![...sh.live].some((n) => sh.srcIn.get(n)!.length > 0)) out.push('no_source_connected')
  for (const n of sh.order) {
    const tile = sh.tiles.get(n)!
    if (workers.get(tile.kind)!.needs_model && (tile.model === null || tile.runsOn === null)) { out.push('tile_incomplete'); break }
  }
  const used = peopleMinutes(m, t)
  for (const pool of t.pools ?? []) if ((used[pool.id] ?? 0) > pool.max + 1e-9) out.push(`too_many_minutes:${pool.id}`)
  return out
}
