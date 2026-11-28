// The hints on the shape of a map as a host reads them (engineering spec, section 10.8): every
// hint is a full sentence with the names of the board, two detours to the same agent are said
// once, and the sources a hint names are known, so that the list of losses does not repeat them.
import { describe, expect, it } from 'vitest'
import type { CoachGood, CoachHint } from '@lab02/protocol/host'
import { hintLines, type HintWords } from '../src/pages/hostHints.ts'

const NAMES: Record<string, string> = {
  t1: 'Agent 1', t2: 'Agent 2', t3: 'Agent 3', t9: 'Librarian', t5: 'Rules',
  's-form': 'Request form', 's-catalog': 'Catalog', 's-mailbox': 'Partner mailbox',
  'w-sorter': 'Thread sorter', 'm-large': 'Acorn Large', 'm-small': 'Acorn Small', 'a-mailbox': 'Join the partner mailbox',
}
const W: HintWords = {
  tile: (id) => NAMES[id] ?? id, source: (id) => NAMES[id] ?? id, worker: (id) => NAMES[id] ?? id, model: (id) => NAMES[id] ?? id,
  action: (id) => NAMES[id] ?? null, money: (x) => `${x.toFixed(1)} k$`, billed: false,
}
const HINTS: CoachHint[] = [
  { kind: 'locked_source', source: 's-mailbox', action: 'a-mailbox' },
  { kind: 'after_required', tile: 't5', required: 't9' },
  { kind: 'through_agent', source: 's-form', via: 't2', decider: 't1', lossPercent: 4 },
  { kind: 'through_agent', source: 's-catalog', via: 't3', decider: 't1', lossPercent: 4 },
  { kind: 'reads_whole', tile: 't1', model: 'm-large', sources: ['s-mailbox'], tokens: 2500, money: 12.4, tool: 'w-sorter', cheapest: false },
  { kind: 'dear_gatherer', tile: 't2', model: 'm-large', cheaper: 'm-small', money: 3 },
]
const GOOD: CoachGood[] = [{ kind: 'required_last', required: 't9' }, { kind: 'decider_direct', decider: 't1' }, { kind: 'reads_short' }]

describe('the hints on the shape of a map, as sentences', () => {
  const r = hintLines(HINTS, GOOD, W)
  it('says each hint once, and two detours to the same agent in one line', () => {
    expect(r.holds).toHaveLength(5)
    expect(r.say).toHaveLength(5)
    expect(r.holds[2]).toBe('Request form and Catalog reach Agent 1 only through Agent 2 and Agent 3. Every patient needs them, and each handoff loses about 4 percent.')
  })
  it('names the action that opens a locked source, and leaves it out when the pack has none', () => {
    expect(r.holds[0]).toBe('Partner mailbox is still locked on their board, so nothing on their map can read it. The action "Join the partner mailbox" opens it.')
    const bare = hintLines([{ kind: 'locked_source', source: 's-mailbox', action: null }], [], W)
    expect(bare.holds[0]).toBe('Partner mailbox is still locked on their board, so nothing on their map can read it.')
  })
  it('gives the tokens and the cost of a tile that reads a long source whole, and whether a bill said so', () => {
    expect(r.holds[3]).toBe('Agent 1 reads Partner mailbox whole on Acorn Large, about 2,500 tokens per patient. Agent 1 costs 12.4 k$ a month.')
    expect(r.say[3]).toBe('Ask what Agent 1 reads for each patient and what that costs a month. Would Thread sorter in front of Partner mailbox, or a small agent that gathers, change the bill?')
    const small = hintLines([{ ...HINTS[4]!, cheapest: true } as CoachHint], [], W)
    expect(small.say[0]).toBe('Ask what Agent 1 reads for each patient and what that costs a month. Would Thread sorter in front of Partner mailbox change the bill?')
    const billed = hintLines([HINTS[4]!], [], { ...W, billed: true })
    expect(billed.holds[0]).toContain('On the last bill Agent 1 cost 12.4 k$ a month.')
  })
  it('every line is a sentence, and every question starts with what to ask', () => {
    for (const x of [...r.holds, ...r.good]) expect(x).toMatch(/^[A-Z].*\.$/)
    for (const x of r.say) expect(x).toMatch(/^Ask .*[.?]$/)
    expect(r.good).toHaveLength(3)
  })
  it('knows the sources that a hint names', () => {
    expect([...r.sources].sort()).toEqual(['s-catalog', 's-form', 's-mailbox'])
  })
})
