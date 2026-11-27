// Join and rejoin (engineering spec, sections 7.7 and 10.2).
import { useEffect, useState } from 'react'
import { COLUMNS, PHASES, STAGES, normalizeCode, phaseOfStage, type Board, type SessionPublic, type SystemRef } from '@lab02/protocol'
import { COPY, PHASE_NUMBER } from '../copy.ts'
import { plainError } from '../lib/errors.ts'
import { api } from '../lib/net.ts'
import { enterGame } from '../lib/player.ts'
import { store } from '../lib/storage.ts'
import { useTheme } from '../lib/theme.ts'
import { BoardRows, COLUMN_TITLE, SystemShape, ThemeButton, columnTag } from '../components/ui.tsx'
import { NewGame, PastGameCard } from '../components/after.tsx'
import { AvatarPicker, firstAvatar } from '../components/practice.tsx'

export function TownStrip({ height = 208, children }: { height?: number; children?: React.ReactNode }) {
  const theme = useTheme()
  return (
    <div style={{ position: 'relative', height, flexShrink: 0, overflow: 'hidden', borderBottom: '3px solid var(--line)', display: 'flex', justifyContent: 'center', alignItems: 'flex-end' }}>
      <img className="px" src={`/art/town_${theme === 'dark' ? 'night' : 'day'}.png`} alt=""
        style={{ display: 'block', height: 224, width: 1920, flexShrink: 0, imageRendering: 'pixelated' }} />
      {children}
    </div>
  )
}

function errorText(error: string, rule?: { min: number; max: number }): string {
  return plainError(error, rule)
}

/** Where a join refusal is shown: at the name, at the health system, or at the button. */
const errorAt = (e: string): 'name' | 'system' | 'form' => (e === 'name_taken' || e === 'name_invalid' ? 'name' : e === 'unknown_system' ? 'system' : 'form')

