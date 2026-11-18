// The host console (engineering spec, section 10.8). Laptop only. Every refusal is one plain
// sentence beside the control it concerns. One console controls the session at a time.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MODES, PLAY_STAGES, phaseOfStage, type Clock, type GameConnection, type Mode, type PlayerView, type SceneId } from '@lab02/protocol'
import type { HostView, SessionSummary } from '@lab02/protocol/host'
import { PHASE_NUMBER, STAGE_TITLE, players } from '../copy.ts'
import { plainError } from '../lib/errors.ts'
import { connect, hostFetch } from '../lib/net.ts'
import { store } from '../lib/storage.ts'
import type { ClockRef } from '../lib/clock.ts'
import { Avatar, BoardRows, COLUMN_TITLE, Countdown, Sheet, SystemShape, columnTag } from '../components/ui.tsx'
import { SystemsStrip } from './Play.tsx'
import { ScreenStage } from './Screen.tsx'
import { H } from './hostCopy.ts'

type PackInfo = { title: string | null; hash: string; systems: string[]; systemNames?: string[]; phasesAvailable: Record<string, boolean>; provisional: boolean; pickModes?: Mode[] }
type Summary = SessionSummary & { broken?: string }

const CODE_RULE = /^[A-Za-z0-9]{4,8}$/

function Login({ onToken }: { onToken: (t: string, name: string) => void }) {
  const [pass, setPass] = useState('')
  const [name, setName] = useState(() => store.host()?.name ?? '')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  return (
    <main style={{ maxWidth: 440, margin: '80px auto', padding: 16 }}>
      <form className="panel" onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        setErr(null)
        const r = await hostFetch<{ token: string }>('', '/api/host/login', { passcode: pass })
        setBusy(false)
        if (!r.ok) { setErr(plainError(r.error)); return }
        store.setHost({ token: r.data.token, name: name.trim() })
        onToken(r.data.token, name.trim())
      }}>
        <div className="panel-head bar">{H.title}</div>
        <div className="panel-body">
          <label className="lbl" htmlFor="hname">{H.yourName}</label>
          <input id="hname" className="field" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder={H.yourNameExample} aria-describedby="hname-hint" />
          <div id="hname-hint" className="hint">{H.yourNameHint}</div>
          <label className="lbl" htmlFor="pass">{H.passcode}</label>
          <input id="pass" className="field" type="password" autoComplete="current-password" value={pass} onChange={(e) => setPass(e.target.value)} aria-describedby="pass-err" />
          {err && <div id="pass-err" className="err" role="alert">{err}</div>}
          <button className="btn go" disabled={busy || !pass || !name.trim()}>{H.signIn}</button>
        </div>
      </form>
    </main>
  )
}

// ------------------------------------------------------------------------------------------
// The first page: what is loaded, a new session, the sessions
// ------------------------------------------------------------------------------------------
function ModeControl({ mode, setMode, provisional }: { mode: Mode; setMode: (m: Mode) => void; provisional: boolean }) {
  return (
    <div className="modes" role="radiogroup" aria-labelledby="mode-l">
      {MODES.map((m) => {
        const off = m === 'event' && provisional
        return (
          <button key={m} type="button" role="radio" aria-checked={mode === m} disabled={off} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}
            aria-describedby={off ? 'mode-why' : undefined}>
            {H.mode[m]}
          </button>
        )
      })}
    </div>
  )
}

