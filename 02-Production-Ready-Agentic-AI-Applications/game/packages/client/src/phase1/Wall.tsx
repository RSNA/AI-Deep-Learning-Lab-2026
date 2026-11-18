// Evidence, the centre column of Phase 1 (engineering spec, section 10.4): one panel with the
// reading room or the practice facts, then the cards: the opening letter first, then every
// insight in order of arrival. Two cards per row from 560 px, one below. Nothing is clamped.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PlanningContent, PlanningView, Welcome } from '@lab02/protocol'
import { usePlayer } from '../lib/player.ts'
import { CardOverlay, EvidenceCard, FactsBody, cardKey, type CardItem } from './Cards.tsx'
import { P1 } from './copy.ts'
import { PlanningRoom } from './Rail.tsx'

const TWO_COLUMNS_FROM = 560
const PANEL_KEY = 'lab02.panel'

type PanelState = { view: 'room' | 'facts'; open: boolean }

function readPanel(phone: boolean): PanelState {
  try {
    const raw = localStorage.getItem(`${PANEL_KEY}.${phone ? 'phone' : 'laptop'}`)
    const v = raw ? (JSON.parse(raw) as PanelState) : null
    if (v && (v.view === 'room' || v.view === 'facts')) return { view: v.view, open: !!v.open }
  } catch { /* storage unavailable */ }
  return { view: 'room', open: !phone }
}

export function useCards(pv: PlanningView, content: PlanningContent): CardItem[] {
  return useMemo(() => [
    ...(content.brief ? [{ kind: 'letter' } as CardItem] : []),
    ...pv.tiles.map((t) => ({ kind: 'tile', investigation: t.investigation, tile: t.tile }) as CardItem),
  ], [pv.tiles, content.brief])
}

/** Which new cards the player has not had on screen for a few seconds yet. */
function useFresh(cards: CardItem[], root: React.RefObject<HTMLElement | null>) {
  const arrived = usePlayer((s) => s.arrived)
  const [seen, setSeen] = useState<Record<string, true>>({})
  const [offscreen, setOffscreen] = useState<string[]>([])
  const fresh = cards.filter((c) => c.kind === 'tile' && arrived[c.investigation] !== undefined && !seen[c.investigation]).map(cardKey)
  const freshKey = fresh.join(',')
  useEffect(() => {
    const el = root.current
    if (!el || !fresh.length) { setOffscreen([]); return }
    const timers = new Map<string, ReturnType<typeof setTimeout>>()
    const visible = new Set<string>()
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const k = (e.target as HTMLElement).dataset.card!
        if (e.isIntersecting) {
          visible.add(k)
          if (!timers.has(k)) timers.set(k, setTimeout(() => setSeen((s) => ({ ...s, [k]: true })), 3500))
        } else {
          visible.delete(k)
          const t = timers.get(k)
          if (t) { clearTimeout(t); timers.delete(k) }
        }
      }
      setOffscreen(fresh.filter((k) => !visible.has(k)))
    }, { root: el.closest('.colscroll') ?? null, threshold: 0.35 })
    for (const k of fresh) {
      const card = el.querySelector(`[data-card="${k}"]`)
      if (card) io.observe(card)
    }
    return () => { io.disconnect(); for (const t of timers.values()) clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freshKey])
  return { fresh: new Set(fresh), offscreen }
}

