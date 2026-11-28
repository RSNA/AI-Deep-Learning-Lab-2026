// "Tidy map" (engineering spec, section 10.5): one press puts the tiles of a map in columns that
// read from left to right, picks their rows so that the lines are short, cross little and do not
// run behind other tiles, and puts every source level with what it feeds. It moves tiles and
// sources and nothing else: no tile, no part of a tile and no line is added, removed or changed,
// so no score can change. The sides that a player picked for a line were picked for the old
// places, so the lines go back to the sides that face each other.
//
// The layout depends on the tiles and the lines alone, never on where the tiles stand now, so a
// map that was tidied is tidy: a second press finds nothing to do.
import type { CanvasLine, CanvasMap, CanvasTile } from '@lab02/protocol'
import { orderedSources, withSourceOrder } from './model.ts'

export type TidyBoard = { cols: number; rows: number; sources: readonly { id: string }[]; result: { id: string } }

type Layout = { col: Map<string, number>; row: Map<string, number>; sources: string[] }
type Graph = {
  ids: string[]
  /** Lines between two tiles, as pairs of tile ids. */
  between: [string, string][]
  /** Lines from a source to a tile. */
  reads: [string, string][]
  /** The tile whose line ends in the result. */
  signer: string | null
  into: Map<string, string[]>
  out: Map<string, string[]>
  readBy: Map<string, string[]>
  readsOf: Map<string, string[]>
}

// Half the width and half the height of a tile, where the distance between two columns and
// between two rows is 1: the rest is the gap in which a line with its head is drawn.
const HALF_W = 0.41
const HALF_H = 0.43

const idNumber = (id: string) => parseInt(id.slice(1), 36)
const byId = (a: string, b: string) => idNumber(a) - idNumber(b) || (a < b ? -1 : a > b ? 1 : 0)

function graphOf(m: CanvasMap, b: TidyBoard): Graph {
  const ids = m.tiles.map((t) => t.id).sort(byId)
  const tiles = new Set(ids)
  const sources = new Set(b.sources.map((s) => s.id))
  const g: Graph = { ids, between: [], reads: [], signer: null, into: new Map(), out: new Map(), readBy: new Map(), readsOf: new Map() }
  for (const id of ids) { g.into.set(id, []); g.out.set(id, []); g.readsOf.set(id, []) }
  for (const s of sources) g.readBy.set(s, [])
  for (const l of m.lines) {
    if (tiles.has(l.from) && tiles.has(l.to)) { g.between.push([l.from, l.to]); g.out.get(l.from)!.push(l.to); g.into.get(l.to)!.push(l.from) }
    else if (sources.has(l.from) && tiles.has(l.to)) { g.reads.push([l.from, l.to]); g.readBy.get(l.from)!.push(l.to); g.readsOf.get(l.to)!.push(l.from) }
    else if (tiles.has(l.from) && l.to === b.result.id) g.signer = l.from
  }
  return g
}

/**
 * The layer of every tile: 1 for a tile that no tile hands work to, and for every other tile one
 * more than the latest tile that hands work to it. A tile that reads no source and gets no work
 * stands right before the first tile it hands to. Null when the lines form a loop.
 */
function layersOf(g: Graph): Map<string, number> | null {
  const layer = new Map<string, number>()
  const left = new Map(g.ids.map((id) => [id, g.into.get(id)!.length]))
  const queue = g.ids.filter((id) => left.get(id) === 0)
  for (const id of queue) layer.set(id, 1)
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]!
    for (const to of g.out.get(id)!) {
      layer.set(to, Math.max(layer.get(to) ?? 1, layer.get(id)! + 1))
      left.set(to, left.get(to)! - 1)
      if (left.get(to) === 0) queue.push(to)
    }
  }
  if (queue.length !== g.ids.length) return null
  for (const id of g.ids) {
    const next = g.out.get(id)!
    if (g.into.get(id)!.length || g.readsOf.get(id)!.length || !next.length) continue
    layer.set(id, Math.max(1, Math.min(...next.map((x) => layer.get(x)!)) - 1))
  }
  return layer
}