function Sessions({ token, open, signOut, manual }: { token: string; open: (code: string) => void; signOut: () => void; manual: () => void }) {
  const [list, setList] = useState<Summary[]>([])
  const [pack, setPack] = useState<PackInfo | null>(null)
  const [label, setLabel] = useState('')
  const [mode, setMode] = useState<Mode>('rehearsal')
  const [code, setCode] = useState('')
  const [err, setErr] = useState<{ field: 'label' | 'code' | 'form'; text: string } | null>(null)
  const [showClosed, setShowClosed] = useState(false)
  const [deleting, setDeleting] = useState<Summary | null>(null)
  const [delErr, setDelErr] = useState<string | null>(null)
  const load = useCallback(async () => {
    const r = await hostFetch<{ sessions: Summary[]; pack: PackInfo }>(token, '/api/host/sessions')
    if (!r.ok) { if (r.status === 401) signOut(); return }
    setList(r.data.sessions)
    setPack(r.data.pack)
  }, [token, signOut])
  useEffect(() => { void load() }, [load])
  useEffect(() => { if (pack?.provisional && mode === 'event') setMode('rehearsal') }, [pack, mode])

  const codeBad = code.trim() !== '' && !CODE_RULE.test(code.trim())
  const openList = list.filter((s) => !s.closed)
  const closedList = list.filter((s) => s.closed)
  const phases = pack ? (['planning', 'development', 'maintaining'] as const).filter((p) => pack.phasesAvailable[p]).map((p) => `Phase ${PHASE_NUMBER[p]}`) : []
  const row = (s: Summary) => (
    <div key={s.code} className="srow">
      <span className="codebox" style={{ fontSize: 20 }}>{s.code}</span>
      <span className="sinfo">
        <b>{s.label}</b>
        <span className="muted">{H.mode[s.mode]} · {s.closed ? H.closedWord : STAGE_TITLE[s.stage]} · {players(s.players)}</span>
        {s.broken && <span className="err">{s.broken}</span>}
      </span>
      {!s.closed && <button className="btn small" onClick={() => open(s.code)}>{H.open}</button>}
      {s.closed && <button className="btn small text danger" onClick={() => { setDelErr(null); setDeleting(s) }}>{H.delete}</button>}
    </div>
  )

  return (
    <main className="host-first">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <h1>{H.title}</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn small text" onClick={manual}>{H.manual}</button>
          <button className="btn small text" onClick={signOut}>{H.signOut}</button>
        </div>
      </div>
      {pack && (
        <section className="panel">
          <div className="panel-body loaded">
            <div className="good" style={{ fontWeight: 800, fontSize: 17 }}>{H.loaded(phases, pack.systems.length)}</div>
            <div className={pack.provisional ? 'bad' : 'good'} style={{ fontWeight: 800 }}>{pack.provisional ? H.uncalibrated : H.calibrated}</div>
            <div className="hint">{H.loadedDetail(pack.title, pack.systemNames ?? pack.systems, pack.hash)}</div>
          </div>
        </section>
      )}
      <form className="panel" noValidate onSubmit={async (e) => {
        e.preventDefault()
        setErr(null)
        if (!label.trim()) { setErr({ field: 'label', text: plainError('label_invalid') }); return }
        if (codeBad) { setErr({ field: 'code', text: plainError('code_invalid') }); return }
        const body: Record<string, string> = { label: label.trim(), mode }
        if (code.trim()) body.code = code.trim().toUpperCase()
        const r = await hostFetch<{ code: string }>(token, '/api/host/session', body)
        if (!r.ok) {
          const field = r.error === 'code_invalid' || r.error === 'code_taken' ? 'code' : r.error === 'label_invalid' ? 'label' : 'form'
          setErr({ field, text: plainError(r.error) })
          return
        }
        open(r.data.code)
      }}>
        <div className="panel-head">{H.newSession}</div>
        <div className="panel-body newsess">
          <div className="fieldbox">
            <label className="lbl" htmlFor="label">{H.sessionName}</label>
            <input id="label" className="field" value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} placeholder={H.sessionNameExample} aria-describedby="label-err" />
            {err?.field === 'label' && <div id="label-err" className="err" role="alert">{err.text}</div>}
          </div>
          <div className="fieldbox">
            <span className="lbl" id="mode-l">{H.modeLabel}</span>
            <ModeControl mode={mode} setMode={setMode} provisional={!!pack?.provisional} />
            <div className="hint">{H.modeLine[mode]}{(pack?.pickModes ?? []).includes(mode) ? ` ${H.pickYes}` : ` ${H.pickNo}`}</div>
            {pack?.provisional && <div id="mode-why" className="hint bad">{H.eventWhy}</div>}
          </div>
          <div className="fieldbox">
            <label className="lbl" htmlFor="scode">{H.joinCode}</label>
            <input id="scode" className={`field code${codeBad ? ' bad' : ''}`} value={code} maxLength={8} autoComplete="off" spellCheck={false}
              onChange={(e) => setCode(e.target.value.replace(/\s/g, ''))} aria-invalid={codeBad} aria-describedby="scode-hint scode-err" />
            <div id="scode-hint" className="hint">{H.joinCodeHint}</div>
            {(codeBad || err?.field === 'code') && <div id="scode-err" className="err" role="alert">{codeBad ? plainError('code_invalid') : err!.text}</div>}
          </div>
          <div className="fieldbox" style={{ justifyContent: 'flex-end' }}>
            <button className="btn go" disabled={!label.trim() || codeBad}>{H.create}</button>
            {err?.field === 'form' && <div className="err" role="alert">{err.text}</div>}
          </div>
        </div>
      </form>
      <section className="panel">
        <div className="panel-head sky">{H.sessions}</div>
        <div className="panel-body" style={{ gap: 0 }}>
          {openList.length === 0 && <div className="muted">{H.noOpen}</div>}
          {openList.map(row)}
          {closedList.length > 0 && (
            <button type="button" className="linkbtn" style={{ alignSelf: 'flex-start', marginTop: 10 }} aria-expanded={showClosed} onClick={() => setShowClosed(!showClosed)}>
              {showClosed ? H.hideClosed : H.showClosed(closedList.length)}
            </button>
          )}
          {showClosed && closedList.map(row)}
        </div>
      </section>
      {deleting && (
        <Sheet title={H.deleteTitle(deleting.code)} head="sun" onClose={() => setDeleting(null)}>
          <p>{H.deleteText(deleting.label, deleting.players)}</p>
          {delErr && <div className="err" role="alert">{delErr}</div>}
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn danger" onClick={async () => {
              const r = await hostFetch<{ ok: true }>(token, `/api/host/session/${deleting.code}`, undefined, 'DELETE')
              if (!r.ok) { setDelErr(plainError(r.error)); return }
              setDeleting(null)
              void load()
            }}>{H.deleteNow}</button>
            <button className="btn" onClick={() => setDeleting(null)}>{H.cancel}</button>
          </div>
        </Sheet>
      )}
    </main>
  )
}

