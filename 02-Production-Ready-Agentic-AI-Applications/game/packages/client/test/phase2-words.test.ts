// The words of Phase 2 that carry numbers (engineering spec, section 10.5): the minutes of the
// people in the words a player reads, what a rushed map did, and when two maps are the same map.
import { describe, expect, it } from 'vitest'
import type { CanvasMap } from '@lab02/protocol'
import { sameLayout } from '../src/canvas/model.ts'
import { P2, money, poolPeople, reach, setMoneyUnit } from '../src/phase2/copy.ts'

describe('the minutes of the people', () => {
  it('names the people of a pool, whatever the pack calls its minutes', () => {
    expect(poolPeople('Librarian minutes')).toBe('Librarian')
    expect(poolPeople('Librarian')).toBe('Librarian')
  })
  it('says what a tile needs and has, never "6 of 3"', () => {
    expect(P2.personBody(6, 3)).toBe('Needs 6 min per patient, has 3')
    expect(P2.minutes('Librarian', 6, 3)).toBe('Librarian: needs 6 min per patient, has 3')
    expect(P2.minutes('Librarian minutes', 0, 10)).toBe('Librarian: needs 0 min per patient, has 10')
  })
  it('says how many patients get a full look', () => {
    expect(reach(24, 3)).toBe('only 1 patient in 8 gets a full look')
    expect(reach(14, 3)).toBe('only about 21% of the patients get a full look')
    expect(reach(24, 3, true)).toBe('only 1 patient in 8 got a full look')
  })
  it('says what a rushed map did and what it would reach with the time', () => {
    expect(P2.rushedPool('Librarian', 24, 3)).toBe('Librarian: this map needs 24 min per patient and there are 3, so only 1 patient in 8 got a full look. The others passed without one.')
    expect(P2.unhurried(0.706)).toBe('With the time it asks for, this map would be right for 70.6% of the patients.')
  })
  it('gives a tool that is plain software no tag', () => {
    expect(P2.kinds.fixed).toBe('')
  })
  it('has no word for a placed thing but tile, operator and tool', () => {
    const all = JSON.stringify(P2, (_k, v) => (typeof v === 'function' ? String(v) : v))
    expect(all).not.toMatch(/\bworkers?\b/i)
    expect(all).not.toMatch(/\bfacts\b/i)
    expect(all).not.toMatch(/\ba case\b/)
  })
})

describe('money', () => {
  it('says what a map costs to run a month and a year', () => {
    setMoneyUnit('k$')
    expect(P2.perMonth(3)).toBe('3.0 k$ a month, 36 k$ a year')
    expect(P2.perMonth(0.3)).toBe('0.3 k$ a month, 4 k$ a year')
    expect(P2.perMonth(0)).toBe('0.0 k$ a month, 0 k$ a year')
  })
  it('says in one sentence what every model reads and what that costs, and leaves out a tile that reads nothing yet', () => {
    setMoneyUnit('k$')
    const one = { name: 'Agent 1', model: 'Large', tokens: 6000, money: 1.24 }
    const two = { name: 'Agent 2', model: 'Small', tokens: 2200, money: 0.02 }
    const idle = { name: 'Agent 3', model: 'Small', tokens: 0, money: 0 }
    expect(P2.reads([one])).toBe('Per patient, Agent 1 reads about 6,000 tokens on Large (1.2 k$ a month).')
    expect(P2.reads([one, two, idle])).toBe('Per patient, Agent 1 reads about 6,000 tokens on Large (1.2 k$ a month) and Agent 2 reads about 2,200 tokens on Small (< 0.1 k$ a month).')
    expect(P2.reads([idle])).toBe('')
    expect(P2.reads([])).toBe('')
    expect(P2.reads(undefined)).toBe('')        // a game kept before the rule
    expect(P2.readsIntro('Agent 1', 'Large', 6000, 1.24)).toBe('With the lines it has now, Agent 1 reads about 6,000 tokens per patient. On Large that costs 1.2 k$ a month. A model is paid by the token, so a long source costs more than a short one, and it costs the most on a large model.')
  })
  it('says why an action cannot be paid, also when the account is below zero', () => {
    setMoneyUnit('k$')
    expect(P2.needsMoney(8, 5)).toBe('Costs 8 k$, and you have 5 k$ left.')
    expect(P2.needsMoney(8, -6)).toBe('Your account is below zero, so it cannot pay 8 k$.')
    expect(money(-6)).toBe('−6')
    expect(money(23.4)).toBe('23.4')
    setMoneyUnit(null)
  })
})

describe('the same map', () => {
  const t = (id: string, col: number) => ({ id, kind: 'agent', col, row: 1, model: null, runsOn: null, prompt: null })
  const a: CanvasMap = { tiles: [t('t1', 1), t('t2', 2)], lines: [{ from: 's1', to: 't1' }, { from: 't1', to: 't2' }] }
  it('is the same whatever the order of its tiles and lines', () => {
    expect(sameLayout(a, { tiles: [...a.tiles].reverse(), lines: [...a.lines].reverse() })).toBe(true)
  })
  it('is another map when a line or a part differs', () => {
    expect(sameLayout(a, { tiles: a.tiles, lines: a.lines.slice(0, 1) })).toBe(false)
    expect(sameLayout(a, { tiles: [t('t1', 1), { ...t('t2', 2), model: 'm' }], lines: a.lines })).toBe(false)
  })
  it('is the same system when only a tile stands elsewhere: a place changes no score, so a tidied map is not validated twice', () => {
    expect(sameLayout(a, { tiles: [t('t1', 1), t('t2', 3)], lines: a.lines })).toBe(true)
    expect(sameLayout(a, { ...a, sourceOrder: ['s2', 's1'] })).toBe(true)
  })
})
