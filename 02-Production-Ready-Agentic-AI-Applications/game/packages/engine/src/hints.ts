// What a host can say to a player about the shape of a map (engineering spec, section 10.8).
// One pure function, `mapHints(map, tables, unlocked, reference)`. It looks at the structure of
// a map and never at its score, so it works on a draft that is not ready yet. The result is
// data (ids and numbers): the console writes the sentences. It is for a host only and never
// goes to a player or a screen.
import { lockedItems, mapShape, pickPrepared, preparedBy, type CanvasMap, type CanvasTables } from '@lab02/content-schema'
import { promptEffect, running, type Read } from './canvas.ts'

export type MapHint =
  /** A source that the proposed system reads is still locked for this player. `action` opens it. */
  | { kind: 'locked_source'; source: string; action: string | null }
  /** A tile stands behind the last required worker on the way to the result. */
  | { kind: 'after_required'; tile: string; required: string }
  /** A source that every case needs reaches the agent that decides only through another AI tile. */
  | { kind: 'through_agent'; source: string; via: string; decider: string; lossPercent: number }
  /** A model that costs money reads long sources whole, and an unlocked tool would shorten them. `cheapest`: no model of theirs costs less. */
  | { kind: 'reads_whole'; tile: string; model: string; sources: string[]; tokens: number; money: number; tool: string; cheapest: boolean }
  /** An AI tile that only gathers runs on the dearest model, and a cheaper one fetches as well. */
  | { kind: 'dear_gatherer'; tile: string; model: string; cheaper: string; money: number }

/** What is good about the shape of a map. */
export type MapGood =
  | { kind: 'required_last'; required: string }
  | { kind: 'decider_direct'; decider: string }
  | { kind: 'reads_short' }

export type MapHints = { hints: MapHint[]; good: MapGood[] }

/** A source counts as long from this many reading units on. */
const LONG = 2

/**
 * The hints for one map, in the order a host should bring them up: a locked source, a tile
 * after the required worker, a source every case needs that takes a detour, and what the models
 * read. `unlocked` are the items this player may use. `reference` is the proposed system, or
 * null when the locked sources are not asked about. `reads` are the reads of a bill, per month,
 * when the map has run: without them the reads of the map as it stands are taken.
 */
