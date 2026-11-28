// The tour of a phase and its help panel (engineering spec, section 10.1). When a player first
// reaches the play screen of a phase, after its opening letter, a tour dims the screen, lights
// one area at a time and says what the player does there. The menu starts it again and opens the
// help panel, which lists the same words. A phase only passes its list of steps: Phase 3 adds a
// list and nothing else. The clock is not stopped. A tour that was ended or finished does not
// start by itself again in this browser, after a refresh or a reconnect.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { create } from 'zustand'
import type { PhaseId } from '@lab02/protocol'
import { store } from '../lib/storage.ts'
import { Sheet } from './ui.tsx'

/** One area of the screen: `area` is a CSS selector of the element to light (the first one on screen). */
export type TourStep = { area: string; title: string; text: string; tab?: string }

type TourState = {
  open: { phase: PhaseId; at: number } | null
  help: PhaseId | null
  start: (phase: PhaseId) => void
  go: (at: number) => void
  end: () => void
  showHelp: (phase: PhaseId) => void
  closeHelp: () => void
}

/** Which tour or help panel is open. The menu and the phase screens share it. */
export const useTour = create<TourState>((set) => ({
  open: null,
  help: null,
  start: (phase) => set({ open: { phase, at: 0 }, help: null }),
  go: (at) => set((s) => (s.open ? { open: { ...s.open, at } } : {})),
  end: () => set({ open: null }),
  showHelp: (phase) => set({ help: phase, open: null }),
  closeHelp: () => set({ help: null }),
}))

export type TourWords = {
  stepOf: (n: number, of: number) => string
  back: string; next: string; done: string; end: string
  clock: string
  label: string
}

type Rect = { x: number; y: number; w: number; h: number }
const PAD = 6

/** The element of an area that is on the screen now (a phone tab may hide the others). */
function areaElement(area: string): HTMLElement | null {
  const all = [...document.querySelectorAll<HTMLElement>(area)]
  return all.find((el) => el.getClientRects().length > 0) ?? null
}

/**
 * The tour of one phase. `autoStart` is true once the play screen is in front of the player (the
 * opening letter is closed). `onTab` switches a phone to the tab that holds an area.
 */
