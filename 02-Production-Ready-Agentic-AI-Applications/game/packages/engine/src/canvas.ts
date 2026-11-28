// Scoring a map on the canvas (engineering spec, section 6.6, "Scoring a map"). One pure
// function, `evaluate(map, tables)`: Phase 2 calls it with the tables of the pack, and Phase 3
// will call it every month with tables that its events have changed. Everything is an expected
// value, so one map always gets one score. The executable reference is
// `tools/canvas_scoring.py` of the private folder, and the parity vectors hold the engine to it.
import { defaultPrompt, handoffOrder, mapShape, overPools, peopleMinutes, pickPrepared, preparedBy, readingUnits, rushFactors, type CanvasMap, type CanvasTables, type MapShape } from '@lab02/content-schema'

export type NoteId = 'rushed' | 'private_data' | 'overloaded' | 'distracting' | 'prompt' | 'stray'
export type MissReason = 'missing' | 'weak' | 'decision'
export type Missed = { case: string; reason: MissReason; fact: string | null }

/**
 * What the model of one tile reads for a case, in reading units, and what that costs a month.
 * Only in a pack that prices a model by what it reads (`reading`).
 */
export type Read = { units: number; money: number; model: string; place: string }

/**
 * What a map takes to run a month. Counted over every placed tile and line, live or stray.
 * `reads`: every tile with a model, when the pack prices a model by what it reads. Absent in a
 * state that was stored before the rule.
 */
export type Running = { money: number; minutes: Record<string, number>; complexity: number; reads?: Record<string, Read> }

export type Flags = {
  privateData: string[]     // tiles that send private data through a compute that does not protect it
  overloaded: string[]      // live tiles with more lines in than their worker takes freely
  distracting: string[]     // live AI tiles that read a source that distracts
  prompt: string[]          // live tiles whose prompt helps nothing and hurts something
  stray: string[]           // tiles from which the result cannot be reached
  rushed: string[]          // person tiles of a pool that is asked for more minutes than it has and rushes
}

/** Why the map loses cases of some kinds, added up over the kinds with the same reason. */
export type Loss = { reason: MissReason; fact: string | null; lost: number; kinds: number }

/**
 * One line of what a map costs to run a month: the calls of the models at a place, the fixed
 * cost of a place, the tiles of one kind, or a source. `count`: the tiles of that kind.
 */
export type BillLine = { kind: 'calls' | 'place' | 'worker' | 'source' | 'action' | 'fine'; id: string; count: number; money: number }

