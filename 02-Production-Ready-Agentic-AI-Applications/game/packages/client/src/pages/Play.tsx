// The player's screens: top bar, lobby, the stages of the foundation, standings and menu
// (engineering spec, sections 10.1, 10.2, 10.7).
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { COLUMNS, phaseOfStage, type PhaseId, type SystemRef, type Welcome } from '@lab02/protocol'
import { COPY, PHASE_NUMBER, STAGE_TITLE } from '../copy.ts'
import { usePlayer, forgetPlayer } from '../lib/player.ts'
import { store } from '../lib/storage.ts'
import { setTheme, useTheme } from '../lib/theme.ts'
import { Room } from '../scene/Room.tsx'
import { Avatar, BoardRows, COLUMN_TITLE, Countdown, Portrait, Sheet, SystemShape, columnTag } from '../components/ui.tsx'
import { TownStrip } from './Join.tsx'
import { BriefSheet, Planning } from '../phase1/Phase1.tsx'

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

function useShort(px: number): boolean {
  const [short, setShort] = useState(() => window.innerHeight < px)
  useEffect(() => {
    const on = () => setShort(window.innerHeight < px)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [px])
  return short
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
  const narrow = useNarrow(1024)
  const sys = w.session.systems.find((s) => s.id === view.me.system)
  const phase = phaseOfStage(view.stage)
  const title = phase ? `Phase ${PHASE_NUMBER[phase]} · ${w.session.phaseLabels[phase]}${view.stage.endsWith('.reveal') ? ` · ${COPY.resultsWord}` : ''}` : STAGE_TITLE[view.stage]
  const phaseRank = standing?.ranks.phase ?? null
  const rank = phaseRank ?? standing?.ranks.overall ?? null
  const timed = clock?.clock.stageEndsAtMs !== null && clock?.clock.stageEndsAtMs !== undefined
  const rankBtn = (
    <button className="rankbtn" onClick={onStandings} aria-label={`${COPY.standings}: ${rank ? COPY.rankOf(rank, standing!.ranks.of) : COPY.noRankYet}`}>
      {rank ? <>{COPY.rankWord} <b className="num">{rank}</b> {COPY.ofWord} {standing!.ranks.of}</> : COPY.noRankYet}
    </button>
  )
  return (
    <header className="topbar" style={narrow ? { gridTemplateColumns: 'minmax(0,1fr) auto auto', padding: '6px 10px' } : undefined}>
      <div className="who">
        <Avatar id={view.me.avatar} size={32} />
        <span className="name">{view.me.name}</span>
        {sys && !narrow && <span className="sysbadge"><SystemShape index={sys.index} size={10} />{sys.name}</span>}
      </div>
      {!narrow ? (
        <div className="mid">
          <span className="phase">{title}</span>
          {timed && <Countdown clock={clock} />}
        </div>
      ) : <div className="mid">{timed && <Countdown clock={clock} />}</div>}
      <div className="right">
        {rankBtn}
        {!narrow && <span className={`dot ${status === 'open' ? 'on' : 'off'}`} title={status === 'open' ? 'Connected' : COPY.reconnecting} aria-label={status === 'open' ? 'Connected' : COPY.reconnecting} />}
        <button className="iconbtn" onClick={onMenu} aria-label={COPY.menu}>☰</button>
      </div>
    </header>
  )
}

function MenuSheet({ w, onClose, onBrief }: { w: Welcome; onClose: () => void; onBrief: () => void }) {
  const view = usePlayer((s) => s.view)!
  const theme = useTheme()
  const [open, setOpen] = useState<number | null>(null)
  const brief = view.inbox.find((m) => m.kind === 'brief')
  return (
    <Sheet title={COPY.menu} onClose={onClose} head="lav">
      {brief && <button type="button" className="btn small text" style={{ alignSelf: 'flex-start' }} onClick={onBrief}>{COPY.letterAgain}: {brief.title}</button>}
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
              <span style={{ fontWeight: 800, flexGrow: 1 }}>{r.label}</span>
              <span className="chip" style={{ fontSize: 12 }}>{r.classShort}</span>
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
              <BoardRows rows={col.rows} systems={w.session.systems} of={col.of} />
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

function CastPanel({ w, onPoke }: { w: Welcome; onPoke?: (id: string) => void }) {
  return (
    <section className="panel">
      <div className="panel-head sun">{COPY.people}</div>
      <div className="panel-body cast-list">
        {w.system.cast.map((c, i) => (
          <button key={c.id} type="button" className="cast-row" onClick={() => onPoke?.(c.id)} aria-label={`${c.name}, ${c.role}. ${COPY.sayHello}`}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Portrait c={c} cast={w.system.cast} index={i} size={60} />
              <span><span style={{ display: 'block', fontSize: 16, fontWeight: 800 }}>{c.name}</span><span className="muted" style={{ fontSize: 14 }}>{c.role}</span></span>
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}

/** The practice scene. With `fit`, a room taller than the space left under it in the window is
 * cropped a little at top and bottom, so a player who arrives sees all of it without a scroll. */
function RoomPanel({ w, title, maxHeight = 600, poke = null, fit = false }: { w: Welcome; title?: string; maxHeight?: number; poke?: { id: string; n: number } | null; fit?: boolean }) {
  const view = usePlayer((s) => s.view)!
  const theme = useTheme()
  const box = useRef<HTMLDivElement>(null)
  const [crop, setCrop] = useState<number | undefined>(undefined)
  useLayoutEffect(() => {
    if (!fit) return
    const on = () => {
      const el = box.current
      if (!el) return
      const top = el.getBoundingClientRect().top + window.scrollY
      setCrop(Math.max(360, Math.floor(window.innerHeight - top - 14)))
    }
    on()
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [fit])
  return (
    <section className="panel">
      <div className="panel-head lav">{title ?? COPY.yourPractice}<span className="sub">{COPY.sceneHint}</span></div>
      <div ref={box}>
        <Room art={w.art} cast={w.system.cast} banter={w.system.banter} me={{ avatar: view.me.avatar }} theme={theme} maxHeight={maxHeight} cropHeight={crop} focusY={96} poke={poke} />
      </div>
    </section>
  )
}

function Lobby({ w }: { w: Welcome }) {
  const view = usePlayer((s) => s.view)!
  const narrow = useNarrow(1024)
  const short = useShort(820)
  const [poke, setPoke] = useState<{ id: string; n: number } | null>(null)
  const onPoke = (id: string) => setPoke((p) => ({ id, n: (p?.n ?? 0) + 1 }))
  const howTo = (
    <section className="panel">
      <div className="panel-head">{COPY.howToPlay}</div>
      <div className="panel-body"><HowToPlay /></div>
    </section>
  )
  return (
    <>
      <TownStrip height={narrow ? 120 : short ? 96 : 160}>
        <div className="bubble" style={{ position: 'absolute', left: '50%', top: 14, transform: 'translateX(-50%)', width: 'min(320px, 86vw)' }}>
          <b>{COPY.you}:</b> {view.stage === 'intro' ? COPY.introWait : COPY.waitingHost}
        </div>
      </TownStrip>
      {narrow ? (
        <main className="lobby narrow">
          <SystemPanel w={w} />
          <RoomPanel w={w} title={COPY.practiceOf(w.system.name)} maxHeight={360} poke={poke} />
          <CastPanel w={w} onPoke={onPoke} />
          {howTo}
        </main>
      ) : (
        <main className="lobby">
          <div className="lobby-left">
            {howTo}
            <CastPanel w={w} onPoke={onPoke} />
          </div>
          {/* The scene first, so that a player who arrives sees the living room without a scroll (section 10.2). */}
          <div className="lobby-right">
            <RoomPanel w={w} title={COPY.practiceOf(w.system.name)} poke={poke} fit />
            <SystemPanel w={w} />
          </div>
        </main>
      )}
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
              {pts.band && <span className="chip sun">{pts.band}</span>}
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

/** The slide the host mirrors to every screen. It follows the host; at a reveal the player can step back to the board. */
function MirroredSlide({ onBack }: { onBack: (() => void) | null }) {
  const sl = usePlayer((s) => s.view!.slide)!
  // The slide fills the area under the top bar, like the slide on the projector, and its type
  // grows with the screen (section 10.9): every size is a share of the projector's 1920 x 1080.
  const box = useRef<HTMLElement>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])
  const narrow = !!size && size.w < 700
  const u = size ? Math.min(size.w / 1920, size.h / 1080) : 0.5
  return (
    <main ref={box} className={`pslide${narrow ? ' narrow' : ''}`} aria-label={COPY.presenting} style={{ '--u': `${u}px` } as React.CSSProperties}>
      <div className="pslide-in">
        <div className="pslide-meta"><span>{sl.section} · {COPY.slideOf(sl.index + 1, sl.count)}</span><span>{COPY.presenting}</span></div>
        <h1 className="face">{sl.title}</h1>
        <div className={sl.image || sl.stat ? 'pslide-grid' : 'pslide-one'}>
          <ul>{sl.bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>
          {(sl.image || sl.stat) && (
            <div className="pslide-side">
              {sl.image && <img className="px" src={sl.image} alt="" />}
              {sl.stat && <div className="pstat"><div className="num">{sl.stat.value}</div><div>{sl.stat.label}</div></div>}
            </div>
          )}
        </div>
        {onBack && <button type="button" className="btn go pslide-back" onClick={onBack}>{COPY.backToBoard}</button>}
      </div>
    </main>
  )
}

function StageBody({ w }: { w: Welcome }) {
  const view = usePlayer((s) => s.view)!
  const [hidden, setHidden] = useState(false)
  const st = view.stage
  // While the host mirrors the slides the player's screen shows the current slide. At a reveal
  // or a break the player may step back to the board; that choice lasts until the mirror ends.
  const mirrored = !!view.slide
  useEffect(() => { if (!mirrored) setHidden(false) }, [mirrored])
  const canLeave = st.endsWith('.reveal') || st.startsWith('break.')
  if (view.slide && !(hidden && canLeave)) return <MirroredSlide onBack={canLeave ? () => setHidden(true) : null} />
  const onSlides = view.slide ? () => setHidden(false) : null
  if (st === 'lobby' || st === 'intro') return <Lobby w={w} />
  if (st === 'winners' || st === 'closed') return <Winners />
  const phase = phaseOfStage(st)
  if ((st === 'planning.play' || st === 'planning.reveal' || st === 'break.planning') && view.planning) return <Planning w={w} onSlides={onSlides} />
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
  const [brief, setBrief] = useState(false)
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

  const fill = view.stage === 'planning.play' && !!view.planning
  return (
    <div className={fill ? 'page fill' : 'page'}>
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
      {menu && <MenuSheet w={welcome} onClose={() => setMenu(false)} onBrief={() => { setMenu(false); setBrief(true) }} />}
      {brief && <BriefSheet w={welcome} onClose={() => setBrief(false)} again />}
      {standings && <StandingsSheet w={welcome} onClose={() => setStandings(false)} />}
    </div>
  )
}
