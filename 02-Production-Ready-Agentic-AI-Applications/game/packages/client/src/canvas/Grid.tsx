// The canvas (engineering spec, section 10.5): sources on the left, a grid of cells, the result on
// the right, and lines that run any way between the tiles but never in a loop. A line leaves and
// enters a tile on the side the player picked (any of the four), and where none was picked it
// joins the sides that face each other. It draws any map, editable or read-only, and knows
// nothing of the phase that shows it. Every action works by click or tap; drag is an extra on a
// laptop.
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { CanvasLegend, CanvasLine, CanvasMap, CanvasTile, LineSide } from '@lab02/protocol'
import { Icon } from './icons.tsx'
import { lineKey, tileNames, type Vocabulary } from './model.ts'
import { popHandlers, usePop, type PopInfo } from './Pop.tsx'

/** One color per origin of lines, so that six crossing lines can be told apart. */
export const LINE_COLORS = ['#2f7bf5', '#f0742a', '#1fa971', '#b44fd6', '#e0434f', '#0f9fb0', '#b8860b', '#5b5ff0', '#d1478f', '#5f8f1f']

export type Mode =
  | { kind: 'idle' }
  | { kind: 'place'; worker: string }
  | { kind: 'move'; tile: string }
  | { kind: 'join'; from: string; side?: LineSide }
export type Selection = { kind: 'tile'; id: string } | { kind: 'line'; key: string } | null
export type Part = 'model' | 'runsOn' | 'prompt'

export type GridFlags = { stray: string[]; incomplete: string[]; privateData: string[] }

export type GridProps = {
  v: Vocabulary | CanvasLegend
  map: CanvasMap
  flags?: GridFlags
  /** Small drawing for a card, the host or the reveal. Read-only. */
  compact?: boolean
  readOnly?: boolean
  label?: string
  unlocked?: ReadonlySet<string>
  /** The action that opens a locked item, by item id. */
  lockedBy?: Record<string, string>
  mode?: Mode
  selection?: Selection
  /** Tiles and the result that a line from the node in `mode.join` may reach. */
  targets?: ReadonlySet<string>
  onCell?: (col: number, row: number) => void
  /** A press on a node. `side` is the side of a tile whose dot was pressed to end a line there. */
  onNode?: (id: string, side?: LineSide) => void
  /** A press on a dot that starts a line. `side` is the side of the tile it stands on. */
  onPort?: (id: string, side?: LineSide) => void
  onLine?: (key: string) => void
  /** A dot of an end tile of the selected line was pressed: that end moves to this side. */
  onMoveEnd?: (key: string, end: 'from' | 'to', side: LineSide) => void
  onPart?: (tile: string, part: Part) => void
  onDropKind?: (kind: string, col: number, row: number) => void
  onDropTile?: (id: string, col: number, row: number) => void
  onDragLine?: (from: string, to: string, sides?: { from?: LineSide; to?: LineSide }) => void
  /** What a tile without boxes of parts shows in their place: a person's minutes, a tool's task. */
  bodies?: Record<string, { text: string; over?: boolean }>
  /** The tiles (or the result, or the sources) and the box of a tile that the next thing to do is about. */
  guide?: { nodes: string[]; part?: Part | null } | null
  /** A sentence at the place of an action: a refusal, or advice on a line. `at` is a node id or `line:<key>`. */
  note?: { at: string; text: string; tone: 'refuse' | 'advice' } | null
  onNoteClose?: () => void
  /** Lines that come with advice, by line key. A mark on the line says it again. */
  advice?: ReadonlySet<string>
  onAdvice?: (key: string) => void
  /** What the card beside a source or the result says while it is pointed at. */
  popOf?: (id: string) => PopInfo | null
  /** A press on a source or the result that starts nothing else: a phone shows its card then. */
  onAbout?: (id: string) => void
  words: GridWords
}

export type GridWords = {
  sources: string; result: string; col: (n: number) => string
  pickModel: string; pickCompute: string; defaultPrompt: (label: string) => string
  locked: (action: string) => string; lockedNoAction: string; lockedShort: string
  stray: string; strayShort: string; privateData: string; incomplete: string
  emptyCell: (col: number, row: number) => string; placeHere: string; moveHere: string
  port: (label: string) => string; joinHere: (label: string) => string
  line: (from: string, to: string) => string
  model: string; compute: string; prompt: string
  advice: string; close: string
}

type Box = { x: number; y: number; w: number; h: number }

const Mark = ({ children, title, tone }: { children: ReactNode; title: string; tone: 'warn' | 'lock' | 'stray' }) => (
  <span className={`cmark ${tone}`} title={title} role="img" aria-label={title}>{children}</span>
)

