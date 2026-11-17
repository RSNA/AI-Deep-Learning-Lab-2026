// Shared components (engineering spec, section 10.1).
import { useEffect, useRef, type ReactNode } from 'react'
import type { BoardColumn, BoardRow, Character, ColumnId, PackArt, SystemRef } from '@lab02/protocol'
import { COPY } from '../copy.ts'
import { fmt, secondsLeft, useTick, type ClockRef } from '../lib/clock.ts'

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

const TITLES = new Set(['dr', 'mr', 'mrs', 'ms', 'mx', 'prof', 'sir', 'dame'])

/** Initials of a name, without titles ("Dr.") or credentials after a comma (", RN"). */
export function initials(name: string): string {
  const parts = (name.split(',')[0] ?? '').replace(/[^\p{L}\s'-]/gu, ' ').split(/\s+/).filter(Boolean)
    .filter((w, i, all) => !(TITLES.has(w.toLowerCase()) && all.length > 1 && i === 0))
  if (!parts.length) return '?'
  return ((parts[0]![0] ?? '') + (parts.length > 1 ? parts.at(-1)![0] ?? '' : parts[0]![1] ?? '')).toUpperCase()
}

/** A cast portrait from the pack, or the initials on a tile when the pack has no file. */
export function Portrait({ c, art, index = 0, systemIndex = 0, size = 56 }: { c: Character; art: PackArt; index?: number; systemIndex?: number; size?: number }) {
  const has = art.portraits.includes(c.portrait)
  return (
    <div className="portrait" style={{ width: size, height: size, background: has ? TINTS[index % TINTS.length] : `var(--sys-${systemIndex % 4})` }}>
      {has
        ? <img src={`${art.base}portraits/${c.portrait}.png`} alt="" style={{ width: size - 8, height: size - 8 }} />
        : <span className="initials" aria-hidden="true">{initials(c.name)}</span>}
    </div>
  )
}

// ------------------------------------------------------------------------------------------
// Countdown
// ------------------------------------------------------------------------------------------
export function Countdown({ clock, big = false, guide = false }: { clock: ClockRef | null; big?: boolean; guide?: boolean }) {
  useTick(250)
  const left = secondsLeft(clock, guide)
  const warn = clock?.clock.warnings ?? []
  const late = left !== null && warn.length > 0 && left <= Math.min(...warn)
  const warning = left !== null && !late && warn.length > 0 && left <= Math.max(...warn)
  const cls = left === null ? 'idle' : late ? 'late' : warning ? 'warn' : ''
  const paused = clock && !clock.clock.running
  return (
    <div className={`countdown ${cls}`} style={big ? { fontSize: 64, minWidth: 180 } : undefined} role="timer" aria-live="off">
      {paused ? '‖ ' : ''}{fmt(left)}
    </div>
  )
}

// ------------------------------------------------------------------------------------------
// Sheet
// ------------------------------------------------------------------------------------------
export function Sheet({ title, head = '', onClose, children, wide = false }: { title: string; head?: string; onClose?: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && onClose) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="scrim" onClick={(e) => { if (e.target === e.currentTarget && onClose) onClose() }}>
      <div className="panel sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref} style={wide ? { width: 'min(820px, 100%)' } : undefined}>
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

export function BoardRows({ rows, systems, emptyText = 'Opens with its phase.', big = false }: { rows: BoardRow[]; systems: SystemRef[]; emptyText?: string; big?: boolean }) {
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
            <span className="val" style={big ? { fontSize: 32 } : undefined}>{Math.round(r.value)}</span>
          </div>
        )
      })}
    </div>
  )
}
