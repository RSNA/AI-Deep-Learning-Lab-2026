// The rail (engineering spec, section 10.4): the reading room, the transcript strip and the
// list of investigations. It folds to a strip of 44 px.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { PlanningContent, PlanningView, Welcome } from '@lab02/protocol'
import { gameNow, useTick } from '../lib/clock.ts'
import { plainError } from '../lib/errors.ts'
import { usePlayer, type Bubble } from '../lib/player.ts'
import { useTheme } from '../lib/theme.ts'
import { Room } from '../scene/Room.tsx'
import { METHOD_CLASS } from './Cards.tsx'
import { P1 } from './copy.ts'

const BUBBLE_MS = 2800

/** The line on show in the scene: each line stays at least 2.8 s, and they never overlap. */
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
    // A long queue drops the oldest lines; the transcript keeps them all.
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

export function Blocks({ n, held = n }: { n: number; held?: number }) {
  return <span className="blk" aria-hidden="true">{Array.from({ length: n }, (_, i) => <i key={i} className={i < held ? 'held' : ''} />)}</span>
}

export function InvestigationList({ content, pv, onShowCard }: { content: PlanningContent; pv: PlanningView; onShowCard: (inv: string) => void }) {
  useTick(250)
  const clock = usePlayer((s) => s.clock)
  const welcome = usePlayer((s) => s.welcome)!
  const [refused, setRefused] = useState<{ id: string; text: string } | null>(null)
  const investigate = useInvestigate((id, text) => { setRefused({ id, text }); setTimeout(() => setRefused((r) => (r?.id === id ? null : r)), 6000) })
  const now = clock ? gameNow(clock) : 0
  const done = new Set(pv.tiles.map((t) => t.investigation))
  const playing = pv.status === 'playing'
  const nextFreeIn = pv.running.length ? Math.min(...pv.running.map((r) => (r.completesAtMs - now) / 1000)) : 0
  const anyStarted = pv.running.length > 0 || pv.tiles.length > 0
  return (
    <section className="panel inv">
      <div className="panel-head sky"><span>{P1.investigate}</span><span className="sub">{P1.doneOf(done.size, content.investigations.length)} · {P1.free(pv.bandwidthFree)}</span></div>
      {!anyStarted && playing && <div className="inv-note">{P1.noCancel}</div>}
      <div className="rows">
        {content.investigations.map((inv) => {
          const run = pv.running.find((r) => r.id === inv.id)
          const isDone = done.has(inv.id)
          const fits = inv.bandwidth <= pv.bandwidthFree
          const c = inv.character ? welcome.system.cast.find((x) => x.id === inv.character) : undefined
          const state = isDone ? 'done' : run ? 'run' : fits && playing ? 'ready' : 'wait'
          const left = run ? (run.completesAtMs - now) / 1000 : 0
          return (
            <div key={inv.id} className={`irow ${state}`} data-inv={inv.id}>
              <span className={`mth ${METHOD_CLASS[inv.method]}`} title={P1.method[inv.method]} aria-label={P1.method[inv.method]}>{P1.methodLetter[inv.method]}</span>
              <div className="ttl">
                <div className="t">{inv.title}</div>
                <div className="tz">{c ? <b>{c.name}, {c.role}. </b> : null}{inv.teaser}</div>
                <div className="meta"><Blocks n={inv.bandwidth} /> <span>{P1.wait(inv.seconds, inv.storyTime)}</span></div>
              </div>
              {state === 'done' && <button type="button" className="ibtn done" onClick={() => onShowCard(inv.id)} aria-label={`${P1.done}: show the card of ${inv.title}`}>✓ {P1.done}</button>}
              {state === 'run' && (
                <div className="ibtn run" role="status">
                  <span className="runbar" style={{ width: `${100 * (1 - left / inv.seconds)}%` }} />
                  <span className="runtxt">{P1.left(left)}</span>
                </div>
              )}
              {state === 'ready' && <button type="button" className="ibtn start" onClick={() => investigate(inv.id)}>{P1.start}</button>}
              {state === 'wait' && (
                <div className="ibtn wait" title={playing && pv.running.length ? P1.nextFree(nextFreeIn) : undefined}>
                  {playing ? P1.needs(inv.bandwidth) : '–'}
                </div>
              )}
              {refused?.id === inv.id && <div className="err irefused" role="alert">{refused.text}</div>}
            </div>
          )
        })}
      </div>
    </section>
  )
}

export function Transcript({ content, said }: { content: PlanningContent; said: Bubble[] }) {
  const w = usePlayer((s) => s.welcome)!
  const box = useRef<HTMLDivElement>(null)
  const nameOf = (b: Bubble) => {
    const id = b.speaker || content.investigations.find((x) => x.id === b.inv)?.character || ''
    return w.system.cast.find((c) => c.id === id)?.name ?? ''
  }
  useEffect(() => { box.current?.scrollTo({ top: box.current.scrollHeight }) }, [said.length])
  return (
    <div className="transcript" ref={box} aria-live="polite">
      {said.length === 0 && <div className="muted">{P1.transcriptEmpty}</div>}
      {said.map((b) => <div key={b.key}><b>{nameOf(b)}:</b> {b.text}</div>)}
    </div>
  )
}

/** The reading room with the interviews of Phase 1. */
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
    <div className="scene-box">
      <Room art={w.art} cast={w.system.cast} banter={w.system.banter} me={{ avatar: view.me.avatar }} theme={theme} maxHeight={maxHeight} cropHeight={cropHeight}
        focusX={152} focusY={104} meeting={meeting} bubble={bubble} available={available} onPick={pick} />
    </div>
  )
}

export function Rail({ w, content, pv, folded, setFolded, onShowCard }: {
  w: Welcome; content: PlanningContent; pv: PlanningView; folded: boolean; setFolded: (f: boolean) => void; onShowCard: (inv: string) => void
}) {
  useTick(500)
  const said = usePlayer((s) => s.said)
  const clock = usePlayer((s) => s.clock)
  const done = pv.tiles.length
  const total = content.investigations.length
  if (folded) {
    const now = clock ? gameNow(clock) : 0
    const soonest = pv.running.length ? Math.min(...pv.running.map((r) => (r.completesAtMs - now) / 1000)) : null
    return (
      <aside className="railstrip">
        <button type="button" className="open" onClick={() => setFolded(false)} aria-label={P1.openRail} title={P1.openRail}>»</button>
        {done === total ? <span className="ok" aria-hidden="true">✓</span> : <span className="cnt num">{pv.running.length}</span>}
        <span className="vert">{done === total ? P1.allDone : P1.railStrip(pv.running.length, total - done - pv.running.length)}{soonest !== null ? ` · ${Math.ceil(Math.max(0, soonest))} s` : ''}</span>
        <span className="vert muted">{P1.openRail}</span>
      </aside>
    )
  }
  return (
    <aside className="rail">
      <div className="rail-top">
        <PlanningRoom w={w} content={content} pv={pv} cropHeight={176} />
        <button type="button" className="foldbtn" onClick={() => setFolded(true)} aria-label={P1.foldRail} title={P1.foldRail}>«</button>
      </div>
      <Transcript content={content} said={said} />
      <InvestigationList content={content} pv={pv} onShowCard={onShowCard} />
    </aside>
  )
}
