// The hints on the shape of a map, as the sentences a host reads (engineering spec, section
// 10.8). The engine sends them as data (`mapHints`), and the names come from the legend.
import type { CoachGood, CoachHint } from '@lab02/protocol/host'
import { H } from './hostCopy.ts'

/** The names a hint is written with: tiles as on the board, everything else by its label. */
export type HintWords = {
  tile: (id: string) => string; source: (id: string) => string; worker: (id: string) => string
  model: (id: string) => string; action: (id: string) => string | null
  money: (x: number) => string
  /** The money is that of a bill that was paid, not of the map as it stands. */
  billed: boolean
}

/**
 * The hints on the shape of a map as sentences (section 10.8): what holds the map back, a
 * question for each, and what is good. Hints of one kind about the same agent that decides are
 * said in one line. `sources`: the sources a hint already names, so that the list of losses
 * does not name them again.
 */
export function hintLines(hints: readonly CoachHint[], good: readonly CoachGood[], w: HintWords): { holds: string[]; say: string[]; good: string[]; sources: Set<string> } {
  const T = H.hints
  const holds: string[] = [], say: string[] = []
  const sources = new Set<string>()
  const detours = hints.filter((h) => h.kind === 'through_agent')
  let detourSaid = false
  for (const h of hints) {
    if (h.kind === 'locked_source') {
      sources.add(h.source)
      holds.push(T.lockedSource.holds(w.source(h.source), h.action === null ? null : w.action(h.action)))
      say.push(T.lockedSource.say(w.source(h.source)))
    } else if (h.kind === 'after_required') {
      holds.push(T.afterRequired.holds(w.tile(h.tile), w.tile(h.required)))
      say.push(T.afterRequired.say(w.tile(h.tile), w.tile(h.required)))
    } else if (h.kind === 'through_agent') {
      if (detourSaid) continue
      detourSaid = true
      const same = detours.filter((x) => x.decider === h.decider)
      const names = [...new Set(same.map((x) => w.source(x.source)))]
      for (const x of same) sources.add(x.source)
      holds.push(T.throughAgent.holds(names, [...new Set(same.map((x) => w.tile(x.via)))], w.tile(h.decider), h.lossPercent))
      say.push(T.throughAgent.say(names, w.tile(h.decider)))
    } else if (h.kind === 'reads_whole') {
      holds.push(T.readsWhole.holds(w.tile(h.tile), w.model(h.model), h.sources.map(w.source), h.tokens, w.money(h.money), w.billed))
      say.push(T.readsWhole.say(w.tile(h.tile), w.worker(h.tool), w.source(h.sources[0]!), h.cheapest))
    } else {
      holds.push(T.dearGatherer.holds(w.tile(h.tile), w.model(h.model), w.model(h.cheaper), w.money(h.money)))
      say.push(T.dearGatherer.say(w.tile(h.tile)))
    }
  }
  const well = good.map((g) => (g.kind === 'required_last' ? T.good.requiredLast(w.tile(g.required)) : g.kind === 'decider_direct' ? T.good.deciderDirect(w.tile(g.decider)) : T.good.readsShort))
  return { holds, say, good: well, sources }
}
