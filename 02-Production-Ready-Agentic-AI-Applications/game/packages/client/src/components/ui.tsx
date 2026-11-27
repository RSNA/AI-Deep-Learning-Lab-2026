// Shared components (engineering spec, section 10.1).
import { useEffect, useRef, type ReactNode } from 'react'
import type { BoardColumn, BoardRow, Character, ColumnId, SystemRef } from '@lab02/protocol'
import { portraitUrl, practiceLooks, type Parsed } from '../scene/people.ts'
import { COPY } from '../copy.ts'
import { fmt, secondsLeft, useTick, type ClockRef } from '../lib/clock.ts'
import { setTheme, useTheme } from '../lib/theme.ts'

// ------------------------------------------------------------------------------------------
// Health systems: a color and a shape each
// ------------------------------------------------------------------------------------------
export const SYSTEM_SHAPES = ['circle', 'square', 'triangle', 'diamond'] as const

export function SystemShape({ index, size = 14 }: { index: number; size?: number }) {
  const color = `var(--sys-${index % 4})`
  const shape = SYSTEM_SHAPES[index % 4]
  const style: React.CSSProperties = { width: size, height: size, background: color }
  if (shape === 'circle') style.borderRadius = '50%'
  if (shape === 'triangle') style.clipPath = 'polygon(50% 0, 100% 100%, 0 100%)'
  if (shape === 'diamond') style.transform = 'rotate(45deg) scale(0.78)'
  return <span className="shape" style={style} aria-hidden="true" />
}

export function SystemName({ system, systems }: { system: string; systems: SystemRef[] }) {
  const ref = systems.find((s) => s.id === system)
  if (!ref) return null
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      <SystemShape index={ref.index} />
      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ref.name}</span>
    </span>
  )
}

// ------------------------------------------------------------------------------------------
// Characters
// ------------------------------------------------------------------------------------------
export function Avatar({ id, size = 32, alt = '' }: { id: string; size?: number; alt?: string }) {
  return <img className="px" src={`/art/avatars/${id}.png`} width={size} height={size} alt={alt} style={{ display: 'block', flexShrink: 0 }} />
}

const TINTS = ['var(--go-bg)', 'var(--sky-bg)', 'var(--sun-bg)', 'var(--lav-bg)', 'var(--bad-bg)']

const looksCache = new Map<string, Map<string, Parsed>>()

/** The parsed looks of a whole practice, made unlike each other (see scene/people.ts). */
export function looksOf(cast: Character[]): Map<string, Parsed> {
  const key = cast.map((c) => `${c.id}:${JSON.stringify(c.look)}`).join('|')
  let m = looksCache.get(key)
  if (!m) { m = practiceLooks(cast); looksCache.set(key, m) }
  return m
}

/**
 * A person of the practice: their own pixel character seen from the front, head and shoulders,
 * drawn large and crisp. Never initials. `cast` is the whole practice, so that two people never
 * look alike.
 */
export function Portrait({ c, cast, index = 0, size = 56 }: { c: Character; cast: Character[]; index?: number; size?: number }) {
  const p = looksOf(cast.some((x) => x.id === c.id) ? cast : [...cast, c]).get(c.id)!
  const inner = Math.floor((size - 6) / 12) * 12
  return (
    <div className="portrait" style={{ width: size, height: size, background: TINTS[index % TINTS.length] }}>
      <img className="px" src={portraitUrl(c.id, p, inner)} alt="" width={inner} height={inner} style={{ width: inner, height: inner }} />
    </div>
  )
}

// ------------------------------------------------------------------------------------------
// Day or night
// ------------------------------------------------------------------------------------------
/** One press, in plain sight beside the menu button, so that nobody has to look for it (section 10.1). */
export function ThemeButton({ plain = false }: { plain?: boolean }) {
  const theme = useTheme()
  const to = theme === 'dark' ? 'light' : 'dark'
  const label = to === 'dark' ? COPY.toNight : COPY.toDay
  return (
    <button type="button" className={`iconbtn themebtn${plain ? ' plain' : ''}`} onClick={() => setTheme(to)} aria-label={label} title={label}>
      <svg viewBox="0 0 16 16" width="20" height="20" aria-hidden="true" shapeRendering="crispEdges">
        {to === 'dark'
          ? <path fill="currentColor" d="M6 1h4v1h2v2h1v2h1v4h-1v2h-1v2h-2v1H6v-1h3v-1h1v-2h1V5h-1V3H9V2H6z" />
          : <path fill="currentColor" d="M7 0h2v2H7zM7 14h2v2H7zM0 7h2v2H0zM14 7h2v2h-2zM2 2h2v2H2zM12 2h2v2h-2zM2 12h2v2H2zM12 12h2v2h-2zM6 4h4v1h1v1h1v4h-1v1h-1v1H6v-1H5v-1H4V6h1V5h1z" />}
      </svg>
    </button>
  )
}

