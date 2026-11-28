// The year of Phase 3 (engineering spec, section 10.6): the timer that counts to the next
// report, the report of a period of two months, and the panel that holds the chart of the year
// beside the reports. A report shows what the server sent and nothing it worked out itself.
import { useEffect, useState } from 'react'
import type { InboxItem, MaintainingContent, MaintainingView, Welcome } from '@lab02/protocol'
import { Portrait, Sheet } from '../components/ui.tsx'
import { gameNow, useTick } from '../lib/clock.ts'
import { Paragraphs } from '../lib/marks.tsx'
import { usePlayer } from '../lib/player.ts'
import { useNarrow } from '../phase1/Phase1.tsx'
import { YearChart } from './Chart.tsx'
import { P3 } from './copy.ts'
import { chartPoints, gapOf, type Report } from './model.ts'

export const SPENT_PARTS = ['phase2', 'actions', 'adoption', 'running', 'fines'] as const

/** Seconds until the report that ends the round in progress, or null when the year is over. */
export function useRoundLeft(mv: MaintainingView): number | null {
  useTick(250)
  const clock = usePlayer((s) => s.clock)
  const end = mv.round.endsAtMs
  if (end === null || !clock) return null
  return Math.max(0, (end - gameNow(clock)) / 1000)
}

/**
 * The timer on top: the time until the next report, the two months it will cover, and the round.
 * `bar`: in the top bar of a laptop. `strip`: one line above the tabs of a phone.
 */
export function RoundTimer({ mv, variant }: { mv: MaintainingView; variant: 'bar' | 'strip' }) {
  const left = useRoundLeft(mv)
  const clock = usePlayer((s) => s.clock)
  const solo = usePlayer((s) => s.welcome?.session.kind === 'solo')
  const next = mv.next
  const paused = clock && !clock.clock.running
  const late = left !== null && left <= 20
  const t = left === null ? '--:--' : `${String(Math.floor(Math.ceil(left) / 60)).padStart(2, '0')}:${String(Math.ceil(left) % 60).padStart(2, '0')}`
  const round = Math.min(mv.round.index, mv.round.of)
  // The last round of a single-player game stays open past its time, until its player ends the year.
  const over = left === 0 && solo && mv.round.index >= mv.round.of
  if (!next || left === null) return <div className={`p3timer ${variant}`} data-tour="p3-timer" role="timer"><span className="p3t-what"><span className="p3t-until">{P3.yearOver}</span></span></div>
  return (
    <div className={`p3timer ${variant}`} data-tour="p3-timer" role="timer" aria-live="off" aria-label={`${P3.until(left, next.label)}. ${P3.roundOf(round, mv.round.of)}`}>
      <span className={`countdown${late ? ' late' : ''}`}>{paused ? '‖ ' : ''}{t}</span>
      <span className="p3t-what"><span className="p3t-round">{variant === 'bar' ? `${P3.phase} · ` : ''}{P3.roundOf(round, mv.round.of)}</span><span className="p3t-until">{over ? (variant === 'bar' ? P3.overTimeShort : P3.overTime(next.label)) : P3.untilShort(next.label)}</span></span>
    </div>
  )
}

function Bar({ share, tone }: { share: number; tone: 'go' | 'bad' }) {
  return <span className={`p3bar ${tone}`}><i style={{ width: `${Math.max(0, Math.min(100, 100 * share))}%` }} /></span>
}

/**
 * One report: validity, reliability, the score and the bill. `details` adds what else is known of
 * the two months (the sentences, the part that failed most, what an action under Watch made the
 * report say). `mapName`: what the map that ran is called in the player's list.
 */
