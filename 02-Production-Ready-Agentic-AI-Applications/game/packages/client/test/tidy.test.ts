// "Tidy map" (engineering spec, section 10.5): it moves tiles and sources and changes nothing
// that a score reads, it never fails, and a map that was tidied is tidy.
import { describe, expect, it } from 'vitest'
import type { CanvasMap } from '@lab02/protocol'
import { hasLoop, lineKey, moveSource, orderedSources, sameLayout, withSourceOrder } from '../src/canvas/model.ts'
import { tidyMap, type TidyBoard } from '../src/canvas/tidy.ts'

const board = (cols: number, rows: number, sources = 6): TidyBoard => ({ cols, rows, sources: Array.from({ length: sources }, (_, i) => ({ id: `s${i + 1}` })), result: { id: 'res' } })
const T = (id: string, col: number, row: number, ai = false) => ({ id, kind: ai ? 'agent' : 'tool', col, row, model: ai ? 'm1' : null, runsOn: ai ? 'c1' : null, prompt: ai ? 'p1' : null })
const L = (from: string, to: string) => ({ from, to })

/** What a score reads of a map: every tile with its kind and its parts, and every line by its two ends. */
const scored = (m: CanvasMap) => ({
  tiles: m.tiles.map((t) => `${t.id}|${t.kind}|${t.model}|${t.runsOn}|${t.prompt}`).sort(),
  lines: m.lines.map(lineKey).sort(),
})
const valid = (m: CanvasMap, b: TidyBoard) => {
  const cells = new Set(m.tiles.map((t) => `${t.col},${t.row}`))
  expect(cells.size).toBe(m.tiles.length)
  for (const t of m.tiles) {
    expect(t.col).toBeGreaterThanOrEqual(1); expect(t.col).toBeLessThanOrEqual(b.cols)
    expect(t.row).toBeGreaterThanOrEqual(1); expect(t.row).toBeLessThanOrEqual(b.rows)
  }
  if (m.sourceOrder) expect([...m.sourceOrder].sort()).toEqual(b.sources.map((s) => s.id).sort())
}
const backward = (m: CanvasMap) => m.lines.filter((l) => {
  const a = m.tiles.find((t) => t.id === l.from), z = m.tiles.find((t) => t.id === l.to)
  return a && z && z.col < a.col
}).length

// A crowded map, laid out badly on purpose: tools in the wrong columns, lines that run back.
const crowded: CanvasMap = {
  tiles: [T('t1', 5, 5, true), T('t2', 3, 1), T('t3', 6, 2), T('t4', 1, 6), T('t5', 2, 2, true), T('t6', 4, 6), T('t7', 1, 1, true), T('t8', 2, 5, true), T('t9', 6, 6), T('ta', 4, 1), T('tb', 5, 1)],
  lines: [
    L('s1', 't3'), L('s2', 't3'), L('s3', 't2'), L('s5', 't4'), L('s6', 't6'), L('s4', 't5'),
    L('t2', 'tb'), L('tb', 't7'), L('t3', 't7'), L('t4', 't1'), L('t5', 't1'), L('t7', 't8'), L('t1', 't8'), L('t8', 't9'), L('t6', 't9'), L('t9', 'ta'), L('ta', 'res'),
  ],
}

