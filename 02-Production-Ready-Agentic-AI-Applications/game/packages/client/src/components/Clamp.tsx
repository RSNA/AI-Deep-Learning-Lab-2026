// A card of one standard size (engineering spec, section 10.1): a row of cards keeps one height
// whatever each of them holds. Text that does not fit is cut, and a button below it shows the
// rest and hides it again. A card that fits has no button and the same height.
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

export function ClampCard({ className = '', head, bodyClass = '', children, foot, words, ...rest }: {
  className?: string
  head: ReactNode
  bodyClass?: string
  children: ReactNode
  /** What stands under the text whether it is cut or not: the button of a choice, say. */
  foot?: ReactNode
  words: { more: string; less: string }
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
  return (
    <article className={`stdcard${open ? ' open' : ''} ${className}`} {...rest}>
      {head}
      <div ref={box} className={`clamp-box${open ? ' open' : ''}${over && !open ? ' cut' : ''}`}>
        <div ref={inner} className={bodyClass}>{children}</div>
      </div>
      <div className="clamp-foot">
        {over && <button type="button" className="clamp-btn" aria-expanded={open} onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }}>{open ? words.less : words.more}<span aria-hidden="true">{open ? ' ▴' : ' ▾'}</span></button>}
      </div>
      {foot}
    </article>
  )
}
