// Investigations, the left column of Phase 1 (engineering spec, section 10.4): the bandwidth on
// top, then one row per investigation. A running interview's row holds every line released so
// far. The reading room lives in the panel of the evidence; its scene plays the interviews.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { PlanningContent, PlanningView, Welcome } from '@lab02/protocol'
import { Portrait } from '../components/ui.tsx'
import { gameNow, useTick } from '../lib/clock.ts'
import { plainError } from '../lib/errors.ts'
import { usePlayer, type Bubble } from '../lib/player.ts'
import { useTheme } from '../lib/theme.ts'
import { Room } from '../scene/Room.tsx'
import { METHOD_CLASS } from './Cards.tsx'
import { P1 } from './copy.ts'

const BUBBLE_MS = 2800

/** The interview line on show in the scene: each stays at least 2.8 s, and they never overlap. */
function useBubble(said: Bubble[]): Bubble | null {
  const [shown, setShown] = useState<Bubble | null>(null)
  const queue = useRef<Bubble[]>([])
  const seen = useRef(new Set<number>())
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    for (const b of said) {
      if (seen.current.has(b.key) || b.at === 0) continue
      seen.current.add(b.key)
      queue.current.push(b)
    }
    // A long queue drops the oldest lines; the row of the interview keeps them all.
    if (queue.current.length > 3) queue.current = queue.current.slice(-3)
    const next = () => {
      const b = queue.current.shift() ?? null
      setShown(b)
      timer.current = b ? setTimeout(next, BUBBLE_MS) : null
    }
    if (!timer.current) next()
  }, [said])
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  return shown
}

/** Starts an investigation. A refusal comes back as one plain sentence for the row. */
export function useInvestigate(onRefused?: (id: string, text: string) => void) {
  const send = usePlayer((s) => s.send)
  return (id: string) => { void send('planning.investigate', { id }).then((r) => { if (!r.ok) onRefused?.(id, plainError(r.error)) }) }
}

export function Blocks({ n, held = n, flash = 0 }: { n: number; held?: number; flash?: number }) {
  return <span className="blk" aria-hidden="true">{Array.from({ length: n }, (_, i) => <i key={`${i}:${flash}`} className={`${i < held ? 'held' : ''}${flash && i >= held ? ' freed' : ''}`} />)}</span>
}

/** The bandwidth: blocks held and free, and what holding means. Blocks that come free flash once. */
export function Bandwidth({ total, free }: { total: number; free: number }) {
  const prev = useRef(free)
  const [flash, setFlash] = useState(0)
  useEffect(() => {
    if (free > prev.current) setFlash((n) => n + 1)
    prev.current = free
  }, [free])
  return (
    <div className="bwrow" aria-label={`${P1.bandwidth}: ${P1.freeOf(free, total)}`}>
      <div className="bwtop">
        <span className="bwl">{P1.bandwidth}</span>
        <Blocks n={total} held={total - free} flash={flash} />
        <span className="bwf">{P1.freeOf(free, total)}</span>
      </div>
      <div className="bwline">{P1.bwLine}</div>
    </div>
  )
}