export function ReportBody({ r, mapName, details = false }: { r: Report; mapName: string | null; details?: boolean }) {
  const gap = gapOf(r)
  const s = r.sentences
  // The bars of the parts are drawn against the part that lost the most.
  const worst = Math.max(1e-9, ...(r.parts ?? []).map((x) => x.share))
  return (
    <div className="p3rep">
      <div className="p3two">
        <div className="p3n validity">
          <div className="p3n-l">{P3.validity}</div>
          <div className="p3n-v"><span className="num">{P3.share100(r.validity)}</span><span className="p3n-of">{P3.of100}</span></div>
          <div className="p3n-s">{r.map === null ? P3.validityIs : <>{P3.onTestSet(P3.share100(r.test))}{gap >= 0.05 && <b className="p3gap"> {P3.gapPoints(P3.out100(gap))}</b>}</>}</div>
        </div>
        <div className="p3n reliability">
          <div className="p3n-l">{P3.reliability}</div>
          <div className="p3n-v"><span className="num">{P3.share100(r.reliability)}</span><span className="p3n-of">{P3.of100}</span></div>
          <div className="p3n-s">{P3.interruptions(r.interruptions)}</div>
        </div>
        <div className="p3n score">
          <div className="p3n-l">{P3.scorePeriod}</div>
          <div className="p3n-v"><span className="num">{P3.out100(r.value)}</span></div>
          <div className="p3n-s">{r.map === null ? P3.ranNoMap : P3.scorePeriodHow(P3.share100(r.validity), P3.share100(r.reliability), r.off)}</div>
        </div>
      </div>
      <div className="p3ran">{mapName ? P3.ran(mapName) : P3.ranNoMap}</div>
      {details && (
        <>
      {(s.noMap || s.validity || s.reliability || s.gap || s.steady) && (
        <div className="p3says">
          {s.noMap && <p>{s.noMap}</p>}
          {s.validity && <p>{s.validity}</p>}
          {s.gap && <p>{s.gap}</p>}
          {s.reliability && <p>{s.reliability}</p>}
          {s.steady && <p>{s.steady}</p>}
        </div>
      )}
      <div className="p3blocks">
        {r.worstChange && (
          <div className="p3block change">
            <div className="eyebrow">{P3.worstChange}</div>
            <p>{r.worstChange.symptom}</p>
            {r.worstChange.cause ? <p className="p3cause"><b>{P3.cause}:</b> {r.worstChange.cause}</p> : <p className="hint">{P3.causeLocked}</p>}
          </div>
        )}
        {r.worstPart && (
          <div className="p3block part">
            <div className="eyebrow">{P3.failedMost}</div>
            <p><b>{r.worstPart.label}.</b> {r.worstPart.text}</p>
          </div>
        )}
        {(s.people || r.off > 0) && (
          <div className="p3block people">
            <div className="eyebrow">{P3.people}</div>
            <p>{s.people} {r.off > 0 && <b className="p3off">{P3.pointsOff(r.off)}</b>}</p>
          </div>
        )}
        {r.note && <div className="p3block note"><div className="eyebrow">{P3.note}</div><p>{r.note}</p></div>}
      </div>
      {(r.parts || r.kinds) && (
        <div className="p3lens">
          {r.parts && (
            <div>
              <div className="eyebrow">{P3.partsTitle}</div>
              {r.parts.length ? r.parts.map((x) => (
                <div key={x.label} className="p3row"><span className="p3row-l">{x.label}</span><Bar share={x.share / worst} tone="bad" /><b className="num">{P3.share100(x.share)}</b></div>
              )) : <p className="muted">{P3.interruptions(0)}</p>}
            </div>
          )}
          {r.kinds && (
            <div>
              <div className="eyebrow">{P3.kindsTitle}</div>
              {r.kinds.map((x) => (
                <div key={x.title} className="p3row"><span className="p3row-l">{x.title}</span><Bar share={x.solved} tone="go" /><b className="num">{P3.whole(100 * x.solved)}</b></div>
              ))}
            </div>
          )}
        </div>
      )}
        </>
      )}
      <div className="p3money">
        <div className="eyebrow">{P3.billTitle}</div>
        {r.bill.length === 0 && <p className="muted">{P3.billNothing}</p>}
        {r.bill.map((x, i) => <div key={i} className="kv part"><span>{x.label}</span><span className="v">{P3.sum(x.money)}</span></div>)}
        {r.bill.length > 0 && <div className="kv sum"><span>{P3.billTotal}</span><span className="v">{P3.sum(r.runCost + r.fine)}</span></div>}
        {r.granted > 0 && <div className="kv"><span>{P3.granted}</span><span className="v">+{P3.sum(r.granted)}</span></div>}
        <div className={`kv sum${r.account < 0 ? ' below' : ''}`}><span>{P3.accountLeft}</span><span className="v">{P3.sum(r.account)}</span></div>
        {r.account < 0 && <p className="p3below">{P3.accountBelow}</p>}
        <div className="kv total"><span>{P3.scoreYear}</span><span className="v">{P3.out100(r.score)}{r.rank !== null && <span className="p3rank"> · {P3.rank(r.rank, r.of)}</span>}</span></div>
      </div>
    </div>
  )
}

