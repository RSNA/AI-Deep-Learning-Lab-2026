// Parts of the host console that every host may use, in charge or not (engineering spec,
// section 10.8): one player beside the key, and a look through the deck that the room does not
// see.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { SystemRef } from '@lab02/protocol'
import type { HostDeck, HostInspect } from '@lab02/protocol/host'
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
        {p.classify !== null && p.flagship !== null && <span className="inspect-tally muted">{H.scoreLine(p.classify, p.flagship)}</span>}
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

/**
 * A host's own look through the deck. Nothing here reaches the room: it reads the deck over HTTP
 * and keeps its place in this browser tab only.
 */
export function OwnDeck({ token, code, joinUrl, shown, stage }: { token: string; code: string; joinUrl: string; shown: number; stage: string }) {
  const [open, setOpen] = useState(false)
  const [deck, setDeck] = useState<HostDeck | null>(null)
  const [at, setAt] = useState(shown)
  const box = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(360)
  const load = useCallback(async () => {
    const r = await hostFetch<HostDeck>(token, `/api/host/deck/${code}`)
    if (r.ok) setDeck(r.data)
  }, [token, code])
  // The deck is read when the panel opens and again when the stage changes, because a slide may
  // show a number of the room that only exists after a phase.
  useEffect(() => { if (open) void load() }, [open, load, stage])
  useLayoutEffect(() => {
    const el = box.current
    if (!el || !open) return
    const fit = () => setW(Math.max(220, Math.min(720, el.clientWidth)))
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    fit()
    return () => ro.disconnect()
  }, [open])
  const n = deck?.slides.length ?? 0
  const cur = deck?.slides[Math.max(0, Math.min(n - 1, at))]
  return (
    <section className="panel owndeck">
      <div className="panel-head lav">{H.ownDeck}</div>
      <div className="panel-body">
        <div className="hint">{H.ownDeckLine}</div>
        {!open && <button type="button" className="btn small text" style={{ alignSelf: 'flex-start' }} onClick={() => { setAt(shown); setOpen(true) }}>{H.ownDeckOpen}</button>}
        {open && (
          <>
            <div className="ctl-row owndeck-nav">
              <button type="button" className="btn small" onClick={() => setAt(Math.max(0, at - 1))} disabled={at <= 0}>{H.prev}</button>
              <span className="num slidecount">{H.slideOf(Math.min(n, at + 1), n)}</span>
              <button type="button" className="btn small" onClick={() => setAt(Math.min(n - 1, at + 1))} disabled={at >= n - 1}>{H.next}</button>
              <button type="button" className="btn small text" onClick={() => setAt(shown)} disabled={at === shown}>{H.ownDeckToShown}</button>
              <button type="button" className="btn small text" onClick={() => setOpen(false)}>{H.ownDeckClose}</button>
            </div>
            <div ref={box} className="owndeck-box">
              {cur ? <SlideThumb sl={cur.slide} joinUrl={joinUrl} width={w} /> : <div className="muted">{H.loading}</div>}
            </div>
            {cur && <div className="notes"><b>{H.notes}</b><span>{cur.notes ?? H.noNotes}</span></div>}
          </>
        )}
      </div>
    </section>
  )
}
