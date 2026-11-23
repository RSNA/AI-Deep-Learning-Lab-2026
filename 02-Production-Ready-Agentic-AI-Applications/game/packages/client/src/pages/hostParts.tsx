// Parts of the host console that every host may use, in charge or not (engineering spec,
// section 10.8): one player beside the key, and a look through the deck that the room does not
// see until the host in charge shows a slide.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { SystemRef } from '@lab02/protocol'
import type { HostDeck, HostInspect, HostView } from '@lab02/protocol/host'
import { PHASE_NUMBER } from '../copy.ts'
import { hostFetch } from '../lib/net.ts'
import { Avatar, SystemShape } from '../components/ui.tsx'
import { SlideThumb } from '../components/slide.tsx'
import { Marks } from '../lib/marks.tsx'
import { H } from './hostCopy.ts'
import { Grid } from '../canvas/Grid.tsx'
import { tileNames } from '../canvas/model.ts'
import { gridWords, reasonText } from '../phase2/Phase2.tsx'
import { runCost } from '../phase2/copy.ts'

type Mark = 'right' | 'near' | 'wrong' | 'unsorted'
const MARK_ICON: Record<Mark, string> = { right: '✓', near: '≈', wrong: '✗', unsorted: '–' }

/**
 * A player's Phase 1 beside the key: every problem under its true class, from the agent project
 * down, with the player's pick, a mark, and the reason behind a "Why".
 */
