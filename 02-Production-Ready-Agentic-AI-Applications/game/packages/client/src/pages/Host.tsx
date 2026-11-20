// The host console (engineering spec, section 10.8). Laptop only. Every control carries one line
// that says what it does, and every refusal is one plain sentence beside the control it
// concerns. One console controls the session at a time (section 7.10).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { MODES, PLAY_STAGES, phaseOfStage, resetPhaseOf, type Clock, type GameConnection, type Mode, type PlayerView, type SceneId } from '@lab02/protocol'
import type { HostView, SessionSummary } from '@lab02/protocol/host'
import { PHASE_NUMBER, STAGE_TITLE, players } from '../copy.ts'
import { plainError } from '../lib/errors.ts'
import { connect, hostFetch } from '../lib/net.ts'
import { consoleId, store } from '../lib/storage.ts'
import type { ClockRef } from '../lib/clock.ts'
import { Avatar, BoardRows, COLUMN_TITLE, Countdown, Sheet, SystemShape, columnTag } from '../components/ui.tsx'
import { SystemsStrip } from './Play.tsx'
import { ScreenStage } from './Screen.tsx'
import { ManualBody } from './Manual.tsx'
import { H } from './hostCopy.ts'

type RowAction = { label: string; run: () => void; off?: boolean; danger?: boolean }

/** The actions of a players-table row behind one menu, so every action stays inside the table (section 10.8). */
function RowActions({ label, items }: { label: string; items: RowAction[] }) {
  const btn = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<{ top: number; right: number } | null>(null)
  useEffect(() => {
    if (!at) return
    const shut = (e: Event) => {
      const t = e.target as Node
      if (e.type === 'mousedown' && (menu.current?.contains(t) || btn.current?.contains(t))) return
      setAt(null)
    }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setAt(null); btn.current?.focus() } }
    window.addEventListener('mousedown', shut)
    window.addEventListener('resize', shut)
    window.addEventListener('scroll', shut, true)
    window.addEventListener('keydown', key)
    menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    return () => {
      window.removeEventListener('mousedown', shut)
      window.removeEventListener('resize', shut)
      window.removeEventListener('scroll', shut, true)
      window.removeEventListener('keydown', key)
    }
  }, [at])
  const open = () => {
    const r = btn.current!.getBoundingClientRect()
    setAt(at ? null : { top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) })
  }
  return (
    <>
      <button ref={btn} type="button" className="btn small text actbtn" aria-haspopup="menu" aria-expanded={!!at} aria-label={label} title={H.colActions} onClick={open}>☰</button>
      {at && (
        <div ref={menu} className="actmenu" role="menu" style={{ top: at.top, right: at.right }}>
          {items.map((it) => (
            <button key={it.label} type="button" role="menuitem" className={it.danger ? 'danger' : ''} disabled={it.off}
              onClick={() => { setAt(null); it.run() }}>{it.label}</button>
          ))}
        </div>
      )}
    </>
  )
}

type PackInfo = {
  title: string | null; hash: string; systems: string[]; systemNames?: string[]
  phasesAvailable: Record<string, boolean>; provisional: boolean; pickModes?: Mode[]; placeholders?: number
}
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
          <label className="lbl" htmlFor="pass">{H.passcode}</label>
          <input id="pass" className="field" type="password" autoComplete="current-password" value={pass} onChange={(e) => setPass(e.target.value)} aria-describedby="pass-err" />
          {err && <div id="pass-err" className="err" role="alert">{err}</div>}
          <label className="lbl" htmlFor="hname">{H.yourName}</label>
          <input id="hname" className="field" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder={H.yourNameExample} aria-describedby="hname-hint" />
          <div id="hname-hint" className="hint">{H.yourNameHint}</div>
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

