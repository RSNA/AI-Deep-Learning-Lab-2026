// The Phase 3 reveal (engineering spec, section 10.6). The annual review beside the score of the
// year and its parts, the chart of the year with every report, the player's year beside the
// reference maps left alone, and every event of the year with what it taught.
import type { MaintainingContent, MaintainingView, Welcome } from '@lab02/protocol'
import { Portrait } from '../components/ui.tsx'
import { Paragraphs } from '../lib/marks.tsx'
import { usePlayer } from '../lib/player.ts'
import { P1 } from '../phase1/copy.ts'
import { P3 } from './copy.ts'
import { mapNames } from './model.ts'
import { SPENT_PARTS, YearPanel } from './Year.tsx'

export function YearReveal({ w, content, mv, inBreak, onSlides }: { w: Welcome; content: MaintainingContent; mv: MaintainingView; inBreak: boolean; onSlides: (() => void) | null }) {
  const view = usePlayer((s) => s.view)!
  const rv = mv.reveal!
  const letter = view.inbox.find((m) => m.id === 'maintaining:letter')
  const fromIdx = letter ? w.system.cast.findIndex((c) => c.id === letter.from) : -1
  const from = fromIdx >= 0 ? w.system.cast[fromIdx] : undefined
  const pts = view.points.maintaining
  const names = mapNames(mv.validations)
  // One column for every report of the year, however long the facilitator let it run.
  const periods = mv.reports.map((r) => ({ id: r.period, short: r.short }))
  const short = (p: number) => periods[p - 1]?.short ?? String(p)
  const rows = [
    { key: 'you', label: P3.yours, values: rv.values, score: rv.score, me: true },
    ...rv.references.map((r) => ({ key: r.id, label: r.label, values: r.values, score: r.score, me: false })),
    { key: 'none', label: rv.baseline.label, values: rv.baseline.values, score: rv.baseline.score, me: false },
  ]
  const best = Math.max(...rows.map((r) => r.score))
  return (
    <main className="reveal p3rev">
      <div className="reveal-notice">{P3.timeUp}{inBreak ? ` ${P1.lookAtScreen}` : ''}{onSlides && <button type="button" className="btn small" onClick={onSlides}>{P1.backToSlides}</button>}</div>
      <div className={`reveal-top${letter ? '' : ' solo'}`}>
        {letter && (
          <section className="panel letter">
            <div className="panel-head sun"><span>{P3.letterTitle}</span></div>
            <div className="panel-body">
              {from && (
                <div className="speaker">
                  <Portrait c={from} cast={w.system.cast} index={fromIdx} size={60} />
                  <div><div className="nm">{from.name}</div><div className="rl">{from.role}</div></div>
                </div>
              )}
              <Paragraphs text={letter.text} />
            </div>
          </section>
        )}
        <section className="panel score">
          <div className="panel-head"><span>{P3.yourScore}</span></div>
          <div className="panel-body">
            <div className="srow2"><div>{P3.meanValue}</div><span className="num">{P3.out100(rv.mean)}</span></div>
            <div className="srow2">
              <div>
                <div>{P3.moneySpent}</div>
                <div className="muted">{P3.moneyOff(rv.costPerPoint)}</div>
              </div>
              <span className="num">{P3.sum(rv.spent.total)}</span>
            </div>
            <div className="p3spent">
              {SPENT_PARTS.filter((k) => rv.spent[k] > 0).map((k) => <div key={k} className="kv"><span>{P3.spentParts[k]}</span><span className="v">{P3.sum(rv.spent[k])}</span></div>)}
            </div>
            <div className="srow2"><div>{P3.yearScore}</div><span className="num">{P3.out100(rv.score)}</span></div>
            {pts && (
              <div className="bigpts">
                <span className="num">{pts.points}</span><span className="face">{P3.phasePoints}</span>
                {pts.band && <span className="chip sun">{pts.band}</span>}
              </div>
            )}
            {pts && <div className="hint">{P3.scaleLine}</div>}
          </div>
        </section>
      </div>
      <YearPanel mv={mv} content={content} names={names} readOnly />
      <section className="panel p3cmp">
        <div className="panel-head lav"><span>{P3.compareTitle(rv.references.length)}</span></div>
        <div className="panel-body">
          <p className="hint">{P3.compareLine(rv.references.length)}</p>
          <div className="p3cmp-scroll">
            <table>
              <thead>
                <tr><th scope="col" />{periods.map((p) => <th key={p.id} scope="col">{p.short}</th>)}<th scope="col">{P3.yearHead}</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className={r.me ? 'me' : ''}>
                    <th scope="row">{r.label}</th>
                    {periods.map((p, i) => <td key={p.id} className="num">{r.values[i] === undefined ? '–' : P3.whole(r.values[i]!)}</td>)}
                    <td className={`num yr${r.score >= best - 1e-9 ? ' best' : ''}`}>{P3.out100(r.score)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
      <section className="panel p3events">
        <div className="panel-head sky"><span>{P3.eventsTitle}</span></div>
        <div className="panel-body">
          <div className="p3evs">
            {rv.events.map((e) => (
              <div key={e.id} className={`p3ev${e.acted ? ' hit' : ''}`}>
                <div className="p3ev-h"><span className="p3ev-when">{short(e.from)}</span><h3>{e.title}</h3></div>
                <p>{e.text}</p>
                <div className={`p3ev-f${e.acted ? ' hit' : ''}`}>{e.acted ? `${P3.eventHit} · ${P3.eventPeriods(e.periods.map(short).join(', '))}` : P3.eventMissed}</div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  )
}
