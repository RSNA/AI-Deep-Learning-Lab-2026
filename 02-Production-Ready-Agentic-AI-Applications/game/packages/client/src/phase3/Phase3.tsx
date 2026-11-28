// Phase 3 for the player (engineering spec, section 10.6). The board of Phase 2 played on: the
// same map, toolbox, shelves, actions and validations (../phase2/Board.tsx), and what a year in
// service adds. A timer that counts to the next report, the chart of the year beside the
// reports, the list of maps with the one that is deployed, the reference maps to take, and the
// letters and memos that arrive at the start of a round. Then the reveal.
import { useEffect, useMemo, useState } from 'react'
import type { MaintainingContent, MaintainingView, Welcome } from '@lab02/protocol'
import { usePlayer } from '../lib/player.ts'
import { store } from '../lib/storage.ts'
import { sameLayout } from '../canvas/model.ts'
import { MapBoard, P2_BOARD_WORDS, vocabularyOf, type BoardApi, type BoardWords } from '../phase2/Board.tsx'
import { P2 } from '../phase2/copy.ts'
import { P3, setUnit3 } from './copy.ts'
import { MapsPanel, RefPanel } from './Maps.tsx'
import { lettersOf, mapNames, type MapEntry } from './model.ts'
import { YearReveal } from './Reveal.tsx'
import { LetterSheet, NowLine, ReportSheet, RoundTimer, YearPanel } from './Year.tsx'

export { RoundTimer } from './Year.tsx'

const WORDS: BoardWords = {
  ...P2_BOARD_WORDS,
  phase: P3.phase, tour: P3.tour, helpTitle: P3.helpTitle, helpIntro: P3.helpIntro,
  brief: { started: P3.phaseStarted, start: P3.briefStart, stays: P3.letterStays },
  warn: P3.warn, whyNoneLeft: P3.whyNoneLeft, whyReady: P3.whyReady,
  // A reference map joins the list without a validation, and says so in its own words.
  doneToast: (v) => ((v as MapEntry).origin === 'reference' ? P3.tookToast((v as MapEntry).label ?? '') : P2.doneToast(v.accuracy)),
  tab: P3.tab, insightsTitle: P3.lettersTitle, again: P3.again, doneTimes: P3.doneTimes, upkeep: P3.upkeep,
}

/**
 * What opens by itself over the board, in order: the report that has just arrived, and once, at
 * the start of the phase, the reference maps. Each waits for the opening letter and for the tour.
 */
function Arrivals({ api, pending, onReport, letter, onLetter, offerRefs, onRefs }: {
  api: BoardApi; pending: number | null; onReport: (period: number) => void
  letter: string | null; onLetter: (id: string) => void; offerRefs: boolean; onRefs: () => void
}) {
  const quiet = api.briefOpen || api.touring
  useEffect(() => {
    if (quiet) return
    if (pending !== null) onReport(pending)
    else if (letter !== null) onLetter(letter)
    else if (offerRefs) onRefs()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quiet, pending, letter, offerRefs])
  return null
}