export function Tour({ phase, steps, doneKey, autoStart, onTab, onEnd, words }: {
  phase: PhaseId; steps: TourStep[]; doneKey: string; autoStart: boolean
  onTab?: (tab: string) => void; onEnd?: () => void; words: TourWords
}) {
  const open = useTour((s) => s.open)
  const start = useTour((s) => s.start)
  const go = useTour((s) => s.go)
  const endTour = useTour((s) => s.end)
  const mine = open?.phase === phase ? open : null
  const at = mine ? Math.min(mine.at, steps.length - 1) : 0
  const step = mine ? steps[at] : undefined
  const [rect, setRect] = useState<Rect | null>(null)
  const [vw, setVw] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }))
  const card = useRef<HTMLDivElement>(null)
  const nextBtn = useRef<HTMLButtonElement>(null)

  // A tour of a phase ends with the screen of that phase (the host moved the room on).
  useEffect(() => () => { if (useTour.getState().open?.phase === phase) useTour.getState().end() }, [phase])

  // It starts by itself once, when the play screen is first in front of the player.
  useEffect(() => {
    if (autoStart && steps.length && !store.flag(doneKey) && !useTour.getState().open) start(phase)
  }, [autoStart, doneKey, phase, start, steps.length])

  // The page goes back to where it was when the tour began.
  const scrollAt = useRef<number | null>(null)
  useEffect(() => {
    if (mine && scrollAt.current === null) scrollAt.current = window.scrollY
    if (!mine && scrollAt.current !== null) { window.scrollTo({ top: scrollAt.current }); scrollAt.current = null }
  }, [mine])
  const endRef = useRef(onEnd)
  endRef.current = onEnd
  const finish = useCallback(() => { store.setFlag(doneKey); endTour(); endRef.current?.() }, [doneKey, endTour])

  // A phone shows the tab that holds the area first, then the area is measured.
  useEffect(() => { if (step?.tab) onTab?.(step.tab) }, [step?.area]) // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    if (!step) { setRect(null); return }
    let raf = 0
    let scrolled = false
    const measure = () => {
      const el = areaElement(step.area)
      if (el) {
        if (!scrolled) { scrolled = true; el.scrollIntoView({ block: 'nearest', inline: 'nearest' }) }
        const r = el.getBoundingClientRect()
        // An area taller than the window is lit where it shows.
        const y = Math.max(r.top, 0), b = Math.min(r.bottom, window.innerHeight)
        const next = { x: r.left, y, w: r.width, h: Math.max(24, b - y) }
        setRect((p) => (p && Math.abs(p.x - next.x) < 0.5 && Math.abs(p.y - next.y) < 0.5 && Math.abs(p.w - next.w) < 0.5 && Math.abs(p.h - next.h) < 0.5 ? p : next))
      } else setRect(null)
      setVw((p) => (p.w === window.innerWidth && p.h === window.innerHeight ? p : { w: window.innerWidth, h: window.innerHeight }))
      raf = requestAnimationFrame(measure)
    }
    raf = requestAnimationFrame(measure)
    return () => cancelAnimationFrame(raf)
  }, [step])

  useEffect(() => { if (step) nextBtn.current?.focus({ preventScroll: true }) }, [step])

  useEffect(() => {
    if (!mine) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish() }
      else if (e.key === 'ArrowRight') { e.preventDefault(); if (at < steps.length - 1) go(at + 1); else finish() }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); if (at > 0) go(at - 1) }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [mine, at, steps.length, go, finish])

  if (!mine || !step) return null
  const last = at === steps.length - 1
  // The card stands beside the lit area: right, left, below or above, whichever has room.
  const narrow = vw.w < 640
  const cw = Math.min(narrow ? vw.w - 24 : 340, vw.w - 24)
  const ch = card.current?.offsetHeight ?? 200
  const place = (): { left: number; top: number } => {
    if (!rect) return { left: (vw.w - cw) / 2, top: (vw.h - ch) / 2 }
    const r = { l: rect.x - PAD, t: rect.y - PAD, r: rect.x + rect.w + PAD, b: rect.y + rect.h + PAD }
    if (!narrow && vw.w - r.r >= cw + 24) return { left: r.r + 12, top: r.t }
    if (!narrow && r.l >= cw + 24) return { left: r.l - cw - 12, top: r.t }
    if (vw.h - r.b >= ch + 24) return { left: r.l, top: r.b + 12 }
    if (r.t >= ch + 24) return { left: r.l, top: r.t - ch - 12 }
    // An area that fills the screen keeps its top in view: the card stands low, above a phone's tabs.
    return { left: (vw.w - cw) / 2, top: vw.h - ch - (narrow ? 76 : 12) }
  }
  let { left, top } = place()
  left = Math.max(12, Math.min(left, vw.w - cw - 12))
  top = Math.max(12, Math.min(top, vw.h - ch - 12))

  return (
    <div className="tour" aria-live="polite">
      <div className="tour-dim" onClick={(e) => e.stopPropagation()} />
      {rect && <div className="tour-light" style={{ left: rect.x - PAD, top: rect.y - PAD, width: rect.w + 2 * PAD, height: rect.h + 2 * PAD }} />}
      <div ref={card} className="panel tour-card" role="dialog" aria-modal="true" aria-labelledby="tour-title" style={{ left, top, width: cw }}>
        <div className="tour-top">
          <span className="tour-label">{words.label}</span>
          <span className="tour-n">{words.stepOf(at + 1, steps.length)}</span>
        </div>
        <h3 id="tour-title">{step.title}</h3>
        <p>{step.text}</p>
        {at === 0 && <p className="tour-clock">{words.clock}</p>}
        <div className="tour-btns">
          {at > 0 && <button type="button" className="btn small" onClick={() => go(at - 1)}>{words.back}</button>}
          <button type="button" ref={nextBtn} className="btn small go" onClick={() => (last ? finish() : go(at + 1))}>{last ? words.done : words.next}</button>
          <button type="button" className="btn small text tour-end" onClick={finish}>{words.end}</button>
        </div>
      </div>
    </div>
  )
}

/** The help panel of a phase: the words of its tour as a list, and what the marks on the screen mean. */
export function HelpSheet({ phase, title, steps, intro, children, tourLabel, more }: {
  phase: PhaseId; title: string; steps: TourStep[]; intro?: string; children?: ReactNode; tourLabel: string
  /** One more button beside the one that starts the tour. */
  more?: ReactNode
}) {
  const help = useTour((s) => s.help)
  const close = useTour((s) => s.closeHelp)
  const start = useTour((s) => s.start)
  if (help !== phase) return null
  return (
    <Sheet title={title} head="lav" onClose={close} wide>
      {intro && <p className="help-intro">{intro}</p>}
      <ol className="help-list">
        {steps.map((s) => <li key={s.area}><b>{s.title}.</b> {s.text}</li>)}
      </ol>
      {children}
      <div className="sheet-actions">
        <button type="button" className="btn small" onClick={() => start(phase)}>{tourLabel}</button>
        {more}
      </div>
    </Sheet>
  )
}
