// Join and rejoin (engineering spec, sections 7.7 and 10.2).
import { useEffect, useState } from 'react'
import { AVATARS, normalizeCode, type SessionPublic } from '@lab02/protocol'
import { COPY } from '../copy.ts'
import { plainError } from '../lib/errors.ts'
import { api } from '../lib/net.ts'
import { store } from '../lib/storage.ts'
import { useTheme } from '../lib/theme.ts'
import { Avatar, SystemShape } from '../components/ui.tsx'

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
  const [avatar, setAvatar] = useState<string>(AVATARS[0])
  const [name, setName] = useState('')
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
      if (r.ok) { setInfo(r.data); setLoadErr(null) } else setLoadErr(errorText(r.error))
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
    store.setPlayer({ session: r.data.session, token: r.data.token, playerId: r.data.playerId, rejoinCode: r.data.rejoinCode })
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
    store.setPlayer({ session: r.data.session, token: r.data.token, playerId: r.data.playerId, rejoinCode: r.data.rejoinCode })
    store.setFlag(`seen-code-${r.data.playerId}`)
    go('/play')
  }

  const total = info?.systems.reduce((n, s) => n + s.players, 0) ?? 0
  const rule = info?.nameRule ?? { min: 3, max: 24 }
  const title = info?.title ?? info?.label ?? ''
  const closed = info && !info.joinOpen

  return (
    <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
      <TownStrip />
      <main style={{ flexGrow: 1, width: '100%', maxWidth: 520, margin: '0 auto', padding: '18px 16px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div className="eyebrow" style={{ fontSize: 13 }}>{COPY.eyebrow}</div>
          <h1>{title || ' '}</h1>
          {info?.title && info.label !== info.title && <div className="muted" style={{ fontWeight: 800 }}>{info.label}</div>}
          <p className="muted" style={{ fontSize: 16 }}>{COPY.joinIntro}</p>
        </div>

        {loadErr && <div className="err" role="alert">{loadErr}</div>}

        {mode === 'join' && !loadErr && (
          <form onSubmit={submitJoin} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <legend className="lbl" style={{ marginBottom: 6, fontWeight: 800, padding: 0 }}>{COPY.pickCharacter}</legend>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: 8 }}>
                {AVATARS.map((a, i) => (
                  <button key={a} type="button" className="pick" aria-pressed={avatar === a} aria-label={`Character ${i + 1}${avatar === a ? ', picked' : ''}`}
                    onClick={() => setAvatar(a)}
                    style={{
                      height: 56, padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      border: `3px solid ${avatar === a ? 'var(--line)' : 'var(--soft)'}`,
                      background: avatar === a ? 'var(--sun)' : 'var(--panel)',
                      boxShadow: avatar === a ? '3px 3px 0 var(--shade)' : 'none',
                    }}>
                    <Avatar id={a} size={44} />
                  </button>
                ))}
              </div>
            </fieldset>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label className="lbl" htmlFor="practice">{COPY.namePractice}</label>
              <input id="practice" className="field" autoComplete="off" maxLength={rule.max + 8} value={name}
                onChange={(e) => setName(e.target.value)} aria-describedby="name-hint name-err" />
              <div id="name-hint" className="hint">{COPY.nameHint(rule.min, rule.max)}</div>
              {err && errorAt(err) === 'name' && <div id="name-err" className="err" role="alert">{errorText(err, rule)}</div>}
              {err === 'name_taken' && <button type="button" className="linkbtn" style={{ alignSelf: 'flex-start' }} onClick={() => { setMode('rejoin'); setErr(null) }}>{COPY.rejoinLink}</button>}
            </div>
            {info?.pickSystem && (
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
            <button className="btn go big" type="submit" disabled={busy || !!closed || name.trim().length < rule.min}>{busy ? COPY.joining : COPY.join}</button>
            {closed && <div className="err">{errorText('join_closed')}</div>}
            {err && errorAt(err) === 'form' && !closed && <div className="err" role="alert">{errorText(err)}</div>}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, fontSize: 14 }}>
              <span className="muted">{COPY.practicesIn(total)}</span>
              <button type="button" className="linkbtn" onClick={() => { setMode('rejoin'); setErr(null) }}>{COPY.rejoinLink}</button>
            </div>
          </form>
        )}

        {mode === 'rejoin' && !loadErr && (
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
      </main>
    </div>
  )
}

export function NoSessionPage({ go }: { go: (path: string) => void }) {
  const [code, setCode] = useState('')
  const [bad, setBad] = useState(false)
  return (
    <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
      <TownStrip />
      <main style={{ maxWidth: 520, width: '100%', margin: '0 auto', padding: '18px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="eyebrow" style={{ fontSize: 13 }}>{COPY.eyebrow}</div>
        <h2>{COPY.noSession}</h2>
        <p className="muted">{COPY.noSessionHint}</p>
        <form onSubmit={(e) => {
          e.preventDefault()
          const c = normalizeCode(code)
          if (!/^[A-Z0-9]{4,8}$/.test(c)) { setBad(true); return }
          go(`/j/${c}`)
        }} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label className="lbl" htmlFor="code">{COPY.sessionCode}</label>
          <input id="code" className="field code" value={code} onChange={(e) => { setCode(e.target.value); setBad(false) }} maxLength={8} autoComplete="off" aria-describedby="code-err" />
          {bad && <div id="code-err" className="err" role="alert">{COPY.codeRule}</div>}
          <button className="btn go" type="submit">{COPY.go}</button>
        </form>
      </main>
    </div>
  )
}
