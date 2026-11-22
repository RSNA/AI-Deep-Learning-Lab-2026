// The Phase 1 reveal (engineering spec, section 10.4). Three rows, each as wide as the page, so
// no column can end before its neighbor: the letter beside the score at the same height; the
// corrected assessment, with the agent project across it and the other three classes in equal
// columns; the closing line. On a phone the same parts stack in that order.
import { useState } from 'react'
import type { PlanningContent, PlanningView, Welcome } from '@lab02/protocol'
import { Portrait } from '../components/ui.tsx'
import { Marks, Paragraphs } from '../lib/marks.tsx'
import { usePlayer } from '../lib/player.ts'
import { P1 } from './copy.ts'
import { shownClasses } from './model.ts'
import { classTone } from './Sorting.tsx'

type Mark = 'right' | 'near' | 'wrong' | 'unsorted'
const MARK_ICON: Record<Mark, string> = { right: '✓', near: '≈', wrong: '✗', unsorted: '–' }

export function Reveal({ w, content, pv, inBreak, onSlides }: { w: Welcome; content: PlanningContent; pv: PlanningView; inBreak: boolean; onSlides: (() => void) | null }) {
  const view = usePlayer((s) => s.view)!
  const rv = pv.reveal!
  const classes = content.rules.classes
  const flagCls = classes.at(-1)!
  const flagship = rv.problems.find((p) => p.flagship)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const letter = view.inbox.find((m) => m.id === 'planning:letter')
  const fromIdx = letter ? w.system.cast.findIndex((c) => c.id === letter.from) : -1
  const from = fromIdx >= 0 ? w.system.cast[fromIdx] : undefined
  const pts = view.points.planning
  const empty = rv.graded.every((g) => g.picked === null)
  const graded = (pid: string) => rv.graded.find((x) => x.problem === pid)
  const markOf = (pid: string, truth: string): Mark => {
    const g = graded(pid)
    if (!g || g.picked === null) return 'unsorted'
    if (g.picked === truth) return 'right'
    return g.points > 0 ? 'near' : 'wrong'
  }
  const shortOf = (id: string | null | undefined) => (id ? classes.find((x) => x.id === id)?.short ?? id : null)
  const marks = rv.problems.map((p) => markOf(p.id, p.class))
  const right = marks.filter((m) => m === 'right').length
  const near = marks.filter((m) => m === 'near').length
  const board = rv.classify + rv.flagship
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const rungText = (tier: number | null) => (tier !== null ? P1.rung(tier, w.ladder.find((r) => r.rung === tier)?.label ?? '') : P1.noRung)
  const pickLine = (pid: string, mark: Mark) => {
    if (empty) return null
    const g = graded(pid)
    const picked = shortOf(g?.picked)
    return (
      <div className={`rpick mark-${mark}`}>
        <span className="rmark" aria-label={P1.mark[mark]}>{MARK_ICON[mark]}</span>
        <span>{P1.yourPick}</span>
        {picked ? <span className={`pchip ${classTone(classes.findIndex((c) => c.id === g?.picked))}`}>{picked}</span> : <span className="muted">{P1.mark.unsorted}</span>}
        {mark === 'near' && <span className="muted">· {P1.mark.near.toLowerCase()}</span>}
      </div>
    )
  }

  const flagRow = flagship && (() => {
    const pr = content.problems.find((x) => x.id === flagship.id)
    const g = graded(flagship.id)
    const mark = markOf(flagship.id, flagship.class)
    return (
      <div className="agentrow">
        <div className={`rhead ${classTone(classes.length - 1)}`}><span>{flagCls.label}</span><span className="num">{rv.problems.filter((p) => p.class === flagCls.id).length}</span></div>
        <div className="agentbody">
          <div className="agenttop">
            <div className="agenttitle"><h3>{pr?.title}</h3><span className="tagchip flagtag">{P1.flagship}</span></div>
            {!empty && (
              <div className="agentpts">
                <div className="num">{P1.pts(g?.points ?? 0)}{rv.flagship > 0 && <> {P1.pts(rv.flagship)}</>}</div>
                <div className="muted">{P1.flagPtsCaption}</div>
              </div>
            )}
          </div>
          {pickLine(flagship.id, mark)}
          <div className="two">
            <div><div className="eyebrow">{P1.whyThis}</div><p><Marks text={flagship.rationale} /></p></div>
            <div className="costbox">
              <div className="eyebrow">{P1.burden}</div>
              {flagship.burden && <p><Marks text={flagship.burden.note} /></p>}
              <p className="note">{rungText(flagship.tier)}</p>
            </div>
          </div>
        </div>
      </div>
    )
  })()

  return (
    <main className="reveal">
      <div className="reveal-notice">{P1.timeUp}{inBreak ? ` ${P1.lookAtScreen}` : ''}{onSlides && <button type="button" className="btn small" onClick={onSlides}>{P1.backToSlides}</button>}</div>
      <div className={`reveal-top${letter ? '' : ' solo'}`}>
        {letter && (
          <section className="panel letter">
            <div className="panel-head sun"><span>{P1.letter}</span></div>
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
          <div className="panel-head"><span>{P1.score}</span></div>
          <div className="panel-body">
            <div className="srow2"><div><div>{P1.classify}</div><div className="muted">{empty ? P1.mark.unsorted : P1.rightCount(right, near, rv.problems.length)}</div></div><span className="num">{rv.classify}</span></div>
            <div className="srow2"><div><div>{P1.flagshipPart}</div><div className="muted">{rv.flagship > 0 ? P1.found : P1.missed}</div></div><span className="num">{rv.flagship}</span></div>
            {pts && pts.points !== board && <div className="srow2"><div>{P1.boardScore}</div><span className="num">{board}</span></div>}
            {pts && (
              <div className="bigpts">
                <span className="num">{pts.points}</span><span className="face">{pts.points === board ? P1.points : P1.phasePoints}</span>
                {pts.band && <span className="chip sun">{pts.band}</span>}
              </div>
            )}
            {pts && pts.points !== board && <div className="hint">{P1.oneScale}</div>}
          </div>
        </section>
      </div>
      <section className="panel reveal-board">
        <div className="panel-head lav"><span>{P1.corrected}</span>{!empty && <span className="sub">{P1.rightCount(right, near, rv.problems.length)}</span>}</div>
        <div className="panel-body">
          {empty ? <div className="empty-board">{P1.emptyBoard}</div> : <p className="muted">{P1.correctedHint}</p>}
          {flagRow}
          <div className="rthree">
            {shownClasses(classes).filter((x) => x.c.id !== flagCls.id).map(({ c, tone }) => (
              <div key={c.id} className="rbin">
                <div className={`rhead ${classTone(tone)}`}><span>{c.label}</span><span className="num">{rv.problems.filter((p) => p.class === c.id).length}</span></div>
                {rv.problems.filter((p) => p.class === c.id).map((p) => {
                  const pr = content.problems.find((x) => x.id === p.id)
                  const g = graded(p.id)
                  const mark = markOf(p.id, p.class)
                  const isOpen = open.has(p.id)
                  return (
                    <div key={p.id} className={`rprob${isOpen ? ' open' : ''}`}>
                      <div className="rprob-top">
                        <span className="rtitle">{pr?.title}</span>
                        {!empty && <span className="num rpts">{P1.pts(g?.points ?? 0)}</span>}
                      </div>
                      <div className="rprob-mid">
                        {pickLine(p.id, mark) ?? <span />}
                        <button type="button" className="whybtn" aria-expanded={isOpen} onClick={() => toggle(p.id)}>{isOpen ? `${P1.hideWhy} ▴` : `${P1.why} ▾`}</button>
                      </div>
                      {isOpen && (
                        <div className="rprob-body">
                          <p><Marks text={p.rationale} /></p>
                          {p.burden && <p className="note"><b>{P1.burden}:</b> <Marks text={p.burden.note} /></p>}
                          <p className="note">{rungText(p.tier)}</p>
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
      {flagship && <div className="buildnext">{P1.buildNext(content.problems.find((p) => p.id === flagship.id)?.title ?? '')}</div>}
    </main>
  )
}
