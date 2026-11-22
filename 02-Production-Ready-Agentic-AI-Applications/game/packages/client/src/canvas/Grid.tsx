// The canvas (engineering spec, section 10.5): sources on the left, a grid of cells, the result on
// the right, and lines that only run to the right. It draws any map, editable or read-only, and
// knows nothing of the phase that shows it. Every action works by click or tap; drag is an
// extra on a laptop.
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { CanvasLegend, CanvasMap, CanvasTile } from '@lab02/protocol'
import { Icon } from './icons.tsx'
import { lineKey, tileNames, type Vocabulary } from './model.ts'

/** One color per origin of lines, so that six crossing lines can be told apart. */
export const LINE_COLORS = ['#2f7bf5', '#f0742a', '#1fa971', '#b44fd6', '#e0434f', '#0f9fb0', '#b8860b', '#5b5ff0', '#d1478f', '#5f8f1f']

export type Mode =
  | { kind: 'idle' }
  | { kind: 'place'; worker: string }
  | { kind: 'move'; tile: string }
  | { kind: 'join'; from: string }
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
  onNode?: (id: string) => void
  onPort?: (id: string) => void
  onLine?: (key: string) => void
  onPart?: (tile: string, part: Part) => void
  onDropKind?: (kind: string, col: number, row: number) => void
  onDropTile?: (id: string, col: number, row: number) => void
  onDragLine?: (from: string, to: string) => void
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
}

type Box = { x: number; y: number; w: number; h: number }

const Mark = ({ children, title, tone }: { children: ReactNode; title: string; tone: 'warn' | 'lock' | 'stray' }) => (
  <span className={`cmark ${tone}`} title={title} role="img" aria-label={title}>{children}</span>
)

