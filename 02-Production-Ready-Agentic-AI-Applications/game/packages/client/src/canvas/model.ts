// The map in the browser (engineering spec, section 10.5): edits that keep it valid, and the
// checks the browser can make before it sends a map, so that it never sends one it knows to be
// invalid. The server judges every map again. These components do not know which phase shows
// them: they take the vocabulary and the state as inputs (section 6.6, what goes into Phase 3).
import type { CanvasLegend, CanvasLine, CanvasMap, CanvasTile } from '@lab02/protocol'

/** What a canvas can show and edit: the legend, plus what the browser needs to judge an edit. */
export type Vocabulary = Omit<CanvasLegend, 'workers' | 'models'> & {
  workers: (CanvasLegend['workers'][number] & { needsModel: boolean; models: string[] })[]
  models: (CanvasLegend['models'][number] & { runsOn: string[] })[]
}

export const MAX_LINES = 80
const TILE_ID = /^t[0-9a-z]{1,8}$/

export const isSource = (v: CanvasLegend, id: string) => v.sources.some((s) => s.id === id)
export const tileOf = (m: CanvasMap, id: string) => m.tiles.find((t) => t.id === id)
export const tileAt = (m: CanvasMap, col: number, row: number) => m.tiles.find((t) => t.col === col && t.row === row)

/**
 * The name of every tile: its worker's short name and label, with a number when the map holds
 * two or more tiles of that kind ("Agent 2"). Numbers follow the order in which the tiles were
 * placed, so a tile keeps its number when it moves.
 */
export function tileNames(m: CanvasMap, v: Pick<CanvasLegend, 'workers'>): Map<string, { short: string; label: string }> {
  const order = [...m.tiles].sort((a, b) => parseInt(a.id.slice(1), 36) - parseInt(b.id.slice(1), 36) || a.id.localeCompare(b.id))
  const count = new Map<string, number>()
  for (const t of order) count.set(t.kind, (count.get(t.kind) ?? 0) + 1)
  const seen = new Map<string, number>()
  const out = new Map<string, { short: string; label: string }>()
  for (const t of order) {
    const w = v.workers.find((x) => x.id === t.kind)
    const n = (seen.get(t.kind) ?? 0) + 1
    seen.set(t.kind, n)
    const suffix = (count.get(t.kind) ?? 0) > 1 ? ` ${n}` : ''
    out.set(t.id, { short: `${w?.short ?? t.kind}${suffix}`, label: `${w?.label ?? t.kind}${suffix}` })
  }
  return out
}

/** The smallest free tile id: t1, t2, ... */
export function newTileId(m: CanvasMap): string {
  for (let i = 1; ; i++) {
    const id = `t${i.toString(36)}`
    if (!m.tiles.some((t) => t.id === id)) return id
  }
}

/** Whether a map breaks a rule the browser can see. The server checks again, with every rule. */
export function mapProblem(m: CanvasMap, v: Vocabulary, unlocked: ReadonlySet<string>): string | null {
  const cells = new Set<string>()
  const ids = new Set<string>()
  for (const t of m.tiles) {
    if (!TILE_ID.test(t.id) || ids.has(t.id)) return 'tile id'
    ids.add(t.id)
    const w = v.workers.find((x) => x.id === t.kind)
    if (!w || !unlocked.has(w.id)) return 'kind'
    if (t.col < 1 || t.col > v.cols || t.row < 1 || t.row > v.rows) return 'off grid'
    const cell = `${t.col},${t.row}`
    if (cells.has(cell)) return 'cell'
    cells.add(cell)
    if (!w.needsModel) { if (t.model || t.runsOn || t.prompt) return 'parts'; continue }
    if (t.model && (!unlocked.has(t.model) || !w.models.includes(t.model))) return 'model'
    if (t.runsOn && !unlocked.has(t.runsOn)) return 'compute'
    if (t.prompt && !unlocked.has(t.prompt)) return 'prompt'
    if (t.model && t.runsOn && !v.models.find((x) => x.id === t.model)?.runsOn.includes(t.runsOn)) return 'runs on'
  }
  if (m.lines.length > MAX_LINES) return 'lines'
  const seen = new Set<string>()
  let intoResult = 0
  for (const l of m.lines) {
    const k = `${l.from}>${l.to}`
    if (seen.has(k)) return 'twice'
    seen.add(k)
    const src = isSource(v, l.from)
    if (src && !unlocked.has(l.from)) return 'locked source'
    const a = src ? null : tileOf(m, l.from)
    if (!src && !a) return 'end'
    if (l.to === v.result.id) { if (src) return 'source to result'; intoResult++; continue }
    const b = tileOf(m, l.to)
    if (!b) return 'end'
  }
  if (intoResult > 1) return 'result'
  return hasLoop(m) ? 'loop' : null
}

