// The player's screens: top bar, lobby, the stages of the foundation, standings and menu
// (engineering spec, sections 10.1, 10.2, 10.7).
import { useEffect, useState } from 'react'
import { COLUMNS, phaseOfStage, type PhaseId, type SystemRef, type Welcome } from '@lab02/protocol'
import { COPY, PHASE_NUMBER, STAGE_TITLE } from '../copy.ts'
import { usePlayer, forgetPlayer } from '../lib/player.ts'
import { store } from '../lib/storage.ts'
import { setTheme, useTheme } from '../lib/theme.ts'
import { Room } from '../scene/Room.tsx'
import { Avatar, BoardRows, COLUMN_TITLE, Countdown, Portrait, Sheet, SystemShape, columnTag } from '../components/ui.tsx'
import { TownStrip } from './Join.tsx'

function useWakeLock() {
  useEffect(() => {
    let lock: { release(): Promise<void> } | null = null
    const nav = navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }
    const get = () => {
      if (document.visibilityState === 'visible' && nav.wakeLock) nav.wakeLock.request('screen').then((l) => { lock = l }).catch(() => {})
    }
    get()
    document.addEventListener('visibilitychange', get)
    return () => { document.removeEventListener('visibilitychange', get); void lock?.release().catch(() => {}) }
  }, [])
}

function useNarrow(px = 768): boolean {
  const [narrow, setNarrow] = useState(() => window.innerWidth < px)
  useEffect(() => {
    const on = () => setNarrow(window.innerWidth < px)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [px])
  return narrow
}

// ------------------------------------------------------------------------------------------
// Top bar, menu, standings
// ------------------------------------------------------------------------------------------
function TopBar({ w, onMenu, onStandings }: { w: Welcome; onMenu: () => void; onStandings: () => void }) {
  const view = usePlayer((s) => s.view)!
  const clock = usePlayer((s) => s.clock)
  const status = usePlayer((s) => s.status)
  const standing = usePlayer((s) => s.standing)
  const narrow = useNarrow()
  const sys = w.session.systems.find((s) => s.id === view.me.system)
  const phase = phaseOfStage(view.stage)
  const title = phase ? `Phase ${PHASE_NUMBER[phase]} · ${w.session.phaseLabels[phase]}` : STAGE_TITLE[view.stage]
  const rank = standing?.ranks.phase ?? standing?.ranks.overall
  const timed = clock?.clock.stageEndsAtMs !== null && clock?.clock.stageEndsAtMs !== undefined
  return (
    <header className="topbar" style={narrow ? { gridTemplateColumns: 'minmax(0,1fr) auto', padding: '6px 10px' } : undefined}>
      <div className="who">
        <Avatar id={view.me.avatar} size={32} />
        {!narrow && <span className="name">{view.me.name}</span>}
        {sys && <span className="sysbadge"><SystemShape index={sys.index} size={10} />{narrow ? '' : sys.name}</span>}
        {narrow && <span className="phase" style={{ fontSize: 20 }}>{title}</span>}
      </div>
      {!narrow && (
        <div className="mid">
          <span className="phase">{title}</span>
          {timed && <Countdown clock={clock} />}
        </div>
      )}
      <div className="right">
        {narrow && timed && <Countdown clock={clock} />}
        <span className={`dot ${status === 'open' ? 'on' : 'off'}`} title={status === 'open' ? 'Connected' : COPY.reconnecting} aria-label={status === 'open' ? 'Connected' : COPY.reconnecting} />
        <button className="iconbtn" onClick={onStandings} aria-label={COPY.standings}>{rank ? `#${rank}` : '#–'}</button>
        <button className="iconbtn" onClick={onMenu} aria-label={COPY.menu}>☰</button>
      </div>
    </header>
  )
}

function MenuSheet({ w, onClose }: { w: Welcome; onClose: () => void }) {
  const view = usePlayer((s) => s.view)!
  const theme = useTheme()
  const [open, setOpen] = useState<number | null>(null)
  return (
    <Sheet title={COPY.menu} onClose={onClose} head="lav">
      <div className="eyebrow">{COPY.rejoinCode}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span className="codebox" style={{ fontSize: 36 }}>{view.me.rejoinCode}</span>
        <span className="hint" style={{ maxWidth: 260 }}>{COPY.keepCode}</span>
      </div>
      <div className="eyebrow">{COPY.theme}</div>
      <div className="seg" role="group" aria-label={COPY.theme}>
        <button aria-pressed={theme === 'light'} onClick={() => setTheme('light')}>{COPY.light}</button>
        <button aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}>{COPY.dark}</button>
      </div>
      <div className="eyebrow">{COPY.howToPlay}</div>
      <HowToPlay compact />
      <div className="eyebrow">{COPY.ladder}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {[...w.ladder].reverse().map((r) => (
          <div key={r.rung} style={{ border: '2px solid var(--line)' }}>
            <button onClick={() => setOpen(open === r.rung ? null : r.rung)} aria-expanded={open === r.rung}
              style={{ width: '100%', minHeight: 44, display: 'flex', alignItems: 'center', gap: 10, padding: '4px 10px', background: 'var(--inset)', border: 0, cursor: 'pointer', textAlign: 'left' }}>
              <span className="num" style={{ fontSize: 24, width: 18 }}>{r.rung}</span>
              <span style={{ fontWeight: 800 }}>{r.label}</span>
            </button>
            {open === r.rung && (
              <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14 }}>
                <div>{r.fitsWhen}</div>
                <div className="muted">Example: {r.example}</div>
              </div>
            )}
          </div>
        ))}
      </div>
    </Sheet>
  )
}

