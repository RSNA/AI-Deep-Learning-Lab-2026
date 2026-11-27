// The start page (engineering spec, section 10.2): what a visitor without a join link sees. The
// session a facilitator has open, a single-player game while that is switched on, every game
// this browser played with its result, and the field for a session code.
import { useCallback, useEffect, useState } from 'react'
import { normalizeCode, type GameSummary, type OpenSession } from '@lab02/protocol'
import { COPY } from '../copy.ts'
import { plainError } from '../lib/errors.ts'
import { api } from '../lib/net.ts'
import { enterGame } from '../lib/player.ts'
import { store, type KeptResult } from '../lib/storage.ts'
import { AvatarPicker, firstAvatar } from '../components/practice.tsx'
import { ThemeButton } from '../components/ui.tsx'
import { TownStrip } from './Join.tsx'

/** The day and the time a game started, in the visitor's own time zone. */
export function startedText(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/** What a game is called in a list: a session by its name, a single-player game by when it started. */
export function gameTitle(g: { kind: 'multi' | 'solo'; label: string; startedAtMs: number }): string {
  return g.kind === 'solo' ? startedText(g.startedAtMs) : g.label
}

/**
 * The games this browser kept, as the server knows them now. A game the server no longer
 * holds is dropped from the browser's list, so the list never names a result that is gone.
 */
export function useGames(): { games: GameSummary[] | null; kept: KeptResult[] } {
  const [kept, setKept] = useState<KeptResult[]>(() => store.results())
  const [games, setGames] = useState<GameSummary[] | null>(() => (store.results().length ? null : []))
  useEffect(() => {
    const mine = store.results()
    if (!mine.length) return
    let live = true
    void api.results({ games: mine.map((g) => ({ session: g.session, rejoinCode: g.rejoinCode })) }).then((r) => {
      if (!live) return
      if (!r.ok) { setGames([]); return }
      const held = new Set(r.data.games.map((g) => g.session))
      store.dropResults(mine.filter((g) => !held.has(g.session)).map((g) => g.session))
      setKept(store.results())
      setGames(r.data.games)
    })
    return () => { live = false }
  }, [])
  return { games, kept }
}

export function GameList({ games, kept, go }: { games: GameSummary[]; kept: KeptResult[]; go: (path: string) => void }) {
  // Back into a game that is still open, with the practice this browser holds for it.
  const resume = (g: GameSummary) => {
    const k = kept.find((x) => x.session === g.session)
    if (!k?.token || !k.playerId) { go(`/j/${g.session}#rejoin`); return }
    store.setPlayer({ session: k.session, token: k.token, playerId: k.playerId, rejoinCode: k.rejoinCode })
    go('/play')
  }
  return (
    <div className="gamelist">
      {games.map((g) => (
        <div key={g.session} className="gamerow">
          <span className="ginfo">
            <b>{gameTitle(g)}</b>
            <span className="muted">{COPY.gameKind[g.kind]}{g.kind === 'multi' ? ` · ${startedText(g.startedAtMs)}` : ''} · {g.name}</span>
          </span>
          <span className="gpoints">{g.card ? COPY.gamePoints(g.card.total, g.card.maxTotal) : g.open ? COPY.gameInProgress : COPY.gameNotScored}</span>
          <span className="gbtns">
            {g.open && <button type="button" className="btn small go" onClick={() => resume(g)}>{COPY.gameContinue}</button>}
            {g.card && <button type="button" className="btn small" onClick={() => go(`/result/${g.session}`)}>{COPY.gameResult}</button>}
          </span>
        </div>
      ))}
    </div>
  )
}

function SoloForm({ rule, go, needsPasscode }: { rule: { min: number; max: number }; go: (path: string) => void; needsPasscode: boolean }) {
  const [last] = useState(() => store.last())
  const [avatar, setAvatar] = useState<string>(() => firstAvatar(last))
  const [name, setName] = useState(() => last?.name ?? '')
  const [passcode, setPasscode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setErr(null)
    const r = await api.solo({ name, avatar, ...(needsPasscode ? { passcode } : {}) })
    setBusy(false)
    if (!r.ok) { setErr(r.error); return }
    enterGame(r.data, { name: name.trim(), label: COPY.soloWord, kind: 'solo' })
    go('/play')
  }
  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <AvatarPicker avatar={avatar} setAvatar={setAvatar} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label className="lbl" htmlFor="solo-practice">{COPY.namePractice}</label>
        <input id="solo-practice" className="field" autoComplete="off" maxLength={rule.max + 8} value={name} onChange={(e) => setName(e.target.value)} aria-describedby="solo-err" />
        {err && err !== 'wrong_passcode' && <div id="solo-err" className="err" role="alert">{plainError(err, rule)}</div>}
      </div>
      {needsPasscode && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label className="lbl" htmlFor="solo-passcode">{COPY.soloPasscode}</label>
          <input id="solo-passcode" className="field" type="password" autoComplete="off" maxLength={200} value={passcode} onChange={(e) => setPasscode(e.target.value)} aria-describedby="solo-pass-hint solo-pass-err" />
          <div id="solo-pass-hint" className="hint">{COPY.soloPasscodeHint}</div>
          {err === 'wrong_passcode' && <div id="solo-pass-err" className="err" role="alert">{COPY.soloPasscodeWrong}</div>}
        </div>
      )}
      <button className="btn go big startsolo" type="submit" disabled={busy || name.trim().length < rule.min || (needsPasscode && !passcode)}
        title={name.trim().length < rule.min ? COPY.soloNeedsName : needsPasscode && !passcode ? COPY.soloNeedsPasscode : undefined}>{busy ? COPY.soloStarting : COPY.soloStart}</button>
    </form>
  )
}