/** Rows for the tiles of one column, in this order from the top, as near as can be to where each wants to stand. */
function fitRows(wanted: number[], slots: number, at: (slot: number) => number): number[] {
  const n = wanted.length
  if (!n) return []
  // best[i][s]: the least cost of putting the first i + 1 tiles with tile i in slot s.
  const best: number[][] = [], from: number[][] = []
  for (let i = 0; i < n; i++) {
    best.push(new Array<number>(slots).fill(Infinity))
    from.push(new Array<number>(slots).fill(-1))
    let lowest = Infinity, lowestAt = -1
    for (let s = i; s <= slots - (n - i); s++) {
      if (i > 0 && s > 0 && best[i - 1]![s - 1]! < lowest) { lowest = best[i - 1]![s - 1]!; lowestAt = s - 1 }
      const before = i === 0 ? 0 : lowest
      if (before === Infinity) continue
      best[i]![s] = before + (at(s) - wanted[i]!) ** 2
      from[i]![s] = lowestAt
    }
  }
  let s = 0
  for (let x = 0; x < slots; x++) if (best[n - 1]![x]! < best[n - 1]![s]!) s = x
  const out = new Array<number>(n)
  for (let i = n - 1; i >= 0; i--) { out[i] = s; s = from[i]![s]! }
  return out
}

/** The points of a line as it is drawn, in the units of the layout: a curve between the sides that face each other. */
function pathOf(ax: number, ay: number, bx: number, by: number): [number, number][] {
  const pts: [number, number][] = []
  if (ax === bx) {
    // Two tiles of one column: out of the bottom of one and into the top of the other.
    const dir = by > ay ? 1 : -1
    const y0 = ay + dir * HALF_H, y1 = by - dir * HALF_H
    for (let i = 0; i <= 4; i++) pts.push([ax, y0 + ((y1 - y0) * i) / 4])
    return pts
  }
  const dir = bx > ax ? 1 : -1
  const x0 = ax + dir * HALF_W, x1 = bx - dir * HALF_W
  const reach = Math.max(0.08, Math.abs(x1 - x0) / 2)
  const c1 = x0 + dir * reach, c2 = x1 - dir * reach
  for (let i = 0; i <= 8; i++) {
    const t = i / 8, u = 1 - t
    pts.push([u * u * u * x0 + 3 * u * u * t * c1 + 3 * u * t * t * c2 + t * t * t * x1, u * u * u * ay + 3 * u * u * t * ay + 3 * u * t * t * by + t * t * t * by])
  }
  return pts
}

const crosses = (p: [number, number], q: [number, number], r: [number, number], s: [number, number]): boolean => {
  const d = (a: [number, number], b: [number, number], c: [number, number]) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
  const d1 = d(r, s, p), d2 = d(r, s, q), d3 = d(p, q, r), d4 = d(p, q, s)
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

/**
 * How untidy a layout is. In order of weight: a line that runs back to an earlier column, a line
 * that runs behind a tile it has nothing to do with, two lines that cross, two tiles of one
 * column that hand work to each other, and the length of the lines. A small pull to the left and
 * to the top settles a draw the same way every time.
 */
function costOf(g: Graph, b: TidyBoard, lay: Layout): number {
  const sy = new Map(lay.sources.map((id, i) => [id, ((i + 0.5) * b.rows) / lay.sources.length]))
  const x = (id: string) => lay.col.get(id)!, y = (id: string) => lay.row.get(id)! - 0.5
  type L = { a: string; b: string; pts: [number, number][] }
  const lines: L[] = []
  // Every second point of a line is enough to see whether two lines cross.
  const coarse = (pts: [number, number][]) => pts.filter((_, i) => i % 2 === 0)
  let cost = 0
  for (const [a, to] of g.between) {
    const dx = x(to) - x(a)
    if (dx < 0) cost += 1000 * (1 - dx)
    else if (dx === 0) cost += 30
    lines.push({ a, b: to, pts: pathOf(x(a), y(a), x(to), y(to)) })
    cost += Math.abs(y(to) - y(a)) + 0.6 * Math.max(0, Math.abs(dx) - 1)
  }
  for (const [s, to] of g.reads) {
    lines.push({ a: s, b: to, pts: pathOf(0, sy.get(s)!, x(to), y(to)) })
    cost += 0.8 * Math.abs(y(to) - sy.get(s)!) + 0.3 * (x(to) - 1)
  }
  if (g.signer) {
    lines.push({ a: g.signer, b: b.result.id, pts: pathOf(x(g.signer), y(g.signer), b.cols + 1, b.rows / 2) })
    cost += Math.abs(b.rows / 2 - y(g.signer)) + 0.6 * (b.cols - x(g.signer))
  }
  // A line behind a tile that is neither of its ends.
  for (const l of lines) {
    for (const id of g.ids) {
      if (id === l.a || id === l.b) continue
      const tx = x(id), ty = y(id)
      if (l.pts.some(([px, py]) => Math.abs(px - tx) < HALF_W && Math.abs(py - ty) < HALF_H)) cost += 100
    }
  }
  // Two lines that cross. Lines that share an end are spread along its side and do not cross there.
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const p = lines[i]!, q = lines[j]!
      if (p.a === q.a || p.b === q.b || p.a === q.b || p.b === q.a) continue
      const pa = p.pts[0]!, pb = p.pts.at(-1)!, qa = q.pts[0]!, qb = q.pts.at(-1)!
      // Two lines that share no stretch of the board from left to right, or from top to bottom, cannot cross.
      if (Math.max(pa[0], pb[0]) < Math.min(qa[0], qb[0]) || Math.max(qa[0], qb[0]) < Math.min(pa[0], pb[0])) continue
      if (Math.max(pa[1], pb[1]) < Math.min(qa[1], qb[1]) || Math.max(qa[1], qb[1]) < Math.min(pa[1], pb[1])) continue
      const pp = coarse(p.pts), qq = coarse(q.pts)
      let hit = false
      for (let u = 1; u < pp.length && !hit; u++) for (let w = 1; w < qq.length && !hit; w++) hit = crosses(pp[u - 1]!, pp[u]!, qq[w - 1]!, qq[w]!)
      if (hit) cost += 20
    }
  }
  for (const id of g.ids) cost += 0.01 * x(id) + 0.001 * lay.row.get(id)!
  return cost
}

