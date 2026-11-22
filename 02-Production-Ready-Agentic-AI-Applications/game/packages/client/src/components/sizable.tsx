// A box whose height the player sets by dragging its bottom edge (engineering spec, sections
// 10.2 and 10.4): the practice scene in the lobby and above the evidence. The browser keeps the
// height. While the edge is dragged the box only clips or leaves room, and the scene is drawn
// again once, at the height where the edge is let go.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

function readHeight(key: string): number | null {
  try {
    const v = Number(localStorage.getItem(key))
    return Number.isFinite(v) && v > 0 ? v : null
  } catch { return null }
}

/** The height a player chose for a box, or the default while they have chosen none. */
export function useHeight(key: string, fallback: number): [number, (h: number) => void, boolean] {
  const [own, setOwn] = useState<number | null>(() => readHeight(key))
  const set = useCallback((h: number) => {
    setOwn(h)
    try { localStorage.setItem(key, String(Math.round(h))) } catch { /* storage unavailable */ }
  }, [key])
  return [own ?? fallback, set, own !== null]
}

const STEP = 24

/**
 * `children(height)` draws the content at a height. The content may come out lower than asked
 * (a scene is never taller than its room): the edge then sits under what was drawn, and a drag
 * starts from there.
 */
export function Sizable({ height, setHeight, min, max, label, children }: {
  height: number; setHeight: (h: number) => void; min: number; max: number; label: string; children: (height: number) => ReactNode
}) {
  const box = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<number | null>(null)
  const start = useRef<{ y: number; h: number } | null>(null)
  const clamp = useCallback((h: number) => Math.round(Math.max(min, Math.min(max, h))), [min, max])
  const asked = clamp(height)

  useEffect(() => {
    if (drag === null) return
    const move = (e: PointerEvent) => { if (start.current) setDrag(clamp(start.current.h + e.clientY - start.current.y)) }
    const up = () => {
      setDrag((d) => { if (d !== null) setHeight(d); return null })
      start.current = null
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [drag, clamp, setHeight])

  const drawn = () => (box.current?.firstElementChild as HTMLElement | null)?.offsetHeight || asked
  const shown = drag ?? asked
  return (
    <div className={`sizable${drag !== null ? ' dragging' : ''}`}>
      <div ref={box} className="sizable-box" style={drag !== null ? { height: drag } : undefined}>{children(asked)}</div>
      <div className="sizable-edge" role="separator" aria-orientation="horizontal" tabIndex={0}
        aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={shown} title={label}
        onPointerDown={(e) => {
          e.preventDefault()
          start.current = { y: e.clientY, h: drawn() }
          setDrag(drawn())
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp') { e.preventDefault(); setHeight(clamp(drawn() - STEP)) }
          if (e.key === 'ArrowDown') { e.preventDefault(); setHeight(clamp(drawn() + STEP)) }
        }}>
        <i aria-hidden="true" />
      </div>
    </div>
  )
}
