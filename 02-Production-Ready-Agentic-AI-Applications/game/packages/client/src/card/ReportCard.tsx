// The personal report card (engineering spec, section 10.7): on the player's page at the end of
// the game and on the page that brings it back. A second copy lives outside the application
// root for the printer alone, so that "Save as PDF" prints the card and nothing else, in light
// colours whatever the theme.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ReportCard, ReportCardPhase } from '@lab02/protocol'
import { Avatar } from '../components/ui.tsx'
import { store } from '../lib/storage.ts'
import { CARD } from './copy.ts'

const one = (x: number | null) => (x === null ? '–' : (Math.round(10 * x) / 10).toFixed(1))

/** The address that brings this card back, without the protocol: short enough to read out. */
export function resultPath(card: ReportCard): string {
  return `/result/${card.session.code}`
}

function playedOn(ms: number | null): string | null {
  if (ms === null) return null
  try {
    return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
  } catch {
    return null
  }
}

function PhaseBlock({ ph }: { ph: ReportCardPhase }) {
  return (
    <section className="rc-phase" aria-label={CARD.phase(ph.number, ph.label)}>
      <div className="rc-phase-head">
        <h3>{CARD.phase(ph.number, ph.label)}</h3>
        {ph.scored && ph.band && <span className="chip sun rc-band">{ph.band}</span>}
        <span className="rc-pts num">{ph.scored && ph.points !== null ? ph.points : '–'}<span className="rc-max"> / {ph.max}</span></span>
      </div>
      {!ph.scored && <p className="muted rc-line">{CARD.notScoredLine}</p>}
      {ph.scored && (
        <div className="rc-facts">
          {ph.rank !== null && <div className="kv"><span>{CARD.rankInPhase}</span><span className="v">#{ph.rank} {CARD.of} {ph.of}</span></div>}
          {ph.facts.map((f) => <div key={f.label} className="kv"><span>{f.label}</span><span className="v">{f.value}</span></div>)}
        </div>
      )}
      {ph.scored && ph.periods.length > 0 && (
        <table className="rc-periods">
          <thead><tr><th scope="col">{CARD.period}</th><th scope="col">{CARD.validity}</th><th scope="col">{CARD.reliability}</th><th scope="col">{CARD.value}</th></tr></thead>
          <tbody>
            {ph.periods.map((r) => (
              <tr key={r.label}><th scope="row">{r.label}</th><td className="num">{one(r.validity)}</td><td className="num">{one(r.reliability)}</td><td className="num">{one(r.value)}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

/** The card itself: the same on the screen and on paper. */
export function CardBody({ card, paper = false }: { card: ReportCard; paper?: boolean }) {
  const date = playedOn(card.session.playedAtMs)
  const sections = [...new Set(card.lines.map((l) => l.section))]
  return (
    <article className={paper ? 'rcard paper' : 'rcard panel'} aria-label={card.final ? CARD.title : CARD.titleSoFar}>
      <div className="panel-head sun rc-head">{card.final ? CARD.title : CARD.titleSoFar}{card.session.title && <span className="sub">{card.session.title}</span>}</div>
      <div className="panel-body rc-body">
        <div className="rc-top">
          <Avatar id={card.practice.avatar} size={56} />
          <div className="rc-who">
            <div className="rc-name">{card.practice.name}</div>
            <div className="muted rc-where">{[card.practice.system, card.session.label, date].filter(Boolean).join(' · ')}</div>
          </div>
          <div className="rc-total">
            <div className="num rc-big">{card.total}<span className="rc-max"> / {card.maxTotal}</span></div>
            <div className="rc-rank">{card.rank !== null ? <>{CARD.rankOverall} <b className="num">#{card.rank}</b> {CARD.of} {card.of}</> : CARD.notScored}</div>
            {card.systems > 1 && card.systemRank !== null && <div className="rc-rank muted">{CARD.rankInSystem(card.practice.system)} <b className="num">#{card.systemRank}</b> {CARD.of} {card.ofSystem}</div>}
          </div>
        </div>
        {!card.final && <p className="muted rc-line">{CARD.soFar}</p>}
        <div className="rc-phases">{card.phases.map((ph) => <PhaseBlock key={ph.phase} ph={ph} />)}</div>
        {sections.map((sec) => (
          <section key={sec} className="rc-notes">
            <h3>{sec}</h3>
            <ul>
              {card.lines.filter((l) => l.section === sec).map((l, i) => (
                <li key={i}>{l.text}{l.source && <span className="muted rc-src"> {l.source}</span>}</li>
              ))}
            </ul>
          </section>
        ))}
        {card.closing && <p className="rc-closing">{card.closing}</p>}
        {(card.readMore.length > 0 || card.links.length > 0) && (
          <section className="rc-notes">
            <h3>{CARD.readMore}</h3>
            <ul>
              {card.readMore.map((r) => <li key={r}>{r}</li>)}
              {card.links.map((l) => <li key={l.url}>{paper ? `${l.label}: ${l.url}` : <a href={l.url} target="_blank" rel="noreferrer">{l.label}</a>}</li>)}
            </ul>
          </section>
        )}
        {paper && <p className="muted rc-foot">{CARD.printedFrom(location.host)}{resultPath(card)} · {card.practice.rejoinCode}</p>}
      </div>
    </article>
  )
}

/** The copy of the card that only the printer sees. */
function PrintCopy({ card }: { card: ReportCard }) {
  const [host, setHost] = useState<HTMLElement | null>(null)
  useEffect(() => {
    const el = document.createElement('div')
    el.className = 'printroot'
    document.body.appendChild(el)
    setHost(el)
    return () => { el.remove() }
  }, [])
  return host ? createPortal(<CardBody card={card} paper />, host) : null
}

/**
 * The card with what a player does with it: save it as a PDF, and the link that brings it
 * back. The browser keeps the session and the rejoin code, so that the link needs no question
 * here.
 */
export function ReportCardPanel({ card }: { card: ReportCard }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    store.keepResult({ session: card.session.code, label: card.session.label, name: card.practice.name, rejoinCode: card.practice.rejoinCode })
  }, [card.session.code, card.session.label, card.practice.name, card.practice.rejoinCode])
  const link = `${location.origin}${resultPath(card)}`
  const copy = () => {
    void navigator.clipboard?.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2500) }, () => undefined)
  }
  return (
    <>
      <CardBody card={card} />
      <section className="panel rc-keep">
        <div className="panel-head sky">{CARD.back}</div>
        <div className="panel-body">
          <div className="rc-linkrow">
            <a className="rc-link" href={resultPath(card)}>{link.replace(/^https?:\/\//, '')}</a>
            {/* A page that is not served over HTTPS has no clipboard: the link is there to be read. */}
            {!!navigator.clipboard && <button type="button" className="btn small text" onClick={copy} aria-live="polite">{copied ? CARD.copied : CARD.copy}</button>}
          </div>
          <div className="hint">{CARD.backLine(card.practice.rejoinCode)}</div>
          <div className="rc-linkrow">
            <button type="button" className="btn small text go" onClick={() => window.print()}>{CARD.save}</button>
            <span className="hint">{CARD.saveLine}</span>
          </div>
        </div>
      </section>
      <PrintCopy card={card} />
    </>
  )
}
