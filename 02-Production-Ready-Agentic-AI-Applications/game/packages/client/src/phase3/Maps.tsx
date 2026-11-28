// The maps of Phase 3 (engineering spec, section 10.6): every map a player validated, in Phase 2
// or now, and the reference maps they took. One of them is deployed: it runs in the period in
// progress. And the panel that offers the reference maps of the pack.
import { useState } from 'react'
import type { CanvasMap, MaintainingContent, MaintainingView } from '@lab02/protocol'
import { Grid } from '../canvas/Grid.tsx'
import { sameLayout, type Vocabulary } from '../canvas/model.ts'
import { Sheet } from '../components/ui.tsx'
import { plainError } from '../lib/errors.ts'
import { gridWords } from '../phase2/Board.tsx'
import { P2 } from '../phase2/copy.ts'
import { P3 } from './copy.ts'
import type { MapEntry } from './model.ts'

const NO_FLAGS = { stray: [], incomplete: [], privateData: [] }

/** What a map of the list was scored on, and what it would have for reliability, as quiet tags. */
function Tags({ v }: { v: MapEntry }) {
  return (
    <span className="p3tags">
      <span className="p3tag">{v.fresh ? P3.onFresh : P3.onTest}</span>
      {v.reliability !== null && <span className="p3tag rel">{P3.reliabilityWould(P3.share100(v.reliability))}</span>}
    </span>
  )
}

export function MapsPanel({ mv, content, names, current, send, onLoad, onRefs, readOnly = false }: {
  mv: MaintainingView; content: MaintainingContent; names: Map<string, string>
  /** The draft on the canvas, so that a map of the list can say that it is the one there now. */
  current?: CanvasMap
  send: (type: string, payload: unknown) => Promise<{ ok: boolean; error?: string }>
  onLoad: (m: CanvasMap, name: string) => void
  onRefs: () => void
  readOnly?: boolean
}) {
  const [refused, setRefused] = useState<{ id: string | null; text: string } | null>(null)
  const [stopping, setStopping] = useState(false)
  const deploy = (id: string | null) => {
    setRefused(null)
    void send('maintaining.deploy', { id }).then((r) => {
      if (!r.ok) { setRefused({ id, text: `${P3.deployRefused} ${plainError(r.error)}` }); setTimeout(() => setRefused(null), 6000) }
    })
  }
  const n = mv.validations.length
  const newest = [...mv.validations].reverse()
  const lastOwn = newest.find((v) => v.origin === 'phase3')
  // The map in service shows a patient that the last report lost, with what would have helped.
  const lastReport = mv.reports.at(-1)
  const inService = lastReport && lastReport.map === mv.deployed ? lastReport.missed : null
  return (
    <section className="panel p2results p3maps" id="p2-results" data-tour="p3-maps">
      <div className="panel-head sky"><span>{P3.mapsTitle}</span><span className="sub">{P3.validationsLeft(mv.validationsLeft, content.rules.validations)}</span></div>
      <div className="panel-body">
        <p className="hint p3deployline">{P3.deployLine}</p>
        {!mv.deployed && <div className="vnote">{P3.noMapRunning}</div>}
        {n === 0 && <p className="muted">{P3.noMaps}</p>}
        <ol className="p3maplist">
          {newest.map((v) => {
            const on = mv.deployed === v.id
            const here = !!current && sameLayout(current, v.map)
            const name = names.get(v.id) ?? v.id
            return (
              <li key={v.id} className={`p3map${on ? ' on' : ''} o-${v.origin}`} data-map={v.id}>
                <div className="p3map-acc"><span className="num">{P2.acc1(v.accuracy)}</span><span className="face">{P3.accuracy}</span></div>
                <div className="p3map-t">
                  <div className="p3map-n">{name}</div>
                  <Tags v={v} />
                  {on && inService ? (
                    <div className="vmiss"><div className="eyebrow">{P3.missedInService}</div><p><b>{inService.title}.</b> {inService.text} <span className="why">{inService.why}</span></p><p className="vhint"><b>{P2.hintLabel}</b> {inService.hint}</p></div>
                  ) : v === lastOwn && v.missed && (
                    <div className="vmiss"><div className="eyebrow">{P2.missedOne}</div><p><b>{v.missed.title}.</b> {v.missed.text} <span className="why">{v.missed.why}</span></p><p className="vhint"><b>{P2.hintLabel}</b> {v.missed.hint}</p></div>
                  )}
                  {v === lastOwn && v.unhurried !== null && <div className="vnote rush"><p>{P2.rushedPlain}</p><p>{P2.unhurried(v.unhurried)}</p></div>}
                  {v === lastOwn && v.note && <div className="vnote"><b>{P2.note}:</b> {v.note}</div>}
                  {refused?.id === v.id && <div className="err irefused" role="alert">{refused.text}</div>}
                </div>
                {!readOnly && (
                  <div className="p3map-acts">
                    {on ? <span className="p3map-is">✓ {P3.runningNow}</span> : <button type="button" className="btn small go" onClick={() => deploy(v.id)}>{P3.deploy}</button>}
                    {here ? <span className="p3map-is quiet">{P3.onCanvas}</span> : <button type="button" className="btn small" onClick={() => onLoad(v.map, name)}>{P3.restore}</button>}
                  </div>
                )}
              </li>
            )
          })}
        </ol>
        {!readOnly && (
          <div className="p3mapfoot" data-tour="p3-refs">
            <button type="button" className="btn small" onClick={onRefs} disabled={!content.references.length} title={content.references.length ? undefined : P3.refNone}>{P3.refOpen(content.references.length)}</button>
            {!content.references.length && <span className="hint">{P3.refNone}</span>}
            {mv.deployed && <button type="button" className="btn small text p3stop" onClick={() => setStopping(true)}>{P3.stopMap}</button>}
            {refused?.id === null && <div className="err irefused" role="alert">{refused.text}</div>}
          </div>
        )}
      </div>
      {stopping && (
        <Sheet title={P3.stopTitle} head="sun" onClose={() => setStopping(false)}>
          <p style={{ fontSize: 16, lineHeight: 1.45 }}>{P3.stopText}</p>
          <div className="sheet-actions">
            <button type="button" className="btn go" onClick={() => setStopping(false)}>{P3.stopNo}</button>
            <button type="button" className="btn danger" onClick={() => { setStopping(false); deploy(null) }}>{P3.stopYes}</button>
          </div>
        </Sheet>
      )}
    </section>
  )
}