export function mapHints(
  m: CanvasMap, t: CanvasTables, unlocked: ReadonlySet<string>, reference: CanvasMap | null,
  reads?: Readonly<Record<string, Pick<Read, 'money'>>>,
): MapHints {
  const hints: MapHint[] = []
  const good: MapGood[] = []
  const sources = new Map(t.sources.map((s) => [s.id, s]))
  const workers = new Map(t.workers.map((w) => [w.id, w]))
  const models = new Map((t.models ?? []).map((x) => [x.id, x]))
  const compute = new Map((t.compute ?? []).map((x) => [x.id, x]))
  const sh = mapShape(m, t)
  const tiles = sh.tiles
  const kindOf = (id: string) => workers.get(tiles.get(id)!.kind)
  const isAi = (id: string) => kindOf(id)?.kind === 'ai'

  // 1. A source of the proposed system that is still locked.
  if (reference) {
    const locked = lockedItems(t)
    const inReference = new Set(reference.lines.map((l) => l.from))
    for (const s of t.sources) {
      if (!inReference.has(s.id) || !locked.has(s.id) || unlocked.has(s.id)) continue
      hints.push({ kind: 'locked_source', source: s.id, action: (t.actions ?? []).find((a) => a.unlocks?.includes(s.id))?.id ?? null })
    }
  }

  // Who hands to whom among the live tiles, and everything behind a tile on the way to the result.
  const out = new Map<string, string[]>([...sh.live].map((id) => [id, []]))
  for (const n of sh.live) for (const u of sh.wrkIn.get(n) ?? []) if (sh.live.has(u)) out.get(u)!.push(n)
  const behind = (id: string): Set<string> => {
    const seen = new Set<string>()
    const stack = [...(out.get(id) ?? [])]
    while (stack.length) {
      const x = stack.pop()!
      if (seen.has(x)) continue
      seen.add(x)
      stack.push(...(out.get(x) ?? []))
    }
    return seen
  }
  const before = (id: string): Set<string> => {
    const seen = new Set<string>()
    const stack = [...(sh.wrkIn.get(id) ?? [])]
    while (stack.length) {
      const x = stack.pop()!
      if (seen.has(x) || !sh.live.has(x)) continue
      seen.add(x)
      stack.push(...(sh.wrkIn.get(x) ?? []))
    }
    return seen
  }

  // 2. A tile behind the last required worker.
  const requiredKinds = new Set((t.required ?? []).flatMap((r) => r.workers))
  const isRequired = (id: string) => requiredKinds.has(tiles.get(id)!.kind)
  let lastRequired: string | null = null
  for (const r of sh.order) {
    if (!isRequired(r)) continue
    const after = behind(r)
    if ([...after].some(isRequired)) continue           // another required worker checks later
    lastRequired = r
    for (const x of sh.order) if (after.has(x)) hints.push({ kind: 'after_required', tile: x, required: r })
  }
  if (lastRequired !== null && sh.signer === lastRequired) good.push({ kind: 'required_last', required: lastRequired })

  // What a tile reads itself: its sources on a direct line and those behind tools in front of it.
  const readsItself = (id: string): Set<string> => {
    const got = new Set(sh.srcIn.get(id) ?? [])
    for (const u of sh.wrkIn.get(id) ?? []) for (const p of preparedBy(u, tiles, sh.srcIn, sh.wrkIn, sources, workers)) got.add(p.source)
    return got
  }

  // 3. A source that every case needs and that reaches the agent that decides through another agent.
  const liveAi = sh.order.filter(isAi)
  const decider = liveAi.length ? liveAi[liveAi.length - 1]! : null
  if (decider !== null) {
    const mine = readsItself(decider)
    const upstream = before(decider)
    const always = t.facts.filter((f) => t.cases.length > 0 && t.cases.every((k) => k.needs.includes(f.id)))
    let direct = always.length > 0
    let detour = false
    for (const f of always) {
      const top = Math.max(0, ...t.sources.map((s) => s.gives[f.id] ?? 0))
      const best = t.sources.filter((s) => top > 0 && (s.gives[f.id] ?? 0) >= top - 1e-9)
      if (best.some((s) => mine.has(s.id))) continue
      direct = false
      for (const s of best) {
        const via = sh.order.find((a) => a !== decider && isAi(a) && upstream.has(a) && readsItself(a).has(s.id))
        if (via === undefined) continue
        hints.push({ kind: 'through_agent', source: s.id, via, decider, lossPercent: Math.round(1000 * (1 - (t.handoff?.keep ?? 1))) / 10 })
        detour = true
      }
    }
    if (direct && !detour && liveAi.length >= 2) good.push({ kind: 'decider_direct', decider })
  }

  // 4. What the models read. Only in a pack that prices a model by what it reads.
  if (t.reading) {
    const size = new Map((t.efforts ?? []).map((e) => [e.id, e.size ?? 0]))
    const perUnit = t.reading.tokens_per_unit ?? 1000
    const paid = reads ?? running(m, t).running.reads ?? {}
    const cap = t.quality_cap ?? 1
    const price = (model: string, place: string | null) => (models.get(model)?.run ?? 0) * ((place === null ? undefined : compute.get(place)?.price_factor) ?? 1)
    // The price of a model for this player: where the tile runs when the model runs there, else
    // at the cheapest unlocked place that carries it. Null: no unlocked place carries it.
    const priceFor = (model: string, place: string | null): number | null => {
      const mo = models.get(model)
      if (!mo) return null
      if (place !== null && mo.runs_on.includes(place)) return price(model, place)
      const at = mo.runs_on.filter((c) => unlocked.has(c)).map((c) => price(model, c))
      return at.length ? Math.min(...at) : null
    }
    const usable = [...models.keys()].filter((id) => unlocked.has(id))
    let longReads = 0, longWhole = 0
    let dear = false
    for (const n of [...tiles.keys()].sort((a, b) => sh.order.indexOf(a) - sh.order.indexOf(b) || a.localeCompare(b))) {
      const tile = tiles.get(n)!
      const w = kindOf(n)
      if (!w?.needs_model || !tile.model || !tile.runsOn) continue
      const own = price(tile.model, tile.runsOn)
      const cheapest = Math.min(own, ...usable.map((id) => priceFor(id, tile.runsOn)).filter((x): x is number => x !== null))
      const frugal = own <= cheapest + 1e-9
      // (a) long sources read whole on a direct line
      const whole = (sh.srcIn.get(n) ?? []).filter((s) => (size.get(sources.get(s)!.effort) ?? 0) >= LONG - 1e-9)
      // A source that distracts is flagged as such: a tool in front of it is not the advice.
      const worth = whole.filter((s) => (sources.get(s)!.distracts ?? 1) >= 1)
      // long sources read behind a tool, as the kind this reader takes of them
      const pf = promptEffect(t, w.id, tile.prompt).fetch
      const fetch: Record<string, number> = {}
      for (const [e, x] of Object.entries(w.by_model?.[tile.model]?.fetch ?? {})) fetch[e] = Math.min(cap, x * pf)
      const efforts = new Set((sh.srcIn.get(n) ?? []).map((s) => sources.get(s)!.effort))
      for (const u of sh.wrkIn.get(n) ?? []) {
        for (const p of preparedBy(u, tiles, sh.srcIn, sh.wrkIn, sources, workers)) {
          const raw = sources.get(p.source)!.effort
          const took = pickPrepared(p.candidates, fetch).effort
          efforts.add(took)
          if ((size.get(raw) ?? 0) < LONG - 1e-9) continue
          longReads++
          if ((size.get(took) ?? 0) >= (size.get(raw) ?? 0) - 1e-9 && !frugal) longWhole++
        }
      }
      longReads += whole.length
      if (whole.length && !frugal) longWhole += whole.length
      if (own > 0 && worth.length) {
        // The longest first, and among equals in the order of the pack. For each, the unlocked
        // tool that makes it shortest: one that costs nothing to run before one that does.
        const at = (s: string) => t.sources.findIndex((x) => x.id === s)
        const bySize = [...worth].sort((a, b) => (size.get(sources.get(b)!.effort) ?? 0) - (size.get(sources.get(a)!.effort) ?? 0) || at(a) - at(b))
        const shortened: { source: string; tool: string; to: number }[] = []
        for (const s of bySize) {
          const effort = sources.get(s)!.effort
          let pick: { tool: string; to: number; free: boolean } | null = null
          for (const tool of t.workers) {
            const as = tool.prepares?.[effort]?.as
            if (as === undefined || !unlocked.has(tool.id)) continue
            const to = size.get(as) ?? 0
            if (to >= (size.get(effort) ?? 0) - 1e-9) continue
            const free = (tool.run ?? 0) <= 0
            if (pick === null || (free && !pick.free) || (free === pick.free && to < pick.to - 1e-9)) pick = { tool: tool.id, to, free }
          }
          if (pick) shortened.push({ source: s, tool: pick.tool, to: pick.to })
        }
        if (shortened.length) {
          hints.push({
            kind: 'reads_whole', tile: n, model: tile.model, sources: shortened.map((x) => x.source),
            tokens: Math.round(perUnit * shortened.reduce((sum, x) => sum + (size.get(sources.get(x.source)!.effort) ?? 0), 0)),
            money: paid[n]?.money ?? 0, tool: shortened[0]!.tool, cheapest: frugal,
          })
        }
      }
      // (b) a tile that only gathers on the dearest model
      if (own > 0 && sh.live.has(n) && [...behind(n)].some(isAi)) {
        const dearest = usable.every((id) => (priceFor(id, tile.runsOn) ?? 0) <= own + 1e-9)
        const mineQ = w.by_model?.[tile.model]?.fetch ?? {}
        let pick: { id: string; at: number } | null = null
        for (const id of usable) {
          if (id === tile.model) continue
          const at = priceFor(id, tile.runsOn)
          const q = w.by_model?.[id]?.fetch
          if (at === null || !q || at >= own - 1e-9) continue
          if (![...efforts].every((e) => (q[e] ?? 0) >= (mineQ[e] ?? 0) - 1e-9)) continue
          if (pick === null || at < pick.at - 1e-9) pick = { id, at }
        }
        if (dearest && pick) {
          hints.push({ kind: 'dear_gatherer', tile: n, model: tile.model, cheaper: pick.id, money: paid[n]?.money ?? 0 })
          dear = true
        }
      }
    }
    if (longReads > 0 && longWhole === 0 && !dear && !hints.some((h) => h.kind === 'reads_whole')) good.push({ kind: 'reads_short' })
  }
  return { hints, good }
}

/** The hints with those about cost first: for a player whose bill is the trouble. */
export function costFirst(h: MapHints): MapHints {
  const cost = (x: MapHint) => x.kind === 'reads_whole' || x.kind === 'dear_gatherer'
  return { hints: [...h.hints.filter(cost), ...h.hints.filter((x) => !cost(x))], good: h.good }
}
