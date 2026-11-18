// The sorting board as the browser holds it (engineering spec, section 10.4). The server stores
// only which class each problem is in. The browser also keeps which spot of the class it sits
// in, so a swap and a drop on a numbered spot look the way the player made them.
import type { PlanningClass } from '@lab02/protocol'

/** Spots per class, in class_order. A spot holds a problem id or null. */
export type Layout = Record<string, (string | null)[]>

export type Where = { cls: string; spot: number } | null

export function emptyLayout(classes: PlanningClass[]): Layout {
  return Object.fromEntries(classes.map((c) => [c.id, Array<string | null>(c.capacity).fill(null)]))
}

export function picksOf(layout: Layout): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [cls, spots] of Object.entries(layout)) for (const pid of spots) if (pid) out[pid] = cls
  return out
}

export function whereIs(layout: Layout, pid: string): Where {
  for (const [cls, spots] of Object.entries(layout)) {
    const i = spots.indexOf(pid)
    if (i >= 0) return { cls, spot: i }
  }
  return null
}

/**
 * The layout for the picks the server holds. Problems keep the spot they had in `prev` when
 * their class is the same. The others fill the first empty spots of their class in pack order.
 */
export function reconcile(classes: PlanningClass[], problemIds: string[], picks: Record<string, string>, prev: Layout | null): Layout {
  const out = emptyLayout(classes)
  const placed = new Set<string>()
  if (prev) {
    for (const [cls, spots] of Object.entries(prev)) {
      if (!out[cls]) continue
      spots.forEach((pid, i) => {
        if (pid && picks[pid] === cls && i < out[cls]!.length && !placed.has(pid)) { out[cls]![i] = pid; placed.add(pid) }
      })
    }
  }
  for (const pid of problemIds) {
    const cls = picks[pid]
    if (!cls || placed.has(pid) || !out[cls]) continue
    const i = out[cls]!.indexOf(null)
    if (i >= 0) { out[cls]![i] = pid; placed.add(pid) }
  }
  return out
}

function clone(l: Layout): Layout {
  return Object.fromEntries(Object.entries(l).map(([k, v]) => [k, [...v]]))
}

/** Put a problem on a spot. A problem already there takes the place the new one came from. */
export function dropOnSpot(layout: Layout, pid: string, cls: string, spot: number): Layout {
  const out = clone(layout)
  const from = whereIs(out, pid)
  const there = out[cls]![spot] ?? null
  if (from) out[from.cls]![from.spot] = null
  out[cls]![spot] = pid
  if (there && there !== pid) {
    if (from) out[from.cls]![from.spot] = there
    // A problem that came from Unsorted sends the one it replaces back there.
  }
  return out
}

/** Put a problem in a class without naming a spot. Null when the class is full: ask who leaves. */
export function dropInClass(layout: Layout, pid: string, cls: string): Layout | null {
  const from = whereIs(layout, pid)
  if (from?.cls === cls) return layout
  const i = layout[cls]!.indexOf(null)
  if (i < 0) return null
  return dropOnSpot(layout, pid, cls, i)
}

/** The problem `leaving` goes back to Unsorted and `pid` takes its spot. */
export function replaceIn(layout: Layout, pid: string, leaving: string): Layout {
  const at = whereIs(layout, leaving)
  if (!at) return layout
  const out = unsort(layout, leaving)
  const from = whereIs(out, pid)
  if (from) out[from.cls]![from.spot] = null
  out[at.cls]![at.spot] = pid
  return out
}

export function unsort(layout: Layout, pid: string): Layout {
  const out = clone(layout)
  const from = whereIs(out, pid)
  if (from) out[from.cls]![from.spot] = null
  return out
}

export function isFull(layout: Layout, cls: string): boolean {
  return !(layout[cls] ?? []).includes(null)
}

/**
 * What the board asks of the player, in one line, built from the classes. A class is named by
 * the ladder rungs it covers, which are the game's own: none means "not real", rungs up to 2 need
 * no AI, up to 4 one AI model, and rung 5 an agentic system. Two classes that would read alike
 * fall back to their short names.
 */
export function askLine(classes: PlanningClass[], total: number): string {
  const phrase = (c: PlanningClass, n: number) => {
    const one = n === 1
    const max = Math.max(0, ...c.rungs)
    if (c.rungs.length === 0) return one ? 'that is not real' : 'that are not real'
    if (max <= 2) return one ? 'that needs no AI' : 'that need no AI'
    if (max <= 4) return one ? 'that needs one AI model' : 'that need one AI model'
    return one ? 'that needs an agentic system' : 'that need an agentic system'
  }
  const phrases = classes.map((c) => phrase(c, c.capacity))
  const plain = new Set(phrases).size === phrases.length
  const parts = classes.map((c, i) => {
    const what = plain ? phrases[i]! : `for ${c.short}`
    const noun = i === 0 ? (c.capacity === 1 ? ' problem' : ' problems') : ''
    return `the ${c.capacity}${noun} ${what}`
  })
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0] ?? ''
  return total > 0 ? `Find ${list}.` : ''
}
