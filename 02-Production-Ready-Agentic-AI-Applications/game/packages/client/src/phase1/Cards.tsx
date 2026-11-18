// Evidence cards (engineering spec, section 10.4): the Practice card, the four tile types, and
// the overlay that opens a card large. Nothing on a card is clamped, cut or hidden.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Character, Method, PackArt, PlanningContent, SystemPublic, Tile } from '@lab02/protocol'
import { Portrait } from '../components/ui.tsx'
import { Marks } from '../lib/marks.tsx'
import { P1 } from './copy.ts'

export const METHOD_CLASS: Record<Method, string> = { interview: 'm-int', data_pull: 'm-dat', audit: 'm-aud', observation: 'm-obs' }

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(Math.floor(el.clientWidth)))
    ro.observe(el)
    setW(Math.floor(el.clientWidth))
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

// ------------------------------------------------------------------------------------------
// Charts
// ------------------------------------------------------------------------------------------
type Series = { name: string; points: [string | number, number][] }
const SERIES_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)']
const MARKERS = ['square', 'circle', 'diamond'] as const

/** A series whose points all share one value is a yardstick (a target, a policy, an average). */
export function isYardstick(s: Series): boolean {
  return s.points.length > 0 && s.points.every((p) => p[1] === s.points[0]![1])
}

function niceMax(v: number): number {
  if (v <= 0) return 1
  const p = 10 ** Math.floor(Math.log10(v))
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p
  return 10 * p
}

const fmtNum = (n: number) => (Number.isInteger(n) ? n.toLocaleString('en-US') : n.toLocaleString('en-US', { maximumFractionDigits: 1 }))

function Marker({ kind, x, y, color, r }: { kind: (typeof MARKERS)[number]; x: number; y: number; color: string; r: number }) {
  if (kind === 'circle') return <circle cx={x} cy={y} r={r} fill={color} stroke="var(--line)" strokeWidth={1.5} />
  if (kind === 'diamond') return <rect x={x - r} y={y - r} width={2 * r} height={2 * r} fill={color} stroke="var(--line)" strokeWidth={1.5} transform={`rotate(45 ${x} ${y})`} />
  return <rect x={x - r} y={y - r} width={2 * r} height={2 * r} fill={color} stroke="var(--line)" strokeWidth={1.5} />
}

