// One slide of the deck (engineering spec, section 10.9), drawn the same way on the projector, on
// a player's screen and in the previews of the host console. Every size is a share of the
// projector's 1920 px, through the CSS variable --u (one projector pixel), so a slide keeps its
// proportions at any size. On a phone the parts stack and the type has a fixed, readable size.
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import QRCode from 'qrcode'
import type { SlideView } from '@lab02/protocol'
import { Avatar, SystemShape } from './ui.tsx'

/** The slide area of the projector: the screen without the header and the street. */
export const SLIDE_W = 1920
export const SLIDE_H = 820

export function Qr({ url, size }: { url: string; size?: number }) {
  const [svg, setSvg] = useState('')
  useEffect(() => {
    QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#1d2140', light: '#ffffff' } })
      .then(setSvg).catch(() => setSvg(''))
  }, [url])
  return <div className="qr" style={size ? { width: size, height: size, borderWidth: 6 } : undefined} dangerouslySetInnerHTML={{ __html: svg }} />
}

const short = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '')
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('')
const TONES = ['sky', 'sun', 'go', 'lav', 'rose'] as const

function QrBox({ sl, joinUrl }: { sl: SlideView; joinUrl: string }) {
  const q = sl.qr
  if (!q) return null
  const url = q.show === 'join' ? joinUrl : q.url
  return (
    <div className="sl-qr">
      {url ? <Qr url={url} /> : <div className="qr empty">The QR code comes here</div>}
      <div className="lab">{q.label ?? (url ? short(url) : '')}</div>
      {q.show === 'join' && q.label && <div className="sub">{short(joinUrl)}</div>}
    </div>
  )
}

/** The bullets of a plain slide. Under boxes, people or pictures they stand as a strip: what to take from the slide. */
function Bullets({ items, small = false }: { items: string[]; small?: boolean }) {
  if (!items.length) return null
  return <ul className={small ? 'sl-take' : 'sl-bullets'}>{items.map((b, i) => <li key={i}>{b}</li>)}</ul>
}

/** A room statistic as bars. Before its phase is scored the bars are empty and one line says so. */
function Chart({ ch }: { ch: SlideView['charts'][number] }) {
  return (
    <div className="sl-chart">
      <div className="ct">{ch.title}{ch.bars.every((b) => b.value === null) && <span className="cn">Fills in when the phase is scored</span>}</div>
      {ch.bars.map((b) => (
        <div key={b.label} className={`sl-bar st-${b.system === null ? b.tone : `sys${b.system % 4}`}`}>
          <span className="bl">{b.label}</span>
          <span className="track"><i style={{ width: `${b.value === null ? 0 : Math.max(0, Math.min(100, b.value))}%` }} /></span>
          <span className="v num">{b.value === null ? '–' : `${Math.round(b.value)}%`}</span>
        </div>
      ))}
    </div>
  )
}

/**
 * The leaderboard of the game: the first few players large, side by side, and the others in a
 * list beside them. Before a phase is scored it is a frame that says when it fills in.
 */
function Standings({ sl }: { sl: SlideView }) {
  const st = sl.standings
  if (!st) return null
  if (!st.rows.length) return <div className="sl-stand empty">The names appear when the first phase is scored.</div>
  const top = st.rows.slice(0, st.highlight)
  const rest = st.rows.slice(st.highlight)
  return (
    <div className={`sl-stand${rest.length ? '' : ' only-top'}`}>
      <div className={`sl-stand-top n${top.length}`}>
        {top.map((r) => (
          <div key={`${r.rank}-${r.name}`} className={`sl-stand-big r${r.rank}`}>
            <span className="rk num">{r.rank}</span>
            <Avatar id={r.avatar} size={96} />
            <span className="nm">{r.name}</span>
            <span className="pt"><b className="num">{Math.round(r.value).toLocaleString('en-US')}</b> points</span>
          </div>
        ))}
      </div>
      {rest.length > 0 && (
        <ol className="sl-stand-rest">
          {rest.map((r) => (
            <li key={`${r.rank}-${r.name}`}>
              <span className="rk num">{r.rank}</span>
              <Avatar id={r.avatar} size={40} />
              <span className="nm">{r.name}</span>
              <span className="pt num">{Math.round(r.value).toLocaleString('en-US')}</span>
            </li>
          ))}
        </ol>
      )}
      {!st.final && <div className="sl-stand-note">The standings so far. The last phase is not scored yet.</div>}
    </div>
  )
}

function Side({ sl }: { sl: SlideView }) {
  if (!sl.image && !sl.stat && !sl.charts.length) return null
  return (
    <div className="sl-side">
      {sl.image && <img className="sl-img" src={sl.image} alt="" />}
      {sl.stat && <div className="sl-stat"><div className="num">{sl.stat.value}</div><div>{sl.stat.label}</div></div>}
      {sl.charts.map((ch) => <Chart key={ch.title} ch={ch} />)}
    </div>
  )
}

