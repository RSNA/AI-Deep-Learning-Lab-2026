// Scoring a map on the canvas (engineering spec, section 6.6, "Scoring a map"). One pure
// function, `evaluate(map, tables)`: Phase 2 calls it with the tables of the pack, and Phase 3
// will call it every month with tables that its events have changed. Everything is an expected
// value, so one map always gets one score. The executable reference is
// `tools/canvas_scoring.py` of the private folder, and the parity vectors hold the engine to it.
import { defaultPrompt, mapShape, overPools, peopleMinutes, preparedBy, rushFactors, type CanvasMap, type CanvasTables, type MapShape } from '@lab02/content-schema'

export type NoteId = 'rushed' | 'private_data' | 'overloaded' | 'distracting' | 'prompt' | 'stray'
export type MissReason = 'missing' | 'weak' | 'decision'
export type Missed = { case: string; reason: MissReason; fact: string | null }

/** What a map takes to run a month. Counted over every placed tile and line, live or stray. */
export type Running = { money: number; minutes: Record<string, number>; complexity: number }

export type Flags = {
  privateData: string[]     // tiles that send private data through a compute that does not protect it
  overloaded: string[]      // live tiles with more lines in than their worker takes freely
  distracting: string[]     // live AI tiles that read a source that distracts
  prompt: string[]          // live tiles whose prompt helps nothing and hurts something
  stray: string[]           // tiles from which the result cannot be reached
  rushed: string[]          // person tiles of a pool that is asked for more minutes than it has and rushes
}

export type Evaluation = {
  accuracy: number                      // 0 to 1
  // The accuracy the same map would reach if its people had the minutes it asks of them. Null
  // when nobody rushes.
  unhurried: number | null
  perCase: Record<string, number>       // the share solved of every case
  running: Running
  flags: Flags
  missed: Missed | null
  note: NoteId | null
}

/** What the prompt of a tile does to its fetching and its judgment, for this kind of worker. */
export function promptEffect(t: CanvasTables, workerId: string, promptId: string | null): { fetch: number; decide: number } {
  const id = promptId || defaultPrompt(t)
  const p = (t.prompts ?? []).find((x) => x.id === id)
  const own = p?.by_worker?.[workerId]
  return { fetch: own?.fetch ?? p?.fetch ?? 1, decide: own?.decide ?? p?.decide ?? 1 }
}

/**
 * What a map takes to run, and which tiles send private data where it is not protected and
 * which reach nothing. Works on any accepted map, ready or not, so the screen can show it
 * while the player builds.
 */
export function running(m: CanvasMap, t: CanvasTables): { running: Running; privateData: string[]; stray: string[]; rushed: string[] } {
  const sources = new Map(t.sources.map((s) => [s.id, s]))
  const workers = new Map(t.workers.map((w) => [w.id, w]))
  const models = new Map((t.models ?? []).map((x) => [x.id, x]))
  const compute = new Map((t.compute ?? []).map((x) => [x.id, x]))
  const tiles = new Map(m.tiles.map((x) => [x.id, x]))
  const srcIn = new Map<string, string[]>([...tiles.keys()].map((id) => [id, []]))
  const wrkIn = new Map<string, string[]>([...tiles.keys()].map((id) => [id, []]))
  let money = 0
  let complexity = 0
  let lines = 0
  let handoffs = 0
  for (const ln of m.lines) {
    lines++
    if (ln.to === t.result.id) continue
    const s = sources.get(ln.from)
    if (s) { srcIn.get(ln.to)!.push(ln.from); money += s.run ?? 0 }
    else { wrkIn.get(ln.to)!.push(ln.from); handoffs++ }
  }
  const tainted = new Map<string, boolean>()
  const usedModels = new Set<string>()
  const usedCompute = new Set<string>()
  const unprotected: string[] = []
  const order = [...tiles.keys()].sort((a, b) => tiles.get(a)!.col - tiles.get(b)!.col || tiles.get(a)!.row - tiles.get(b)!.row)
  for (const n of order) {
    const tile = tiles.get(n)!
    const w = workers.get(tile.kind)!
    money += w.run ?? 0
    complexity += w.complexity ?? 0
    const dirty = srcIn.get(n)!.some((s) => !!sources.get(s)!.private_data) || wrkIn.get(n)!.some((u) => tainted.get(u))
    tainted.set(n, dirty)
    if (w.needs_model && tile.model && tile.runsOn) {
      const model = models.get(tile.model)!
      const comp = compute.get(tile.runsOn)!
      money += (w.calls ?? 1) * (model.run ?? 0) * (comp.price_factor ?? 1)
      usedModels.add(model.id)
      usedCompute.add(comp.id)
      if (dirty && !(comp.protects_private_data ?? true)) unprotected.push(n)
    }
  }
  for (const c of usedCompute) money += compute.get(c)!.run_fixed ?? 0
  complexity += lines + handoffs
  complexity += Math.max(0, usedModels.size - 1) + Math.max(0, usedCompute.size - 1)
  const live = mapShape(m, t).live
  return {
    running: { money, minutes: peopleMinutes(m, t), complexity },
    privateData: unprotected.sort(),
    stray: [...tiles.keys()].filter((id) => !live.has(id)).sort(),
    rushed: overPools(m, t).filter((o) => o.rush).flatMap((o) => o.tiles).sort(),
  }
}