export function Grid(p: GridProps) {
  const { v, map, compact = false, readOnly = !!compact, words } = p
  const pop = usePop()
  const box = useRef<HTMLDivElement>(null)
  const nodes = useRef(new Map<string, HTMLElement>())
  const [boxes, setBoxes] = useState<Record<string, Box>>({})
  const [drag, setDrag] = useState<{ from: string; side?: LineSide; x: number; y: number } | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const [hintCol, setHintCol] = useState<number | null>(null)
  // A sentence at the place of an action is brought into view, also where the grid scrolls sideways.
  const noteEl = useRef<HTMLDivElement>(null)
  const noteKey = p.note ? `${p.note.at}|${p.note.text}` : ''
  useLayoutEffect(() => { if (noteKey) noteEl.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' }) }, [noteKey])
  useLayoutEffect(() => {
    if (hintCol === null) return
    const id = setTimeout(() => setHintCol(null), 6000)
    return () => clearTimeout(id)
  }, [hintCol])
  // A press on a port starts a line, never the native drag of the tile around it.
  const onPort = useRef(false)
  const flags = p.flags ?? { stray: [], incomplete: [], privateData: [] }
  const mode = p.mode ?? { kind: 'idle' }
  const unlocked = p.unlocked
  const locked = (id: string) => !!unlocked && !unlocked.has(id)

  const setNode = useCallback((id: string) => (el: HTMLElement | null) => {
    if (el) nodes.current.set(id, el)
    else nodes.current.delete(id)
  }, [])

  // Measure where every node stands, so the lines can be drawn between them. Offsets, not screen
  // rectangles: the projector and the console's preview scale the whole page with a transform.
  const measure = useCallback(() => {
    const root = box.current
    if (!root) return
    const next: Record<string, Box> = {}
    for (const [id, el] of nodes.current) {
      let x = 0, y = 0
      let at: HTMLElement | null = el
      while (at && at !== root) { x += at.offsetLeft; y += at.offsetTop; at = at.offsetParent as HTMLElement | null }
      if (at !== root) continue
      next[id] = { x, y, w: el.offsetWidth, h: el.offsetHeight }
    }
    setBoxes((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
  }, [])
  useLayoutEffect(() => { measure() })
  useLayoutEffect(() => {
    const root = box.current
    if (!root) return
    const ro = new ResizeObserver(() => measure())
    ro.observe(root)
    return () => ro.disconnect()
  }, [measure])

  // Colors: one per origin, sources first in pack order, then tiles by column and row.
  const origins = [...v.sources.map((s) => s.id), ...[...map.tiles].sort((a, b) => a.col - b.col || a.row - b.row).map((t) => t.id)]
  const colorOf = (id: string) => LINE_COLORS[Math.max(0, origins.indexOf(id)) % LINE_COLORS.length]!
  const used = new Set(map.lines.map((l) => l.from))

  // Where a line is attached. From a source it leaves the right side, into the result it enters
  // the left side. At a tile it stands on the side the player picked for that end (`fromSide`,
  // `toSide`). An end without a pick takes the side that faces the other tile: to a later column
  // out of the right side and into the left, to an earlier column out of the left and into the
  // right, inside one column out of the bottom and into the top (or the other way up). When two
  // tiles differ in column and row, the column decides, and the line bends in the gap between
  // the columns. So a line travels around a tile only when the player asked for that side.
  type P = { x: number; y: number }
  type Side = 'l' | 'r' | 't' | 'b'
  const SHORT: Record<LineSide, Side> = { left: 'l', right: 'r', top: 't', bottom: 'b' }
  const LONG: Record<Side, LineSide> = { l: 'left', r: 'right', t: 'top', b: 'bottom' }
  const sourceIds = new Set(v.sources.map((x) => x.id))
  const cellOf = new Map(map.tiles.map((t) => [t.id, t]))
  const facing = (l: { from: string; to: string }): [Side, Side] => {
    const a = cellOf.get(l.from), b = cellOf.get(l.to)
    if (!a || !b || b.col > a.col) return ['r', 'l']
    if (b.col < a.col) return ['l', 'r']
    return b.row > a.row ? ['b', 't'] : ['t', 'b']
  }
  const sidesOf = (l: CanvasLine): [Side, Side] => {
    const [fa, fb] = facing(l)
    return [l.fromSide && cellOf.has(l.from) ? SHORT[l.fromSide] : fa, l.toSide && cellOf.has(l.to) ? SHORT[l.toSide] : fb]
  }
  const center = (id: string): P => { const b = boxes[id]; return b ? { x: b.x + b.w / 2, y: b.y + b.h / 2 } : { x: 0, y: 0 } }
  // The ends of the lines on one side of a node are spread along that side, in the order of
  // where their other ends stand, so that they neither lie on top of each other nor cross on
  // the way in or out. Lines that leave and lines that arrive on one side share it.
  const anchors = new Map<string, P>()            // `${line key}|from` and `${line key}|to`
  {
    const bySide = new Map<string, { end: string; other: string }[]>()
    for (const l of map.lines) {
      const [sa, sb] = sidesOf(l)
      const key = lineKey(l)
      bySide.set(`${l.from}|${sa}`, [...(bySide.get(`${l.from}|${sa}`) ?? []), { end: `${key}|from`, other: l.to }])
      bySide.set(`${l.to}|${sb}`, [...(bySide.get(`${l.to}|${sb}`) ?? []), { end: `${key}|to`, other: l.from }])
    }
    for (const [at, ends] of bySide) {
      const cut = at.lastIndexOf('|')
      const b = boxes[at.slice(0, cut)]
      const side = at.slice(cut + 1) as Side
      if (!b) continue
      const upright = side === 'l' || side === 'r'
      const along = (q: P) => (upright ? q.y : q.x), across = (q: P) => (upright ? q.x : q.y)
      const sorted = [...ends].sort((x, y) => along(center(x.other)) - along(center(y.other)) || across(center(x.other)) - across(center(y.other)))
      const n = sorted.length
      const band = Math.min(0.7, 0.18 * (n - 1))
      sorted.forEach((e, i) => {
        const f = n <= 1 ? 0.5 : 0.5 - band / 2 + (i * band) / (n - 1)
        anchors.set(e.end, side === 'r' ? { x: b.x + b.w, y: b.y + b.h * f } : side === 'l' ? { x: b.x - 1, y: b.y + b.h * f }
          : side === 't' ? { x: b.x + b.w * f, y: b.y - 1 } : { x: b.x + b.w * f, y: b.y + b.h })
      })
    }
  }
  const lerp = (a: P, b: P, t: number): P => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
  const OUT: Record<Side, P> = { r: { x: 1, y: 0 }, l: { x: -1, y: 0 }, t: { x: 0, y: -1 }, b: { x: 0, y: 1 } }
  /**
   * The curve of a line: it leaves and enters square to its two sides, and bends in between.
   * `plain` is a line on the sides that face each other. A line on sides the player picked may
   * have to turn around a corner, so it reaches further out before it bends.
   */
  const curve = (a: P, sa: Side, d: P, sd: Side, plain: boolean): [P, P, P, P] => {
    const upright = sa === 't' || sa === 'b'
    const reach = plain
      ? (upright ? Math.max(3, Math.abs(d.y - a.y) * 0.5) : Math.max(14, Math.abs(d.x - a.x) * 0.5))
      : Math.min(90, Math.max(compact ? 12 : 22, Math.hypot(d.x - a.x, d.y - a.y) * 0.4))
    return [a, { x: a.x + OUT[sa].x * reach, y: a.y + OUT[sa].y * reach }, { x: d.x + OUT[sd].x * reach, y: d.y + OUT[sd].y * reach }, d]
  }
  const at = (c: [P, P, P, P], t: number): P => {
    const ab = lerp(c[0], c[1], t), bc = lerp(c[1], c[2], t), cd = lerp(c[2], c[3], t)
    return lerp(lerp(ab, bc, t), lerp(bc, cd, t), t)
  }
  const draw = (c: [P, P, P, P]) => `M${c[0].x},${c[0].y} C${c[1].x},${c[1].y} ${c[2].x},${c[2].y} ${c[3].x},${c[3].y}`
  // The head of a line stands in its middle (Pouria, 2026-11-23) and points the way the line
  // runs. When the middle lies behind a tile, the head moves along the line to the nearest point
  // that is clear of every node, so a long line that passes behind tiles keeps its head. Heads
  // are drawn over the tiles, so the short line between two neighbours of one column shows its
  // head in the gap between them.
  const clear = (q: P, m: number) => !Object.values(boxes).some((b) => q.x > b.x - m && q.x < b.x + b.w + m && q.y > b.y - m && q.y < b.y + b.h + m)
  const headAt = (c: [P, P, P, P]): number => {
    // The clear point nearest the middle: well clear of every node, or else just clear (the gap
    // between two neighbours is narrow). A line that is nowhere clear keeps its head in the middle.
    for (const m of [7, 2]) {
      let best: number | null = null
      for (let i = 0; i <= 80; i++) {
        const t = 0.1 + i * 0.01
        if (clear(at(c, t), m) && (best === null || Math.abs(t - 0.5) < Math.abs(best - 0.5))) best = t
      }
      if (best !== null) return best
    }
    return 0.5
  }
  type Geom = { d: string; head: { at: P; dir: P }; advice: P }
  const geom = (l: CanvasLine): Geom | null => {
    const key = lineKey(l)
    const a = anchors.get(`${key}|from`), d = anchors.get(`${key}|to`)
    if (!a || !d) return null
    const [sa, sd] = sidesOf(l)
    const [fa, fd] = facing(l)
    const c = curve(a, sa, d, sd, sa === fa && sd === fd)
    const t = headAt(c)
    const h = at(c, t), h0 = at(c, Math.max(0, t - 0.02)), h1 = at(c, Math.min(1, t + 0.02))
    const len = Math.hypot(h1.x - h0.x, h1.y - h0.y) || 1
    // The mark of advice stands on the first part of the line, clear of the head.
    return { d: draw(c), head: { at: h, dir: { x: (h1.x - h0.x) / len, y: (h1.y - h0.y) / len } }, advice: at(c, 0.27) }
  }
  /** The line that follows the pointer while it is dragged out of a port, from the side of that port. */
  const dragPath = (from: string, side: LineSide | undefined, x: number, y: number) => {
    const b = boxes[from]!
    const sd: Side = side ? SHORT[side] : 'r'
    const a = sd === 'r' ? { x: b.x + b.w, y: b.y + b.h / 2 } : sd === 'l' ? { x: b.x, y: b.y + b.h / 2 } : sd === 't' ? { x: b.x + b.w / 2, y: b.y } : { x: b.x + b.w / 2, y: b.y + b.h }
    const r = Math.max(14, Math.hypot(x - a.x, y - a.y) * 0.4)
    return `M${a.x},${a.y} C${a.x + OUT[sd].x * r},${a.y + OUT[sd].y * r} ${x},${y} ${x},${y}`
  }
  const names = tileNames(map, v)
  const nameOf = (id: string): string => {
    const s = v.sources.find((x) => x.id === id)
    if (s) return s.label
    if (id === v.result.id) return v.result.label
    return names.get(id)?.label ?? id
  }

  const joining = mode.kind === 'join'
  const placing = mode.kind === 'place' || mode.kind === 'move'
  const targets = p.targets ?? new Set<string>()
  const lit = (id: string) => (joining || !!drag) && targets.has(id)

  // Drag from a port draws a line that follows the pointer (laptop). A click joins in two clicks.
  const startDrag = (from: string, e: React.PointerEvent, side?: LineSide) => {
    if (readOnly || e.button !== 0 || e.pointerType === 'touch') return
    // A dot that ends a line, or moves an end of the selected line, starts no new line. The
    // press still belongs to the dot, so it must not start a drag of the tile around it.
    if ((joining && mode.from !== from) || endOf(from)) {
      onPort.current = true
      window.addEventListener('pointerup', () => { onPort.current = false }, { once: true })
      return
    }
    onPort.current = true
    pop.hide()
    const el = box.current!
    const root = el.getBoundingClientRect()
    const k = root.width / Math.max(1, el.offsetWidth)
    const sx = e.clientX, sy = e.clientY
    let moved = false
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return
      if (!moved) { moved = true; p.onPort?.(from, side) }
      setDrag({ from, side, x: (ev.clientX - root.left) / k, y: (ev.clientY - root.top) / k })
      const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('[data-target]')
      setOver(el?.dataset.target ?? null)
    }
    const up = (ev: PointerEvent) => {
      onPort.current = false
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (moved) {
        // A drop on a node that cannot take the line goes to the phase too, which says why.
        const at = document.elementFromPoint(ev.clientX, ev.clientY)
        const to = at?.closest<HTMLElement>('[data-target]')?.dataset.target ?? at?.closest<HTMLElement>('[data-node]')?.dataset.node
        // Dropped on a dot of the tile: the line enters on that side.
        const toSide = at?.closest<HTMLElement>('[data-side]')?.dataset.side as LineSide | undefined
        if (to && to !== from) p.onDragLine?.(from, to, { from: side, to: toSide })
        setDrag(null)
        setOver(null)
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // The round port of a node starts a line from it. A source has one on its right. A tile has
  // one on each of its four sides: the one on the right is always there, the others show while
  // the tile is pointed at or selected, while a line is looking for its end, and at the two ends
  // of the selected line. A press on a dot does one of three things. It starts a line that
  // leaves on that side. Or, while a line looks for its end, it ends the line on that side. Or,
  // on a tile at an end of the selected line, it moves that end to that side. A read-only map
  // marks each side that a line leaves.
  const selLine = p.selection?.kind === 'line' ? map.lines.find((l) => lineKey(l) === (p.selection as { key: string }).key) : undefined
  /** Which end of the selected line this tile is, if any. */
  function endOf(id: string): 'from' | 'to' | null {
    if (readOnly || !selLine || mode.kind !== 'idle' || !cellOf.has(id)) return null
    return selLine.from === id ? 'from' : selLine.to === id ? 'to' : null
  }
  const pressPort = (id: string, side: LineSide | undefined) => {
    const end = endOf(id)
    if (end && side) { p.onMoveEnd?.(lineKey(selLine!), end, side); return }
    if (joining && mode.from !== id) { p.onNode?.(id, side); return }
    p.onPort?.(id, side)
  }
  const port = (id: string, label: string, side?: LineSide) => readOnly ? (used.has(id) ? <span className="cport ro" style={{ background: colorOf(id) }} aria-hidden="true" /> : null) : (
    <button type="button" className={`cport${joining && mode.from === id && (mode.side ?? 'right') === (side ?? 'right') ? ' on' : ''}`} style={{ background: colorOf(id) }} data-side={side}
      aria-label={words.port(label)} aria-pressed={joining && mode.from === id}
      onClick={(e) => { e.stopPropagation(); pressPort(id, side) }} onPointerDown={(e) => startDrag(id, e, side)} />
  )
  const tilePorts = (id: string, label: string) => {
    if (readOnly) {
      const out = new Set(map.lines.filter((l) => l.from === id).map((l) => sidesOf(l)[0]))
      return [...out].map((sd) => <span key={sd} className={`cport ro s-${sd}`} style={{ background: colorOf(id) }} aria-hidden="true" />)
    }
    return (
      <>
        {port(id, label, 'right')}
        {(['t', 'b', 'l'] as Side[]).map((sd) => (
          // The dots of the other three sides, for the pointer: the keyboard and a screen reader have the one on the right.
          <span key={sd} className={`cport more s-${sd}${joining && mode.from === id && mode.side === LONG[sd] ? ' on' : ''}`} style={{ background: colorOf(id) }} aria-hidden="true" data-side={LONG[sd]}
            onClick={(e) => { e.stopPropagation(); pressPort(id, LONG[sd]) }} onPointerDown={(e) => startDrag(id, e, LONG[sd])} />
        ))}
      </>
    )
  }

  const workerOf = (t: CanvasTile) => v.workers.find((w) => w.id === t.kind)
  const partLabel = (t: CanvasTile, part: Part): { text: string; missing: boolean; title: string } => {
    if (part === 'model') {
      const m = v.models.find((x) => x.id === t.model)
      return m ? { text: m.short, missing: false, title: `${words.model}: ${m.label}` } : { text: words.pickModel, missing: true, title: words.pickModel }
    }
    if (part === 'runsOn') {
      const c = v.compute.find((x) => x.id === t.runsOn)
      return c ? { text: c.short, missing: false, title: `${words.compute}: ${c.label}` } : { text: words.pickCompute, missing: true, title: words.pickCompute }
    }
    const pr = v.prompts.find((x) => x.id === t.prompt)
    const d = v.prompts[0]
    return pr ? { text: pr.label, missing: false, title: `${words.prompt}: ${pr.label}` } : { text: d ? words.defaultPrompt(d.label) : '–', missing: false, title: `${words.prompt}: ${d?.label ?? ''}` }
  }
  const PART_ICON: Record<Part, string> = { model: 'model', runsOn: 'compute', prompt: 'prompt' }

  const tileEl = (t: CanvasTile) => {
    const w = workerOf(t)
    const stray = flags.stray.includes(t.id)
    const warn = flags.privateData.includes(t.id)
    const sel = p.selection?.kind === 'tile' && p.selection.id === t.id
    const moving = mode.kind === 'move' && mode.tile === t.id
    const isAi = w?.kind === 'ai'
    const label = names.get(t.id)?.label ?? w?.label ?? t.kind
    const short = names.get(t.id)?.short ?? w?.short ?? label
    const target = lit(t.id)
    const guided = !!p.guide?.nodes.includes(t.id)
    const body = p.bodies?.[t.id] ?? (w?.task ? { text: w.task } : null)
    return (
      <div key={t.id} ref={setNode(t.id)} data-tile={t.id} data-node={t.id} data-target={target ? t.id : undefined}
        className={`ctile k-${w?.kind ?? 'ai'}${stray ? ' stray' : ''}${sel ? ' sel' : ''}${endOf(t.id) ? ' ends' : ''}${t.row >= v.rows ? ' lastrow' : ''}${moving ? ' moving' : ''}${target ? ' lit' : ''}${over === t.id ? ' over' : ''}${warn ? ' warned' : ''}${guided ? ' guided' : ''}`}
        style={{ gridColumn: t.col + 1, gridRow: t.row + 1 }}
        role={readOnly ? undefined : 'button'} tabIndex={readOnly ? undefined : 0}
        aria-label={`${label}${stray ? `. ${words.stray}` : ''}${warn ? `. ${words.privateData}` : ''}${target ? `. ${words.joinHere(label)}` : ''}`}
        draggable={!readOnly && !compact}
        onDragStart={(e) => {
          // A drag from the port draws a line, it does not move the tile.
          if (onPort.current) { e.preventDefault(); return }
          e.dataTransfer.setData('text/x-lab02-tile', t.id); e.dataTransfer.effectAllowed = 'move'
        }}
        onClick={readOnly ? undefined : () => p.onNode?.(t.id)}
        onKeyDown={readOnly ? undefined : (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); p.onNode?.(t.id) } }}>
        <div className="ct-head">
          {!compact && <Icon name={w?.icon ?? ''} kind={w?.kind} size={15} />}
          <span className="ct-name" title={label}>{short}</span>
          {warn && <Mark tone="warn" title={words.privateData}>!</Mark>}
        </div>
        {isAi && !compact && (['model', 'runsOn', 'prompt'] as Part[]).map((part) => {
          const pl = partLabel(t, part)
          const g = guided && p.guide?.part === part ? ' guided' : ''
          return readOnly
            ? <div key={part} className={`ct-part${pl.missing ? ' missing' : ''}${g}`} title={pl.title}><Icon name={PART_ICON[part]} size={11} /><span>{pl.text}</span></div>
            : <button key={part} type="button" className={`ct-part${pl.missing ? ' missing' : ''}${g}`} title={pl.title} aria-label={pl.title}
                onClick={(e) => { e.stopPropagation(); if (mode.kind === 'idle') p.onPart?.(t.id, part); else p.onNode?.(t.id) }}><Icon name={PART_ICON[part]} size={11} /><span>{pl.text}</span></button>
        })}
        {isAi && compact && (['model', 'runsOn', 'prompt'] as Part[]).map((part) => {
          const pl = partLabel(t, part)
          return <div key={part} className={`ct-mini${pl.missing ? ' missing' : ''}`} title={pl.title}>{pl.missing ? '–' : pl.text}</div>
        })}
        {!isAi && (!stray || compact) && body && <div className={`ct-body${body.over ? ' over' : ''}`} title={body.text}>{body.text}</div>}
        {!isAi && !compact && stray && <div className="ct-note">{words.stray}</div>}
        {isAi && stray && !compact && <div className="ct-badge">{words.strayShort}</div>}
        {tilePorts(t.id, label)}
      </div>
    )
  }

  const cells: ReactNode[] = []
  for (let r = 1; r <= v.rows; r++) {
    for (let c = 1; c <= v.cols; c++) {
      if (map.tiles.some((t) => t.col === c && t.row === r)) continue
      const can = !readOnly && placing
      cells.push(
        <div key={`c${c}-${r}`} className={`ccell${can ? ' open' : ''}`} style={{ gridColumn: c + 1, gridRow: r + 1 }}
          role={can ? 'button' : undefined} tabIndex={can ? 0 : undefined}
          aria-label={can ? `${words.emptyCell(c, r)}. ${mode.kind === 'move' ? words.moveHere : words.placeHere}` : undefined}
          onClick={can ? () => p.onCell?.(c, r) : undefined}
          onKeyDown={can ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); p.onCell?.(c, r) } } : undefined}
          onDragOver={readOnly ? undefined : (e) => { if (e.dataTransfer.types.includes('text/x-lab02-kind') || e.dataTransfer.types.includes('text/x-lab02-tile')) { e.preventDefault(); e.currentTarget.classList.add('dropping') } }}
          onDragLeave={(e) => e.currentTarget.classList.remove('dropping')}
          onDrop={readOnly ? undefined : (e) => {
            e.preventDefault()
            e.currentTarget.classList.remove('dropping')
            const kind = e.dataTransfer.getData('text/x-lab02-kind')
            const tile = e.dataTransfer.getData('text/x-lab02-tile')
            if (kind) p.onDropKind?.(kind, c, r)
            else if (tile) p.onDropTile?.(tile, c, r)
          }}>
          {can && <span className="ccell-plus" aria-hidden="true">+</span>}
        </div>,
      )
    }
  }

  const res = v.result
  const resLit = lit(res.id)
  return (
    <div ref={box} className={`cgrid${compact ? ' compact' : ''}${v.cols >= 5 ? ' dense' : ''}${v.cols >= 6 ? ' six' : ''}${joining ? ' joining' : ''}${placing ? ' placing' : ''}`}
      style={{ '--cols': v.cols, '--rows': v.rows } as React.CSSProperties} aria-label={p.label}>
      <div className="chdr" style={{ gridColumn: 1 }}>{words.sources}</div>
      {Array.from({ length: v.cols }, (_, i) => {
        // A column may carry the name of a stage of the work, with one sentence on it. Names only.
        // Without names nothing stands above a column: any worker may stand in any cell.
        const c = v.columns?.[i]
        if (!c) return <div key={i} className="chdr" style={{ gridColumn: i + 2 }} aria-hidden="true" />
        if (readOnly) return <div key={i} className="chdr stage" style={{ gridColumn: i + 2 }} title={c.hint}>{c.label}</div>
        return (
          <div key={i} className="chdr stage" style={{ gridColumn: i + 2 }}>
            <button type="button" className="chdr-b" title={c.hint} aria-expanded={hintCol === i} aria-label={`${c.label}. ${c.hint}`}
              onClick={() => setHintCol((x) => (x === i ? null : i))}>{c.label}</button>
            {hintCol === i && <span className="chint" role="status">{c.hint}</span>}
          </div>
        )
      })}
      <div className="chdr" style={{ gridColumn: v.cols + 2 }}>{words.result}</div>
      <div className="csources" data-tour={readOnly ? undefined : 'p2-sources'} style={{ gridColumn: 1, gridRow: `2 / span ${v.rows}` }}>
        {v.sources.map((s) => {
          const lock = locked(s.id)
          const by = p.lockedBy?.[s.id]
          return (
            <div key={s.id} ref={setNode(s.id)} data-node={s.id} className={`csource${lock ? ' is-locked' : ''}${joining && mode.from === s.id ? ' from' : ''}${!lock && p.guide?.nodes.includes(s.id) ? ' guided' : ''}`}
              title={p.popOf && !readOnly ? undefined : lock ? (by ? words.locked(by) : words.lockedNoAction) : s.label}
              role={(lock || joining) && !readOnly ? 'button' : undefined} tabIndex={!readOnly ? 0 : undefined}
              aria-label={lock ? `${s.label}. ${by ? words.locked(by) : words.lockedNoAction}` : undefined}
              {...(p.popOf && !readOnly ? popHandlers(pop, `node:${s.id}`, 'right', () => (drag ? null : p.popOf!(s.id))) : {})}
              onClick={readOnly ? undefined : () => { if (lock || joining) p.onNode?.(s.id); else p.onAbout?.(s.id) }}
              onKeyDown={(lock || joining) && !readOnly ? (e) => { if (e.key === 'Enter') p.onNode?.(s.id) } : undefined}>
              {/* A locked source wears its lock where the others wear their picture, so its name keeps the full width. */}
              {lock ? <Mark tone="lock" title={by ? words.locked(by) : words.lockedNoAction}><Icon name="lock" size={compact ? 10 : 12} /></Mark> : <Icon name={s.icon} size={compact ? 12 : 15} />}
              <span className="cs-name">{s.label}</span>
              {!lock && port(s.id, s.label)}
            </div>
          )
        })}
      </div>
      {cells}
      {map.tiles.map(tileEl)}
      <div className="cresult-col" style={{ gridColumn: v.cols + 2, gridRow: `2 / span ${v.rows}` }}>
        <div ref={setNode(res.id)} className={`cresult${resLit ? ' lit' : ''}${over === res.id ? ' over' : ''}${p.guide?.nodes.includes(res.id) ? ' guided' : ''}`} data-target={resLit ? res.id : undefined} data-node={res.id}
          data-tour={readOnly ? undefined : 'p2-result'}
          role={joining && !readOnly ? 'button' : undefined} tabIndex={!readOnly ? 0 : undefined}
          aria-label={resLit ? words.joinHere(res.label) : res.label}
          {...(p.popOf && !readOnly ? popHandlers(pop, `node:${res.id}`, 'left', () => (drag || joining ? null : p.popOf!(res.id))) : {})}
          onClick={readOnly ? undefined : () => { if (joining) p.onNode?.(res.id); else p.onAbout?.(res.id) }}
          onKeyDown={joining && !readOnly ? (e) => { if (e.key === 'Enter') p.onNode?.(res.id) } : undefined}>
          <Icon name="result" size={compact ? 14 : 18} />
          <span className="cr-name">{res.label}</span>
        </div>
      </div>
      <svg className="clines" aria-hidden={readOnly ? true : undefined}>
        {map.lines.map((l) => {
          const g = geom(l)
          if (!g) return null
          const key = lineKey(l)
          const d = g.d
          const color = colorOf(l.from)
          const sel = p.selection?.kind === 'line' && p.selection.key === key
          const faded = joining && mode.from !== l.from
          // A line between two tiles (or into the result) is a handoff, drawn heavier than a line
          // from a source, which only says that the tile may read it.
          const handoff = !sourceIds.has(l.from)
          return (
            <g key={key} className={`cline${handoff ? ' handoff' : ''}${sel ? ' sel' : ''}${faded ? ' faded' : ''}`}>
              <path d={d} className="halo" />
              <path d={d} className="ink" stroke={color} />
              {!readOnly && (
                <path d={d} className="hit" role="button" tabIndex={0} aria-label={words.line(nameOf(l.from), nameOf(l.to))}
                  onClick={(e) => { e.stopPropagation(); p.onLine?.(key) }}
                  onKeyDown={(e) => { if (e.key === 'Enter') p.onLine?.(key) }} />
              )}
            </g>
          )
        })}
        {map.lines.map((l) => {
          const key = lineKey(l)
          const g = p.advice?.has(key) ? geom(l) : null
          if (!g) return null
          const m = g.advice
          return (
            <g key={`adv-${key}`} className="cadvice" transform={`translate(${m.x},${m.y})`}>
              <circle r={compact ? 6 : 9} />
              <text y={compact ? 3.5 : 4.5} textAnchor="middle">i</text>
              {!readOnly && <circle r={compact ? 9 : 14} className="cadvice-hit" role="button" tabIndex={0} aria-label={`${words.advice}: ${words.line(nameOf(l.from), nameOf(l.to))}`}
                onClick={(ev) => { ev.stopPropagation(); p.onAdvice?.(key) }} onKeyDown={(ev) => { if (ev.key === 'Enter') p.onAdvice?.(key) }} />}
            </g>
          )
        })}
        {drag && boxes[drag.from] && (
          <path className="cline-drag" d={dragPath(drag.from, drag.side, drag.x, drag.y)} stroke={colorOf(drag.from)} />
        )}
      </svg>
      {/* The heads of the lines, over the tiles: a head in the narrow gap between two neighbours stays whole. */}
      <svg className="cheads" aria-hidden="true">
        <defs>
          {LINE_COLORS.map((c, i) => (
            // Arrowheads of one size whatever the stroke, so a heavy handoff keeps a small head.
            <marker key={i} id={`ca${i}${compact ? 'c' : ''}`} viewBox="0 0 8 8" refX="4" refY="4" markerUnits="userSpaceOnUse" markerWidth={compact ? 9 : 13} markerHeight={compact ? 9 : 13} orient="auto">
              <path d="M0,0 L8,4 L0,8 z" fill={c} />
            </marker>
          ))}
        </defs>
        {map.lines.map((l) => {
          const g = geom(l)
          if (!g) return null
          const { at: h, dir } = g.head
          const idx = LINE_COLORS.indexOf(colorOf(l.from))
          const faded = joining && mode.from !== l.from
          return <path key={lineKey(l)} className={`chead${faded ? ' faded' : ''}`} d={`M${h.x - dir.x},${h.y - dir.y} L${h.x},${h.y} L${h.x + dir.x},${h.y + dir.y}`} markerMid={`url(#ca${idx}${compact ? 'c' : ''})`} />
        })}
      </svg>
      {p.note && (() => {
        // The sentence stands under the place of the action, or over it near the foot of the grid.
        const n = p.note
        const anchor = (): { ax: number; ay: number; ah: number } | null => {
          if (n.at.startsWith('line:')) {
            const l = map.lines.find((x) => lineKey(x) === n.at.slice(5))
            const g = l ? geom(l) : null
            if (!g) return null
            const m = g.advice
            return { ax: m.x, ay: m.y - 10, ah: 20 }
          }
          const b = boxes[n.at]
          return b ? { ax: b.x + b.w / 2, ay: b.y, ah: b.h } : null
        }
        const an = anchor()
        if (!an) return null
        const { ax, ay, ah } = an
        const gw = box.current?.offsetWidth ?? 600, gh = box.current?.offsetHeight ?? 400
        const bw = Math.min(compact ? 200 : 260, gw - 8)
        const left = Math.max(4, Math.min(ax - bw / 2, gw - bw - 4))
        const below = ay + ah + 96 < gh || ay < gh / 2
        return (
          <div ref={noteEl} className={`cnote ${n.tone}${below ? ' below' : ' above'}`} role="status" style={{ left, width: bw, ...(below ? { top: ay + ah + 8 } : { bottom: gh - ay + 8 }) }}>
            <span>{n.text}</span>
            {p.onNoteClose && <button type="button" className="cnote-x" aria-label={words.close} onClick={(ev) => { ev.stopPropagation(); p.onNoteClose?.() }}>✕</button>}
          </div>
        )
      })()}
    </div>
  )
}

/** What the two kinds of line mean, drawn as they are on the map. */
export function LineLegend({ words }: { words: { read: string; handoff: string } }) {
  const sample = (heavy: boolean) => (
    <svg width="26" height="10" viewBox="0 0 26 10" aria-hidden="true" className={`lg-line${heavy ? ' heavy' : ''}`}>
      <path d="M1,5 L25,5" /><path d="M10,1 L16,5 L10,9 z" className="lg-head" />
    </svg>
  )
  return (
    <span className="lglegend">
      <span className="lg-i">{sample(false)}{words.read}</span>
      <span className="lg-i">{sample(true)}{words.handoff}</span>
    </span>
  )
}
