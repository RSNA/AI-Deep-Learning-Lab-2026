// The menu and the search of the facilitator guide page (engineering spec, section 10.8): both
// are built from whatever the guide file holds, so they are tested on headings and text alone.
import { describe, expect, it } from 'vitest'
import { SEARCH_MIN, buildOutline, findRanges, partAt } from '../src/lib/guideDoc.ts'

describe('the menu of the guide', () => {
  it('takes the headings that occur more than once as parts, with the next level under them', () => {
    const out = buildOutline([
      { level: 1, text: 'The guide' },
      { level: 3, text: 'On the cover' },
      { level: 2, text: '1. Running\n   the console' },
      { level: 3, text: 'Starting' },
      { level: 3, text: 'Late joiners' },
      { level: 2, text: '2. The first phase' },
      { level: 4, text: 'A detail' },
      { level: 3, text: 'Common mistakes' },
    ])
    expect(out).toEqual([
      { at: 2, text: '1. Running the console', children: [{ at: 3, text: 'Starting' }, { at: 4, text: 'Late joiners' }] },
      { at: 5, text: '2. The first phase', children: [{ at: 7, text: 'Common mistakes' }] },
    ])
  })

  it('works for a document with one level of headings, with none, and with empty ones', () => {
    expect(buildOutline([{ level: 2, text: 'One' }, { level: 2, text: '  ' }, { level: 2, text: 'Two' }])).toEqual([
      { at: 0, text: 'One', children: [] }, { at: 2, text: 'Two', children: [] },
    ])
    expect(buildOutline([])).toEqual([])
    // One heading alone is the only part there is.
    expect(buildOutline([{ level: 1, text: 'Alone' }])).toEqual([{ at: 0, text: 'Alone', children: [] }])
    // A title, then parts one level below it that have nothing under them.
    expect(buildOutline([{ level: 1, text: 'Title' }, { level: 3, text: 'A' }, { level: 3, text: 'B' }]).map((p) => p.text)).toEqual(['A', 'B'])
  })
})

describe('the search of the guide', () => {
  const text = 'Late joiners wait.\nA late  joiner starts with the next phase. Nobody joins (late) for free.'

  it('finds a word whatever its capitals, and a phrase over any run of spaces', () => {
    expect(findRanges(text, 'late').map(([a, b]) => text.slice(a, b))).toEqual(['Late', 'late', 'late'])
    expect(findRanges(text, 'LATE JOINER').map(([a, b]) => text.slice(a, b))).toEqual(['Late joiner', 'late  joiner'])
    expect(findRanges('ends here.\nStarts there', 'here. starts')).toEqual([[5, 17]])
  })

  it('reads signs of a pattern as plain letters', () => {
    expect(findRanges(text, '(late)').map(([a, b]) => text.slice(a, b))).toEqual(['(late)'])
    expect(findRanges('1.5 points, 105 points', '1.5')).toEqual([[0, 3]])
    expect(findRanges(text, '.*')).toEqual([])
  })

  it('finds nothing for a phrase that is too short or is not there', () => {
    expect(SEARCH_MIN).toBe(2)
    expect(findRanges(text, 'l')).toEqual([])
    expect(findRanges(text, '   ')).toEqual([])
    expect(findRanges(text, 'projector')).toEqual([])
  })

  it('says which part a place is in', () => {
    const starts = [10, 40, 90]
    expect([0, 10, 39, 40, 89, 500].map((x) => partAt(starts, x))).toEqual([-1, 0, 0, 1, 1, 2])
    expect(partAt([], 5)).toBe(-1)
  })
})
