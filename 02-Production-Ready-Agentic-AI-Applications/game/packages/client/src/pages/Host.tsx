// The host console (engineering spec, section 10.8). Laptop only.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { MODES, type Clock, type GameConnection, type Mode, type PlayerView, type SceneId } from '@lab02/protocol'
import type { HostView, SessionSummary } from '@lab02/protocol/host'
import { STAGE_TITLE } from '../copy.ts'
import { connect, hostFetch } from '../lib/net.ts'
import { store } from '../lib/storage.ts'
import type { ClockRef } from '../lib/clock.ts'
import { Avatar, BoardRows, COLUMN_TITLE, Countdown, Sheet, SystemShape, columnTag } from '../components/ui.tsx'
import { SystemsStrip } from './Play.tsx'

type PackInfo = { title: string | null; hash: string; systems: string[]; phasesAvailable: Record<string, boolean>; provisional: boolean }

function Login({ onToken }: { onToken: (t: string) => void }) {
  const [pass, setPass] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  return (
    <main style={{ maxWidth: 420, margin: '80px auto', padding: 16 }}>
      <form className="panel" onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        setErr(null)
        const r = await hostFetch<{ token: string }>('', '/api/host/login', { passcode: pass })
        setBusy(false)
        if (!r.ok) { setErr(r.error === 'wrong_passcode' ? 'Wrong passcode.' : 'The server cannot be reached.'); return }
        store.setHost({ token: r.data.token })
        onToken(r.data.token)
      }}>
        <div className="panel-head bar">Host console</div>
        <div className="panel-body">
          <label className="lbl" htmlFor="pass">Host passcode</label>
          <input id="pass" className="field" type="password" autoComplete="current-password" value={pass} onChange={(e) => setPass(e.target.value)} />
          {err && <div className="err" role="alert">{err}</div>}
          <button className="btn go" disabled={busy || !pass}>Sign in</button>
        </div>
      </form>
    </main>
  )
}

function Sessions({ token, open, signOut }: { token: string; open: (code: string) => void; signOut: () => void }) {
  const [list, setList] = useState<(SessionSummary & { broken?: string })[]>([])
  const [pack, setPack] = useState<PackInfo | null>(null)
  const [label, setLabel] = useState('')
  const [mode, setMode] = useState<Mode>('rehearsal')
  const [code, setCode] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const load = useCallback(async () => {
    const r = await hostFetch<{ sessions: (SessionSummary & { broken?: string })[]; pack: PackInfo }>(token, '/api/host/sessions')
    if (!r.ok) { if (r.status === 401) signOut(); return }
    setList(r.data.sessions)
    setPack(r.data.pack)
  }, [token, signOut])
  useEffect(() => { void load() }, [load])
  return (
    <main style={{ maxWidth: 1000, margin: '0 auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Host console</h1>
        <button className="btn small text" onClick={signOut}>Sign out</button>
      </div>
      {pack && (
        <div className="panel"><div className="panel-body" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 18 }}>
          <span><b>Pack</b> {pack.title ?? '(no title yet)'} · {pack.hash}</span>
          <span><b>Health systems</b> {pack.systems.join(', ')}</span>
          <span><b>Phases with content</b> {Object.entries(pack.phasesAvailable).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none'}</span>
          <span className={pack.provisional ? 'bad' : 'good'} style={{ fontWeight: 800 }}>{pack.provisional ? 'Anchors provisional: event mode is refused' : 'Anchors measured'}</span>
        </div></div>
      )}
      <form className="panel" onSubmit={async (e) => {
        e.preventDefault()
        setErr(null)
        const body: Record<string, string> = { label, mode }
        if (code.trim()) body.code = code.trim().toUpperCase()
        const r = await hostFetch<{ code: string }>(token, '/api/host/session', body)
        if (!r.ok) { setErr(r.message ?? r.error); return }
        open(r.data.code)
      }}>
        <div className="panel-head">New session</div>
        <div className="panel-body" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', alignItems: 'end', gap: 12 }}>
          <div><label className="lbl" htmlFor="label">Label</label><input id="label" className="field" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Sunday 2:30 PM session" /></div>
          <div><label className="lbl" htmlFor="mode">Mode</label>
            <select id="mode" className="field" value={mode} onChange={(e) => setMode(e.target.value as Mode)}>{MODES.map((m) => <option key={m} value={m}>{m}</option>)}</select></div>
          <div><label className="lbl" htmlFor="scode">Code (optional)</label><input id="scode" className="field" value={code} maxLength={8} onChange={(e) => setCode(e.target.value)} /></div>
          <button className="btn go" disabled={!label.trim()}>Create</button>
          {err && <div className="err" style={{ gridColumn: '1 / -1' }}>{err}</div>}
        </div>
      </form>
      <section className="panel">
        <div className="panel-head sky">Sessions</div>
        <div className="panel-body" style={{ gap: 0 }}>
          {list.length === 0 && <div className="muted">No session yet.</div>}
          {list.map((s) => (
            <div key={s.code} className="kv" style={{ alignItems: 'center', minHeight: 52 }}>
              <span><span className="codebox" style={{ fontSize: 20 }}>{s.code}</span> <b>{s.label}</b> <span className="muted">· {s.mode} · {s.closed ? 'closed' : STAGE_TITLE[s.stage]} · {s.players} practices</span>
                {s.broken && <div className="err">{s.broken}</div>}</span>
              {!s.closed && <button className="btn small" onClick={() => open(s.code)}>Open</button>}
            </div>
          ))}
        </div>
      </section>
    </main>
  )
}

function SpectateView({ view }: { view: PlayerView }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><Avatar id={view.me.avatar} size={32} /><b>{view.me.name}</b><span className="muted">{STAGE_TITLE[view.stage]}</span></div>
      <div className="kv"><span>Points</span><span className="v">{view.points.total}</span></div>
      {view.planning && <div className="kv"><span>Tiles</span><span className="v">{view.planning.tiles.length}</span></div>}
      {view.planning && <div className="kv"><span>Problems in the report</span><span className="v">{Object.keys(view.planning.picks).length}</span></div>}
    </div>
  )
}