export function InvestigationList({ content, pv, onShowCard }: { content: PlanningContent; pv: PlanningView; onShowCard: (inv: string) => void }) {
  useTick(250)
  const clock = usePlayer((s) => s.clock)
  const welcome = usePlayer((s) => s.welcome)!
  const said = usePlayer((s) => s.said)
  const [refused, setRefused] = useState<{ id: string; text: string } | null>(null)
  const investigate = useInvestigate((id, text) => { setRefused({ id, text }); setTimeout(() => setRefused((r) => (r?.id === id ? null : r)), 6000) })
  const now = clock ? gameNow(clock) : 0
  const done = new Set(pv.tiles.map((t) => t.investigation))
  const playing = pv.status === 'playing'
  const nextFreeIn = pv.running.length ? Math.min(...pv.running.map((r) => (r.completesAtMs - now) / 1000)) : 0
  const anyStarted = pv.running.length > 0 || pv.tiles.length > 0
  const cast = welcome.system.cast
  return (
    <div className="ilist">
      {!anyStarted && playing && <div className="inv-note">{P1.noCancel}</div>}
      {content.investigations.map((inv) => {
        const run = pv.running.find((r) => r.id === inv.id)
        const isDone = done.has(inv.id)
        const fits = inv.bandwidth <= pv.bandwidthFree
        const ci = inv.character ? cast.findIndex((x) => x.id === inv.character) : -1
        const c = ci >= 0 ? cast[ci] : undefined
        const state = isDone ? 'done' : !playing ? 'locked' : run ? 'run' : fits ? 'ready' : 'wait'
        const left = run ? (run.completesAtMs - now) / 1000 : 0
        // The lines of a running interview: those the server released, as they arrived.
        const lines = run ? (run.lines.length ? run.lines : said.filter((b) => b.inv === inv.id).map((b) => b.text)) : []
        return (
          <div key={inv.id} className={`irow ${state}`} data-inv={inv.id}>
            <span className={`mth ${METHOD_CLASS[inv.method]}`} title={P1.method[inv.method]} aria-label={P1.method[inv.method]}>{P1.methodLetter[inv.method]}</span>
            <div className="ttl">
              <div className="t">{inv.title}</div>
              {c && (
                <div className="who">
                  <Portrait c={c} cast={cast} index={ci} size={30} />
                  <span><b>{c.name}</b>, {c.role}</span>
                </div>
              )}
              <div className="tz">{inv.teaser}</div>
              <div className="meta"><Blocks n={inv.bandwidth} /> <span>{P1.wait(inv.seconds, inv.storyTime)}</span></div>
            </div>
            <div className="iact">
              {state === 'done' && <button type="button" className="ibtn done" onClick={() => onShowCard(inv.id)} aria-label={`${P1.done}: ${P1.showCard} ${inv.title}`}>✓ {P1.done}</button>}
              {state === 'run' && (
                <div className="ibtn run" role="status">
                  <span className="runtxt">{P1.left(left)}</span>
                  <span className="runbar"><i style={{ width: `${100 * (1 - left / inv.seconds)}%` }} /></span>
                </div>
              )}
              {state === 'ready' && <button type="button" className="ibtn start" onClick={() => investigate(inv.id)}>{P1.start}</button>}
              {state === 'wait' && (
                <div className="ibtn wait" title={pv.running.length ? P1.nextFree(nextFreeIn) : undefined}>
                  {P1.needs(inv.bandwidth)}
                  {pv.running.length > 0 && <small>{P1.freeIn(nextFreeIn)}</small>}
                </div>
              )}
              {state === 'locked' && <div className="ibtn wait">–</div>}
            </div>
            {lines.length > 0 && (
              <div className="ilines" aria-live="polite">
                {lines.map((l, i) => <div key={i} className="iline">{l}</div>)}
              </div>
            )}
            {refused?.id === inv.id && <div className="err irefused" role="alert">{refused.text}</div>}
          </div>
        )
      })}
    </div>
  )
}

/** The Investigations column: its title, the bandwidth, the list. */
export function Investigations({ content, pv, onShowCard, phone = false }: { content: PlanningContent; pv: PlanningView; onShowCard: (inv: string) => void; phone?: boolean }) {
  const done = pv.tiles.length
  return (
    <section className={`colbox inv${phone ? ' phone' : ''}`} aria-label={P1.investigations}>
      {!phone && (
        <div className="colhead sky">
          <h2>{P1.investigations}</h2>
          <span className="s">{P1.doneOf(done, content.investigations.length)}</span>
        </div>
      )}
      <Bandwidth total={content.rules.bandwidth} free={pv.status === 'playing' ? pv.bandwidthFree : content.rules.bandwidth} />
      <div className="colscroll">
        <InvestigationList content={content} pv={pv} onShowCard={onShowCard} />
      </div>
    </section>
  )
}

/** The reading room with the interviews of Phase 1, for the panel above the evidence. */
export function PlanningRoom({ w, content, pv, cropHeight, maxHeight = 400 }: { w: Welcome; content: PlanningContent; pv: PlanningView; cropHeight?: number; maxHeight?: number }) {
  const theme = useTheme()
  const said = usePlayer((s) => s.said)
  const view = usePlayer((s) => s.view)!
  const investigate = useInvestigate()
  const bubble = useBubble(said)
  const meeting = useMemo(() => pv.running.map((r) => content.investigations.find((x) => x.id === r.id)?.character).filter((x): x is string => !!x), [pv.running, content])
  const done = new Set(pv.tiles.map((t) => t.investigation))
  const available = pv.status === 'playing'
    ? content.investigations.filter((x) => x.character && !done.has(x.id) && !pv.running.some((r) => r.id === x.id) && x.bandwidth <= pv.bandwidthFree).map((x) => x.character!)
    : []
  const pick = (charId: string) => {
    const inv = content.investigations.find((x) => x.character === charId && !done.has(x.id) && !pv.running.some((r) => r.id === x.id))
    if (inv) investigate(inv.id)
  }
  return (
    <Room art={w.art} cast={w.system.cast} banter={w.system.banter} me={{ avatar: view.me.avatar }} theme={theme} maxHeight={maxHeight} cropHeight={cropHeight}
      focusX={152} focusY={104} meeting={meeting} bubble={bubble} available={available} onPick={pick} label={P1.readingRoom} />
  )
}
