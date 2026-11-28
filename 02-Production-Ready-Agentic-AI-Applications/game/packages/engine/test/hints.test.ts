// What the shape of a map says to a host who helps a player (engineering spec, section 10.8):
// each hint fires on the map it is about and stays silent on the map that does it right. The
// demo pack is Riverbend: every case needs the request form and the catalog, the partner mailbox
// is long and locked, the thread sorter shortens it, and the librarian has to sign.
import { describe, expect, it } from 'vitest'
import { allItems, fromPackMap, startUnlocked, type BuildFile, type CanvasMap } from '@lab02/content-schema'
import { running } from '../src/canvas.ts'
import { costFirst, mapHints, type MapHint } from '../src/hints.ts'
import { demoPack } from './helpers.ts'

const pack = demoPack()
const B = pack.systems.rb!.build!
const LS = pack.systems.ls!.build!
const REF = fromPackMap(B.key.reference.map)
const START = startUnlocked(B)
const ALL = new Set(allItems(B))
const T = (id: string, kind: string, col: number, row: number, model: string | null = null, runsOn: string | null = null, prompt: string | null = null) =>
  ({ id, kind, col, row, model, runsOn, prompt })
const L = (...pairs: [string, string][]) => pairs.map(([from, to]) => ({ from, to }))
const of = <K extends MapHint['kind']>(hints: MapHint[], kind: K) => hints.filter((h): h is Extract<MapHint, { kind: K }> => h.kind === kind)
const clone = (b: BuildFile): BuildFile => structuredClone(b)

const LARGE = T('t1', 'rb-w-agent', 3, 2, 'rb-m-large', 'rb-c-api')
const SIGN = T('t9', 'rb-w-librarian', 4, 2)
const tail = L(['t1', 't9'], ['t9', 'rb-result'])
/** The large model reads the form, the catalog, the courier site and the whole mailbox. */
const DIRECT: CanvasMap = { tiles: [LARGE, SIGN], lines: [...L(['rb-s-form', 't1'], ['rb-s-catalog', 't1'], ['rb-s-courier', 't1'], ['rb-s-mailbox', 't1']), ...tail] }
/** The same with the thread sorter in front of the mailbox. */
const SORTED: CanvasMap = { tiles: [LARGE, T('t2', 'rb-w-sorter', 1, 4), SIGN], lines: [...L(['rb-s-form', 't1'], ['rb-s-catalog', 't1'], ['rb-s-courier', 't1'], ['rb-s-mailbox', 't2'], ['t2', 't1']), ...tail] }
/** A second agent gathers the form and the catalog, which every case needs, and hands them on. */
const DETOUR: CanvasMap = { tiles: [LARGE, T('t4', 'rb-w-agent', 2, 4, 'rb-m-small', 'rb-c-api'), SIGN], lines: [...L(['rb-s-form', 't4'], ['rb-s-catalog', 't4'], ['t4', 't1'], ['rb-s-courier', 't1']), ...tail] }
/** A second agent gathers the courier site, and the agent that decides reads the form and the catalog itself. */
const SPLIT = (gatherer: string): CanvasMap => ({ tiles: [LARGE, T('t4', 'rb-w-agent', 2, 4, gatherer, 'rb-c-api'), SIGN], lines: [...L(['rb-s-form', 't1'], ['rb-s-catalog', 't1'], ['rb-s-courier', 't4'], ['t4', 't1']), ...tail] })
/** The rule tile stands behind the librarian. */
const RULE_LAST: CanvasMap = { tiles: [LARGE, SIGN, T('t5', 'rb-w-rule', 5, 2)], lines: L(['rb-s-form', 't1'], ['rb-s-catalog', 't1'], ['t1', 't9'], ['t9', 't5'], ['t5', 'rb-result']) }
/** A librarian at the start and another at the end. */
const TWICE: CanvasMap = { tiles: [T('t8', 'rb-w-librarian', 1, 2), LARGE, SIGN], lines: [...L(['rb-s-form', 't8'], ['t8', 't1'], ['rb-s-catalog', 't1']), ...tail] }

describe('a source of the proposed system that is still locked', () => {
  it('is named with the action that opens it', () => {
    const h = of(mapHints(SORTED, B, START, REF).hints, 'locked_source')
    expect(h).toEqual([{ kind: 'locked_source', source: 'rb-s-mailbox', action: 'rb-a-mailbox' }])
  })
  it('is no hint once the player has it, and none without a proposed system to compare with', () => {
    expect(of(mapHints(SORTED, B, ALL, REF).hints, 'locked_source')).toEqual([])
    expect(of(mapHints(SORTED, B, START, null).hints, 'locked_source')).toEqual([])
  })
  it('is first in the list', () => {
    expect(mapHints(RULE_LAST, B, START, REF).hints[0]!.kind).toBe('locked_source')
  })
})