function StandingsSheet({ w, onClose }: { w: Welcome; onClose: () => void }) {
  const st = usePlayer((s) => s.standing)
  const view = usePlayer((s) => s.view)!
  const sysName = w.session.systems.find((s) => s.id === view.me.system)?.name ?? ''
  if (!st) return <Sheet title={COPY.standings} onClose={onClose}>…</Sheet>
  const r = st.ranks
  const cell = (label: string, rank: number | null, of: number) => (
    <div style={{ flex: 1, minWidth: 110, border: '3px solid var(--line)', padding: '6px 10px', background: 'var(--inset)' }}>
      <div className="eyebrow">{label}</div>
      <div className="num" style={{ fontSize: 32 }}>{rank ? `#${rank}` : '–'} <span className="muted" style={{ fontSize: 18 }}>of {of}</span></div>
    </div>
  )
  return (
    <Sheet title={COPY.standings} onClose={onClose} wide>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {cell(COPY.rankOverall, r.overall, r.of)}
        {cell(`${COPY.rankSystem}`, r.system, r.ofSystem)}
        {cell(COPY.rankPhase, r.phase, r.of)}
      </div>
      <div className="hint">{sysName}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        {COLUMNS.map((c) => {
          const col = st.board.columns[c]
          return (
            <div key={c} className="panel" style={{ boxShadow: '3px 3px 0 var(--shade)' }}>
              <div className={`panel-head ${COLUMN_TITLE[c].head}`} style={{ fontSize: 20 }}>
                <span>{COLUMN_TITLE[c].title}</span>
                {columnTag(col) && <span className="chip" style={{ fontSize: 12, padding: '0 6px', background: '#fff', color: '#1d2140', borderColor: '#1d2140' }}>{columnTag(col)}</span>}
              </div>
              <div className="hint" style={{ padding: '4px 10px 0' }}>{col.state === 'empty' ? '' : col.label}</div>
              <BoardRows rows={col.rows} systems={w.session.systems} />
            </div>
          )
        })}
      </div>
      <SystemsStrip systems={w.session.systems} standings={st.board.systems} />
    </Sheet>
  )
}