// ------------------------------------------------------------------------------------------
// Countdown
// ------------------------------------------------------------------------------------------
/** `over`: the words beside a timer that stands at zero while its stage stays open (a single-player game). */
export function Countdown({ clock, big = false, guide = false, over }: { clock: ClockRef | null; big?: boolean; guide?: boolean; over?: string }) {
  useTick(250)
  const left = secondsLeft(clock, guide)
  const warn = clock?.clock.warnings ?? []
  const late = left !== null && warn.length > 0 && left <= Math.min(...warn)
  const warning = left !== null && !late && warn.length > 0 && left <= Math.max(...warn)
  const cls = left === null ? 'idle' : late ? 'late' : warning ? 'warn' : ''
  const paused = clock && !clock.clock.running
  return (
    <div className={`countdown ${cls}`} style={big ? { fontSize: 64, minWidth: 180 } : undefined} role="timer" aria-live="off">
      {paused ? '‖ ' : ''}{fmt(left)}{over && left === 0 && <span className="overtime">{over}</span>}
    </div>
  )
}

// ------------------------------------------------------------------------------------------
// Sheet
// ------------------------------------------------------------------------------------------
export function Sheet({ title, head = '', onClose, children, wide = false, className = '' }: { title: string; head?: string; onClose?: () => void; children: ReactNode; wide?: boolean; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  // The sheet takes the focus once, when it opens, and never from a field inside it: a page
  // that redraws every second must not pull the caret out of a field (section 10.1).
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const el = ref.current
    if (el && !el.contains(document.activeElement)) el.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && close.current) close.current() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <div className="scrim" onClick={(e) => { if (e.target === e.currentTarget && onClose) onClose() }}>
      <div className={`panel sheet${className ? ` ${className}` : ''}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref} style={wide && !className ? { width: 'min(820px, 100%)' } : undefined}>
        <div className={`panel-head ${head}`}>
          <span>{title}</span>
          {onClose && <button className="btn small" onClick={onClose} aria-label={COPY.close}>✕</button>}
        </div>
        <div className="panel-body">{children}</div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------------------------------
// Leaderboards
// ------------------------------------------------------------------------------------------
export const COLUMN_TITLE: Record<ColumnId, { title: string; head: string }> = {
  overall: { title: 'Overall', head: 'lav' },
  planning: { title: 'Phase 1', head: 'sky' },
  development: { title: 'Phase 2', head: 'sun' },
  maintaining: { title: 'Phase 3', head: '' },
}

export function columnTag(col: BoardColumn): string {
  return col.state === 'live' ? 'Live' : col.state === 'final' ? 'Final' : col.state === 'sum' ? 'So far' : ''
}

export function BoardRows({ rows, systems, emptyText = 'Opens with its phase.', big = false, of }: { rows: BoardRow[]; systems: SystemRef[]; emptyText?: string; big?: boolean; of?: number }) {
  if (!rows.length) return <div className="lb-empty">{emptyText}</div>
  return (
    <div className="lb">
      {rows.map((r) => {
        const sys = systems.find((s) => s.id === r.system)
        return (
          <div key={`${r.rank}-${r.name}`} className={`lb-row${r.me ? ' me' : ''}`} style={big ? { gridTemplateColumns: '44px 48px 20px minmax(0,1fr) auto', minHeight: 0, flex: 1 } : undefined}>
            <span className="rank" style={big ? { fontSize: 32 } : undefined}>{r.rank}</span>
            <Avatar id={r.avatar} size={big ? 48 : 32} />
            <SystemShape index={sys?.index ?? 0} size={big ? 18 : 14} />
            <span className="nm" style={big ? { fontSize: 24 } : undefined}>{r.name}{r.me ? ` (${COPY.you})` : ''}</span>
            <span className="val" style={big ? { fontSize: 32 } : undefined}>{Math.round(r.value)}{of !== undefined && <span className="of" style={{ fontSize: big ? 20 : 14, opacity: 0.7 }}> of {of}</span>}</span>
          </div>
        )
      })}
    </div>
  )
}
