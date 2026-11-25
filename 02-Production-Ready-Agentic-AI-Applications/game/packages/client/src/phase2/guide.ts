// What the Phase 2 screen says the player should do next, and why something was refused
// (engineering spec, section 10.5). Validate is never a dead control: while it cannot act, the
// line beside it says the next thing to do and names its tile, and the tile is marked on the map.
// Before the first validation the same line guides through the first map. Every refused placement
// or line gets a sentence at its place. No reason id reaches a screen.
import type { CanvasMap, DevelopmentContent, DevelopmentView } from '@lab02/protocol'
import type { Part } from '../canvas/Grid.tsx'
import { isSource, reaches, tileOf, type Vocabulary } from '../canvas/model.ts'
import { P2 } from './copy.ts'

export type GuideItem = { text: string; nodes: string[]; part?: Part | null }
/** `warn`: the map can be validated, and the player should know this first (people who will rush). */
export type Guide = { first: GuideItem | null; others: number; ready: boolean; warn: GuideItem | null }

const num = (x: number) => (Number.isInteger(x) ? String(x) : x.toLocaleString('en-US', { maximumFractionDigits: 1 }))

/**
 * The reasons Validate cannot act now, in the order a player would fix them: a validation that
 * runs, none left, then the map from its first tile to the minutes of its people.
 */
export function guideOf(dv: DevelopmentView, c: DevelopmentContent, map: CanvasMap, nameOf: (id: string) => string): Guide {
  if (dv.validating) return { first: { text: P2.why.running, nodes: [] }, others: 0, ready: false, warn: null }
  if (dv.validationsLeft <= 0) return { first: { text: P2.why.noneLeft, nodes: [] }, others: 0, ready: false, warn: null }
  const out: GuideItem[] = []
  const open = new Set(dv.unlocked)
  const sources = c.sources.filter((s) => open.has(s.id)).map((s) => s.id)
  const fed = map.lines.some((l) => sources.includes(l.from) && map.tiles.some((t) => t.id === l.to))
  // The first steps come from the draft in the browser, so they follow every click at once.
  if (!map.tiles.length) out.push({ text: P2.why.place, nodes: [] })
  else if (!fed) out.push({ text: P2.why.joinSource, nodes: sources })
  const reaches = map.lines.some((l) => l.to === c.result.id)
  if (!reaches) out.push({ text: P2.why.reachResult, nodes: [c.result.id] })
  for (const d of reaches ? dv.ready.details : []) {
    switch (d.reason) {
      case 'nothing_reaches_result': break
      case 'no_source_connected': {
        const live = map.tiles.filter((t) => !dv.flags.stray.includes(t.id)).map((t) => t.id)
        out.push({ text: P2.why.liveSource, nodes: [...live, ...sources] })
        break
      }
      case 'tile_incomplete': {
        if (!tileOf(map, d.tile)) break
        const name = nameOf(d.tile)
        const both = d.missing.length > 1
        out.push({ text: both ? P2.why.noParts(name) : d.missing[0] === 'model' ? P2.why.noModel(name) : P2.why.noPlace(name), nodes: [d.tile], part: d.missing[0] ?? null })
        break
      }
      case 'required_missing':
        out.push({ text: d.text, nodes: [] })
        break
      case 'too_many_minutes': {
        const pool = c.rules.pools.find((x) => x.id === d.pool)
        const tiles = d.tiles.filter((id) => tileOf(map, id))
        out.push({
          text: tiles.length === 1 ? P2.why.minutesOne(nameOf(tiles[0]!), num(d.used), num(d.max)) : P2.why.minutesPool(pool?.label ?? '', num(d.used), num(d.max)),
          nodes: tiles,
        })
        break
      }
    }
  }
  // People who are asked for more minutes than they have rush. The map can be validated.
  const r = (dv.rushed ?? [])[0]
  let warn: GuideItem | null = null
  if (r) {
    const tiles = r.tiles.filter((id) => tileOf(map, id))
    const pool = c.rules.pools.find((x) => x.id === r.pool)
    warn = { text: tiles.length === 1 ? P2.why.rushOne(nameOf(tiles[0]!), r.used, r.max) : P2.why.rushPool(pool?.label ?? '', r.used, r.max), nodes: tiles }
  }
  return { first: out[0] ?? null, others: Math.max(0, out.length - 1), ready: out.length === 0 && dv.ready.ok, warn }
}

/**
 * Why a line from `from` to `to` cannot be drawn, in a sentence, or null when it can. `at` is
 * where the sentence stands. The rules of the pack (`line_rules`) are the server's: it answers
 * those when the map is sent.
 */
export function lineRefusal(map: CanvasMap, v: Vocabulary, from: string, to: string, nameOf: (id: string) => string, unlocked: ReadonlySet<string>, lockedBy: Record<string, string>): { at: string; text: string } | null {
  if (from === to) return null
  const fromSource = isSource(v, from)
  if (fromSource && !unlocked.has(from)) return { at: from, text: P2.refuse.locked(nameOf(from), lockedBy[from] ?? null) }
  if (isSource(v, to)) return { at: to, text: P2.refuse.intoSource(nameOf(to)) }
  if (to === v.result.id) return fromSource ? { at: to, text: P2.refuse.sourceToResult(nameOf(from)) } : null
  const b = tileOf(map, to)
  if (!b) return null
  if (map.lines.some((l) => l.from === from && l.to === to)) return { at: to, text: P2.refuse.twice(nameOf(from), nameOf(to)) }
  // A line between two tiles may run any way on the map. Only a loop is refused.
  if (tileOf(map, from) && reaches(map, to, from)) return { at: to, text: P2.refuse.loop(nameOf(from), nameOf(to)) }
  return null
}
