// A small card of details that stands beside whatever the pointer or the keyboard focus is on
// (engineering spec, section 10.5): an action, an item of the toolbox, a chip of a shelf, a
// source, the result. It never takes a click, so it cannot stand in the way. A phone has no
// pointer to rest: there the same words stand in the row itself or in a sheet.
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './icons.tsx'

/** What a card says. `body` are sentences in plain ink, `meta` the quieter lines under them. */
export type PopInfo = {
  title: string
  tag?: string | null            // a word beside the title: the kind of a toolbox item
  tone?: string | null           // 'ai' | 'fixed' | 'person': the color of its edge
  lead?: string | null           // a few words on the job it does
  body?: (string | null | undefined)[]
  meta?: (string | null | undefined)[]
  lock?: string | null           // what opens a locked item
}
export type PopSide = 'left' | 'right' | 'below'

type Shown = { key: string; rect: { left: number; top: number; right: number; bottom: number }; side: PopSide; info: PopInfo }
type Ctx = { show: (key: string, el: Element, side: PopSide, info: PopInfo) => void; hide: (key?: string) => void }
const PopCtx = createContext<Ctx>({ show: () => {}, hide: () => {} })
export const usePop = () => useContext(PopCtx)

const WIDTH = 320
const DELAY = 140

/**
 * Holds the one card that shows at a time. `off` keeps it closed: on a phone, and while
 * something is being dragged or a tour is running.
 */
export function PopLayer({ children, off = false }: { children: ReactNode; off?: boolean }) {
  const [shown, setShown] = useState<Shown | null>(null)
  const [at, setAt] = useState<{ left: number; top: number } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const want = useRef<string | null>(null)
  const card = useRef<HTMLDivElement>(null)

  const hide = useCallback((key?: string) => {
    if (key !== undefined && want.current !== key) return
    want.current = null
    if (timer.current) clearTimeout(timer.current)
    setShown(null)
  }, [])
  const show = useCallback((key: string, el: Element, side: PopSide, info: PopInfo) => {
    if (off) return
    want.current = key
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      if (want.current !== key || !el.isConnected) return
      const r = el.getBoundingClientRect()
      setAt(null)
      setShown({ key, rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom }, side, info })
    }, DELAY)
  }, [off])

  // A press, a scroll or Escape closes it: the player is acting, not reading.
  useEffect(() => {
    const close = () => hide()
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') hide() }
    window.addEventListener('pointerdown', close, true)
    window.addEventListener('scroll', close, true)
    window.addEventListener('dragstart', close, true)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointerdown', close, true)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('dragstart', close, true)
      window.removeEventListener('keydown', key)
      if (timer.current) clearTimeout(timer.current)
    }
  }, [hide])
  useEffect(() => { if (off) hide() }, [off, hide])

  // Stand on the asked side when there is room, else on the other, and never off the window.
  useLayoutEffect(() => {
    const el = card.current
    if (!shown || !el) return
    const w = el.offsetWidth, h = el.offsetHeight
    const vw = window.innerWidth, vh = window.innerHeight
    const r = shown.rect
    let left: number, top: number
    if (shown.side === 'below') {
      left = r.left
      top = r.bottom + 8 + h <= vh - 8 ? r.bottom + 8 : r.top - 8 - h
    } else {
      const rightOk = r.right + 10 + w <= vw - 8
      const leftOk = r.left - 10 - w >= 8
      const onRight = shown.side === 'right' ? rightOk || !leftOk : !leftOk && rightOk
      left = onRight ? r.right + 10 : r.left - 10 - w
      top = r.top
    }
    setAt({ left: Math.max(8, Math.min(left, vw - w - 8)), top: Math.max(8, Math.min(top, vh - h - 8)) })
  }, [shown])

  const ctx = useMemo(() => ({ show, hide }), [show, hide])
  const i = shown?.info
  return (
    <PopCtx.Provider value={ctx}>
      {children}
      {shown && i && createPortal(
        <div ref={card} className={`pop${i.tone ? ` k-${i.tone}` : ''}`} role="tooltip" style={{ width: WIDTH, left: at?.left ?? 0, top: at?.top ?? 0, visibility: at ? 'visible' : 'hidden' }}>
          <span className="pop-t"><span>{i.title}</span>{i.tag && <span className="pop-k">{i.tag}</span>}</span>
          {i.lead && <span className="pop-lead">{i.lead}</span>}
          {(i.body ?? []).filter(Boolean).map((x, n) => <span key={`b${n}`} className="pop-b">{x}</span>)}
          {(i.meta ?? []).filter(Boolean).map((x, n) => <span key={`m${n}`} className="pop-m">{x}</span>)}
          {i.lock && <span className="pop-lock"><Icon name="lock" size={11} /> <span>{i.lock}</span></span>}
        </div>, document.body)}
    </PopCtx.Provider>
  )
}

/**
 * The handlers of an element that shows a card while it is pointed at or holds the focus.
 * `info` is asked for when the card opens, so it always says the state of that moment.
 */
export function popHandlers(pop: Ctx, key: string, side: PopSide, info: () => PopInfo | null) {
  const open = (el: Element) => { const i = info(); if (i) pop.show(key, el, side, i) }
  return {
    onMouseEnter: (e: React.MouseEvent) => open(e.currentTarget),
    onMouseLeave: () => pop.hide(key),
    onFocus: (e: React.FocusEvent) => { if (e.currentTarget.matches(':focus-visible')) open(e.currentTarget) },
    onBlur: () => pop.hide(key),
  }
}
