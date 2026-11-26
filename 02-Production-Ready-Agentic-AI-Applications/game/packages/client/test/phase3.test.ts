// The words and the arithmetic of the Phase 3 screens (engineering spec, section 10.6): when a
// round ends, what a map of the list is called, what the chart draws, and the numbers a report
// carries in the words a player reads.
import { describe, expect, it } from 'vitest'
import type { MaintainingContent } from '@lab02/protocol'
import { axisFloor, axisTicks } from '../src/phase3/Chart.tsx'
import { P3, out100, setUnit3, share100 } from '../src/phase3/copy.ts'
import { chartPoints, gapOf, lettersOf, mapNames, nextPeriod, roundEndMs } from '../src/phase3/model.ts'
import { report, view } from './fixtures/phase3.ts'

describe('the timer of a round', () => {
  const round = (index: number) => ({ index, of: 5, endsAtMs: null })
  it('ends a round as many rounds before the end of the stage as are still to come', () => {
    expect(roundEndMs(600_000, round(1), 120)).toBe(120_000)
    expect(roundEndMs(600_000, round(5), 120)).toBe(600_000)
  })
  it('moves with the end of the stage when the host extends it', () => {
    expect(roundEndMs(630_000, round(2), 120)).toBe(270_000)
  })
  it('has no end once the year is over, and takes the time of the view without a clock', () => {
    expect(roundEndMs(600_000, round(6), 120)).toBeNull()
    expect(roundEndMs(null, { index: 2, of: 5, endsAtMs: 240_000 }, 120)).toBe(240_000)
  })
  it('names the two months the next report covers', () => {
    const c = { year: { periods: [{ id: 'p1', label: 'January and February', short: 'Jan–Feb' }, { id: 'p2', label: 'March and April', short: 'Mar–Apr' }] } } as MaintainingContent
    expect(nextPeriod(c, 1)?.label).toBe('March and April')
    expect(nextPeriod(c, 2)).toBeNull()
    expect(P3.until(102, 'March and April')).toBe('1:42 until the report on March and April')
    expect(P3.roundOf(2, 5)).toBe('Round 2 of 5')
  })
})

describe('the list of maps', () => {
  it('numbers the validations of each phase by themselves and names a reference map by its label', () => {
    const names = mapNames(view().validations)
    expect([...names.values()]).toEqual(['Phase 2 · validation 1', 'Phase 2 · validation 2', 'Reference · Map A', 'Validation 1'])
  })
})

describe('the chart of the year', () => {
  it('draws every number out of 100, and no test mark for a period with no map', () => {
    const pts = chartPoints([report(1), report(2, { map: null, validity: 0.7, reliability: 1, value: 70 })])
    expect(pts[0]).toEqual({ validity: 90, reliability: 85, value: 76.5, test: 94 })
    expect(pts[1]!.test).toBeNull()
  })
  it('starts its axis a ten under the lowest number, and never above 50', () => {
    expect(axisFloor([])).toBe(50)
    expect(axisFloor([{ validity: 92, reliability: 88, value: 81, test: 95 }])).toBe(50)
    expect(axisFloor([{ validity: 92, reliability: 44, value: 40.5, test: 95 }])).toBe(30)
    expect(axisTicks(50)).toEqual([50, 60, 70, 80, 90, 100])
    expect(axisTicks(30)).toEqual([30, 50, 75, 100])
  })
})

describe('a report in words', () => {
  it('writes shares and scores out of 100 with one decimal', () => {
    expect(share100(0.9123)).toBe('91.2')
    expect(out100(76.449)).toBe('76.4')
  })
  it('says how far the validity lies under the test set, and never above it', () => {
    expect(gapOf(report(1, { validity: 0.88, test: 0.954 }))).toBeCloseTo(7.4)
    expect(gapOf(report(1, { validity: 0.96, test: 0.954 }))).toBe(0)
    expect(gapOf(report(1, { map: null }))).toBe(0)
    expect(P3.gapPoints('7.4')).toBe('7.4 under the test set')
  })
  it('counts interruptions in words', () => {
    expect(P3.interruptions(0)).toBe('No interruption')
    expect(P3.interruptions(1)).toBe('1 interruption')
    expect(P3.interruptions(6)).toBe('6 interruptions')
  })
  it('shows how the score of a period comes about', () => {
    expect(P3.scorePeriodHow('91.2', '84.0', 0)).toBe('91.2 × 84.0 ÷ 100')
    expect(P3.scorePeriodHow('91.2', '84.0', 4)).toBe('91.2 × 84.0 ÷ 100 − 4')
    expect(P3.pointsOff(2.5)).toBe('2.5 points off')
  })
  it('writes money with the unit of the pack', () => {
    setUnit3('k$')
    expect(P3.sum(40)).toBe('40 k$')
    expect(P3.sum(4.4)).toBe('4.4 k$')
    expect(P3.grantToast(40)).toBe('40 k$ arrived in your account.')
    setUnit3(null)
    expect(P3.sum(40)).toBe('40')
  })
})

describe('the letters of the year', () => {
  it('keeps the news of the year, the newest first, without the opening letter and the annual review', () => {
    const inbox = [{ id: 'development:brief' }, { id: 'maintaining:brief' }, { id: 'news:n1' }, { id: 'news:alarm:e1' }, { id: 'maintaining:letter' }]
    expect(lettersOf(inbox).map((m) => m.id)).toEqual(['news:alarm:e1', 'news:n1'])
  })
  it('says that something arrived, with its title when it has one', () => {
    expect(P3.newsToast('A little more money')).toBe('New in your letters: A little more money')
    expect(P3.newsToast('')).toBe('A new memo is in your letters.')
  })
})

describe('the words of Phase 3', () => {
  it('has no word for a placed thing but tile, operator and tool', () => {
    const all = JSON.stringify(P3, (_k, v) => (typeof v === 'function' ? String(v) : v))
    expect(all).not.toMatch(/\bworkers?\b/i)
    expect(all).not.toMatch(/\bfacts\b/i)
    expect(all).not.toMatch(/\ba case\b/)
  })
  it('gives every step of the tour an area, a title and a text', () => {
    for (const s of P3.tour) { expect(s.area).toMatch(/^\[data-tour="/); expect(s.title.length).toBeGreaterThan(3); expect(s.text.length).toBeGreaterThan(30) }
    expect(new Set(P3.tour.map((s) => s.area)).size).toBe(P3.tour.length)
  })
})