/** The layout of a map as it stands, for the same measure. */
function layoutOf(m: CanvasMap, b: TidyBoard): Layout {
  return { col: new Map(m.tiles.map((t) => [t.id, t.col])), row: new Map(m.tiles.map((t) => [t.id, t.row])), sources: orderedSources(b.sources, m.sourceOrder).map((s) => s.id) }
}

function arrange(g: Graph, b: TidyBoard, layer: Map<string, number>): Layout {
  const { cols, rows } = b
  const deepest = Math.max(1, ...layer.values())
  // A map with more layers than the grid has columns: neighbouring layers share a column.
  const col = new Map(g.ids.map((id) => [id, deepest <= cols ? layer.get(id)! : 1 + Math.floor(((layer.get(id)! - 1) * cols) / deepest)]))
  // A column holds as many tiles as the grid has rows. What is too much moves on to the next
  // column, the tiles of the latest layer first, and from the last column back to the one before.
  const inCol = (c: number) => g.ids.filter((id) => col.get(id) === c)
  for (let c = 1; c < cols; c++) {
    const over = inCol(c).sort((p, q) => layer.get(q)! - layer.get(p)! || byId(q, p)).slice(0, Math.max(0, inCol(c).length - rows))
    for (const id of over) col.set(id, c + 1)
  }
  for (let c = cols; c > 1; c--) {
    const over = inCol(c).sort((p, q) => layer.get(p)! - layer.get(q)! || byId(p, q)).slice(0, Math.max(0, inCol(c).length - rows))
    for (const id of over) col.set(id, c - 1)
  }

  const lay: Layout = { col, row: new Map(), sources: b.sources.map((s) => s.id) }
  const sourceY = (id: string) => ((lay.sources.indexOf(id) + 0.5) * rows) / lay.sources.length
  const yOf = (id: string) => (lay.row.has(id) ? lay.row.get(id)! - 0.5 : null)
  /** Where a tile wants to stand: level with what it reads, what hands to it and what it hands to. */
  const wantedY = (id: string): number | null => {
    const ys: number[] = []
    for (const s of g.readsOf.get(id)!) ys.push(sourceY(s))
    for (const o of [...g.into.get(id)!, ...g.out.get(id)!]) { const v = yOf(o); if (v !== null) ys.push(v) }
    if (g.signer === id) ys.push(rows / 2)
    return ys.length ? ys.reduce((p, q) => p + q, 0) / ys.length : null
  }
  const placeColumn = (c: number) => {
    const mine = inCol(c)
    const want = new Map(mine.map((id) => [id, wantedY(id) ?? yOf(id) ?? rows / 2]))
    mine.sort((p, q) => want.get(p)! - want.get(q)! || (lay.row.get(p) ?? 0) - (lay.row.get(q) ?? 0) || byId(p, q))
    const fit = fitRows(mine.map((id) => want.get(id)!), rows, (s) => s + 0.5)
    mine.forEach((id, i) => lay.row.set(id, fit[i]! + 1))
  }
  const placeSources = () => {
    const all = b.sources.map((s) => s.id)
    const want = new Map<string, number>()
    for (const s of all) {
      const ys = g.readBy.get(s)!.map((t) => yOf(t)).filter((v): v is number => v !== null)
      if (ys.length) want.set(s, ys.reduce((p, q) => p + q, 0) / ys.length)
    }
    // The sources that are read take the places nearest to their tiles. The others fill what is left, in the order of the pack.
    const read = all.filter((s) => want.has(s)).sort((p, q) => want.get(p)! - want.get(q)! || all.indexOf(p) - all.indexOf(q))
    const fit = fitRows(read.map((s) => want.get(s)!), all.length, (s) => ((s + 0.5) * rows) / all.length)
    const next = new Array<string | null>(all.length).fill(null)
    read.forEach((s, i) => { next[fit[i]!] = s })
    const rest = all.filter((s) => !want.has(s))
    lay.sources = next.map((s) => s ?? rest.shift()!)
  }
  for (let c = 1; c <= cols; c++) placeColumn(c)
  for (let round = 0; round < 3; round++) {
    placeSources()
    for (let c = cols; c >= 1; c--) placeColumn(c)
    for (let c = 1; c <= cols; c++) placeColumn(c)
  }
  placeSources()
  return lay
}