describe('Tidy map', () => {
  it('moves tiles and sources and changes nothing that a score reads', () => {
    const b = board(6, 6)
    const out = tidyMap(crowded, b)
    expect(out).not.toBe(crowded)
    expect(scored(out)).toEqual(scored(crowded))
    expect(sameLayout(out, crowded)).toBe(true)
    expect(out.tiles.map((t) => t.id)).toEqual(crowded.tiles.map((t) => t.id))
    valid(out, b)
    expect(hasLoop(out)).toBe(false)
  })
  it('reads from left to right: no line runs back to an earlier column', () => {
    expect(backward(crowded)).toBeGreaterThan(0)
    expect(backward(tidyMap(crowded, board(6, 6)))).toBe(0)
  })
  it('finds nothing to do on a map it tidied, and on an empty map', () => {
    const b = board(6, 6)
    const once = tidyMap(crowded, b)
    expect(tidyMap(once, b)).toBe(once)
    const empty: CanvasMap = { tiles: [], lines: [] }
    expect(tidyMap(empty, b)).toBe(empty)
  })
  it('puts a line back on the sides that face each other, also on a map whose tiles stand well', () => {
    const b = board(6, 6)
    const once = tidyMap(crowded, b)
    const picked: CanvasMap = { ...once, lines: once.lines.map((l, i) => (i === 7 ? { ...l, fromSide: 'top' as const, toSide: 'bottom' as const } : l)) }
    const out = tidyMap(picked, b)
    expect(out.lines.every((l) => !l.fromSide && !l.toSide)).toBe(true)
    expect(out.tiles).toEqual(once.tiles)
    expect(scored(out)).toEqual(scored(picked))
  })
  it('puts a source level with the tile that reads it', () => {
    const b = board(4, 4, 4)
    // One tile per source, each on the row furthest from its source.
    const m: CanvasMap = { tiles: [T('t1', 1, 4), T('t2', 1, 3), T('t3', 1, 2), T('t4', 1, 1), T('t5', 2, 1, true)], lines: [L('s1', 't1'), L('s2', 't2'), L('s3', 't3'), L('s4', 't4'), L('t1', 't5'), L('t2', 't5'), L('t3', 't5'), L('t4', 't5'), L('t5', 'res')] }
    const out = tidyMap(m, b)
    const order = orderedSources(b.sources, out.sourceOrder).map((s) => s.id)
    for (const l of out.lines.filter((x) => x.from.startsWith('s'))) expect(order.indexOf(l.from) + 1).toBe(out.tiles.find((t) => t.id === l.to)!.row)
  })
  it('never fails: a chain longer than the grid is wide, a full grid, tiles with no lines, a loop', () => {
    const b = board(3, 3, 2)
    const chain: CanvasMap = { tiles: Array.from({ length: 7 }, (_, i) => T(`t${i + 1}`, (i % 3) + 1, Math.floor(i / 3) + 1)), lines: [L('s1', 't1'), ...Array.from({ length: 6 }, (_, i) => L(`t${i + 1}`, `t${i + 2}`)), L('t7', 'res')] }
    const out = tidyMap(chain, b)
    valid(out, b)
    expect(scored(out)).toEqual(scored(chain))
    const full: CanvasMap = { tiles: Array.from({ length: 9 }, (_, i) => T(`t${i + 1}`, (i % 3) + 1, Math.floor(i / 3) + 1)), lines: [L('t1', 't9'), L('t9', 't5'), L('t5', 'res')] }
    const outFull = tidyMap(full, b)
    valid(outFull, b)
    expect(scored(outFull)).toEqual(scored(full))
    const loose: CanvasMap = { tiles: [T('t1', 3, 3), T('t2', 2, 2)], lines: [] }
    valid(tidyMap(loose, b), b)
    const loop: CanvasMap = { tiles: [T('t1', 1, 1), T('t2', 2, 1)], lines: [L('t1', 't2'), L('t2', 't1')] }
    expect(tidyMap(loop, b)).toBe(loop)
    const stacked: CanvasMap = { tiles: [T('t1', 1, 1), T('t2', 1, 1)], lines: [] }
    expect(tidyMap(stacked, b)).toBe(stacked)
  })
  it('gives the same layout wherever the tiles stood before', () => {
    const b = board(6, 6)
    const moved: CanvasMap = { tiles: crowded.tiles.map((t, i) => ({ ...t, col: (i % 6) + 1, row: 6 - Math.floor(i / 6) })), lines: crowded.lines }
    const x = tidyMap(crowded, b), y = tidyMap(moved, b)
    expect(y.tiles).toEqual(x.tiles)
    expect(y.sourceOrder).toEqual(x.sourceOrder)
  })
  it('is quick enough to run on every change of a crowded map', () => {
    const b = board(6, 6, 8)
    const t0 = performance.now()
    for (let i = 0; i < 5; i++) tidyMap(crowded, b)
    expect((performance.now() - t0) / 5).toBeLessThan(250)
  })
})

describe('the order of the sources', () => {
  const sources = [{ id: 's1' }, { id: 's2' }, { id: 's3' }, { id: 's4' }]
  const m: CanvasMap = { tiles: [T('t1', 1, 1)], lines: [L('s1', 't1')] }
  it('is the order of the pack until the player changes it', () => {
    expect(orderedSources(sources, undefined).map((s) => s.id)).toEqual(['s1', 's2', 's3', 's4'])
    expect(orderedSources(sources, ['s3', 's1']).map((s) => s.id)).toEqual(['s3', 's1', 's2', 's4'])
    expect(orderedSources(sources, ['s9', 's2']).map((s) => s.id)).toEqual(['s2', 's1', 's3', 's4'])
  })
  it('moves one source and keeps the tiles and the lines', () => {
    const down = moveSource(m, sources, 's1', 2)
    expect(down.sourceOrder).toEqual(['s2', 's3', 's1', 's4'])
    expect(down.tiles).toBe(m.tiles)
    expect(down.lines).toBe(m.lines)
    expect(moveSource(down, sources, 's1', 2)).toBe(down)
    expect(moveSource(down, sources, 's4', -5).sourceOrder).toEqual(['s4', 's2', 's3', 's1'])
    expect(moveSource(m, sources, 'nope', 1)).toBe(m)
  })
  it('carries no order when the sources stand as the pack lists them', () => {
    const back = moveSource(moveSource(m, sources, 's1', 2), sources, 's1', 0)
    expect(back).not.toHaveProperty('sourceOrder')
    expect(withSourceOrder(m, sources, ['s1', 's2', 's3', 's4'])).not.toHaveProperty('sourceOrder')
  })
  it('does not make a map another system', () => {
    expect(sameLayout(m, moveSource(m, sources, 's1', 3))).toBe(true)
    expect(sameLayout(m, { ...m, tiles: [T('t1', 4, 4)] })).toBe(true)
    expect(sameLayout(m, { ...m, tiles: [T('t1', 1, 1, true)] })).toBe(false)
    expect(sameLayout(m, { ...m, lines: [L('s2', 't1')] })).toBe(false)
  })
})