/** The panel above the cards: the reading room or the practice facts, with a switch and a collapse. */
function Panel({ w, content, pv, phone }: { w: Welcome; content: PlanningContent; pv: PlanningView; phone: boolean }) {
  const [st, setSt] = useState<PanelState>(() => readPanel(phone))
  const [tall, setTall] = useState(() => window.innerHeight >= 800)
  useEffect(() => {
    const on = () => setTall(window.innerHeight >= 800)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  const save = (n: PanelState) => {
    setSt(n)
    try { localStorage.setItem(`${PANEL_KEY}.${phone ? 'phone' : 'laptop'}`, JSON.stringify(n)) } catch { /* storage unavailable */ }
  }
  const viewH = phone ? 200 : tall ? 266 : 180
  return (
    <div className={`epanel${st.open ? '' : ' shut'}`}>
      <div className="ebar" role="tablist" aria-label={P1.panel}>
        {(['room', 'facts'] as const).map((v) => (
          <button key={v} type="button" role="tab" aria-selected={st.open && st.view === v} className={st.open && st.view === v ? 'on' : ''}
            onClick={() => save({ view: v, open: true })}>{v === 'room' ? P1.readingRoom : P1.practiceFacts}</button>
        ))}
        <button type="button" className="hide" aria-expanded={st.open} onClick={() => save({ ...st, open: !st.open })}>{st.open ? P1.hide : P1.show}</button>
      </div>
      {st.open && (
        <div className="eview" style={{ height: viewH }}>
          {st.view === 'room'
            ? <PlanningRoom w={w} content={content} pv={pv} cropHeight={viewH} maxHeight={phone ? 400 : 900} />
            : <FactsBody system={w.system} />}
        </div>
      )}
    </div>
  )
}

export function Wall({ w, content, pv, phone = false, focusCard, backTo }: {
  w: Welcome; content: PlanningContent; pv: PlanningView; phone?: boolean
  focusCard: { key: string; n: number } | null; backTo?: React.ReactNode
}) {
  const cards = useCards(pv, content)
  const scroller = useRef<HTMLDivElement>(null)
  const grid = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [open, setOpen] = useState<number | null>(null)
  const lastFocus = useRef<string | null>(null)
  const { fresh, offscreen } = useFresh(cards, grid)

  useLayoutEffect(() => {
    const el = grid.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  const cols = !phone && width >= TWO_COLUMNS_FROM ? 2 : 1

  useEffect(() => {
    if (!focusCard) return
    const el = grid.current?.querySelector<HTMLElement>(`[data-card="${focusCard.key}"]`)
    el?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    el?.classList.add('flash')
    const t = setTimeout(() => el?.classList.remove('flash'), 1200)
    return () => clearTimeout(t)
  }, [focusCard])

  const openAt = (i: number) => { lastFocus.current = cardKey(cards[i]!); setOpen(i) }
  const close = () => {
    setOpen(null)
    const k = lastFocus.current
    if (k) setTimeout(() => grid.current?.querySelector<HTMLElement>(`[data-card="${k}"]`)?.focus(), 0)
  }
  const newBtn = offscreen.length > 0 && (
    <button type="button" className="newchip" onClick={() => {
      const el = grid.current?.querySelector<HTMLElement>(`[data-card="${offscreen[0]}"]`)
      el?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }}>{P1.newN(offscreen.length)}</button>
  )

  return (
    <section className={`colbox wall${phone ? ' phone' : ''}`} aria-label={P1.evidence}>
      <div className="colhead lav">
        <span className="l">{!phone && <h2>{P1.evidence}</h2>}<span className="s">{P1.insights(pv.tiles.length, content.investigations.length)}</span></span>
        <span className="r">{newBtn}</span>
      </div>
      {backTo}
      <Panel w={w} content={content} pv={pv} phone={phone} />
      <div className="colscroll wall-scroll" ref={scroller}>
        <div className="cards" ref={grid} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {cards.map((c, i) => (
            <EvidenceCard key={cardKey(c)} item={c} content={content} system={w.system} art={w.art} fresh={fresh.has(cardKey(c))} onOpen={() => openAt(i)} />
          ))}
        </div>
        {pv.tiles.length === 0 && <div className="wall-empty">{phone ? P1.wallEmptyPhone : P1.wallEmpty}</div>}
      </div>
      {open !== null && (
        <CardOverlay items={cards} index={open} setIndex={(i) => { lastFocus.current = cardKey(cards[i]!); setOpen(i) }} onClose={close}
          content={content} system={w.system} art={w.art} phone={phone} />
      )}
    </section>
  )
}
