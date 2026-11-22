// The big screen (engineering spec, section 10.9). Designed at 1920 x 1080 and scaled as one block.
import { useEffect, useLayoutEffect, useState, type CSSProperties } from 'react'
import { COLUMNS, phaseOfStage, type Clock, type ScreenView } from '@lab02/protocol'
import { COPY, PHASE_NUMBER, players } from '../copy.ts'
import { gameNow, useTick, type ClockRef } from '../lib/clock.ts'
import { ago, programmeSlot } from '../lib/programme.ts'
import { connect, reloadForNewBuild } from '../lib/net.ts'
import { store } from '../lib/storage.ts'
import { forceTheme } from '../lib/theme.ts'
import { Avatar, BoardRows, COLUMN_TITLE, Countdown, SystemShape, columnTag } from '../components/ui.tsx'
import { Qr, SlideBody } from '../components/slide.tsx'
import { SystemsStrip } from './Play.tsx'

function useFit(w: number, h: number): number {
  const [s, setS] = useState(1)
  useLayoutEffect(() => {
    const on = () => setS(Math.min(window.innerWidth / w, window.innerHeight / h))
    on()
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [w, h])
  return s
}

function Street({ theme, height = 128 }: { theme: string; height?: number }) {
  return (
    <div style={{ height, flexShrink: 0, overflow: 'hidden', borderTop: '4px solid var(--line)', display: 'flex', alignItems: 'flex-end' }}>
      <img className="px" src={`/art/town_${theme === 'dark' ? 'night' : 'day'}.png`} alt="" style={{ width: 1920, height: 224, flexShrink: 0 }} />
    </div>
  )
}

function Header({ v, clock }: { v: ScreenView; clock: ClockRef | null }) {
  const phase = phaseOfStage(v.stage)
  const timed = clock?.clock.stageEndsAtMs !== null && clock !== null
  const joinShort = v.session.joinUrl.replace(/^https?:\/\//, '')
  const slide = v.scene === 'slides' ? v.slide : null
  return (
    <div style={{ height: 132, flexShrink: 0, padding: '0 40px', display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', background: 'var(--bar)', color: '#fff' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: 1, color: 'var(--bar-muted)' }}>{COPY.eyebrow.toUpperCase()}</div>
        <div className="face" style={{ fontSize: 48, lineHeight: 1 }}>{phase ? `Phase ${PHASE_NUMBER[phase]} of 3 · ${v.session.phaseLabels[phase]}` : v.session.title ?? v.session.label}</div>
      </div>
      <div>{timed && <div style={{ transform: 'scale(1.4)' }}><Countdown clock={clock} big /></div>}</div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 24 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--bar-muted)' }}>Join at</div>
          <div className="face" style={{ fontSize: 32, lineHeight: 1 }}>{joinShort}</div>
        </div>
        {/* While slides are up the box holds the slide number, so that anyone can ask about "slide 7". */}
        <div className="headbox" style={{ padding: '6px 18px', minWidth: 104, background: '#fff', color: '#1d2140', border: '4px solid #1d2140', textAlign: 'center' }}>
          {slide && <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: 1, lineHeight: 1.1 }}>SLIDE</div>}
          <div className="face" style={{ fontSize: slide ? 44 : 48, lineHeight: 1 }}>{slide ? slide.index + 1 : v.counts.total}</div>
          <div style={{ fontSize: 16, fontWeight: 700, whiteSpace: 'nowrap', lineHeight: 1.1 }}>{slide ? `of ${slide.count}` : v.counts.total === 1 ? 'player' : 'players'}</div>
        </div>
      </div>
    </div>
  )
}

function Leaderboard({ v }: { v: ScreenView }) {
  const sysFilter = v.board.system ? v.session.systems.find((s) => s.id === v.board.system) : null
  return (
    <div style={{ flexGrow: 1, minHeight: 0, padding: '24px 32px 20px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      {sysFilter && <div className="face" style={{ fontSize: 32, display: 'flex', alignItems: 'center', gap: 12 }}><SystemShape index={sysFilter.index} size={24} />{sysFilter.name}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 24, flexGrow: 1, minHeight: 0 }}>
        {COLUMNS.map((c) => {
          const col = v.board.columns[c]
          const sub = c === 'overall' ? 'All phases' : col.state === 'live' ? col.label : v.session.phaseLabels[c]
          return (
            <div key={c} className="panel" style={{ borderWidth: 4, boxShadow: '6px 6px 0 var(--shade)', minHeight: 0 }}>
              <div className={`panel-head ${COLUMN_TITLE[c].head}`} style={{ borderBottomWidth: 4, padding: '8px 16px' }}>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: 32 }}>{COLUMN_TITLE[c].title}</span>
                  <span style={{ fontFamily: 'var(--text)', fontSize: 17, fontWeight: 700 }}>{sub}</span>
                </div>
                {columnTag(col) && <span style={{ padding: '2px 12px', background: '#fff', border: '3px solid #1d2140', fontSize: 24, color: '#1d2140' }}>{columnTag(col)}</span>}
              </div>
              <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
                <BoardRows rows={col.rows} systems={v.session.systems} big of={col.of} emptyText={c === 'overall' ? 'Fills when Phase 1 closes.' : 'Opens with its phase.'} />
              </div>
            </div>
          )
        })}
      </div>
      {v.activity && (
        <div style={{ fontSize: 26, fontWeight: 800 }} className="muted">
          {`${v.activity.acted} of ${players(v.activity.players)} at work · ${v.activity.insights} insights found · ${v.activity.sent} assessment${v.activity.sent === 1 ? '' : 's'} sent`}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '250px minmax(0, 1fr)', gap: 24, alignItems: 'center' }}>
        <div><div className="face" style={{ fontSize: 32 }}>Health systems</div><div className="muted" style={{ fontSize: 17 }}>{COPY.systemsSub}</div></div>
        <SystemsStrip systems={v.session.systems} standings={v.board.systems} big />
      </div>
    </div>
  )
}

const FEED_VERB = { started: 'started', finished: 'finished', sent: 'sent the assessment' } as const
const FEED_TONE = { started: 'var(--sun)', finished: 'var(--go)', sent: 'var(--sky)' } as const

/** The room at work: what practices just started, finished or sent. Never what they learned. */
function Feed({ v, clock }: { v: ScreenView; clock: ClockRef | null }) {
  useTick(1000)
  const now = clock ? gameNow(clock) : null
  const a = v.activity
  const stats = a ? [
    { n: `${a.acted} of ${a.players}`, l: a.players === 1 ? 'practice at work' : 'practices at work' },
    { n: String(a.insights), l: a.insights === 1 ? 'insight found' : 'insights found' },
    { n: String(a.sent), l: a.sent === 1 ? 'assessment sent' : 'assessments sent' },
  ] : []
  return (
    <div style={{ flexGrow: 1, minHeight: 0, padding: '24px 32px 20px', display: 'grid', gridTemplateColumns: 'minmax(0, 2.2fr) minmax(0, 1fr)', gap: 24 }}>
      <div className="panel" style={{ borderWidth: 4, boxShadow: '6px 6px 0 var(--shade)', minHeight: 0 }}>
        <div className="panel-head sky" style={{ fontSize: 36, borderBottomWidth: 4, padding: '8px 20px' }}>The room at work</div>
        <div style={{ flexGrow: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {v.feed.map((e, i) => {
            const ref = v.session.systems.find((x) => x.id === e.system)
            return (
              <div key={`${e.name}-${e.atMs}-${e.kind}-${e.text ?? ''}`} style={{ display: 'grid', gridTemplateColumns: '48px 20px minmax(0, 0.9fr) auto minmax(0, 1.6fr) 110px', gap: 14, alignItems: 'center', padding: '0 20px', minHeight: 58, flexShrink: 0, borderBottom: '2px solid var(--soft)', background: i === 0 ? 'var(--sun-bg)' : undefined, fontSize: 26 }}>
                <Avatar id={e.avatar} size={44} />
                <SystemShape index={ref?.index ?? 0} size={18} />
                <span style={{ fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.name}</span>
                <span style={{ padding: '2px 10px', background: FEED_TONE[e.kind], color: 'var(--on)', fontSize: 20, fontWeight: 800, whiteSpace: 'nowrap' }}>{FEED_VERB[e.kind]}</span>
                <span style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.text ?? ''}</span>
                <span className="muted" style={{ fontSize: 20, fontWeight: 700, textAlign: 'right', whiteSpace: 'nowrap' }}>{now === null ? '' : ago((now - e.atMs) / 1000)}</span>
              </div>
            )
          })}
          {!v.feed.length && <div className="muted" style={{ padding: 24, fontSize: 28, fontWeight: 700 }}>Nothing yet. The first move shows here.</div>}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minHeight: 0 }}>
        {stats.map((x) => (
          <div key={x.l} className="panel" style={{ borderWidth: 4, padding: '14px 22px', boxShadow: '6px 6px 0 var(--shade)' }}>
            <div className="face" style={{ fontSize: 84, lineHeight: 1 }}>{x.n}</div>
            <div className="muted" style={{ fontSize: 24, fontWeight: 800 }}>{x.l}</div>
          </div>
        ))}
        <div style={{ flexGrow: 1 }} />
        <SystemsStrip systems={v.session.systems} standings={v.board.systems} big />
      </div>
    </div>
  )
}

/** One phase, the health systems side by side. */
function PhaseBoard({ v }: { v: ScreenView }) {
  const b = v.phaseBoard
  if (!b) return <Leaderboard v={v} />
  const tag = b.state === 'live' ? 'Live' : b.state === 'final' ? 'Final' : ''
  return (
    <div style={{ flexGrow: 1, minHeight: 0, padding: '24px 32px 20px', display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        <span className="face" style={{ fontSize: 44, lineHeight: 1 }}>{`Phase ${PHASE_NUMBER[b.phase]} · ${v.session.phaseLabels[b.phase]}`}</span>
        <span className="muted" style={{ fontSize: 26, fontWeight: 800 }}>{b.state === 'empty' ? '' : b.label}</span>
        {tag && <span style={{ padding: '2px 12px', background: b.state === 'live' ? 'var(--sun)' : 'var(--go)', color: 'var(--on)', fontSize: 22, fontWeight: 800 }}>{tag}</span>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, b.systems.length)}, minmax(0, 1fr))`, gap: 24, flexGrow: 1, minHeight: 0 }}>
        {b.systems.map((x) => {
          const ref = v.session.systems.find((s) => s.id === x.id)
          return (
            <div key={x.id} className="panel" style={{ borderWidth: 4, boxShadow: '6px 6px 0 var(--shade)', minHeight: 0 }}>
              <div className="panel-head lav" style={{ borderBottomWidth: 4, padding: '8px 16px', fontSize: 32, justifyContent: 'flex-start', gap: 14 }}>
                <SystemShape index={ref?.index ?? 0} size={26} />
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ref?.name}</span>
              </div>
              <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
                <BoardRows rows={x.rows} systems={v.session.systems} big of={b.of} emptyText={b.state === 'empty' ? 'Opens with its phase.' : 'Nobody here is on the board yet.'} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** One practice at work: what runs and how far it is. Counts only, never a class or an insight. */
function PracticeCard({ v, round }: { v: ScreenView; round: number }) {
  const c = v.cards.length ? v.cards[round % v.cards.length]! : null
  if (!c) return null
  const ref = v.session.systems.find((x) => x.id === c.system)
  return (
    <div style={{ flexGrow: 1, minHeight: 0, padding: '28px 64px', display: 'grid', gridTemplateColumns: '300px minmax(0, 1fr)', gap: 56, alignItems: 'center' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        <Avatar id={c.avatar} size={256} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
        <div className="muted" style={{ fontSize: 26, fontWeight: 800, letterSpacing: 1 }}>ONE PRACTICE AT WORK</div>
        <div className="face" style={{ fontSize: 96, lineHeight: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 32, fontWeight: 800 }}><SystemShape index={ref?.index ?? 0} size={28} />{ref?.name}</div>
        <div className="panel" style={{ borderWidth: 4, padding: '14px 22px', gap: 6, boxShadow: '6px 6px 0 var(--shade)' }}>
          <div className="muted" style={{ fontSize: 22, fontWeight: 800 }}>Working on now</div>
          {c.now.length
            ? c.now.slice(0, 3).map((t) => <div key={t} style={{ fontSize: 32, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t}</div>)
            : <div style={{ fontSize: 32, fontWeight: 700 }}>Reading the evidence and deciding</div>}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, c.facts.length)}, minmax(0, 1fr))`, gap: 20 }}>
          {c.facts.map((f) => (
            <div key={f.label} className="panel" style={{ borderWidth: 4, padding: '12px 20px', boxShadow: '6px 6px 0 var(--shade)' }}>
              <div className="face" style={{ fontSize: 52, lineHeight: 1.05 }}>{f.value}</div>
              <div className="muted" style={{ fontSize: 22, fontWeight: 800 }}>{f.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** "Follow the game" while a phase is played: the programme of the pack, in a loop (section 6.13). */
function Follow({ v, clock }: { v: ScreenView; clock: ClockRef | null }) {
  useTick(500)
  // The turn comes from the session clock, so every screen of the session shows the same view.
  const t = clock ? gameNow(clock) / (clock.clock.scale || 1) / 1000 : 0
  const slot = programmeSlot(v.programme ?? [], t)
  if (slot.show === 'phase_board' && v.phaseBoard) return <PhaseBoard v={v} />
  if (slot.show === 'player' && v.cards.length) return <PracticeCard v={v} round={slot.round} />
  return <Feed v={v} clock={clock} />
}

/** The results of the phase that closed, for the room: how points spread, and each health system. */
function Reveal({ v }: { v: ScreenView }) {
  const r = v.reveal
  if (!r) return <Leaderboard v={v} />
  const max = Math.max(1, ...r.histogram)
  const total = r.histogram.reduce((a, b) => a + b, 0)
  return (
    <div style={{ flexGrow: 1, minHeight: 0, padding: '28px 48px', display: 'grid', gridTemplateColumns: 'minmax(0, 1.3fr) minmax(0, 1fr)', gap: 40 }}>
      <div className="panel" style={{ borderWidth: 4, boxShadow: '6px 6px 0 var(--shade)' }}>
        <div className="panel-head sky" style={{ fontSize: 36, borderBottomWidth: 4 }}>{`Phase ${PHASE_NUMBER[r.phase]} · How the room scored`}</div>
        <div style={{ flexGrow: 1, display: 'flex', alignItems: 'flex-end', gap: 14, padding: '24px 28px 12px' }}>
          {r.histogram.map((n, i) => (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, height: '100%', justifyContent: 'flex-end' }}>
              <div className="face" style={{ fontSize: 30 }}>{n || ''}</div>
              <div style={{ width: '100%', height: `${(78 * n) / max}%`, minHeight: n ? 6 : 0, background: 'var(--sky)', border: n ? '3px solid var(--line)' : 0 }} />
              <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--muted)' }}>{i * 100}</div>
            </div>
          ))}
        </div>
        <div style={{ padding: '0 28px 18px', fontSize: 20, fontWeight: 700 }} className="muted">{`Points of the ${players(total)} who played, in steps of 100`}</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {r.systems.map((x) => {
          const ref = v.session.systems.find((s) => s.id === x.id)
          return (
            <div key={x.id} className="panel" style={{ borderWidth: 4, boxShadow: '6px 6px 0 var(--shade)' }}>
              <div className="panel-head" style={{ fontSize: 32, borderBottomWidth: 4, background: 'var(--panel)', color: 'var(--ink)', justifyContent: 'flex-start', gap: 14 }}>
                <SystemShape index={ref?.index ?? 0} size={26} />{ref?.name}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, padding: '16px 22px' }}>
                <div><div className="face" style={{ fontSize: 64, lineHeight: 1 }}>{Math.round(x.meanPoints)}</div><div style={{ fontSize: 20, fontWeight: 700 }} className="muted">mean points</div></div>
                {r.phase === 'planning' && (
                  <div><div className="face" style={{ fontSize: 64, lineHeight: 1 }}>{x.players ? `${Math.round((100 * x.flagshipHits) / x.players)}%` : '–'}</div><div style={{ fontSize: 20, fontWeight: 700 }} className="muted">{`found the agent project (${x.flagshipHits} of ${x.players})`}</div></div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Lobby({ v }: { v: ScreenView }) {
  return (
    <div style={{ flexGrow: 1, padding: '40px 56px', display: 'grid', gridTemplateColumns: '560px minmax(0, 1fr)', gap: 48, minHeight: 0 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, alignItems: 'flex-start' }}>
        <Qr url={v.session.joinUrl} size={460} />
        <div className="face" style={{ fontSize: 56, lineHeight: 1 }}>{v.session.joinUrl.replace(/^https?:\/\//, '')}</div>
        <div style={{ fontSize: 28, fontWeight: 700 }} className="muted">Scan the code with your phone, or type the link on a laptop. No account is needed.</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24, minWidth: 0 }}>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${v.counts.bySystem.length}, 1fr)`, gap: 20 }}>
          {v.counts.bySystem.map((s) => {
            const ref = v.session.systems.find((x) => x.id === s.id)
            return (
              <div key={s.id} className="panel" style={{ borderWidth: 4, padding: '14px 18px', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><SystemShape index={ref?.index ?? 0} size={22} /><span style={{ fontSize: 24, fontWeight: 800 }}>{ref?.name}</span></div>
                <div className="face" style={{ fontSize: 72, lineHeight: 1 }}>{s.players}</div>
              </div>
            )
          })}
        </div>
        <div className="panel" style={{ borderWidth: 4, flexGrow: 1, minHeight: 0 }}>
          <div className="panel-head sun" style={{ fontSize: 32, borderBottomWidth: 4 }}>Just arrived</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', padding: 12, gap: 8 }}>
            {v.arrivals.map((a, i) => {
              const ref = v.session.systems.find((x) => x.id === a.system)
              return (
                <div key={`${a.name}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 26, fontWeight: 700, minWidth: 0 }}>
                  <Avatar id={a.avatar} size={48} /><SystemShape index={ref?.index ?? 0} size={18} />
                  <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.name}</span>
                </div>
              )
            })}
            {!v.arrivals.length && <div className="muted" style={{ fontSize: 24 }}>Waiting for the first player…</div>}
          </div>
        </div>
      </div>
    </div>
  )
}

