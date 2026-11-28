// Two pages for facilitators beside the console (engineering spec, section 10.8): the facilitator
// guide at /host/guide, with a menu of its parts and a search, and every slide of the deck at
// /host/slides. Both ask for the facilitator passcode the way the console does and keep the same
// sign-in, so a facilitator who is signed in to one is signed in to all three.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import type { HostSlides } from '@lab02/protocol/host'
import { plainError } from '../lib/errors.ts'
import { SEARCH_MIN, buildOutline, findRanges, partAt, type OutlinePart } from '../lib/guideDoc.ts'
import { hostFetch } from '../lib/net.ts'
import { store } from '../lib/storage.ts'
import { useTheme } from '../lib/theme.ts'
import { SlideThumb } from '../components/slide.tsx'
import { Login, openPrivatePage } from './Host.tsx'
import { H } from './hostCopy.ts'

const P = H.pages
type Go = (path: string) => void
type Pages = { guide: boolean; key: boolean; slides: number }

/** The sign-in of the console, read from this browser. A page that is told its sign-in has ended asks for it again. */
function useHostToken() {
  const [token, setToken] = useState<string | null>(() => store.host()?.token ?? null)
  const [ended, setEnded] = useState(false)
  const signedOut = useCallback(() => { store.setHost(null); setToken(null); setEnded(true) }, [])
  const signedIn = useCallback((t: string) => { setEnded(false); setToken(t) }, [])
  return { token, ended, signedOut, signedIn }
}

/** What this server has for a facilitator to open. Null until it is known. */
function usePages(token: string, signedOut: () => void): Pages | null {
  const [pages, setPages] = useState<Pages | null>(null)
  useEffect(() => {
    let live = true
    void hostFetch<Pages>(token, '/api/host/pages').then((r) => {
      if (!live) return
      if (r.ok) setPages(r.data)
      else if (r.status === 401) signedOut()
    })
    return () => { live = false }
  }, [token, signedOut])
  return pages
}

/**
 * The bar at the very top of both pages: where a facilitator is, and one link to each of the
 * other pages. The page that is open stays in the row as a pressed link, so the row never moves.
 */
function HostBar({ here, token, pages, go, children }: { here: 'guide' | 'slides'; token: string; pages: Pages | null; go: Go; children?: ReactNode }) {
  const [refusal, setRefusal] = useState<string | null>(null)
  const inPage = (to: string) => (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
    e.preventDefault()
    go(to)
  }
  const link = (to: string, label: string, on: boolean) => (
    <a className={`btn small text${on ? ' on' : ''}`} href={to} aria-current={on ? 'page' : undefined} onClick={inPage(to)}>{label}</a>
  )
  return (
    <header className="hostbar">
      <span className="hostbar-title">{here === 'guide' ? H.guide : H.allSlides}</span>
      {children}
      <nav className="hostbar-links" aria-label={P.barLabel}>
        {(here === 'guide' || pages?.guide) && link('/host/guide', H.guide, here === 'guide')}
        {link('/host/slides', H.allSlides, here === 'slides')}
        {link('/host', H.console, false)}
        <a className="btn small text" href="/host/manual" target="lab02-manual">{H.manual}</a>
        {pages?.key && <button type="button" className="btn small text" title={H.answerKeyLine} onClick={() => void openPrivatePage(token, 'key').then(setRefusal)}>{H.answerKey}</button>}
      </nav>
      {refusal && <div className="err hostbar-err" role="alert">{refusal}</div>}
    </header>
  )
}

// ------------------------------------------------------------------------------------------
// The facilitator guide
// ------------------------------------------------------------------------------------------

/** What the page adds to the guide's own styles: room around the text on a screen, and the marks of a search. */
const FRAME_STYLE = `
html{scroll-padding-top:14px;background:#ebe8df}
body{max-width:900px;margin:0 auto!important;padding:22px 30px 96px;background:#fff;min-height:100vh;overflow-wrap:break-word}
.cover{height:auto!important}
img{max-width:100%}
mark.lab02-hit{background:#ffe27a;color:inherit;padding:0}
mark.lab02-hit.at{background:#ff9a3c;outline:2px solid #17142b}
.lab02-scroll{overflow-x:auto;max-width:100%}
@media (max-width:640px){body{padding:14px 14px 72px}body div{min-width:0}.lab02-scroll>table{display:table!important;min-width:var(--lab02-min,0)}}
`

