// The side of a tile that a line leaves and the side it enters (engineering spec, section 6.6):
// the player picks them, they change how the line is drawn and never a score.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fromPackMap, mapErrors, type CanvasLine, type CanvasTables } from '@lab02/content-schema'
import { evaluate } from '../src/canvas.ts'

type Block = { name: string; build: CanvasTables; cases: { name: string; unlocked_set: string; map: Parameters<typeof fromPackMap>[0] }[] }
const file = JSON.parse(readFileSync(new URL('./vectors/canvas.json', import.meta.url), 'utf8')) as { more: Block[] }
const block = file.more.find((b) => b.name === 'knows')!
const packMap = block.cases.find((c) => c.name === 'prepared_for_the_agent')!.map

describe('the sides of a line', () => {
  it('are read from a pack map and never change a score', () => {
    const plain = fromPackMap(packMap)
    const picked = fromPackMap({ ...packMap, lines: packMap.lines.map((l, i) => (i === 1 ? { ...l, from_side: 'top' as const, to_side: 'bottom' as const } : l)) })
    expect(picked.lines[1]).toEqual({ ...plain.lines[1], fromSide: 'top', toSide: 'bottom' })
    expect(plain.lines[1]).not.toHaveProperty('fromSide')
    expect(mapErrors(picked, block.build)).toEqual([])
    const a = evaluate(plain, block.build), b = evaluate(picked, block.build)
    expect(b.accuracy).toBe(a.accuracy)
    expect(b.perCase).toEqual(a.perCase)
    expect(b.running).toEqual(a.running)
  })
  it('must be one of the four, on a tile or on the result: a source has one place for a line', () => {
    const m = fromPackMap(packMap)
    const withLine = (i: number, extra: Partial<CanvasLine>) => ({ tiles: m.tiles, lines: m.lines.map((l, k) => (k === i ? { ...l, ...extra } : l)) })
    const fromSource = m.lines.findIndex((l) => l.from.startsWith('s-'))
    const intoResult = m.lines.findIndex((l) => l.to === block.build.result.id)
    expect(mapErrors(withLine(1, { fromSide: 'middle' as never }), block.build)).toEqual(['bad_line_end'])
    expect(mapErrors(withLine(fromSource, { fromSide: 'right' }), block.build)).toEqual(['bad_line_end'])
    expect(mapErrors(withLine(fromSource, { toSide: 'top' }), block.build)).toEqual([])
    expect(mapErrors(withLine(intoResult, { toSide: 'top' }), block.build)).toEqual([])
    expect(mapErrors(withLine(intoResult, { toSide: 'middle' as never }), block.build)).toEqual(['bad_line_end'])
    expect(mapErrors(withLine(intoResult, { fromSide: 'bottom' }), block.build)).toEqual([])
  })
})

describe('the order of the sources and the place of a tile', () => {
  const m = fromPackMap(packMap)
  const ids = block.build.sources.map((s) => s.id)
  it('are how a map is drawn and never change a score', () => {
    const a = evaluate(m, block.build)
    const turned = { ...m, sourceOrder: [...ids].reverse() }
    expect(mapErrors(turned, block.build)).toEqual([])
    const b = evaluate(turned, block.build)
    expect(b.accuracy).toBe(a.accuracy)
    expect(b.perCase).toEqual(a.perCase)
    expect(b.running).toEqual(a.running)
    // Every tile on another cell of the grid: the same tiles, the same lines, the same score.
    const cells: [number, number][] = []
    for (let r = block.build.grid.rows; r >= 1; r--) for (let c = block.build.grid.cols; c >= 1; c--) cells.push([c, r])
    const moved = { ...m, tiles: m.tiles.map((t, i) => ({ ...t, col: cells[i]![0], row: cells[i]![1] })) }
    expect(mapErrors(moved, block.build)).toEqual([])
    const c = evaluate(moved, block.build)
    expect(c.accuracy).toBe(a.accuracy)
    expect(c.perCase).toEqual(a.perCase)
    expect(c.running.money).toBe(a.running.money)
  })
  it('names sources of the pack, each once, and need not name them all', () => {
    expect(mapErrors({ ...m, sourceOrder: [ids[0]!] }, block.build)).toEqual([])
    expect(mapErrors({ ...m, sourceOrder: [] }, block.build)).toEqual([])
    expect(mapErrors({ ...m, sourceOrder: [ids[0]!, ids[0]!] }, block.build)).toEqual(['bad_source_order'])
    expect(mapErrors({ ...m, sourceOrder: ['nothing-of-the-pack'] }, block.build)).toEqual(['bad_source_order'])
    expect(mapErrors({ ...m, sourceOrder: [m.tiles[0]!.id] }, block.build)).toEqual(['bad_source_order'])
    expect(mapErrors({ ...m, sourceOrder: 'first' as never }, block.build)).toEqual(['bad_source_order'])
  })
  it('names a locked source like any other', () => {
    const open = new Set([...block.build.workers.map((w) => w.id), ...(block.build.models ?? []).map((x) => x.id), ...(block.build.compute ?? []).map((x) => x.id), ...(block.build.prompts ?? []).map((x) => x.id), ...m.lines.map((l) => l.from)])
    const lockedOne = ids.find((id) => !open.has(id))
    expect(mapErrors({ ...m, sourceOrder: [...ids].reverse() }, block.build, open)).toEqual([])
    if (lockedOne) expect(mapErrors({ ...m, sourceOrder: [lockedOne] }, block.build, open)).toEqual([])
  })
})
