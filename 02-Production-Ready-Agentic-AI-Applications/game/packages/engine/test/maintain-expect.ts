// What the reference scorer of Phase 3 answers, and how a period of the engine is held to it.
// Used with the toy vectors and, on the Mac, with a real pack (section 12.2).
import { expect } from 'vitest'
import type { BillLine } from '../src/canvas.ts'
import type { PeriodScore } from '../src/state.ts'

type Flags = { private_data: string[]; overloaded: string[]; distracting: string[]; prompt: string[]; stray: string[]; rushed: string[] }
type Missed = { case: string; reason: string; fact: string | null } | null
export type BillExpect = { kind: string; id: string; count: number; money: number }
/** A bill of the engine against the reference: the same lines in the same order, and the same money. */
export function expectBill(got: readonly BillLine[], want: readonly BillExpect[], near: (a: number, b: number) => boolean): void {
  expect(got.map((x) => [x.kind, x.id, x.count])).toEqual(want.map((x) => [x.kind, x.id, x.count]))
  got.forEach((x, i) => expect(near(x.money, want[i]!.money), `${x.kind} ${x.id}: ${x.money} against ${want[i]!.money}`).toBe(true))
}
export type PeriodExpect = {
  no_map: boolean; validity: number; test: number; reliability: number; interruptions: number; off: number
  pool_tiles: number; hurry: number; value: number; run_cost: number; fine: number; bill: BillExpect[]
  components: { part: string; id: string | null; tile?: string; line?: [string, string]; risk: number; event: string | null }[]
  worst_part: number | null
  events: { id: string; validity_loss: number; reliability_loss: number; cost_loss: number; fine: number; impact: number; hit: boolean }[]
  worst_event: string | null
  per_case: Record<string, number>; missed: Missed; note: string | null; flags: Flags
}
export type ValidationExpect = {
  accuracy: number; unhurried: number | null; fresh: boolean; reliability: number | null
  missed: Missed; note: string | null; run_month: number; minutes: Record<string, number>; complexity: number; flags: Flags
}
export type YearExpect = { mean: number; spent: number; score: number; raw: number; values: number[]; validity: number[]; reliability: number[] }
/** Compare one period of the engine with what the reference gave. Used on the private pack too. */
export function expectPeriod(r: PeriodScore, e: PeriodExpect, near: (a: number, b: number) => boolean): void {
  expect(r.noMap).toBe(e.no_map)
  for (const [got, want] of [[r.validity, e.validity], [r.test, e.test], [r.reliability, e.reliability], [r.off, e.off], [r.hurry, e.hurry], [r.value, e.value], [r.runCost, e.run_cost], [r.fine, e.fine]] as const) {
    expect(near(got, want), `${got} against ${want}`).toBe(true)
  }
  expectBill(r.bill, e.bill, near)
  expect(near(r.bill.reduce((sum, x) => sum + x.money, 0), r.runCost + r.fine)).toBe(true)
  expect(r.interruptions).toBe(e.interruptions)
  expect(r.poolTiles).toBe(e.pool_tiles)
  expect(r.components.map((c) => [c.part, c.id, c.tile ?? null, c.line ?? null, c.event])).toEqual(e.components.map((c) => [c.part, c.id, c.tile ?? null, c.line ?? null, c.event]))
  r.components.forEach((c, i) => expect(near(c.risk, e.components[i]!.risk)).toBe(true))
  expect(r.worstPart).toBe(e.worst_part)
  expect(r.events.map((x) => [x.id, x.hit])).toEqual(e.events.map((x) => [x.id, x.hit]))
  r.events.forEach((x, i) => {
    const w = e.events[i]!
    for (const [got, want] of [[x.validityLoss, w.validity_loss], [x.reliabilityLoss, w.reliability_loss], [x.costLoss, w.cost_loss], [x.fine, w.fine], [x.impact, w.impact]] as const) expect(near(got, want)).toBe(true)
  })
  expect(r.worstEvent).toBe(e.worst_event)
  expect(Object.keys(r.perCase).sort()).toEqual(Object.keys(e.per_case).sort())
  for (const k of Object.keys(e.per_case)) expect(near(r.perCase[k]!, e.per_case[k]!)).toBe(true)
  expect(r.missed).toEqual(e.missed)
  expect(r.note).toEqual(e.note)
}

