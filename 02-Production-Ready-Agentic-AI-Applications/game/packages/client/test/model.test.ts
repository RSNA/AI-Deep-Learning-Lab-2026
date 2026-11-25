// The map in the browser (engineering spec, section 10.5): a line between two tiles may run any
// way on the map, inside one column and back to an earlier one. Only a loop is kept out, and a
// tile that moves keeps its lines.
import { describe, expect, it } from 'vitest'
import type { CanvasMap } from '@lab02/protocol'
import { hasLoop, mapProblem, moveTile, reaches, targetsOf, type Vocabulary } from '../src/canvas/model.ts'

const v = {
  cols: 5, rows: 5,
  sources: [{ id: 's1' }], result: { id: 'res' },
  workers: [{ id: 'tool', needsModel: false, models: [] }], models: [], compute: [], prompts: [],
} as unknown as Vocabulary
const T = (id: string, col: number, row: number) => ({ id, kind: 'tool', col, row, model: null, runsOn: null, prompt: null })
const open = new Set(['s1', 'tool'])
// t1 and t2 stand in one column, t3 one column before them.
const tiles = [T('t1', 2, 1), T('t2', 2, 2), T('t3', 1, 3)]

describe('lines in any direction', () => {
  it('offers every other tile as a target, whatever its column', () => {
    const m: CanvasMap = { tiles, lines: [] }
    expect([...targetsOf(m, v, 't1')].sort()).toEqual(['res', 't2', 't3'])
    expect([...targetsOf(m, v, 's1')].sort()).toEqual(['t1', 't2', 't3'])
  })
  it('accepts a chain down one column and back to the column before', () => {
    const m: CanvasMap = { tiles, lines: [{ from: 's1', to: 't1' }, { from: 't1', to: 't2' }, { from: 't2', to: 't3' }, { from: 't3', to: 'res' }] }
    expect(mapProblem(m, v, open)).toBeNull()
    expect(hasLoop(m)).toBe(false)
  })
  it('keeps a loop out: a tile that already gets the work, directly or through others, is no target', () => {
    const m: CanvasMap = { tiles, lines: [{ from: 't1', to: 't2' }, { from: 't2', to: 't3' }] }
    expect(reaches(m, 't1', 't3')).toBe(true)
    expect([...targetsOf(m, v, 't3')].sort()).toEqual(['res'])
    expect([...targetsOf(m, v, 't2')].sort()).toEqual(['res'])          // t3 is joined already, t1 would close a loop
    expect([...targetsOf(m, v, 't1')].sort()).toEqual(['res', 't3'])    // a second way forward is no loop
    const loop: CanvasMap = { tiles, lines: [...m.lines, { from: 't3', to: 't1' }] }
    expect(hasLoop(loop)).toBe(true)
    expect(mapProblem(loop, v, open)).toBe('loop')
    expect(mapProblem({ tiles, lines: [{ from: 't1', to: 't1' }] }, v, open)).toBe('loop')
  })
  it('moves a tile with all of its lines', () => {
    const m: CanvasMap = { tiles, lines: [{ from: 't1', to: 't2' }, { from: 't2', to: 't3' }] }
    const moved = moveTile(m, 't3', 5, 5)
    expect(moved.lines).toEqual(m.lines)
    expect(moved.tiles.find((t) => t.id === 't3')).toMatchObject({ col: 5, row: 5 })
    expect(moveTile(m, 't1', 1, 1).lines).toHaveLength(2)
  })
})
