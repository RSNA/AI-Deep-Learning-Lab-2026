// Evidence, the centre column of Phase 1 (engineering spec, section 10.4): one panel with the
// reading room or the practice facts, then the cards, the newest first: every insight from the
// last one that arrived back to the first, then the opening letter. Two cards per row from
// 560 px, one below. Nothing is clamped.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PlanningContent, PlanningView, Welcome } from '@lab02/protocol'
import { usePlayer } from '../lib/player.ts'
import { CardOverlay, EvidenceCard, FactsBody, cardKey, type CardItem } from './Cards.tsx'
import { P1 } from './copy.ts'
import { Sizable, useHeight } from '../components/sizable.tsx'
import { STAGE_BAND, stripHeight } from '../scene/band.ts'
import { PlanningRoom } from './Rail.tsx'

const TWO_COLUMNS_FROM = 560
const PANEL_KEY = 'lab02.panel'
const CARDS_KEY = 'lab02.cards'

function readPerRow(): 1 | 2 {
  try { return localStorage.getItem(CARDS_KEY) === '1' ? 1 : 2 } catch { return 2 }
}

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
  // The view lists the insights in the order they arrived.
  return useMemo(() => [
    ...pv.tiles.map((t) => ({ kind: 'tile', investigation: t.investigation, tile: t.tile }) as CardItem).reverse(),
    ...(content.brief ? [{ kind: 'letter' } as CardItem] : []),
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
function Panel({ w, content, pv, phone, width }: { w: Welcome; content: PlanningContent; pv: PlanningView; phone: boolean; width: number }) {
  const [st, setSt] = useState<PanelState>(() => readPanel(phone))
  const [winH, setWinH] = useState(() => window.innerHeight)
  useEffect(() => {
    const on = () => setWinH(window.innerHeight)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  const save = (n: PanelState) => {
    setSt(n)
    try { localStorage.setItem(`${PANEL_KEY}.${phone ? 'phone' : 'laptop'}`, JSON.stringify(n)) } catch { /* storage unavailable */ }
  }
  // The height the room takes by itself, until the player drags the edge under it (section 10.4).
  const [viewH, setViewH] = useHeight(`lab02.striph.${phone ? 'phone' : 'laptop'}`, stripHeight(phone, width, winH))
  return (
    <div className={`epanel${st.open ? '' : ' shut'}`} data-tour="p1-room">
      <div className="ebar" role="tablist" aria-label={P1.panel}>
        {(['room', 'facts'] as const).map((v) => (
          <button key={v} type="button" role="tab" aria-selected={st.open && st.view === v} className={st.open && st.view === v ? 'on' : ''}
            onClick={() => save({ view: v, open: true })}>{v === 'room' ? P1.readingRoom : P1.practiceFacts}</button>
        ))}
        <button type="button" className="hide" aria-expanded={st.open} onClick={() => save({ ...st, open: !st.open })}>{st.open ? P1.hide : P1.show}</button>
      </div>
      {st.open && (
        <Sizable height={viewH} setHeight={setViewH} min={STAGE_BAND * 2} max={Math.max(200, Math.round(winH * 0.6))} label={P1.dragRoom}>
          {(h) => (
            <div className="eview" style={st.view === 'room' ? undefined : { height: h }}>
              {st.view === 'room'
                ? <PlanningRoom w={w} content={content} pv={pv} cropHeight={h} maxHeight={phone ? 400 : 900} />
                : <FactsBody system={w.system} />}
            </div>
          )}
        </Sizable>
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

  // Two cards per row when the column is 560 px wide or more (section 10.4).
  useLayoutEffect(() => {
    const el = scroller.current?.closest('.colbox') as HTMLElement | null
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  // Two cards per row is the default on a wide column. The player may choose one, and the
  // browser remembers the choice.
  const [perRow, setPerRow] = useState<1 | 2>(readPerRow)
  const wide = !phone && width >= TWO_COLUMNS_FROM
  const cols = wide ? perRow : 1
  const pickPerRow = (n: 1 | 2) => {
    setPerRow(n)
    try { localStorage.setItem(CARDS_KEY, String(n)) } catch { /* storage unavailable */ }
  }

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
        <span className="r">
          {newBtn}
          {wide && (
            <span className="rowseg" role="group" aria-label={P1.cardsPerRow}>
              {([1, 2] as const).map((n) => (
                <button key={n} type="button" aria-pressed={perRow === n} aria-label={P1.perRow(n)} title={P1.perRow(n)} onClick={() => pickPerRow(n)}>
                  {Array.from({ length: n }, (_, i) => <i key={i} aria-hidden="true" />)}
                </button>
              ))}
            </span>
          )}
        </span>
      </div>
      {backTo}
      <Panel w={w} content={content} pv={pv} phone={phone} width={width} />
      <div className="colscroll wall-scroll" ref={scroller} data-tour="p1-wall">
        <div className={`cards${wide && cols === 1 ? ' single' : ''}`} ref={grid} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
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
