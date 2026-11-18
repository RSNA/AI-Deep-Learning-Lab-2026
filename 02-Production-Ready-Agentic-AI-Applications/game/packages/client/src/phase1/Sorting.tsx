// Your assessment (engineering spec, section 10.4): one column with five sections. Unsorted holds
// every problem at the start, then the four classes in the order of the line that states the
// task. Each problem card has the four class buttons; a press moves the card into that section,
// where it settles in place. A sorted card is compact and opens on a click. A press on a full
// class asks which of its problems goes back to Unsorted. The keys 1 to 4 pick a class and 0
// sends a card back. Laptop and phone work the same way.
import { useEffect, useRef, useState } from 'react'
import type { PlanningContent } from '@lab02/protocol'
import { Sheet } from '../components/ui.tsx'
import { usePlayer } from '../lib/player.ts'
import { P1 } from './copy.ts'
import { askLine, isFull } from './model.ts'
import type { Board } from './useBoard.ts'

type Problem = PlanningContent['problems'][number]

export const classTone = (i: number) => `tone-${i % 4}`

// ------------------------------------------------------------------------------------------
// The class buttons of a card: one per class, and one back to Unsorted
// ------------------------------------------------------------------------------------------
export function ClassControl({ board, pid, big = false }: { board: Board; pid: string; big?: boolean }) {
  const at = board.where(pid)
  return (
    <div className={`four${big ? ' big' : ''}`} role="group" aria-label={P1.classOf}>
      {board.classes.map((c, i) => {
        const on = at?.cls === c.id
        const full = !on && isFull(board.layout, c.id)
        return (
          <button key={c.id} type="button" className={`${classTone(i)}${on ? ' on' : ''}${full ? ' full' : ''}`} aria-pressed={on}
            disabled={board.locked} title={`${i + 1}: ${c.label}${full ? ` (${P1.full})` : ''}`}
            onClick={(e) => { e.stopPropagation(); if (!on) board.toClass(pid, c.id) }}>
            <span>{c.short}</span>{full && <small>{P1.full}</small>}
          </button>
        )
      })}
      {at && !board.locked && (
        <button type="button" className="clr" aria-label={P1.clearLabel} title={`0: ${P1.clearLabel}`} onClick={(e) => { e.stopPropagation(); board.unsort(pid) }}>↩ {P1.toUnsorted}</button>
      )}
    </div>
  )
}

export function AskSheet({ board, content }: { board: Board; content: PlanningContent }) {
  const a = board.ask
  if (!a) return null
  const cls = board.classes.find((c) => c.id === a.cls)!
  const title = content.problems.find((p) => p.id === a.pid)?.title ?? ''
  const inClass = (board.layout[a.cls] ?? []).filter((x): x is string => !!x)
  return (
    <Sheet title={P1.whoLeaves(cls.short)} head="sky" onClose={board.cancelAsk}>
      <p><b>{P1.whoLeavesAsk(cls.short)}</b> {P1.whoLeavesText(title, cls.short)}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {inClass.map((pid) => (
          <button key={pid} type="button" className="btn text leavebtn" onClick={() => board.replace(a.pid, pid)}>
            <span>{content.problems.find((p) => p.id === pid)?.title}</span><span className="muted">↩ {P1.leaves}</span>
          </button>
        ))}
      </div>
      <button type="button" className="btn small" style={{ alignSelf: 'flex-end' }} onClick={board.cancelAsk}>{P1.cancel}</button>
    </Sheet>
  )
}

export function SendSheet({ board, content, onClose }: { board: Board; content: PlanningContent; onClose: () => void }) {
  const send = usePlayer((s) => s.send)
  const [busy, setBusy] = useState(false)
  const unsorted = content.problems.filter((p) => !board.picks[p.id])
  return (
    <Sheet title={P1.sendTitle} head="sun" onClose={onClose} wide>
      <div className="sendlist">
        {board.classes.map((c, i) => (
          <div key={c.id}>
            <div className={`sendhead ${classTone(i)}`}>{c.label} · {P1.filled(board.layout[c.id]!.filter(Boolean).length, c.capacity)}</div>
            <ul>{board.layout[c.id]!.filter((x): x is string => !!x).map((pid) => <li key={pid}>{content.problems.find((p) => p.id === pid)?.title}</li>)}</ul>
          </div>
        ))}
      </div>
      {unsorted.length > 0 && (
        <div className="err" style={{ color: 'var(--ink)' }}>
          {P1.stillUnsorted(unsorted.length)}
          <ul>{unsorted.map((p) => <li key={p.id}>{p.title}</li>)}</ul>
        </div>
      )}
      <p className="muted">{P1.sendText}</p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button type="button" className="btn go" disabled={busy} onClick={async () => {
          setBusy(true)
          await send('planning.submit', {})
          setBusy(false)
          onClose()
        }}>{P1.sendNow}</button>
        <button type="button" className="btn" onClick={onClose}>{P1.keepSorting}</button>
      </div>
    </Sheet>
  )
}