/** A letter or a memo of the year, in a window of its own when it arrives. It stays as a card. */
export function LetterSheet({ w, m, onClose }: { w: Welcome; m: InboxItem; onClose: () => void }) {
  const idx = w.system.cast.findIndex((c) => c.id === m.from)
  const c = w.system.cast[idx]
  return (
    <Sheet title={m.kind === 'announcement' ? P3.memoTitle : P3.letterTitle} head="sun" onClose={onClose} wide className="p3letter">
      {c && (
        <div className="speaker">
          <Portrait c={c} cast={w.system.cast} index={idx} size={64} />
          <div><div className="nm">{c.name}</div><div className="rl">{c.role}</div></div>
        </div>
      )}
      {m.title && <h2 className="brief-title">{m.title}</h2>}
      <div className="brief-text"><Paragraphs text={m.text} /></div>
      <div className="brief-foot">
        <span className="muted">{P3.letterKept}</span>
        <button type="button" className="btn go big" autoFocus onClick={onClose}>{P3.letterClose}</button>
      </div>
    </Sheet>
  )
}

/** A report that has just arrived, over the board. It stays in the list of the year. */
export function ReportSheet({ r, mapName, fresh, onClose }: { r: Report; mapName: string | null; fresh: boolean; onClose: () => void }) {
  return (
    <Sheet title={P3.reportOn(r.label)} head="go" onClose={onClose} className="p3sheet">
      {fresh && <span className="flag look">{P3.newReport}</span>}
      <ReportBody r={r} mapName={mapName} />
      <div className="sheet-actions"><button type="button" className="btn go" autoFocus onClick={onClose}>{P3.closeReport}</button></div>
    </Sheet>
  )
}

/**
 * One cell across both columns under the map: the chart of the year, and beside it the reports,
 * one for each period that has ended, to step through.
 */
