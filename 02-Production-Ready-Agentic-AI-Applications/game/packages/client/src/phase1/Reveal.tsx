// The Phase 1 reveal (engineering spec, section 10.4): the corrected board with the player's
// pick marked on every problem, the letter, and the score in its two parts.
import { useState } from 'react'
import type { PlanningContent, PlanningView, Welcome } from '@lab02/protocol'
import { Portrait } from '../components/ui.tsx'
import { Paragraphs } from '../lib/marks.tsx'
import { usePlayer } from '../lib/player.ts'
import { P1 } from './copy.ts'
import { classTone } from './Sorting.tsx'

type Mark = 'right' | 'near' | 'wrong' | 'unsorted'
const MARK_ICON: Record<Mark, string> = { right: '✓', near: '≈', wrong: '✗', unsorted: '–' }

export function Reveal({ w, content, pv, inBreak }: { w: Welcome; content: PlanningContent; pv: PlanningView; inBreak: boolean }) {
  const view = usePlayer((s) => s.view)!
  const rv = pv.reveal!
  const classes = content.rules.classes
  const flagship = rv.problems.find((p) => p.flagship)
  const [open, setOpen] = useState<Set<string>>(() => new Set(flagship ? [flagship.id] : []))
  const letter = view.inbox.find((m) => m.id === 'planning:letter')
  const from = letter ? w.system.cast.find((c) => c.id === letter.from) : undefined
  const fromIdx = from ? w.system.cast.indexOf(from) : 0
  const pts = view.points.planning
  const markOf = (pid: string, truth: string): Mark => {
    const g = rv.graded.find((x) => x.problem === pid)
    if (!g || g.picked === null) return 'unsorted'
    if (g.picked === truth) return 'right'
    return g.points > 0 ? 'near' : 'wrong'
  }
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const flagTitle = flagship ? content.problems.find((p) => p.id === flagship.id)?.title : undefined

  return (
    <main className="reveal">
      <div className="reveal-notice">{P1.timeUp}{inBreak ? ` ${P1.lookAtScreen}` : ''}</div>
      <section className="panel reveal-board">
        <div className="panel-head sky"><span>{P1.corrected}</span></div>
        <div className="panel-body">
          <p className="muted">{P1.correctedHint}</p>
          <div className="rbins">
            {classes.map((c, i) => (
              <div key={c.id} className="rbin">
                <div className={`rbin-head ${classTone(i)}`}>{c.label}</div>
                {rv.problems.filter((p) => p.class === c.id).map((p) => {
                  const pr = content.problems.find((x) => x.id === p.id)
                  const g = rv.graded.find((x) => x.problem === p.id)
                  const mark = markOf(p.id, p.class)
                  const picked = g?.picked ? classes.find((x) => x.id === g.picked)?.short ?? g.picked : null
                  const isOpen = open.has(p.id)
                  return (
                    <div key={p.id} className={`rprob mark-${mark}${p.flagship ? ' flag' : ''}`}>
                      <button type="button" className="rprob-head" aria-expanded={isOpen} onClick={() => toggle(p.id)}>
                        <span className="rmark" aria-label={P1.mark[mark]}>{MARK_ICON[mark]}</span>
                        <span className="rtitle">{pr?.title}{p.flagship && <span className="tagchip flagtag">{P1.flagship}</span>}</span>
                        <span className="rpick">
                          <span>{picked ? P1.youPicked(picked) : P1.mark.unsorted}</span>
                          <span className="num">{P1.pts(g?.points ?? 0)}</span>
                        </span>
                      </button>
                      {isOpen && (
                        <div className="rprob-body">
                          <div className="rmarkline">{P1.mark[mark]}</div>
                          <p>{p.rationale}</p>
                          {p.burden && <p className="note"><b>{P1.burden}:</b> {p.burden.note}</p>}
                          <p className="note">{p.tier !== null ? P1.rung(p.tier, w.ladder.find((r) => r.rung === p.tier)?.label ?? '') : P1.noRung}</p>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </section>
      <div className="reveal-side">
        {letter && (
          <section className="panel letter">
            <div className="panel-head sun"><span>{P1.letter}</span></div>
            <div className="panel-body">
              {from && (
                <div className="speaker">
                  <Portrait c={from} art={w.art} index={fromIdx} systemIndex={w.system.index} size={48} />
                  <div><div className="nm">{from.name}</div><div className="rl">{from.role}</div></div>
                </div>
              )}
              <Paragraphs text={letter.text} />
            </div>
          </section>
        )}
        <section className="panel score">
          <div className="panel-head"><span>{P1.score}</span></div>
          <div className="panel-body">
            <div className="kv"><span>{P1.classify}</span><span className="v">{rv.classify}</span></div>
            <div className="kv"><span>{P1.flagshipPart}</span><span className="v">{rv.flagship}</span></div>
            <div className="kv"><span>{P1.raw}</span><span className="v">{rv.raw}</span></div>
            {pts && (
              <div className="bigpts">
                <span className="num">{pts.points}</span><span className="face">{P1.points}</span>
                <span className="chip sun" style={{ textTransform: 'capitalize' }}>{pts.band}</span>
                {pts.provisional && <span className="chip">Provisional</span>}
              </div>
            )}
          </div>
        </section>
        {flagTitle && <div className="buildnext">{P1.buildNext(flagTitle)}</div>}
      </div>
    </main>
  )
}
