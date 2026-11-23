// Phase 1 for the player (engineering spec, section 10.4). On a laptop three titled columns side
// by side: Investigations, Evidence, Your assessment. Below 1024 px the same three as tabs.
// Then the reveal.
import { useEffect, useRef, useState } from 'react'
import type { PlanningContent, Welcome } from '@lab02/protocol'
import { HelpSheet, Tour } from '../components/Tour.tsx'
import { Portrait, Sheet } from '../components/ui.tsx'
import { COPY } from '../copy.ts'
import { secondsLeft, useTick } from '../lib/clock.ts'
import { Paragraphs } from '../lib/marks.tsx'
import { usePlayer } from '../lib/player.ts'
import { store } from '../lib/storage.ts'
import { P1 } from './copy.ts'
import { METHOD_CLASS } from './Cards.tsx'
import { Investigations } from './Rail.tsx'
import { Reveal } from './Reveal.tsx'
import { Assessment } from './Sorting.tsx'
import { useBoard } from './useBoard.ts'
import { Wall } from './Wall.tsx'

export const PHONE_BELOW = 1024

export function useNarrow(px = PHONE_BELOW): boolean {
  const [narrow, setNarrow] = useState(() => window.innerWidth < px)
  useEffect(() => {
    const on = () => setNarrow(window.innerWidth < px)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [px])
  return narrow
}

export type BriefWords = { started: string; start: string; stays: string }
const P1_BRIEF: BriefWords = { started: P1.phaseStarted, start: P1.briefStart, stays: P1.letterStays }

/** The opening letter of a phase: it pops up once when the phase starts and stays as the first card. */
export function BriefSheet({ w, onClose, again = false, phase = 'planning', words = P1_BRIEF }: { w: Welcome; onClose: () => void; again?: boolean; phase?: string; words?: BriefWords }) {
  const view = usePlayer((s) => s.view)!
  const brief = view.inbox.find((m) => m.id === `${phase}:brief`)
  if (!brief) return null
  const idx = w.system.cast.findIndex((c) => c.id === brief.from)
  const c = w.system.cast[idx]
  return (
    <Sheet title={P1.letterTitle} head="sun" onClose={onClose} wide>
      {!again && <div className="brief-started">{words.started}</div>}
      {c && (
        <div className="speaker">
          <Portrait c={c} cast={w.system.cast} index={idx} size={64} />
          <div><div className="nm">{c.name}</div><div className="rl">{c.role}</div></div>
        </div>
      )}
      <h2 className="brief-title">{brief.title}</h2>
      <div className="brief-text"><Paragraphs text={brief.text} /></div>
      <div className="brief-foot">
        <span className="muted">{again ? words.stays : `${P1.clockRuns} ${words.stays}`}</span>
        <button type="button" className="btn go big" autoFocus onClick={onClose}>{again ? P1.close : words.start}</button>
      </div>
    </Sheet>
  )
}

/** Notices at the times of `clock.warnings_seconds_left`. */
export function useWarnings(say: (s: number) => string = P1.warn): string | null {
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
        setText(say(w))
        setTimeout(() => setText(null), 6000)
      }
    }
  }, [left, clock, say])
  return text
}

type Tab = 'investigations' | 'evidence' | 'assessment'
/** On a phone the assessment comes first: it is what the phase asks for (section 10.4). */
const TABS: Tab[] = ['assessment', 'investigations', 'evidence']

/** The tour of Phase 1 and its help panel. */
function PlanningGuide({ autoStart, economy, onTab, onEnd }: { autoStart: boolean; economy: boolean; onTab?: (t: Tab) => void; onEnd?: () => void }) {
  const key = usePlayer((s) => `tour-planning-${s.view!.me.id}-${s.view!.run}`)
  // With an economy part in the score, the step on the investigations says so.
  const steps = economy ? P1.tour.map((x) => (x.tab === 'investigations' ? { ...x, text: P1.tourEconomy } : x)) : P1.tour
  return (
    <>
      <Tour phase="planning" steps={steps} doneKey={key} autoStart={autoStart} onTab={onTab ? (t) => onTab(t as Tab) : undefined} onEnd={onEnd} words={COPY.tour} />
      <HelpSheet phase="planning" title={P1.helpTitle} intro={P1.helpIntro} steps={steps} tourLabel={COPY.takeTour}>
        <div className="eyebrow">{P1.helpMethods}</div>
        <div className="help-marks">
          {(['interview', 'data_pull', 'audit', 'observation'] as const).map((m) => (
            <div key={m} className="hm"><span className={`mth ${METHOD_CLASS[m]}`} aria-hidden="true">{P1.methodLetter[m]}</span><span>{P1.method[m]}</span></div>
          ))}
        </div>
      </HelpSheet>
    </>
  )
}