type Solved = {
  A: Map<string, Record<string, number>>      // the facts a tile holds
  D: Map<string, Record<string, number>>      // the share of every case a tile solves
  overloaded: string[]; distracting: string[]; prompt: string[]
}

/**
 * One pass over the live tiles of a ready map. `rush` is the share of the cases each pool of
 * people gets through, and empty when nobody rushes.
 */
function solve(sh: MapShape, t: CanvasTables, rush: Readonly<Record<string, number>>): Solved {
  const sources = new Map(t.sources.map((s) => [s.id, s]))
  const workers = new Map(t.workers.map((w) => [w.id, w]))
  const keep = t.handoff?.keep ?? 1
  const cap = t.quality_cap ?? 1
  const A = new Map<string, Record<string, number>>()
  const D = new Map<string, Record<string, number>>()
  const overloaded: string[] = [], distracting: string[] = [], prompt: string[] = []

  for (const n of sh.order) {
    const tile = sh.tiles.get(n)!
    const w = workers.get(tile.kind)!
    let q: { fetch: Readonly<Record<string, number>>; decide: { plain: number; hard: number }; catch?: number; knows?: Readonly<Record<string, number>> }
    let pf = 1, pd = 1, c = 1
    if (w.needs_model) {
      q = w.by_model![tile.model!]!
      const pe = promptEffect(t, w.id, tile.prompt)
      pf = pe.fetch; pd = pe.decide; c = cap
      if (Math.max(pf, pd) <= 1 && Math.min(pf, pd) < 1) prompt.push(n)
    } else q = w.quality!
    const fetch: Record<string, number> = {}
    for (const [e, x] of Object.entries(q.fetch)) fetch[e] = Math.min(c, x * pf)
    let decide = { plain: Math.min(c, q.decide.plain * pd), hard: Math.min(c, q.decide.hard * pd) }
    let catchQ = q.catch ?? 0
    const knows = q.knows ?? {}

    // Load and distraction act on the judgment and never on a fetch. A tile that prepares hands
    // on its sources, so each of them is one more thing for the worker behind it to keep apart.
    const srcIn = sh.srcIn.get(n)!, wrkIn = sh.wrkIn.get(n)!
    const prepared: { source: string; effort: string; gain: number }[] = []
    let linesIn = srcIn.length
    for (const u of wrkIn) {
      const got = preparedBy(u, sh.tiles, sh.srcIn, sources, workers)
      prepared.push(...got)
      linesIn += Math.max(1, got.length)
    }
    let mult = 1
    if (w.load && linesIn > w.load.free) {
      for (let i = 0; i < linesIn - w.load.free; i++) mult *= w.load.factor
      overloaded.push(n)
    }
    if (w.kind === 'ai') {
      let hit = false
      for (const s of srcIn) {
        const d = sources.get(s)!.distracts ?? 1
        if (d < 1) hit = true
        mult *= d
      }
      if (hit) distracting.push(n)
    }
    decide = { plain: decide.plain * mult, hard: decide.hard * mult }
    catchQ *= mult

    // A person whose pool is asked for more minutes than it has gets through a share of the
    // cases, `hurry`, and does the whole job on those. On the others the tile adds nothing: it
    // passes on the facts and the draft that were handed to it.
    const hurry = w.minutes && w.pool !== undefined ? rush[w.pool] : undefined
    const a: Record<string, number> = {}, aFull: Record<string, number> = {}
    for (const f of t.facts) {
      // what the worker knows without looking anything up
      let best = knows[f.id] ?? 0, passed = 0
      for (const s of srcIn) {
        const src = sources.get(s)!
        const trust = src.gives[f.id]
        if (trust !== undefined) best = Math.max(best, (fetch[src.effort] ?? 0) * trust)
      }
      // A source behind a tile that prepares: read with this worker's own skill, and the
      // preparation closes `gain` of what it would have missed.
      for (const p of prepared) {
        const trust = sources.get(p.source)!.gives[f.id]
        if (trust !== undefined) {
          const own = fetch[p.effort] ?? 0
          best = Math.max(best, (own + (1 - own) * p.gain) * trust)
        }
      }
      for (const u of wrkIn) passed = Math.max(passed, A.get(u)![f.id]! * keep)
      aFull[f.id] = Math.max(best, passed)
      a[f.id] = hurry === undefined ? aFull[f.id]! : hurry * aFull[f.id]! + (1 - hurry) * passed
    }
    A.set(n, a)
    const d: Record<string, number> = {}
    for (const k of t.cases) {
      let have = 1
      for (const f of k.needs) have *= aFull[f]!
      const own = have * decide[k.difficulty]
      let up = 0
      for (const u of wrkIn) up = Math.max(up, D.get(u)![k.id]! * keep)
      const full = Math.max(own, up + (1 - up) * catchQ * own)
      d[k.id] = hurry === undefined ? full : hurry * full + (1 - hurry) * up
    }
    D.set(n, d)
  }
  return { A, D, overloaded, distracting, prompt }
}

