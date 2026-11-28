// A card of one standard size (engineering spec, section 10.1): a row of cards keeps one height
// whatever each of them holds. Text that does not fit is cut, and a button below it shows the
// rest. With `pop` the whole card opens in a window in the middle of the screen, which the
// reader closes, and the card in its row never grows. Without it the card opens in place and a
// second press closes it again (the cards of a chooser, which already stand in a window).
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Sheet } from './ui.tsx'

export function ClampCard({ className = '', head, bodyClass = '', children, foot, words, pop, ...rest }: {
  className?: string
  head: ReactNode
  bodyClass?: string
  children: ReactNode
  /** What stands under the text whether it is cut or not: the button of a choice, say. */
  foot?: ReactNode
  words: { more: string; less: string }
  /** Open the whole card in a window: the title and the color of its bar (what the head of the card says), and the word on its button. */
  pop?: { title: string; head?: string; close: string }
} & Omit<React.HTMLAttributes<HTMLElement>, 'className' | 'children'>) {
  const box = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [over, setOver] = useState(false)
  useLayoutEffect(() => {
    const b = box.current, i = inner.current
    if (!b || !i) return
    // Measured while the card is closed. An open card keeps its button, to close it again.
    const check = () => { if (!b.classList.contains('open')) setOver(i.scrollHeight > b.clientHeight + 2) }
    check()
    const ro = new ResizeObserver(check)
    ro.observe(b)
    ro.observe(i)
    return () => ro.disconnect()
  }, [])
  const inPlace = open && !pop
  return (
    <article className={`stdcard${inPlace ? ' open' : ''} ${className}`} {...rest}>
      {head}
      <div ref={box} className={`clamp-box${inPlace ? ' open' : ''}${over && !inPlace ? ' cut' : ''}`}>
        <div ref={inner} className={bodyClass}>{children}</div>
      </div>
      <div className="clamp-foot">
        {over && (
          <button type="button" className="clamp-btn" aria-expanded={pop ? undefined : open} aria-haspopup={pop ? 'dialog' : undefined}
            onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }}>{inPlace ? words.less : words.more}<span aria-hidden="true">{inPlace ? ' ▴' : pop ? ' ⤢' : ' ▾'}</span></button>
        )}
      </div>
      {foot}
      {open && pop && createPortal(
        <Sheet title={pop.title} head={pop.head ?? 'lav'} onClose={() => setOpen(false)} className="cardsheet">
          <div className="card cardpop"><div className={bodyClass}>{children}</div></div>
          <div className="sheet-actions"><button type="button" className="btn go" autoFocus onClick={() => setOpen(false)}>{pop.close}</button></div>
        </Sheet>,
        document.body,
      )}
    </article>
  )
}
