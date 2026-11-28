// Phase 2 for the player (engineering spec, section 10.5). The board itself (the map, the
// toolbox, the shelves, the actions, the tabs of a phone) is ./Board.tsx, which Phase 3 shows
// too. This file adds what is Phase 2's own: every validation with its example, the map a player
// chooses to count, and the reveal.
import type { CanvasMap, DevelopmentContent, DevelopmentView, Welcome } from '@lab02/protocol'
import { sameLayout } from '../canvas/model.ts'
import { useTour } from '../components/Tour.tsx'
import { usePlayer } from '../lib/player.ts'
import { MapBoard, P2_BOARD_WORDS, sameAsValidation } from './Board.tsx'
import { P2 } from './copy.ts'
import { FirstBuild, useFirstBuild } from './FirstBuild.tsx'
import { DevReveal } from './Reveal.tsx'

export { InsightsPanel, P2_TABS_BELOW, Purse, gridWords, lockedByOf, reasonText, vocabularyOf } from './Board.tsx'

// ------------------------------------------------------------------------------------------
// Every validation of the phase, the newest first. Nothing of an earlier one is hidden: each
// keeps its accuracy, its example and its note, and its map can be put back on the canvas.
// ------------------------------------------------------------------------------------------
type Pool = { id: string; label: string; max: number }

/** What happened to a validated map whose people had fewer minutes than it asks of them. */
function rushedLines(v: DevelopmentView['validations'][number], pools: Pool[]): string[] {
  if (v.unhurried === null || v.unhurried === undefined) return []
  const out = pools.filter((pl) => (v.running?.minutes[pl.id] ?? 0) > pl.max + 1e-9).map((pl) => P2.rushedPool(pl.label, v.running!.minutes[pl.id]!, pl.max))
  if (!out.length) out.push(P2.rushedPlain)
  out.push(P2.unhurried(v.unhurried))
  return out
}

export function ResultsPanel({ dv, runs, pools, current, onLoad, onChoose, readOnly = false }: {
  dv: DevelopmentView; runs: number; pools: Pool[]
  /** The draft on the canvas, so that a validation can say that its map is the one there now. */
  current?: CanvasMap
  onLoad: (m: CanvasMap, n: number) => void; onChoose: (id: string | null) => void; readOnly?: boolean
}) {
  const n = dv.validations.length
  // Where the first validations are free, every validation has its number and the free ones say so.
  const free = dv.validations.filter((v) => v.free).length
  const head = <div className="panel-head sky"><span>{P2.validationsTitle}</span><span className="sub">{free ? P2.usedOfFree(n - free, runs, free) : P2.usedOf(n, runs)}</span></div>
  if (!n) return <section className="panel p2results" id="p2-results">{head}<div className="panel-body"><p className="muted">{P2.noValidation}</p></div></section>
  const best = dv.validations.reduce((b, v) => (v.accuracy > b.accuracy ? v : b), dv.validations[0]!)
  return (
    <section className="panel p2results" id="p2-results">
      {head}
      <div className="panel-body">
        <ol className="vruns" reversed>
          {[...dv.validations].reverse().map((v, i) => {
            const num = n - i
            const sending = dv.submitId === v.id
            const here = !!current && sameLayout(current, v.map)
            const rushed = rushedLines(v, pools)
            return (
              <li key={v.id} className={`vrun${i === 0 ? ' newest' : ''}${sending ? ' send' : ''}`} data-validation={v.id}>
                <div className="vrun-h">
                  <span className="vrun-n">{free ? P2.validationPlain(num) : P2.validationN(num, runs)}</span>
                  {v.free && <span className="flag">{P2.freeTag}</span>}
                  {i === 0 && n > 1 && <span className="flag look">{P2.latest}</span>}
                  {v.rank !== null && <span className="vrank">{P2.rank(v.rank, v.of)}</span>}
                </div>
                <div className="vrun-b">
                  <div className="vacc"><span className="num">{P2.acc1(v.accuracy)}</span><span className="face">{P2.accuracy}</span></div>
                  <div className="vrun-t">
                    {v.missed && (
                      <div className="vmiss">
                        <div className="eyebrow">{P2.missedOne}</div>
                        <p><b>{v.missed.title}.</b> {v.missed.text} <span className="why">{v.missed.why}</span></p>
                      </div>
                    )}
                    {rushed.length > 0 && <div className="vnote rush">{rushed.map((x, k) => <p key={k}>{x}</p>)}</div>}
                    {v.note && <div className="vnote"><b>{P2.note}:</b> {v.note}</div>}
                  </div>
                </div>
                {!readOnly && (
                  <div className="vacts">
                    {here ? <span className="flag look">{P2.onCanvas}</span> : <button type="button" className="btn small" onClick={() => onLoad(v.map, num)}>{P2.restoreMap}</button>}
                    {sending ? <span className="flag">✓ {P2.willSend}</span> : <button type="button" className="btn small" onClick={() => onChoose(v.id)}>{P2.useMap}</button>}
                  </div>
                )}
              </li>
            )
          })}
        </ol>
        <div className="vfoot">
          <p className="hint">{P2.defaultSend}</p>
          {!readOnly && dv.submitId !== best.id && <button type="button" className="btn small" onClick={() => onChoose(null)}>{P2.backToDefault}</button>}
        </div>
      </div>
    </section>
  )
}

// ------------------------------------------------------------------------------------------
// The phase in play
// ------------------------------------------------------------------------------------------
function DevPlay({ w, content }: { w: Welcome; content: DevelopmentContent }) {
  const dv = usePlayer((s) => s.view!.development!)
  const send = usePlayer((s) => s.send)
  const choose = (id: string | null) => { void send('development.choose', { id }) }
  const who = usePlayer((s) => `${s.view!.me.id}-${s.view!.run}`)
  return (
    <MapBoard w={w} phase="development" content={content} dv={dv} words={P2_BOARD_WORDS} spendWord
      sameAs={(map) => sameAsValidation(dv.validations, map)}
      overlays={(api) => <FirstBuild api={api} dv={dv} content={content} who={who} />}
      helpMore={<button type="button" className="btn small" onClick={() => { useTour.getState().closeHelp(); useFirstBuild.getState().start() }}>{P2.first.again}</button>}
      results={(api) => (
        <ResultsPanel dv={dv} runs={content.rules.validations} pools={content.rules.pools} current={api.map} onChoose={choose}
          onLoad={(m, n) => api.load(m, P2.restored(n))} />
      )} />
  )
}

/** Phase 2 from its first stage to the break that follows it. */
export function Development({ w, onSlides }: { w: Welcome; onSlides?: (() => void) | null }) {
  const view = usePlayer((s) => s.view)!
  const content = usePlayer((s) => s.content.development) as DevelopmentContent | undefined
  const dv = view.development
  if (!dv || !content) return <div className="banner">{P2.map}…</div>
  if (dv.reveal) return <DevReveal w={w} content={content} dv={dv} inBreak={view.stage === 'break.development'} onSlides={onSlides ?? null} />
  return <DevPlay w={w} content={content} />
}
