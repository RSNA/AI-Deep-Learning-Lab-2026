// The evidence wall (engineering spec, section 10.4): every insight in hand as a full card, two
// or three to a row, in order of arrival, with the Practice card pinned first.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PlanningContent, PlanningView, Welcome } from '@lab02/protocol'
import { usePlayer } from '../lib/player.ts'
import { CardOverlay, EvidenceCard, cardKey, type CardItem } from './Cards.tsx'
import { P1 } from './copy.ts'

const MIN_CARD = 224
const GAP = 12
const PER_ROW_KEY = 'lab02.cardsPerRow'

function readPerRow(): number | null {
  try { const v = Number(localStorage.getItem(PER_ROW_KEY)); return v >= 1 && v <= 3 ? v : null } catch { return null }
}

export function useCards(pv: PlanningView): CardItem[] {
  return useMemo(() => [{ kind: 'practice' } as CardItem, ...pv.tiles.map((t) => ({ kind: 'tile', investigation: t.investigation, tile: t.tile }) as CardItem)], [pv.tiles])
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
    }, { root: el.closest('.wall-scroll') ?? null, threshold: 0.35 })
    for (const k of fresh) {
      const card = el.querySelector(`[data-card="${k}"]`)
      if (card) io.observe(card)
    }
    return () => { io.disconnect(); for (const t of timers.values()) clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freshKey])
  return { fresh: new Set(fresh), offscreen }
}

export function Wall({ w, content, pv, phone = false, focusCard, backTo }: {
  w: Welcome; content: PlanningContent; pv: PlanningView; phone?: boolean
  focusCard: { key: string; n: number } | null; backTo?: React.ReactNode
}) {
  const cards = useCards(pv)
  const scroller = useRef<HTMLDivElement>(null)
  const grid = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [chosen, setChosen] = useState<number | null>(() => readPerRow())
  const [open, setOpen] = useState<number | null>(null)
  const lastFocus = useRef<string | null>(null)
  const { fresh, offscreen } = useFresh(cards, grid)

  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  // As many columns as were chosen, but never a card narrower than the minimum.
  const fit = Math.max(1, Math.floor((width - 4 + GAP) / (MIN_CARD + GAP)))
  const auto = Math.min(3, fit)
  const cols = phone ? 1 : Math.min(chosen ?? auto, fit, 3)

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
  const pick = (n: number) => {
    setChosen(n)
    try { localStorage.setItem(PER_ROW_KEY, String(n)) } catch { /* storage unavailable */ }
  }

  return (
    <section className={`wall${phone ? ' phone' : ''}`} aria-label={P1.evidence}>
      <div className="coltitle">
        <h2>{P1.evidence}</h2>
        <span className="sub">{P1.insights(pv.tiles.length, content.investigations.length)}</span>
        {!phone && (
          <span className="perrow">
            <span className="sub">{P1.perRow}</span>
            <span className="seg mini" role="group" aria-label={P1.perRow}>
              {[1, 2, 3].map((n) => (
                <button key={n} type="button" aria-pressed={cols === n} disabled={n > fit} title={n > fit ? P1.perRowTooWide : undefined} onClick={() => pick(n)}>{n}</button>
              ))}
            </span>
          </span>
        )}
      </div>
      {backTo}
      <div className="wall-scroll" ref={scroller}>
        <div className="cards" ref={grid} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {cards.map((c, i) => (
            <EvidenceCard key={cardKey(c)} item={c} content={content} system={w.system} art={w.art} fresh={fresh.has(cardKey(c))} onOpen={() => openAt(i)} />
          ))}
        </div>
        {pv.tiles.length === 0 && <div className="wall-empty">{phone ? P1.wallEmptyPhone : P1.wallEmpty}</div>}
      </div>
      {offscreen.length > 0 && (
        <button type="button" className="newchip" onClick={() => {
          const el = grid.current?.querySelector<HTMLElement>(`[data-card="${offscreen[0]}"]`)
          el?.scrollIntoView({ block: 'start', behavior: 'smooth' })
        }}>{P1.newBelow} ↓</button>
      )}
      {open !== null && (
        <CardOverlay items={cards} index={open} setIndex={(i) => { lastFocus.current = cardKey(cards[i]!); setOpen(i) }} onClose={close}
          content={content} system={w.system} art={w.art} phone={phone} />
      )}
    </section>
  )
}
