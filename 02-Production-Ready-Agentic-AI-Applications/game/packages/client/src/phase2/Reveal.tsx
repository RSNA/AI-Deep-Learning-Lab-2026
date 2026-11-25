// The Phase 2 reveal (engineering spec, section 10.5). The letter and the score in one row, the
// player's map and the reference map side by side, read-only, and every kind of case with the
// share each map solved. On a phone the same parts stack in that order.
import type { DevelopmentContent, DevelopmentView, Welcome } from '@lab02/protocol'
import { Grid } from '../canvas/Grid.tsx'
import { Portrait } from '../components/ui.tsx'
import { Paragraphs } from '../lib/marks.tsx'
import { usePlayer } from '../lib/player.ts'
import { P1 } from '../phase1/copy.ts'
import { P2 } from './copy.ts'
import { gridWords, vocabularyOf } from './Phase2.tsx'

export function DevReveal({ w, content, dv, inBreak, onSlides }: { w: Welcome; content: DevelopmentContent; dv: DevelopmentView; inBreak: boolean; onSlides: (() => void) | null }) {
  const view = usePlayer((s) => s.view)!
  const rv = dv.reveal!
  const v = vocabularyOf(content)
  const letter = view.inbox.find((m) => m.id === 'development:letter')
  const fromIdx = letter ? w.system.cast.findIndex((c) => c.id === letter.from) : -1
  const from = fromIdx >= 0 ? w.system.cast[fromIdx] : undefined
  const pts = view.points.development
  const sent = dv.validations.find((x) => x.id === dv.submitId)
  const raw = Math.round(rv.raw)
  const none = { stray: [], incomplete: [], privateData: [] }
  return (
    <main className="reveal p2rev">
      <div className="reveal-notice">{P2.timeUp}{inBreak ? ` ${P1.lookAtScreen}` : ''}{onSlides && <button type="button" className="btn small" onClick={onSlides}>{P1.backToSlides}</button>}</div>
      <div className={`reveal-top${letter ? '' : ' solo'}`}>
        {letter && (
          <section className="panel letter">
            <div className="panel-head sun"><span>{P2.letterTitle}</span></div>
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
          <div className="panel-head"><span>{P2.yourScore}</span></div>
          <div className="panel-body">
            <div className="srow2"><div><div>{P2.accuracySent}</div><div className="muted">{sent ? P2.validationOf(sent.id, sent.accuracy) : P2.noMapSent}</div></div><span className="num">{P2.acc1(rv.accuracy)}</span></div>
            {pts && (
              <div className="bigpts">
                <span className="num">{pts.points}</span><span className="face">{P2.phasePoints}</span>
                {pts.band && <span className="chip sun">{pts.band}</span>}
              </div>
            )}
            {pts && pts.points !== raw && <div className="hint">{P2.scaleLine}</div>}
          </div>
        </section>
      </div>
      <div className="p2maps">
        <section className="panel">
          <div className="panel-head sky"><span>{P2.yourMap}</span>{sent && <span className="sub">{P2.acc1(rv.accuracy)}</span>}</div>
          <div className="panel-body">
            {sent ? <div className="gridscroll"><Grid v={v} map={sent.map} flags={none} compact words={gridWords} label={P2.yourMap} /></div> : <p className="muted">{P2.noMapSent}</p>}
          </div>
        </section>
        <section className="panel">
          <div className="panel-head go"><span>{P2.referenceMap}</span><span className="sub">{P2.acc1(rv.reference.accuracy)}</span></div>
          <div className="panel-body">
            <div className="gridscroll"><Grid v={v} map={rv.reference.map} flags={none} compact words={gridWords} label={P2.referenceMap} /></div>
            <p className="refsum">{rv.reference.summary}</p>
          </div>
        </section>
      </div>
      <section className="panel">
        <div className="panel-head lav"><span>{P2.cases}</span></div>
        <div className="panel-body">
          <div className="rcases">
            <div className="rc-head"><span /><span>{P2.yours}</span><span>{P2.reference}</span></div>
            {rv.cases.map((c) => (
              <div key={c.title} className="rcase">
                <div><div className="rc-t">{c.title}</div><div className="rc-x">{c.text}</div></div>
                <div className="rc-bar"><span className="bar"><i style={{ width: `${100 * c.solved}%` }} /></span><b className="num">{P2.pct(c.solved)}</b></div>
                <div className="rc-bar ref"><span className="bar"><i style={{ width: `${100 * c.reference}%` }} /></span><b className="num">{P2.pct(c.reference)}</b></div>
              </div>
            ))}
          </div>
        </div>
      </section>
      <div className="buildnext">{P2.nextPhase}</div>
    </main>
  )
}