type Hit = { part: number }
type Found = { hits: Hit[]; byPart: number[] }
const BLOCKS = 'p,li,td,th,h1,h2,h3,h4,h5,h6,figcaption,dt,dd,div,section,blockquote,pre'

/** Every text of a document in reading order, as one string, with where each piece starts in it. */
function textOf(doc: Document): { text: string; nodes: { node: Text; start: number }[] } {
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
  const nodes: { node: Text; start: number }[] = []
  let text = ''
  let block: Element | null = null
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const parent = (n as Text).parentElement
    if (!parent || parent.closest('script,style')) continue
    // A line break between two blocks, so that a phrase is not found across the end of a paragraph by accident of spelling.
    const own = parent.closest(BLOCKS)
    if (nodes.length && own !== block) text += '\n'
    block = own
    nodes.push({ node: n as Text, start: text.length })
    text += (n as Text).data
  }
  return { text, nodes }
}

/** Takes the marks of the last search out of the document again. */
function clearMarks(doc: Document): void {
  const marks = doc.querySelectorAll('mark.lab02-hit')
  if (!marks.length) return
  for (const m of marks) m.replaceWith(doc.createTextNode(m.textContent ?? ''))
  doc.body.normalize()
}

/** Marks every place where the phrase stands, and says in which part of the menu each one is. */
function markAll(doc: Document, query: string, partStarts: Element[]): Found {
  clearMarks(doc)
  const { text, nodes } = textOf(doc)
  const ranges = findRanges(text, query)
  if (!ranges.length) return { hits: [], byPart: partStarts.map(() => 0) }
  // Where each part of the menu starts in the text: at the first text of its heading or after it.
  const starts = partStarts.map((el) => {
    const first = nodes.find((x) => el.contains(x.node) || !!(el.compareDocumentPosition(x.node) & Node.DOCUMENT_POSITION_FOLLOWING))
    return first ? first.start : text.length
  })
  // A place may run over several pieces of text, for example a phrase with one bold word in it.
  const cuts: { node: Text; from: number; to: number; hit: number }[] = []
  let k = 0
  ranges.forEach(([a, b], hit) => {
    while (k < nodes.length - 1 && nodes[k + 1]!.start <= a) k++
    for (let i = k; i < nodes.length && nodes[i]!.start < b; i++) {
      const { node, start } = nodes[i]!
      const from = Math.max(a, start) - start, to = Math.min(b, start + node.data.length) - start
      if (to > from) cuts.push({ node, from, to, hit })
    }
  })
  // From the end, so that a cut never moves the ones before it in the same piece of text.
  for (let i = cuts.length - 1; i >= 0; i--) {
    const c = cuts[i]!
    const mid = c.node.splitText(c.from)
    mid.splitText(c.to - c.from)
    const mark = doc.createElement('mark')
    mark.className = 'lab02-hit'
    mark.dataset.hit = String(c.hit)
    mid.replaceWith(mark)
    mark.appendChild(mid)
  }
  const hits = ranges.map(([a]) => ({ part: partAt(starts, a) }))
  const byPart = partStarts.map(() => 0)
  for (const h of hits) if (h.part >= 0) byPart[h.part]!++
  return { hits, byPart }
}