function Cards({ sl }: { sl: SlideView }) {
  if (!sl.cards.length) return null
  return (
    <div className={`sl-cards n${sl.cards.length}`} style={{ '--n': sl.cards.length } as CSSProperties}>
      {sl.cards.map((c, i) => (
        <div key={i} className={`sl-card st-${c.system === null ? c.tone : `sys${c.system % 4}`}`}>
          <div className="sl-card-head">
            {(c.tag || c.system !== null) && <span className="sl-tag">{c.system !== null && <SystemShape index={c.system} size={14} />}{c.tag}</span>}
            <span>{c.title}</span>
          </div>
          {(c.text || c.points.length > 0) && (
            <div className="sl-card-text">
              {c.text && <p>{c.text}</p>}
              {c.points.length > 0 && <ul>{c.points.map((x, k) => <li key={k}>{x}</li>)}</ul>}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function People({ sl }: { sl: SlideView }) {
  if (!sl.people.length) return null
  return (
    <div className="sl-people">
      {sl.people.map((p, i) => (
        <div key={p.name} className={`sl-person st-${TONES[i % TONES.length]}`}>
          {p.photo ? <img className="sl-photo" src={p.photo} alt="" /> : <div className="sl-photo" aria-hidden="true">{initials(p.name)}</div>}
          <div className="nm">{p.name}</div>
          {p.role && <div className="rl">{p.role}</div>}
        </div>
      ))}
    </div>
  )
}

function Figures({ sl }: { sl: SlideView }) {
  if (!sl.figures.length) return null
  return (
    <div className="sl-figs" style={{ '--n': sl.figures.length } as CSSProperties}>
      {sl.figures.map((f, i) => (
        <figure key={i} className={`sl-fig st-${f.tone}`}>
          {f.image ? <img src={f.image} alt="" /> : <div className="ph" aria-hidden="true">{f.caption ?? ''}</div>}
          <figcaption><div className="ft">{f.title}</div>{f.caption && f.image && <div className="fc">{f.caption}</div>}</figcaption>
        </figure>
      ))}
    </div>
  )
}

function References({ sl }: { sl: SlideView }) {
  if (!sl.references.length) return null
  return <ol className="sl-refs">{sl.references.map((r, i) => <li key={i}>{r}</li>)}</ol>
}

/**
 * The slide. `meta` is the line at the top right, such as the title of the section.
 */
export function SlideBody({ sl, joinUrl, meta, style }: {
  sl: SlideView; joinUrl: string; meta?: ReactNode; style?: CSSProperties
}) {
  const side = <Side sl={sl} />
  const hasSide = !!(sl.image || sl.stat || sl.charts.length)
  let main: ReactNode
  switch (sl.layout) {
    case 'title':
      // The welcome slide: the title, the people and a line on the left, the code beside them.
      return (
        <div className="sl lay-title" style={style}>
          {meta && <div className="sl-meta">{meta}</div>}
          <div className={`sl-main${sl.qr ? ' with-qr' : ''}`}>
            <div className="sl-col">
              <div className="sl-head">
                <h1 className="sl-title">{sl.title}</h1>
                {sl.subtitle && <div className="sl-sub">{sl.subtitle}</div>}
              </div>
              <People sl={sl} />
              <Bullets items={sl.bullets} small />
            </div>
            <QrBox sl={sl} joinUrl={joinUrl} />
          </div>
        </div>
      )
    case 'cards':
      main = (
        <div className={`sl-main${hasSide ? ' two' : ''}`}>
          <div className="sl-col">
            <Cards sl={sl} />
            <Bullets items={sl.bullets} small />
          </div>
          {side}
        </div>
      )
      break
    case 'figures':
      main = (
        <div className="sl-main">
          <div className="sl-col">
            <Figures sl={sl} />
            <Bullets items={sl.bullets} small />
          </div>
        </div>
      )
      break
    case 'standings':
      main = (
        <div className="sl-main">
          <div className="sl-col">
            <Standings sl={sl} />
            <Bullets items={sl.bullets} small />
          </div>
        </div>
      )
      break
    case 'closing':
      main = (
        <div className={`sl-main${sl.qr ? ' with-qr' : ''}`}>
          <div className="sl-col">
            <Bullets items={sl.bullets} small />
            <References sl={sl} />
            <People sl={sl} />
          </div>
          <QrBox sl={sl} joinUrl={joinUrl} />
        </div>
      )
      break
    default:
      // Two charts stand side by side under the bullets, each with room for its bars.
      if (sl.charts.length > 1) {
        main = (
          <div className="sl-main">
            <div className="sl-col">
              <Bullets items={sl.bullets} />
              <div className="sl-charts">{sl.charts.map((ch) => <Chart key={ch.title} ch={ch} />)}</div>
            </div>
          </div>
        )
        break
      }
      main = (
        <div className={`sl-main${hasSide || sl.qr ? ' two' : ''}`}>
          <div className="sl-col">
            <Bullets items={sl.bullets} />
            <Cards sl={sl} />
          </div>
          {side}
          {!hasSide && <QrBox sl={sl} joinUrl={joinUrl} />}
        </div>
      )
  }
  return (
    <div className={`sl lay-${sl.layout}`} style={style}>
      {meta && <div className="sl-meta">{meta}</div>}
      <div className="sl-head">
        <h1 className="sl-title">{sl.title}</h1>
        {sl.subtitle && <div className="sl-sub">{sl.subtitle}</div>}
      </div>
      {main}
    </div>
  )
}

/**
 * A slide at a fixed width, scaled as one block and never laid out again: the previews of the
 * host console, and the slide on a player's screen, which is the projector's slide at the size
 * the screen allows, like a video.
 */
export function SlideThumb({ sl, joinUrl, width, theme, meta, plain = false }: {
  sl: SlideView; joinUrl: string; width: number; theme?: 'light' | 'dark'; meta?: ReactNode; plain?: boolean
}) {
  const k = width / SLIDE_W
  return (
    <div className={`sl-thumb${plain ? ' plain' : ''}${theme ? ` theme-${theme}` : ''}`} style={{ width, height: Math.round(SLIDE_H * k) }}>
      <div style={{ width: SLIDE_W, height: SLIDE_H, transform: `scale(${k})`, transformOrigin: 'top left', display: 'flex', '--u': '1px' } as CSSProperties}>
        <SlideBody sl={sl} joinUrl={joinUrl} meta={meta} />
      </div>
    </div>
  )
}