function TitleCard({ v, text }: { v: ScreenView; text: string }) {
  return (
    <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 24, textAlign: 'center', padding: 40 }}>
      <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: 1 }} className="muted">{COPY.eyebrow.toUpperCase()}</div>
      <div className="face" style={{ fontSize: 140, lineHeight: 1 }}>{v.session.title ?? v.session.label}</div>
      <div style={{ fontSize: 36, fontWeight: 700 }}>{text}</div>
    </div>
  )
}

function Podium({ rows, v }: { rows: ScreenView['board']['columns']['overall']['rows']; v: ScreenView }) {
  // Second, first, third: the winner stands in the middle, highest.
  const order = [rows[1], rows[0], rows[2]]
  const heights = [200, 280, 150]
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 24, flexGrow: 1, padding: '0 24px 8px' }}>
      {order.map((r, i) => {
        if (!r) return <div key={i} style={{ width: 300 }} />
        const ref = v.session.systems.find((x) => x.id === r.system)
        return (
          <div key={i} style={{ width: 300, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            <Avatar id={r.avatar} size={i === 1 ? 128 : 96} />
            <div style={{ fontSize: 28, fontWeight: 800, textAlign: 'center', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 20, fontWeight: 700 }} className="muted"><SystemShape index={ref?.index ?? 0} size={16} />{ref?.name}</div>
            <div style={{ width: '100%', height: heights[i], background: i === 1 ? 'var(--sun)' : 'var(--sky)', border: '4px solid var(--line)', boxShadow: '6px 6px 0 var(--shade)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--on)' }}>
              <div className="face" style={{ fontSize: 96, lineHeight: 1 }}>{r.rank}</div>
              <div className="face" style={{ fontSize: 40 }}>{Math.round(r.value)}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** The winners once every phase is scored, with a podium. Before that: the standings so far. */
function Winners({ v }: { v: ScreenView }) {
  const w = v.winners
  if (!w) return <TitleCard v={v} text={v.stage === 'closed' ? 'This session has ended.' : 'The winners appear once Phase 1 is scored.'} />
  return (
    <div style={{ flexGrow: 1, padding: '28px 48px', display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 40, minHeight: 0 }}>
      <div className="panel" style={{ borderWidth: 4 }}>
        <div className="panel-head sun" style={{ fontSize: 40, borderBottomWidth: 4 }}>{w.final ? 'The winners' : v.stage === 'closed' ? 'This session has ended · the standings' : 'Standings so far'}</div>
        {w.final
          ? <Podium rows={w.overall} v={v} />
          : <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1 }}><BoardRows rows={w.overall} systems={v.session.systems} big /></div>}
        {!w.final && <div className="muted" style={{ padding: '10px 20px', fontSize: 22, fontWeight: 700 }}>{v.stage === 'closed' ? 'The session ended before every phase was scored. These totals count the phases that were scored.' : 'Not every phase is scored yet. These are the totals so far.'}</div>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div className="panel" style={{ borderWidth: 4 }}>
          <div className="panel-head sky" style={{ fontSize: 32, borderBottomWidth: 4 }}>{w.final ? 'Best of each health system' : 'Leading each health system'}</div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {w.perSystem.map((p) => {
              const ref = v.session.systems.find((x) => x.id === p.system)
              return (
                <div key={p.system} className="lb-row" style={{ gridTemplateColumns: '20px minmax(0,1fr) 48px minmax(0,1.3fr) auto', minHeight: 64, fontSize: 22 }}>
                  <SystemShape index={ref?.index ?? 0} size={18} />
                  <span className="nm">{ref?.name}</span>
                  {p.row ? <Avatar id={p.row.avatar} size={44} /> : <span />}
                  <span className="nm">{p.row?.name ?? '–'}</span>
                  <span className="val" style={{ fontSize: 32 }}>{p.row ? Math.round(p.row.value) : ''}</span>
                </div>
              )
            })}
          </div>
        </div>
        <SystemsStrip systems={v.session.systems} standings={w.topSystems} big />
      </div>
    </div>
  )
}

/** One slide of the deck, as large as the room needs it. */
export function Slide({ v }: { v: ScreenView }) {
  const sl = v.slide
  if (!sl) return <TitleCard v={v} text="No slide to show." />
  return <SlideBody sl={sl} joinUrl={v.session.joinUrl} meta={<span>{sl.section}</span>} style={{ '--u': '1px' } as CSSProperties} />
}

function Spotlight({ v }: { v: ScreenView }) {
  const s = v.spotlight
  if (!s) return <Leaderboard v={v} />
  const ref = v.session.systems.find((x) => x.id === s.system)
  return (
    <div style={{ flexGrow: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 48 }}>
      <Avatar id={s.avatar} size={256} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="face" style={{ fontSize: 96, lineHeight: 1 }}>{s.name}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 32, fontWeight: 800 }}><SystemShape index={ref?.index ?? 0} size={28} />{ref?.name}</div>
        <div className="face" style={{ fontSize: 48 }}>{s.points.total} points · {s.tiles} tiles</div>
      </div>
    </div>
  )
}

export function ScreenPage() {
  const [token] = useState(() => {
    const fromHash = location.hash.slice(1)
    if (fromHash) {
      store.setScreen({ token: fromHash })
      history.replaceState(null, '', '/screen')
      return fromHash
    }
    return store.screen()?.token ?? null
  })
  const [v, setV] = useState<ScreenView | null>(null)
  const [clock, setClock] = useState<ClockRef | null>(null)
  const [status, setStatus] = useState('connecting')
  const scale = useFit(1920, 1080)

  useEffect(() => {
    if (!token) return
    const c = connect(token)
    c.on('welcome', (m) => {
      const w = m as unknown as { view: ScreenView; clock: Clock }
      setV(w.view)
      setClock({ clock: w.clock, at: performance.now() })
    })
    c.on('screen_view', (m) => setV((m as unknown as { view: ScreenView }).view))
    c.on('clock', (m) => setClock({ clock: (m as unknown as { clock: Clock }).clock, at: performance.now() }))
    c.on('reload', () => reloadForNewBuild())
    c.onStatus(setStatus)
    return () => c.close()
  }, [token])

  useEffect(() => { forceTheme(v?.theme ?? null) }, [v?.theme])
  useEffect(() => () => forceTheme(null), [])

  if (!token) return <div style={{ padding: 40 }}><h2>Open the big screen from the host console.</h2></div>
  if (!v) return <div className="banner">{status === 'unauthorized' ? 'This big screen link is no longer valid. Open it again from the host console.' : status === 'ended' ? 'This session has ended. Open the big screen of the next session from its host console.' : COPY.reconnecting}</div>
  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: 'var(--bg)' }}>
      <div style={{ position: 'absolute', left: (window.innerWidth - 1920 * scale) / 2, top: (window.innerHeight - 1080 * scale) / 2 }}>
        <ScreenStage v={v} clock={clock} scale={scale} />
      </div>
      {status !== 'open' && <div className="banner">{COPY.reconnecting}</div>}
    </div>
  )
}

