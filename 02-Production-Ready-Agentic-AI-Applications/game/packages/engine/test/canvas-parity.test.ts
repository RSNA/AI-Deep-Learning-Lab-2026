// Parity of the canvas with the reference scorer (engineering spec, section 12.2). The vectors are
// written by `python3 tools/canvas_scoring.py --vectors` of the private folder, on its neutral toy
// pack, and never edited by hand. The engine must give the same answer for every vector within
// 1e-9: accepted or the errors, ready or the reasons, the accuracy, the share of every case,
// money, minutes, complexity, every flag, the missed case and the note.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fromPackMap, mapErrors, readyReasons, type CanvasTables } from '@lab02/content-schema'
import { evaluate } from '../src/canvas.ts'

type Expect = {
  accepted: boolean; errors?: string[]; ready?: boolean; reasons?: string[]
  accuracy?: number; per_case?: Record<string, number>; run_month?: number; minutes?: Record<string, number>
  complexity?: number; raw?: number
  flags?: { private_data: string[]; overloaded: string[]; distracting: string[]; prompt: string[]; stray: string[] }
  missed?: { case: string; reason: string; fact: string | null } | null; note?: string | null
}
type Vector = {
  name: string; unlocked_set: string; unlocked: string[]
  map: Parameters<typeof fromPackMap>[0]; shown_cases: string[]; shown_notes: string[]; expect: Expect
}
type Block = { name: string; build: CanvasTables; cases: Vector[] }
const file = JSON.parse(readFileSync(new URL('./vectors/canvas.json', import.meta.url), 'utf8')) as
  { tolerance: number; build: CanvasTables; cases: Vector[]; more?: Block[] }
const tol = file.tolerance
// The first block is the toy pack of the file itself; `more` holds further blocks, each with its
// own pack (the second has efforts beyond easy and hard).
const blocks: Block[] = [{ name: 'toy', build: file.build, cases: file.cases }, ...(file.more ?? [])]

const close = (a: number, b: number) => Math.abs(a - b) <= tol
const sameNumbers = (got: Record<string, number>, want: Record<string, number>) =>
  Object.keys(got).sort().join() === Object.keys(want).sort().join() && Object.keys(want).every((k) => close(got[k]!, want[k]!))

describe('parity: the canvas', () => {
  it('has every block, and vectors of every kind', () => {
    expect(blocks.length).toBeGreaterThan(1)
    const all = blocks.flatMap((b) => b.cases)
    expect(file.cases.length).toBeGreaterThan(30)
    expect(all.some((v) => !v.expect.accepted)).toBe(true)
    expect(all.some((v) => v.expect.accepted && !v.expect.ready)).toBe(true)
    for (const b of blocks) expect(b.cases.some((v) => v.expect.ready)).toBe(true)
  })
  for (const block of blocks) describe(block.name, () => {
    for (const v of block.cases) {
      it(`${v.name} (${v.unlocked_set})`, () => {
        const m = fromPackMap(v.map)
        const e = v.expect
        const errs = mapErrors(m, block.build, new Set(v.unlocked))
        if (!e.accepted) { expect(errs).toEqual(e.errors); return }
        expect(errs).toEqual([])
        const reasons = readyReasons(m, block.build)
        if (!e.ready) { expect(reasons).toEqual(e.reasons); return }
        expect(reasons).toEqual([])
        const r = evaluate(m, block.build, v.shown_cases, v.shown_notes)
        expect(close(r.accuracy, e.accuracy!)).toBe(true)
        expect(close(1000 * r.accuracy, e.raw!)).toBe(true)
        expect(sameNumbers(r.perCase, e.per_case!)).toBe(true)
        expect(close(r.running.money, e.run_month!)).toBe(true)
        expect(sameNumbers(r.running.minutes, e.minutes!)).toBe(true)
        expect(r.running.complexity).toBe(e.complexity)
        expect({
          private_data: r.flags.privateData, overloaded: r.flags.overloaded, distracting: r.flags.distracting,
          prompt: r.flags.prompt, stray: r.flags.stray,
        }).toEqual(e.flags)
        expect(r.missed).toEqual(e.missed)
        expect(r.note).toEqual(e.note)
      })
    }
  })
})