function GuideView({ token, signedOut, go }: { token: string; signedOut: () => void; go: Go }) {
  const pages = usePages(token, signedOut)
  const [html, setHtml] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const [outline, setOutline] = useState<OutlinePart[]>([])
  const heads = useRef<HTMLElement[]>([])
  const [here, setHere] = useState(-1)
  const [menuOpen, setMenuOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<Found | null>(null)
  const [at, setAt] = useState(0)
  const [ready, setReady] = useState(0)

  const load = useCallback(async () => {
    setErr(null)
    // The guide is read with a ticket, as its own window reads it, so no ticket ever stands in an address.
    const t = await hostFetch<{ ticket: string }>(token, '/api/host/guide-ticket', {})
    if (!t.ok) { if (t.status === 401) signedOut(); else setErr(t.error === 'no_guide' || t.error === 'network' ? plainError(t.error) : P.guideFailed); return }
    try {
      const res = await fetch(`/api/host/guide?ticket=${encodeURIComponent(t.data.ticket)}`)
      if (!res.ok) { setErr(P.guideFailed); return }
      setHtml(await res.text())
    } catch {
      setErr(plainError('network'))
    }
  }, [token, signedOut])
  useEffect(() => { void load() }, [load])

  const doc = () => frame.current?.contentDocument ?? null
  /** The headings of the menu, parts and what stands under them, in the order of the page. */
  const flat = useMemo(() => outline.flatMap((p) => [p.at, ...p.children.map((c) => c.at)]), [outline])

  // The guide is in the frame: give it room on a screen, read its headings and follow its links.
  const onFrame = useCallback(() => {
    const d = frame.current?.contentDocument
    const w = frame.current?.contentWindow
    if (!d?.body || !w) return
    if (!d.getElementById('lab02-frame-style')) {
      const style = d.createElement('style')
      style.id = 'lab02-frame-style'
      style.textContent = FRAME_STYLE
      d.head.appendChild(style)
    }
    // A table with many columns keeps a width it can be read at on a phone, and scrolls sideways in a box of its own.
    for (const table of d.body.querySelectorAll('table')) {
      if (table.parentElement?.classList.contains('lab02-scroll')) continue
      const cols = Math.max(0, ...[...table.rows].map((r) => r.cells.length))
      const box = d.createElement('div')
      box.className = 'lab02-scroll'
      if (cols >= 4) box.style.setProperty('--lab02-min', `${cols * 130}px`)
      table.replaceWith(box)
      box.appendChild(table)
    }
    const hs = [...d.body.querySelectorAll<HTMLElement>('h1,h2,h3,h4')]
    heads.current = hs
    setOutline(buildOutline(hs.map((h) => ({ level: Number(h.tagName[1]), text: h.textContent ?? '' }))))
    // A link inside the guide: one to a place of the guide scrolls there, any other opens in a window of its own.
    d.addEventListener('click', (e) => {
      const a = (e.target as Element | null)?.closest?.('a[href]')
      if (!a) return
      e.preventDefault()
      const href = a.getAttribute('href') ?? ''
      if (href.startsWith('#')) d.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView({ block: 'start' })
      else window.open(a.getAttribute('href')!, '_blank', 'noopener')
    })
    setReady((n) => n + 1)
  }, [])

  // Which heading the reader is at: the last one that has passed the top of the frame.
  useEffect(() => {
    const w = frame.current?.contentWindow
    if (!w || !flat.length) return
    let raf = 0
    const spy = () => {
      raf = 0
      let cur = -1
      for (const i of flat) {
        if ((heads.current[i]?.getBoundingClientRect().top ?? Infinity) <= 60) cur = i
        else break
      }
      setHere(cur)
    }
    const on = () => { if (!raf) raf = w.requestAnimationFrame(spy) }
    w.addEventListener('scroll', on, { passive: true })
    w.addEventListener('resize', on)
    spy()
    return () => { w.removeEventListener('scroll', on); w.removeEventListener('resize', on); if (raf) w.cancelAnimationFrame(raf) }
  }, [flat, ready])

  // The menu follows the reader: the heading they are at stays in view in it.
  const side = useRef<HTMLElement>(null)
  useEffect(() => { side.current?.querySelector('.at')?.scrollIntoView({ block: 'nearest' }) }, [here])

  const jump = (i: number) => {
    heads.current[i]?.scrollIntoView({ block: 'start' })
    setHere(i)
    setMenuOpen(false)
  }

  // The search: a short pause after the last letter, then every place is marked.
  const asked = query.trim()
  useEffect(() => {
    const d = doc()
    if (!d?.body || !ready) return
    if (asked.length < SEARCH_MIN) { clearMarks(d); setFound(null); return }
    const timer = setTimeout(() => {
      const res = markAll(d, asked, outline.map((p) => heads.current[p.at]!).filter(Boolean))
      setFound(res)
      setAt(0)
    }, 180)
    return () => clearTimeout(timer)
  }, [asked, ready, outline])

  // The place the reader is at carries its own colour and comes into view.
  useEffect(() => {
    const d = doc()
    if (!d || !found?.hits.length) return
    for (const m of d.querySelectorAll('mark.lab02-hit.at')) m.classList.remove('at')
    const marks = d.querySelectorAll<HTMLElement>(`mark.lab02-hit[data-hit="${at}"]`)
    for (const m of marks) m.classList.add('at')
    marks[0]?.scrollIntoView({ block: 'center', inline: 'center' })
  }, [found, at])

  const n = found?.hits.length ?? 0
  const step = (by: number) => { if (n) setAt((x) => (x + by + n) % n) }
  const status = !asked ? null : asked.length < SEARCH_MIN ? P.searchShort : !found ? null : n ? P.searchAt(at + 1, n) : P.searchNone(asked)
  // The marks of the parts stand in the menu while a search is on.
  const hitsOf = (k: number) => (found && n ? found.byPart[k] ?? 0 : 0)

  return (
    <div className="hostpage guidepage">
      <HostBar here="guide" token={token} pages={pages} go={go} />
      <div className="guidetools">
        <button type="button" className="btn small text guidemenu-btn" aria-expanded={menuOpen} aria-controls="guide-menu" onClick={() => setMenuOpen(!menuOpen)}>{P.contents}</button>
        <form className="guidesearch" role="search" onSubmit={(e) => { e.preventDefault(); step(1) }}>
          <label className="lbl" htmlFor="guide-q">{P.search}</label>
          <input id="guide-q" className="field slim" type="search" value={query} placeholder={P.searchHint} autoComplete="off" spellCheck={false}
            aria-describedby="guide-q-status" disabled={!html}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); step(-1) } else if (e.key === 'Escape') setQuery('') }} />
          <button type="button" className="btn small text" onClick={() => step(-1)} disabled={n < 2} title={n < 2 ? P.searchStepOff : undefined}>{P.searchPrev}</button>
          <button type="submit" className="btn small text" disabled={n < 2} title={n < 2 ? P.searchStepOff : undefined}>{P.searchNext}</button>
          <button type="button" className="btn small text" onClick={() => setQuery('')} disabled={!query} title={query ? undefined : P.searchClearOff}>{P.searchClear}</button>
          <span id="guide-q-status" className={`guidesearch-status${asked.length >= SEARCH_MIN && found && !n ? ' none' : ''}`} role="status">{status}</span>
        </form>
      </div>
      <div className="guidewrap">
        <nav ref={side} id="guide-menu" className={`guideside${menuOpen ? ' open' : ''}`} aria-label={P.contents}>
          <div className="guideside-head">
            <span className="eyebrow">{P.contents}</span>
            <button type="button" className="btn small text guideside-close" onClick={() => setMenuOpen(false)}>{H.close}</button>
          </div>
          <div className="hint">{P.keepOff}</div>
          {html && !outline.length && !!ready && <div className="hint">{P.contentsNone}</div>}
          <ol className="guideparts">
            {outline.map((p, k) => {
              const open = here === p.at || p.children.some((c) => c.at === here)
              return (
                <li key={p.at}>
                  <button type="button" className={`guidepart${open ? ' open' : ''}${here === p.at ? ' at' : ''}`} aria-current={here === p.at ? 'location' : undefined} onClick={() => jump(p.at)}>
                    <span>{p.text}</span>
                    {hitsOf(k) > 0 && <span className="guidehits num" title={P.hits(hitsOf(k))} aria-label={P.hits(hitsOf(k))}>{hitsOf(k)}</span>}
                  </button>
                  {p.children.length > 0 && (
                    <ol className="guidesubs">
                      {p.children.map((c) => (
                        <li key={c.at}>
                          <button type="button" className={`guidesub${here === c.at ? ' at' : ''}`} aria-current={here === c.at ? 'location' : undefined} onClick={() => jump(c.at)}>{c.text}</button>
                        </li>
                      ))}
                    </ol>
                  )}
                </li>
              )
            })}
          </ol>
        </nav>
        {menuOpen && <button type="button" className="guideside-shade" aria-label={H.close} onClick={() => setMenuOpen(false)} />}
        <div className="guidebody">
          {err && (
            <div className="guidemsg">
              <div className="err" role="alert">{err}</div>
              <button type="button" className="btn small text" onClick={() => void load()}>{P.retry}</button>
            </div>
          )}
          {!err && !html && <div className="guidemsg muted" role="status">{P.guideLoading}</div>}
          {html && <iframe ref={frame} className="guideframe" title={P.guideFrame} srcDoc={html} onLoad={onFrame} />}
        </div>
      </div>
    </div>
  )
}

