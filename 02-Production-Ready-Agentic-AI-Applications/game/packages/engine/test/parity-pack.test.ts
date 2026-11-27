// Parity on a real pack (engineering spec, section 12.2): random boards made by the rule of
// section 6.5 are scored by the engine and by the reference scorer, which is called with
// `--score`. Runs only with `npm run test:parity`, which needs CONTENT_DIR and SCORER (the path
// of the reference scorer of the private folder). Nothing of the pack is written to disk.
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { loadPack, type CanvasMap } from '@lab02/content-schema'
import { boardError, scoreBoard } from '../src/phases/planning.ts'

const on = process.env.PARITY_PACK === '1'

/** A small seeded generator, so a failing board can be found again. */
function rng(seed: number) {
  let x = seed >>> 0
  return () => { x = (Math.imul(x ^ (x >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0; return x / 2 ** 32 }
}

describe.runIf(on)('parity on CONTENT_DIR', () => {
  it('the engine scores random boards as the reference does', () => {
    const scorer = process.env.SCORER
    if (!scorer) throw new Error('set SCORER to the path of the reference scorer')
    const loaded = loadPack(process.env.CONTENT_DIR!)
    if (!loaded.ok) throw new Error(loaded.errors[0]!.message)
    const pack = loaded.pack
    const rules = pack.game.phases.planning
    const phaseCfg = { classes: rules.classes, class_order: rules.class_order, flagship_class: rules.flagship_class, scoring: rules.scoring, investigations: { per_system: rules.investigations.per_system } }
    const rand = rng(20261118)
    const requests: unknown[] = []
    const local: ReturnType<typeof scoreBoard>[] = []
    for (const id of pack.systemIds) {
      const problems = pack.systems[id]!.problems!.map((p) => ({ id: p.id, key: { class: p.key.class, flagship: p.key.flagship, real: p.key.real, tier: p.key.tier } }))
      const spots = rules.class_order.flatMap((c) => Array<string>(rules.classes.find((x) => x.id === c)!.capacity).fill(c))
      for (let n = 0; n < 300; n++) {
        const order = [...spots]
        for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [order[i], order[j]] = [order[j]!, order[i]!] }
        const picks: Record<string, string> = {}
        problems.forEach((p, i) => { if (n % 4 !== 3 || rand() > 0.3) picks[p.id] = order[i]! })
        if (n === 0) problems.forEach((p) => { picks[p.id] = p.key.class })   // the perfect board
        expect(boardError(picks, problems, rules)).toBeNull()
        // The perfect board starts no investigation; the others any number a system has.
        const started = n === 0 ? 0 : Math.floor(rand() * (rules.investigations.per_system + 1))
        requests.push({ fn: 'planning', report: { picks, investigations: started }, problems, phase_cfg: phaseCfg })
        local.push(scoreBoard(picks, problems, rules, started))
      }
    }
    const out = execFileSync('python3', [scorer, '--score'], { input: JSON.stringify(requests), maxBuffer: 64 * 1024 * 1024 })
    const ref = JSON.parse(out.toString()) as { classify: number; flagship: number; economy: number; raw: number }[]
    expect(ref.length).toBe(local.length)
    const bad = ref.map((r, i) => [i, r, local[i]!] as const).filter(([, r, l]) => r.classify !== l.classify || r.flagship !== l.flagship || r.economy !== l.economy || r.raw !== l.raw)
    expect(bad.map(([i]) => i)).toEqual([])
    // The perfect board of each system reaches the maximum.
    for (let k = 0; k < pack.systemIds.length; k++) expect(local[k * 300]!.raw).toBe(rules.candidates * rules.scoring.classify.exact + rules.scoring.flagship.bonus + (rules.scoring.economy?.max ?? 0))
  })
})

/**
 * The canvas on CONTENT_DIR (section 12.2): random maps of every health system, each scored by the
 * engine and by the reference scorer of the canvas (CANVAS_SCORER, the path of
 * tools/canvas_scoring.py), called once with `--score` per build file.
 */
describe.runIf(on && !!process.env.CANVAS_SCORER)('canvas parity on CONTENT_DIR', () => {
  it('the engine scores random maps as the reference does', async () => {
    const { evaluate } = await import('../src/canvas.ts')
    const { lineRuleOf, mapErrors, readyReasons } = await import('@lab02/content-schema')
    const { join } = await import('node:path')
    const loaded = loadPack(process.env.CONTENT_DIR!)
    if (!loaded.ok) throw new Error(loaded.errors[0]!.message)
    const pack = loaded.pack
    const rand = rng(20261122)
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!
    let compared = 0
    for (const id of pack.systemIds) {
      const sp = pack.systems[id]!
      const b = sp.build
      if (!b) continue
      const maps: CanvasMap[] = []
      while (maps.length < 300) {
        const cells: [number, number][] = []
        for (let c = 1; c <= b.grid.cols; c++) for (let r = 1; r <= b.grid.rows; r++) cells.push([c, r])
        cells.sort(() => rand() - 0.5)
        const tiles = cells.slice(0, 1 + Math.floor(rand() * 6)).map(([col, row], i) => {
          const w = pick(b.workers)
          const pairs = w.needs_model ? Object.keys(w.by_model ?? {}).flatMap((m) => (b.models.find((x) => x.id === m)?.runs_on ?? []).map((c) => [m, c] as const)) : []
          const pr = pairs.length ? pick(pairs) : null
          return { id: `t${i + 1}`, kind: w.id, col, row, model: pr ? pr[0] : null, runsOn: pr ? pr[1] : null, prompt: w.needs_model && b.prompts.length ? pick(b.prompts).id : null }
        }).sort((x, y) => x.col - y.col || x.row - y.row)
        const top = Math.max(...tiles.map((t) => t.col))
        const lines = [{ from: pick(tiles.filter((t) => t.col === top)).id, to: b.result.id }]
        for (const t of tiles) {
          for (const s of b.sources) if (rand() < 0.35) lines.push({ from: s.id, to: t.id })
          for (const u of tiles) if (u.col > t.col && rand() < 0.4) lines.push({ from: t.id, to: u.id })
        }
        // A line that a rule of the pack refuses is left out, so that enough maps are accepted.
        const m = { tiles, lines: lines.filter((l) => !lineRuleOf(l, { tiles, lines }, b)?.refuse) }
        if (readyReasons(m, b).includes('no_source_connected')) m.lines.push({ from: pick(b.sources).id, to: lines[0]!.from })
        if (mapErrors(m, b, null).length || readyReasons(m, b).length) continue
        maps.push(m)
      }
      const req = maps.map((m) => ({ map: { tiles: m.tiles.map((t) => ({ id: t.id, kind: t.kind, col: t.col, row: t.row, model: t.model, runs_on: t.runsOn, prompt: t.prompt })), lines: m.lines }, unlocked: null }))
      const file = join(process.env.CONTENT_DIR!, sp.folder, 'build.yaml')
      const out = execFileSync('python3', [process.env.CANVAS_SCORER!, '--score', file], { input: JSON.stringify(req), maxBuffer: 64 * 1024 * 1024 })
      const ref = JSON.parse(out.toString()) as { accuracy: number; per_case: Record<string, number>; run_month: number; complexity: number; missed: unknown; note: unknown; flags: Record<string, string[]> }[]
      maps.forEach((m, i) => {
        const e = evaluate(m, b)
        const r = ref[i]!
        expect(Math.abs(e.accuracy - r.accuracy)).toBeLessThan(1e-9)
        for (const k of Object.keys(r.per_case)) expect(Math.abs(e.perCase[k]! - r.per_case[k]!)).toBeLessThan(1e-9)
        expect(Math.abs(e.running.money - r.run_month)).toBeLessThan(1e-9)
        expect(e.running.complexity).toBe(r.complexity)
        expect(e.missed).toEqual(r.missed)
        expect(e.note).toEqual(r.note)
        expect([e.flags.privateData, e.flags.overloaded, e.flags.distracting, e.flags.prompt, e.flags.stray, e.flags.rushed]).toEqual([r.flags.private_data, r.flags.overloaded, r.flags.distracting, r.flags.prompt, r.flags.stray, r.flags.rushed])
        compared++
      })
    }
    expect(compared).toBeGreaterThan(0)
  }, 120_000)
})

/**
 * Phase 3 on CONTENT_DIR (section 12.2): the reference maps, the traps and the examples of each
 * build file that are ready, in every period of the year with several sets of actions, each
 * scored by the engine and by the reference scorer of Phase 3 (MAINTAIN_SCORER, the path of
 * tools/maintain_scoring.py), called once with `--score` per health system. A pack whose health
 * systems have no maintain.yaml yet is skipped.
 */
describe.runIf(on && !!process.env.MAINTAIN_SCORER)('Phase 3 parity on CONTENT_DIR', () => {
  it('the engine scores periods, validations and years as the reference does', async () => {
    const { fromPackMap, mapErrors, phase3Build, readyReasons, referenceMaps } = await import('@lab02/content-schema')
    const { period, validation, year } = await import('../src/maintain.ts')
    const { expectPeriod } = await import('./maintain-expect.ts')
    type PeriodExpect = import('./maintain-expect.ts').PeriodExpect
    type ValidationExpect = import('./maintain-expect.ts').ValidationExpect
    type YearExpect = import('./maintain-expect.ts').YearExpect
    const { join } = await import('node:path')
    const loaded = loadPack(process.env.CONTENT_DIR!)
    if (!loaded.ok) throw new Error(loaded.errors[0]!.message)
    const pack = loaded.pack
    const near = (a: number, b: number) => Math.abs(a - b) < 1e-9
    const toPack = (m: CanvasMap) => ({ tiles: m.tiles.map((t) => ({ id: t.id, kind: t.kind, col: t.col, row: t.row, model: t.model, runs_on: t.runsOn, prompt: t.prompt })), lines: m.lines.map((l) => ({ from: l.from, to: l.to })) })
    let compared = 0
    for (const id of pack.systemIds) {
      const sp = pack.systems[id]!
      const b = sp.build, mt = sp.maintain
      if (!b || !mt) continue
      const b3 = phase3Build(b, mt)
      const last = mt.periods.length
      // Every named map of the key that is accepted and ready on the board of Phase 3.
      const key = b.key as unknown as { examples?: { id: string; map: Parameters<typeof fromPackMap>[0] }[] }
      const named: { name: string; map: CanvasMap }[] = [
        ...referenceMaps(b).map((r) => ({ name: `reference ${r.id}`, map: r.map })),
        ...(b.key.traps ?? []).map((t) => ({ name: `trap ${t.id}`, map: fromPackMap(t.map) })),
        ...(key.examples ?? []).map((e) => ({ name: `example ${e.id}`, map: fromPackMap(e.map) })),
      ]
      // A model that exists from Phase 3 on: the first reference map with every AI tile on it,
      // at the first place where it runs.
      const first = referenceMaps(b)[0]
      for (const mo of mt.models) {
        if (first) named.push({ name: `reference ${first.id} on ${mo.id}`, map: { tiles: first.map.tiles.map((t) => (t.model !== null && mo.by_worker[t.kind] ? { ...t, model: mo.id, runsOn: mo.runs_on[0]! } : t)), lines: first.map.lines } })
      }
      const ready = named.filter((x) => !mapErrors(x.map, b3, null).length && !readyReasons(x.map, b3).length)
      expect(ready.filter((x) => x.name.includes(' on ')).length).toBe(first ? mt.models.length : 0)
      // Sets of actions: none, everything of Phase 3 done in the first round, everything done in
      // the middle of the year, every repair started right after its event began, and every
      // hardening held from Phase 2 on (an action of the build file may harden too).
      const all = (k: number) => mt.actions.map((a) => ({ id: a.id, started: k, done: k }))
      const repairs = mt.events.flatMap((e) => e.repaired_by.map((a) => ({ id: a, started: e.from, done: e.from })))
      const hardened = mt.reliability.hardening.map((h) => ({ id: h.action, started: 0, done: 0 }))
      const sets = [{ name: 'none', actions: [] as { id: string; started: number; done: number }[] }, { name: 'all early', actions: all(1) }, { name: 'all in the middle', actions: all(3) }, { name: 'repairs', actions: repairs }, { name: 'hardened', actions: hardened }]
      type Req = { kind: 'period' | 'validation' | 'year'; label: string; run: () => unknown; body: Record<string, unknown> }
      const reqs: Req[] = []
      for (const x of ready) for (const set of sets) {
        for (let p = 1; p <= last; p++) for (const newMap of p === 2 ? [false, true] : [false]) {
          reqs.push({ kind: 'period', label: `${x.name}, period ${p}, ${set.name}`, body: { kind: 'period', period: p, map: toPack(x.map), actions: set.actions, new_map: newMap }, run: () => period(b3, mt, p, x.map, set.actions, newMap) })
        }
        for (const seen of [1, 3, last - 1]) reqs.push({ kind: 'validation', label: `${x.name}, validation at ${seen}, ${set.name}`, body: { kind: 'validation', seen, map: toPack(x.map), actions: set.actions, new_map: true }, run: () => validation(b3, mt, seen, x.map, set.actions, true) })
        const plan = Array.from({ length: last }, () => ({ map: x.map, actions: set.actions, newMap: false }))
        reqs.push({ kind: 'year', label: `${x.name}, a year, ${set.name}`, body: { kind: 'year', paid: 40, periods: plan.map((y) => ({ map: toPack(y.map), actions: y.actions, new_map: false })) }, run: () => year(b3, mt, plan, 40) })
      }
      for (let p = 1; p <= last; p++) reqs.push({ kind: 'period', label: `no map, period ${p}`, body: { kind: 'period', period: p, map: null, actions: [] }, run: () => period(b3, mt, p, null, []) })
      const out = execFileSync('python3', [process.env.MAINTAIN_SCORER!, '--score', join(process.env.CONTENT_DIR!, sp.folder, 'build.yaml'), join(process.env.CONTENT_DIR!, sp.folder, 'maintain.yaml')], { input: JSON.stringify(reqs.map((r) => r.body)), maxBuffer: 256 * 1024 * 1024 })
      const ref = JSON.parse(out.toString()) as unknown[]
      expect(ref.length).toBe(reqs.length)
      reqs.forEach((r, i) => {
        if (r.kind === 'period') expectPeriod(r.run() as ReturnType<typeof period>, ref[i] as PeriodExpect, near)
        else if (r.kind === 'validation') {
          const got = r.run() as ReturnType<typeof validation>, want = ref[i] as ValidationExpect
          expect(near(got.accuracy, want.accuracy), r.label).toBe(true)
          expect(got.fresh, r.label).toBe(want.fresh)
          if (want.reliability === null) expect(got.reliability).toBeNull()
          else expect(near(got.reliability!, want.reliability), r.label).toBe(true)
          expect(got.missed).toEqual(want.missed)
          expect(near(got.running.money, want.run_month), r.label).toBe(true)
        } else {
          const got = r.run() as ReturnType<typeof year>, want = ref[i] as YearExpect
          for (const k of ['mean', 'spent', 'score', 'raw'] as const) expect(near(got[k], want[k]), `${r.label}: ${k}`).toBe(true)
          got.values.forEach((v, n) => expect(near(v, want.values[n]!), r.label).toBe(true))
        }
        compared++
      })
    }
    // Nothing to compare is fine while the pack has no year yet. With one, every request was held.
    if (pack.systemIds.some((id) => pack.systems[id]!.maintain)) expect(compared).toBeGreaterThan(0)
  }, 300_000)
})
