// What the Phase 3 screens work out from a view (engineering spec, section 10.6): what a map of
// the list is called, and the points of the chart. Pure functions.
import type { MaintainingView } from '@lab02/protocol'
import type { ChartPoint } from './Chart.tsx'
import { P3 } from './copy.ts'

export type MapEntry = MaintainingView['validations'][number]
export type Report = MaintainingView['reports'][number]

/**
 * What every system of the list is called: "System 1", "System 2" and so on, in the order the
 * player made them across Phase 2 and Phase 3. The proposed system takes the next number when it
 * is taken, like any other.
 */
export function mapNames(validations: { id: string }[]): Map<string, string> {
  return new Map(validations.map((v, i) => [v.id, P3.systemN(i + 1)]))
}

/** One point of the chart for every report: everything out of 100. A period with no map has no test mark. */
export function chartPoints(reports: Report[]): ChartPoint[] {
  return reports.map((r) => ({ validity: 100 * r.validity, reliability: 100 * r.reliability, value: r.value, test: r.map === null ? null : 100 * r.test }))
}

/** How far the validity of a report lies under the test set, in points. Never below zero. */
export function gapOf(r: Report): number {
  return r.map === null ? 0 : Math.max(0, 100 * (r.test - r.validity))
}

/** The letters and memos that arrived during the year (the news of the pack, and what a watching action reports), the newest first. They stay as cards. */
export function lettersOf<T extends { id: string }>(inbox: T[]): T[] {
  return inbox.filter((m) => m.id.startsWith('news:')).reverse()
}