export function SystemsStrip({ systems, standings, big = false }: { systems: SystemRef[]; standings: { id: string; rank: number; score: number }[]; big?: boolean }) {
  const max = Math.max(1, ...standings.map((s) => s.score))
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${big ? 300 : 200}px, 1fr))`, gap: big ? 24 : 10 }}>
      {standings.map((s) => {
        const ref = systems.find((x) => x.id === s.id)
        return (
          <div key={s.id} className="panel" style={{ padding: big ? '8px 16px' : '6px 10px', gap: 6, borderWidth: big ? 4 : 3 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="num" style={{ fontSize: big ? 32 : 22 }}>{s.rank}</span>
              <SystemShape index={ref?.index ?? 0} size={big ? 20 : 14} />
              <span style={{ fontWeight: 700, fontSize: big ? 24 : 15, flexGrow: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ref?.name}</span>
              <span className="num" style={{ fontSize: big ? 32 : 22 }}>{Math.round(s.score)}</span>
            </div>
            <div style={{ height: big ? 14 : 10, background: 'var(--inset)', border: '2px solid var(--line)' }}>
              <div style={{ height: '100%', width: `${(100 * s.score) / max}%`, background: `var(--sys-${(ref?.index ?? 0) % 4})` }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ------------------------------------------------------------------------------------------
// Lobby
// ------------------------------------------------------------------------------------------
const STEP_COLORS = ['var(--sky)', 'var(--sun)', 'var(--lav)']

function HowToPlay({ compact = false }: { compact?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 8 : 12 }}>
      {COPY.steps.map((s, i) => (
        <div key={s.title} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <div className="face" style={{ width: 36, height: 36, flexShrink: 0, background: STEP_COLORS[i], color: 'var(--on)', border: '3px solid var(--line)', fontSize: 24, lineHeight: '30px', textAlign: 'center' }}>{i + 1}</div>
          <div><div style={{ fontWeight: 800, fontSize: 16 }}>{s.title}</div><div className="muted" style={{ fontSize: 14 }}>{s.text}</div></div>
        </div>
      ))}
      {!compact && <div style={{ padding: '8px 10px', background: 'var(--sun-bg)', border: '2px solid var(--line)', fontSize: 14, fontWeight: 700 }}>{COPY.eachPhase}</div>}
    </div>
  )
}

function SystemPanel({ w }: { w: Welcome }) {
  const sys = w.system
  return (
    <section className="panel">
      <div className="panel-head sky">{COPY.yourSystem}</div>
      <div className="panel-body">
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}><SystemShape index={sys.index} size={16} />{sys.name}</div>
          <div className="muted" style={{ fontSize: 14 }}>{sys.setting}</div>
        </div>
        <p style={{ fontSize: 15, lineHeight: 1.45 }}>{sys.premise}</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
          <div>
            <div className="eyebrow">{COPY.yourPractice}</div>
            {sys.practiceProfile.map((r) => <div key={r.label} className="kv"><span style={{ fontSize: 14 }}>{r.label}</span><span className="v">{r.value}</span></div>)}
          </div>
          <div>
            <div className="eyebrow">{COPY.whatYouKnow}</div>
            {sys.baseline.map((r) => <div key={r.label} className="kv"><span style={{ fontSize: 14 }}>{r.label}</span><span className="v">{r.value}{r.unit ? ` ${r.unit}` : ''}</span></div>)}
          </div>
        </div>
      </div>
    </section>
  )
}

function CastPanel({ w }: { w: Welcome }) {
  return (
    <section className="panel">
      <div className="panel-head sun">{COPY.people}</div>
      <div className="panel-body">
        {w.system.cast.map((c, i) => (
          <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Portrait c={c} art={w.art} index={i} systemIndex={w.system.index} />
            <div><div style={{ fontSize: 16, fontWeight: 800 }}>{c.name}</div><div className="muted" style={{ fontSize: 14 }}>{c.role}</div></div>
          </div>
        ))}
      </div>
    </section>
  )
}

function RoomPanel({ w, title }: { w: Welcome; title?: string }) {
  const view = usePlayer((s) => s.view)!
  const theme = useTheme()
  return (
    <section className="panel">
      <div className="panel-head lav">{title ?? 'Your practice'}</div>
      <Room art={w.art} cast={w.system.cast} me={{ avatar: view.me.avatar }} theme={theme} maxHeight={400} />
    </section>
  )
}

function Lobby({ w }: { w: Welcome }) {
  const view = usePlayer((s) => s.view)!
  const narrow = useNarrow(1024)
  return (
    <>
      <TownStrip height={narrow ? 120 : 160}>
        <div className="bubble" style={{ position: 'absolute', left: '50%', top: 14, transform: 'translateX(-50%)', width: 'min(320px, 86vw)' }}>
          <b>{COPY.you}:</b> {view.stage === 'intro' ? COPY.lookAtScreen : COPY.waitingHost}
        </div>
      </TownStrip>
      <main style={{ padding: 16, display: 'grid', gap: 18, gridTemplateColumns: narrow ? '1fr' : '330px minmax(0, 1fr) 320px', alignItems: 'start' }}>
        <section className="panel">
          <div className="panel-head">{COPY.howToPlay}</div>
          <div className="panel-body"><HowToPlay /></div>
        </section>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
          <SystemPanel w={w} />
          <RoomPanel w={w} />
        </div>
        <CastPanel w={w} />
      </main>
    </>
  )
}

// ------------------------------------------------------------------------------------------
// Stages that the foundation shows (each phase step replaces its own)
// ------------------------------------------------------------------------------------------
function PhaseStub({ w, phase }: { w: Welcome; phase: PhaseId }) {
  const clock = usePlayer((s) => s.clock)
  const label = w.session.phaseLabels[phase]
  return (
    <main style={{ padding: 16, display: 'grid', gap: 18, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))', alignItems: 'start' }}>
      <section className="panel">
        <div className="panel-head sky">{`Phase ${PHASE_NUMBER[phase]} · ${label}`}</div>
        <div className="panel-body" style={{ alignItems: 'flex-start' }}>
          <h2>{COPY.stubTitle(label)}</h2>
          <p className="muted">{COPY.stubText}</p>
          <Countdown clock={clock} big />
        </div>
      </section>
      <RoomPanel w={w} />
    </main>
  )
}

function Results({ w, phase, note }: { w: Welcome; phase: PhaseId | null; note: string }) {
  const view = usePlayer((s) => s.view)!
  const pts = phase ? view.points[phase] : null
  return (
    <main style={{ padding: 16, display: 'grid', gap: 18, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))', alignItems: 'start' }}>
      <section className="panel">
        <div className="panel-head sun">{phase ? COPY.results(`Phase ${PHASE_NUMBER[phase]}`) : STAGE_TITLE[view.stage]}</div>
        <div className="panel-body">
          {pts && (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
              <span className="num" style={{ fontSize: 64, lineHeight: 1 }}>{pts.points}</span>
              <span className="face" style={{ fontSize: 24 }}>{COPY.points}</span>
              <span className="chip sun" style={{ textTransform: 'capitalize' }}>{pts.band}</span>
              {pts.provisional && <span className="chip">{COPY.provisional}</span>}
            </div>
          )}
          <PointsTable />
          <p className="muted">{note}</p>
        </div>
      </section>
      <RoomPanel w={w} />
    </main>
  )
}

function PointsTable() {
  const view = usePlayer((s) => s.view)!
  const w = usePlayer((s) => s.welcome)!
  return (
    <div>
      {(['planning', 'development', 'maintaining'] as PhaseId[]).map((ph) => (
        <div key={ph} className="kv"><span>{`Phase ${PHASE_NUMBER[ph]} · ${w.session.phaseLabels[ph]}`}</span><span className="v">{view.points[ph]?.points ?? '–'}</span></div>
      ))}
      <div className="kv" style={{ borderBottom: 0 }}><span style={{ fontWeight: 800 }}>{COPY.total}</span><span className="v" style={{ fontSize: 24 }}>{view.points.total}</span></div>
    </div>
  )
}

function Winners() {
  const st = usePlayer((s) => s.standing)
  const view = usePlayer((s) => s.view)!
  return (
    <main style={{ padding: 16, maxWidth: 640, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
      <section className="panel">
        <div className="panel-head sun">{view.stage === 'closed' ? COPY.closed : COPY.finalTitle}</div>
        <div className="panel-body">
          <div className="num" style={{ fontSize: 48 }}>{st?.ranks.overall ? `#${st.ranks.overall}` : '–'} <span className="muted" style={{ fontSize: 24 }}>of {st?.ranks.of ?? '–'}</span></div>
          <PointsTable />
        </div>
      </section>
    </main>
  )
}

