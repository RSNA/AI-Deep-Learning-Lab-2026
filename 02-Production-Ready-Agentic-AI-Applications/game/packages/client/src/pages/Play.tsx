// The player's screens: top bar, lobby, the stages of the foundation, standings and menu
// (engineering spec, sections 10.1, 10.2, 10.7).
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { COLUMNS, phaseOfStage, type PhaseId, type SystemRef, type Welcome } from '@lab02/protocol'
import { COPY, PHASE_NUMBER, STAGE_TITLE } from '../copy.ts'
import { api } from '../lib/net.ts'
import { usePlayer, forgetPlayer } from '../lib/player.ts'
import { store } from '../lib/storage.ts'
import { useTheme } from '../lib/theme.ts'
import { Room } from '../scene/Room.tsx'
import { Avatar, BoardRows, COLUMN_TITLE, Countdown, Portrait, Sheet, SystemShape, ThemeButton, columnTag } from '../components/ui.tsx'
import { NewGame, PastGameCard } from '../components/after.tsx'
import { Sizable, useHeight } from '../components/sizable.tsx'
import { SLIDE_H, SLIDE_W, SlideThumb } from '../components/slide.tsx'
import { TownStrip } from './Join.tsx'
import { BriefSheet, Planning } from '../phase1/Phase1.tsx'
import { Development, Purse } from '../phase2/Phase2.tsx'
import { P2 } from '../phase2/copy.ts'
import type { DevelopmentContent } from '@lab02/protocol'

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
  const devPlay = view.stage === 'development.play' && !narrow
  const title = phase ? (devPlay ? `Phase ${PHASE_NUMBER[phase]}` : `Phase ${PHASE_NUMBER[phase]} · ${w.session.phaseLabels[phase]}${view.stage.endsWith('.reveal') ? ` · ${COPY.resultsWord}` : ''}`) : STAGE_TITLE[view.stage]
  const phaseRank = standing?.ranks.phase ?? null
  const rank = phaseRank ?? standing?.ranks.overall ?? null
  const timed = clock?.clock.stageEndsAtMs !== null && clock?.clock.stageEndsAtMs !== undefined
  // Phase 2 spends money, developers and validations: they stand in the top bar (section 10.5).
  const devContent = usePlayer((s) => s.content.development) as DevelopmentContent | undefined
  const purse = devPlay && view.development && devContent ? <Purse dv={view.development} content={devContent} /> : null
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
          {purse}
        </div>
      ) : <div className="mid">{timed && <Countdown clock={clock} />}</div>}
      <div className="right">
        {rankBtn}
        {!narrow && <span className={`dot ${status === 'open' ? 'on' : 'off'}`} title={status === 'open' ? 'Connected' : COPY.reconnecting} aria-label={status === 'open' ? 'Connected' : COPY.reconnecting} />}
        <ThemeButton />
        <button className="iconbtn" onClick={onMenu} aria-label={COPY.menu}>☰</button>
      </div>
    </header>
  )
}