/** What the projector draws, 1920 x 1080 at a scale. The host console's preview uses it too. */
export function ScreenStage({ v, clock, scale, themed = false }: { v: ScreenView; clock: ClockRef | null; scale: number; themed?: boolean }) {
  let body: React.ReactNode
  switch (v.scene) {
    case 'lobby': body = <Lobby v={v} />; break
    case 'intro': body = <TitleCard v={v} text="Intro slides" />; break
    case 'reflection': body = <TitleCard v={v} text="Reflection" />; break
    case 'slides': body = <Slide v={v} />; break
    case 'winners': body = <Winners v={v} />; break
    case 'spotlight': body = <Spotlight v={v} />; break
    case 'reveal': body = <Reveal v={v} />; break
    case 'feed': body = <Feed v={v} clock={clock} />; break
    default: body = v.programme ? <Follow v={v} clock={clock} /> : v.phaseBoard ? <PhaseBoard v={v} /> : <Leaderboard v={v} />
  }
  return (
    <div style={{ width: 1920 * scale, height: 1080 * scale, overflow: 'hidden' }}>
      <div className={themed ? `theme-${v.theme}` : undefined} style={{ width: 1920, height: 1080, transform: `scale(${scale})`, transformOrigin: 'top left', display: 'flex', flexDirection: 'column', background: 'var(--bg)', color: 'var(--ink)' }}>
        <Header v={v} clock={clock} />
        {body}
        <Street theme={v.theme} />
      </div>
    </div>
  )
}
