// Where the card of a tour or of the guided first build stands: beside the part of the screen it
// is about, never over it while there is room anywhere else.
import { useLayoutEffect, useState, type RefObject } from 'react'
import type { Rect } from '../lib/inView.ts'

/** The space kept around the lit part. */
export const GUIDE_PAD = 6
const WIDE = 340
/** A card beside the lit part may be narrower than usual when the room there is narrow. */
const NARROWER = [290, 240]
const EDGE = 12
/** The tabs at the foot of a phone, which a card stays above. */
const PHONE_TABS = 76

type Size = { w: number; h: number }
export type CardPlace = { left: number; top: number; width: number }

/** The size of the card as it was last drawn. The card is drawn again when it changes. */
export function useCardSize(card: RefObject<HTMLElement | null>, key: string): Size | null {
  const [size, setSize] = useState<Size | null>(null)
  useLayoutEffect(() => {
    const el = card.current
    if (!el) { setSize(null); return }
    const read = () => setSize((p) => (p && p.w === el.offsetWidth && p.h === el.offsetHeight ? p : { w: el.offsetWidth, h: el.offsetHeight }))
    read()
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [card, key])
  return size
}

/**
 * The place of the card: right of the lit part, left of it, below or above, whichever has room.
 * With no room on any side it stands in the corner of the screen where it covers least of the
 * part. `rect` is null while nothing is lit: the card then stands at `rest`.
 */
export function placeCard(rect: Rect | null, vw: Size, size: Size | null, rest: 'centre' | 'corner'): CardPlace {
  const narrow = vw.w < 640
  const full = Math.min(narrow ? vw.w - 2 * EDGE : WIDE, vw.w - 2 * EDGE)
  // The height at another width, from the one that was drawn: the same words take as much area.
  const heightAt = (w: number) => (size ? Math.ceil(size.h * Math.max(1, size.w / w)) : 200)
  const low = (h: number) => vw.h - h - (narrow ? PHONE_TABS : EDGE)
  const clamp = (c: CardPlace): CardPlace => ({
    width: c.width,
    left: Math.max(EDGE, Math.min(c.left, vw.w - c.width - EDGE)),
    top: Math.max(EDGE, Math.min(c.top, low(heightAt(c.width)))),
  })
  const ch = heightAt(full)
  if (!rect) return clamp(rest === 'centre' ? { left: (vw.w - full) / 2, top: (vw.h - ch) / 2, width: full } : { left: narrow ? EDGE : vw.w - full - EDGE, top: low(ch), width: full })
  const r = { l: rect.x - GUIDE_PAD, t: rect.y - GUIDE_PAD, r: rect.x + rect.w + GUIDE_PAD, b: rect.y + rect.h + GUIDE_PAD }
  if (!narrow) {
    const beside = (room: number) => [full, ...NARROWER].find((w) => w <= full && room >= w + 2 * EDGE && heightAt(w) <= vw.h - 2 * EDGE)
    const right = beside(vw.w - r.r)
    if (right) return clamp({ left: r.r + EDGE, top: r.t, width: right })
    const left = beside(r.l)
    if (left) return clamp({ left: r.l - left - EDGE, top: r.t, width: left })
  }
  if (vw.h - r.b >= ch + (narrow ? PHONE_TABS + EDGE : 2 * EDGE)) return clamp({ left: r.l, top: r.b + EDGE, width: full })
  if (r.t >= ch + 2 * EDGE) return clamp({ left: r.l, top: r.t - ch - EDGE, width: full })
  const covers = (c: CardPlace) =>
    Math.max(0, Math.min(c.left + c.width, r.r) - Math.max(c.left, r.l)) * Math.max(0, Math.min(c.top + ch, r.b) - Math.max(c.top, r.t))
  // A part that fills the screen keeps its top in view: the low corners come first.
  const corners = [{ left: EDGE, top: low(ch) }, { left: vw.w - full - EDGE, top: low(ch) }, { left: EDGE, top: EDGE }, { left: vw.w - full - EDGE, top: EDGE }]
    .map((c) => clamp({ ...c, width: full }))
  return corners.reduce((best, c) => (covers(c) < covers(best) ? c : best))
}
