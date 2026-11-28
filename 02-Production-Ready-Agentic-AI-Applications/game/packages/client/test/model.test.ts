// The map in the browser (engineering spec, section 10.5): a line between two tiles may run any
// way on the map, inside one column and back to an earlier one. Only a loop is kept out, and a
// tile that moves keeps its lines.
import { describe, expect, it } from 'vitest'
import type { CanvasMap } from '@lab02/protocol'
import { addLine, endTargets, hasLoop, lineKey, mapProblem, moveLineEnd, moveTile, reaches, sameLayout, setLineSide, targetsOf, type Vocabulary } from '../src/canvas/model.ts'

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

describe('a line on the dot the player picked', () => {
  it('keeps the side it leaves and the side it enters, at an end that is a tile', () => {
    const m = addLine({ tiles, lines: [] }, 't1', 't2', 'res', { from: 'top', to: 'left' })
    expect(m.lines).toEqual([{ from: 't1', to: 't2', fromSide: 'top', toSide: 'left' }])
    // A source has one dot: a side given for it is dropped. The result takes a line on any of its four sides.
    expect(addLine({ tiles, lines: [] }, 's1', 't1', 'res', { from: 'bottom', to: 'top' }).lines).toEqual([{ from: 's1', to: 't1', toSide: 'top' }])
    expect(addLine({ tiles, lines: [] }, 't1', 'res', 'res', { from: 'bottom', to: 'top' }).lines).toEqual([{ from: 't1', to: 'res', fromSide: 'bottom', toSide: 'top' }])
    expect(addLine({ tiles, lines: [] }, 't1', 'res', 'res').lines).toEqual([{ from: 't1', to: 'res' }])
    // The same line drawn again is no second line: it moves to the sides it was drawn on now.
    const top = addLine({ tiles, lines: [] }, 't1', 'res', 'res', { to: 'top' })
    expect(addLine(top, 't1', 'res', 'res', { to: 'bottom' }).lines).toEqual([{ from: 't1', to: 'res', toSide: 'bottom' }])
    expect(addLine(top, 't1', 'res', 'res')).toBe(top)
    // Without a pick the line carries no side and joins the sides that face each other.
    expect(addLine({ tiles, lines: [] }, 't1', 't2', 'res').lines).toEqual([{ from: 't1', to: 't2' }])
  })
  it('moves one end to another side and leaves the rest of the map alone', () => {
    const m: CanvasMap = { tiles, lines: [{ from: 's1', to: 't1' }, { from: 't1', to: 't2', fromSide: 'right' }] }
    const key = lineKey(m.lines[1]!)
    const moved = setLineSide(setLineSide(m, key, 'to', 'bottom'), key, 'from', 'left')
    expect(moved.lines).toEqual([{ from: 's1', to: 't1' }, { from: 't1', to: 't2', fromSide: 'left', toSide: 'bottom' }])
    expect(mapProblem(moved, v, open)).toBeNull()
    // The same side again changes nothing, and the end of a line at a source cannot move.
    expect(setLineSide(moved, key, 'from', 'left')).toBe(moved)
    expect(setLineSide(m, lineKey(m.lines[0]!), 'from', 'top')).toBe(m)
    // The end of a line at the result moves to another of its four sides, and to no side of a source.
    const signed: CanvasMap = { tiles, lines: [{ from: 't2', to: 'res' }] }
    expect(setLineSide(signed, 't2>res', 'to', 'bottom', 'res').lines).toEqual([{ from: 't2', to: 'res', toSide: 'bottom' }])
    expect(moveLineEnd(signed, v, 't2>res', 'to', 'res', 'top')?.map.lines).toEqual([{ from: 't2', to: 'res', toSide: 'top' }])
    expect(setLineSide(signed, 't2>res', 'to', 'bottom')).toBe(signed)
    // A side changes how a line is drawn, not which map it is: the same map is not validated twice for it.
    expect(sameLayout(m, moved)).toBe(true)
  })
})