/** The facilitator guide, at /host/guide. */
export function GuidePage({ go }: { go: Go }) {
  const { token, ended, signedOut, signedIn } = useHostToken()
  if (!token) return <Login title={H.guide} line={ended ? plainError('unauthorized') : P.signInGuide} onToken={signedIn} />
  return <GuideView token={token} signedOut={signedOut} go={go} />
}

// ------------------------------------------------------------------------------------------
// All slides
// ------------------------------------------------------------------------------------------
function SlidesView({ token, signedOut, go }: { token: string; signedOut: () => void; go: Go }) {
  const pages = usePages(token, signedOut)
  const [deck, setDeck] = useState<HostSlides | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const page = useTheme()
  const [theme, setTheme] = useState<'light' | 'dark'>(page)
  const box = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(960)

  const load = useCallback(async () => {
    setErr(null)
    const r = await hostFetch<HostSlides>(token, '/api/host/slides')
    if (r.ok) setDeck(r.data)
    else if (r.status === 401) signedOut()
    else setErr(r.error === 'network' ? plainError(r.error) : P.slidesFailed)
  }, [token, signedOut])
  useEffect(() => { void load() }, [load])

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    // The frame around a slide takes three pixels on each side.
    const fit = () => setW(Math.max(240, Math.floor(el.clientWidth) - 6))
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    fit()
    return () => ro.disconnect()
  }, [deck])

  const slides = useMemo(() => deck?.slides ?? [], [deck])
  const n = slides.length
  // The parts of the deck, each with its first slide, for the list that jumps.
  const sections = useMemo(() => {
    const out: { id: string; title: string; first: number }[] = []
    slides.forEach((x, i) => { if (out.at(-1)?.id !== x.section) out.push({ id: x.section, title: x.slide.section, first: i }) })
    return out
  }, [slides])
  const scrollTo = (i: number) => document.getElementById(`slide-${i + 1}`)?.scrollIntoView({ block: 'start' })

  return (
    <div className="hostpage slidespage">
      <HostBar here="slides" token={token} pages={pages} go={go} />
      <main className="slideslist">
        {err && (
          <div className="guidemsg">
            <div className="err" role="alert">{err}</div>
            <button type="button" className="btn small text" onClick={() => void load()}>{P.retry}</button>
          </div>
        )}
        {!err && !deck && <div className="guidemsg muted" role="status">{P.slidesLoading}</div>}
        {deck && n === 0 && <div className="guidemsg muted" role="status">{H.noSlides}</div>}
        {deck && n > 0 && (
          <>
            <p className="slides-line">{P.slidesLine(n)}</p>
            <div className="slidestools">
              {sections.length > 1 && (
                <div className="slidestool">
                  <label className="lbl" htmlFor="slides-jump">{P.jump}</label>
                  <select id="slides-jump" className="field slim" value="" onChange={(e) => { const s = sections.find((x) => x.id === e.target.value); if (s) scrollTo(s.first) }}>
                    <option value="" disabled>{P.jumpPick}</option>
                    {sections.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
                  </select>
                </div>
              )}
              <div className="slidestool">
                <span className="lbl" id="slides-theme">{P.slideTheme}</span>
                <div className="seg" role="group" aria-labelledby="slides-theme">
                  <button type="button" aria-pressed={theme === 'light'} onClick={() => setTheme('light')}>{P.light}</button>
                  <button type="button" aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}>{P.dark}</button>
                </div>
              </div>
            </div>
            <div ref={box} className="slidesbox">
              {slides.map((x, i) => (
                <section key={i} id={`slide-${i + 1}`} className="slidecard" aria-labelledby={`slide-${i + 1}-h`}>
                  <h2 id={`slide-${i + 1}-h`} className="slidehead">
                    <span className="slidehead-n">{P.slideOf(i + 1, n)}</span>
                    <span className="slidehead-t">{x.slide.title}</span>
                    <span className="slidehead-s">{x.slide.section}</span>
                    {x.placeholder && <span className="flag warn">{H.placeholder}</span>}
                  </h2>
                  <div className="slideframe"><SlideThumb sl={x.slide} joinUrl={deck.joinUrl} width={w} theme={theme} meta={<span>{x.slide.section}</span>} plain /></div>
                  {x.notes && <div className="notes"><b>{H.notes}</b><span>{x.notes}</span></div>}
                </section>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  )
}

/** Every slide of the deck from the first to the last, at /host/slides. */
export function SlidesPage({ go }: { go: Go }) {
  const { token, ended, signedOut, signedIn } = useHostToken()
  if (!token) return <Login title={H.allSlides} line={ended ? plainError('unauthorized') : P.signInSlides} onToken={signedIn} />
  return <SlidesView token={token} signedOut={signedOut} go={go} />
}
