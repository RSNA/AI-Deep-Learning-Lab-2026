// A result to come back to (engineering spec, sections 7.7 and 10.7): the report card of a
// game, after the game. In the browser that played it the card shows at once. Anywhere else
// the page asks for the session and the rejoin code of the practice.
import { useCallback, useEffect, useState } from 'react'
import { normalizeCode, type ReportCard } from '@lab02/protocol'
import { ReportCardPanel } from '../card/ReportCard.tsx'
import { CARD } from '../card/copy.ts'
import { ThemeButton } from '../components/ui.tsx'
import { COPY } from '../copy.ts'
import { api } from '../lib/net.ts'
import { store, type KeptResult } from '../lib/storage.ts'
import { TownStrip } from './Join.tsx'

type Ask = { session: string; rejoinCode: string }

export function ResultPage({ code, go }: { code: string | null; go: (path: string) => void }) {
  const [kept] = useState<KeptResult[]>(() => store.results())
  // The game this browser holds for the link it was opened with, or its newest when the link names none.
  const mine = code ? kept.find((r) => r.session === normalizeCode(code)) ?? null : kept[0] ?? null
  const [card, setCard] = useState<ReportCard | null>(null)
  const [busy, setBusy] = useState(!!mine)
  const [err, setErr] = useState<string | null>(null)
  const [session, setSession] = useState(code ?? '')
  const [rejoinCode, setRejoinCode] = useState('')
  const [form, setForm] = useState(!mine)

  const look = useCallback(async (ask: Ask, quiet: boolean) => {
    setBusy(true)
    setErr(null)
    const r = await api.result(ask)
    setBusy(false)
    if (r.ok) { setCard(r.data.card); setForm(false); return }
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
  const others = kept.filter((r) => r.session !== card?.session.code)

  return (
    <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
      <TownStrip height={120}><div className="cornerbtn"><ThemeButton plain /></div></TownStrip>
      <main style={{ flexGrow: 1, width: '100%', maxWidth: 640, margin: '0 auto', padding: '18px 16px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div className="eyebrow" style={{ fontSize: 13 }}>{COPY.eyebrow}</div>
          <h1>{CARD.pageTitle}</h1>
        </div>
        {busy && !card && <p className="muted" role="status">{CARD.looking}</p>}
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
            <div className="panel-body rc-kept">
              <div className="hint">{CARD.keptLine}</div>
              {others.map((r) => (
                <button key={r.session} type="button" className="btn small text" onClick={() => go(`/result/${r.session}`)}>
                  {r.name} · {r.label}
                </button>
              ))}
            </div>
          </section>
        )}
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {card && !form && <button type="button" className="linkbtn" onClick={() => { setForm(true); setSession(''); setRejoinCode('') }}>{CARD.another}</button>}
          <button type="button" className="linkbtn" onClick={() => go('/')}>{CARD.toGame}</button>
        </div>
      </main>
    </div>
  )
}
