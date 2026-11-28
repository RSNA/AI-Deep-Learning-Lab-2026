// What of an element shows on the screen, and how a tour brings the part it points at into view.

export type Rect = { x: number; y: number; w: number; h: number }

/** The part of an element that shows: inside the window and inside every box that scrolls or clips it. */
export function shownRect(el: HTMLElement): Rect | null {
  const r = el.getBoundingClientRect()
  let l = Math.max(r.left, 0), t = Math.max(r.top, 0), rt = Math.min(r.right, window.innerWidth), b = Math.min(r.bottom, window.innerHeight)
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const s = getComputedStyle(p)
    if (s.overflowX === 'visible' && s.overflowY === 'visible') continue
    const c = p.getBoundingClientRect()
    if (s.overflowX !== 'visible') { l = Math.max(l, c.left); rt = Math.min(rt, c.right) }
    if (s.overflowY !== 'visible') { t = Math.max(t, c.top); b = Math.min(b, c.bottom) }
  }
  return rt - l > 8 && b - t > 8 ? { x: l, y: t, w: rt - l, h: b - t } : null
}

/** The part of the screen that the children of an element take, where they show. The element's own part when it has none. */
export function shownChildrenRect(el: HTMLElement): Rect | null {
  const rects = [...el.children].map((c) => shownRect(c as HTMLElement)).filter((r): r is Rect => !!r)
  if (!rects.length) return shownRect(el)
  const l = Math.min(...rects.map((r) => r.x)), t = Math.min(...rects.map((r) => r.y))
  return { x: l, y: t, w: Math.max(...rects.map((r) => r.x + r.w)) - l, h: Math.max(...rects.map((r) => r.y + r.h)) - t }
}

/**
 * Scroll the page and every box around an element until the element shows. One that shows whole
 * already stays where it is. One that fits the window comes to its middle, which leaves room for
 * a card above or below it. A taller one shows from its top.
 */
export function bringIntoView(el: HTMLElement): void {
  const r = el.getBoundingClientRect()
  const s = shownRect(el)
  if (s && s.w >= r.width - 1 && s.h >= r.height - 1) return
  const fits = r.height <= window.innerHeight - 24
  // A tall part that shows from its top over half the window is in view as far as it can be.
  if (!fits && s && s.y - r.top < 1 && s.h >= window.innerHeight / 2) return
  el.scrollIntoView({ block: fits ? 'center' : 'start', inline: 'nearest' })
}