describe('an end of a line that moves to another node', () => {
  // A second source, so that the start of a line has somewhere else to go.
  const v2 = { ...v, sources: [{ id: 's1' }, { id: 's2' }] } as unknown as Vocabulary
  // The case of the play check: the agent (t1) hands to the result, and a radiologist (t2) was placed afterwards.
  const m: CanvasMap = { tiles, lines: [{ from: 's1', to: 't1' }, { from: 't1', to: 'res', fromSide: 'bottom' }] }
  it('points the arrow at another tile and keeps the start with its side', () => {
    const r = moveLineEnd(m, v2, 't1>res', 'to', 't2', 'top')!
    expect(r.key).toBe('t1>t2')
    expect(r.map.lines).toEqual([{ from: 's1', to: 't1' }, { from: 't1', to: 't2', fromSide: 'bottom', toSide: 'top' }])
    expect(mapProblem(r.map, v2, new Set(['s1', 's2', 'tool']))).toBeNull()
  })
  it('moves the start to another source or tile and keeps the arrow end', () => {
    expect(moveLineEnd(m, v2, 's1>t1', 'from', 's2')!.map.lines).toContainEqual({ from: 's2', to: 't1' })
    const r = moveLineEnd(m, v2, 't1>res', 'from', 't2')!
    expect(r.key).toBe('t2>res')
    // The side of the old start is not carried to the new tile.
    expect(r.map.lines).toContainEqual({ from: 't2', to: 'res' })
  })
  it('on the same tile it only changes the side, and without a side it changes nothing', () => {
    expect(moveLineEnd(m, v2, 't1>res', 'from', 't1', 'top')!.map.lines[1]).toEqual({ from: 't1', to: 'res', fromSide: 'top' })
    expect(moveLineEnd(m, v2, 't1>res', 'from', 't1')!.map).toBe(m)
  })
  it('refuses a loop, a second line between the same two nodes, a source as an end and the result as a start', () => {
    const chain: CanvasMap = { tiles, lines: [{ from: 't1', to: 't2' }, { from: 't2', to: 't3' }, { from: 's1', to: 't3' }] }
    expect(moveLineEnd(chain, v2, 't2>t3', 'to', 't1')).toBeNull()         // t1 already hands to t2
    expect(moveLineEnd(chain, v2, 's1>t3', 'from', 't2')).toBeNull()       // t2 to t3 exists
    expect(moveLineEnd(chain, v2, 't1>t2', 'to', 's1')).toBeNull()
    expect(moveLineEnd(chain, v2, 't1>t2', 'from', 'res')).toBeNull()
    expect(moveLineEnd(chain, v2, 't1>t2', 'to', 't1')).toBeNull()         // both ends on one tile
    expect(moveLineEnd(chain, v2, 'nope', 'to', 't1')).toBeNull()
  })
  it('a line moved into the result takes the place of the one that was there', () => {
    const two: CanvasMap = { tiles, lines: [{ from: 't1', to: 'res' }, { from: 't2', to: 't3' }] }
    expect(moveLineEnd(two, v2, 't2>t3', 'to', 'res')!.map.lines).toEqual([{ from: 't2', to: 'res' }])
  })
  it('lights up where an end may go: the nodes the other end allows, and no locked source', () => {
    expect([...endTargets(m, v2, 't1>res', 'to')].sort()).toEqual(['t2', 't3'])
    expect([...endTargets(m, v2, 't1>res', 'from')].sort()).toEqual(['t2', 't3'])
    expect([...endTargets(m, v2, 's1>t1', 'from')].sort()).toEqual(['s2', 't2', 't3'])
    expect([...endTargets(m, v2, 's1>t1', 'from', new Set(['s1', 'tool']))].sort()).toEqual(['t2', 't3'])
    expect([...endTargets(m, v2, 's1>t1', 'to')].sort()).toEqual(['t2', 't3'])
    expect(endTargets(m, v2, 'nope', 'to').size).toBe(0)
  })
})