describe('a tile behind the required worker', () => {
  it('is named, and the map is not praised for who has the last word', () => {
    const r = mapHints(RULE_LAST, B, ALL, REF)
    expect(of(r.hints, 'after_required')).toEqual([{ kind: 'after_required', tile: 't5', required: 't9' }])
    expect(r.good.some((g) => g.kind === 'required_last')).toBe(false)
  })
  it('is no hint when the required worker signs, and that is good', () => {
    const r = mapHints(SORTED, B, ALL, REF)
    expect(of(r.hints, 'after_required')).toEqual([])
    expect(r.good).toContainEqual({ kind: 'required_last', required: 't9' })
  })
  it('is no hint for what stands between two required workers', () => {
    const r = mapHints(TWICE, B, ALL, REF)
    expect(of(r.hints, 'after_required')).toEqual([])
    expect(r.good).toContainEqual({ kind: 'required_last', required: 't9' })
  })
})

describe('a source every case needs that takes a detour', () => {
  it('is named with the agent it goes through and the loss of a handoff', () => {
    const h = of(mapHints(DETOUR, B, ALL, REF).hints, 'through_agent')
    expect(h.map((x) => x.source).sort()).toEqual(['rb-s-catalog', 'rb-s-form'])
    for (const x of h) expect(x).toMatchObject({ via: 't4', decider: 't1', lossPercent: 4 })
  })
  it('is no hint when the agent that decides reads it itself, and that is good', () => {
    const r = mapHints(SPLIT('rb-m-small'), B, ALL, REF)
    expect(of(r.hints, 'through_agent')).toEqual([])
    expect(r.good).toContainEqual({ kind: 'decider_direct', decider: 't1' })
  })
  it('is no hint behind a tool that prepares the source, which loses nothing', () => {
    const b = clone(B)
    const sorter = b.workers.find((w) => w.id === 'rb-w-sorter')!
    ;(sorter.prepares as Record<string, { as: string; load?: number }>).easy = { as: 'easy' }
    const m: CanvasMap = { tiles: [LARGE, T('t2', 'rb-w-sorter', 1, 4), SIGN], lines: [...L(['rb-s-form', 't2'], ['rb-s-catalog', 't2'], ['t2', 't1'], ['rb-s-courier', 't1']), ...tail] }
    expect(of(mapHints(m, b, ALL, REF).hints, 'through_agent')).toEqual([])
  })
  it('is no hint on a map with one agent, and one agent is not praised for it', () => {
    const r = mapHints(SORTED, B, ALL, REF)
    expect(of(r.hints, 'through_agent')).toEqual([])
    expect(r.good.some((g) => g.kind === 'decider_direct')).toBe(false)
  })
})

describe('a model that reads a long source whole', () => {
  it('is named with the source, its tokens, the cost of the tile and the tool that would shorten it', () => {
    const h = of(mapHints(DIRECT, B, ALL, REF).hints, 'reads_whole')
    const cost = running(DIRECT, B).running.reads!.t1!.money
    expect(h).toEqual([{ kind: 'reads_whole', tile: 't1', model: 'rb-m-large', sources: ['rb-s-mailbox'], tokens: 2500, money: cost, tool: 'rb-w-sorter', cheapest: false }])
  })
  it('takes the money of a bill when one is given', () => {
    expect(of(mapHints(DIRECT, B, ALL, REF, { t1: { money: 99 } }).hints, 'reads_whole')[0]!.money).toBe(99)
  })
  it('is no hint behind the tool, and that is good', () => {
    const r = mapHints(SORTED, B, ALL, REF)
    expect(of(r.hints, 'reads_whole')).toEqual([])
    expect(r.good).toContainEqual({ kind: 'reads_short' })
  })
  it('is no hint while the player has no tool that would shorten it', () => {
    const noSorter = new Set([...ALL].filter((id) => id !== 'rb-w-sorter'))
    expect(of(mapHints(DIRECT, B, noSorter, REF).hints, 'reads_whole')).toEqual([])
  })
  it('is no hint on a model that costs nothing, and none in a pack that prices a model by the call', () => {
    const b = clone(B)
    ;(b.models.find((x) => x.id === 'rb-m-large') as { run?: number }).run = 0
    expect(of(mapHints(DIRECT, b, ALL, REF).hints, 'reads_whole')).toEqual([])
    const ls = fromPackMap(LS.key.reference.map)
    const r = mapHints(ls, LS, new Set(allItems(LS)), ls)
    expect(r.hints.filter((h) => h.kind === 'reads_whole' || h.kind === 'dear_gatherer')).toEqual([])
    expect(r.good.some((g) => g.kind === 'reads_short')).toBe(false)
  })
  it('prefers a tool that costs nothing to run, leaves a distracting source to its flag, and praises no map it has a hint for', () => {
    // The sorter costs money here, and a free tool shortens the mailbox a little less.
    const b = clone(B)
    ;(b.workers.find((w) => w.id === 'rb-w-sorter') as { run?: number }).run = 1
    const clipper = b.workers.find((w) => w.id === 'rb-w-clipper')!
    ;(clipper.prepares as Record<string, { as: string; load?: number }>).hard = { as: 'hard_sorted' }
    ;(b.efforts!.find((e) => e.id === 'hard_sorted') as { size?: number }).size = 2
    expect(of(mapHints(DIRECT, b, ALL, REF).hints, 'reads_whole')[0]!.tool).toBe('rb-w-clipper')
    // A long source that distracts is not something to put a tool in front of.
    const d = clone(B)
    ;(d.sources.find((x) => x.id === 'rb-s-mailbox') as { distracts?: number }).distracts = 0.9
    expect(of(mapHints(DIRECT, d, ALL, REF).hints, 'reads_whole')).toEqual([])
    // The small model reads the mailbox whole: a hint, and so no praise for short reading.
    const small: CanvasMap = { tiles: [T('t1', 'rb-w-agent', 3, 2, 'rb-m-small', 'rb-c-api'), SIGN], lines: [...L(['rb-s-form', 't1'], ['rb-s-catalog', 't1'], ['rb-s-mailbox', 't1']), ...tail] }
    // With the models of the start the small one is their cheapest, and with the open model it is not.
    const r = mapHints(small, B, new Set([...START, 'rb-s-mailbox']), REF)
    expect(of(r.hints, 'reads_whole')).toHaveLength(1)
    expect(of(r.hints, 'reads_whole')[0]!.cheapest).toBe(true)
    expect(of(mapHints(small, B, ALL, REF).hints, 'reads_whole')[0]!.cheapest).toBe(false)
    expect(r.good.some((g) => g.kind === 'reads_short')).toBe(false)
  })
  it('the long source on the dearest model is not praised', () => {
    expect(mapHints(DIRECT, B, ALL, REF).good.some((g) => g.kind === 'reads_short')).toBe(false)
  })
})