/** Small changes, kept while they make the layout tidier: a tile to a free cell, two tiles of a column swapped, two sources swapped. */
function improve(g: Graph, b: TidyBoard, lay: Layout): Layout {
  let best = costOf(g, b, lay)
  const cellOf = () => new Map(g.ids.map((id) => [`${lay.col.get(id)},${lay.row.get(id)}`, id]))
  // The work is bounded: a large map stops after the first few rounds.
  const rounds = g.ids.length > 14 ? 3 : 8
  for (let round = 0; round < rounds; round++) {
    let better = false
    for (const id of g.ids) {
      const c0 = lay.col.get(id)!, r0 = lay.row.get(id)!
      let to: { c: number; r: number; swap: string | null } | null = null
      const taken = cellOf()
      for (let c = 1; c <= b.cols; c++) {
        for (let r = 1; r <= b.rows; r++) {
          if (c === c0 && r === r0) continue
          const other = taken.get(`${c},${r}`) ?? null
          if (other && c !== c0) continue
          lay.col.set(id, c); lay.row.set(id, r)
          if (other) lay.row.set(other, r0)
          const cost = costOf(g, b, lay)
          if (cost < best - 1e-9) { best = cost; to = { c, r, swap: other } }
          if (other) lay.row.set(other, r)
        }
      }
      lay.col.set(id, c0); lay.row.set(id, r0)
      if (to) {
        lay.col.set(id, to.c); lay.row.set(id, to.r)
        if (to.swap) lay.row.set(to.swap, r0)
        better = true
      }
    }
    for (let i = 0; i < lay.sources.length; i++) {
      for (let j = i + 1; j < lay.sources.length; j++) {
        const s = lay.sources
        ;[s[i], s[j]] = [s[j]!, s[i]!]
        const cost = costOf(g, b, lay)
        if (cost < best - 1e-9) { best = cost; better = true } else [s[i], s[j]] = [s[j]!, s[i]!]
      }
    }
    if (!better) break
  }
  return lay
}

/**
 * The map, tidied. The same object when the map is empty, when it is as tidy as this can make it,
 * or when it cannot be laid out at all (a map that breaks a rule), so a caller can tell by
 * identity that there is nothing to do.
 */
export function tidyMap(m: CanvasMap, b: TidyBoard): CanvasMap {
  if (!m.tiles.length) return m
  const cells = new Set(m.tiles.map((t) => `${t.col},${t.row}`))
  if (m.tiles.length > b.cols * b.rows || cells.size !== m.tiles.length) return m
  const g = graphOf(m, b)
  const layer = layersOf(g)
  if (!layer) return m
  const lay = improve(g, b, arrange(g, b, layer))
  const picked = m.lines.some((l) => l.fromSide || l.toSide)
  if (!picked && costOf(g, b, layoutOf(m, b)) <= costOf(g, b, lay) + 1e-9) return m
  const tiles: CanvasTile[] = m.tiles.map((t) => ({ ...t, col: lay.col.get(t.id)!, row: lay.row.get(t.id)! }))
  const lines: CanvasLine[] = m.lines.map((l) => ({ from: l.from, to: l.to }))
  const next = withSourceOrder({ tiles, lines }, b.sources, lay.sources)
  const same = !picked && tiles.every((t, i) => t.col === m.tiles[i]!.col && t.row === m.tiles[i]!.row)
    && JSON.stringify(next.sourceOrder ?? null) === JSON.stringify(m.sourceOrder ?? null)
  return same ? m : next
}
