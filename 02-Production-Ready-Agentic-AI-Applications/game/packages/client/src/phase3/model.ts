// What the Phase 3 screens work out from a view (engineering spec, section 10.6): when the round
// ends, what a map of the list is called, and the points of the chart. Pure functions.
import type { MaintainingContent, MaintainingView } from '@lab02/protocol'
import type { ChartPoint } from './Chart.tsx'
import { P3 } from './copy.ts'

export type MapEntry = MaintainingView['validations'][number]
export type Report = MaintainingView['reports'][number]

/**
 * When the round in progress ends, in game time. The end of the stage less the rounds still to
 * come, so that an extension by the host moves it at once (section 6.7). Null after the last
 * report, and without a clock the time the view carries.
 */
export function roundEndMs(stageEndsAtMs: number | null, round: MaintainingView['round'], roundSeconds: number): number | null {
  if (round.index > round.of) return null
  if (stageEndsAtMs === null) return round.endsAtMs
  return stageEndsAtMs - (round.of - round.index) * roundSeconds * 1000
}

/** The period whose report the round in progress ends with, or null when the year is over. */
export function nextPeriod(c: MaintainingContent, seen: number): { label: string; short: string } | null {
  return c.year.periods[seen] ?? null
}

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