function Console({ token, code, back }: { token: string; code: string; back: () => void }) {
  const [conn, setConn] = useState<GameConnection | null>(null)
  const [hv, setHv] = useState<HostView | null>(null)
  const [clock, setClock] = useState<ClockRef | null>(null)
  const [filter, setFilter] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<null | 'reset_stage' | 'close'>(null)
  const [typed, setTyped] = useState('')
  const [spect, setSpect] = useState<{ id: string; view: PlayerView | null } | null>(null)
  const [rename, setRename] = useState<{ id: string; name: string } | null>(null)
  const [keyPass, setKeyPass] = useState<string | null>(null)
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null)

  useEffect(() => {
    const c = connect(token, { session: code, host: true })
    c.on('welcome', (m) => setHv((m as unknown as { view: HostView }).view))
    c.on('host_view', (m) => setHv((m as unknown as { view: HostView }).view))
    c.on('clock', (m) => setClock({ clock: (m as unknown as { clock: Clock }).clock, at: performance.now() }))
    c.on('spectate', (m) => {
      const s = m as unknown as { playerId: string; view: PlayerView | null }
      setSpect((cur) => (cur && cur.id === s.playerId ? { id: s.playerId, view: s.view } : cur))
    })
    c.onStatus((st) => { if (st === 'unauthorized') back() })
    setConn(c)
    return () => c.close()
  }, [token, code, back])

  const say = (t: string) => { setToast(t); setTimeout(() => setToast(null), 3000) }
  const cmd = async (type: string, payload: Record<string, unknown> = {}) => {
    if (!conn) return null
    const r = await conn.command(type, payload)
    if (!r.ok) say(`Refused: ${r.error ?? 'error'}`)
    return r
  }
  const systems = hv?.session.systems ?? []
  const players = useMemo(() => (hv?.players ?? []).filter((p) => !p.removed && (!filter || p.system === filter)), [hv, filter])

  if (!hv) return <div className="banner">Connecting…</div>
  const t = hv.stage
  const behind = hv.schedule.behindSeconds
  const openScreen = async () => {
    const r = await hostFetch<{ path: string }>(token, '/api/host/screen-link', { code })
    if (r.ok) window.open(r.data.path, `lab02-screen-${code}`)
  }
  const exportFile = async (what: string, format: string) => {
    const res = await fetch(`/api/host/export/${code}?what=${what}&format=${format}`, { headers: { authorization: `Bearer ${token}` } })
    if (!res.ok) return say('Export failed')
    const blob = await res.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `lab02-${code}-${what}.${format}`
    a.click()
    URL.revokeObjectURL(a.href)
  }
  const scenes: { id: SceneId; label: string }[] = [
    { id: 'auto', label: 'Follow the stage' }, { id: 'lobby', label: 'Lobby' }, { id: 'play', label: 'Leaderboard' },
    { id: 'help', label: 'Help slides' }, { id: 'winners', label: 'Winners' },
  ]

  return (
    <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
      <header className="topbar" style={{ gridTemplateColumns: '1fr auto' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
          <button className="iconbtn" onClick={back} aria-label="All sessions">←</button>
          <span className="face" style={{ fontSize: 32 }}>Host console</span>
          <span style={{ color: 'var(--bar-muted)' }}>{hv.session.label}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ color: 'var(--bar-muted)', fontSize: 14 }}>Room code</span>
          <span className="codebox">{hv.session.code}</span>
          <span className="chip" style={{ background: hv.session.mode === 'event' ? 'var(--go)' : 'var(--sun)', color: 'var(--on)', borderColor: '#1d2140' }}>{hv.session.mode} mode</span>
        </div>
      </header>
      <main style={{ padding: '16px 20px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <section className="panel" style={{ padding: '12px 16px', flexDirection: 'row', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
          <div>
            <div className="eyebrow">Now on stage</div>
            <div className="face" style={{ fontSize: 32 }}>{STAGE_TITLE[t]}</div>
            {behind !== null && <div style={{ fontSize: 14, fontWeight: 700 }} className={behind > 30 ? 'bad' : 'good'}>{behind > 30 ? `Running ${Math.floor(behind / 60)} min ${behind % 60} s behind the schedule` : behind < -30 ? `${Math.floor(-behind / 60)} min ahead of the schedule` : 'On schedule'}</div>}
          </div>
          <Countdown clock={clock} big guide />
          <div style={{ display: 'flex', gap: 20 }}>
            <div style={{ textAlign: 'center' }}><div className="num" style={{ fontSize: 32 }}>{hv.counts.total}</div><div className="hint">practices</div></div>
            <div style={{ textAlign: 'center' }}><div className="num good" style={{ fontSize: 32 }}>{hv.counts.connected}</div><div className="hint">connected</div></div>
          </div>
          <div style={{ flexGrow: 1 }} />
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            {hv.clock.running
              ? <button className="btn small" onClick={() => cmd('pause')}>Pause</button>
              : <button className="btn small sun" onClick={() => cmd('resume')} disabled={hv.closed}>Resume</button>}
            <button className="btn small" onClick={() => cmd('extend', { seconds: 30 })} disabled={!hv.timed}>+30 s</button>
            <button className="btn small" onClick={() => cmd('extend', { seconds: 60 })} disabled={!hv.timed}>+60 s</button>
            <button className="btn small danger" onClick={() => cmd('end_now')} disabled={!hv.timed}>End now</button>
            <button className="btn go" onClick={() => cmd('next')} disabled={hv.timed || !hv.next}>
              {hv.timed ? 'Ends by itself' : hv.next ? `Next: ${STAGE_TITLE[hv.next]}` : 'Done'}
            </button>
          </div>
        </section>

        <div style={{ display: 'flex', gap: 4 }}>
          {hv.schedule.segments.map((s) => (
            <div key={s.segment} style={{ flex: s.end - s.start, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
              <div style={{ height: 14, background: s.state === 'done' ? 'var(--lav)' : s.state === 'now' ? 'var(--sun)' : 'var(--inset)', border: `2px solid ${s.state === 'now' ? 'var(--line)' : 'var(--soft)'}` }} />
              <div style={{ fontSize: 13, fontWeight: s.state === 'now' ? 800 : 600, color: s.state === 'now' ? 'var(--ink)' : 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.label} · {s.start}′</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 380px', gap: 18, alignItems: 'start' }}>
          <section className="panel">
            <div className="panel-head sky" style={{ justifyContent: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
              <span>Practices</span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button className="chip" style={{ background: filter === null ? '#1d2140' : '#fff', color: filter === null ? '#fff' : '#1d2140', borderColor: '#1d2140', cursor: 'pointer' }} onClick={() => setFilter(null)}>All {hv.counts.total}</button>
                {systems.map((s) => {
                  const n = hv.counts.bySystem.find((x) => x.id === s.id)?.players ?? 0
                  return <button key={s.id} className="chip" style={{ background: filter === s.id ? '#1d2140' : '#fff', color: filter === s.id ? '#fff' : '#1d2140', borderColor: '#1d2140', cursor: 'pointer' }} onClick={() => setFilter(s.id)}><SystemShape index={s.index} size={10} />{s.name} {n}</button>
                })}
              </div>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <thead><tr className="eyebrow" style={{ textAlign: 'left' }}>
                  <th style={{ padding: '6px 8px' }} /><th>Practice</th><th>Health system</th><th>Online</th><th>Status in this phase</th><th>Points</th><th>Last action</th><th>Actions</th>
                </tr></thead>
                <tbody>
                  {players.length === 0 && <tr><td colSpan={8} className="muted" style={{ padding: 12 }}>No practice yet.</td></tr>}
                  {players.map((p) => {
                    const sys = systems.find((s) => s.id === p.system)
                    return (
                      <tr key={p.id} style={{ borderTop: '2px solid var(--soft)' }}>
                        <td style={{ padding: '4px 8px' }}><Avatar id={p.avatar} size={28} /></td>
                        <td style={{ fontWeight: 800, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</td>
                        <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><SystemShape index={sys?.index ?? 0} size={12} />{sys?.name}</span></td>
                        <td className={p.connected ? 'good' : 'bad'} style={{ fontWeight: 800 }}>{p.connected ? 'Yes' : 'No'}</td>
                        <td>{p.status}</td>
                        <td className="num" style={{ fontSize: 18 }}>{p.points.total}</td>
                        <td>{p.idleSeconds === null ? '–' : `${p.idleSeconds} s`}</td>
                        <td style={{ whiteSpace: 'nowrap', padding: '4px 0' }}>
                          <button className="btn small text" onClick={() => { setSpect({ id: p.id, view: null }); void cmd('spectate', { playerId: p.id }) }}>Spectate</button>{' '}
                          <button className="btn small text" onClick={() => setRename({ id: p.id, name: p.name })}>Rename</button>{' '}
                          <button className="btn small text" onClick={async () => { const r = await cmd('rejoin_code', { playerId: p.id }); if (r?.ok) say(`${p.name}: rejoin code ${(r.data as { code: string }).code}`) }}>Code</button>{' '}
                          <button className="btn small text danger" onClick={() => setRemoving({ id: p.id, name: p.name })}>Remove</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <section className="panel">
              <div className="panel-head lav">Big screen</div>
              <div className="panel-body">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  {scenes.map((s) => <button key={s.id} className="btn small text" style={hv.screen.scene === s.id ? { background: 'var(--sun)', color: 'var(--on)' } : undefined} onClick={() => cmd('screen_scene', { scene: s.id })}>{s.label}</button>)}
                  <button className="btn small text" onClick={() => cmd('screen_theme', { theme: hv.screen.theme === 'dark' ? 'light' : 'dark' })}>{hv.screen.theme === 'dark' ? 'Day theme' : 'Night theme'}</button>
                  <button className="btn small text" onClick={() => cmd('slide', { delta: -1 })}>Previous slide</button>
                  <button className="btn small text" onClick={() => cmd('slide', { delta: 1 })}>Next slide</button>
                  {hv.screen.spotlight && <button className="btn small text" onClick={() => cmd('spotlight', { playerId: null })}>End spotlight</button>}
                </div>
                <label className="lbl" htmlFor="filt">Leaderboard shows</label>
                <select id="filt" className="field" style={{ height: 44, fontSize: 15 }} value={hv.screen.filter ?? ''} onChange={(e) => cmd('screen_filter', { system: e.target.value || null })}>
                  <option value="">Every practice</option>
                  {systems.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <button className="linkbtn" style={{ alignSelf: 'flex-start' }} onClick={openScreen}>Open the big screen in a new window</button>
                <div className="hint">{hv.screen.screens} big screen{hv.screen.screens === 1 ? '' : 's'} connected</div>
              </div>
            </section>
            <section className="panel">
              <div className="panel-head">Room, live</div>
              <div className="panel-body">
                {(['overall', 'planning', 'development', 'maintaining'] as const).map((c) => {
                  const col = hv.board.columns[c]
                  return (
                    <details key={c} open={c === (hv.phaseLive ?? 'overall')}>
                      <summary style={{ cursor: 'pointer', fontWeight: 800, minHeight: 32 }}>{COLUMN_TITLE[c].title} {columnTag(col) && <span className="chip" style={{ fontSize: 11 }}>{columnTag(col)}</span>}</summary>
                      <BoardRows rows={col.rows.slice(0, 5)} systems={systems} />
                    </details>
                  )
                })}
                <SystemsStrip systems={systems} standings={hv.board.systems} />
              </div>
            </section>
            <section className="panel">
              <div className="panel-head sun">Answer key</div>
              <div className="panel-body">
                <div className="hint">Asks for the passcode again. Never on the big screen.</div>
                <button className="btn small text" disabled={!hv.answerKey} onClick={() => setKeyPass('')}>{hv.answerKey ? 'Open the answer key' : 'No answer key on this server'}</button>
              </div>
            </section>
            <section className="panel">
              <div className="panel-body">
                <div className="eyebrow">Export and close</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
                  <button className="btn small text" onClick={() => exportFile('results', 'csv')}>Results (CSV)</button>
                  <button className="btn small text" onClick={() => exportFile('timing', 'csv')}>Timing (CSV)</button>
                  <button className="btn small text" onClick={() => exportFile('commands', 'json')}>Commands (JSON)</button>
                  {hv.session.mode !== 'event' && <button className="btn small text danger" onClick={() => { setTyped(''); setConfirm('reset_stage') }}>Reset stage</button>}
                  <button className="btn small text danger" onClick={() => { setTyped(''); setConfirm('close') }} disabled={hv.closed}>Close session</button>
                </div>
                {hv.session.mode !== 'event' && (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span className="hint">Time scale {hv.clock.scale}×</span>
                    {[1, 5, 10, 50].map((x) => <button key={x} className="btn small text" onClick={() => cmd('set_scale', { scale: x })}>{x}×</button>)}
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      </main>

      {confirm && (
        <Sheet title={confirm === 'close' ? 'Close the session' : 'Reset the stage'} onClose={() => setConfirm(null)}>
          <p>{confirm === 'close' ? 'Nobody can play after this. ' : 'Every player goes back to the start of the current phase. '}Type the session code <b>{hv.session.code}</b> to confirm.</p>
          <input className="field code" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
          <button className="btn danger" disabled={typed.toUpperCase() !== hv.session.code} onClick={async () => { await cmd(confirm, { confirm: typed }); setConfirm(null) }}>Confirm</button>
        </Sheet>
      )}
      {rename && (
        <Sheet title="Rename a practice" onClose={() => setRename(null)}>
          <input className="field" value={rename.name} onChange={(e) => setRename({ ...rename, name: e.target.value })} autoFocus />
          <button className="btn go" onClick={async () => { const r = await cmd('rename_player', { playerId: rename.id, name: rename.name }); if (r?.ok) setRename(null) }}>Rename</button>
        </Sheet>
      )}
      {spect && (
        <Sheet title="Spectate" onClose={() => { setSpect(null); void cmd('spectate', { playerId: null }) }}>
          {spect.view ? <SpectateView view={spect.view} /> : <div className="muted">Loading…</div>}
          <button className="btn small text" onClick={() => cmd('spotlight', { playerId: spect.id })}>Show on the big screen</button>
        </Sheet>
      )}
      {keyPass !== null && (
        <Sheet title="Answer key" onClose={() => setKeyPass(null)}>
          <label className="lbl" htmlFor="kp">Host passcode, again</label>
          <input id="kp" className="field" type="password" value={keyPass} onChange={(e) => setKeyPass(e.target.value)} autoFocus />
          <button className="btn go" onClick={async () => {
            const r = await hostFetch<{ ticket: string }>(token, '/api/host/key-ticket', { passcode: keyPass })
            if (!r.ok) return say(r.error === 'wrong_passcode' ? 'Wrong passcode' : 'No answer key')
            setKeyPass(null)
            window.open(`/api/host/key?ticket=${encodeURIComponent(r.data.ticket)}`, '_blank', 'noopener')
          }}>Open</button>
        </Sheet>
      )}
      {removing && (
        <Sheet title="Remove a practice" onClose={() => setRemoving(null)}>
          <p>Remove <b>{removing.name}</b> from the session? It leaves every ranking and cannot rejoin.</p>
          <button className="btn danger" onClick={async () => { await cmd('remove_player', { playerId: removing.id }); setRemoving(null) }}>Remove</button>
        </Sheet>
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  )
}

export function HostPage({ go }: { go: (path: string) => void }) {
  const [token, setToken] = useState<string | null>(() => store.host()?.token ?? null)
  const code = new URLSearchParams(location.search).get('s')
  const signOut = useCallback(() => { store.setHost(null); setToken(null) }, [])
  const back = useCallback(() => go('/host'), [go])
  if (!token) return <Login onToken={setToken} />
  if (!code) return <Sessions token={token} open={(c) => go(`/host?s=${c}`)} signOut={signOut} />
  return <Console key={code} token={token} code={code} back={back} />
}