function YearPlay({ w, content }: { w: Welcome; content: MaintainingContent }) {
  const view = usePlayer((s) => s.view)!
  const mv = view.maintaining!
  const send = usePlayer((s) => s.send)
  setUnit3(content.rules.moneyUnit)
  const v = useMemo(() => vocabularyOf(content), [content])
  const names = useMemo(() => mapNames(mv.validations), [mv.validations])
  const who = `${view.me.id}-${view.run}`

  // --- a report opens by itself once, when it arrives. What was opened is kept in this browser.
  const reportFlag = (p: number) => `p3-report-${who}-${p}`
  const [open, setOpen] = useState<{ period: number; fresh: boolean } | null>(null)
  const [shownUpTo, setShownUpTo] = useState(() => mv.reports.filter((r) => store.flag(reportFlag(r.period))).length)
  const latest = mv.reports.at(-1)
  const pending = latest && mv.reports.length > shownUpTo && !open ? latest.period : null
  const openFresh = (period: number) => {
    for (const r of mv.reports) store.setFlag(reportFlag(r.period))
    setShownUpTo(mv.reports.length)
    setOpen({ period, fresh: true })
  }

  // --- the reference maps are offered once, after the first report
  const refsFlag = `p3-refs-${who}`
  const [refs, setRefs] = useState<{ first: boolean } | null>(null)
  const [refsOffered, setRefsOffered] = useState(() => store.flag(refsFlag))
  const offerRefs = !refsOffered && content.references.length > 0 && mv.adopted.length === 0 && mv.seen <= 1 && pending === null && !open
  const closeRefs = () => { store.setFlag(refsFlag); setRefsOffered(true); setRefs(null) }

  // --- every letter and memo of the year opens once in a window of its own, the oldest first,
  // after the report it came with is closed. What was opened is kept in this browser.
  const letters = lettersOf(view.inbox)
  const letterFlag = (id: string) => `p3-letter-${who}-${id}`
  const [openLetter, setOpenLetter] = useState<string | null>(null)
  const [lettersRead, setLettersRead] = useState(0)
  const unread = letters.findLast((m) => !store.flag(letterFlag(m.id)))
  const pendingLetter = unread && !open && !openLetter && pending === null ? unread.id : null
  const [freshLetters, setFreshLetters] = useState<Set<string>>(new Set())
  const closeLetter = () => {
    if (!openLetter) return
    const id = openLetter
    store.setFlag(letterFlag(id))
    setOpenLetter(null)
    setLettersRead(lettersRead + 1)
    setFreshLetters((f) => new Set([...f, id]))
    setTimeout(() => setFreshLetters((f) => { const n = new Set(f); n.delete(id); return n }), 12000)
  }
  const shownLetter = openLetter ? letters.find((m) => m.id === openLetter) : undefined

  // A validation of the same map says the same, unless a lens makes validations say more.
  const sameAs = (map: Parameters<typeof sameLayout>[0]) => {
    if (mv.lenses.freshTestSet || mv.lenses.dryRun) return null
    const hit = mv.validations.findLast((x) => sameLayout(x.map, map))
    return hit ? P3.sameAs(names.get(hit.id) ?? '') : null
  }
  const shown = open ? mv.reports.find((r) => r.period === open.period) : undefined

  return (
    <MapBoard w={w} phase="maintaining" content={content} dv={mv} words={WORDS} sameAs={sameAs}
      letters={letters} freshLetters={freshLetters}
      held={pending !== null || open !== null || pendingLetter !== null || openLetter !== null || refs !== null || offerRefs}
      tabCounts={{ year: latest ? P3.out100(latest.value) : '', results: `${mv.validations.length}` }}
      strip={<RoundTimer mv={mv} variant="strip" />}
      status={() => <NowLine mv={mv} names={names} onOpen={(period) => setOpen({ period, fresh: false })} />}
      above={() => <YearPanel mv={mv} content={content} names={names} onOpen={(period) => setOpen({ period, fresh: false })} />}
      results={(api) => (
        <MapsPanel mv={mv} content={content} names={names} current={api.map} send={send}
          onLoad={(m, name) => api.load(m, P3.restored(name))} onRefs={() => setRefs({ first: false })} />
      )}
      overlays={(api) => {
        return (
          <>
            <Arrivals api={api} pending={pending} onReport={openFresh} letter={pendingLetter} onLetter={setOpenLetter} offerRefs={offerRefs && pendingLetter === null && !openLetter} onRefs={() => setRefs({ first: true })} />
            {shown && open && <ReportSheet r={shown} mapName={shown.map ? names.get(shown.map) ?? null : null} fresh={open.fresh} onClose={() => setOpen(null)} />}
            {shownLetter && !open && <LetterSheet w={w} m={shownLetter} onClose={closeLetter} />}
            {refs && !open && !shownLetter && <RefPanel content={content} mv={mv} v={v} send={send} first={refs.first} onClose={closeRefs} onTook={() => undefined} />}
          </>
        )
      }} />
  )
}

/** Phase 3 from its first stage to the break that follows it. */
export function Maintaining({ w, onSlides }: { w: Welcome; onSlides?: (() => void) | null }) {
  const view = usePlayer((s) => s.view)!
  const content = usePlayer((s) => s.content.maintaining) as MaintainingContent | undefined
  const mv: MaintainingView | null = view.maintaining
  if (!mv || !content) return <div className="banner">{P3.phase}…</div>
  setUnit3(content.rules.moneyUnit)
  if (mv.reveal) return <YearReveal w={w} content={content} mv={mv} inBreak={view.stage === 'break.maintaining'} onSlides={onSlides ?? null} />
  return <YearPlay w={w} content={content} />
}
