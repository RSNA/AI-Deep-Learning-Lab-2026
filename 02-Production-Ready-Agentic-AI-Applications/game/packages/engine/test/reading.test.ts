// A model is paid for what it reads, and a tool behind a tool works on what the first one made
// of a source (engineering spec, section 6.6). The reference is `reading_units` and `prepared_by`
// of `tools/canvas_scoring.py`; the parity vectors hold the numbers, and these tests hold the
// rules on the demo pack: Riverbend prices a model by what it reads, Lakeshore by the call.
import { describe, expect, it } from 'vitest'
import { preparedBy, type CanvasMap } from '@lab02/content-schema'
import { evaluate, running } from '../src/canvas.ts'
import { readsView, runningView, tileShortNames } from '../src/project/canvas.ts'
import { demoPack } from './helpers.ts'

const pack = demoPack()
const B = pack.systems.rb!.build!
const LS = pack.systems.ls!.build!
const T = (id: string, kind: string, col: number, row: number, model: string | null = null, runsOn: string | null = null, prompt: string | null = null) =>
  ({ id, kind, col, row, model, runsOn, prompt })
const L = (...pairs: [string, string][]) => pairs.map(([from, to]) => ({ from, to }))
const size = (e: string) => B.efforts!.find((x) => x.id === e)!.size!
const price = (model: string, place: string) => (B.models.find((x) => x.id === model)!.run ?? 0) * (B.compute.find((x) => x.id === place)!.price_factor ?? 1)
const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-9)

const LARGE = T('t1', 'rb-w-agent', 3, 2, 'rb-m-large', 'rb-c-api')
const END = [T('t9', 'rb-w-librarian', 4, 2)]
const tail = L(['t1', 't9'], ['t9', 'rb-result'])
/** The large model reads the form, the catalog, the courier site and the whole mailbox. */
const DIRECT: CanvasMap = { tiles: [LARGE, ...END], lines: [...L(['rb-s-form', 't1'], ['rb-s-catalog', 't1'], ['rb-s-courier', 't1'], ['rb-s-mailbox', 't1']), ...tail] }
/** The same with the thread sorter in front of the mailbox. */
const SORTED: CanvasMap = { tiles: [LARGE, T('t2', 'rb-w-sorter', 1, 4), ...END], lines: [...L(['rb-s-form', 't1'], ['rb-s-catalog', 't1'], ['rb-s-courier', 't1'], ['rb-s-mailbox', 't2'], ['t2', 't1']), ...tail] }
/** The sorter, and behind it the quote clipper, which works on what the sorter made of the mailbox. */
const CLIPPED: CanvasMap = { tiles: [LARGE, T('t2', 'rb-w-sorter', 1, 4), T('t3', 'rb-w-clipper', 2, 4), ...END], lines: [...L(['rb-s-form', 't1'], ['rb-s-catalog', 't1'], ['rb-s-courier', 't1'], ['rb-s-mailbox', 't2'], ['t2', 't3'], ['t3', 't1']), ...tail] }
/** The clipper alone: it has no entry for the raw mailbox. */
const CLIPPER_ALONE: CanvasMap = { tiles: [LARGE, T('t3', 'rb-w-clipper', 2, 4), ...END], lines: [...L(['rb-s-form', 't1'], ['rb-s-catalog', 't1'], ['rb-s-courier', 't1'], ['rb-s-mailbox', 't3'], ['t3', 't1']), ...tail] }
/** A small model reads the mailbox and hands a summary to the large one. */
const SPLIT: CanvasMap = { tiles: [LARGE, T('t4', 'rb-w-agent', 2, 4, 'rb-m-small', 'rb-c-api'), ...END], lines: [...L(['rb-s-form', 't1'], ['rb-s-catalog', 't1'], ['rb-s-courier', 't1'], ['rb-s-mailbox', 't4'], ['t4', 't1']), ...tail] }