export function YearPanel({ mv, content, names, onOpen, readOnly = false }: {
  mv: Pick<MaintainingView, 'reports' | 'slots' | 'spent' | 'score'>; content: MaintainingContent; names: Map<string, string>
  /** Open a report as a card over the board. */
  onOpen?: (period: number) => void
  readOnly?: boolean
}) {
  const n = mv.reports.length
  const [at, setAt] = useState(Math.max(0, n - 1))
  const [more, setMore] = useState(false)
  // A new report is the one shown, until the player steps away from it.
  useEffect(() => { setAt(Math.max(0, n - 1)) }, [n])
  const r = mv.reports[Math.min(at, n - 1)]
  const narrow = useNarrow(700)
  return (
    <section className="panel p3year" id="p3-year">
      <div className="panel-head go"><span>{P3.yearTitle}</span><span className="sub">{P3.yearSub(n, mv.slots.length)}</span></div>
      <div className="panel-body p3year-body">
        <div className="p3chart" data-tour="p3-chart">
          <YearChart compact={narrow} slots={mv.slots} names={mv.reports.map((x) => x.short)} points={chartPoints(mv.reports)} selected={r ? Math.min(at, n - 1) : null} onSelect={setAt} />
          {n > 0 && (
            <div className="p3rows" role="group" aria-label={P3.chartTitle}>
              <div className="p3rows-h" aria-hidden="true"><span>{P3.periodsHead}</span><span>{P3.mapHead}</span><span>{P3.validity}</span><span>{P3.reliability}</span><span>{P3.scoreShort}</span></div>
              {mv.reports.map((x, i) => (
                <button key={x.period} type="button" className={i === Math.min(at, n - 1) ? 'on' : ''} aria-pressed={i === Math.min(at, n - 1)} aria-label={P3.showReport(x.label)} onClick={() => setAt(i)}>
                  <span>{x.short}</span><span className="p3rows-m">{x.map ? names.get(x.map) ?? '' : P3.ranNoMap}</span>
                  <span className="num">{P3.share100(x.validity)}</span><span className="num">{P3.share100(x.reliability)}</span><span className="num">{P3.out100(x.value)}</span>
                </button>
              ))}
            </div>
          )}
          {n > 0 && !readOnly && (
            <div className="p3purse">
              <div className="eyebrow">{P3.moneyTitle}</div>
              <div className="kv total"><span>{P3.scoreYear}</span><span className="v">{P3.out100(mv.score)}</span></div>
              <div className="kv"><span>{P3.spentSoFar}</span><span className="v">{P3.sum(mv.spent.total)}</span></div>
              {SPENT_PARTS.filter((k) => mv.spent[k] > 0).map((k) => <div key={k} className="kv part"><span>{P3.spentParts[k]}</span><span className="v">{P3.sum(mv.spent[k])}</span></div>)}
              <div className="hint">{P3.moneyOff(content.year.costPerPoint)}</div>
            </div>
          )}
        </div>
        <div className="p3report" data-tour="p3-report">
          {r ? (
            <>
              <div className="p3step">
                <button type="button" className="btn small" disabled={at <= 0} title={at <= 0 ? P3.firstReport : P3.olderReport} onClick={() => setAt(at - 1)} aria-label={P3.olderReport}>‹</button>
                <h3>{P3.reportOn(r.label)}</h3>
                <button type="button" className="btn small" disabled={at >= n - 1} title={at >= n - 1 ? P3.lastReportYet : P3.newerReport} onClick={() => setAt(at + 1)} aria-label={P3.newerReport}>›</button>
                {!readOnly && onOpen && <button type="button" className="btn small text p3open" onClick={() => onOpen(r.period)}>{P3.openReport}</button>}
              </div>
              <ReportBody r={r} mapName={r.map ? names.get(r.map) ?? null : null} details={more} />
              <button type="button" className="btn small text p3more" aria-expanded={more} onClick={() => setMore(!more)}>{more ? P3.lessAbout : P3.moreAbout}</button>
            </>
          ) : <p className="muted">{P3.noReportYet}</p>}
        </div>
      </div>
    </section>
  )
}

/** One quiet line between the map and its footer: the map that runs, and the numbers of the last report. */
export function NowLine({ mv, names, onOpen }: { mv: MaintainingView; names: Map<string, string>; onOpen: (period: number) => void }) {
  const r = mv.reports.at(-1)
  return (
    <div className="p3now">
      <span className="p3now-run"><i className={mv.deployed ? 'on' : ''} aria-hidden="true" /><b>{P3.now}:</b> {mv.deployed ? names.get(mv.deployed) ?? '' : P3.ranNoMap}</span>
      {r && (
        <button type="button" className="p3now-last" onClick={() => onOpen(r.period)} title={P3.openReport}>
          <span className="p3now-l">{P3.lastReport(r.short)}</span>
          <span>{P3.validity} <b className="num">{P3.share100(r.validity)}</b></span>
          <span>{P3.reliability} <b className="num">{P3.share100(r.reliability)}</b></span>
          <span>{P3.scoreShort} <b className="num">{P3.out100(r.value)}</b></span>
        </button>
      )}
    </div>
  )
}