function PlanningInspect({ p }: { p: NonNullable<HostInspect['planning']> }) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  // The ladder from the top: the class with the most automation first (section 10.4).
  const classes = p.classes.map((c, tone) => ({ c, tone })).reverse()
  const count = (m: Mark) => p.problems.filter((x) => x.mark === m).length
  const short = (id: string | null) => (id ? p.classes.find((c) => c.id === id)?.short ?? id : null)
  const toneOf = (id: string | null) => Math.max(0, p.classes.findIndex((c) => c.id === id))
  return (
    <div className="inspect">
      <div className="inspect-top">
        <span className={`chip ${p.status === 'playing' ? 'sun' : 'good'}`}>{H.st[p.status]}</span>
        <span className="chip">{H.insightsOf(p.insights, p.investigations)}</span>
        <span className="inspect-tally">{H.tally(count('right'), count('near'), count('wrong'), count('unsorted'))}</span>
        {p.classify !== null && p.flagship !== null && <span className="inspect-tally muted">{H.scoreLine(p.classify, p.flagship, p.economy)}</span>}
      </div>
      <div className="hint">{H.runningNow(p.running)}</div>
      <div className="inspect-legend" aria-label={H.legend}>
        {(['right', 'near', 'wrong', 'unsorted'] as const).map((m) => (
          <span key={m} className={`rpick mark-${m}`}><span className="rmark" aria-hidden="true">{MARK_ICON[m]}</span>{H.markLine[m]}</span>
        ))}
      </div>
      <div className="inspect-grid">
        {classes.map(({ c, tone }) => {
          const here = p.problems.filter((x) => x.truth === c.id)
          return (
            <div key={c.id} className="rbin">
              <div className={`rhead tone-${tone % 4}`}><span>{c.label}</span><span className="num">{here.length}</span></div>
              {here.map((x) => {
                const isOpen = open.has(x.id)
                return (
                  <div key={x.id} className={`rprob${isOpen ? ' open' : ''}`}>
                    <div className="rprob-top">
                      <span className="rtitle">{x.title}{x.flagship && <span className="tagchip flagtag" style={{ marginLeft: 8 }}>{H.agentProject}</span>}</span>
                      {x.points !== null && <span className="num rpts">{H.pts(x.points)}</span>}
                    </div>
                    <div className="rprob-mid">
                      <div className={`rpick mark-${x.mark}`}>
                        <span className="rmark" aria-label={H.mark[x.mark]}>{MARK_ICON[x.mark]}</span>
                        <span>{H.theirPick}</span>
                        {x.picked ? <span className={`pchip tone-${toneOf(x.picked) % 4}`}>{short(x.picked)}</span> : <span className="muted">{H.notSorted}</span>}
                        {x.picked && <span className="muted">· {H.mark[x.mark].toLowerCase()}</span>}
                      </div>
                      <button type="button" className="whybtn" aria-expanded={isOpen} onClick={() => toggle(x.id)}>{isOpen ? `${H.hideWhy} ▴` : `${H.why} ▾`}</button>
                    </div>
                    {isOpen && (
                      <div className="rprob-body">
                        <p><Marks text={x.rationale} /></p>
                        <p className="note">{x.tier !== null ? H.rung(x.tier) : H.noRung}</p>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
      <details className="inspect-done">
        <summary>{H.doneSoFar} · {p.done.length}</summary>
        {p.done.length ? <ul>{p.done.map((t) => <li key={t}>{t}</li>)}</ul> : <div className="muted">{H.noneDone}</div>}
      </details>
    </div>
  )
}

/**
 * A player's Phase 2 beside the key: the draft map drawn read-only, the money, the actions and
 * every validation, and beside them what only the key knows: the share solved of every case
 * for the draft, every flag of the scoring, and the reference map.
 */
function DevelopmentInspect({ d }: { d: NonNullable<HostInspect['development']> }) {
  const [shown, setShown] = useState<string | null>(null)
  const none = { stray: d.key.flags.stray, incomplete: [], privateData: d.key.flags.privateData }
  const raised = Object.entries(d.key.flags).filter(([, ids]) => ids.length > 0)
  const names = tileNames(d.map, d.legend)
  const v = d.validations.find((x) => x.id === shown)
  const minutes = d.pools.map((pl) => `${pl.label} ${d.key.running.minutes[pl.id] ?? 0} of ${pl.max}`).join(' · ')
  return (
    <div className="inspect">
      <div className="inspect-top">
        <span className={`chip ${d.status === 'playing' ? 'sun' : 'good'}`}>{H.dev[d.status]}</span>
        <span className="chip">{H.dev.money(d.money)}</span>
        <span className="chip">{H.dev.devs(d.developers.free, d.developers.total)}</span>
      </div>
      <div className="eyebrow">{H.dev.draft}</div>
      <div className="gridscroll insp-map"><Grid v={d.legend} map={d.map} flags={none} compact words={gridWords} label={H.dev.draft} /></div>
      <div className="hint">{d.ready.ok && d.key.accuracy !== null ? H.dev.ready(d.key.accuracy) : H.dev.notReady(d.ready.reasons.map((r) => reasonText(r, d.pools)).join(' '))} {H.dev.running(runCost(d.key.running.money), minutes, d.key.running.complexity)}</div>
      <div className="insp-two">
        <div>
          <div className="eyebrow">{H.dev.validations}</div>
          {d.validations.length ? (
            <div className="insp-vals">
              {d.validations.map((x) => (
                <button key={x.id} type="button" className={`hchip${shown === x.id ? ' on' : ''}${d.submitId === x.id ? ' send' : ''}`} onClick={() => setShown(shown === x.id ? null : x.id)}>
                  {x.id} · {Math.round(100 * x.accuracy)}%{d.submitId === x.id ? ` · ${H.dev.sends}` : ''}
                </button>
              ))}
            </div>
          ) : <div className="muted">{H.dev.noValidations}</div>}
          {v && <div className="gridscroll insp-map"><Grid v={d.legend} map={v.map} compact words={gridWords} /></div>}
          <div className="eyebrow" style={{ marginTop: 8 }}>{H.dev.actions}</div>
          <div className="insp-acts">{d.actions.map((a) => <span key={a.id} className={`chip ${a.state === 'done' ? 'good' : a.state === 'running' ? 'sun' : ''}`}>{a.title} · {H.dev.state[a.state]}</span>)}</div>
        </div>
        <div>
          <div className="eyebrow">{H.dev.key} · {H.dev.cases}</div>
          <div className="insp-cases">
            {d.key.cases.map((k) => (
              <div key={k.id} className="kv"><span>{k.title} <span className="muted">· {H.dev.weight} {k.weight}</span></span><span className="v">{k.solved === null ? '–' : `${Math.round(100 * k.solved)}%`}</span></div>
            ))}
          </div>
          <div className="eyebrow" style={{ marginTop: 8 }}>{H.dev.flags}</div>
          {raised.length ? <ul className="insp-flags">{raised.map(([k, ids]) => <li key={k}>{H.dev.flagName[k]}: {ids.map((id) => names.get(id)?.label ?? id).join(', ')}</li>)}</ul> : <div className="muted">{H.dev.noFlags}</div>}
        </div>
      </div>
      <details className="inspect-done">
        <summary>{H.dev.reference(d.key.reference.accuracy)}</summary>
        <div className="gridscroll insp-map"><Grid v={d.legend} map={d.key.reference.map} compact words={gridWords} /></div>
        <p style={{ fontSize: 14 }}>{d.key.reference.summary}</p>
      </details>
    </div>
  )
}

/** One player as a host sees them. The phases that have something to show are tabs. */
export function Inspector({ view, systems }: { view: HostInspect; systems: SystemRef[] }) {
  const sys = systems.find((s) => s.id === view.system)
  const tabs = (['planning', 'development'] as const).filter((ph) => view[ph] !== null)
  const [tab, setTab] = useState<'planning' | 'development'>(() => tabs.at(-1) ?? 'planning')
  return (
    <div className="inspector">
      <div className="inspect-who">
        <Avatar id={view.avatar} size={44} />
        <div style={{ minWidth: 0 }}>
          <div className="pname" style={{ fontSize: 20 }}>{view.name}</div>
          <div className="muted" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 700 }}>
            <SystemShape index={sys?.index ?? 0} size={12} />{sys?.name}
            <span className={view.connected ? 'good' : 'bad'}>· {view.connected ? H.onlineNow : H.offlineNow}</span>
          </div>
        </div>
        <div className="inspect-pts"><span className="num">{view.points.total}</span><span className="hint">{H.points}</span></div>
      </div>
      <div className="hint">{H.inspectLine}</div>
      {tabs.length > 1 && (
        <div className="seg" role="tablist">
          {tabs.map((t) => <button key={t} role="tab" aria-selected={tab === t} aria-pressed={tab === t} onClick={() => setTab(t)}>{H.phaseTab(PHASE_NUMBER[t])}</button>)}
        </div>
      )}
      {tab === 'development' && view.development ? <DevelopmentInspect d={view.development} />
        : view.planning ? <PlanningInspect p={view.planning} /> : <div className="muted">{H.notStarted}</div>}
    </div>
  )
}

type DeckView = HostView['deck']
type Group = { id: string; title: string; items: { i: number; slide: HostDeck['slides'][number] }[] }

/**
 * Every slide of the deck as a small button, by section. The shown slide carries a tag, the slide
 * looked at a frame. Drawn again only when the deck, the two cursors or the theme change.
 */
const DeckStrip = memo(function DeckStrip({ groups, at, shown, pick, joinUrl, theme }: {
  groups: Group[]; at: number; shown: number; pick: (i: number) => void; joinUrl: string; theme: 'light' | 'dark'
}) {
  const box = useRef<HTMLDivElement>(null)
  // The slide looked at stays in view: the strip scrolls sideways, never the page.
  useEffect(() => {
    const c = box.current
    const el = c?.querySelector<HTMLElement>('.stripbtn.at')
    if (!c || !el) return
    const l = el.offsetLeft
    if (l < c.scrollLeft) c.scrollLeft = Math.max(0, l - 8)
    else if (l + el.offsetWidth > c.scrollLeft + c.clientWidth) c.scrollLeft = l + el.offsetWidth - c.clientWidth + 8
  }, [at, groups])
  return (
    <div ref={box} className="deckstrip">
      {groups.map((g) => (
        <div key={g.id} className="stripsec">
          <div className="stripsec-title" title={g.title}>{g.title}</div>
          <div className="stripsec-row">
            {g.items.map(({ i, slide }) => (
              <button key={i} type="button" className={`stripbtn${i === at ? ' at' : ''}${i === shown ? ' shown' : ''}`}
                aria-label={H.stripLabel(i + 1, i === shown)} aria-current={i === at ? 'true' : undefined} onClick={() => pick(i)}>
                <SlideThumb sl={slide.slide} joinUrl={joinUrl} width={112} theme={theme} />
                <span className="stripnum"><span className="num">{i + 1}</span>{i === shown && <span className="flag">{H.shownTag}</span>}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
})

/**
 * The host's look through the deck, beside the shown slide (section 10.8). The look moves a cursor
 * of this browser tab only and reads the deck over HTTP, so nothing reaches the room until the
 * host in charge presses "Show this slide", which goes through the same command as Next. A cursor
 * on the shown slide follows it; one elsewhere stays where it is.
 */
export function SlideLook({ token, code, joinUrl, deck, shown, at, lookTo, show, canAct, stage, theme, onSlides, refusal }: {
  token: string; code: string; joinUrl: string; deck: DeckView; shown: number; at: number
  lookTo: (i: number) => void; show: () => void; canAct: boolean; stage: string; theme: 'light' | 'dark'; onSlides: boolean; refusal?: string
}) {
  const [all, setAll] = useState<HostDeck | null>(null)
  const [failed, setFailed] = useState(false)
  const load = useCallback(async () => {
    const r = await hostFetch<HostDeck>(token, `/api/host/deck/${code}`)
    if (r.ok) { setAll(r.data); setFailed(false) } else setFailed(true)
  }, [token, code])
  // The deck is read again when the stage changes, because a slide may show a number of the room
  // that only exists after a phase.
  useEffect(() => { void load() }, [load, stage, deck.count])
  const box = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(480)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const fit = () => setW(Math.max(220, Math.min(640, el.clientWidth)))
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    fit()
    return () => ro.disconnect()
  }, [])
  const pickRef = useRef(lookTo)
  pickRef.current = lookTo
  const pick = useCallback((i: number) => pickRef.current(i), [])
  const sectionsKey = deck.sections.map((x) => `${x.id}:${x.start}:${x.count}:${x.title}`).join('|')
  const groups = useMemo<Group[]>(() => {
    if (!all) return []
    return deck.sections.map((x) => ({
      id: x.id, title: x.title,
      items: all.slides.slice(x.start, x.start + x.count).map((slide, k) => ({ i: x.start + k, slide })),
    }))
    // The sections are read through their key, so a new view of the same deck draws nothing again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, sectionsKey])
  const n = deck.count
  const here = at === shown
  // The shown slide comes live with the view; any other from the deck read over HTTP.
  const cur = here ? deck.current : all?.slides[at] ?? null
  const section = deck.sections.find((x) => at >= x.start && at < x.start + x.count)
  const line = !canAct ? H.lookNotInCharge : here ? H.lookHere : onSlides ? H.lookAway(shown + 1) : H.lookNotOnSlides(shown + 1)
  return (
    <div className="group looker">
      <div className="eyebrow">{H.look}</div>
      <div className="hint">{H.lookLine} {H.lookKeys(canAct)}</div>
      <div className="looknav">
        <button type="button" className="btn small" onClick={() => lookTo(at - 1)} disabled={at <= 0}>{H.lookBack}</button>
        <span className="num slidecount" role="status">{H.lookOf(at + 1, n, shown + 1)}</span>
        <button type="button" className="btn small" onClick={() => lookTo(at + 1)} disabled={at >= n - 1}>{H.lookAhead}</button>
      </div>
      <div className="lookacts">
        <button type="button" className="btn small text go" onClick={show} disabled={!canAct || here}>{H.lookShow}</button>
        <button type="button" className="btn small text" onClick={() => lookTo(shown)} disabled={here}>{H.lookToShown}</button>
      </div>
      <div className={`hint${here ? '' : ' lookstate'}`} role="status">{line}</div>
      {refusal && <div className="err refusal" role="alert">{refusal}</div>}
      <div className="lookhead">
        <span className="sectitle">{section?.title}</span>
        {here ? <span className="flag">{H.shownNow}</span> : <span className="flag look">{H.onlyYou}</span>}
        {cur?.placeholder && <span className="flag warn">{H.placeholder}</span>}
      </div>
      <div ref={box} className="lookbox">
        {cur ? <SlideThumb sl={cur.slide} joinUrl={joinUrl} width={w} theme={theme} />
          : <div className="muted lookempty" style={{ width: w, height: Math.round(w * 820 / 1920) }}>{failed ? H.lookNoDeck : H.loading}</div>}
      </div>
      {failed && <button type="button" className="btn small text" style={{ alignSelf: 'flex-start' }} onClick={() => void load()}>{H.lookRetry}</button>}
      <div className="notes"><b>{H.notes}</b><span>{cur ? cur.notes ?? H.noNotes : H.loading}</span></div>
      <label className="lbl" htmlFor="look-section">{H.lookSection}</label>
      <select id="look-section" className="field slim" value={section?.id ?? ''}
        onChange={(e) => { const sec = deck.sections.find((x) => x.id === e.target.value); if (sec) lookTo(sec.start) }}>
        {deck.sections.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
      </select>
      {groups.length > 0 && <DeckStrip groups={groups} at={at} shown={shown} pick={pick} joinUrl={joinUrl} theme={theme} />}
    </div>
  )
}