describe('an agent that only gathers on the dearest model', () => {
  /** Riverbend with a small model that finds as much as the large one. */
  const even = () => {
    const b = clone(B)
    const agent = b.workers.find((w) => w.id === 'rb-w-agent')!
    const q = agent.by_model as Record<string, { fetch: Record<string, number> }>
    q['rb-m-small']!.fetch = { ...q['rb-m-large']!.fetch }
    return b
  }
  it('is named with the cheaper model that finds as much', () => {
    const h = of(mapHints(SPLIT('rb-m-large'), even(), ALL, REF).hints, 'dear_gatherer')
    expect(h).toHaveLength(1)
    expect(h[0]).toMatchObject({ tile: 't4', model: 'rb-m-large', cheaper: 'rb-m-small' })
    expect(h[0]!.money).toBeGreaterThan(0)
  })
  it('is no hint on the cheaper model, and none for the agent that decides', () => {
    const r = mapHints(SPLIT('rb-m-small'), even(), ALL, REF)
    expect(of(r.hints, 'dear_gatherer')).toEqual([])
  })
  it('is no hint when the cheaper model finds less, or is not theirs yet', () => {
    expect(of(mapHints(SPLIT('rb-m-large'), B, ALL, REF).hints, 'dear_gatherer')).toEqual([])
    const noSmall = new Set([...ALL].filter((id) => id !== 'rb-m-small'))
    expect(of(mapHints(SPLIT('rb-m-large'), even(), noSmall, REF).hints, 'dear_gatherer')).toEqual([])
  })
})

describe('the order of the hints', () => {
  it('is: a locked source, a tile behind the required worker, a detour, then what the models read', () => {
    const m: CanvasMap = {
      tiles: [LARGE, T('t4', 'rb-w-agent', 2, 4, 'rb-m-small', 'rb-c-api'), SIGN, T('t5', 'rb-w-rule', 5, 2)],
      lines: L(['rb-s-form', 't4'], ['rb-s-catalog', 't4'], ['t4', 't1'], ['rb-s-cards', 't1'], ['t1', 't9'], ['t9', 't5'], ['t5', 'rb-result']),
    }
    const unlocked = new Set([...START, 'rb-s-cards'])
    const kinds = mapHints(m, B, unlocked, REF).hints.map((h) => h.kind)
    expect(kinds).toEqual(['locked_source', 'after_required', 'through_agent', 'through_agent'])
  })
  it('puts the cost first for a player whose bill is the trouble', () => {
    const m: CanvasMap = { tiles: [LARGE, SIGN, T('t5', 'rb-w-rule', 5, 2)], lines: L(['rb-s-form', 't1'], ['rb-s-catalog', 't1'], ['rb-s-mailbox', 't1'], ['t1', 't9'], ['t9', 't5'], ['t5', 'rb-result']) }
    const h = mapHints(m, B, ALL, null)
    expect(h.hints.map((x) => x.kind)).toEqual(['after_required', 'reads_whole'])
    expect(costFirst(h).hints.map((x) => x.kind)).toEqual(['reads_whole', 'after_required'])
  })
  it('works on a draft that reaches no result', () => {
    const m: CanvasMap = { tiles: [LARGE], lines: L(['rb-s-mailbox', 't1']) }
    const r = mapHints(m, B, ALL, REF)
    expect(r.hints.map((h) => h.kind)).toEqual(['reads_whole'])
    expect(r.good).toEqual([])
  })
})
