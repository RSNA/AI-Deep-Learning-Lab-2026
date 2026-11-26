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
  it('must be one of the four, on a tile: a source and the result have one place for a line', () => {
    const m = fromPackMap(packMap)
    const withLine = (i: number, extra: Partial<CanvasLine>) => ({ tiles: m.tiles, lines: m.lines.map((l, k) => (k === i ? { ...l, ...extra } : l)) })
    const fromSource = m.lines.findIndex((l) => l.from.startsWith('s-'))
    const intoResult = m.lines.findIndex((l) => l.to === block.build.result.id)
    expect(mapErrors(withLine(1, { fromSide: 'middle' as never }), block.build)).toEqual(['bad_line_end'])
    expect(mapErrors(withLine(fromSource, { fromSide: 'right' }), block.build)).toEqual(['bad_line_end'])
    expect(mapErrors(withLine(fromSource, { toSide: 'top' }), block.build)).toEqual([])
    expect(mapErrors(withLine(intoResult, { toSide: 'left' }), block.build)).toEqual(['bad_line_end'])
    expect(mapErrors(withLine(intoResult, { fromSide: 'bottom' }), block.build)).toEqual([])
  })
})