function SpectateView({ view }: { view: PlayerView }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><Avatar id={view.me.avatar} size={32} /><b>{view.me.name}</b><span className="muted">{STAGE_TITLE[view.stage]}</span></div>
      <div className="kv"><span>{H.points}</span><span className="v">{view.points.total}</span></div>
      {view.planning && <div className="kv"><span>{H.insights}</span><span className="v">{view.planning.tiles.length}</span></div>}
      {view.planning && <div className="kv"><span>{H.sorted}</span><span className="v">{Object.keys(view.planning.picks).length}</span></div>}
    </div>
  )
}

// ------------------------------------------------------------------------------------------
// Refusals beside their controls
// ------------------------------------------------------------------------------------------
function useRefusals() {
  const [map, setMap] = useState<Record<string, string>>({})
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const set = useCallback((at: string, text: string | null) => {
    clearTimeout(timers.current[at])
    setMap((m) => { const n = { ...m }; if (text) n[at] = text; else delete n[at]; return n })
    if (text) timers.current[at] = setTimeout(() => setMap((m) => { const n = { ...m }; delete n[at]; return n }), 8000)
  }, [])
  return { map, set }
}

function Refusal({ text }: { text?: string }) {
  return text ? <div className="err refusal" role="alert">{text}</div> : null
}

type Ask = { title: string; text: string; options: { label: string; tone?: 'go' | 'danger'; run: () => void }[] }

