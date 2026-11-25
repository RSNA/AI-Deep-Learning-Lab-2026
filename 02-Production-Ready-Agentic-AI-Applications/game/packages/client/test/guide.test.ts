// What the Phase 2 screen says to do next and why a line is refused (engineering spec, section
// 10.5): the order a player would fix things, the count of the others, the tile it names, and a
// sentence for every refusal the browser can see. No reason id reaches a screen.
import { describe, expect, it } from 'vitest'
import type { CanvasMap, DevelopmentContent, DevelopmentView } from '@lab02/protocol'
import type { Vocabulary } from '../src/canvas/model.ts'
import { guideOf, lineRefusal } from '../src/phase2/guide.ts'

const content = {
  sources: [{ id: 's1', label: 'Form' }, { id: 's2', label: 'Mailbox' }],
  result: { id: 'res', label: 'Answer' },
  rules: { pools: [{ id: 'lib', label: 'Librarian minutes', max: 4 }] },
} as unknown as DevelopmentContent

const view = (over: Partial<DevelopmentView> = {}): DevelopmentView => ({
  unlocked: ['s1'], validating: null, validationsLeft: 6, flags: { stray: [], incomplete: [], privateData: [] }, rushed: [],
  ready: { ok: false, reasons: ['nothing_reaches_result'], details: [{ reason: 'nothing_reaches_result' }] },
  ...over,
} as unknown as DevelopmentView)

const T = (id: string, kind: string, col: number) => ({ id, kind, col, row: 1, model: null, runsOn: null, prompt: null })
const name = (id: string) => ({ t1: 'Agent', t2: 'Librarian', s1: 'Form', s2: 'Mailbox', res: 'Answer' } as Record<string, string>)[id] ?? id
const plain = (t: string) => !/[a-z]+_[a-z]+/.test(t)

describe('the next thing to do', () => {
  it('guides through the first map, step by step, with the count of the others', () => {
    let g = guideOf(view(), content, { tiles: [], lines: [] }, name)
    expect(g.first?.text).toMatch(/^Place a tile first/)
    expect(g.others).toBe(1)
    g = guideOf(view(), content, { tiles: [T('t1', 'agent', 2)], lines: [] }, name)
    expect(g.first?.text).toMatch(/^No source is joined to a tile/)
    expect(g.first?.nodes).toEqual(['s1'])               // only the sources that are open
    g = guideOf(view(), content, { tiles: [T('t1', 'agent', 2)], lines: [{ from: 's1', to: 't1' }] }, name)
    expect(g.first?.text).toMatch(/^Nothing reaches the result yet/)
    expect(g.first?.nodes).toEqual(['res'])
  })
  it('names the tile and the box, the required worker, and the minutes', () => {
    const map: CanvasMap = { tiles: [T('t1', 'agent', 2), T('t2', 'lib', 3)], lines: [{ from: 's1', to: 't1' }, { from: 't1', to: 't2' }, { from: 't2', to: 'res' }] }
    const g = guideOf(view({ ready: { ok: false, reasons: [], details: [
      { reason: 'tile_incomplete', tile: 't1', missing: ['runsOn'] },
      { reason: 'required_missing', workers: ['x'], text: 'Someone must sign.' },
      { reason: 'too_many_minutes', pool: 'lib', used: 9, max: 4, tiles: ['t2'] },
    ] } }), content, map, name)
    expect(g.first).toEqual({ text: 'Agent has no place to run. Choose one in its box.', nodes: ['t1'], part: 'runsOn' })
    expect(g.others).toBe(2)
    const only = guideOf(view({ ready: { ok: false, reasons: [], details: [{ reason: 'too_many_minutes', pool: 'lib', used: 9, max: 4, tiles: ['t2'] }] } }), content, map, name)
    expect(only.first?.text).toMatch(/^Librarian would need 9 min per patient and has 4\./)
  })
  it('says first that a validation runs or none is left, and is ready when nothing holds', () => {
    expect(guideOf(view({ validating: { id: 'v1', startedAtMs: 0, completesAtMs: 1 } }), content, { tiles: [], lines: [] }, name).first?.text).toMatch(/running/)
    expect(guideOf(view({ validationsLeft: 0 }), content, { tiles: [], lines: [] }, name).first?.text).toMatch(/No validations are left/)
    const map: CanvasMap = { tiles: [T('t1', 'rule', 2)], lines: [{ from: 's1', to: 't1' }, { from: 't1', to: 'res' }] }
    expect(guideOf(view({ ready: { ok: true, reasons: [], details: [] } }), content, map, name)).toEqual({ first: null, others: 0, ready: true, warn: null })
  })
  it('warns that people will rush, and leaves the map ready', () => {
    const map: CanvasMap = { tiles: [T('t1', 'agent', 2), T('t2', 'lib', 3)], lines: [{ from: 's1', to: 't1' }, { from: 't1', to: 't2' }, { from: 't2', to: 'res' }] }
    const ready = { ok: true, reasons: [], details: [] }
    const one = guideOf(view({ ready, rushed: [{ pool: 'lib', used: 9, max: 4, tiles: ['t2'] }] }), content, map, name)
    expect(one.first).toBeNull()
    expect(one.ready).toBe(true)
    expect(one.warn?.text).toMatch(/^Librarian needs 9 min per patient and has 4, so only about 44% of the patients get a full look\. You can still validate\.$/)
    expect(one.warn?.nodes).toEqual(['t2'])
    const two: CanvasMap = { tiles: [...map.tiles, T('t3', 'lib', 4)], lines: map.lines }
    const pool = guideOf(view({ ready, rushed: [{ pool: 'lib', used: 12, max: 4, tiles: ['t2', 't3'] }] }), content, two, name)
    expect(pool.warn?.text).toMatch(/^Librarian: the map needs 12 min per patient and there are 4, so only 1 patient in 3 gets a full look\./)
    expect(plain(one.warn!.text) && plain(pool.warn!.text)).toBe(true)
  })
})

