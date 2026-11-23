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
    const phaseCfg = { classes: rules.classes, class_order: rules.class_order, flagship_class: rules.flagship_class, scoring: rules.scoring }
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
        requests.push({ fn: 'planning', report: { picks }, problems, phase_cfg: phaseCfg })
        local.push(scoreBoard(picks, problems, rules))
      }
    }
    const out = execFileSync('python3', [scorer, '--score'], { input: JSON.stringify(requests), maxBuffer: 64 * 1024 * 1024 })
    const ref = JSON.parse(out.toString()) as { classify: number; flagship: number; raw: number }[]
    expect(ref.length).toBe(local.length)
    const bad = ref.map((r, i) => [i, r, local[i]!] as const).filter(([, r, l]) => r.classify !== l.classify || r.flagship !== l.flagship || r.raw !== l.raw)
    expect(bad.map(([i]) => i)).toEqual([])
    // The perfect board of each system reaches the maximum.
    for (let k = 0; k < pack.systemIds.length; k++) expect(local[k * 300]!.raw).toBe(rules.candidates * rules.scoring.classify.exact + rules.scoring.flagship.bonus)
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
    const { mapErrors, readyReasons } = await import('@lab02/content-schema')
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
        const m = { tiles, lines }
        if (readyReasons(m, b).includes('no_source_connected')) lines.push({ from: pick(b.sources).id, to: lines[0]!.from })
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
        expect([e.flags.privateData, e.flags.overloaded, e.flags.distracting, e.flags.prompt, e.flags.stray]).toEqual([r.flags.private_data, r.flags.overloaded, r.flags.distracting, r.flags.prompt, r.flags.stray])
        compared++
      })
    }
    expect(compared).toBeGreaterThan(0)
  }, 120_000)
})
