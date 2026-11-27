// The host console (engineering spec, section 10.8). Laptop only. Every control carries one line
// that says what it does, and every refusal is one plain sentence beside the control it
// concerns. One console controls the session at a time (section 7.10).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { MODES, PHASES, PLAY_STAGES, STAGES, phaseOfStage, resetPhaseOf, type Clock, type GameConnection, type Mode, type SceneId } from '@lab02/protocol'
import type { HostInspect, HostView, SessionRunning, SessionSummary, SoloOverview, SoloSummary } from '@lab02/protocol/host'
import { PHASE_NUMBER, STAGE_TITLE, players } from '../copy.ts'
import { plainError } from '../lib/errors.ts'
import { connect, hostFetch } from '../lib/net.ts'
import { consoleId, store } from '../lib/storage.ts'
import type { ClockRef } from '../lib/clock.ts'
import { Avatar, BoardRows, COLUMN_TITLE, Countdown, Sheet, SystemShape, columnTag } from '../components/ui.tsx'
import { Inspector, SlideLook } from './hostParts.tsx'
import { SystemsStrip } from './Play.tsx'
import { startedText } from './Start.tsx'
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
  guide?: boolean
}

/**
 * Opens a private page of the server, the answer key or the facilitator guide, with one press
 * (section 10.8). The window is opened at once, inside the press, so that no browser blocks it,
 * and gets its address when the ticket arrives. Returns the refusal to show, or null.
 */
async function openPrivatePage(token: string, page: 'key' | 'guide'): Promise<string | null> {
  const win = window.open('about:blank', '_blank')
  const r = await hostFetch<{ ticket: string }>(token, `/api/host/${page}-ticket`, {})
  if (!r.ok) { win?.close(); return plainError(r.error) }
  const url = `/api/host/${page}?ticket=${encodeURIComponent(r.data.ticket)}`
  if (win) { win.opener = null; win.location.href = url } else window.open(url, '_blank', 'noopener')
  return null
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
      {([['results', 'csv', H.dlResults, H.dlResultsLine], ['cards', 'csv', H.dlCards, H.dlCardsLine], ['timing', 'csv', H.dlTiming, H.dlTimingLine], ['commands', 'json', H.dlCommands, H.dlCommandsLine]] as const).map(([what, fmt, l, line]) => (
        <div key={what} className="ctl">
          <button className="btn small text" onClick={() => exportFile(what, fmt)}>{l}</button>
          <div className="hint">{line}</div>
        </div>
      ))}
    </>
  )
}

/**
 * Single-player games in the facilitator's console (section 10.8): the switch, how many there
 * are, the newest ones, and their cleanup. Nobody watches or helps in such a game, so there is
 * no way into one from here.
 */