/**
 * Whether the tile `from` can be reached from the tile `to` along the lines between tiles: a
 * line from `from` to `to` would then close a loop. A tile reaches itself.
 */
export function reaches(m: CanvasMap, to: string, from: string): boolean {
  const tiles = new Set(m.tiles.map((t) => t.id))
  const seen = new Set<string>()
  const stack = [to]
  while (stack.length) {
    const n = stack.pop()!
    if (n === from) return true
    if (seen.has(n)) continue
    seen.add(n)
    for (const l of m.lines) if (l.from === n && tiles.has(l.to)) stack.push(l.to)
  }
  return false
}

/** Whether the lines between tiles form a loop. A line may run in any direction, a loop never. */
export function hasLoop(m: CanvasMap): boolean {
  const tiles = new Set(m.tiles.map((t) => t.id))
  return m.lines.some((l) => tiles.has(l.from) && tiles.has(l.to) && reaches(m, l.to, l.from))
}

// ------------------------------------------------------------------------------------------
// Edits. Each returns a new map, or the same map when nothing changes.
// ------------------------------------------------------------------------------------------
export function placeTile(m: CanvasMap, kind: string, col: number, row: number): { map: CanvasMap; id: string } {
  const id = newTileId(m)
  const tile: CanvasTile = { id, kind, col, row, model: null, runsOn: null, prompt: null }
  return { map: { tiles: [...m.tiles, tile], lines: m.lines }, id }
}

/** Move a tile to an empty cell. Its lines go with it: a line may run in any direction. */
export function moveTile(m: CanvasMap, id: string, col: number, row: number): CanvasMap {
  return { tiles: m.tiles.map((t) => (t.id === id ? { ...t, col, row } : t)), lines: m.lines }
}

/** A removed tile takes its lines with it. */
export function removeTile(m: CanvasMap, id: string): CanvasMap {
  return { tiles: m.tiles.filter((t) => t.id !== id), lines: m.lines.filter((l) => l.from !== id && l.to !== id) }
}

export const lineKey = (l: CanvasLine) => `${l.from}>${l.to}`

/** Add a line. A second line into the result replaces the first. */
export function addLine(m: CanvasMap, from: string, to: string, resultId: string): CanvasMap {
  if (m.lines.some((l) => l.from === from && l.to === to)) return m
  const keep = to === resultId ? m.lines.filter((l) => l.to !== resultId) : m.lines
  return { tiles: m.tiles, lines: [...keep, { from, to }] }
}

export function removeLine(m: CanvasMap, key: string): CanvasMap {
  return { tiles: m.tiles, lines: m.lines.filter((l) => lineKey(l) !== key) }
}

/** Set a part of an AI tile. A change of model clears a place to run that no longer fits. */
export function setPart(m: CanvasMap, v: Vocabulary, id: string, part: 'model' | 'runsOn' | 'prompt', value: string | null): CanvasMap {
  return {
    lines: m.lines,
    tiles: m.tiles.map((t) => {
      if (t.id !== id) return t
      const next = { ...t, [part]: value }
      if (part === 'model' && next.runsOn && value && !v.models.find((x) => x.id === value)?.runsOn.includes(next.runsOn)) next.runsOn = null
      return next
    }),
  }
}

/**
 * Where a line from this node may go: from a source any tile, from a tile any other tile that
 * does not already hand its work back to it (that would close a loop), and the result.
 */
export function targetsOf(m: CanvasMap, v: Vocabulary, from: string): Set<string> {
  const out = new Set<string>()
  const a = tileOf(m, from)
  if (!a && !isSource(v, from)) return out
  for (const t of m.tiles) {
    if (t.id === from || m.lines.some((l) => l.from === from && l.to === t.id)) continue
    if (a && reaches(m, t.id, from)) continue
    out.add(t.id)
  }
  if (a) out.add(v.result.id)
  return out
}

export function sameMap(a: CanvasMap, b: CanvasMap): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Whether two maps are the same map: the same tiles and lines, whatever order they are listed in. */
export function sameLayout(a: CanvasMap, b: CanvasMap): boolean {
  if (a.tiles.length !== b.tiles.length || a.lines.length !== b.lines.length) return false
  const tile = (t: CanvasTile) => `${t.id}|${t.kind}|${t.col}|${t.row}|${t.model ?? ''}|${t.runsOn ?? ''}|${t.prompt ?? ''}`
  const ta = a.tiles.map(tile).sort(), tb = b.tiles.map(tile).sort()
  const la = a.lines.map(lineKey).sort(), lb = b.lines.map(lineKey).sort()
  return ta.every((x, i) => x === tb[i]) && la.every((x, i) => x === lb[i])
}
