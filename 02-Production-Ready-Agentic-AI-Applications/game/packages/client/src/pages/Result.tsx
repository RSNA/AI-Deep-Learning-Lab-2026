// A result to come back to (engineering spec, sections 7.7 and 10.7): the report card of a
// game, after the game, and each of its phases to look at again. In the browser that played it
// the card shows at once. Anywhere else the page asks for the session and the rejoin code of
// the practice.
import { useCallback, useEffect, useState } from 'react'
import { PHASES, normalizeCode, type PhaseId, type ReportCard, type Review } from '@lab02/protocol'
import { ReportCardPanel } from '../card/ReportCard.tsx'
import { CARD } from '../card/copy.ts'
import { ThemeButton } from '../components/ui.tsx'
import { COPY, PHASE_NUMBER } from '../copy.ts'
import { api } from '../lib/net.ts'
import { usePlayer } from '../lib/player.ts'
import { store, type KeptResult } from '../lib/storage.ts'
import { TownStrip } from './Join.tsx'
import { Looked } from './Play.tsx'
import { GameList, useGames } from './Start.tsx'

type Ask = { session: string; rejoinCode: string }

/** A phase of a game that ended, as its practice saw it at the reveal (section 10.7). */
function PhaseAgain({ review, phase, onBack }: { review: Review; phase: PhaseId; onBack: () => void }) {
  const welcome = usePlayer((s) => s.welcome)
  const { load, unload } = usePlayer()
  // The screens of a phase read the player's state: it is filled from what the server kept, and emptied on the way out.
  useEffect(() => {
    load(review)
    return () => unload()
  }, [review, load, unload])
  if (!welcome) return null
  return (
    <div className="page">
      <div className="backstrip"><button type="button" className="btn small" onClick={onBack}>← {CARD.backToResult}</button></div>
      <Looked w={welcome} look={phase} />
    </div>
  )
}

export function ResultPage({ code, go }: { code: string | null; go: (path: string) => void }) {
  const [kept] = useState<KeptResult[]>(() => store.results())
  // The game this browser holds for the link it was opened with, or its newest when the link names none.
  const mine = code ? kept.find((r) => r.session === normalizeCode(code)) ?? null : kept[0] ?? null
  const [card, setCard] = useState<ReportCard | null>(null)
  const [review, setReview] = useState<Review | null>(null)
  const [phase, setPhase] = useState<PhaseId | null>(null)
  const [busy, setBusy] = useState(!!mine)
  const [err, setErr] = useState<string | null>(null)
  const [session, setSession] = useState(code ?? '')
  const [rejoinCode, setRejoinCode] = useState('')
  const [form, setForm] = useState(!mine)
  const { games, kept: list } = useGames()

  const look = useCallback(async (ask: Ask, quiet: boolean) => {
    setBusy(true)
    setErr(null)
    setReview(null)
    const r = await api.result(ask)
    setBusy(false)
    if (r.ok) {
      setCard(r.data.card)
      setForm(false)
      // The phases to look at again come after the card, which is what the page is for.
      void api.review({ session: r.data.card.session.code, rejoinCode: r.data.card.practice.rejoinCode }).then((v) => { if (v.ok) setReview(v.data.review) })
      return
    }
    setCard(null)
    setForm(true)
    // A kept game the server no longer holds: the form, with no complaint about something nobody typed.
    if (!quiet) setErr(r.status === 404 ? CARD.notFound : r.status === 429 ? CARD.tooFast : CARD.network)
  }, [])

  useEffect(() => {
    if (mine) void look({ session: mine.session, rejoinCode: mine.rejoinCode }, true)
  }, [mine, look])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    void look({ session: session.trim(), rejoinCode: normalizeCode(rejoinCode) }, false)
  }
  const others = (games ?? []).filter((g) => g.session !== card?.session.code)
  // A phase can be looked at again when the practice played it and it was scored.
  const again = review ? PHASES.filter((p) => review.view[p]?.reveal) : []

  if (review && phase) return <PhaseAgain review={review} phase={phase} onBack={() => setPhase(null)} />
  return (
    <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
      <TownStrip height={120}><div className="cornerbtn"><ThemeButton plain /></div></TownStrip>
      <main style={{ flexGrow: 1, width: '100%', maxWidth: 640, margin: '0 auto', padding: '18px 16px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div className="eyebrow" style={{ fontSize: 13 }}>{COPY.eyebrow}</div>
          <h1>{CARD.pageTitle}</h1>
        </div>
        {busy && !card && <p className="muted" role="status">{CARD.looking}</p>}
        {card && again.length > 0 && (
          <section className="panel">
            <div className="panel-head sun">{CARD.againTitle}</div>
            <div className="panel-body">
              <div className="hint">{CARD.againLine}</div>
              <div className="menulist">
                {again.map((p) => (
                  <button key={p} type="button" className="btn small text" onClick={() => setPhase(p)}>
                    <span>{CARD.againPhase(PHASE_NUMBER[p], review!.session.phaseLabels[p])}</span>
                    <span className="muted">{CARD.againWhat[p]}</span>
                  </button>
                ))}
              </div>
            </div>
          </section>
        )}
        {card && <ReportCardPanel card={card} />}
        {form && (
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <p className="muted" style={{ fontSize: 16 }}>{CARD.pageIntro}</p>
            <label className="lbl" htmlFor="rs-session">{CARD.session}</label>
            <input id="rs-session" className="field" autoComplete="off" spellCheck={false} maxLength={80} value={session} aria-describedby="rs-session-hint"
              onChange={(e) => { setSession(e.target.value); setErr(null) }} />
            <div id="rs-session-hint" className="hint">{CARD.sessionHint}</div>
            <label className="lbl" htmlFor="rs-code">{CARD.rejoin}</label>
            <input id="rs-code" className="field code" autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={8} value={rejoinCode} aria-describedby="rs-code-hint"
              onChange={(e) => { setRejoinCode(e.target.value); setErr(null) }} />
            <div id="rs-code-hint" className="hint">{CARD.rejoinHint}</div>
            {err && <div className="err" role="alert">{err}</div>}
            <button className="btn go big" type="submit" disabled={busy || session.trim().length < 3 || normalizeCode(rejoinCode).length < 6}>{busy ? CARD.looking : CARD.show}</button>
          </form>
        )}
        {others.length > 0 && (
          <section className="panel">
            <div className="panel-head lav">{CARD.keptTitle}</div>
            <div className="panel-body">
              <GameList games={others} kept={list} go={go} />
            </div>
          </section>
        )}
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {card && !form && <button type="button" className="linkbtn" onClick={() => { setForm(true); setSession(''); setRejoinCode('') }}>{CARD.another}</button>}
          <button type="button" className="linkbtn" onClick={() => go('/home')}>{COPY.backToStart}</button>
        </div>
      </main>
    </div>
  )
}