/**
 * The reference maps of the pack, one at a time, each with its accuracy on the test set, what it
 * is, and its drawing. Taking one puts it in the list of maps and deploys it.
 */
export function RefPanel({ content, mv, v, send, onClose, onTook, first }: {
  content: MaintainingContent; mv: MaintainingView; v: Vocabulary
  send: (type: string, payload: unknown) => Promise<{ ok: boolean; error?: string }>
  onClose: () => void
  onTook: (label: string) => void
  /** Offered at the start of the phase, before the player asked: the way out says that they keep their own map. */
  first: boolean
}) {
  const refs = content.references
  const [at, setAt] = useState(0)
  const [refused, setRefused] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const r = refs[Math.min(at, refs.length - 1)]
  if (!r) return <Sheet title={P3.refTitle(0)} head="go" onClose={onClose}><p className="muted">{P3.refNone}</p></Sheet>
  const taken = mv.adopted.includes(r.id)
  const offer = mv.offers.find((x) => x.id === r.id)
  // A map that costs more than the account holds cannot be taken, and the sheet says why.
  const tooDear = !!offer && offer.price > 0 && offer.price > mv.money + 1e-9
  const take = () => {
    setBusy(true)
    setRefused(null)
    void send('maintaining.adopt', { id: r.id }).then((x) => {
      setBusy(false)
      if (x.ok) { onTook(r.label); onClose() } else setRefused(plainError(x.error))
    })
  }
  return (
    <Sheet title={P3.refTitle(refs.length)} head="go" onClose={onClose} className="p3refs">
      <p className="p3refs-intro">{P3.refIntro(refs.length)}</p>
      {refs.length > 1 && (
        <div className="seg p3refs-tabs" role="tablist">
          {refs.map((x, i) => (
            <button key={x.id} type="button" role="tab" aria-selected={i === at} aria-pressed={i === at} onClick={() => { setAt(i); setRefused(null) }}>
              {x.label}{mv.adopted.includes(x.id) ? ' ✓' : ''}
            </button>
          ))}
        </div>
      )}
      <div className="p3ref">
        <div className="p3ref-h">
          <div className="p3map-acc"><span className="num">{P2.acc1(r.accuracy)}</span><span className="face">{P3.accuracy}</span></div>
          <div className="p3ref-t">
            <h3>{r.label}<span className="p3tag">{P3.onTest}</span></h3>
            <p>{r.summary}</p>
          </div>
        </div>
        <div className="gridscroll p3ref-map"><Grid v={v} map={r.map} flags={NO_FLAGS} compact words={gridWords} label={r.label} /></div>
      </div>
      {/* What taking it buys, said before the press: the price, and what the account pays of it. */}
      {offer && !taken && (
        <div className="p3ref-price" data-price={offer.price}>
          {offer.buys.length === 0 ? <p>{P3.refHasAll}</p> : (
            <>
              <div className="eyebrow">{P3.refNeeds}</div>
              <ul>{offer.buys.map((n) => <li key={n.title}><span>{n.title}</span><span className="num">{P3.sum(n.money)}</span></li>)}</ul>
              <p className={tooDear ? 'p3ref-short' : undefined}>{tooDear ? P3.refTooDear(offer.price, mv.money) : P3.refPays(offer.price)}</p>
            </>
          )}
        </div>
      )}
      {refused && <div className="err" role="alert">{refused}</div>}
      <div className="sheet-actions">
        {taken ? <span className="p3map-is">✓ {P3.refTaken}</span>
          : <button type="button" className="btn go" disabled={busy || tooDear} title={tooDear && offer ? P3.refTooDearShort(offer.price, mv.money) : undefined} onClick={take}>{P3.refTake}</button>}
        <button type="button" className="btn" onClick={onClose}>{first && !mv.adopted.length ? P3.refKeep : P3.refClose}</button>
      </div>
    </Sheet>
  )
}