// ------------------------------------------------------------------------------------------
// The big screen panel
// ------------------------------------------------------------------------------------------
function BigScreen({ hv, clock, cmd, refusals, ask, token, code }: {
  hv: HostView; clock: ClockRef | null; cmd: (type: string, payload: Record<string, unknown>, at: string) => Promise<unknown>
  refusals: Record<string, string>; ask: (a: Ask) => void; token: string; code: string
}) {
  const sc = hv.screen
  const phase = phaseOfStage(hv.stage)
  const playing = PLAY_STAGES.includes(hv.stage)
  const phaseName = phase ? `Phase ${PHASE_NUMBER[phase]}` : ''
  const allScored = hv.preview.winners?.final ?? false
  const deck = hv.deck
  const openScreen = async () => {
    const r = await hostFetch<{ path: string }>(token, '/api/host/screen-link', { code })
    if (r.ok) window.open(r.data.path, `lab02-screen-${code}`)
  }
  const showSlides = () => {
    if (playing) {
      ask({ title: H.slidesDuringTitle, text: H.slidesDuring(phaseName), options: [{ label: H.showSlides, tone: 'go', run: () => void cmd('screen_scene', { scene: 'slides' }, 'scene') }] })
    } else {
      ask({ title: H.slidesMirrorTitle, text: H.slidesMirror, options: [
        { label: H.slidesEveryone, tone: 'go', run: () => void cmd('screen_scene', { scene: 'slides', mirror: true }, 'scene') },
        { label: H.slidesProjectorOnly, run: () => void cmd('screen_scene', { scene: 'slides', mirror: false }, 'scene') },
      ] })
    }
  }
  const scenes: { id: SceneId; label: string; line: string; off: string | null; onClick?: () => void }[] = [
    { id: 'auto', label: H.follow, line: H.followLine, off: null },
    { id: 'lobby', label: H.lobby, line: H.lobbyLine, off: null },
    { id: 'play', label: H.leaderboard, line: H.leaderboardLine, off: sc.available.play ? null : H.leaderboardOff },
    { id: 'slides', label: H.slides, line: playing ? H.slidesLinePlaying : H.slidesLine, off: sc.available.slides ? null : H.slidesOff, onClick: showSlides },
    { id: 'winners', label: allScored ? H.winners : H.standingsSoFar, line: allScored ? H.winnersLine : H.winnersEarlyLine, off: sc.available.winners ? null : H.winnersOff },
  ]
  const pinned = sc.scene !== 'auto'
  const pinnedLabel = scenes.find((x) => x.id === sc.scene)?.label ?? H.spotlight
  const cur = deck.current
  return (
    <section className="panel">
      <div className="panel-head lav">{H.bigScreen}</div>
      <div className="panel-body bigscreen">
        <div>
          <button className="btn small go" onClick={openScreen}>{H.openScreen}</button>
          <div className="hint">{H.openScreenLine}</div>
          <div className="hint">{H.screensConnected(sc.screens)}</div>
        </div>
        <div className="preview" aria-label={H.previewLabel}>
          <ScreenStage v={hv.preview} clock={clock} scale={344 / 1920} themed />
        </div>
        {pinned && (
          <div className="pinned" role="status">
            <span>{H.pinned(pinnedLabel)}</span>
            <button className="btn small" onClick={() => cmd('screen_scene', { scene: 'auto' }, 'scene')}>{H.backToFollow}</button>
          </div>
        )}
        {sc.mirror && <div className="mirrored" role="status">{H.mirrored}</div>}

        <div className="group">
          <div className="eyebrow">{H.whatShows}</div>
          {scenes.map((x) => (
            <div key={x.id} className="ctl">
              <div className="ctl-row">
                <button className={`btn small text${(x.id === sc.scene) ? ' picked' : ''}`} aria-pressed={x.id === sc.scene} disabled={!!x.off}
                  onClick={x.onClick ?? (() => cmd('screen_scene', { scene: x.id }, 'scene'))}>{x.label}</button>
                {x.id === 'play' && (
                  <select className="field slim" aria-label={H.leaderboardShows} value={sc.filter ?? ''} onChange={(e) => cmd('screen_filter', { system: e.target.value || null }, 'scene')}>
                    <option value="">{H.everyone}</option>
                    {hv.session.systems.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                )}
                {x.id === sc.shown && x.id !== sc.scene && <span className="chip">{H.onNow}</span>}
              </div>
              <div className="hint">{x.off ?? x.line}</div>
            </div>
          ))}
          {sc.spotlight && (
            <div className="ctl">
              <button className="btn small text" onClick={() => cmd('spotlight', { playerId: null }, 'scene')}>{H.endSpotlight}</button>
              <div className="hint">{H.endSpotlightLine}</div>
            </div>
          )}
          <Refusal text={refusals.scene} />
        </div>

        <div className="group">
          <div className="eyebrow">{H.slidesGroup}</div>
          {deck.count === 0 ? <div className="hint">{H.noSlides}</div> : (
            <>
              <div className="ctl-row">
                <button className="btn small" onClick={() => cmd('slide', { delta: -1 }, 'slides')} disabled={sc.slide <= 0}>{H.prev}</button>
                <span className="num slidecount">{H.slideOf(sc.slide + 1, deck.count)}</span>
                <button className="btn small" onClick={() => cmd('slide', { delta: 1 }, 'slides')} disabled={sc.slide >= deck.count - 1}>{H.next}</button>
              </div>
              <div className="hint">{sc.shown === 'slides' ? H.slidesMoveLive : H.slidesMoveHidden}</div>
              <label className="lbl" htmlFor="jump">{H.jump}</label>
              <select id="jump" className="field slim" value={deck.sections.find((s) => sc.slide >= s.start && sc.slide < s.start + s.count)?.id ?? ''}
                onChange={(e) => { const sec = deck.sections.find((s) => s.id === e.target.value); if (sec) void cmd('slide_to', { index: sec.start }, 'slides') }}>
                {deck.sections.map((s) => <option key={s.id} value={s.id}>{s.title} ({H.slideOf(s.start + 1, deck.count)})</option>)}
              </select>
              {sc.shown === 'slides' && !playing && (
                <label className="check">
                  <input type="checkbox" checked={sc.mirror} onChange={(e) => cmd('screen_mirror', { mirror: e.target.checked }, 'slides')} />
                  <span>{H.mirrorToggle}</span>
                </label>
              )}
              <div className="slidepair">
                {[{ l: H.current, s: cur }, { l: H.upNext, s: deck.next }].map(({ l, s }) => (
                  <div key={l} className="minislide">
                    <div className="eyebrow">{l}</div>
                    {s ? (
                      <>
                        <div className="mst">{s.slide.title}{s.placeholder && <span className="chip" style={{ marginLeft: 6, fontSize: 11 }}>{H.placeholder}</span>}</div>
                        <ul>{s.slide.bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>
                      </>
                    ) : <div className="muted">{H.endOfDeck}</div>}
                  </div>
                ))}
              </div>
              {cur?.notes && <div className="notes"><b>{H.notes}</b> {cur.notes}</div>}
            </>
          )}
          <Refusal text={refusals.slides} />
        </div>

        <div className="group apart">
          <div className="eyebrow">{H.projectorTheme}</div>
          <div className="seg" role="group" aria-label={H.projectorTheme}>
            <button aria-pressed={sc.theme === 'light'} onClick={() => cmd('screen_theme', { theme: 'light' }, 'theme')}>{H.day}</button>
            <button aria-pressed={sc.theme === 'dark'} onClick={() => cmd('screen_theme', { theme: 'dark' }, 'theme')}>{H.night}</button>
          </div>
          <div className="hint">{H.themeLine}</div>
          <Refusal text={refusals.theme} />
        </div>
      </div>
    </section>
  )
}

// ------------------------------------------------------------------------------------------
// The console of one session
// ------------------------------------------------------------------------------------------
const SPEEDS = [1, 2, 5, 10, 20]

function Console({ token, name, code, back, manual }: { token: string; name: string; code: string; back: () => void; manual: () => void }) {
  const [conn, setConn] = useState<GameConnection | null>(null)
  const [hv, setHv] = useState<HostView | null>(null)
  const [clock, setClock] = useState<ClockRef | null>(null)
  const [filter, setFilter] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<null | 'reset_stage' | 'close'>(null)
  const [typed, setTyped] = useState('')
  const [confirmErr, setConfirmErr] = useState<string | null>(null)
  const [spect, setSpect] = useState<{ id: string; view: PlayerView | null } | null>(null)
  const [rename, setRename] = useState<{ id: string; name: string; err?: string } | null>(null)
  const [keyPass, setKeyPass] = useState<string | null>(null)
  const [keyErr, setKeyErr] = useState<string | null>(null)
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null)
  const [askSheet, setAskSheet] = useState<Ask | null>(null)
  const [takeOpen, setTakeOpen] = useState(false)
  const [moved, setMoved] = useState<string | null>(null)
  const [rowCodes, setRowCodes] = useState<Record<string, string>>({})
  const ref = useRefusals()

  useEffect(() => {
    const c = connect(token, { session: code, host: true, name })
    c.on('welcome', (m) => setHv((m as unknown as { view: HostView }).view))
    c.on('host_view', (m) => setHv((m as unknown as { view: HostView }).view))
    c.on('clock', (m) => setClock({ clock: (m as unknown as { clock: Clock }).clock, at: performance.now() }))
    c.on('control', (m) => {
      const x = m as unknown as { from: string | null; to: string }
      setMoved(H.controlMoved(x.to))
      setTimeout(() => setMoved(null), 8000)
    })
    c.on('spectate', (m) => {
      const s = m as unknown as { playerId: string; view: PlayerView | null }
      setSpect((cur) => (cur && cur.id === s.playerId ? { id: s.playerId, view: s.view } : cur))
    })
    c.onStatus((st) => { if (st === 'unauthorized') back() })
    setConn(c)
    return () => c.close()
  }, [token, code, back, name])

  const say = (t: string) => { setToast(t); setTimeout(() => setToast(null), 3500) }
  const cmd = useCallback(async (type: string, payload: Record<string, unknown> = {}, at = 'stage') => {
    if (!conn) return null
    const r = await conn.command(type, payload)
    ref.set(at, r.ok ? null : plainError(r.error))
    return r
  }, [conn, ref])
  const systems = hv?.session.systems ?? []
  const rows = useMemo(() => (hv?.players ?? []).filter((p) => !p.removed && (!filter || p.system === filter)), [hv, filter])

  if (!hv) return <div className="banner">{H.connecting}</div>
  const t = hv.stage
  const behind = hv.schedule.behindSeconds
  const ctl = hv.control
  const phase = phaseOfStage(t)
  const phaseName = phase ? `Phase ${PHASE_NUMBER[phase]}` : null
  const exportFile = async (what: string, format: string) => {
    const res = await fetch(`/api/host/export/${code}?what=${what}&format=${format}`, { headers: { authorization: `Bearer ${token}` } })
    if (!res.ok) { ref.set('downloads', plainError('internal')); return }
    const blob = await res.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `lab02-${code}-${what}.${format}`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
      <header className="topbar" style={{ gridTemplateColumns: '1fr auto' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, minWidth: 0 }}>
          <button className="iconbtn" onClick={back} aria-label={H.allSessions}>←</button>
          <span className="face" style={{ fontSize: 32 }}>{H.title}</span>
          <span style={{ color: 'var(--bar-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hv.session.label}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {hv.clock.scale !== 1 && <span className="chip speedbadge" role="status">{H.speedBadge(hv.clock.scale)}</span>}
          <span className="chip" style={{ background: ctl.you ? 'var(--go)' : '#fff', color: 'var(--on)', borderColor: '#1d2140' }}>{ctl.you ? H.youControl : H.viewOnly}</span>
          <span style={{ color: 'var(--bar-muted)', fontSize: 14 }}>{H.joinCode}</span>
          <span className="codebox">{hv.session.code}</span>
          <span className="chip" style={{ background: hv.session.mode === 'event' ? 'var(--go)' : 'var(--sun)', color: 'var(--on)', borderColor: '#1d2140' }}>{H.modeChip(hv.session.mode)}</span>
          <button className="btn small text" onClick={manual}>{H.manual}</button>
        </div>
      </header>
      {!ctl.you && (
        <div className="viewonly" role="status">
          <span>{ctl.holder ? H.watching(ctl.holder) : H.watchingNobody}</span>
          <button className="btn small sun" onClick={() => setTakeOpen(true)}>{H.takeControl}</button>
        </div>
      )}
      {ctl.you && ctl.watchers.length > 0 && <div className="watchers">{H.watchers(ctl.watchers)}</div>}
      <main className="console">
        <fieldset disabled={!ctl.you} className="ctlset">
          <section className="panel stagebar">
            <div>
              <div className="eyebrow">{H.nowOnStage}</div>
              <div className="face" style={{ fontSize: 32 }}>{STAGE_TITLE[t]}</div>
              {behind !== null && <div style={{ fontSize: 14, fontWeight: 700 }} className={behind > 30 ? 'bad' : 'good'}>{H.schedule(behind)}</div>}
            </div>
            <Countdown clock={clock} big guide />
            <div style={{ display: 'flex', gap: 20 }}>
              <div style={{ textAlign: 'center' }}><div className="num" style={{ fontSize: 32 }}>{hv.counts.total}</div><div className="hint">{hv.counts.total === 1 ? H.playerWord : H.playersWord}</div></div>
              <div style={{ textAlign: 'center' }}><div className="num good" style={{ fontSize: 32 }}>{hv.counts.connected}</div><div className="hint">{H.online}</div></div>
            </div>
            <div style={{ flexGrow: 1 }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end' }}>
                {hv.clock.running
                  ? <button className="btn small" onClick={() => cmd('pause')}>{H.pause}</button>
                  : <button className="btn small sun" onClick={() => cmd('resume')} disabled={hv.closed}>{H.resume}</button>}
                <button className="btn small" onClick={() => cmd('extend', { seconds: 30 })} disabled={!hv.timed}>+30 s</button>
                <button className="btn small" onClick={() => cmd('extend', { seconds: 60 })} disabled={!hv.timed}>+60 s</button>
                <button className="btn small danger" onClick={() => cmd('end_now')} disabled={!hv.timed}>{H.endNow}</button>
                <button className="btn go" onClick={() => cmd('next')} disabled={hv.timed || !hv.next}>
                  {hv.timed ? H.endsByItself : hv.next ? H.nextStage(STAGE_TITLE[hv.next]) : H.done}
                </button>
              </div>
              <Refusal text={ref.map.stage} />
            </div>
          </section>
        </fieldset>

        <div style={{ display: 'flex', gap: 4 }}>
          {hv.schedule.segments.map((s) => (
            <div key={s.segment} style={{ flex: s.end - s.start, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
              <div style={{ height: 14, background: s.state === 'done' ? 'var(--lav)' : s.state === 'now' ? 'var(--sun)' : 'var(--inset)', border: `2px solid ${s.state === 'now' ? 'var(--line)' : 'var(--soft)'}` }} />
              <div style={{ fontSize: 13, fontWeight: s.state === 'now' ? 800 : 600, color: s.state === 'now' ? 'var(--ink)' : 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.label} · {s.start}′</div>
            </div>
          ))}
        </div>

        <div className="console-grid">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
            <section className="panel">
              <div className="panel-head sky" style={{ justifyContent: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
                <span>{H.players}</span>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button className="chip" style={{ background: filter === null ? '#1d2140' : '#fff', color: filter === null ? '#fff' : '#1d2140', borderColor: '#1d2140', cursor: 'pointer' }} onClick={() => setFilter(null)}>{H.all} {hv.counts.total}</button>
                  {systems.map((s) => {
                    const n = hv.counts.bySystem.find((x) => x.id === s.id)?.players ?? 0
                    return <button key={s.id} className="chip" style={{ background: filter === s.id ? '#1d2140' : '#fff', color: filter === s.id ? '#fff' : '#1d2140', borderColor: '#1d2140', cursor: 'pointer' }} onClick={() => setFilter(s.id)}><SystemShape index={s.index} size={10} />{s.name} {n}</button>
                  })}
                </div>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table className="ptable">
                  <thead><tr className="eyebrow">
                    <th /><th>{H.colName}</th><th>{H.colSystem}</th><th>{H.colOnline}</th><th>{H.colStatus}</th><th>{H.colPoints}</th><th>{H.colLast}</th><th>{H.colActions}</th>
                  </tr></thead>
                  <tbody>
                    {rows.length === 0 && <tr><td colSpan={8} className="muted" style={{ padding: 12 }}>{H.noPlayers}</td></tr>}
                    {rows.map((p) => {
                      const sys = systems.find((s) => s.id === p.system)
                      return (
                        <tr key={p.id}>
                          <td style={{ padding: '4px 8px' }}><Avatar id={p.avatar} size={28} /></td>
                          <td style={{ fontWeight: 800, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</td>
                          <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><SystemShape index={sys?.index ?? 0} size={12} />{sys?.name}</span></td>
                          <td className={p.connected ? 'good' : 'bad'} style={{ fontWeight: 800 }}>{p.connected ? H.yes : H.no}</td>
                          <td>{p.status}</td>
                          <td className="num" style={{ fontSize: 18 }}>{p.points.total}</td>
                          <td>{p.idleSeconds === null ? '–' : `${p.idleSeconds} s`}</td>
                          <td style={{ whiteSpace: 'nowrap', padding: '4px 0' }}>
                            <button className="btn small text" onClick={() => { setSpect({ id: p.id, view: null }); void cmd('spectate', { playerId: p.id }, `row:${p.id}`) }}>{H.spectate}</button>{' '}
                            <button className="btn small text" disabled={!ctl.you} onClick={() => setRename({ id: p.id, name: p.name })}>{H.rename}</button>{' '}
                            <button className="btn small text" onClick={async () => { const r = await cmd('rejoin_code', { playerId: p.id }, `row:${p.id}`); if (r?.ok) setRowCodes((m) => ({ ...m, [p.id]: (r.data as { code: string }).code })) }}>{H.code}</button>{' '}
                            <button className="btn small text danger" disabled={!ctl.you} onClick={() => setRemoving({ id: p.id, name: p.name })}>{H.remove}</button>
                            {rowCodes[p.id] && <div className="hint">{H.rejoinCodeIs(rowCodes[p.id]!)}</div>}
                            <Refusal text={ref.map[`row:${p.id}`]} />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>
            <div className="tools">
              <section className="panel">
                <div className="panel-head">{H.downloads}</div>
                <div className="panel-body">
                  {([['results', 'csv', H.dlResults, H.dlResultsLine], ['timing', 'csv', H.dlTiming, H.dlTimingLine], ['commands', 'json', H.dlCommands, H.dlCommandsLine]] as const).map(([what, fmt, l, line]) => (
                    <div key={what} className="ctl">
                      <button className="btn small text" onClick={() => exportFile(what, fmt)}>{l}</button>
                      <div className="hint">{line}</div>
                    </div>
                  ))}
                  <Refusal text={ref.map.downloads} />
                </div>
              </section>
              {hv.session.mode !== 'event' && (
                <fieldset disabled={!ctl.you} className="ctlset">
                  <section className="panel">
                    <div className="panel-head sun">{H.rehearsalTools}</div>
                    <div className="panel-body">
                      <div className="ctl">
                        <span className="lbl">{H.gameSpeed}</span>
                        <div className="seg speeds" role="group" aria-label={H.gameSpeed}>
                          {SPEEDS.map((x) => <button key={x} aria-pressed={hv.clock.scale === x} onClick={() => cmd('set_scale', { scale: x }, 'speed')}>{x}×</button>)}
                        </div>
                        <div className="hint">{H.speedLine}</div>
                        <Refusal text={ref.map.speed} />
                      </div>
                      <div className="ctl">
                        <button className="btn small text danger" disabled={!phase} onClick={() => { setTyped(''); setConfirmErr(null); setConfirm('reset_stage') }}>{phaseName ? H.resetPhase(phaseName) : H.resetThisPhase}</button>
                        <div className="hint">{phase ? H.resetLine : H.resetOff}</div>
                      </div>
                    </div>
                  </section>
                </fieldset>
              )}
              <fieldset disabled={!ctl.you} className="ctlset">
                <section className="panel endbox">
                  <div className="panel-head bad">{H.endSession}</div>
                  <div className="panel-body">
                    <div className="hint">{H.endLine}</div>
                    <button className="btn small danger" onClick={() => { setTyped(''); setConfirmErr(null); setConfirm('close') }} disabled={hv.closed}>{H.endSessionButton}</button>
                  </div>
                </section>
              </fieldset>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
            <fieldset disabled={!ctl.you} className="ctlset">
              <BigScreen hv={hv} clock={clock} cmd={cmd} refusals={ref.map} ask={setAskSheet} token={token} code={code} />
            </fieldset>
            <section className="panel">
              <div className="panel-head">{H.roomLive}</div>
              <div className="panel-body">
                {(['overall', 'planning', 'development', 'maintaining'] as const).map((c) => {
                  const col = hv.board.columns[c]
                  return (
                    <details key={c} open={c === (hv.phaseLive ?? 'overall')}>
                      <summary style={{ cursor: 'pointer', fontWeight: 800, minHeight: 32 }}>{COLUMN_TITLE[c].title} {columnTag(col) && <span className="chip" style={{ fontSize: 11 }}>{columnTag(col)}</span>}</summary>
                      <BoardRows rows={col.rows.slice(0, 5)} systems={systems} of={col.of} emptyText={H.boardEmpty} />
                    </details>
                  )
                })}
                <SystemsStrip systems={systems} standings={hv.board.systems} />
              </div>
            </section>
            <section className="panel">
              <div className="panel-head sun">{H.answerKey}</div>
              <div className="panel-body">
                <div className="hint">{H.answerKeyLine}</div>
                <button className="btn small text" disabled={!hv.answerKey} onClick={() => { setKeyErr(null); setKeyPass('') }}>{hv.answerKey ? H.openKey : H.noKey}</button>
              </div>
            </section>
          </div>
        </div>
      </main>

      {confirm && (
        <Sheet title={confirm === 'close' ? H.endSession : phaseName ? H.resetPhase(phaseName) : H.resetThisPhase} head="sun" onClose={() => setConfirm(null)}>
          <p>{confirm === 'close' ? H.endLost(players(hv.counts.total)) : H.resetLost(phaseName ?? '', players(hv.counts.total))}</p>
          <label className="lbl" htmlFor="confirm-code">{H.typeCode(hv.session.code)}</label>
          <input id="confirm-code" className="field code" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
          {confirmErr && <div className="err" role="alert">{confirmErr}</div>}
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn danger" disabled={typed.trim().toUpperCase() !== hv.session.code} onClick={async () => {
              const r = await cmd(confirm, { confirm: typed.trim() }, 'confirm')
              if (r && !r.ok) { setConfirmErr(plainError(r.error)); return }
              setConfirm(null)
            }}>{confirm === 'close' ? H.endSessionButton : H.resetNow}</button>
            <button className="btn" onClick={() => setConfirm(null)}>{H.cancel}</button>
          </div>
        </Sheet>
      )}
      {rename && (
        <Sheet title={H.renameTitle} onClose={() => setRename(null)}>
          <label className="lbl" htmlFor="rn">{H.newName}</label>
          <input id="rn" className="field" value={rename.name} onChange={(e) => setRename({ ...rename, name: e.target.value, err: undefined })} autoFocus />
          {rename.err && <div className="err" role="alert">{rename.err}</div>}
          <button className="btn go" onClick={async () => {
            const r = await cmd('rename_player', { playerId: rename.id, name: rename.name }, 'rename')
            if (r?.ok) setRename(null)
            else setRename({ ...rename, err: plainError(r?.error, { name_taken: H.nameTaken }) })
          }}>{H.rename}</button>
        </Sheet>
      )}
      {spect && (
        <Sheet title={H.spectate} onClose={() => { setSpect(null); void cmd('spectate', { playerId: null }, 'spect') }}>
          {spect.view ? <SpectateView view={spect.view} /> : <div className="muted">{H.loading}</div>}
          <button className="btn small text" disabled={!ctl.you} onClick={async () => { const r = await cmd('spotlight', { playerId: spect.id }, 'spect'); if (r?.ok) say(H.spotlightOn) }}>{H.showOnScreen}</button>
          <Refusal text={ref.map.spect} />
        </Sheet>
      )}
      {keyPass !== null && (
        <Sheet title={H.answerKey} onClose={() => setKeyPass(null)}>
          <label className="lbl" htmlFor="kp">{H.passcodeAgain}</label>
          <input id="kp" className="field" type="password" value={keyPass} onChange={(e) => { setKeyPass(e.target.value); setKeyErr(null) }} autoFocus />
          {keyErr && <div className="err" role="alert">{keyErr}</div>}
          <button className="btn go" onClick={async () => {
            const r = await hostFetch<{ ticket: string }>(token, '/api/host/key-ticket', { passcode: keyPass })
            if (!r.ok) { setKeyErr(plainError(r.error)); return }
            setKeyPass(null)
            window.open(`/api/host/key?ticket=${encodeURIComponent(r.data.ticket)}`, '_blank', 'noopener')
          }}>{H.open}</button>
        </Sheet>
      )}
      {removing && (
        <Sheet title={H.removeTitle} onClose={() => setRemoving(null)}>
          <p>{H.removeText(removing.name)}</p>
          <Refusal text={ref.map.remove} />
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn danger" onClick={async () => { const r = await cmd('remove_player', { playerId: removing.id }, 'remove'); if (r?.ok) setRemoving(null) }}>{H.remove}</button>
            <button className="btn" onClick={() => setRemoving(null)}>{H.cancel}</button>
          </div>
        </Sheet>
      )}
      {askSheet && (
        <Sheet title={askSheet.title} head="sun" onClose={() => setAskSheet(null)}>
          <p>{askSheet.text}</p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {askSheet.options.map((o) => <button key={o.label} className={`btn${o.tone ? ` ${o.tone}` : ''}`} onClick={() => { setAskSheet(null); o.run() }}>{o.label}</button>)}
            <button className="btn text" onClick={() => setAskSheet(null)}>{H.cancel}</button>
          </div>
        </Sheet>
      )}
      {takeOpen && (
        <Sheet title={H.takeControl} head="sun" onClose={() => setTakeOpen(false)}>
          <p>{H.takeText(ctl.holder)}</p>
          <Refusal text={ref.map.take} />
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn go" onClick={async () => { const r = await cmd('take_control', {}, 'take'); if (r?.ok) setTakeOpen(false) }}>{H.takeControl}</button>
            <button className="btn" onClick={() => setTakeOpen(false)}>{H.cancel}</button>
          </div>
        </Sheet>
      )}
      {(toast || moved) && <div className="toast" role="status">{moved ?? toast}</div>}
    </div>
  )
}

export function HostPage({ go }: { go: (path: string) => void }) {
  const [auth, setAuth] = useState<{ token: string; name: string } | null>(() => {
    const h = store.host()
    return h?.token ? { token: h.token, name: h.name ?? '' } : null
  })
  const params = new URLSearchParams(location.search)
  const code = params.get('s')
  const signOut = useCallback(() => { store.setHost(null); setAuth(null) }, [])
  const back = useCallback(() => go('/host'), [go])
  const manual = useCallback(() => window.open('/host/manual', 'lab02-manual'), [])
  if (!auth || !auth.name) return <Login onToken={(token, name) => setAuth({ token, name })} />
  if (!code) return <Sessions token={auth.token} open={(c) => go(`/host?s=${c}`)} signOut={signOut} manual={manual} />
  return <Console key={code} token={auth.token} name={auth.name} code={code} back={back} manual={manual} />
}