function SoloPanel({ token, solo, reload }: { token: string; solo: SoloOverview; reload: () => void }) {
  const [showList, setShowList] = useState(false)
  const [deleting, setDeleting] = useState<SoloSummary | null>(null)
  const [all, setAll] = useState(false)
  const [typed, setTyped] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const act = async (path: string, body: unknown, method?: string) => {
    if (busy) return false
    setBusy(true)
    setErr(null)
    const r = await hostFetch<unknown>(token, path, body, method)
    setBusy(false)
    if (!r.ok) { setErr(plainError(r.error)); return false }
    reload()
    return true
  }
  const state = (s: SoloSummary) => (s.closed ? H.soloFinished : s.live ? H.soloPlayedNow : H.soloPaused)
  return (
    <section className="panel">
      <div className="panel-head sun">{H.solo}</div>
      <div className="panel-body">
        <div className="solohead">
          <div className="modes" role="radiogroup" aria-label={H.soloSwitch}>
            {[true, false].map((on) => (
              <button key={String(on)} type="button" role="radio" aria-checked={solo.enabled === on} className={solo.enabled === on ? 'on' : ''} disabled={busy}
                onClick={() => { if (solo.enabled !== on) void act('/api/host/solo', { enabled: on }) }}>{on ? H.soloOn : H.soloOff}</button>
            ))}
          </div>
          <div className="hint">{H.soloLine}</div>
        </div>
        <div style={{ fontWeight: 700 }}>{H.soloCounts(solo.total, solo.finished, solo.unfinished, solo.live, solo.cap)}</div>
        {err && !deleting && !all && <div className="err" role="alert">{err}</div>}
        {solo.total > 0 && (
          <div className="sbtns" style={{ justifyContent: 'flex-start' }}>
            <button type="button" className="btn small text" aria-expanded={showList} onClick={() => setShowList(!showList)}>{showList ? H.soloHideList : H.soloShowList(solo.recent.length)}</button>
            <button type="button" className="btn small text danger" onClick={() => { setTyped(''); setErr(null); setAll(true) }}>{H.soloDeleteAll}</button>
          </div>
        )}
        {showList && (
          <div>
            {solo.recent.map((s) => (
              <div key={s.code} className="srow">
                <span className="codebox" style={{ fontSize: 16 }}>{s.code}</span>
                <span className="sinfo">
                  <b>{s.name}</b>
                  <span className="muted">{startedText(s.createdAt)} · {state(s)}</span>
                </span>
                <button className="btn small text danger" onClick={() => { setErr(null); setDeleting(s) }}>{H.delete}</button>
              </div>
            ))}
          </div>
        )}
      </div>
      {deleting && (
        <Sheet title={H.soloDeleteTitle} head="sun" onClose={() => setDeleting(null)}>
          <p>{H.soloDeleteText(deleting.name, startedText(deleting.createdAt), deleting.live && !deleting.closed)}</p>
          {err && <div className="err" role="alert">{err}</div>}
          <div className="sheet-actions">
            <button className="btn danger" disabled={busy} onClick={async () => { if (await act(`/api/host/session/${deleting.code}`, undefined, 'DELETE')) setDeleting(null) }}>{H.deleteNow}</button>
            <button className="btn" onClick={() => setDeleting(null)}>{H.cancel}</button>
          </div>
        </Sheet>
      )}
      {all && (
        <Sheet title={H.soloDeleteAllTitle} head="sun" onClose={() => setAll(false)}>
          <p>{H.soloDeleteAllText(solo.total, solo.live)}</p>
          <label className="lbl" htmlFor="solo-all">{H.soloDeleteAllType}</label>
          <input id="solo-all" className="field code" autoComplete="off" spellCheck={false} value={typed} onChange={(e) => { setTyped(e.target.value); setErr(null) }} aria-describedby="solo-all-err" />
          {err && <div id="solo-all-err" className="err" role="alert">{err}</div>}
          <div className="sheet-actions">
            <button className="btn danger" disabled={busy || typed !== 'DELETE'} onClick={async () => { if (await act('/api/host/solo/delete-all', { confirm: typed })) { setAll(false); setShowList(false) } }}>{H.deleteNow}</button>
            <button className="btn" onClick={() => setAll(false)}>{H.cancel}</button>
          </div>
        </Sheet>
      )}
    </section>
  )
}

/** The date and the time, as the name a new session starts with. */
const defaultLabel = () => new Date().toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

