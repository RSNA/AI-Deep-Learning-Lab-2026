// What the Phase 3 screens work out from a view (engineering spec, section 10.6): what a map of
// the list is called, and the points of the chart. Pure functions.
import type { MaintainingView } from '@lab02/protocol'
import type { ChartPoint } from './Chart.tsx'
import { P3 } from './copy.ts'

export type MapEntry = MaintainingView['validations'][number]
export type Report = MaintainingView['reports'][number]

/** What every map of the list is called: the validations of each phase by their number, a reference map by its label. */
export function mapNames(validations: MapEntry[]): Map<string, string> {
  const out = new Map<string, string>()
  let two = 0, three = 0
  for (const v of validations) {
    if (v.origin === 'reference') out.set(v.id, P3.fromReference(v.label ?? ''))
    else if (v.origin === 'phase2') out.set(v.id, P3.fromPhase2(++two))
    else out.set(v.id, P3.fromPhase3(++three))
  }
  return out
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
