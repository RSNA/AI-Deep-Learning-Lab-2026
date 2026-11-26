// The chart of the year (engineering spec, section 10.6): one slot for every period of two
// months, and three lines over the periods that have a report: validity, reliability and the
// score of the period. A faint mark shows what the map of that period scored on the test set.
// It draws what it is given and knows nothing of the phase.
import { P3 } from './copy.ts'

export type ChartPoint = { validity: number; reliability: number; value: number; test: number | null }

const W = 560, H = 230
const PAD = { l: 34, r: 14, t: 12, b: 30 }

/** The lowest tick of the axis: a ten below the lowest number shown, and never above 50. */
export function axisFloor(points: ChartPoint[]): number {
  const all = points.flatMap((p) => [p.validity, p.reliability, p.value, ...(p.test === null ? [] : [p.test])])
  if (!all.length) return 50
  const low = Math.floor(Math.min(...all) / 10) * 10 - 10
  return Math.max(0, Math.min(50, low))
}

/** The ticks of the axis, from the floor to 100, four or five of them. */
export function axisTicks(floor: number): number[] {
  const step = 100 - floor > 60 ? 25 : 10
  const out: number[] = []
  for (let v = 100; v >= floor - 1e-9; v -= step) out.push(v)
  if (out.at(-1) !== floor) out.push(floor)
  return out.reverse()
}

export function YearChart({ slots, points, selected, onSelect }: {
  /** The short label of every period of the year, in order. */
  slots: string[]
  /** One point for every period that has a report, in order. Numbers from 0 to 100. */
  points: ChartPoint[]
  selected: number | null
  onSelect?: (index: number) => void
}) {
  const floor = axisFloor(points)
  const ticks = axisTicks(floor)
  const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b
  const n = Math.max(1, slots.length)
  const x = (i: number) => PAD.l + (iw * (i + 0.5)) / n
  const y = (v: number) => PAD.t + ih * (1 - (Math.max(floor, Math.min(100, v)) - floor) / (100 - floor))
  const path = (get: (p: ChartPoint) => number) => points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(get(p)).toFixed(1)}`).join(' ')
  const series = [
    { key: 'validity', label: P3.validity, get: (p: ChartPoint) => p.validity },
    { key: 'reliability', label: P3.reliability, get: (p: ChartPoint) => p.reliability },
    { key: 'score', label: P3.scoreShort, get: (p: ChartPoint) => p.value },
  ] as const
  const summary = points.length
    ? points.map((p, i) => `${slots[i]}: ${P3.validity} ${Math.round(p.validity)}, ${P3.reliability} ${Math.round(p.reliability)}, ${P3.scoreShort} ${Math.round(p.value)}`).join('. ')
    : P3.chartEmpty
  return (
    <div className="ychart">
      <div className="ylegend" aria-hidden="true">
        {series.map((s) => <span key={s.key} className={`yl ${s.key}`}><i />{s.label}</span>)}
        <span className="yl test"><i />{P3.testMark}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${P3.chartTitle}. ${summary}`} preserveAspectRatio="xMidYMid meet">
        {ticks.map((t) => (
          <g key={t}>
            <line className="ygrid" x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} />
            <text className="ytick" x={PAD.l - 6} y={y(t) + 4} textAnchor="end">{t}</text>
          </g>
        ))}
        {slots.map((s, i) => {
          const has = i < points.length
          return (
            <g key={s} className={`yslot${has ? ' has' : ''}${selected === i ? ' on' : ''}`}>
              {selected === i && <rect className="yband" x={PAD.l + (iw * i) / n + 2} y={PAD.t} width={iw / n - 4} height={ih} />}
              <text className="yx" x={x(i)} y={H - 10} textAnchor="middle">{s}</text>
            </g>
          )
        })}
        {points.map((p, i) => (p.test === null ? null : <line key={i} className="ytest" x1={x(i) - 16} x2={x(i) + 16} y1={y(p.test)} y2={y(p.test)} />))}
        {series.map((s) => <path key={s.key} className={`yline ${s.key}`} d={path(s.get)} />)}
        {series.map((s) => points.map((p, i) => <rect key={`${s.key}${i}`} className={`ydot ${s.key}`} x={x(i) - 4} y={y(s.get(p)) - 4} width={8} height={8} />))}
        {/* The slots that have a report take a press: the report of that period shows beside the chart. */}
        {onSelect && points.map((_p, i) => (
          <rect key={i} className="yhit" x={PAD.l + (iw * i) / n} y={PAD.t} width={iw / n} height={ih + PAD.b} role="button" tabIndex={0}
            aria-label={P3.showReport(slots[i] ?? '')} aria-pressed={selected === i}
            onClick={() => onSelect(i)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(i) } }} />
        ))}
      </svg>
    </div>
  )
}