export function Chart({ data, large = false }: { data: Extract<Tile, { type: 'chart' }>['data']; large?: boolean }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const fs = large ? 15 : 12
  const W = Math.max(200, width)
  const H = large ? 300 : 170
  const xs: (string | number)[] = []
  for (const s of data.series) for (const [x] of s.points) if (!xs.includes(x)) xs.push(x)
  const yards = data.series.filter(isYardstick)
  const series = data.series.filter((s) => !isYardstick(s))
  const all = data.series.flatMap((s) => s.points.map((p) => p[1]))
  const top = niceMax(Math.max(...all, 0))
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * top)
  const tickW = Math.max(...ticks.map((t) => fmtNum(t).length)) * fs * 0.62 + 8
  // A tick label that is wider than its band breaks into two lines; only then are labels thinned.
  const charW = fs * 0.58
  const split = (t: string): string[] => {
    const words = t.split(' ')
    if (words.length < 2) return [t]
    let best: string[] = [t], bestW = Infinity
    for (let k = 1; k < words.length; k++) {
      const parts = [words.slice(0, k).join(' '), words.slice(k).join(' ')]
      const w = Math.max(...parts.map((x) => x.length))
      if (w < bestW) { bestW = w; best = parts }
    }
    return best
  }
  const bandGuess = (W - tickW - 18) / Math.max(1, xs.length)
  const xl = xs.map((x) => { const t = String(x); return t.length * charW + 8 > bandGuess ? split(t) : [t] })
  const lines = Math.max(1, ...xl.map((l) => l.length))
  const left = tickW + 4, right = 14, topPad = fs + 8, bottom = lines * (fs + 3) + 8
  const plotW = W - left - right, plotH = H - topPad - bottom
  const y = (v: number) => topPad + plotH - (v / top) * plotH
  const band = plotW / Math.max(1, xs.length)
  const cx = (i: number) => left + band * (i + 0.5)
  // Labels that would touch are thinned out: every second, third, ... label is shown.
  const labelW = Math.max(...xl.flat().map((x) => x.length)) * charW + 8
  const every = Math.max(1, Math.ceil(labelW / band))
  const colorOf = (s: Series) => SERIES_COLORS[series.indexOf(s) % SERIES_COLORS.length]!
  const markerOf = (s: Series) => MARKERS[series.indexOf(s) % MARKERS.length]!
  return (
    <div className="chart" ref={ref}>
      <div className="cap">{data.yLabel}</div>
      {width > 0 && (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${data.kind} chart of ${data.yLabel} by ${data.xLabel}`} style={{ display: 'block', fontSize: fs }}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={left} x2={W - right} y1={y(t)} y2={y(t)} stroke="var(--soft)" strokeWidth={1.5} />
              <text x={left - 6} y={y(t) + fs * 0.35} textAnchor="end" className="ax">{fmtNum(t)}</text>
            </g>
          ))}
          {xs.map((x, i) => i % every === 0 && (
            <text key={String(x)} x={cx(i)} y={H - bottom + fs + 6} textAnchor="middle" className="ax">
              {xl[i]!.map((t, k) => <tspan key={k} x={cx(i)} dy={k === 0 ? 0 : fs + 3}>{t}</tspan>)}
            </text>
          ))}
          {data.kind === 'bar' && series.map((s, si) => {
            const bw = Math.min(46, (band * 0.72) / series.length)
            return s.points.map(([x, v]) => {
              const i = xs.indexOf(x)
              const bx = cx(i) - (bw * series.length) / 2 + si * bw
              return (
                <g key={`${si}-${String(x)}`}>
                  <rect x={bx} y={y(v)} width={bw - 2} height={Math.max(0, y(0) - y(v))} fill={colorOf(s)} stroke="var(--line)" strokeWidth={1.5} />
                  <text x={bx + (bw - 2) / 2} y={y(v) - 4} textAnchor="middle" className="val">{fmtNum(v)}</text>
                </g>
              )
            })
          })}
          {data.kind === 'line' && series.map((s) => {
            const pts = s.points.map(([x, v]) => [cx(xs.indexOf(x)), y(v)] as const)
            return (
              <g key={s.name}>
                <polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none" stroke={colorOf(s)} strokeWidth={3} strokeLinejoin="round" />
                {pts.map(([px, py], i) => <Marker key={i} kind={markerOf(s)} x={px} y={py} color={colorOf(s)} r={large ? 5 : 4} />)}
                <text x={pts.at(-1)![0]} y={pts.at(-1)![1] - 9} textAnchor="middle" className="val">{fmtNum(s.points.at(-1)![1])}</text>
              </g>
            )
          })}
          {yards.map((s) => (
            <line key={s.name} x1={left} x2={W - right} y1={y(s.points[0]![1])} y2={y(s.points[0]![1])} stroke="var(--bad)" strokeWidth={2.5} strokeDasharray="7 5" />
          ))}
        </svg>
      )}
      <div className="cap xcap">{data.xLabel}</div>
      {data.series.length > 1 && (
        <div className="legend">
          {series.map((s) => (
            <span key={s.name}>
              {data.kind === 'bar'
                ? <i className="box" style={{ background: colorOf(s) }} />
                : <svg width="26" height="12" aria-hidden="true"><line x1="0" x2="26" y1="6" y2="6" stroke={colorOf(s)} strokeWidth="3" /><Marker kind={markerOf(s)} x={13} y={6} color={colorOf(s)} r={3.5} /></svg>}
              {s.name}
            </span>
          ))}
          {yards.map((s) => <span key={s.name}><i className="dash" />{s.name}</span>)}
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------------------------------
// Tile bodies
// ------------------------------------------------------------------------------------------
export function AuditBars({ data }: { data: Extract<Tile, { type: 'audit' }>['data'] }) {
  const max = Math.max(1, ...data.findings.map((f) => f.count))
  return (
    <div className="findings">
      {data.findings.map((f) => (
        <div className="find" key={f.label}>
          <div className="barwrap">
            <div className="fill" style={{ width: `${(100 * f.count) / max}%` }} />
            <div className="lab">{f.label}</div>
          </div>
          <div className="n num">{fmtNum(f.count)}</div>
        </div>
      ))}
    </div>
  )
}

export function TileBody({ tile, cast, art, systemIndex, large = false }: { tile: Tile; cast: Character[]; art: PackArt; systemIndex: number; large?: boolean }) {
  const body = <p className="body"><Marks text={tile.body} /></p>
  switch (tile.type) {
    case 'stat': {
      const d = tile.data
      return (
        <>
          <div className="stat">
            <div className="v num">{typeof d.value === 'number' ? fmtNum(d.value) : d.value}{d.unit ? <span className="u">{d.unit}</span> : null}</div>
            <div className="lab">{d.label}</div>
          </div>
          {d.comparison && <div className="cmp"><Marks text={d.comparison} /></div>}
          {body}
        </>
      )
    }
    case 'chart':
      return (
        <>
          <Chart data={tile.data} large={large} />
          {body}
          {tile.data.note && <p className="note"><Marks text={tile.data.note} /></p>}
        </>
      )
    case 'audit':
      return (
        <>
          <div className="cap">{P1.sample(tile.data.sampleSize)}</div>
          <AuditBars data={tile.data} />
          {body}
          {tile.data.note && <p className="note"><Marks text={tile.data.note} /></p>}
        </>
      )
    case 'quote': {
      const idx = cast.findIndex((c) => c.id === tile.data.speaker)
      const c = cast[idx]
      return (
        <>
          {c && (
            <div className="speaker">
              <Portrait c={c} art={art} index={idx} systemIndex={systemIndex} size={large ? 56 : 44} />
              <div><div className="nm">{c.name}</div><div className="rl">{c.role}</div></div>
            </div>
          )}
          {body}
          <div className="says">{tile.data.lines.map((l, i) => <div className="say" key={i}><Marks text={l} /></div>)}</div>
        </>
      )
    }
  }
}

// ------------------------------------------------------------------------------------------
// Cards
// ------------------------------------------------------------------------------------------
export type CardItem =
  | { kind: 'practice' }
  | { kind: 'tile'; investigation: string; tile: Tile }

export function cardKey(c: CardItem): string {
  return c.kind === 'practice' ? 'practice' : c.investigation
}

export function PracticeBody({ system }: { system: SystemPublic }) {
  return (
    <div className="practice-body">
      <div className="eyebrow">{P1.practiceProfile}</div>
      {system.practiceProfile.map((r) => <div key={r.label} className="kv"><span>{r.label}</span><span className="v">{r.value}</span></div>)}
      <div className="eyebrow" style={{ marginTop: 8 }}>{P1.baseline}</div>
      {system.baseline.map((r) => <div key={r.label} className="kv"><span>{r.label}</span><span className="v">{r.value}{r.unit ? ` ${r.unit}` : ''}</span></div>)}
    </div>
  )
}

type CardProps = {
  item: CardItem
  content: PlanningContent
  system: SystemPublic
  art: PackArt
  fresh?: boolean
  large?: boolean
  onOpen?: () => void
  index?: number
  total?: number
  headExtra?: React.ReactNode
}

export function EvidenceCard({ item, content, system, art, fresh = false, large = false, onOpen, headExtra }: CardProps) {
  if (item.kind === 'practice') {
    return (
      <article className={`card practice${large ? ' large' : ''}`} data-card="practice" tabIndex={onOpen ? 0 : undefined}
        onClick={onOpen} onKeyDown={(e) => { if (e.key === 'Enter' && onOpen) { e.preventDefault(); onOpen() } }} aria-label={P1.practiceCard}>
        <div className="chead h-prac"><span className="src">{P1.practiceCard} · {system.name}</span>{headExtra ?? (onOpen && <span className="minibtn" aria-hidden="true">⤢</span>)}</div>
        <div className="cbody"><PracticeBody system={system} /></div>
      </article>
    )
  }
  const inv = content.investigations.find((x) => x.id === item.investigation)
  const method = inv?.method ?? 'data_pull'
  return (
    <article className={`card${fresh ? ' fresh' : ''}${large ? ' large' : ''}`} data-card={item.investigation} tabIndex={onOpen ? 0 : undefined}
      onClick={onOpen} onKeyDown={(e) => { if (e.key === 'Enter' && onOpen) { e.preventDefault(); onOpen() } }}
      aria-label={`${P1.method[method]}: ${inv?.title ?? ''}. ${item.tile.headline}`}>
      <div className={`chead h-${METHOD_CLASS[method]}`}>
        <span className="src">{P1.method[method].toUpperCase()} · {inv?.title}</span>
        <span className="tools">
          {fresh && <span className="tagchip">{P1.newTag}</span>}
          {headExtra ?? (onOpen && <span className="minibtn" aria-hidden="true">⤢</span>)}
        </span>
      </div>
      <div className="cbody">
        <h3>{item.tile.headline}</h3>
        <TileBody tile={item.tile} cast={system.cast} art={art} systemIndex={system.index} large={large} />
      </div>
    </article>
  )
}

/** A card opened large. The arrow keys move to the previous and the next card. */
export function CardOverlay({ items, index, setIndex, onClose, content, system, art, phone }: {
  items: CardItem[]; index: number; setIndex: (i: number) => void; onClose: () => void
  content: PlanningContent; system: SystemPublic; art: PackArt; phone: boolean
}) {
  const box = useRef<HTMLDivElement>(null)
  const item = items[index]
  useEffect(() => { box.current?.focus() }, [index])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Keys typed into the sorting board belong to it.
      const t = e.target as HTMLElement | null
      if (t && t.closest('.sortcol')) return
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
      else if (e.key === 'ArrowLeft' && index > 0) { e.preventDefault(); setIndex(index - 1) }
      else if (e.key === 'ArrowRight' && index < items.length - 1) { e.preventDefault(); setIndex(index + 1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, items.length, onClose, setIndex])
  if (!item) return null
  return (
    <div className={`overlay${phone ? ' phone' : ''}`} onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="ovbox" role="dialog" aria-modal="true" aria-label={P1.cardOf(index + 1, items.length)} tabIndex={-1} ref={box}>
        <EvidenceCard item={item} content={content} system={system} art={art} large
          headExtra={(
            <span className="tools">
              <span className="ovcount">{P1.cardOf(index + 1, items.length)}</span>
              <button type="button" className="closebtn" onClick={onClose}>{P1.close} ✕</button>
            </span>
          )} />
        {!phone && <div className="ovfoot"><span><kbd>Esc</kbd> {P1.closes}</span><span><kbd>←</kbd> <kbd>→</kbd> {P1.prevNext}</span></div>}
      </div>
      <button type="button" className="navbtn prev" aria-label={P1.prev} disabled={index === 0} onClick={() => setIndex(index - 1)}>‹</button>
      <button type="button" className="navbtn next" aria-label={P1.next} disabled={index >= items.length - 1} onClick={() => setIndex(index + 1)}>›</button>
    </div>
  )
}
