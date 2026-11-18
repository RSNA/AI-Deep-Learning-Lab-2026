// Phase 1 for the player (engineering spec, section 10.4). On a laptop: the rail, the evidence
// wall and the sorting board side by side. On a phone: three tabs. Then the reveal.
import { useEffect, useRef, useState } from 'react'
import type { PlanningContent, Welcome } from '@lab02/protocol'
import { Portrait, Sheet } from '../components/ui.tsx'
import { secondsLeft, useTick } from '../lib/clock.ts'
import { Paragraphs } from '../lib/marks.tsx'
import { usePlayer } from '../lib/player.ts'
import { store } from '../lib/storage.ts'
import { P1 } from './copy.ts'
import { InvestigationList, PlanningRoom, Rail, Transcript } from './Rail.tsx'
import { Reveal } from './Reveal.tsx'
import { Assessment } from './Sorting.tsx'
import { useBoard } from './useBoard.ts'
import { Wall } from './Wall.tsx'

export function useNarrow(px = 768): boolean {
  const [narrow, setNarrow] = useState(() => window.innerWidth < px)
  useEffect(() => {
    const on = () => setNarrow(window.innerWidth < px)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [px])
  return narrow
}

/** The brief of the phase, shown once when it opens. The menu opens it again. */
export function BriefSheet({ w, onClose }: { w: Welcome; onClose: () => void }) {
  const view = usePlayer((s) => s.view)!
  const brief = view.inbox.find((m) => m.id === 'planning:brief')
  if (!brief) return null
  const idx = w.system.cast.findIndex((c) => c.id === brief.from)
  const c = w.system.cast[idx]
  return (
    <Sheet title={brief.title ?? P1.brief} head="sun" onClose={onClose}>
      {c && (
        <div className="speaker">
          <Portrait c={c} cast={w.system.cast} index={idx} size={60} />
          <div><div className="nm">{c.name}</div><div className="rl">{c.role}</div></div>
        </div>
      )}
      <div className="brief-text"><Paragraphs text={brief.text} /></div>
      <button type="button" className="btn go big" autoFocus onClick={onClose}>{P1.briefStart}</button>
    </Sheet>
  )
}

/** Notices at the times of `clock.warnings_seconds_left`. */
function useWarnings(): string | null {
  useTick(500)
  const clock = usePlayer((s) => s.clock)
  const [text, setText] = useState<string | null>(null)
  const fired = useRef(new Set<number>())
  const left = secondsLeft(clock)
  useEffect(() => {
    if (left === null || !clock) return
    for (const w of clock.clock.warnings) {
      if (left <= w && left > w - 3 && !fired.current.has(w)) {
        fired.current.add(w)
        setText(P1.warn(w))
        setTimeout(() => setText(null), 6000)
      }
    }
  }, [left, clock])
  return text
}

function PlanningPlay({ w, content }: { w: Welcome; content: PlanningContent }) {
  const pv = usePlayer((s) => s.view!.planning!)
  const me = usePlayer((s) => s.view!.me.id)
  const board = useBoard(content)
  const phone = useNarrow(768)
  const said = usePlayer((s) => s.said)
  const warning = useWarnings()
  const allDone = pv.tiles.length === content.investigations.length
  const [folded, setFolded] = useState(() => allDone)
  const [notice, setNotice] = useState<string | null>(null)
  const [focusCard, setFocusCard] = useState<{ key: string; n: number } | null>(null)
  const [tab, setTab] = useState<'room' | 'evidence' | 'sort'>('room')
  const [fromProblem, setFromProblem] = useState<string | null>(null)
  const [sortFocus, setSortFocus] = useState<string | null>(null)
  const [briefOpen, setBriefOpen] = useState(() => !store.flag(`brief-planning-${me}`))
  const seenTiles = useRef(pv.tiles.length)
  const [evidenceBadge, setEvidenceBadge] = useState(0)

  // The rail folds by itself once every investigation is done.
  const wasDone = useRef(allDone)
  useEffect(() => {
    if (allDone && !wasDone.current) { setFolded(true); setNotice(P1.allDoneNotice); setTimeout(() => setNotice(null), 7000) }
    wasDone.current = allDone
  }, [allDone])

  useEffect(() => {
    if (pv.tiles.length > seenTiles.current && phone && tab !== 'evidence') setEvidenceBadge((n) => n + pv.tiles.length - seenTiles.current)
    seenTiles.current = pv.tiles.length
  }, [pv.tiles.length, phone, tab])

  const closeBrief = () => { store.setFlag(`brief-planning-${me}`); setBriefOpen(false) }
  const showCard = (inv: string) => { setFocusCard({ key: inv, n: Date.now() }); if (phone) setTab('evidence') }
  const unsortedN = content.problems.length - Object.keys(board.picks).length

  if (phone) {
    const backTo = fromProblem ? (
      <button type="button" className="btn small backto" onClick={() => { setSortFocus(fromProblem); setFromProblem(null); setTab('sort') }}>
        ← {P1.backTo(content.problems.find((p) => p.id === fromProblem)?.title ?? '')}
      </button>
    ) : null
    return (
      <div className="p1-phone">
        <div className="p1-phone-main">
          {tab === 'room' && (
            <div className="phone-room">
              <PlanningRoom w={w} content={content} pv={pv} cropHeight={200} />
              <Transcript content={content} said={said} />
              <InvestigationList content={content} pv={pv} onShowCard={showCard} />
            </div>
          )}
          {tab === 'evidence' && <Wall w={w} content={content} pv={pv} phone focusCard={focusCard} backTo={backTo} />}
          {tab === 'sort' && <Assessment board={board} content={content} focus={sortFocus} onEvidence={(pid) => { setFromProblem(pid); setTab('evidence'); setEvidenceBadge(0) }} />}
        </div>
        <nav className="ptabs" aria-label="Phase 1">
          {(['room', 'evidence', 'sort'] as const).map((t) => {
            const badge = t === 'evidence' ? evidenceBadge : t === 'sort' ? unsortedN : pv.running.length
            return (
              <button key={t} type="button" className={tab === t ? 'on' : ''} aria-pressed={tab === t}
                onClick={() => { setTab(t); if (t === 'evidence') setEvidenceBadge(0); if (t !== 'evidence') setFromProblem(null) }}>
                {P1[t]}{badge > 0 && <span className="badge">{badge}</span>}
              </button>
            )
          })}
        </nav>
        {warning && <div className="toast warnbar" role="status">{warning}</div>}
        {briefOpen && <BriefSheet w={w} onClose={closeBrief} />}
      </div>
    )
  }

  return (
    <div className={`p1${folded ? ' folded' : ''}`}>
      <div className="p1-left">
        <Rail w={w} content={content} pv={pv} folded={folded} setFolded={setFolded} onShowCard={showCard} />
        <Wall w={w} content={content} pv={pv} focusCard={focusCard} />
      </div>
      <section className="sortcol" aria-label={P1.assessment}>
        <div className="coltitle"><h2>{P1.assessment}</h2></div>
        <Assessment board={board} content={content} />
      </section>
      {(warning || notice) && <div className="toast warnbar" role="status">{warning ?? notice}</div>}
      {briefOpen && <BriefSheet w={w} onClose={closeBrief} />}
    </div>
  )
}

/** Phase 1 from its first stage to the break that follows it. */
export function Planning({ w }: { w: Welcome }) {
  const view = usePlayer((s) => s.view)!
  const content = usePlayer((s) => s.content.planning) as PlanningContent | undefined
  const pv = view.planning
  if (!pv || !content) return <div className="banner">{P1.evidence}…</div>
  if (pv.reveal) return <Reveal w={w} content={content} pv={pv} inBreak={view.stage === 'break.planning'} />
  return <PlanningPlay w={w} content={content} />
}