describe('why a line is refused', () => {
  const v = { sources: [{ id: 's1' }, { id: 's2' }], result: { id: 'res' } } as unknown as Vocabulary
  const map: CanvasMap = { tiles: [T('t1', 'agent', 2), T('t2', 'lib', 2), T('t3', 'rule', 1)], lines: [{ from: 's1', to: 't1' }] }
  const open = new Set(['s1'])
  const why = (from: string, to: string) => lineRefusal(map, v, from, to, name, open, { s2: 'Connect the mailbox' })
  it('has a sentence for every case the browser can see, at its place', () => {
    expect(why('s1', 'res')).toEqual({ at: 'res', text: expect.stringMatching(/^Form cannot reach the result by itself/) })
    expect(why('t1', 's1')?.text).toMatch(/^A line cannot end at Form/)
    expect(why('s1', 't1')?.text).toBe('Form is already joined to Agent.')
    expect(why('s2', 't1')?.text).toBe('Mailbox is locked. Do “Connect the mailbox” in Actions to open it.')
    for (const [a, b] of [['s1', 'res'], ['t1', 's1'], ['s2', 't1']] as const) expect(plain(why(a, b)!.text)).toBe(true)
  })
  it('lets a line run any way between two tiles: inside one column, and back to an earlier one', () => {
    expect(why('t1', 't2')).toBeNull()        // one column
    expect(why('t1', 't3')).toBeNull()        // back to the column before
    expect(why('t3', 't1')).toBeNull()
    expect(why('t1', 'res')).toBeNull()
    expect(why('t1', 't1')).toBeNull()
  })
  it('refuses a loop, direct or through other tiles, with its sentence', () => {
    const chain: CanvasMap = { tiles: map.tiles, lines: [{ from: 't1', to: 't2' }, { from: 't2', to: 't3' }] }
    const back = (from: string, to: string) => lineRefusal(chain, v, from, to, name, open, {})
    expect(back('t2', 't1')).toEqual({ at: 't1', text: 'That would close a loop: Agent already hands its work on to Librarian, directly or through other tiles.' })
    expect(back('t3', 't1')?.text).toMatch(/^That would close a loop: Agent already hands its work on to t3/)
    expect(back('t3', 't2')?.text).toMatch(/^That would close a loop/)
    expect(back('t1', 't3')).toBeNull()       // a second way forward is no loop
    expect(plain(back('t3', 't1')!.text)).toBe(true)
  })
})