export function JoinPage({ code: rawCode, go }: { code: string; go: (path: string) => void }) {
  const code = normalizeCode(rawCode)
  const [info, setInfo] = useState<SessionPublic | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [mode, setMode] = useState<'join' | 'rejoin'>(location.hash === '#rejoin' ? 'rejoin' : 'join')
  // A browser that played before starts from the practice it had (its name and its character).
  const [last] = useState(() => store.last())
  const [avatar, setAvatar] = useState<string>(() => firstAvatar(last))
  // Not in the game it comes from, where that name is taken: there the form starts empty.
  const [name, setName] = useState(() => (last && last.session !== code ? last.name : ''))
  const [system, setSystem] = useState<string | null>(null)
  const [rejoinCode, setRejoinCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // The same browser returns to its practice without a question.
  useEffect(() => {
    const saved = store.player()
    if (saved && saved.session === code) go('/play')
  }, [code, go])

  useEffect(() => {
    let live = true
    const load = () => api.session(code).then((r) => {
      if (!live) return
      if (r.ok) { setInfo(r.data); setLoadErr(null) } else setLoadErr(r.error === 'unknown_session' ? COPY.gameUnknown : errorText(r.error))
    })
    void load()
    const id = setInterval(load, 10_000)
    return () => { live = false; clearInterval(id) }
  }, [code])

  const submitJoin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setErr(null)
    const r = await api.join(system ? { code, name, avatar, system } : { code, name, avatar })
    setBusy(false)
    if (!r.ok) { setErr(r.error); return }
    enterGame(r.data, { name: name.trim(), label: info?.label ?? '', kind: 'multi' })
    go('/play')
  }

  const submitRejoin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setErr(null)
    const r = await api.rejoin({ code, rejoinCode: normalizeCode(rejoinCode) })
    setBusy(false)
    if (!r.ok) { setErr(r.error); return }
    enterGame(r.data, { name: '', label: info?.label ?? '', kind: info?.kind ?? 'multi' })
    store.setFlag(`seen-code-${r.data.playerId}`)
    go('/play')
  }

  const total = info?.systems.reduce((n, s) => n + s.players, 0) ?? 0
  const rule = info?.nameRule ?? { min: 3, max: 24 }
  const title = info?.title ?? info?.label ?? ''
  const closed = info && !info.joinOpen
  // A game that has ended, or a code the server does not know: no form, and the way to the open game.
  const over = info?.stage === 'closed'
  const past = last && last.scored && last.session !== code ? last : null
  // A single-player game belongs to the browser that started it. Anyone else is shown the way to their own.
  const notYours = info?.kind === 'solo' && !over
  // The last phase is in play: joining is closed, and the leaderboard is what there is to see (section 6.4).
  const tooLate = !!closed && !over && !notYours && STAGES.indexOf(info.stage) >= STAGES.indexOf('maintaining.year')
  const inPlay = info?.joinWaits ? phaseOfStage(info.stage) : null

  return (
    <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
      <TownStrip><div className="cornerbtn"><ThemeButton plain /></div></TownStrip>
      <main style={{ flexGrow: 1, width: '100%', maxWidth: 520, margin: '0 auto', padding: '18px 16px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div className="eyebrow" style={{ fontSize: 13 }}>{COPY.eyebrow}</div>
          <h1>{title || ' '}</h1>
          {info?.title && info.label !== info.title && <div className="muted" style={{ fontWeight: 800 }}>{info.label}</div>}
          {!over && !loadErr && !notYours && !tooLate && <p className="muted" style={{ fontSize: 16 }}>{COPY.joinIntro}</p>}
        </div>

        {loadErr && <div className="err" role="alert">{loadErr}</div>}
        {over && <div className="err" role="alert">{COPY.gameEndedJoin}</div>}
        {(over || loadErr) && <NewGame after={code} onJoin={(c) => go(`/j/${c}`)} />}
        {notYours && <div className="err" role="alert">{COPY.soloNotYours}</div>}
        {tooLate && <LastPhase code={code} go={go} />}
        {(over || loadErr) && last && last.scored && last.session === code && <PastGameCard game={last} title={COPY.lastGame} />}

        {mode === 'join' && !loadErr && !over && !notYours && !tooLate && (
          <form onSubmit={submitJoin} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <AvatarPicker avatar={avatar} setAvatar={setAvatar} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label className="lbl" htmlFor="practice">{COPY.namePractice}</label>
              <input id="practice" className="field" autoComplete="off" maxLength={rule.max + 8} value={name}
                onChange={(e) => setName(e.target.value)} aria-describedby="name-hint name-err" />
              <div id="name-hint" className="hint">{COPY.nameHint(rule.min, rule.max)}</div>
              {err && errorAt(err) === 'name' && <div id="name-err" className="err" role="alert">{errorText(err, rule)}</div>}
              {err === 'name_taken' && <button type="button" className="linkbtn" style={{ alignSelf: 'flex-start' }} onClick={() => { setMode('rejoin'); setErr(null) }}>{COPY.rejoinLink}</button>}
            </div>
            {/* A game of one health system has nothing to pick. */}
            {info?.pickSystem && info.pickSystem.length > 1 && (
              <fieldset className="syspick" style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <legend className="lbl" style={{ marginBottom: 6, fontWeight: 800, padding: 0 }}>{COPY.pickSystem}</legend>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {[{ id: null, index: -1, name: COPY.assignMe, setting: COPY.assignMeHint }, ...info.pickSystem].map((x) => {
                    const on = system === x.id
                    return (
                      <button key={x.id ?? 'assign'} type="button" aria-pressed={on} onClick={() => setSystem(x.id)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10, minHeight: 52, padding: '6px 12px', cursor: 'pointer', textAlign: 'left',
                          border: `3px solid ${on ? 'var(--line)' : 'var(--soft)'}`, background: on ? 'var(--sun)' : 'var(--panel)',
                          color: on ? 'var(--on)' : 'var(--ink)', boxShadow: on ? '3px 3px 0 var(--shade)' : 'none',
                        }}>
                        {x.index >= 0 ? <SystemShape index={x.index} size={16} /> : <span style={{ width: 16, textAlign: 'center', fontWeight: 900 }}>?</span>}
                        <span><span style={{ fontWeight: 800, display: 'block' }}>{x.name}</span><span style={{ fontSize: 13, opacity: 0.85 }}>{x.setting}</span></span>
                      </button>
                    )
                  })}
                </div>
                <div className="hint">{COPY.pickOnlyInTest}</div>
                {err && errorAt(err) === 'system' && <div className="err" role="alert">{errorText(err)}</div>}
              </fieldset>
            )}
            {inPlay && <div className="snote" role="status">{COPY.joinWaits(PHASE_NUMBER[inPlay])}</div>}
            <button className="btn go big" type="submit" disabled={busy || !!closed || name.trim().length < rule.min}>{busy ? COPY.joining : COPY.join}</button>
            {closed && <div className="err">{errorText('join_closed')}</div>}
            {err && errorAt(err) === 'form' && !closed && <div className="err" role="alert">{errorText(err)}</div>}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, fontSize: 14 }}>
              <span className="muted">{COPY.practicesIn(total)}</span>
              <button type="button" className="linkbtn" onClick={() => { setMode('rejoin'); setErr(null) }}>{COPY.rejoinLink}</button>
            </div>
          </form>
        )}

        {mode === 'rejoin' && !loadErr && !over && !notYours && (
          <form onSubmit={submitRejoin} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h2>{COPY.rejoinTitle}</h2>
            <p className="muted">{COPY.rejoinHint}</p>
            <label className="lbl" htmlFor="rejoin">{COPY.rejoinCode}</label>
            <input id="rejoin" className="field code" autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={8}
              value={rejoinCode} onChange={(e) => setRejoinCode(e.target.value)} />
            {err && <div className="err" role="alert">{errorText(err)}</div>}
            <button className="btn go big" type="submit" disabled={busy || normalizeCode(rejoinCode).length < 6}>{COPY.rejoin}</button>
            <button type="button" className="linkbtn" style={{ alignSelf: 'flex-start' }} onClick={() => { setMode('join'); setErr(null) }}>{COPY.backToJoin}</button>
          </form>
        )}
        {past && !over && !loadErr && !tooLate && <PastGameCard game={past} title={COPY.lastGame} />}
        <button type="button" className="linkbtn" style={{ alignSelf: 'flex-start' }} onClick={() => go('/home')}>{COPY.toStart}</button>
      </main>
    </div>
  )
}