// ------------------------------------------------------------------------------------------
// A problem card: full in Unsorted, compact once sorted (a click opens it)
// ------------------------------------------------------------------------------------------
function ProblemCard({ p, board, sorted, open, setOpen, fresh, onEvidence }: {
  p: Problem; board: Board; sorted: boolean; open: boolean; setOpen: (o: boolean) => void; fresh: boolean; onEvidence?: (pid: string) => void
}) {
  const full = !sorted || open
  return (
    <div className={`acard${sorted ? ' sorted' : ''}${open ? ' open' : ''}${fresh ? ' fresh' : ''}`} data-problem={p.id} tabIndex={0}
      onKeyDown={(e) => { if (e.target !== e.currentTarget) return; if (sorted && e.key === 'Enter') { e.preventDefault(); setOpen(!open) } else board.onKey(p.id, e) }}
      aria-label={`${p.title}. ${P1.keys}`}>
      {sorted
        ? <button type="button" className="at" aria-expanded={open} onClick={() => setOpen(!open)}><span>{p.title}</span><span aria-hidden="true" className="chev">{open ? '▴' : '▾'}</span></button>
        : <div className="at">{p.title}</div>}
      {full && <div className="ad">{p.description}</div>}
      <ClassControl board={board} pid={p.id} />
      {full && onEvidence && <button type="button" className="linkbtn" onClick={() => onEvidence(p.id)}>{P1.toEvidence} →</button>}
    </div>
  )
}

function SectionHead({ title, count, tone, full = false, hint, fits }: { title: string; count: string; tone: string; full?: boolean; hint?: string; fits?: { label: string; text: string; rungs: number[] } }) {
  const [open, setOpen] = useState(false)
  const inner = <><span className="an">{title} · <span className="num">{count}</span>{full && <small className="afull">{P1.full}</small>}</span>{hint && <span className="ah">{hint}</span>}{fits && <span className="ai" aria-hidden="true">{open ? '▴' : '?'}</span>}</>
  return (
    <div className={`ahead ${tone}`}>
      {fits ? <button type="button" className="ahbtn" aria-expanded={open} aria-label={`${title}, ${count}. ${P1.whatFits(fits.label)}`} onClick={() => setOpen(!open)}>{inner}</button> : <div className="ahbtn">{inner}</div>}
      {fits && open && <div className="afits" role="note" onClick={() => setOpen(false)}><b>{fits.label}.</b> {fits.text}<div className="muted">{P1.rungs}: {fits.rungs.length ? fits.rungs.join(', ') : P1.noRungs}</div></div>}
    </div>
  )
}

/** The whole assessment column. */
export function Assessment({ board, content, onEvidence, focus, phone = false }: { board: Board; content: PlanningContent; onEvidence?: (pid: string) => void; focus?: string | null; phone?: boolean }) {
  const pv = usePlayer((s) => s.view?.planning)
  const [sending, setSending] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [fresh, setFresh] = useState<string | null>(null)
  const prev = useRef(board.picks)
  // A card that moved is marked for a moment where it settles.
  const picksKey = JSON.stringify(board.picks)
  useEffect(() => {
    const before = prev.current
    const moved = Object.keys(board.picks).find((k) => board.picks[k] !== before[k]) ?? Object.keys(before).find((k) => !board.picks[k])
    prev.current = board.picks
    if (!moved) return
    setFresh(moved)
    const t = setTimeout(() => setFresh(null), 900)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picksKey])
  useEffect(() => {
    if (focus) document.querySelector(`[data-problem="${focus}"]`)?.scrollIntoView({ block: 'center' })
  }, [focus])
  const unsorted = content.problems.filter((p) => !board.picks[p.id])
  const n = content.problems.length - unsorted.length
  const card = (p: Problem, sorted: boolean) => (
    <ProblemCard key={p.id} p={p} board={board} sorted={sorted} open={open === p.id} setOpen={(o) => setOpen(o ? p.id : null)} fresh={fresh === p.id} onEvidence={onEvidence} />
  )
  return (
    <section className={`colbox assess sortcol${phone ? ' phone' : ''}`} aria-label={P1.assessment}>
      <div className="colhead sun">
        <span className="l"><h2>{P1.assessment}</h2><span className="s">{P1.filled(n, content.problems.length)}</span></span>
        <span className="r">{!board.locked && <button type="button" className="btn go small sendbtn" onClick={() => setSending(true)}>{P1.send}</button>}</span>
      </div>
      <div className="ask">{askLine(board.classes, content.problems.length)}</div>
      <div className="strip" aria-hidden="true">
        {board.classes.map((c, i) => (
          <div key={c.id} className={classTone(i)}>
            <div className="n">{P1.filled((board.layout[c.id] ?? []).filter(Boolean).length, c.capacity)}</div>
            <div className="l">{c.short}</div>
          </div>
        ))}
      </div>
      {board.locked && pv?.status === 'submitted' && <div className="locked">{P1.sent}</div>}
      <div className="colscroll asections">
        <div className={`asec unsorted${unsorted.length === 0 ? ' done' : ''}`}>
          <SectionHead title={P1.unsortedTitle} count={String(unsorted.length)} tone="tone-u" hint={unsorted.length ? P1.pickHint : undefined} />
          {unsorted.length === 0 ? <div className="aempty">{P1.allSorted}</div> : unsorted.map((p) => card(p, false))}
        </div>
        {board.classes.map((c, i) => {
          const ids = (board.layout[c.id] ?? []).filter((x): x is string => !!x)
          return (
            <div key={c.id} className={`asec ${classTone(i)}`} data-class={c.id}>
              <SectionHead title={c.short} count={P1.filled(ids.length, c.capacity)} tone={classTone(i)} full={ids.length >= c.capacity} fits={{ label: c.label, text: c.fitsWhen, rungs: c.rungs }} />
              {ids.length === 0 && <div className="muted aempty">{P1.sectionEmpty(c.capacity)}</div>}
              {ids.map((pid) => { const p = content.problems.find((x) => x.id === pid); return p ? card(p, true) : null })}
            </div>
          )
        })}
      </div>
      {board.error && <div className="toast" role="alert" onClick={board.clearError}>{board.error}</div>}
      <AskSheet board={board} content={content} />
      {sending && <SendSheet board={board} content={content} onClose={() => setSending(false)} />}
    </section>
  )
}
