// Parity on a real pack (engineering spec, section 12.2): random boards made by the rule of
// section 6.5 are scored by the engine and by the reference scorer, which is called with
// `--score`. Runs only with `npm run test:parity`, which needs CONTENT_DIR and SCORER (the path
// of the reference scorer of the private folder). Nothing of the pack is written to disk.
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { loadPack } from '@lab02/content-schema'
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