/**
 * The join page of a session whose last phase is in play (section 6.4): nobody joins any more,
 * the leaderboard is there to watch, and the start page offers a game of one's own.
 */
function LastPhase({ code, go }: { code: string; go: (path: string) => void }) {
  const [board, setBoard] = useState<Board | null>(null)
  const [solo, setSolo] = useState(false)
  useEffect(() => {
    let live = true
    const load = () => {
      void api.board(code).then((r) => { if (live && r.ok) setBoard(r.data.board) })
      void api.open().then((r) => { if (live && r.ok) setSolo(r.data.solo) })
    }
    load()
    const id = setInterval(load, 15_000)
    return () => { live = false; clearInterval(id) }
  }, [code])
  return (
    <>
      <div className="err" role="alert">{COPY.lastPhase}</div>
      {solo && (
        <div className="leaverow">
          <button type="button" className="btn small" onClick={() => go('/home')}>{COPY.soloTitle}</button>
          <span className="hint">{COPY.lastPhaseSolo}</span>
        </div>
      )}
      {board && <BoardColumns board={board} columns={['overall', ...PHASES.filter((p) => board.columns[p].state !== 'empty')]} min={300} />}
    </>
  )
}

/** Columns of a leaderboard as panels, for someone who watches a game they are not in. */
export function BoardColumns({ board, columns = COLUMNS, systems = [], min = 220 }: { board: Board; columns?: readonly (typeof COLUMNS)[number][]; systems?: SystemRef[]; min?: number }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${min}px), 1fr))`, gap: 12 }}>
      {columns.map((c) => {
        const col = board.columns[c]
        return (
          <div key={c} className="panel" style={{ boxShadow: '3px 3px 0 var(--shade)' }}>
            <div className={`panel-head ${COLUMN_TITLE[c].head}`} style={{ fontSize: 20 }}>
              <span>{COLUMN_TITLE[c].title}</span>
              {columnTag(col) && <span className="chip" style={{ fontSize: 12, padding: '0 6px', background: '#fff', color: '#1d2140', borderColor: '#1d2140' }}>{columnTag(col)}</span>}
            </div>
            <div className="hint" style={{ padding: '4px 10px 0' }}>{col.state === 'empty' ? '' : col.label}</div>
            <BoardRows rows={col.rows} systems={systems} of={col.of} />
          </div>
        )
      })}
    </div>
  )
}