function StageBody({ w }: { w: Welcome }) {
  const view = usePlayer((s) => s.view)!
  const st = view.stage
  if (st === 'lobby' || st === 'intro') return <Lobby w={w} />
  if (st === 'winners' || st === 'closed') return <Winners />
  const phase = phaseOfStage(st)
  if (st.endsWith('.reveal')) return <Results w={w} phase={phase} note={COPY.lookAtScreen} />
  if (st.startsWith('break.')) return <Results w={w} phase={st.split('.')[1] as PhaseId} note={COPY.lookAtScreen} />
  if (st === 'reflection') return <Results w={w} phase={null} note={COPY.lookAtScreen} />
  return <PhaseStub w={w} phase={phase!} />
}

// ------------------------------------------------------------------------------------------
// The page
// ------------------------------------------------------------------------------------------
export function PlayPage({ go }: { go: (path: string) => void }) {
  const auth = store.player()
  const { status, welcome, view, start, stop } = usePlayer()
  const [menu, setMenu] = useState(false)
  const [standings, setStandings] = useState(false)
  const [codeSeen, setCodeSeen] = useState(() => (auth ? store.flag(`seen-code-${auth.playerId}`) : true))
  useWakeLock()

  useEffect(() => {
    if (!auth) { go('/'); return }
    start(auth.token)
    return () => stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!auth) return null
  const leave = (rejoin: boolean) => {
    forgetPlayer()
    stop()
    go(`/j/${auth.session}${rejoin ? '#rejoin' : ''}`)
  }

  if (status === 'unauthorized' || status === 'removed' || status === 'superseded') {
    const text = status === 'removed' ? COPY.removed : status === 'superseded' ? COPY.superseded : COPY.signedOut
    return (
      <Sheet title={STAGE_TITLE[view?.stage ?? 'lobby']}>
        <p style={{ fontSize: 16 }}>{text}</p>
        {status === 'superseded' && <button className="btn go" onClick={() => start(auth.token)}>{COPY.useHere}</button>}
        {status !== 'superseded' && <button className="btn go" onClick={() => leave(status === 'unauthorized')}>{status === 'removed' ? COPY.backToJoin : COPY.rejoin}</button>}
      </Sheet>
    )
  }
  if (!welcome || !view) return <div className="banner">{COPY.reconnecting}</div>

  return (
    <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
      <TopBar w={welcome} onMenu={() => setMenu(true)} onStandings={() => setStandings(true)} />
      {status !== 'open' && <div className="banner" role="status">{COPY.reconnecting}</div>}
      <StageBody w={welcome} />
      {!codeSeen && (
        <Sheet title={`${COPY.youAreIn} ${welcome.system.name}`} head="sun">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <SystemShape index={welcome.system.index} size={20} />
            <span style={{ fontWeight: 800, fontSize: 18 }}>{welcome.system.setting}</span>
          </div>
          <div className="eyebrow">{COPY.rejoinCode}</div>
          <div className="codebox" style={{ fontSize: 64, alignSelf: 'flex-start', letterSpacing: 6, padding: '4px 16px' }} aria-label={`Rejoin code ${view.me.rejoinCode.split('').join(' ')}`}>{view.me.rejoinCode}</div>
          <p style={{ fontSize: 16, fontWeight: 700 }}>{COPY.keepCode}</p>
          <button className="btn go big" autoFocus onClick={() => { store.setFlag(`seen-code-${view.me.id}`); setCodeSeen(true) }}>{COPY.gotIt}</button>
        </Sheet>
      )}
      {menu && <MenuSheet w={welcome} onClose={() => setMenu(false)} />}
      {standings && <StandingsSheet w={welcome} onClose={() => setStandings(false)} />}
    </div>
  )
}