export type Evaluation = {
  accuracy: number                      // 0 to 1
  // The accuracy the same map would reach if its people had the minutes it asks of them. Null
  // when nobody rushes.
  unhurried: number | null
  perCase: Record<string, number>       // the share solved of every case
  running: Running
  /** What makes up `running.money`, a line for everything that costs something. */
  bill: BillLine[]
  flags: Flags
  missed: Missed | null
  note: NoteId | null
  // Every kind of case the map does not solve in full, by reason, the largest loss first: the
  // weight that is lost and the number of kinds. For a host who helps a player, never for the player.
  losses: Loss[]
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
export function running(m: CanvasMap, t: CanvasTables): { running: Running; bill: BillLine[]; privateData: string[]; stray: string[]; rushed: string[] } {
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
  // A source in use is paid once, however many lines leave it.
  const paidSources: string[] = []
  for (const ln of m.lines) {
    lines++
    if (ln.to === t.result.id) continue
    const s = sources.get(ln.from)
    if (s) {
      srcIn.get(ln.to)!.push(ln.from)
      if (!paidSources.includes(s.id)) { paidSources.push(s.id); money += s.run ?? 0 }
    } else { wrkIn.get(ln.to)!.push(ln.from); handoffs++ }
  }
  const tainted = new Map<string, boolean>()
  const usedModels = new Set<string>()
  const usedCompute = new Set<string>()
  const kindTiles = new Map<string, number>()
  const callsAt = new Map<string, number>()
  const reads: Record<string, Read> = {}
  const cap = t.quality_cap ?? 1
  const unprotected: string[] = []
  // Private data travels along the lines, so the tiles are walked in the order of the handoffs.
  const pairs: [string, string][] = []
  for (const [n, from] of wrkIn) for (const u of from) pairs.push([u, n])
  const order = handoffOrder(tiles, pairs) ?? [...tiles.keys()]
  for (const n of order) {
    const tile = tiles.get(n)!
    const w = workers.get(tile.kind)!
    money += w.run ?? 0
    kindTiles.set(w.id, (kindTiles.get(w.id) ?? 0) + 1)
    complexity += w.complexity ?? 0
    const dirty = srcIn.get(n)!.some((s) => !!sources.get(s)!.private_data) || wrkIn.get(n)!.some((u) => tainted.get(u))
    tainted.set(n, dirty)
    if (w.needs_model && tile.model && tile.runsOn) {
      const model = models.get(tile.model)!
      const comp = compute.get(tile.runsOn)!
      // The price of a model is per reading unit when the pack has `reading`, and per call
      // (`calls` of the worker) when it has none. The reader takes a source behind a row of
      // tools as the kind it fetches best, with the numbers of its own model and prompt.
      let units: number | null = null
      if (t.reading) {
        const pf = promptEffect(t, w.id, tile.prompt).fetch
        const fetch: Record<string, number> = {}
        for (const [e, x] of Object.entries(w.by_model?.[tile.model]?.fetch ?? {})) fetch[e] = Math.min(cap, x * pf)
        units = readingUnits(n, t, tiles, srcIn, wrkIn, sources, workers, fetch)
      }
      const calls = (units ?? w.calls ?? 1) * (model.run ?? 0) * (comp.price_factor ?? 1)
      if (units !== null) reads[n] = { units, money: calls, model: model.id, place: comp.id }
      money += calls
      usedModels.add(model.id)
      usedCompute.add(comp.id)
      callsAt.set(comp.id, (callsAt.get(comp.id) ?? 0) + calls)
      if (dirty && !(comp.protects_private_data ?? true)) unprotected.push(n)
    }
  }
  const bill: BillLine[] = []
  for (const c of usedCompute) {
    const fixed = compute.get(c)!.run_fixed ?? 0
    money += fixed
    bill.push({ kind: 'calls', id: c, count: 1, money: callsAt.get(c) ?? 0 }, { kind: 'place', id: c, count: 1, money: fixed })
  }
  for (const [kind, count] of kindTiles) bill.push({ kind: 'worker', id: kind, count, money: count * (workers.get(kind)!.run ?? 0) })
  for (const s of paidSources) bill.push({ kind: 'source', id: s, count: 1, money: sources.get(s)!.run ?? 0 })
  complexity += lines + handoffs
  complexity += Math.max(0, usedModels.size - 1) + Math.max(0, usedCompute.size - 1)
  const live = mapShape(m, t).live
  return {
    running: { money, minutes: peopleMinutes(m, t), complexity, reads },
    bill: bill.filter((b) => b.money > 0),
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
    const prepared: { source: string; effort: string; load: number }[] = []
    let linesIn = srcIn.length
    for (const u of wrkIn) {
      // Behind a row of tools the worker takes each source once, as the kind it reads best.
      const got = preparedBy(u, sh.tiles, sh.srcIn, sh.wrkIn, sources, workers).map((p) => ({ source: p.source, ...pickPrepared(p.candidates, fetch) }))
      prepared.push(...got)
      linesIn += got.length ? got.reduce((sum, x) => sum + x.load, 0) : 1
    }
    let mult = 1
    if (w.load && linesIn > w.load.free + 1e-9) {
      mult = Math.pow(w.load.factor, linesIn - w.load.free)
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
      // A source behind a tile that prepares: this worker reads it itself, as the kind of effort
      // the tool makes of it, and nothing is lost at a handoff.
      for (const p of prepared) {
        const trust = sources.get(p.source)!.gives[f.id]
        if (trust !== undefined) best = Math.max(best, (fetch[p.effort] ?? 0) * trust)
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

  // Why a case is lost, read at the signer: a needed fact that never arrived, the weakest fact
  // that did, or the judgment.
  const whyLost = (k: (typeof t.cases)[number]): { reason: MissReason; fact: string | null } => {
    const a = seenFacts
    const gone = k.needs.filter((f) => a[f]! <= 0)
    if (gone.length) return { reason: 'missing', fact: gone[0]! }
    let have = 1, low = 2, lowF: string | null = null
    for (const f of k.needs) {
      have *= a[f]!
      if (a[f]! < low) { low = a[f]!; lowF = f }
    }
    const dec = have > 0 ? seenCase[k.id]! / have : 0
    return lowF !== null && low <= dec ? { reason: 'weak', fact: lowF } : { reason: 'decision', fact: null }
  }
  // The case to show: the largest loss that this player has not been shown, pack order on a tie.
  let missed: Missed | null = null
  const loss = (k: (typeof t.cases)[number]) => k.weight * (1 - seenCase[k.id]!)
  const ranked = [...t.cases].sort((x, y) => loss(y) - loss(x))
  if (ranked.length && loss(ranked[0]!) > 1e-12) {
    const pick = ranked.find((k) => !shownCases.includes(k.id) && loss(k) > 1e-12) ?? ranked[0]!
    missed = { case: pick.id, ...whyLost(pick) }
  }
  // Every loss by its reason, for the host's view of a player.
  const byReason = new Map<string, Loss>()
  for (const k of t.cases) {
    if (loss(k) <= 1e-12) continue
    const w = whyLost(k)
    const key = `${w.reason}:${w.fact ?? ''}`
    const row = byReason.get(key) ?? { reason: w.reason, fact: w.fact, lost: 0, kinds: 0 }
    row.lost += loss(k)
    row.kinds += 1
    byReason.set(key, row)
  }
  const losses = [...byReason.values()].sort((x, y) => y.lost - x.lost)

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
  return { accuracy, unhurried, perCase, running: run.running, bill: run.bill, flags, missed, note, losses }
}

/** Who reads a source best among the tools and AI workers of a pack, with or without a tool in front. */
export type BestReader = { worker: string; model: string | null; via: string | null; quality: number }

/**
 * For every source: the worker that brings back the most of what the source holds, the model it
 * carries for that, and the tool that prepares the source for it, if one helps. A tool or an AI
 * worker is named when one reads the source well (0.85 or more), because people have few
 * minutes. Otherwise the best of all workers is named, a person included: some sources answer
 * only to a person. For a host who helps a player. Null for a source that nobody reads.
 */
export function bestReaders(t: CanvasTables): Record<string, BestReader | null> {
  const out: Record<string, BestReader | null> = {}
  const preps = t.workers.filter((w) => w.prepares)
  for (const s of t.sources) {
    const trust = Math.max(0, ...Object.values(s.gives))
    const ways: { via: string | null; effort: string }[] = [{ via: null, effort: s.effort }]
    for (const p of preps) {
      const as = p.prepares![s.effort]?.as
      if (as !== undefined && as !== s.effort) ways.push({ via: p.id, effort: as })
    }
    let best: BestReader | null = null, person: BestReader | null = null
    for (const w of t.workers) {
      if (w.prepares) continue
      const tables: [string | null, Readonly<Record<string, number>>][] = w.needs_model
        ? Object.entries(w.by_model ?? {}).map(([m, q]) => [m, q.fetch])
        : w.quality ? [[null, w.quality.fetch]] : []
      for (const [model, fetch] of tables) for (const way of ways) {
        const quality = (fetch[way.effort] ?? 0) * trust
        if (w.kind === 'person') { if (quality > (person?.quality ?? 0) + 1e-9) person = { worker: w.id, model, via: way.via, quality } }
        else if (quality > (best?.quality ?? 0) + 1e-9) best = { worker: w.id, model, via: way.via, quality }
      }
    }
    out[s.id] = best && best.quality >= 0.85 - 1e-9 ? best : person && person.quality > (best?.quality ?? 0) ? person : best
  }
  return out
}