function MenuSheet({ onClose, onBrief, onResult, onResult2, onLeave }: { onClose: () => void; onBrief: () => void; onResult: (() => void) | null; onResult2: (() => void) | null; onLeave: () => void }) {
  const view = usePlayer((s) => s.view)!
  const brief = [...view.inbox].reverse().find((m) => m.kind === 'brief')
  return (
    <Sheet title={COPY.menu} onClose={onClose} head="lav">
      {(brief || onResult || onResult2) && (
        <div className="menulist">
          {brief && <button type="button" className="btn small text" onClick={onBrief}><span>{COPY.letterAgain}</span><span className="muted">{brief.title}</span></button>}
          {onResult && <button type="button" className="btn small text" onClick={onResult}><span>{COPY.lookAgain(`Phase ${PHASE_NUMBER.planning}`)}</span><span className="muted">{COPY.lookAgainLine}</span></button>}
          {onResult2 && <button type="button" className="btn small text" onClick={onResult2}><span>{COPY.lookAgain(`Phase ${PHASE_NUMBER.development}`)}</span><span className="muted">{COPY.lookAgainLine2}</span></button>}
        </div>
      )}
      <div className="eyebrow">{COPY.rejoinCode}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span className="codebox" style={{ fontSize: 36 }}>{view.me.rejoinCode}</span>
        <span className="hint" style={{ maxWidth: 260 }}>{COPY.keepCode}</span>
      </div>
      <div className="eyebrow">{COPY.howToPlay}</div>
      <HowToPlay compact />
      <div className="menulist">
        <button type="button" className="btn small text" onClick={onLeave}><span>{COPY.newPlayer}</span><span className="muted">{COPY.newPlayerLine}</span></button>
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

/** Who the player is in this game: the health system and the premise, in the pack's words. */
function WhoPanel({ w }: { w: Welcome }) {
  const sys = w.system
  return (
    <section className="panel">
      <div className="panel-head sky">{COPY.whoYouAre}</div>
      <div className="panel-body">
        <div>
          <div style={{ fontSize: 19, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8, lineHeight: 1.2 }}><SystemShape index={sys.index} size={16} />{sys.name}</div>
          <div className="muted" style={{ fontSize: 14 }}>{sys.setting}</div>
        </div>
        <p style={{ fontSize: 15, lineHeight: 1.45 }}>{sys.premise}</p>
      </div>
    </section>
  )
}

/** The numbers of the practice, and nothing else. */
function SystemPanel({ w }: { w: Welcome }) {
  const sys = w.system
  return (
    <section className="panel">
      <div className="panel-head sky">{COPY.yourSystem}<span className="sub">{sys.name}</span></div>
      <div className="panel-body">
        <div className="sysnumbers">
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
      <div className="cast-hint">{COPY.peopleHint}</div>
      <div className="panel-body cast-list">
        {w.system.cast.map((c, i) => (
          <button key={c.id} type="button" className="cast-row" onClick={() => onPoke?.(c.id)} aria-label={`${c.name}, ${c.role}. ${COPY.sayHello}`}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Portrait c={c} cast={w.system.cast} index={i} size={52} />
              <span><span style={{ display: 'block', fontSize: 16, fontWeight: 800, lineHeight: 1.2 }}>{c.name}</span><span className="muted" style={{ fontSize: 14 }}>{c.role}</span></span>
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}

/** The lowest the scene goes: the band with the table and the people at twice its size, so nobody turns tiny. */
const ROOM_MIN = 192

function useWindowHeight(): number {
  const [h, setH] = useState(() => window.innerHeight)
  useEffect(() => {
    const on = () => setH(window.innerHeight)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return h
}

/**
 * The practice scene (section 10.2). The player drags its bottom edge: a lower scene first loses
 * wall and floor and keeps the people, then steps down in size. The default leaves the numbers
 * of the practice in sight under it. `sizable` is off where the scene is only decoration.
 */
function RoomPanel({ w, title, poke = null, sizable = true, phone = false }: { w: Welcome; title?: string; poke?: { id: string; n: number } | null; sizable?: boolean; phone?: boolean }) {
  const view = usePlayer((s) => s.view)!
  const theme = useTheme()
  const winH = useWindowHeight()
  const [height, setHeight] = useHeight(`lab02.roomh.${phone ? 'phone' : 'laptop'}`, phone ? 240 : Math.round(Math.max(240, Math.min(460, winH * 0.42))))
  const room = (h: number) => (
    <Room art={w.art} cast={w.system.cast} banter={w.system.banter} me={{ avatar: view.me.avatar }} theme={theme} cropHeight={h} focusY={96} poke={poke} />
  )
  return (
    <section className="panel roompanel">
      <div className="panel-head lav">{title ?? COPY.yourPractice}<span className="sub">{COPY.sceneHint}</span></div>
      {sizable
        ? <Sizable height={height} setHeight={setHeight} min={ROOM_MIN} max={Math.max(200, Math.round(winH * 0.8))} label={COPY.dragRoom}>{room}</Sizable>
        : room(360)}
    </section>
  )
}

function Lobby({ w }: { w: Welcome }) {
  const view = usePlayer((s) => s.view)!
  const narrow = useNarrow(1024)
  const wide = !useNarrow(1240)
  const short = useShort(820)
  const [poke, setPoke] = useState<{ id: string; n: number } | null>(null)
  const onPoke = (id: string) => setPoke((p) => ({ id, n: (p?.n ?? 0) + 1 }))
  const howTo = (
    <section className="panel">
      <div className="panel-head">{COPY.howToPlay}</div>
      <div className="panel-body"><HowToPlay /></div>
    </section>
  )
  const who = <WhoPanel w={w} />
  const people = <CastPanel w={w} onPoke={onPoke} />
  const room = <RoomPanel w={w} title={COPY.practiceOf(w.system.name)} poke={poke} phone={narrow} />
  const numbers = <SystemPanel w={w} />
  return (
    <>
      <TownStrip height={narrow ? 96 : short ? 72 : 112}>
        <div className="bubble" style={{ position: 'absolute', left: '50%', top: 10, transform: 'translateX(-50%)', width: 'min(320px, 86vw)' }}>
          <b>{COPY.you}:</b> {view.stage === 'intro' ? COPY.introWait : COPY.waitingHost}
        </div>
      </TownStrip>
      {narrow ? (
        <main className="lobby narrow">{who}{room}{people}{numbers}{howTo}</main>
      ) : wide ? (
        // Who you are and how to play, the practice with its numbers under it, the people (section 10.2).
        <main className="lobby three">
          <div className="lobby-col">{who}{howTo}</div>
          <div className="lobby-col">{room}{numbers}</div>
          <div className="lobby-col">{people}</div>
        </main>
      ) : (
        <main className="lobby">
          <div className="lobby-col">{who}{howTo}{people}</div>
          <div className="lobby-col">{room}{numbers}</div>
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
      <RoomPanel w={w} sizable={false} />
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
      <RoomPanel w={w} sizable={false} />
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

/**
 * The winners, and the page of a game the host has ended (section 10.7). An ended game takes no
 * more commands. Its page keeps the player's result, lets them look at a scored phase again and
 * leads to the next game as soon as the host opens one.
 */
function Winners({ w, onNewGame, onLeave }: { w: Welcome; onNewGame: (code: string) => void; onLeave: () => void }) {
  const st = usePlayer((s) => s.standing)
  const view = usePlayer((s) => s.view)!
  const [look, setLook] = useState<'planning' | 'development' | null>(null)
  const ended = view.stage === 'closed'
  const canLook = ended && !!view.planning?.reveal
  const canLook2 = ended && !!view.development?.reveal
  if ((look === 'planning' && canLook) || (look === 'development' && canLook2)) {
    return (
      <>
        <div className="backstrip"><button type="button" className="btn small" onClick={() => setLook(null)}>← {COPY.backToFinal}</button></div>
        {look === 'planning' ? <Planning w={w} /> : <Development w={w} />}
      </>
    )
  }
  return (
    <main style={{ padding: 16, width: '100%', maxWidth: 640, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
      <section className="panel">
        <div className="panel-head sun">{ended ? COPY.closed : COPY.finalTitle}</div>
        <div className="panel-body">
          {ended && <p style={{ fontSize: 16 }}>{COPY.closedLine}</p>}
          <div className="num" style={{ fontSize: 48 }}>{st?.ranks.overall ? `#${st.ranks.overall}` : '–'} <span className="muted" style={{ fontSize: 24 }}>of {st?.ranks.of ?? '–'}</span></div>
          <PointsTable />
          {canLook && <button type="button" className="btn small text" style={{ alignSelf: 'flex-start' }} onClick={() => setLook('planning')}>{COPY.lookAgain(`Phase ${PHASE_NUMBER.planning}`)}</button>}
          {canLook2 && <button type="button" className="btn small text" style={{ alignSelf: 'flex-start' }} onClick={() => setLook('development')}>{COPY.lookAgain(`Phase ${PHASE_NUMBER.development}`)}</button>}
        </div>
      </section>
      {ended && <NewGame after={w.session.code} onJoin={onNewGame} />}
      {ended && (
        <div className="leaverow">
          <button type="button" className="btn small text" onClick={onLeave}>{COPY.leaveEnded}</button>
          <span className="hint">{COPY.leaveEndedLine}</span>
        </div>
      )}
    </main>
  )
}

/** The game is gone from the server (ended before a restart of the server, or deleted). */
function Gone({ session, go }: { session: string; go: (path: string) => void }) {
  const last = store.last()
  const mine = last && last.session === session ? last : null
  const leave = (to: string) => { forgetPlayer(); go(to) }
  return (
    <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
      <TownStrip height={120} />
      <main style={{ padding: 16, width: '100%', maxWidth: 640, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div>
          <h1>{COPY.closed}</h1>
          <p className="muted" style={{ fontSize: 16 }}>{mine ? COPY.goneLine : COPY.goneNoResult}</p>
        </div>
        {mine && <PastGameCard game={mine} />}
        <NewGame after={session} onJoin={(code) => leave(`/j/${code}`)} />
        <button type="button" className="linkbtn" style={{ alignSelf: 'flex-start' }} onClick={() => leave('/')}>{COPY.otherCode}</button>
      </main>
    </div>
  )
}

/**
 * The slide the host mirrors to every screen: the projector's slide at the size this screen
 * allows, in its proportions, like a video (section 10.9). It follows the host. At a reveal
 * the player can step back to the board.
 */
function MirroredSlide({ w, onBack }: { w: Welcome; onBack: (() => void) | null }) {
  const sl = usePlayer((s) => s.view!.slide)!
  const theme = useTheme()
  const box = useRef<HTMLElement>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const fit = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    fit()
    return () => ro.disconnect()
  }, [])
  // The line under the slide takes 44 px, the padding 16.
  const width = size ? Math.max(120, Math.floor(Math.min(size.w - 16, ((size.h - 60) * SLIDE_W) / SLIDE_H))) : 0
  const upright = !!size && size.h > size.w && size.w < 700
  return (
    <main ref={box} className="pslide" aria-label={COPY.presenting}>
      {width > 0 && (
        <>
          <SlideThumb sl={sl} joinUrl={w.session.joinUrl} width={width} theme={theme} plain meta={<span>{sl.section} · {COPY.slideOf(sl.index + 1, sl.count)}</span>} />
          <div className="pslide-foot" style={{ width }}>
            <span>{COPY.presenting}{upright ? ` ${COPY.turnPhone}` : ''}</span>
            {onBack && <button type="button" className="btn go small pslide-back" onClick={onBack}>{COPY.backToBoard}</button>}
          </div>
        </>
      )}
    </main>
  )
}

function StageBody({ w, onNewGame, onLeave }: { w: Welcome; onNewGame: (code: string) => void; onLeave: () => void }) {
  const view = usePlayer((s) => s.view)!
  const [hidden, setHidden] = useState(false)
  const st = view.stage
  // While the host mirrors the slides the player's screen shows the current slide. At a reveal
  // or a break the player may step back to the board; that choice lasts until the mirror ends.
  const mirrored = !!view.slide
  useEffect(() => { if (!mirrored) setHidden(false) }, [mirrored])
  const canLeave = st.endsWith('.reveal') || st.startsWith('break.')
  if (view.slide && !(hidden && canLeave)) return <MirroredSlide w={w} onBack={canLeave ? () => setHidden(true) : null} />
  const onSlides = view.slide ? () => setHidden(false) : null
  if (st === 'lobby' || st === 'intro') return <Lobby w={w} />
  if (st === 'winners' || st === 'closed') return <Winners w={w} onNewGame={onNewGame} onLeave={onLeave} />
  const phase = phaseOfStage(st)
  if ((st === 'planning.play' || st === 'planning.reveal' || st === 'break.planning') && view.planning) return <Planning key={view.run} w={w} onSlides={onSlides} />
  if ((st === 'development.play' || st === 'development.reveal' || st === 'break.development') && view.development) return <Development key={view.run} w={w} onSlides={onSlides} />
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
  const { status, welcome, view, start, stop, restarted, clearRestarted } = usePlayer()
  const [menu, setMenu] = useState(false)
  const [standings, setStandings] = useState(false)
  const [brief, setBrief] = useState(false)
  const [look, setLook] = useState<'planning' | 'development' | null>(null)
  const [leaving, setLeaving] = useState(false)
  const [codeSeen, setCodeSeen] = useState(() => (auth ? store.flag(`seen-code-${auth.playerId}`) : true))
  useWakeLock()

  useEffect(() => {
    if (!auth) { go('/'); return }
    start(auth.token)
    return () => stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A notice when the host starts a phase or the game again. It goes by itself.
  useEffect(() => {
    if (!restarted) return
    setMenu(false); setStandings(false); setBrief(false); setLook(null)
    const id = setTimeout(clearRestarted, 9000)
    return () => clearTimeout(id)
  }, [restarted, clearRestarted])

  if (!auth) return null
  if (status === 'ended') return <Gone session={auth.session} go={go} />
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
  // Starting fresh in this browser (section 10.7): the browser lets go of this practice and
  // keeps what it remembers of the game. It leads to the game that takes players now: the
  // same one while it is open, else the newest open one, else the page that asks for a code.
  const startFresh = async () => {
    const here = view.stage === 'closed' ? null : auth.session
    const open = here ? null : await api.open()
    const to = here ?? (open?.ok ? open.data.session?.code ?? null : null)
    forgetPlayer()
    stop()
    go(to ? `/j/${to}` : '/')
  }
  // A scored phase can be opened again from the menu, in any later stage (section 10.7). The
  // stages that already show the result do not offer it.
  const onResult = ['planning.play', 'planning.reveal', 'break.planning', 'closed'].includes(view.stage)
  const canLook = !!view.planning?.reveal && !onResult
  const onResult2 = ['development.play', 'development.reveal', 'break.development', 'closed'].includes(view.stage)
  const canLook2 = !!view.development?.reveal && !onResult2
  const looking = ((look === 'planning' && canLook) || (look === 'development' && canLook2)) && !view.slide
  return (
    <div className={fill ? 'page fill' : 'page'}>
      <TopBar w={welcome} onMenu={() => setMenu(true)} onStandings={() => setStandings(true)} />
      {status !== 'open' && <div className="banner" role="status">{COPY.reconnecting}</div>}
      {restarted && (
        <div className="restartbar" role="alert">
          <span>{restarted.kind === 'game' ? COPY.restartedGame : COPY.restartedPhase(STAGE_TITLE[view.stage])}</span>
          <button type="button" className="btn small" onClick={clearRestarted} aria-label={COPY.close}>✕</button>
        </div>
      )}
      {looking ? (
        <>
          <div className="backstrip"><button type="button" className="btn small" onClick={() => setLook(null)}>← {COPY.backToGame}</button></div>
          {look === 'planning' ? <Planning w={welcome} /> : <Development w={welcome} />}
        </>
      ) : <StageBody w={welcome} onNewGame={(code) => { stop(); go(`/j/${code}`) }} onLeave={() => void startFresh()} />}
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
      {menu && <MenuSheet onClose={() => setMenu(false)} onBrief={() => { setMenu(false); setBrief(true) }} onResult={canLook ? () => { setMenu(false); setLook('planning') } : null}
        onResult2={canLook2 ? () => { setMenu(false); setLook('development') } : null}
        onLeave={() => { setMenu(false); if (view.stage === 'closed') void startFresh(); else setLeaving(true) }} />}
      {brief && (() => {
        const last = [...view.inbox].reverse().find((m) => m.kind === 'brief')
        const phase = last?.id.split(':')[0] ?? 'planning'
        return <BriefSheet w={welcome} onClose={() => setBrief(false)} again phase={phase} words={phase === 'development' ? { started: P2.phaseStarted, start: P2.briefStart, stays: P2.letterStays } : undefined} />
      })()}
      {leaving && (
        <Sheet title={COPY.newPlayerTitle} head="sun" onClose={() => setLeaving(false)}>
          <p>{COPY.newPlayerText(view.me.name)}</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span className="codebox" style={{ fontSize: 32 }}>{view.me.rejoinCode}</span>
            <span className="hint" style={{ maxWidth: 300 }}>{COPY.newPlayerCode}</span>
          </div>
          <div className="sheet-actions">
            <button type="button" className="btn sun" onClick={() => void startFresh()}>{COPY.newPlayerGo}</button>
            <button type="button" className="btn" onClick={() => setLeaving(false)}>{COPY.stay}</button>
          </div>
        </Sheet>
      )}
      {standings && <StandingsSheet w={welcome} onClose={() => setStandings(false)} />}
    </div>
  )
}