function PlanningPlay({ w, content }: { w: Welcome; content: PlanningContent }) {
  const pv = usePlayer((s) => s.view!.planning!)
  // The letter opens once per run of the phase: again after the host started the phase again.
  const briefFlag = usePlayer((s) => `brief-planning-${s.view!.me.id}-${s.view!.run}`)
  const board = useBoard(content)
  const phone = useNarrow()
  const warning = useWarnings()
  const [focusCard, setFocusCard] = useState<{ key: string; n: number } | null>(null)
  const [tab, setTab] = useState<Tab>('assessment')
  const [fromProblem, setFromProblem] = useState<string | null>(null)
  const [sortFocus, setSortFocus] = useState<string | null>(null)
  const [briefOpen, setBriefOpen] = useState(() => !store.flag(briefFlag))
  const seenTiles = useRef(pv.tiles.length)
  const [evidenceBadge, setEvidenceBadge] = useState(0)

  useEffect(() => {
    if (pv.tiles.length > seenTiles.current && phone && tab !== 'evidence') setEvidenceBadge((n) => n + pv.tiles.length - seenTiles.current)
    seenTiles.current = pv.tiles.length
  }, [pv.tiles.length, phone, tab])

  const closeBrief = () => { store.setFlag(briefFlag); setBriefOpen(false) }
  const showCard = (inv: string) => { setFocusCard({ key: inv, n: Date.now() }); if (phone) setTab('evidence') }
  const sorted = Object.keys(board.picks).length

  if (phone) {
    const backTo = fromProblem ? (
      <button type="button" className="btn small backto" onClick={() => { setSortFocus(fromProblem); setFromProblem(null); setTab('assessment') }}>
        ← {P1.backTo(content.problems.find((p) => p.id === fromProblem)?.title ?? '')}
      </button>
    ) : null
    const counts: Record<Tab, string> = {
      investigations: P1.doneOf(pv.tiles.length, content.investigations.length),
      evidence: P1.insights(pv.tiles.length, content.investigations.length),
      assessment: P1.sorted(sorted, content.problems.length),
    }
    return (
      <div className="p1-phone">
        <div className="p1-phone-main">
          {tab === 'investigations' && <Investigations content={content} pv={pv} onShowCard={showCard} phone />}
          {tab === 'evidence' && <Wall w={w} content={content} pv={pv} phone focusCard={focusCard} backTo={backTo} />}
          {tab === 'assessment' && <Assessment board={board} content={content} focus={sortFocus} phone onEvidence={(pid) => { setFromProblem(pid); setTab('evidence'); setEvidenceBadge(0) }} />}
        </div>
        <nav className="ptabs" aria-label={P1.phase}>
          {TABS.map((t) => (
            <button key={t} type="button" className={tab === t ? 'on' : ''} aria-pressed={tab === t}
              onClick={() => { setTab(t); if (t === 'evidence') setEvidenceBadge(0); if (t !== 'evidence') setFromProblem(null) }}>
              <span className="tl">{P1.tab[t]}</span>
              <span className="tc">{t === 'investigations' && pv.running.length ? P1.runningN(pv.running.length) : counts[t]}</span>
              {t === 'evidence' && evidenceBadge > 0 && <span className="badge">{evidenceBadge}</span>}
            </button>
          ))}
        </nav>
        {warning && <div className="toast warnbar" role="status">{warning}</div>}
        {briefOpen && <BriefSheet w={w} onClose={closeBrief} />}
        <PlanningGuide autoStart={!briefOpen} economy={content.rules.economy} onTab={(t) => { setTab(t); if (t !== 'evidence') setFromProblem(null) }} onEnd={() => setTab('assessment')} />
      </div>
    )
  }

  return (
    <div className="p1">
      <Investigations content={content} pv={pv} onShowCard={showCard} />
      <Wall w={w} content={content} pv={pv} focusCard={focusCard} />
      <Assessment board={board} content={content} />
      {warning && <div className="toast warnbar" role="status">{warning}</div>}
      {briefOpen && <BriefSheet w={w} onClose={closeBrief} />}
      <PlanningGuide autoStart={!briefOpen} economy={content.rules.economy} />
    </div>
  )
}

/** Phase 1 from its first stage to the break that follows it. */
export function Planning({ w, onSlides }: { w: Welcome; onSlides?: (() => void) | null }) {
  const view = usePlayer((s) => s.view)!
  const content = usePlayer((s) => s.content.planning) as PlanningContent | undefined
  const pv = view.planning
  if (!pv || !content) return <div className="banner">{P1.evidence}…</div>
  if (pv.reveal) return <Reveal w={w} content={content} pv={pv} inBreak={view.stage === 'break.planning'} onSlides={onSlides ?? null} />
  return <PlanningPlay w={w} content={content} />
}