/**
 * Score an accepted, ready map. `shownCases` and `shownNotes` are the cases and notes this player
 * has been shown already, so that the next validation shows another when there is one.
 */
export function evaluate(m: CanvasMap, t: CanvasTables, shownCases: readonly string[] = [], shownNotes: readonly string[] = []): Evaluation {
  const sh = mapShape(m, t)
  if (sh.signer === null) throw new Error('evaluate needs a map whose result is reached')
  const rush = rushFactors(m, t)                          // pools asked for more minutes than they have
  const { A, D, overloaded, distracting, prompt } = solve(sh, t, rush)

  const perCase: Record<string, number> = {}
  let total = 0, sum = 0
  for (const k of t.cases) {
    perCase[k.id] = D.get(sh.signer)![k.id]!
    total += k.weight
    sum += k.weight * perCase[k.id]!
  }
  const accuracy = sum / total
  let unhurried: number | null = null
  // The case to show is read from the map as it would work with the time: when people rush, the
  // note says so, and the example names what the map lacks beyond the minutes.
  let seenCase = perCase
  let seenFacts = A.get(sh.signer)!
  if (Object.keys(rush).length) {
    const calm = solve(sh, t, {})
    const calmCase = calm.D.get(sh.signer)!
    let s0 = 0
    for (const k of t.cases) s0 += k.weight * calmCase[k.id]!
    unhurried = s0 / total
    if (t.cases.some((k) => k.weight * (1 - calmCase[k.id]!) > 1e-12)) { seenCase = calmCase; seenFacts = calm.A.get(sh.signer)! }
  }
  const run = running(m, t)

  // The case to show: the largest loss that this player has not been shown, pack order on a tie.
  let missed: Missed | null = null
  const loss = (k: (typeof t.cases)[number]) => k.weight * (1 - seenCase[k.id]!)
  const ranked = [...t.cases].sort((x, y) => loss(y) - loss(x))
  if (ranked.length && loss(ranked[0]!) > 1e-12) {
    const pick = ranked.find((k) => !shownCases.includes(k.id) && loss(k) > 1e-12) ?? ranked[0]!
    const a = seenFacts
    const gone = pick.needs.filter((f) => a[f]! <= 0)
    if (gone.length) missed = { case: pick.id, reason: 'missing', fact: gone[0]! }
    else {
      let have = 1, low = 2, lowF: string | null = null
      for (const f of pick.needs) {
        have *= a[f]!
        if (a[f]! < low) { low = a[f]!; lowF = f }
      }
      const dec = have > 0 ? seenCase[pick.id]! / have : 0
      missed = lowF !== null && low <= dec ? { case: pick.id, reason: 'weak', fact: lowF } : { case: pick.id, reason: 'decision', fact: null }
    }
  }

  const flags: Flags = {
    privateData: run.privateData, overloaded: overloaded.sort(), distracting: distracting.sort(),
    prompt: prompt.sort(), stray: run.stray, rushed: run.rushed,
  }
  const raised: Record<NoteId, boolean> = {
    rushed: flags.rushed.length > 0, private_data: flags.privateData.length > 0, overloaded: flags.overloaded.length > 0,
    distracting: flags.distracting.length > 0, prompt: flags.prompt.length > 0, stray: flags.stray.length > 0,
  }
  const listed = (t.notes ?? []).map((x) => x.id as NoteId).filter((id) => raised[id])
  const note = listed.find((id) => !shownNotes.includes(id)) ?? listed[0] ?? null
  return { accuracy, unhurried, perCase, running: run.running, flags, missed, note }
}
