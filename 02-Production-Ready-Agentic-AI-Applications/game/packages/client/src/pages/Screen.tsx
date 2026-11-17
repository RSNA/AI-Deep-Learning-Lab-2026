// The big screen (engineering spec, section 10.9). Designed at 1920 x 1080 and scaled as one block.
import { useEffect, useLayoutEffect, useState } from 'react'
import QRCode from 'qrcode'
import { COLUMNS, phaseOfStage, type Clock, type ScreenView } from '@lab02/protocol'
import { COPY, PHASE_NUMBER, STAGE_TITLE } from '../copy.ts'
import type { ClockRef } from '../lib/clock.ts'
import { connect, reloadForNewBuild } from '../lib/net.ts'
import { store } from '../lib/storage.ts'
import { forceTheme } from '../lib/theme.ts'
import { Avatar, BoardRows, COLUMN_TITLE, Countdown, SystemShape, columnTag } from '../components/ui.tsx'
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

function Qr({ url, size }: { url: string; size: number }) {
  const [svg, setSvg] = useState('')
  useEffect(() => {
    QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#1d2140', light: '#ffffff' } })
      .then(setSvg).catch(() => setSvg(''))
  }, [url])
  return <div style={{ width: size, height: size, background: '#fff', border: '6px solid #1d2140' }} dangerouslySetInnerHTML={{ __html: svg }} />
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
        <div style={{ padding: '6px 18px', background: '#fff', color: '#1d2140', border: '4px solid #1d2140', textAlign: 'center' }}>
          <div className="face" style={{ fontSize: 48, lineHeight: 1 }}>{v.counts.total}</div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>practices</div>
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
                <BoardRows rows={col.rows} systems={v.session.systems} big emptyText={c === 'overall' ? 'Fills when Phase 1 closes.' : 'Opens with its phase.'} />
              </div>
            </div>
          )
        })}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '250px minmax(0, 1fr)', gap: 24, alignItems: 'center' }}>
        <div><div className="face" style={{ fontSize: 32 }}>Health systems</div><div className="muted" style={{ fontSize: 17 }}>{COPY.systemsSub}</div></div>
        <SystemsStrip systems={v.session.systems} standings={v.board.systems} big />
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
        <div style={{ fontSize: 24, fontWeight: 700 }} className="muted">Scan the code or type the link. No account needed.</div>
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
            {!v.arrivals.length && <div className="muted" style={{ fontSize: 24 }}>Waiting for the first practice…</div>}
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

function Winners({ v }: { v: ScreenView }) {
  const w = v.winners
  if (!w) return <TitleCard v={v} text="Winners appear when the phases close." />
  return (
    <div style={{ flexGrow: 1, padding: '32px 48px', display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 40, minHeight: 0 }}>
      <div className="panel" style={{ borderWidth: 4 }}>
        <div className="panel-head sun" style={{ fontSize: 40, borderBottomWidth: 4 }}>Top practices</div>
        <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1 }}><BoardRows rows={w.overall} systems={v.session.systems} big /></div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div className="panel" style={{ borderWidth: 4 }}>
          <div className="panel-head sky" style={{ fontSize: 32, borderBottomWidth: 4 }}>Best of each health system</div>
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
  if (!v) return <div className="banner">{status === 'unauthorized' ? 'This big screen link is no longer valid. Open it again from the host console.' : COPY.reconnecting}</div>
  let body: React.ReactNode
  switch (v.scene) {
    case 'lobby': body = <Lobby v={v} />; break
    case 'intro': body = <TitleCard v={v} text="The game starts in a moment." />; break
    case 'reflection': body = <TitleCard v={v} text="What did your practice learn?" />; break
    case 'help': body = <TitleCard v={v} text={`${STAGE_TITLE[v.stage]} · Help slides`} />; break
    case 'winners': body = <Winners v={v} />; break
    case 'spotlight': body = <Spotlight v={v} />; break
    default: body = <Leaderboard v={v} />
  }
  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: 'var(--bg)' }}>
      <div style={{ width: 1920, height: 1080, transform: `scale(${scale})`, transformOrigin: 'top left', position: 'absolute', left: (window.innerWidth - 1920 * scale) / 2, top: (window.innerHeight - 1080 * scale) / 2, display: 'flex', flexDirection: 'column', background: 'var(--bg)', color: 'var(--ink)' }}>
        <Header v={v} clock={clock} />
        {body}
        <Street theme={v.theme} />
      </div>
      {status !== 'open' && <div className="banner">{COPY.reconnecting}</div>}
    </div>
  )
}