export function Grid(p: GridProps) {
  const { v, map, compact = false, readOnly = !!compact, words } = p
  const box = useRef<HTMLDivElement>(null)
  const nodes = useRef(new Map<string, HTMLElement>())
  const [boxes, setBoxes] = useState<Record<string, Box>>({})
  const [drag, setDrag] = useState<{ from: string; x: number; y: number } | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const [hintCol, setHintCol] = useState<number | null>(null)
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

  // Where a line enters its target: spread over the left edge, in the order of their origins' height.
  const entries = new Map<string, number>()
  const byTarget = new Map<string, typeof map.lines>()
  for (const l of map.lines) byTarget.set(l.to, [...(byTarget.get(l.to) ?? []), l])
  for (const [to, ls] of byTarget) {
    const t = boxes[to]
    if (!t) continue
    const sorted = [...ls].sort((a, b) => (boxes[a.from]?.y ?? 0) - (boxes[b.from]?.y ?? 0))
    sorted.forEach((l, i) => entries.set(lineKey(l), t.y + ((i + 1) * t.h) / (sorted.length + 1)))
  }
  const path = (x1: number, y1: number, x2: number, y2: number) => {
    const dx = Math.max(24, (x2 - x1) * 0.45)
    return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`
  }
  const names = tileNames(map, v)
  const nameOf = (id: string): string => {
    const s = v.sources.find((x) => x.id === id)
    if (s) return s.label
    if (id === v.result.id) return v.result.label
    return names.get(id)?.label ?? id
  }
  const sourceIds = new Set(v.sources.map((x) => x.id))

  const joining = mode.kind === 'join'
  const placing = mode.kind === 'place' || mode.kind === 'move'
  const targets = p.targets ?? new Set<string>()
  const lit = (id: string) => (joining || !!drag) && targets.has(id)

  // Drag from a port draws a line that follows the pointer (laptop). A click joins in two clicks.
  const startDrag = (from: string, e: React.PointerEvent) => {
    if (readOnly || e.button !== 0 || e.pointerType === 'touch') return
    onPort.current = true
    const el = box.current!
    const root = el.getBoundingClientRect()
    const k = root.width / Math.max(1, el.offsetWidth)
    const sx = e.clientX, sy = e.clientY
    let moved = false
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return
      if (!moved) { moved = true; p.onPort?.(from) }
      setDrag({ from, x: (ev.clientX - root.left) / k, y: (ev.clientY - root.top) / k })
      const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('[data-target]')
      setOver(el?.dataset.target ?? null)
    }
    const up = (ev: PointerEvent) => {
      onPort.current = false
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (moved) {
        const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('[data-target]')
        const to = el?.dataset.target
        if (to) p.onDragLine?.(from, to)
        setDrag(null)
        setOver(null)
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const port = (id: string, label: string) => readOnly ? (used.has(id) ? <span className="cport ro" style={{ background: colorOf(id) }} aria-hidden="true" /> : null) : (
    <button type="button" className={`cport${joining && mode.from === id ? ' on' : ''}`} style={{ background: colorOf(id) }}
      aria-label={words.port(label)} aria-pressed={joining && mode.from === id}
      onClick={(e) => { e.stopPropagation(); p.onPort?.(id) }} onPointerDown={(e) => startDrag(id, e)} />
  )

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
    return (
      <div key={t.id} ref={setNode(t.id)} data-tile={t.id} data-target={target ? t.id : undefined}
        className={`ctile k-${w?.kind ?? 'ai'}${stray ? ' stray' : ''}${sel ? ' sel' : ''}${moving ? ' moving' : ''}${target ? ' lit' : ''}${over === t.id ? ' over' : ''}${warn ? ' warned' : ''}`}
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
          return readOnly
            ? <div key={part} className={`ct-part${pl.missing ? ' missing' : ''}`} title={pl.title}><Icon name={PART_ICON[part]} size={11} /><span>{pl.text}</span></div>
            : <button key={part} type="button" className={`ct-part${pl.missing ? ' missing' : ''}`} title={pl.title} aria-label={pl.title}
                onClick={(e) => { e.stopPropagation(); if (mode.kind === 'idle') p.onPart?.(t.id, part); else p.onNode?.(t.id) }}><Icon name={PART_ICON[part]} size={11} /><span>{pl.text}</span></button>
        })}
        {isAi && compact && (['model', 'runsOn', 'prompt'] as Part[]).map((part) => {
          const pl = partLabel(t, part)
          return <div key={part} className={`ct-mini${pl.missing ? ' missing' : ''}`} title={pl.title}>{pl.missing ? '–' : pl.text}</div>
        })}
        {!isAi && !compact && stray && <div className="ct-note">{words.stray}</div>}
        {isAi && stray && !compact && <div className="ct-badge">{words.strayShort}</div>}
        {port(t.id, label)}
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
    <div ref={box} className={`cgrid${compact ? ' compact' : ''}${joining ? ' joining' : ''}${placing ? ' placing' : ''}`}
      style={{ '--cols': v.cols, '--rows': v.rows } as React.CSSProperties} aria-label={p.label}>
      <div className="chdr" style={{ gridColumn: 1 }}>{words.sources}</div>
      {Array.from({ length: v.cols }, (_, i) => {
        // A column may carry the name of a stage of the work, with one sentence on it. Names only.
        const c = v.columns?.[i]
        if (!c) return <div key={i} className="chdr" style={{ gridColumn: i + 2 }}>{words.col(i + 1)}</div>
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
      <div className="csources" style={{ gridColumn: 1, gridRow: `2 / span ${v.rows}` }}>
        {v.sources.map((s) => {
          const lock = locked(s.id)
          const by = p.lockedBy?.[s.id]
          return (
            <div key={s.id} ref={setNode(s.id)} className={`csource${lock ? ' is-locked' : ''}${joining && mode.from === s.id ? ' from' : ''}`}
              title={lock ? (by ? words.locked(by) : words.lockedNoAction) : s.label}
              role={lock && !readOnly ? 'button' : undefined} tabIndex={lock && !readOnly ? 0 : undefined}
              aria-label={lock ? `${s.label}. ${by ? words.locked(by) : words.lockedNoAction}` : undefined}
              onClick={lock && !readOnly ? () => p.onNode?.(s.id) : undefined}
              onKeyDown={lock && !readOnly ? (e) => { if (e.key === 'Enter') p.onNode?.(s.id) } : undefined}>
              <Icon name={s.icon} size={compact ? 12 : 15} />
              <span className="cs-name">{s.label}</span>
              {lock && <Mark tone="lock" title={by ? words.locked(by) : words.lockedNoAction}><Icon name="lock" size={11} /></Mark>}
              {!lock && port(s.id, s.label)}
              {lock && !compact && <span className="cs-lock">{words.lockedShort}</span>}
            </div>
          )
        })}
      </div>
      {cells}
      {map.tiles.map(tileEl)}
      <div className="cresult-col" style={{ gridColumn: v.cols + 2, gridRow: `2 / span ${v.rows}` }}>
        <div ref={setNode(res.id)} className={`cresult${resLit ? ' lit' : ''}${over === res.id ? ' over' : ''}`} data-target={resLit ? res.id : undefined}
          role={resLit && !readOnly ? 'button' : undefined} tabIndex={resLit && !readOnly ? 0 : undefined}
          aria-label={resLit ? words.joinHere(res.label) : res.label}
          onClick={resLit && !readOnly ? () => p.onNode?.(res.id) : undefined}
          onKeyDown={resLit && !readOnly ? (e) => { if (e.key === 'Enter') p.onNode?.(res.id) } : undefined}>
          <Icon name="result" size={compact ? 14 : 18} />
          <span className="cr-name">{res.label}</span>
        </div>
      </div>
      <svg className="clines" aria-hidden={readOnly ? true : undefined}>
        <defs>
          {LINE_COLORS.map((c, i) => (
            // Arrowheads of one size whatever the stroke, so a heavy handoff keeps a small head.
            <marker key={i} id={`ca${i}${compact ? 'c' : ''}`} viewBox="0 0 8 8" refX="7" refY="4" markerUnits="userSpaceOnUse" markerWidth={compact ? 9 : 14} markerHeight={compact ? 9 : 14} orient="auto">
              <path d="M0,0 L8,4 L0,8 z" fill={c} />
            </marker>
          ))}
        </defs>
        {map.lines.map((l) => {
          const a = boxes[l.from], b = boxes[l.to]
          if (!a || !b) return null
          const key = lineKey(l)
          const x1 = a.x + a.w, y1 = a.y + a.h / 2
          const x2 = b.x, y2 = entries.get(key) ?? b.y + b.h / 2
          const d = path(x1, y1, x2, y2)
          const color = colorOf(l.from)
          const idx = LINE_COLORS.indexOf(color)
          const sel = p.selection?.kind === 'line' && p.selection.key === key
          const faded = joining && mode.from !== l.from
          // A line between two tiles (or into the result) is a handoff, drawn heavier than a line
          // from a source, which only says that the worker may read it.
          const handoff = !sourceIds.has(l.from)
          return (
            <g key={key} className={`cline${handoff ? ' handoff' : ''}${sel ? ' sel' : ''}${faded ? ' faded' : ''}`}>
              <path d={d} className="halo" />
              <path d={d} className="ink" stroke={color} markerEnd={`url(#ca${idx}${compact ? 'c' : ''})`} />
              {!readOnly && (
                <path d={d} className="hit" role="button" tabIndex={0} aria-label={words.line(nameOf(l.from), nameOf(l.to))}
                  onClick={(e) => { e.stopPropagation(); p.onLine?.(key) }}
                  onKeyDown={(e) => { if (e.key === 'Enter') p.onLine?.(key) }} />
              )}
            </g>
          )
        })}
        {drag && boxes[drag.from] && (
          <path className="cline-drag" d={path(boxes[drag.from]!.x + boxes[drag.from]!.w, boxes[drag.from]!.y + boxes[drag.from]!.h / 2, drag.x, drag.y)} stroke={colorOf(drag.from)} />
        )}
      </svg>
    </div>
  )
}

/** What the two kinds of line mean, drawn as they are on the map. */
export function LineLegend({ words }: { words: { read: string; handoff: string } }) {
  const sample = (heavy: boolean) => (
    <svg width="26" height="10" viewBox="0 0 26 10" aria-hidden="true" className={`lg-line${heavy ? ' heavy' : ''}`}>
      <path d="M1,5 L21,5" /><path d="M19,1 L25,5 L19,9 z" className="lg-head" />
    </svg>
  )
  return (
    <span className="lglegend">
      <span className="lg-i">{sample(false)}{words.read}</span>
      <span className="lg-i">{sample(true)}{words.handoff}</span>
    </span>
  )
}