describe('a model is paid for what it reads', () => {
  it('a direct source counts with the size of its effort, and the price is per unit', () => {
    const r = running(DIRECT, B).running
    near(r.reads!.t1!.units, 3 * size('easy') + size('hard'))
    near(r.reads!.t1!.money, r.reads!.t1!.units * price('rb-m-large', 'rb-c-api'))
    expect(r.reads!.t1).toMatchObject({ model: 'rb-m-large', place: 'rb-c-api' })
    expect(Object.keys(r.reads!)).toEqual(['t1'])        // a person and a tool read for nothing
  })
  it('a source behind a tool counts with the size of what the tool made of it', () => {
    near(running(SORTED, B).running.reads!.t1!.units, 3 * size('easy') + size('hard_sorted'))
    expect(running(SORTED, B).running.money).toBeLessThan(running(DIRECT, B).running.money)
  })
  it('a summary handed on counts `reading.handoff`, so the long source costs less on the small model', () => {
    const r = running(SPLIT, B).running
    near(r.reads!.t1!.units, 3 * size('easy') + B.reading!.handoff)
    near(r.reads!.t4!.units, size('hard'))
    const calls = (x: ReturnType<typeof running>) => Object.values(x.running.reads!).reduce((sum, y) => sum + y.money, 0)
    expect(calls(running(SPLIT, B))).toBeLessThan(calls(running(DIRECT, B)))
  })
  it('the bill of the place is the sum of what its models read', () => {
    const r = running(SPLIT, B)
    const line = r.bill.find((b) => b.kind === 'calls' && b.id === 'rb-c-api')!
    near(line.money, r.running.reads!.t1!.money + r.running.reads!.t4!.money)
  })
  it('works on a draft that is not ready, and skips a tile without a model or a place', () => {
    const draft: CanvasMap = { tiles: [LARGE, T('t5', 'rb-w-agent', 2, 5)], lines: L(['rb-s-form', 't1'], ['rb-s-form', 't5']) }
    expect(Object.keys(running(draft, B).running.reads!)).toEqual(['t1'])
  })
  it('a pack without `reading` prices a model by the calls of its worker and reports no reads', () => {
    expect(LS.reading).toBeUndefined()
    const agent = LS.workers.find((w) => w.needs_model && w.calls)!
    const model = LS.models.find((m) => m.runs_on.length > 0 && (m.run ?? 0) > 0)!
    const place = LS.compute.find((c) => c.id === model.runs_on[0])!
    const m: CanvasMap = { tiles: [T('t1', agent.id, 2, 2, model.id, place.id)], lines: L([LS.sources[0]!.id, 't1'], ['t1', LS.result.id]) }
    const r = running(m, LS)
    expect(r.running.reads).toEqual({})
    near(r.bill.find((b) => b.kind === 'calls')!.money, agent.calls! * model.run! * (place.price_factor ?? 1))
  })
})

describe('a tool behind a tool', () => {
  const shape = (m: CanvasMap) => {
    const tiles = new Map(m.tiles.map((x) => [x.id, x]))
    const srcIn = new Map<string, string[]>(m.tiles.map((x) => [x.id, []]))
    const wrkIn = new Map<string, string[]>(m.tiles.map((x) => [x.id, []]))
    for (const l of m.lines) {
      if (l.to === B.result.id) continue
      if (B.sources.some((s) => s.id === l.from)) srcIn.get(l.to)!.push(l.from); else wrkIn.get(l.to)!.push(l.from)
    }
    return { tiles, srcIn, wrkIn, sources: new Map(B.sources.map((s) => [s.id, s])), workers: new Map(B.workers.map((w) => [w.id, w])) }
  }
  it('works on what the tool before it made of the source', () => {
    const s = shape(CLIPPED)
    const got = preparedBy('t3', s.tiles, s.srcIn, s.wrkIn, s.sources, s.workers)
    expect(got).toEqual([{ source: 'rb-s-mailbox', candidates: [{ effort: 'hard_sorted', load: 0.5 }, { effort: 'hard_short', load: 0.5 }] }])
    near(running(CLIPPED, B).running.reads!.t1!.units, 3 * size('easy') + size('hard_short'))
  })
  it('reads better and for less than behind the first tool alone', () => {
    expect(evaluate(CLIPPED, B).accuracy).toBeGreaterThan(evaluate(SORTED, B).accuracy)
    expect(running(CLIPPED, B).running.money).toBeLessThan(running(SORTED, B).running.money)
  })
  it('does nothing with a raw source it has no entry for: the reader gets a handoff and no fact', () => {
    const s = shape(CLIPPER_ALONE)
    expect(preparedBy('t3', s.tiles, s.srcIn, s.wrkIn, s.sources, s.workers)).toEqual([])
    near(running(CLIPPER_ALONE, B).running.reads!.t1!.units, 3 * size('easy') + B.reading!.handoff)
    expect(evaluate(CLIPPER_ALONE, B).accuracy).toBeLessThan(evaluate(DIRECT, B).accuracy)
  })
})

describe('what a browser gets', () => {
  it('names every tile with a model as the board does, in tokens and money', () => {
    const two: CanvasMap = { ...SPLIT }
    const view = runningView(running(two, B).running, two, B)
    expect(view.reads.map((x) => [x.tile, x.name])).toEqual([['t1', 'Agent 1'], ['t4', 'Agent 2']])
    expect(view.reads[0]).toMatchObject({ model: B.models.find((x) => x.id === 'rb-m-large')!.public.label, place: B.compute.find((x) => x.id === 'rb-c-api')!.public.label })
    expect(view.reads[0]!.tokens).toBe(Math.round((3 * size('easy') + B.reading!.handoff) * B.reading!.tokens_per_unit!))
    expect(view.reads[1]!.tokens).toBe(Math.round(size('hard') * B.reading!.tokens_per_unit!))
    expect(tileShortNames(DIRECT, B).get('t1')).toBe('Agent')      // one of its kind has no number
  })
  it('sends no size of the pack', () => {
    const view = runningView(running(SPLIT, B).running, SPLIT, B)
    expect(JSON.stringify(view)).not.toMatch(/"(units|size)"/)
    expect(readsView(undefined, SPLIT, B)).toEqual([])             // a state stored before the rule
  })
})
