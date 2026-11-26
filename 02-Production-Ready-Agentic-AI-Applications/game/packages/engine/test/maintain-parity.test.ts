// Parity of the scoring of Phase 3 with the reference scorer (engineering spec, section 12.2).
// The vectors are written by `python3 tools/maintain_scoring.py --vectors` of the private
// folder, on its neutral toy pack and toy year, and never edited by hand. The engine must give
// the same answer for every vector within 1e-9: a period for a deployed map or for no map, a
// validation with and without the lenses, and a whole year.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fromPackMap, type CanvasTables } from '@lab02/content-schema'
import { live, period, validation, year, type HeldAction, type MaintainRules } from '../src/maintain.ts'
import { expectPeriod, type PeriodExpect, type ValidationExpect, type YearExpect } from './maintain-expect.ts'

type PackMap = Parameters<typeof fromPackMap>[0]
type Base = { name: string; actions: HeldAction[]; new_map: boolean; map: PackMap | null; shown_cases: string[]; shown_notes: string[] }
type File = {
  tolerance: number; build: CanvasTables; maintain: MaintainRules & { workers?: CanvasTables['workers']; line_rules?: CanvasTables['line_rules']; actions?: { id: string; run?: number; unlocks?: string[] }[] }
  periods: (Base & { period: number; actions_set: string; expect: PeriodExpect })[]
  validations: (Base & { seen: number; actions_set: string; map: PackMap; expect: ValidationExpect })[]
  years: { name: string; paid: number; periods: { map: PackMap | null; actions: HeldAction[]; new_map: boolean }[]; expect: YearExpect }[]
}
const file = JSON.parse(readFileSync(new URL('./vectors/maintain.json', import.meta.url), 'utf8')) as File
const tol = file.tolerance
const close = (a: number, b: number) => Math.abs(a - b) <= tol
const mt = file.maintain
// The tables of Phase 3: the toy pack with what the toy year adds.
const t3: CanvasTables = {
  ...file.build,
  workers: [...file.build.workers, ...(mt.workers ?? [])],
  line_rules: [...(file.build.line_rules ?? []), ...(mt.line_rules ?? [])],
  actions: [...(file.build.actions ?? []), ...(mt.actions ?? [])],
}
const sameNumbers = (got: Record<string, number>, want: Record<string, number>) =>
  Object.keys(got).sort().join() === Object.keys(want).sort().join() && Object.keys(want).every((k) => close(got[k]!, want[k]!))

describe('parity: a period of Phase 3', () => {
  it('has vectors of every kind', () => {
    expect(file.periods.length).toBeGreaterThan(100)
    expect(file.periods.some((v) => v.map === null)).toBe(true)
    expect(file.periods.some((v) => v.expect.worst_event !== null)).toBe(true)
    expect(file.periods.some((v) => v.expect.fine > 0)).toBe(true)
    expect(file.periods.some((v) => v.expect.off > 0)).toBe(true)
    expect(file.periods.some((v) => v.expect.components.some((c) => c.part === 'new_map'))).toBe(true)
    expect(file.periods.some((v) => v.expect.events.some((x) => x.cost_loss > 0))).toBe(true)
    for (const op of ['weights', 'fetch_as', 'worker', 'knows', 'gives', 'compute', 'model']) expect([...(mt.world ?? []), ...(mt.events ?? []).flatMap((e) => e.patches ?? [])].some((p) => p.op === op)).toBe(true)
    expect(file.validations.some((v) => v.expect.fresh && v.expect.reliability !== null)).toBe(true)
    expect(file.years.length).toBeGreaterThan(3)
  })
  for (const v of file.periods) {
    it(`${v.name}, period ${v.period}, ${v.actions_set}${v.new_map ? ', a new map' : ''}`, () => {
      const r = period(t3, mt, v.period, v.map ? fromPackMap(v.map) : null, v.actions, v.new_map, v.shown_cases, v.shown_notes)
      expectPeriod(r, v.expect, close)
    })
  }
})

describe('parity: a validation in Phase 3', () => {
  for (const v of file.validations) {
    it(`${v.name}, ${v.seen} reports held, ${v.actions_set}`, () => {
      const r = validation(t3, mt, v.seen, fromPackMap(v.map), v.actions, v.new_map, v.shown_cases, v.shown_notes)
      const e = v.expect
      expect(close(r.accuracy, e.accuracy)).toBe(true)
      if (e.unhurried === null) expect(r.unhurried).toBeNull()
      else expect(close(r.unhurried!, e.unhurried)).toBe(true)
      expect(r.fresh).toBe(e.fresh)
      if (e.reliability === null) expect(r.reliability).toBeNull()
      else expect(close(r.reliability!, e.reliability)).toBe(true)
      expect(r.missed).toEqual(e.missed)
      expect(r.note).toEqual(e.note)
      expect(close(r.running.money, e.run_month)).toBe(true)
      expect(sameNumbers(r.running.minutes, e.minutes)).toBe(true)
      expect(r.running.complexity).toBe(e.complexity)
      expect({ private_data: r.flags.privateData, overloaded: r.flags.overloaded, distracting: r.flags.distracting, prompt: r.flags.prompt, stray: r.flags.stray, rushed: r.flags.rushed }).toEqual(e.flags)
    })
  }
})

describe('parity: a year of Phase 3', () => {
  for (const v of file.years) {
    it(`${v.name}, ${v.paid} paid`, () => {
      const r = year(t3, mt, v.periods.map((x) => ({ map: x.map ? fromPackMap(x.map) : null, actions: x.actions, newMap: x.new_map })), v.paid)
      const e = v.expect
      for (const k of ['mean', 'spent', 'score', 'raw'] as const) expect(close(r[k], e[k])).toBe(true)
      for (const k of ['values', 'validity', 'reliability'] as const) {
        expect(r[k].length).toBe(e[k].length)
        r[k].forEach((x, i) => expect(close(x, e[k][i]!)).toBe(true))
      }
    })
  }
  it('no report yet scores nothing', () => {
    expect(live(mt, [], 10)).toEqual({ mean: 0, spent: 10, score: 0, raw: 0 })
  })
})