function Sessions({ token, open, signOut, manual }: { token: string; open: (code: string) => void; signOut: () => void; manual: () => void }) {
  const [list, setList] = useState<Summary[]>([])
  const [pack, setPack] = useState<PackInfo | null>(null)
  const [guideErr, setGuideErr] = useState<string | null>(null)
  const [solo, setSolo] = useState<SoloOverview | null>(null)
  const [label, setLabel] = useState(defaultLabel)
  // The session that runs, when a new one was refused because of it, with what the facilitator asked for.
  const [running, setRunning] = useState<{ it: SessionRunning; body: Record<string, unknown> } | null>(null)
  const [runTyped, setRunTyped] = useState('')
  const [runErr, setRunErr] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<Summary | null>(null)
  const [newName, setNewName] = useState('')
  const [renameErr, setRenameErr] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('rehearsal')
  const [code, setCode] = useState('')
  const [err, setErr] = useState<{ field: 'label' | 'code' | 'form'; text: string } | null>(null)
  const [showClosed, setShowClosed] = useState(false)
  const [deleting, setDeleting] = useState<Summary | null>(null)
  const [delErr, setDelErr] = useState<string | null>(null)
  const [ending, setEnding] = useState<Summary | null>(null)
  const [endErr, setEndErr] = useState<string | null>(null)
  const [endBusy, setEndBusy] = useState(false)
  const [dlErr, setDlErr] = useState<Record<string, string>>({})
  const load = useCallback(async () => {
    const r = await hostFetch<{ sessions: Summary[]; pack: PackInfo; solo: SoloOverview }>(token, '/api/host/sessions')
    if (!r.ok) { if (r.status === 401) signOut(); return }
    setList(r.data.sessions)
    setPack(r.data.pack)
    setSolo(r.data.solo)
  }, [token, signOut])
  // A new session: refused while another runs, with what runs, so that the facilitator decides.
  const create = async (body: Record<string, unknown>): Promise<{ field: 'code' | 'form'; text: string } | null> => {
    const res = await fetch('/api/host/session', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null)
    const data = ((await res?.json().catch(() => ({}))) ?? {}) as { code?: string; error?: string; running?: SessionRunning }
    if (res?.ok && data.code) { open(data.code); return null }
    if (data.error === 'session_running' && data.running) {
      setRunTyped('')
      setRunning({ it: data.running, body })
      return null
    }
    const error = res ? data.error ?? 'internal' : 'network'
    return { field: error === 'code_invalid' || error === 'code_taken' ? 'code' : 'form', text: plainError(error) }
  }
  useEffect(() => { void load() }, [load])
  useEffect(() => { if (pack?.provisional && mode === 'event') setMode('rehearsal') }, [pack, mode])

  const codeBad = code.trim() !== '' && !CODE_RULE.test(code.trim())
  const openList = list.filter((s) => !s.closed)
  const closedList = list.filter((s) => s.closed)
  // Ending a session from this list, and deleting it in the same step if the host asks for that.
  const endSession = async (s: Summary, remove: boolean) => {
    if (endBusy) return
    setEndBusy(true)
    setEndErr(null)
    const ended = await hostFetch<{ ok: true }>(token, `/api/host/session/${s.code}/end`, { name: store.host()?.name ?? '' })
    // A session that ended in the meantime is where the host wants it: go on to the delete.
    if (!ended.ok && !(remove && ended.error === 'wrong_stage')) { setEndBusy(false); setEndErr(plainError(ended.error)); void load(); return }
    if (remove) {
      const gone = await hostFetch<{ ok: true }>(token, `/api/host/session/${s.code}`, undefined, 'DELETE')
      if (!gone.ok) { setEndBusy(false); setEndErr(plainError(gone.error)); void load(); return }
    } else setShowClosed(true)
    setEndBusy(false)
    setEnding(null)
    void load()
  }
  const startRename = (s: Summary) => { setRenameErr(null); setNewName(s.label); setRenaming(s) }
  const phases = pack ? (['planning', 'development', 'maintaining'] as const).filter((p) => pack.phasesAvailable[p]).map((p) => `Phase ${PHASE_NUMBER[p]}`) : []
  const row = (s: Summary) => (
    <div key={s.code} className="srow">
      <span className="codebox" style={{ fontSize: 20 }} title={H.sessionCode}>{s.code}</span>
      <span className="sinfo">
        <b>{s.label}</b>
        <span className="muted">{H.mode[s.mode]} · {s.closed ? H.closedWord : STAGE_TITLE[s.stage]} · {players(s.players)} · {H.openedBy(s.createdBy, startedText(s.createdAt))}</span>
        {s.broken && <span className="err">{s.broken}</span>}
        {s.closed && (
          <span className="sdl">
            <Downloads token={token} code={s.code} onError={(t) => setDlErr((m) => ({ ...m, [s.code]: t ?? '' }))} />
            {dlErr[s.code] && <span className="err">{dlErr[s.code]}</span>}
          </span>
        )}
      </span>
      {!s.closed && (
        <span className="sbtns">
          <button className="btn small" onClick={() => open(s.code)}>{H.open}</button>
          <button className="btn small text" disabled={s.stage !== 'lobby'} title={s.stage !== 'lobby' ? H.renameWhy : undefined} onClick={() => startRename(s)}>{H.rename}</button>
          <button className="btn small text danger" onClick={() => { setEndErr(null); setEnding(s) }}>{H.end}</button>
        </span>
      )}
      {s.closed && (
        <span className="sbtns">
          {!s.broken && <button className="btn small text" onClick={() => startRename(s)}>{H.rename}</button>}
          <button className="btn small text danger" onClick={() => { setDelErr(null); setDeleting(s) }}>{H.delete}</button>
        </span>
      )}
    </div>
  )

  return (
    <main className="host-first">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <h1>{H.title}</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          {pack?.guide && <button className="btn small text" onClick={() => void openPrivatePage(token, 'guide').then(setGuideErr)} title={H.guideLine}>{H.guide}</button>}
          <button className="btn small text" onClick={manual}>{H.manual}</button>
          <button className="btn small text" onClick={signOut}>{H.signOut}</button>
        </div>
      </div>
      {guideErr && <div className="err" role="alert">{guideErr}</div>}
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
        const body: Record<string, unknown> = { label: label.trim(), mode, by: store.host()?.name ?? '' }
        if (code.trim()) body.code = code.trim().toUpperCase()
        setErr(await create(body))
      }}>
        <div className="panel-head">{H.newSession}</div>
        <div className="panel-body newsess">
          <div className="fieldbox">
            <label className="lbl" htmlFor="label">{H.sessionName}</label>
            <input id="label" className="field" value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} placeholder={H.sessionNameExample} aria-describedby="label-hint label-err" />
            <div id="label-hint" className="hint">{H.sessionNameHint}</div>
            {err?.field === 'label' && <div id="label-err" className="err" role="alert">{err.text}</div>}
          </div>
          <div className="fieldbox">
            <span className="lbl" id="mode-l">{H.modeLabel}</span>
            <ModeControl mode={mode} setMode={setMode} provisional={!!pack?.provisional} />
            <div className="hint">{H.modeLine[mode]}{(pack?.systems.length ?? 2) > 1 ? ` ${(pack?.pickModes ?? []).includes(mode) ? H.pickYes : H.pickNo}` : ''}</div>
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
          {openList.length > 1 && <div className="snote" role="status">{H.severalOpen(openList.length, openList[0]!.label, openList[0]!.code)}</div>}
          {openList.map(row)}
          {closedList.length > 0 && (
            <button type="button" className="linkbtn" style={{ alignSelf: 'flex-start', marginTop: 10 }} aria-expanded={showClosed} onClick={() => setShowClosed(!showClosed)}>
              {showClosed ? H.hideClosed : H.showClosed(closedList.length)}
            </button>
          )}
          {showClosed && closedList.map(row)}
        </div>
      </section>
      {solo && <SoloPanel token={token} solo={solo} reload={() => void load()} />}
      {running && (
        <Sheet title={H.runningTitle} head="sun" onClose={() => setRunning(null)}>
          <p>{H.runningText(running.it.label, running.it.code, running.it.createdBy, startedText(running.it.createdAt), STAGE_TITLE[running.it.stage], running.it.players)}</p>
          <p style={{ fontWeight: 800 }}>{H.runningWarn}</p>
          {running.it.needsCode && (
            <>
              <label className="lbl" htmlFor="run-code">{H.runningCode(running.it.code)}</label>
              <input id="run-code" className="field code" autoComplete="off" spellCheck={false} maxLength={8} value={runTyped} onChange={(e) => { setRunTyped(e.target.value); setRunErr(null) }} aria-describedby="run-err" />
            </>
          )}
          {runErr && <div id="run-err" className="err" role="alert">{runErr}</div>}
          <div className="sheet-actions">
            <button className="btn danger" disabled={running.it.needsCode && runTyped.trim().toUpperCase() !== running.it.code} onClick={async () => {
              const was = running
              setRunErr(null)
              setRunning(null)
              const e = await create({ ...was.body, replace: { code: was.it.code, ...(was.it.needsCode ? { confirm: runTyped.trim() } : {}) } })
              if (e) { setRunning(was); setRunErr(e.text) }
              void load()
            }}>{H.runningGo}</button>
            <button className="btn" autoFocus onClick={() => setRunning(null)}>{H.cancel}</button>
          </div>
        </Sheet>
      )}
      {renaming && (
        <Sheet title={H.renameSession(renaming.code)} head="sun" onClose={() => setRenaming(null)}>
          <label className="lbl" htmlFor="rename">{H.sessionName}</label>
          <input id="rename" className="field" value={newName} maxLength={80} onChange={(e) => { setNewName(e.target.value); setRenameErr(null) }} aria-describedby="rename-hint rename-err" />
          <div id="rename-hint" className="hint">{H.renameLine}</div>
          {renameErr && <div id="rename-err" className="err" role="alert">{renameErr}</div>}
          <div className="sheet-actions">
            <button className="btn go" disabled={!newName.trim() || newName.trim() === renaming.label} onClick={async () => {
              const r = await hostFetch<{ ok: true }>(token, `/api/host/session/${renaming.code}`, { label: newName.trim() }, 'PATCH')
              if (!r.ok) { setRenameErr(plainError(r.error)); void load(); return }
              setRenaming(null)
              void load()
            }}>{H.renameNow}</button>
            <button className="btn" onClick={() => setRenaming(null)}>{H.cancel}</button>
          </div>
        </Sheet>
      )}
      {deleting && (
        <Sheet title={H.deleteTitle(deleting.code)} head="sun" onClose={() => setDeleting(null)}>
          <p>{H.deleteText(deleting.label, deleting.results)}</p>
          {delErr && <div className="err" role="alert">{delErr}</div>}
          <div className="sheet-actions">
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
      {ending && (
        <Sheet title={H.endTitle(ending.code)} head="sun" onClose={() => setEnding(null)}>
          {ending.mode === 'event' ? (
            <>
              <p>{H.endEventWhy(ending.label)}</p>
              <div className="sheet-actions">
                <button className="btn" autoFocus onClick={() => { setEnding(null); open(ending.code) }}>{H.openConsole}</button>
                <button className="btn" onClick={() => setEnding(null)}>{H.cancel}</button>
              </div>
            </>
          ) : (
            <>
              <p>{H.endFromList(ending.label, STAGE_TITLE[ending.stage], ending.players)}</p>
              <p className="hint">{H.endOrDelete}</p>
              {endErr && <div className="err" role="alert">{endErr}</div>}
              <div className="sheet-actions">
                <button className="btn danger" disabled={endBusy} onClick={() => void endSession(ending, false)}>{H.endKeep}</button>
                <button className="btn danger" disabled={endBusy} onClick={() => void endSession(ending, true)}>{H.endDelete}</button>
                <button className="btn" onClick={() => setEnding(null)}>{H.cancel}</button>
              </div>
            </>
          )}
        </Sheet>
      )}
    </main>
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
    { id: 'auto', label: H.follow, line: sc.rotates ? H.followRotates : H.followLine, off: null },
    { id: 'lobby', label: H.lobby, line: H.lobbyLine, off: null },
    { id: 'play', label: H.leaderboard, line: hv.session.systems.length > 1 ? H.leaderboardLine : H.leaderboardLineOne, off: sc.available.play ? null : H.leaderboardOff },
    { id: 'feed', label: H.activity, line: H.activityLine, off: playing ? null : H.activityOff },
    { id: 'slides', label: H.slides, line: H.slidesLine, off: sc.available.slides ? null : H.slidesOff, onClick: showSlides },
    { id: 'winners', label: H.winners, line: H.winnersLine, off: sc.available.winners ? null : H.winnersOff },
  ]
  // Shared slides that run ahead of the game: the host in charge is asked first, because a
  // later section may show answers (section 10.8). Nobody is asked while no one can see the slides.
  const sectionAt = (i: number) => deck.sections.find((x) => i >= x.start && i < x.start + x.count)
  const roomSees = sc.shown === 'slides' && (sc.screens > 0 || sc.mirror)
  const slideTo = (index: number, at = 'slides') => {
    const to = Math.max(0, Math.min(deck.count - 1, index))
    if (to === sc.slide) return
    const from = sectionAt(sc.slide)
    const target = sectionAt(to)
    // A section is due from the stage before its own: the welcome in the lobby, a recap at the reveal.
    const later = !!target && STAGES.indexOf(target.stage) > STAGES.indexOf(hv.stage) + 1
    if (roomSees && target && later && target.id !== from?.id) {
      ask({ title: H.aheadTitle, text: H.ahead(target.title, STAGE_TITLE[hv.stage]), options: [{ label: H.aheadGo, tone: 'danger', run: () => void cmd('slide_to', { index: to }, at) }] })
      return
    }
    void cmd('slide_to', { index: to }, at)
  }
  // The look through the deck: a cursor of this tab only (section 10.8). Null means it follows the
  // shown slide. Once the shown slide reaches it, it follows again.
  const [look, setLook] = useState<number | null>(null)
  const at = look === null ? sc.slide : Math.max(0, Math.min(deck.count - 1, look))
  const lookTo = (i: number) => { const to = Math.max(0, Math.min(deck.count - 1, i)); setLook(to === sc.slide ? null : to) }
  useEffect(() => { setLook((l) => (l === sc.slide ? null : l)) }, [sc.slide])
  const slideRef = useRef(slideTo)
  slideRef.current = slideTo
  const lookRef = useRef(lookTo)
  lookRef.current = lookTo
  const atRef = useRef(at)
  atRef.current = at
  const pinned = sc.scene !== 'auto'
  const pinnedLabel = scenes.find((x) => x.id === sc.scene)?.label ?? H.spotlightScene
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

  // The left and right arrow keys, while no field has the focus: for the host in charge they move
  // the shown slide, with Shift only the look. For any other host they move the look.
  useEffect(() => {
    if (deck.count === 0) return
    const on = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
      if (e.altKey || e.ctrlKey || e.metaKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.closest('input, select, textarea, [contenteditable]') || t.closest('[role="dialog"]'))) return
      const step = e.key === 'ArrowRight' ? 1 : -1
      e.preventDefault()
      if (canAct && !e.shiftKey) slideRef.current(sc.slide + step)
      else lookRef.current(atRef.current + step)
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [canAct, deck.count, sc.slide])

  return (
    <section className="panel">
      <div className="panel-head lav">{H.bigScreen}</div>
      <div className="panel-body bigscreen">
        {/* What needs control sits in two fieldsets. The look through the deck between them works
            for every host (section 10.8). */}
        <fieldset disabled={!canAct} className="ctlset pset">
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
          <div className="scenes">
            {scenes.map((x) => (
              <div key={x.id} className="scene">
                <button className={`btn small text${x.id === sc.scene ? ' picked' : ''}`} aria-pressed={x.id === sc.scene} disabled={!!x.off}
                  onClick={x.onClick ?? (() => cmd('screen_scene', { scene: x.id }, 'scene'))}>{x.label}</button>
                <div className="scenetext">
                  <div className={`hint${x.off ? ' bad' : ''}`}>
                    {x.off ?? x.line}
                    {x.id === sc.shown && x.id !== sc.scene && !sc.rotates && <span className="flag">{H.onNow}</span>}
                  </div>
                  {x.id === 'play' && !x.off && (
                    <select className="field slim" aria-label={H.leaderboardShows} value={sc.phase ? `phase:${sc.phase}` : sc.filter ? `sys:${sc.filter}` : ''}
                      onChange={(e) => {
                        const [kind, id] = e.target.value.split(':')
                        void cmd('screen_filter', { system: kind === 'sys' ? id! : null, phase: kind === 'phase' ? id! : null }, 'scene')
                      }}>
                      <option value="">{H.boardEveryone}</option>
                      {/* One health system: its ranking is the ranking of everyone, and a phase has one column. */}
                      {hv.session.systems.length > 1 && hv.session.systems.map((s) => <option key={s.id} value={`sys:${s.id}`}>{H.boardSystem(s.name)}</option>)}
                      {PHASES.filter((ph) => hv.phasesAvailable[ph]).map((ph) => <option key={ph} value={`phase:${ph}`}>{hv.session.systems.length > 1 ? H.boardPhase(PHASE_NUMBER[ph]) : H.boardPhaseOne(PHASE_NUMBER[ph])}</option>)}
                    </select>
                  )}
                </div>
              </div>
            ))}
            {sc.spotlight && (
              <div className="scene">
                <button className="btn small text" onClick={() => cmd('spotlight', { playerId: null }, 'scene')}>{H.endSpotlight}</button>
                <div className="scenetext"><div className="hint">{H.endSpotlightLine}</div></div>
              </div>
            )}
          </div>
          <Refusal text={refusals.scene} />
        </div>

        <div className="group">
          <div className="eyebrow">{H.slidesGroup}</div>
          {deck.count === 0 ? <div className="hint">{H.noSlides}</div> : (
            <>
              <div className="slidenav">
                <button className="btn small" onClick={() => slideTo(sc.slide - 1)} disabled={sc.slide <= 0}>{H.prev}</button>
                <span className="num slidecount">{H.slideOf(sc.slide + 1, deck.count)}</span>
                <button className="btn small" onClick={() => slideTo(sc.slide + 1)} disabled={sc.slide >= deck.count - 1}>{H.next}</button>
              </div>
              {section && <div className="sectitle">{section.title}</div>}
              {canAct && <div className="hint">{H.keysLine}</div>}
              <label className="lbl" htmlFor="jump">{H.jump}</label>
              <select id="jump" className="field slim" value={section?.id ?? ''}
                onChange={(e) => { const sec = deck.sections.find((s) => s.id === e.target.value); if (sec) slideTo(sec.start) }}>
                {deck.sections.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
              </select>
              <div className="ctl">
                <label className={`check${mirrorOff ? ' off' : ''}`}>
                  <input type="checkbox" checked={sc.mirror} disabled={!!mirrorOff && !sc.mirror} onChange={(e) => cmd('screen_mirror', { mirror: e.target.checked }, 'slides')} />
                  <span>{H.mirrorToggle}</span>
                </label>
                {mirrorOff && <div className="hint">{mirrorOff}</div>}
              </div>
            </>
          )}
          <Refusal text={refusals.slides} />
        </div>
        </div>
        </fieldset>

        {deck.count > 0 && (
          <SlideLook token={token} code={code} joinUrl={hv.session.joinUrl} deck={deck} shown={sc.slide} at={at} lookTo={lookTo}
            show={() => slideTo(at, 'look')} canAct={canAct} stage={hv.stage} theme={sc.theme} onSlides={sc.shown === 'slides'} refusal={refusals.look} />
        )}

        <fieldset disabled={!canAct} className="ctlset pset">
        <div className="group apart">
          <div className="eyebrow">{H.projectorTheme}</div>
          <div className="seg" role="group" aria-label={H.projectorTheme}>
            <button aria-pressed={sc.theme === 'light'} onClick={() => cmd('screen_theme', { theme: 'light' }, 'theme')}>{H.day}</button>
            <button aria-pressed={sc.theme === 'dark'} onClick={() => cmd('screen_theme', { theme: 'dark' }, 'theme')}>{H.night}</button>
          </div>
          <div className="hint">{H.themeLine}</div>
          <Refusal text={refusals.theme} />
        </div>
        </fieldset>
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
  const [spect, setSpect] = useState<{ id: string; view: HostInspect | null } | null>(null)
  const [rename, setRename] = useState<{ id: string; name: string; err?: string } | null>(null)
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null)
  const [askSheet, setAskSheet] = useState<Ask | null>(null)
  const [takeOpen, setTakeOpen] = useState(false)
  const [takePass, setTakePass] = useState('')
  const [takeErr, setTakeErr] = useState<string | null>(null)
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
      const s = m as unknown as { playerId: string; view: HostInspect | null }
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
  const take = () => { if (ctl.state === 'free') void cmd('take_control', {}, 'take'); else { setTakePass(''); setTakeErr(null); setTakeOpen(true) } }
  const look = (id: string) => { setSpect({ id, view: null }); void cmd('spectate', { playerId: id }, `row:${id}`) }
  const openKey = async () => ref.set('key', await openPrivatePage(token, 'key'))
  const openGuide = async () => ref.set('guide', await openPrivatePage(token, 'guide'))

  return (
    <div className={`hostwrap${manualOpen ? ' with-manual' : ''}`}>
      <div className="hostmain">
        <header className="topbar sessbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
            <button className="iconbtn" onClick={back} aria-label={H.allSessions}>←</button>
            <span style={{ fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hv.session.label}</span>
            <span className="codebox" title={H.sessionCode}>{hv.session.code}</span>
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
            <span className={`chip state ${ctl.you ? 'good' : 'watch'}`} data-charge={ctl.you ? 'you' : ctl.state}>
              {ctl.you ? H.youControl : ctl.state === 'held' ? H.inCharge(ctl.holder ?? '') : ctl.state === 'reconnecting' ? H.reconnectingChip(ctl.holder) : H.nobodyChip}
            </span>
            {!ctl.you && <button className="btn small sun takebtn" onClick={take}>{H.takeControl}</button>}
            {hv.guide && <button className="btn small text" onClick={() => void openGuide()} title={H.guideLine}>{H.guide}</button>}
            <button className="btn small text" onClick={() => setManualOpen(!manualOpen)} aria-expanded={manualOpen}>{H.manual}</button>
          </div>
          <Refusal text={ref.map.guide} />
        </header>
        {!ctl.you && (
          <div className="viewonly" role="status">
            <span>{ctl.state === 'held' ? H.controlledFrom(ctl.holder ?? '') : ctl.state === 'reconnecting' ? H.reconnecting : H.nobody}</span>
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
              {!hv.closed && <div className="stagectl">
                <div className="ctl">
                  <button className="btn go" onClick={() => cmd('next')} disabled={hv.timed || !hv.next}>
                    {hv.timed ? H.endsByItself : hv.next ? H.nextStage(STAGE_TITLE[hv.next]) : H.done}
                  </button>
                  <div className="hint">{H.stageLines.next}</div>
                </div>
                <div className="ctl">
                  {hv.clock.running
                    ? <button className="btn" onClick={() => cmd('pause')}>{H.pause}</button>
                    : <button className="btn sun" onClick={() => cmd('resume')}>{H.resume}</button>}
                  <div className="hint">{H.stageLines.pause}</div>
                </div>
                <div className="ctl">
                  <div className="ctl-row">
                    <button className="btn" onClick={() => cmd('extend', { seconds: 30 })} disabled={!hv.timed}>+30 s</button>
                    <button className="btn" onClick={() => cmd('extend', { seconds: 60 })} disabled={!hv.timed}>+60 s</button>
                    <button className="btn" onClick={() => cmd('extend', { seconds: 300 })} disabled={!hv.timed}>+5 min</button>
                  </div>
                  <div className="hint">{H.stageLines.extend}</div>
                </div>
                <div className="ctl">
                  <button className="btn danger" onClick={() => cmd('end_now')} disabled={!hv.timed}>{H.endNow}</button>
                  <div className="hint">{H.stageLines.endNow}</div>
                </div>
              </div>}
              <Refusal text={ref.map.stage} />
            </section>
          </fieldset>

          {/* The programme: bars in proportion to the minutes, and under them every part by name.
              A two-minute part has no room for its name under its own bar, so the names wrap as a list. */}
          <div className="prog">
            <div className="prog-bars" aria-hidden="true">
              {hv.schedule.segments.map((s) => <div key={s.segment} className={`prog-bar ${s.state}`} style={{ flex: s.end - s.start }} />)}
            </div>
            <div className="prog-names">
              {hv.schedule.segments.map((s) => <span key={s.segment} className={`prog-name ${s.state}`}><i aria-hidden="true" />{s.label} · {s.start}′</span>)}
            </div>
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
                    {/* The filter by health system, when there is more than one. */}
                    {systems.length > 1 && systems.map((s) => {
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
                            <button type="button" className="pname plook" title={H.lookAt(p.name)} onClick={() => look(p.id)}>{p.name}</button>
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
                          { label: H.spectate, run: () => look(p.id) },
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
              <Projector hv={hv} clock={clock} cmd={cmd} refusals={ref.map} ask={setAskSheet} token={token} code={code} canAct={ctl.you} />
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
                    {!hv.closed && <button className="btn small text danger" onClick={() => openConfirm('close')}>{H.endSessionButton}</button>}
                  </div>
                </section>
              </fieldset>
              <section className="panel">
                <div className="panel-head sun">{H.answerKey}</div>
                <div className="panel-body">
                  <div className="hint">{H.answerKeyLine}</div>
                  <button className="btn small text" disabled={!hv.answerKey} onClick={() => void openKey()}>{hv.answerKey ? H.openKey : H.noKey}</button>
                  <Refusal text={ref.map.key} />
                </div>
              </section>
              <section className="panel">
                <div className="panel-head">{H.downloads}</div>
                <div className="panel-body">
                  <Downloads token={token} code={code} onError={(x) => ref.set('downloads', x)} />
                  <Refusal text={ref.map.downloads} />
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
          <div className="sheet-actions">
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
          <div className="sheet-actions">
            <button className="btn go" onClick={async () => {
              const r = await cmd('rename_player', { playerId: rename.id, name: rename.name }, 'rename')
              if (r?.ok) setRename(null)
              else setRename({ ...rename, err: plainError(r?.error) })
            }}>{H.rename}</button>
            <button className="btn" onClick={() => setRename(null)}>{H.cancel}</button>
          </div>
        </Sheet>
      )}
      {spect && (
        <Sheet title={spect.view ? H.lookAt(spect.view.name) : H.spectate} head="sky" wide className="inspect-sheet" onClose={() => { setSpect(null); void cmd('spectate', { playerId: null }, 'spect') }}>
          {spect.view ? <Inspector view={spect.view} systems={systems} /> : <div className="muted">{H.loading}</div>}
          <Refusal text={ref.map.spect} />
          <div className="sheet-actions">
            <button className="btn" disabled={!ctl.you} onClick={async () => { const r = await cmd('spotlight', { playerId: spect.id }, 'spect'); if (r?.ok) say(H.spotlightOn) }}>{H.showOnScreen}</button>
            <button className="btn" onClick={() => { setSpect(null); void cmd('spectate', { playerId: null }, 'spect') }}>{H.close}</button>
          </div>
        </Sheet>
      )}
      {removing && (
        <Sheet title={H.removeTitle} onClose={() => setRemoving(null)}>
          <p>{H.removeText(removing.name)}</p>
          <Refusal text={ref.map.remove} />
          <div className="sheet-actions">
            <button className="btn danger" onClick={async () => { const r = await cmd('remove_player', { playerId: removing.id }, 'remove'); if (r?.ok) setRemoving(null) }}>{H.remove}</button>
            <button className="btn" onClick={() => setRemoving(null)}>{H.cancel}</button>
          </div>
        </Sheet>
      )}
      {askSheet && (
        <Sheet title={askSheet.title} head="sun" onClose={() => setAskSheet(null)}>
          <p>{askSheet.text}</p>
          <div className="sheet-actions">
            {askSheet.options.map((o) => <button key={o.label} className={`btn${o.tone ? ` ${o.tone}` : ''}`} onClick={() => { setAskSheet(null); o.run() }}>{o.label}</button>)}
            <button className="btn" onClick={() => setAskSheet(null)}>{H.cancel}</button>
          </div>
        </Sheet>
      )}
      {takeOpen && (
        <Sheet title={H.takeTitle(ctl.holder)} head="sun" onClose={() => setTakeOpen(false)}>
          <form style={{ display: 'contents' }} onSubmit={async (e) => {
            e.preventDefault()
            const r = await cmd('take_control', { passcode: takePass }, 'take')
            if (r?.ok) setTakeOpen(false)
            else setTakeErr(plainError(r?.error))
          }}>
            <p>{H.takeText(ctl.holder)}</p>
            <label className="lbl" htmlFor="take-pass">{H.takePass}</label>
            <input id="take-pass" className="field" type="password" autoComplete="current-password" value={takePass} onChange={(e) => { setTakePass(e.target.value); setTakeErr(null) }} autoFocus />
            {takeErr && <div className="err" role="alert">{takeErr}</div>}
            <div className="sheet-actions">
              <button type="submit" className="btn go" disabled={!takePass}>{H.takeControl}</button>
              <button type="button" className="btn" onClick={() => setTakeOpen(false)}>{H.cancel}</button>
            </div>
          </form>
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