function Downloads({ token, code, onError }: { token: string; code: string; onError: (t: string | null) => void }) {
  const exportFile = async (what: string, format: string) => {
    const res = await fetch(`/api/host/export/${code}?what=${what}&format=${format}`, { headers: { authorization: `Bearer ${token}` } })
    if (!res.ok) { onError(plainError('internal')); return }
    onError(null)
    const blob = await res.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `lab02-${code}-${what}.${format}`
    a.click()
    URL.revokeObjectURL(a.href)
  }
  return (
    <>
      {([['results', 'csv', H.dlResults, H.dlResultsLine], ['timing', 'csv', H.dlTiming, H.dlTimingLine], ['commands', 'json', H.dlCommands, H.dlCommandsLine]] as const).map(([what, fmt, l, line]) => (
        <div key={what} className="ctl">
          <button className="btn small text" onClick={() => exportFile(what, fmt)}>{l}</button>
          <div className="hint">{line}</div>
        </div>
      ))}
    </>
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
  const [dlErr, setDlErr] = useState<Record<string, string>>({})
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
        {s.closed && (
          <span className="sdl">
            <Downloads token={token} code={s.code} onError={(t) => setDlErr((m) => ({ ...m, [s.code]: t ?? '' }))} />
            {dlErr[s.code] && <span className="err">{dlErr[s.code]}</span>}
          </span>
        )}
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
            <div className="good" style={{ fontWeight: 800, fontSize: 17 }}>{H.loaded(pack.title, phases, pack.systems.length)}</div>
            {pack.provisional && <div className="bad" style={{ fontWeight: 800 }}>{H.uncalibrated}</div>}
            {!!pack.placeholders && <div style={{ fontWeight: 800 }}>{H.placeholders(pack.placeholders)}</div>}
            <div className="hint" style={{ fontSize: 12 }}>{H.loadedDetail(pack.systemNames ?? pack.systems, pack.hash)}</div>
          </div>
        </section>
      )}
      <form className="panel" noValidate onSubmit={async (e) => {
        e.preventDefault()
        setErr(null)
        if (!label.trim()) { setErr({ field: 'label', text: H.labelNeeded }); return }
        if (codeBad) { setErr({ field: 'code', text: plainError('code_invalid') }); return }
        const body: Record<string, string> = { label: label.trim(), mode }
        if (code.trim()) body.code = code.trim().toUpperCase()
        const r = await hostFetch<{ code: string }>(token, '/api/host/session', body)
        if (!r.ok) {
          const field = r.error === 'code_invalid' || r.error === 'code_taken' ? 'code' : 'form'
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
            <div className="hint">{H.modeLine[mode]} {(pack?.pickModes ?? []).includes(mode) ? H.pickYes : H.pickNo}</div>
            {pack?.provisional && <div id="mode-why" className="hint bad">{H.eventWhy}</div>}
          </div>
          <div className="fieldbox">
            <label className="lbl" htmlFor="scode">{H.joinCode}</label>
            <input id="scode" className={`field code${codeBad ? ' bad' : ''}`} value={code} maxLength={9} autoComplete="off" spellCheck={false}
              onChange={(e) => setCode(e.target.value.replace(/\s/g, ''))} aria-invalid={codeBad} aria-describedby="scode-hint scode-rule scode-err" />
            <div id="scode-rule" className={`hint${codeBad ? ' bad' : ''}`}>{H.joinCodeRule}</div>
            <div id="scode-hint" className="hint">{H.joinCodeHint}</div>
            {(codeBad || err?.field === 'code') && <div id="scode-err" className="err" role="alert">{codeBad ? plainError('code_invalid') : err!.text}</div>}
          </div>
          <div className="fieldbox" style={{ justifyContent: 'flex-start', paddingTop: 22 }}>
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
type Cmd = (type: string, payload?: Record<string, unknown>, at?: string) => Promise<{ ok: boolean; error?: string; data?: unknown } | null>

// ------------------------------------------------------------------------------------------
// The projector panel
// ------------------------------------------------------------------------------------------
function Projector({ hv, clock, cmd, refusals, ask, token, code, canAct }: {
  hv: HostView; clock: ClockRef | null; cmd: Cmd; refusals: Record<string, string>; ask: (a: Ask) => void; token: string; code: string; canAct: boolean
}) {
  const sc = hv.screen
  const phase = phaseOfStage(hv.stage)
  const playing = PLAY_STAGES.includes(hv.stage)
  const phaseName = phase ? `Phase ${PHASE_NUMBER[phase]}` : 'A phase'
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
    { id: 'slides', label: H.slides, line: H.slidesLine, off: sc.available.slides ? null : H.slidesOff, onClick: showSlides },
    { id: 'winners', label: H.winners, line: H.winnersLine, off: sc.available.winners ? null : H.winnersOff },
  ]
  const pinned = sc.scene !== 'auto'
  const pinnedLabel = scenes.find((x) => x.id === sc.scene)?.label ?? H.spotlightScene
  const cur = deck.current
  const section = deck.sections.find((s) => sc.slide >= s.start && sc.slide < s.start + s.count)
  const mirrorOff = playing ? H.mirrorOffPlay : sc.shown !== 'slides' ? H.mirrorOffHidden : null
  // The preview is as wide as the panel allows, up to 640 px, and keeps the projector's 16 to 9.
  const box = useRef<HTMLDivElement>(null)
  const [pw, setPw] = useState(344)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const fit = () => setPw(Math.max(240, Math.min(640, el.clientWidth - 6)))
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    fit()
    return () => ro.disconnect()
  }, [])

  // The left and right arrow keys move the slides while no field has the focus.
  useEffect(() => {
    if (!canAct || deck.count === 0) return
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.closest('input, select, textarea, [contenteditable]') || t.closest('[role="dialog"]'))) return
      if (e.key === 'ArrowRight') { e.preventDefault(); void cmd('slide', { delta: 1 }, 'slides') }
      if (e.key === 'ArrowLeft') { e.preventDefault(); void cmd('slide', { delta: -1 }, 'slides') }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [canAct, deck.count, cmd])

  return (
    <section className="panel">
      <div className="panel-head lav">{H.bigScreen}</div>
      <div className="panel-body bigscreen">
        <div ref={box} className="previewbox">
          <div className="preview" aria-label={H.previewLabel} style={{ width: pw + 6, height: Math.round(pw * 9 / 16) + 6 }}>
            <ScreenStage v={hv.preview} clock={clock} scale={pw / 1920} themed />
          </div>
        </div>
        <div className="ctl-row openrow">
          <button className="btn small go" onClick={openScreen}>{H.openScreen}</button>
          <span className={`hint${sc.screens === 0 ? ' bad' : ''}`} style={{ fontWeight: 800 }}>{H.screensConnected(sc.screens)}</span>
        </div>
        <div className="hint">{H.openScreenLine}</div>
        {pinned && (
          <div className="pinned" role="status">
            <span>{H.pinned(pinnedLabel)}</span>
            <button className="btn small" onClick={() => cmd('screen_scene', { scene: 'auto' }, 'scene')}>{H.backToFollow}</button>
          </div>
        )}
        {sc.mirror && <div className="mirrored" role="status">{H.mirrored}</div>}

        <div className="pgroups">
        <div className="group">
          <div className="eyebrow">{H.whatShows}</div>
          {scenes.map((x) => (
            <div key={x.id} className="ctl">
              <div className="ctl-row">
                <button className={`btn small text${x.id === sc.scene ? ' picked' : ''}`} aria-pressed={x.id === sc.scene} disabled={!!x.off}
                  onClick={x.onClick ?? (() => cmd('screen_scene', { scene: x.id }, 'scene'))}>{x.label}</button>
                {x.id === 'play' && (
                  <select className="field slim" aria-label={H.leaderboardShows} value={sc.filter ?? ''} onChange={(e) => cmd('screen_filter', { system: e.target.value || null }, 'scene')}>
                    <option value="">{H.everyone}</option>
                    {hv.session.systems.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                )}
                {x.id === sc.shown && x.id !== sc.scene && <span className="chip">{H.onNow}</span>}
              </div>
              <div className={`hint${x.off ? ' bad' : ''}`}>{x.off ?? x.line}</div>
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
              {section && <div className="sectitle">{section.title}</div>}
              <div className="hint">{H.keysLine}</div>
              <label className="lbl" htmlFor="jump">{H.jump}</label>
              <select id="jump" className="field slim" value={section?.id ?? ''}
                onChange={(e) => { const sec = deck.sections.find((s) => s.id === e.target.value); if (sec) void cmd('slide_to', { index: sec.start }, 'slides') }}>
                {deck.sections.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
              </select>
              <div className="ctl">
                <label className={`check${mirrorOff ? ' off' : ''}`}>
                  <input type="checkbox" checked={sc.mirror} disabled={!!mirrorOff && !sc.mirror} onChange={(e) => cmd('screen_mirror', { mirror: e.target.checked }, 'slides')} />
                  <span>{H.mirrorToggle}</span>
                </label>
                {mirrorOff && <div className="hint">{mirrorOff}</div>}
              </div>
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

/** The room after a phase: how the points spread and each health system. */
function RoomStats({ hv }: { hv: HostView }) {
  const r = hv.preview.reveal
  if (!r) return null
  const total = r.histogram.reduce((a, b) => a + b, 0)
  return (
    <div className="roomstats">
      <div className="eyebrow">{H.roomStats(`Phase ${PHASE_NUMBER[r.phase]}`)} · {players(total)}</div>
      {r.systems.map((x) => {
        const ref = hv.session.systems.find((s) => s.id === x.id)
        return (
          <div key={x.id} className="kv">
            <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><SystemShape index={ref?.index ?? 0} size={10} />{ref?.name}</span>
            <span className="v">{Math.round(x.meanPoints)} {H.meanPoints}{r.phase === 'planning' ? `, ${H.foundAgent(x.flagshipHits, x.players)}` : ''}</span>
          </div>
        )
      })}
    </div>
  )
}

// ------------------------------------------------------------------------------------------
// The console of one session
// ------------------------------------------------------------------------------------------
const SPEEDS = [1, 5, 10, 50]

function Console({ token, name, code, back, manual }: { token: string; name: string; code: string; back: () => void; manual: () => void }) {
  const [conn, setConn] = useState<GameConnection | null>(null)
  const [hv, setHv] = useState<HostView | null>(null)
  const [clock, setClock] = useState<ClockRef | null>(null)
  const [filter, setFilter] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<null | 'reset_stage' | 'restart_game' | 'close'>(null)
  const [typed, setTyped] = useState('')
  const [confirmErr, setConfirmErr] = useState<string | null>(null)
  const [spect, setSpect] = useState<{ id: string; view: PlayerView | null } | null>(null)
  const [rename, setRename] = useState<{ id: string; name: string; err?: string } | null>(null)
  const [keyPass, setKeyPass] = useState<string | null>(null)
  const [keyErr, setKeyErr] = useState<string | null>(null)
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null)
  const [askSheet, setAskSheet] = useState<Ask | null>(null)
  const [takeOpen, setTakeOpen] = useState(false)
  const [lost, setLost] = useState<string | null>(null)
  const [rowCodes, setRowCodes] = useState<Record<string, string>>({})
  const [manualOpen, setManualOpen] = useState(false)
  const ref = useRefusals()
  const youRef = useRef(false)

  useEffect(() => {
    const c = connect(token, { session: code, host: true, name, console: consoleId() })
    c.on('welcome', (m) => setHv((m as unknown as { view: HostView }).view))
    c.on('host_view', (m) => { const v = (m as unknown as { view: HostView }).view; youRef.current = v.control.you; setHv(v) })
    c.on('clock', (m) => setClock({ clock: (m as unknown as { clock: Clock }).clock, at: performance.now() }))
    // The console that lost control keeps a notice until it is closed, or until it holds control again.
    c.on('control', (m) => { const x = m as unknown as { from: string | null; to: string }; if (youRef.current && x.to !== name) setLost(H.tookControl(x.to)) })
    c.on('spectate', (m) => {
      const s = m as unknown as { playerId: string; view: PlayerView | null }
      setSpect((cur) => (cur && cur.id === s.playerId ? { id: s.playerId, view: s.view } : cur))
    })
    // A session the server no longer holds (deleted, or ended before a restart) goes back to the list.
    c.onStatus((st) => { if (st === 'unauthorized' || st === 'ended') back() })
    setConn(c)
    return () => c.close()
  }, [token, code, back, name])

  const say = (t: string) => { setToast(t); setTimeout(() => setToast(null), 3500) }
  const cmd: Cmd = useCallback(async (type, payload = {}, at = 'stage') => {
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
  // The phase a reset starts again: the one on stage, or at a break the one before it.
  const phase = resetPhaseOf(t)
  const phaseName = phase ? `Phase ${PHASE_NUMBER[phase]}` : null
  // Only an event session asks for the join code to be typed. A test or a rehearsal confirms with one click.
  const mustType = hv.session.mode === 'event'
  const openConfirm = (what: 'reset_stage' | 'restart_game' | 'close') => { setTyped(''); setConfirmErr(null); setConfirm(what) }
  // A phase column shows once its phase has opened, so the table fits at 1280 px (section 10.8).
  const shownPhases = (['planning', 'development', 'maintaining'] as const).filter((ph) => hv.board.columns[ph].state !== 'empty')
  const take = () => { if (ctl.state === 'free') void cmd('take_control', {}, 'take'); else setTakeOpen(true) }

  return (
    <div className={`hostwrap${manualOpen ? ' with-manual' : ''}`}>
      <div className="hostmain">
        <header className="topbar sessbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
            <button className="iconbtn" onClick={back} aria-label={H.allSessions}>←</button>
            <span style={{ fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hv.session.label}</span>
            <span className="codebox" title={H.joinCode}>{hv.session.code}</span>
            <span className="chip" style={{ background: hv.session.mode === 'event' ? 'var(--go)' : 'var(--sun)', color: 'var(--on)', borderColor: '#1d2140' }}>{H.modeChip(hv.session.mode)}</span>
            {hv.clock.scale !== 1 && <span className="chip speedbadge" role="status">{H.speedBadge(hv.clock.scale)}</span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span className="barstage">{STAGE_TITLE[t]}</span>
            <Countdown clock={clock} guide />
            {hv.counts.bySystem.map((x) => {
              const s = systems.find((y) => y.id === x.id)
              return <span key={x.id} className="barsys" title={s?.name}><SystemShape index={s?.index ?? 0} size={10} />{H.connections(x.players, x.connected)}</span>
            })}
            <span className={`chip ${ctl.you ? 'good' : 'watch'}`} title={ctl.you ? undefined : H.controlLine(ctl.holder, false)}>{ctl.you ? H.youControl : H.viewOnly}</span>
            <button className="btn small text" onClick={() => setManualOpen(!manualOpen)} aria-expanded={manualOpen}>{H.manual}</button>
          </div>
        </header>
        {!ctl.you && (
          <div className="viewonly" role="status">
            <span>{ctl.state === 'held' ? H.controlledFrom(ctl.holder ?? '') : ctl.state === 'reconnecting' ? H.reconnecting : H.nobody}</span>
            <button className="btn small sun" onClick={take}>{H.takeControl}</button>
            <Refusal text={ref.map.take} />
          </div>
        )}
        {lost && !ctl.you && (
          <div className="lostctl" role="alert">
            <span>{lost}</span>
            <button className="btn small" onClick={() => setLost(null)} aria-label={H.close}>✕</button>
          </div>
        )}
        {hv.closed && (
          <div className="endedbar" role="status">
            <span>{H.endedBar}</span>
            <button className="btn small" onClick={back}>{H.allSessions}</button>
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
              <div className="stagectl">
                <div className="ctl">
                  <button className="btn go" onClick={() => cmd('next')} disabled={hv.timed || !hv.next}>
                    {hv.timed ? H.endsByItself : hv.next ? H.nextStage(STAGE_TITLE[hv.next]) : H.done}
                  </button>
                  <div className="hint">{H.stageLines.next}</div>
                </div>
                <div className="ctl">
                  {hv.clock.running
                    ? <button className="btn small" onClick={() => cmd('pause')}>{H.pause}</button>
                    : <button className="btn small sun" onClick={() => cmd('resume')} disabled={hv.closed}>{H.resume}</button>}
                  <div className="hint">{H.stageLines.pause}</div>
                </div>
                <div className="ctl">
                  <div className="ctl-row">
                    <button className="btn small" onClick={() => cmd('extend', { seconds: 30 })} disabled={!hv.timed}>+30 s</button>
                    <button className="btn small" onClick={() => cmd('extend', { seconds: 60 })} disabled={!hv.timed}>+60 s</button>
                  </div>
                  <div className="hint">{H.stageLines.extend}</div>
                </div>
                <div className="ctl">
                  <button className="btn small danger" onClick={() => cmd('end_now')} disabled={!hv.timed}>{H.endNow}</button>
                  <div className="hint">{H.stageLines.endNow}</div>
                </div>
              </div>
              <Refusal text={ref.map.stage} />
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

          {/* Three columns (section 10.8): the players, the projector as the main area, and the
              panels that are seldom needed. */}
          <div className="console-grid">
            <div className="ccol">
              <section className="panel">
                <div className="panel-head sky" style={{ justifyContent: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
                  <span>{H.players}</span>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button className="chip" style={{ background: filter === null ? '#1d2140' : '#fff', color: filter === null ? '#fff' : '#1d2140', borderColor: '#1d2140', cursor: 'pointer' }} onClick={() => setFilter(null)}>{H.everyone} {hv.counts.total}</button>
                    {systems.map((s) => {
                      const n = hv.counts.bySystem.find((x) => x.id === s.id)?.players ?? 0
                      return <button key={s.id} className="chip" title={s.name} aria-label={`${s.name} ${n}`} style={{ background: filter === s.id ? '#1d2140' : '#fff', color: filter === s.id ? '#fff' : '#1d2140', borderColor: '#1d2140', cursor: 'pointer' }} onClick={() => setFilter(s.id)}><SystemShape index={s.index} size={10} />{n}</button>
                    })}
                  </div>
                </div>
                <ul className="plist" aria-label={H.players}>
                  {rows.length === 0 && <li className="muted" style={{ padding: 12 }}>{H.noPlayers}</li>}
                  {rows.map((p) => {
                    const sys = systems.find((s) => s.id === p.system)
                    return (
                      <li key={p.id} className="prow">
                        <Avatar id={p.avatar} size={32} />
                        <div className="pmain">
                          <div className="pline">
                            <span className="pname" title={p.name}>{p.name}</span>
                            <span className="psys" title={sys?.name}><SystemShape index={sys?.index ?? 0} size={12} /><span className="sr-only">{sys?.name}</span></span>
                            <span className={`ponline ${p.connected ? 'good' : 'bad'}`}><span aria-hidden="true">●</span> {p.connected ? H.onlineWord : H.offlineWord}</span>
                          </div>
                          <div className="pstatus">{p.status}{p.idleSeconds === null ? '' : ` · ${H.lastAct(p.idleSeconds)}`}</div>
                          {rowCodes[p.id] && <div className="hint">{H.rejoinCodeIs(rowCodes[p.id]!)}</div>}
                          <Refusal text={ref.map[`row:${p.id}`]} />
                        </div>
                        <div className="ppts">
                          <span className="num" title={H.colTotal}>{p.points.total}</span>
                          {shownPhases.length > 1 && <span className="hint">{shownPhases.map((ph) => `${H.colPhase(PHASE_NUMBER[ph])} ${p.points[ph] ?? '–'}`).join(' · ')}</span>}
                        </div>
                        <RowActions label={H.actionsFor(p.name)} items={[
                          { label: H.spectate, run: () => { setSpect({ id: p.id, view: null }); void cmd('spectate', { playerId: p.id }, `row:${p.id}`) } },
                          { label: H.spotlight, off: !ctl.you, run: async () => { const r = await cmd('spotlight', { playerId: p.id }, `row:${p.id}`); if (r?.ok) say(H.spotlightOn) } },
                          { label: H.rename, off: !ctl.you, run: () => setRename({ id: p.id, name: p.name }) },
                          { label: H.code, run: async () => { const r = await cmd('rejoin_code', { playerId: p.id }, `row:${p.id}`); if (r?.ok) setRowCodes((m) => ({ ...m, [p.id]: (r.data as { code: string }).code })) } },
                          { label: H.remove, off: !ctl.you, danger: true, run: () => setRemoving({ id: p.id, name: p.name }) },
                        ]} />
                      </li>
                    )
                  })}
                </ul>
              </section>
              <section className="panel">
                <div className="panel-head">{H.roomLive}</div>
                <div className="panel-body">
                  <RoomStats hv={hv} />
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
            </div>

            <div className="ccol">
              <fieldset disabled={!ctl.you} className="ctlset">
                <Projector hv={hv} clock={clock} cmd={cmd} refusals={ref.map} ask={setAskSheet} token={token} code={code} canAct={ctl.you} />
              </fieldset>
            </div>

            <div className="ccol">
              {hv.session.mode !== 'event' && (
                <fieldset disabled={!ctl.you || hv.closed} className="ctlset">
                  <section className="panel">
                    <div className="panel-head sun">{H.rehearsalTools}</div>
                    <div className="panel-body">
                      <div className="ctl">
                        <span className="lbl">{H.gameSpeed}</span>
                        <div className="seg speeds" role="group" aria-label={H.gameSpeed}>
                          {SPEEDS.map((x) => <button key={x} aria-pressed={hv.clock.scale === x} onClick={() => cmd('set_scale', { scale: x }, 'speed')}>{x}×</button>)}
                        </div>
                        <div className="hint">{H.speedLine} {H.speedWhen}</div>
                        <Refusal text={ref.map.speed} />
                      </div>
                      <div className="ctl">
                        <button className="btn small text danger" disabled={!phase} onClick={() => openConfirm('reset_stage')}>{phaseName ? H.resetPhase(phaseName) : H.resetThisPhase}</button>
                        <div className="hint">{phase ? H.resetLine : H.resetOff}</div>
                      </div>
                      <div className="ctl">
                        <button className="btn small text danger" onClick={() => openConfirm('restart_game')}>{H.restartGame}</button>
                        <div className="hint">{H.restartLine}</div>
                      </div>
                    </div>
                  </section>
                </fieldset>
              )}
              <fieldset disabled={!ctl.you} className="ctlset">
                <section className="panel endbox">
                  <div className="panel-head bad">{H.endSession}</div>
                  <div className="panel-body">
                    <div className="hint">{hv.closed ? H.endedShort : H.endLine}</div>
                    <button className="btn small danger" onClick={() => openConfirm('close')} disabled={hv.closed}>{H.endSessionButton}</button>
                  </div>
                </section>
              </fieldset>
              <section className="panel">
                <div className="panel-head">{H.downloads}</div>
                <div className="panel-body">
                  <Downloads token={token} code={code} onError={(x) => ref.set('downloads', x)} />
                  <Refusal text={ref.map.downloads} />
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
      </div>
      {manualOpen && (
        <aside className="manual-side" aria-label={H.manual}>
          <div className="manual-head">
            <span className="face">{H.manual}</span>
            <span style={{ display: 'flex', gap: 6 }}>
              <button className="btn small text" onClick={manual}>{H.manualWindow}</button>
              <button className="btn small" onClick={() => setManualOpen(false)} aria-label={H.close}>✕</button>
            </span>
          </div>
          <div className="manual-scroll"><ManualBody /></div>
        </aside>
      )}

      {confirm && (
        <Sheet title={confirm === 'close' ? H.endSession : confirm === 'restart_game' ? H.restartGame : phaseName ? H.resetPhase(phaseName) : H.resetThisPhase} head="sun" onClose={() => setConfirm(null)}>
          <p>{confirm === 'close' ? H.endLost(hv.counts.total) : confirm === 'restart_game' ? H.restartLost(hv.counts.total) : H.resetLost(phaseName ?? '', hv.counts.total)}</p>
          {mustType && (
            <>
              <label className="lbl" htmlFor="confirm-code">{H.typeCode(hv.session.code)}</label>
              <input id="confirm-code" className="field code" value={typed} autoComplete="off" spellCheck={false} onChange={(e) => setTyped(e.target.value)} autoFocus />
            </>
          )}
          {confirmErr && <div className="err" role="alert">{confirmErr}</div>}
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn danger" autoFocus={!mustType} disabled={mustType && typed.trim().toUpperCase() !== hv.session.code} onClick={async () => {
              const r = await cmd(confirm, { confirm: mustType ? typed.trim() : hv.session.code }, 'confirm')
              if (r && !r.ok) { setConfirmErr(plainError(r.error)); return }
              setConfirm(null)
              if (confirm === 'restart_game') say(H.restarted)
            }}>{confirm === 'close' ? H.endSessionButton : confirm === 'restart_game' ? H.restartNow : H.resetNow}</button>
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
            else setRename({ ...rename, err: plainError(r?.error) })
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
      {toast && <div className="toast" role="status">{toast}</div>}
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
  const manual = useCallback(() => { window.open('/host/manual', 'lab02-manual') }, [])
  if (!auth || !auth.name) return <Login onToken={(token, name) => setAuth({ token, name })} />
  if (!code) return <Sessions token={auth.token} open={(c) => go(`/host?s=${c}`)} signOut={signOut} manual={manual} />
  return <Console key={code} token={auth.token} name={auth.name} code={code} back={back} manual={manual} />
}
