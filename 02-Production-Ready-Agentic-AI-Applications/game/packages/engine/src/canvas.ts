// Scoring a map on the canvas (engineering spec, section 6.6, "Scoring a map"). One pure
// function, `evaluate(map, tables)`: Phase 2 calls it with the tables of the pack, and Phase 3
// will call it every month with tables that its events have changed. Everything is an expected
// value, so one map always gets one score. The executable reference is
// `tools/canvas_scoring.py` of the private folder, and the parity vectors hold the engine to it.
import { defaultPrompt, mapShape, peopleMinutes, type CanvasMap, type CanvasTables } from '@lab02/content-schema'

export type NoteId = 'private_data' | 'overloaded' | 'distracting' | 'prompt' | 'stray'
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
}

export type Evaluation = {
  accuracy: number                      // 0 to 1
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
export function running(m: CanvasMap, t: CanvasTables): { running: Running; privateData: string[]; stray: string[] } {
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
  }
}

/**
 * Score an accepted, ready map. `shownCases` and `shownNotes` are the cases and notes this player
 * has been shown already, so that the next validation shows another when there is one.
 */
export function evaluate(m: CanvasMap, t: CanvasTables, shownCases: readonly string[] = [], shownNotes: readonly string[] = []): Evaluation {
  const sh = mapShape(m, t)
  if (sh.signer === null) throw new Error('evaluate needs a map whose result is reached')
  const sources = new Map(t.sources.map((s) => [s.id, s]))
  const workers = new Map(t.workers.map((w) => [w.id, w]))
  const keep = t.handoff?.keep ?? 1
  const cap = t.quality_cap ?? 1
  const A = new Map<string, Record<string, number>>()     // facts a tile holds
  const D = new Map<string, Record<string, number>>()     // cases a tile solves
  const overloaded: string[] = [], distracting: string[] = [], prompt: string[] = []

  for (const n of sh.order) {
    const tile = sh.tiles.get(n)!
    const w = workers.get(tile.kind)!
    let q: { fetch: { easy: number; hard: number }; decide: { plain: number; hard: number }; catch?: number }
    let pf = 1, pd = 1, c = 1
    if (w.needs_model) {
      q = w.by_model![tile.model!]!
      const pe = promptEffect(t, w.id, tile.prompt)
      pf = pe.fetch; pd = pe.decide; c = cap
      if (Math.max(pf, pd) <= 1 && Math.min(pf, pd) < 1) prompt.push(n)
    } else q = w.quality!
    const fetch = { easy: Math.min(c, q.fetch.easy * pf), hard: Math.min(c, q.fetch.hard * pf) }
    let decide = { plain: Math.min(c, q.decide.plain * pd), hard: Math.min(c, q.decide.hard * pd) }
    let catchQ = q.catch ?? 0

    // Load and distraction act on the judgment and never on a fetch.
    const srcIn = sh.srcIn.get(n)!, wrkIn = sh.wrkIn.get(n)!
    const linesIn = srcIn.length + wrkIn.length
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

    const a: Record<string, number> = {}
    for (const f of t.facts) {
      let best = 0
      for (const s of srcIn) {
        const src = sources.get(s)!
        const trust = src.gives[f.id]
        if (trust !== undefined) best = Math.max(best, fetch[src.effort] * trust)
      }
      for (const u of wrkIn) best = Math.max(best, A.get(u)![f.id]! * keep)
      a[f.id] = best
    }
    A.set(n, a)
    const d: Record<string, number> = {}
    for (const k of t.cases) {
      let have = 1
      for (const f of k.needs) have *= a[f]!
      const own = have * decide[k.difficulty]
      let up = 0
      for (const u of wrkIn) up = Math.max(up, D.get(u)![k.id]! * keep)
      d[k.id] = Math.max(own, up + (1 - up) * catchQ * own)
    }
    D.set(n, d)
  }

  const perCase: Record<string, number> = {}
  let total = 0, sum = 0
  for (const k of t.cases) {
    perCase[k.id] = D.get(sh.signer)![k.id]!
    total += k.weight
    sum += k.weight * perCase[k.id]!
  }
  const accuracy = sum / total
  const run = running(m, t)

  // The case to show: the largest loss that this player has not been shown, pack order on a tie.
  let missed: Missed | null = null
  const loss = (k: (typeof t.cases)[number]) => k.weight * (1 - perCase[k.id]!)
  const ranked = [...t.cases].sort((x, y) => loss(y) - loss(x))
  if (ranked.length && loss(ranked[0]!) > 1e-12) {
    const pick = ranked.find((k) => !shownCases.includes(k.id) && loss(k) > 1e-12) ?? ranked[0]!
    const a = A.get(sh.signer)!
    const gone = pick.needs.filter((f) => a[f]! <= 0)
    if (gone.length) missed = { case: pick.id, reason: 'missing', fact: gone[0]! }
    else {
      let have = 1, low = 2, lowF: string | null = null
      for (const f of pick.needs) {
        have *= a[f]!
        if (a[f]! < low) { low = a[f]!; lowF = f }
      }
      const dec = have > 0 ? perCase[pick.id]! / have : 0
      missed = lowF !== null && low <= dec ? { case: pick.id, reason: 'weak', fact: lowF } : { case: pick.id, reason: 'decision', fact: null }
    }
  }

  const flags: Flags = {
    privateData: run.privateData, overloaded: overloaded.sort(), distracting: distracting.sort(),
    prompt: prompt.sort(), stray: run.stray,
  }
  const raised: Record<NoteId, boolean> = {
    private_data: flags.privateData.length > 0, overloaded: flags.overloaded.length > 0,
    distracting: flags.distracting.length > 0, prompt: flags.prompt.length > 0, stray: flags.stray.length > 0,
  }
  const listed = (t.notes ?? []).map((x) => x.id as NoteId).filter((id) => raised[id])
  const note = listed.find((id) => !shownNotes.includes(id)) ?? listed[0] ?? null
  return { accuracy, perCase, running: run.running, flags, missed, note }
}
