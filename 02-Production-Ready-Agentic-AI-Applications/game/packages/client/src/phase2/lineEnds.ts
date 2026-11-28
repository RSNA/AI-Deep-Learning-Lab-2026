// Moving an end of a line (engineering spec, section 10.5, "Lines"): what the board does when a
// handle of the selected line is pressed or dragged, and when a node is clicked while a line is
// selected. The edits themselves are in ../canvas/model.ts.
import type { CanvasMap, LineSide } from '@lab02/protocol'
import type { LineEnd, Mode, Selection } from '../canvas/Grid.tsx'
import { endTargets, isSource, lineKey, moveLineEnd, removeLine, tileOf, type Vocabulary } from '../canvas/model.ts'
import { P2 } from './copy.ts'
import { lineRefusal } from './guide.ts'

type Deps = {
  map: CanvasMap; v: Vocabulary; mode: Mode; sel: Selection
  unlocked: ReadonlySet<string>; lockedBy: Record<string, string>
  nodeLabel: (id: string) => string
  commit: (next: CanvasMap) => void
  refuse: (at: string, text: string) => void
  say: (text: string) => void
  setMode: (m: Mode) => void
  setSel: (s: Selection) => void
}

export function lineEnds(d: Deps) {
  const { map, v, mode, sel } = d
  const line = (key: string) => map.lines.find((l) => lineKey(l) === key)

  /** Move one end to a node, or say at that node why it cannot go there. */
  const move = (key: string, end: LineEnd, node: string, side?: LineSide): void => {
    const l = line(key)
    if (!l) return
    const from = end === 'from' ? node : l.from
    const to = end === 'to' ? node : l.to
    if (node !== (end === 'from' ? l.from : l.to)) {
      if (from === to) { d.refuse(node, P2.refuse.endSelf); return }
      const no = lineRefusal(removeLine(map, key), v, from, to, d.nodeLabel, d.unlocked, d.lockedBy)
      if (no) { d.refuse(no.at, no.text); return }
    }
    const r = moveLineEnd(map, v, key, end, node, side)
    if (!r) { d.refuse(node, P2.refuse.endNotHere); return }
    const replaced = to === v.result.id && l.to !== to && map.lines.some((x) => x.to === to)
    d.commit(r.map)
    if (replaced) d.say(P2.replaced)
    // On another side of the same tile the line stays selected, to be set right further. On
    // another node the move is done: the selection goes, so that the next click on a tile is a
    // plain click again and does not carry the arrow along.
    d.setSel(r.key === key ? { kind: 'line', key } : null)
    d.setMode({ kind: 'idle' })
  }

  /**
   * Which end a click on a node moves while a line is selected and nothing else is going on: a
   * source takes the start, the result and any other tile take the arrow end. A click on a tile
   * the line already stands on moves nothing (it selects that tile, as always).
   */
  const endFor = (key: string, node: string): LineEnd | null => {
    const l = line(key)
    if (!l || node === l.from || node === l.to) return null
    if (isSource(v, node)) return d.unlocked.has(node) ? 'from' : null
    return node === v.result.id || tileOf(map, node) ? 'to' : null
  }

  return {
    /** The nodes to light up while an end looks for its place. */
    targets: mode.kind === 'reattach' ? endTargets(map, v, mode.key, mode.end, d.unlocked) : undefined,
    /** A press on a node. True when it moved an end of a line, or said why it could not. */
    onNode: (id: string, side?: LineSide): boolean => {
      if (mode.kind === 'reattach') { move(mode.key, mode.end, id, side); return true }
      if (mode.kind !== 'idle' || sel?.kind !== 'line') return false
      const end = endFor(sel.key, id)
      if (!end) return false
      move(sel.key, end, id, side)
      return true
    },
    /** A press on a handle picks that end up or puts it back. A drag says which of the two. */
    onPickEnd: (key: string, end: LineEnd, on?: boolean) => {
      const held = mode.kind === 'reattach' && mode.key === key && mode.end === end
      d.setMode(on ?? !held ? { kind: 'reattach', key, end } : { kind: 'idle' })
    },
    /** An end was dragged onto a node. A drop that is refused leaves the line where it was, still selected. */
    onDropEnd: (key: string, end: LineEnd, node: string, side?: LineSide) => {
      d.setMode({ kind: 'idle' })
      move(key, end, node, side)
    },
    hint: mode.kind === 'reattach' ? P2.hint.lineEnd(mode.end) : null,
  }
}