export function StartPage({ go }: { go: (path: string) => void }) {
  const [open, setOpen] = useState<OpenSession | null>(null)
  const [code, setCode] = useState('')
  const [bad, setBad] = useState(false)
  const { games, kept } = useGames()
  const load = useCallback(() => api.open().then((r) => { if (r.ok) setOpen(r.data) }), [])
  useEffect(() => {
    void load()
    const id = setInterval(() => void load(), 10_000)
    return () => clearInterval(id)
  }, [load])
  return (
    <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
      <TownStrip height={160}><div className="cornerbtn"><ThemeButton plain /></div></TownStrip>
      <main style={{ maxWidth: 640, width: '100%', margin: '0 auto', padding: '18px 16px 28px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div className="eyebrow" style={{ fontSize: 13 }}>{COPY.eyebrow}</div>
          {open?.title && <h1>{open.title}</h1>}
          <p className="muted" style={{ fontSize: 16 }}>{COPY.startIntro}</p>
        </div>

        {open?.session ? (
          <section className="panel newgame">
            <div className="panel-head">{COPY.liveTitle}</div>
            <div className="panel-body">
              <div style={{ fontWeight: 800, fontSize: 17 }}>{open.session.label}</div>
              <div className="hint">{COPY.liveLine}</div>
              <button type="button" className="btn go big" onClick={() => go(`/j/${open.session!.code}`)}>{COPY.liveJoin}</button>
            </div>
          </section>
        ) : open && <p className="muted" role="status">{COPY.noLive}</p>}

        {open && (
          <section className="panel">
            <div className="panel-head sun">{COPY.soloTitle}</div>
            <div className="panel-body">
              {open.solo ? (
                <>
                  <p style={{ fontSize: 15, lineHeight: 1.45 }}>{COPY.soloLine}</p>
                  <SoloForm rule={open.nameRule} go={go} needsPasscode={open.soloPasscode} />
                </>
              ) : <p className="muted" role="status">{COPY.soloOff}</p>}
            </div>
          </section>
        )}

        {games && games.length > 0 && (
          <section className="panel">
            <div className="panel-head lav">{COPY.yourGames}</div>
            <div className="panel-body">
              <div className="hint">{COPY.yourGamesLine}</div>
              <GameList games={games} kept={kept} go={go} />
            </div>
          </section>
        )}

        <form onSubmit={(e) => {
          e.preventDefault()
          const c = normalizeCode(code)
          if (!/^[A-Z0-9]{4,8}$/.test(c)) { setBad(true); return }
          go(`/j/${c}`)
        }} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label className="lbl" htmlFor="code">{COPY.haveCode}</label>
          <div className="coderow">
            <input id="code" className="field code" value={code} onChange={(e) => { setCode(e.target.value); setBad(false) }} maxLength={8} autoComplete="off" aria-describedby="code-hint code-err" />
            <button className="btn" type="submit">{COPY.go}</button>
          </div>
          <div id="code-hint" className="hint">{COPY.noSessionHint}</div>
          {bad && <div id="code-err" className="err" role="alert">{COPY.codeRule}</div>}
        </form>
      </main>
    </div>
  )
}
