// Phase 2 for the player (engineering spec, section 10.5). On a laptop three titled columns side
// by side, Actions, the map and the Toolbox, with the last validation and the insights below
// them. Below 1024 px the same parts as four tabs: Map, Actions, Toolbox, Results. Then the
// reveal. The canvas, the shelves, the toolbox and the action list come from ../canvas and know
// nothing of this phase.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CanvasMap, DevelopmentContent, DevelopmentView, Welcome } from '@lab02/protocol'
import { Grid, type Mode, type Part, type Selection } from '../canvas/Grid.tsx'
import { addLine, lineKey, moveTile, placeTile, removeLine, removeTile, setPart, targetsOf, tileAt, tileOf, type Vocabulary } from '../canvas/model.ts'
import { ActionList, ItemSheet, PartSheet, PromptSheet, Shelves, Toolbox, type ActionRow, type Item } from '../canvas/Panels.tsx'
import { Portrait } from '../components/ui.tsx'
import { gameNow, useTick } from '../lib/clock.ts'
import { plainError } from '../lib/errors.ts'
import { Paragraphs } from '../lib/marks.tsx'
import { usePlayer } from '../lib/player.ts'
import { store } from '../lib/storage.ts'
import { TileBody } from '../phase1/Cards.tsx'
import { BriefSheet, PHONE_BELOW, useNarrow, useWarnings } from '../phase1/Phase1.tsx'
import { P2 } from './copy.ts'
import { DevReveal } from './Reveal.tsx'
import { useMap } from './useMap.ts'

// ------------------------------------------------------------------------------------------
// What the canvas needs from the content
// ------------------------------------------------------------------------------------------
export function vocabularyOf(c: DevelopmentContent): Vocabulary {
  return {
    cols: c.rules.cols, rows: c.rules.rows,
    sources: c.sources.map((s) => ({ id: s.id, label: s.label, icon: s.icon, privateData: s.privateData })),
    result: { id: c.result.id, label: c.result.label },
    workers: c.workers.map((w) => ({ id: w.id, kind: w.kind, label: w.label, short: w.short, icon: w.icon, needsModel: w.needsModel, models: w.models })),
    models: c.models.map((m) => ({ id: m.id, label: m.label, short: m.short, runsOn: m.runsOn })),
    compute: c.compute.map((x) => ({ id: x.id, label: x.label, short: x.short, protectsPrivateData: x.protectsPrivateData })),
    prompts: c.prompts.map((p) => ({ id: p.id, label: p.label })),
  }
}

/** The title of the action that opens each locked item. */
export function lockedByOf(c: DevelopmentContent): Record<string, string> {
  const out: Record<string, string> = {}
  for (const a of c.actions) for (const id of a.unlocks) if (!out[id]) out[id] = a.title
  return out
}

export const gridWords = { ...P2.grid, pickModel: P2.pickModel, pickCompute: P2.pickCompute, defaultPrompt: P2.defaultPrompt, locked: P2.locked, lockedNoAction: P2.lockedNoAction, model: P2.model, compute: P2.compute, prompt: P2.prompt }

const labelOf = (c: DevelopmentContent, id: string): string =>
  c.sources.find((x) => x.id === id)?.label ?? c.workers.find((x) => x.id === id)?.label ?? c.models.find((x) => x.id === id)?.label
  ?? c.compute.find((x) => x.id === id)?.label ?? c.prompts.find((x) => x.id === id)?.label ?? (c.result.id === id ? c.result.label : id)

/** The first reason the map cannot be validated, in words. */
function readySentence(c: DevelopmentContent, reasons: string[]): string | null {
  const r = reasons[0]
  if (!r) return null
  if (r.startsWith('too_many_minutes:')) return P2.ready.minutes(c.rules.pools.find((x) => x.id === r.split(':')[1])?.label ?? '')
  return (P2.ready as unknown as Record<string, string | undefined>)[r] ?? P2.ready.nothing_reaches_result
}

// ------------------------------------------------------------------------------------------
// Small parts
// ------------------------------------------------------------------------------------------
function Toast({ text, onShow, onClose }: { text: string; onShow?: () => void; onClose: () => void }) {
  useEffect(() => { const id = setTimeout(onClose, 6000); return () => clearTimeout(id) }, [text, onClose])
  return (
    <div className="toast p2toast" role="status">
      <span>{text}</span>
      {onShow && <button type="button" className="btn small" onClick={() => { onShow(); onClose() }}>{P2.show}</button>}
    </div>
  )
}

/** Money, developers and validations: what the phase spends, in one quiet strip. */
export function Purse({ dv, content }: { dv: DevelopmentView; content: DevelopmentContent }) {
  return (
    <div className="purse" aria-label={`${P2.money} ${dv.money}. ${P2.developers} ${P2.freeOf(dv.developers.free, dv.developers.total)}. ${P2.validations} ${P2.left(dv.validationsLeft)}`}>
      <span className="pf"><span className="pl">{P2.money}</span><b className="num">{Math.round(dv.money * 10) / 10}</b></span>
      <span className="pf"><span className="pl">{P2.developers}</span><span className="devs" aria-hidden="true">{Array.from({ length: dv.developers.total }, (_, i) => <i key={i} className={i < dv.developers.total - dv.developers.free ? 'held' : ''} />)}</span><b>{P2.freeOf(dv.developers.free, dv.developers.total)}</b></span>
      <span className="pf" title={`${dv.validationsLeft} of ${content.rules.validations}`}><span className="pl">{P2.validations}</span><b>{P2.left(dv.validationsLeft)}</b></span>
    </div>
  )
}

function RunningLine({ dv, content }: { dv: DevelopmentView; content: DevelopmentContent }) {
  const r = dv.running
  return (
    <div className="runline">
      {r && (
        <span>
          <b>{P2.toRun}</b> {P2.perMonth(r.money)}
          {content.rules.pools.map((pl) => <span key={pl.id} className={(r.minutes[pl.id] ?? 0) > pl.max ? 'over' : ''}> · {P2.minutes(pl.label, r.minutes[pl.id] ?? 0, pl.max)}</span>)}
        </span>
      )}
      {dv.flags.privateData.length > 0 && <span className="pwarn"><span className="cmark warn" aria-hidden="true">!</span> {P2.privateWarn}</span>}
    </div>
  )
}

function ValidateButton({ dv, content, onValidate, refused }: { dv: DevelopmentView; content: DevelopmentContent; onValidate: () => void; refused: string | null }) {
  useTick(250)
  const clock = usePlayer((s) => s.clock)
  const now = clock ? gameNow(clock) : 0
  if (dv.validating) {
    const total = dv.validating.completesAtMs - dv.validating.startedAtMs
    const left = Math.max(0, dv.validating.completesAtMs - now)
    return (
      <div className="vbtn running" role="status">
        <span>{P2.validating(left / 1000)}</span>
        <span className="runbar"><i style={{ width: `${100 * (1 - left / Math.max(1, total))}%` }} /></span>
      </div>
    )
  }
  const reason = dv.validationsLeft <= 0 ? P2.noneLeft : readySentence(content, dv.ready.reasons)
  return (
    <div className="vwrap">
      {(reason || refused) && <span className="vwhy">{refused ?? reason}</span>}
      <button type="button" className="btn go vbtn" disabled={!!reason} onClick={onValidate}>{P2.validateLeft(dv.validationsLeft)}</button>
    </div>
  )
}

// ------------------------------------------------------------------------------------------
// The last validation, and every earlier one
// ------------------------------------------------------------------------------------------
export function ResultsPanel({ dv, onLoad, onChoose, readOnly = false }: { dv: DevelopmentView; onLoad: (m: CanvasMap) => void; onChoose: (id: string | null) => void; readOnly?: boolean }) {
  const [pick, setPick] = useState<string | null>(null)
  const last = dv.validations.at(-1)
  const shown = dv.validations.find((v) => v.id === pick) ?? last
  useEffect(() => { setPick(null) }, [dv.validations.length])
  if (!shown) return <section className="panel p2results" id="p2-results"><div className="panel-head sky">{P2.lastValidation}</div><div className="panel-body"><p className="muted">{P2.noValidation}</p></div></section>
  const best = dv.validations.reduce((b, v) => (v.accuracy > b.accuracy ? v : b), dv.validations[0]!)
  const sending = dv.submitId === shown.id
  return (
    <section className="panel p2results" id="p2-results">
      <div className="panel-head sky"><span>{shown === last ? P2.lastValidation : P2.validationOf(shown.id, shown.accuracy)}</span></div>
      <div className="panel-body">
        <div className="vtop">
          <div className="vacc"><span className="num">{P2.pct(shown.accuracy)}</span><span className="face">{P2.accuracy}</span></div>
          {shown.rank !== null && <span className="vrank">{P2.rank(shown.rank, shown.of)}</span>}
          <div className="vhist" aria-label={P2.earlier}>
            <span className="pl">{P2.earlier}</span>
            {dv.validations.map((v) => (
              <button key={v.id} type="button" className={`hchip${v.id === shown.id ? ' on' : ''}${dv.submitId === v.id ? ' send' : ''}`} aria-pressed={v.id === shown.id} onClick={() => setPick(v.id)}>
                {P2.pct(v.accuracy)}{dv.submitId === v.id ? ' ✓' : ''}
              </button>
            ))}
          </div>
        </div>
        {shown.missed && (
          <div className="vmiss">
            <div className="eyebrow">{P2.missedOne}</div>
            <p><b>{shown.missed.title}.</b> {shown.missed.text} <span className="why">{shown.missed.why}</span></p>
          </div>
        )}
        {shown.note && <div className="vnote"><b>{P2.note}:</b> {shown.note}</div>}
        {!readOnly && (
          <div className="vacts">
            <button type="button" className="btn small" onClick={() => onLoad(shown.map)}>{P2.loadMap}</button>
            {sending ? <span className="flag go">✓ {P2.willSend}</span> : <button type="button" className="btn small" onClick={() => onChoose(shown.id)}>{P2.useMap}</button>}
            {dv.submitId !== best.id && <button type="button" className="btn small" onClick={() => onChoose(null)}>{P2.backToDefault}</button>}
          </div>
        )}
        <p className="hint">{P2.defaultSend}</p>
      </div>
    </section>
  )
}

/** The insights of the phase: the opening letter first, then a card per action that brought one. */
export function InsightsPanel({ w, content, dv, fresh }: { w: Welcome; content: DevelopmentContent; dv: DevelopmentView; fresh: Set<string> }) {
  const b = content.brief
  const idx = b ? w.system.cast.findIndex((c) => c.id === b.from) : -1
  const from = idx >= 0 ? w.system.cast[idx] : undefined
  return (
    <section className="panel p2insights" id="p2-insights">
      <div className="panel-head lav"><span>{P2.insights}</span><span className="sub">{dv.insights.length}</span></div>
      <div className="panel-body">
        <div className="icards">
          {b && (
            <article className="card letter">
              <div className="chead h-letter"><span className="src">{P2.letterCard}{from ? ` · ${from.role}` : ''}</span></div>
              <div className="cbody">
                <h3>{b.title}</h3>
                {from && <div className="speaker"><Portrait c={from} cast={w.system.cast} index={idx} size={48} /><div><div className="nm">{from.name}</div><div className="rl">{from.role}</div></div></div>}
                <div className="letter-text"><Paragraphs text={b.text} /></div>
              </div>
            </article>
          )}
          {dv.insights.map((x) => {
            const a = content.actions.find((y) => y.id === x.action)
            return (
              <article key={x.action} className={`card${fresh.has(x.action) ? ' fresh' : ''}`} data-insight={x.action}>
                <div className={`chead h-g-${a?.group ?? 'learn'}`}><span className="src">{P2.fromAction(a?.title ?? '')}</span></div>
                <div className="cbody"><h3>{x.tile.headline}</h3><TileBody tile={x.tile} cast={w.system.cast} /></div>
              </article>
            )
          })}
        </div>
        {!dv.insights.length && <p className="muted">{P2.insightsEmpty}</p>}
      </div>
    </section>
  )
}

// ------------------------------------------------------------------------------------------
// The phase in play
// ------------------------------------------------------------------------------------------
type Tab = 'map' | 'actions' | 'toolbox' | 'results'
type Sheet = { kind: 'part'; tile: string; part: Part } | { kind: 'item'; item: Item } | null

function DevPlay({ w, content }: { w: Welcome; content: DevelopmentContent }) {
  useTick(500)
  const view = usePlayer((s) => s.view)!
  const dv = view.development!
  const send = usePlayer((s) => s.send)
  const clock = usePlayer((s) => s.clock)
  const phone = useNarrow(PHONE_BELOW)
  const v = useMemo(() => vocabularyOf(content), [content])
  const lockedBy = useMemo(() => lockedByOf(content), [content])
  const unlockedKey = dv.unlocked.join(',')
  const unlocked = useMemo(() => new Set(dv.unlocked), [unlockedKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const draft = useMap(v, unlocked, false)
  const map = draft.map
  const [mode, setMode] = useState<Mode>({ kind: 'idle' })
  const [sel, setSel] = useState<Selection>(null)
  const [sheet, setSheet] = useState<Sheet>(null)
  const [tab, setTab] = useState<Tab>('map')
  const [toast, setToast] = useState<{ text: string; show?: () => void } | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [refusedAction, setRefusedAction] = useState<{ id: string; text: string } | null>(null)
  const [refusedValidate, setRefusedValidate] = useState<string | null>(null)
  const [fresh, setFresh] = useState<Set<string>>(new Set())
  const briefFlag = `brief-development-${view.me.id}-${view.run}`
  const [briefOpen, setBriefOpen] = useState(() => !store.flag(briefFlag))
  const warning = useWarnings(P2.warn)
  const now = clock ? gameNow(clock) : 0

  const say = (text: string) => { setMsg(text); setTimeout(() => setMsg((m) => (m === text ? null : m)), 5000) }
  const reset = useCallback(() => { setMode({ kind: 'idle' }); setSel(null) }, [])

  // A validation that lands and an insight that lands are said without stealing the scroll.
  const seenV = useRef(dv.validations.length)
  const seenI = useRef(dv.insights.length)
  const showResults = () => { if (phone) setTab('results'); else document.getElementById('p2-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }
  const showInsights = () => { if (phone) setTab('results'); else document.getElementById('p2-insights')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }
  useEffect(() => {
    if (dv.validations.length > seenV.current) setToast({ text: P2.doneToast(dv.validations.at(-1)!.accuracy), show: showResults })
    seenV.current = dv.validations.length
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dv.validations.length])
  useEffect(() => {
    if (dv.insights.length > seenI.current) {
      const x = dv.insights.at(-1)!
      setToast({ text: P2.insightToast(content.actions.find((a) => a.id === x.action)?.title ?? ''), show: showInsights })
      setFresh((f) => new Set([...f, x.action]))
      setTimeout(() => setFresh((f) => { const n = new Set(f); n.delete(x.action); return n }), 8000)
    }
    seenI.current = dv.insights.length
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dv.insights.length])

  const commit = (next: CanvasMap) => { if (!draft.commit(next)) say(P2.refusedMap) }
  const nodeLabel = (id: string) => {
    const t = tileOf(map, id)
    return t ? content.workers.find((x) => x.id === t.kind)?.label ?? id : labelOf(content, id)
  }

  // --- the canvas
  const onCell = (col: number, row: number) => {
    if (mode.kind === 'place') {
      const r = placeTile(map, mode.worker, col, row)
      commit(r.map)
      setSel({ kind: 'tile', id: r.id })
      setMode({ kind: 'idle' })
    } else if (mode.kind === 'move') {
      const r = moveTile(map, mode.tile, col, row)
      commit(r.map)
      if (r.dropped) say(P2.dropped(r.dropped))
      setMode({ kind: 'idle' })
    }
  }
  const join = (from: string, to: string) => {
    if (!targetsOf(map, v, from).has(to)) return
    const replaced = to === v.result.id && map.lines.some((l) => l.to === v.result.id)
    commit(addLine(map, from, to, v.result.id))
    if (replaced) say(P2.replaced)
    setMode({ kind: 'idle' })
  }
  const onNode = (id: string) => {
    if (mode.kind === 'join') { if (id === mode.from) setMode({ kind: 'idle' }); else join(mode.from, id); return }
    if (mode.kind !== 'idle') return
    setSel((s) => (s?.kind === 'tile' && s.id === id ? null : { kind: 'tile', id }))
  }
  const onPort = (id: string) => {
    setSel(null)
    setMode((m) => (m.kind === 'join' && m.from === id ? { kind: 'idle' } : { kind: 'join', from: id }))
  }
  const remove = () => {
    if (sel?.kind === 'tile') commit(removeTile(map, sel.id))
    else if (sel?.kind === 'line') commit(removeLine(map, sel.key))
    setSel(null)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.closest('[role="dialog"]'))) return
      const mod = e.metaKey || e.ctrlKey
      if (e.key === 'Escape') { reset(); return }
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); remove(); return }
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) draft.redo(); else draft.undo(); return }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); draft.redo() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // --- actions
  const doneIds = new Set(dv.actionsDone.map((d) => d.id))
  const rows: ActionRow[] = content.actions.map((a) => {
    const run = dv.actionsRunning.find((r) => r.id === a.id)
    const base = { id: a.id, group: a.group, title: a.title, teaser: a.teaser, money: a.money, developers: a.developers, seconds: a.seconds, storyTime: a.storyTime, opens: a.unlocks.map((u) => labelOf(content, u)) }
    if (doneIds.has(a.id)) return { ...base, state: 'done' }
    if (run) {
      const left = Math.max(0, (run.completesAtMs - now) / 1000)
      return { ...base, state: 'running', left, share: 1 - left / a.seconds }
    }
    const first = a.requires.find((r) => !doneIds.has(r))
    if (first) return { ...base, state: 'blocked', blocked: P2.needsFirst(content.actions.find((x) => x.id === first)?.title ?? first) }
    if (a.money > dv.money + 1e-9) return { ...base, state: 'blocked', blocked: P2.needsMoney(a.money) }
    if (a.developers > dv.developers.free) return { ...base, state: 'blocked', blocked: P2.needsDevs(a.developers, dv.developers.free) }
    return { ...base, state: 'ready' }
  })
  const start = (id: string) => {
    void send('development.act', { id }).then((r) => {
      if (!r.ok) { setRefusedAction({ id, text: plainError(r.error) }); setTimeout(() => setRefusedAction((x) => (x?.id === id ? null : x)), 6000) }
    })
  }
  const validate = () => {
    void send('development.validate', {}).then((r) => {
      if (!r.ok) { setRefusedValidate(plainError(r.error)); setTimeout(() => setRefusedValidate(null), 6000) }
    })
  }
  const choose = (id: string | null) => { void send('development.choose', { id }) }

  // --- the bar of the map: what the player is doing, and what they can do with the selection
  const selTile = sel?.kind === 'tile' ? tileOf(map, sel.id) : undefined
  const selLine = sel?.kind === 'line' ? map.lines.find((l) => lineKey(l) === sel.key) : undefined
  const workerLabel = (kind: string) => content.workers.find((x) => x.id === kind)?.label ?? kind
  let hint: string = P2.hint.idle
  if (mode.kind === 'place') hint = P2.hint.place(workerLabel(mode.worker))
  else if (mode.kind === 'move') hint = P2.hint.move(nodeLabel(mode.tile))
  else if (mode.kind === 'join') hint = P2.hint.join(nodeLabel(mode.from))
  else if (selTile) hint = dv.flags.stray.includes(selTile.id) ? `${P2.hint.tile(workerLabel(selTile.kind))} ${P2.grid.stray}` : dv.flags.privateData.includes(selTile.id) ? `${P2.hint.tile(workerLabel(selTile.kind))} ${P2.grid.privateData}` : P2.hint.tile(workerLabel(selTile.kind))
  else if (selLine) hint = P2.hint.line(nodeLabel(selLine.from), nodeLabel(selLine.to))
  const bar = (
    <div className="mapbar">
      <span className={`mhint${msg || draft.error ? ' msg' : ''}`} role="status">{msg ?? draft.error ?? hint}</span>
      {selTile && mode.kind === 'idle' && (
        <>
          <button type="button" className="btn small" onClick={() => { setMode({ kind: 'move', tile: selTile.id }); setSel(null) }}>{P2.move}</button>
          <button type="button" className="btn small" onClick={() => onPort(selTile.id)}>{P2.join}</button>
        </>
      )}
      {sel && mode.kind === 'idle' && <button type="button" className="btn small danger" onClick={remove} aria-label={P2.remove}>🗑 {P2.remove}</button>}
      {mode.kind !== 'idle' && <button type="button" className="btn small" onClick={reset}>{P2.cancel}</button>}
      <button type="button" className="btn small" disabled={!draft.canUndo} onClick={draft.undo} title={`${P2.undo} (Ctrl+Z)`}>{P2.undo}</button>
      <button type="button" className="btn small" disabled={!draft.canRedo} onClick={draft.redo} title={`${P2.redo} (Ctrl+Shift+Z)`}>{P2.redo}</button>
    </div>
  )

  const shelves = (
    <Shelves unlocked={unlocked} lockedBy={lockedBy} onInfo={(item) => setSheet({ kind: 'item', item })}
      rows={[
        { title: P2.models, icon: 'model', items: content.models.map((m) => ({ id: m.id, label: m.label, short: m.short, description: m.description, costLine: m.costLine })) },
        { title: P2.computes, icon: 'compute', items: content.compute.map((c) => ({ id: c.id, label: c.label, short: c.short, description: c.description, costLine: c.costLine })) },
      ]}
      words={{ locked: P2.locked, lockedNoAction: P2.lockedNoAction, info: P2.info }} />
  )

  const targets = mode.kind === 'join' ? targetsOf(map, v, mode.from) : undefined
  const grid = (
    <Grid v={v} map={map} flags={{ stray: dv.flags.stray, incomplete: dv.flags.incomplete, privateData: dv.flags.privateData }}
      unlocked={unlocked} lockedBy={lockedBy} mode={mode} selection={sel} targets={targets} label={P2.map}
      onCell={onCell} onNode={onNode} onPort={onPort}
      onLine={(key) => { if (mode.kind === 'idle') setSel((s) => (s?.kind === 'line' && s.key === key ? null : { kind: 'line', key })) }}
      onPart={(tile, part) => { reset(); setSheet({ kind: 'part', tile, part }) }}
      onDropKind={(kind, col, row) => { if (!tileAt(map, col, row)) { const r = placeTile(map, kind, col, row); commit(r.map); setSel({ kind: 'tile', id: r.id }); setMode({ kind: 'idle' }) } }}
      onDropTile={(id, col, row) => { const r = moveTile(map, id, col, row); commit(r.map); if (r.dropped) say(P2.dropped(r.dropped)) }}
      onDragLine={(from, to) => join(from, to)}
      words={gridWords} />
  )
  const footer = (
    <div className="mapfoot">
      <RunningLine dv={dv} content={content} />
      <ValidateButton dv={dv} content={content} onValidate={validate} refused={refusedValidate} />
    </div>
  )
  const actions = (
    <ActionList groups={content.rules.actionGroups} rows={rows} onStart={start} refused={refusedAction}
      words={{ start: P2.start, done: P2.done, cost: P2.cost, opens: P2.opens, left: P2.leftS, holds: P2.holds, noCancel: P2.noCancel }} />
  )
  const toolbox = (
    <Toolbox phone={phone} picked={mode.kind === 'place' ? mode.worker : null} unlocked={unlocked} lockedBy={lockedBy}
      onPick={(id) => { setSel(null); setMode(id ? { kind: 'place', worker: id } : { kind: 'idle' }); if (id && phone) setTab('map') }}
      workers={content.workers.map((x) => ({ id: x.id, label: x.label, short: x.short, description: x.description, costLine: x.costLine, icon: x.icon, kind: x.kind }))}
      words={{ locked: P2.locked, lockedNoAction: P2.lockedNoAction, pickHint: P2.pickHint, picked: P2.picked, kinds: P2.kinds }} />
  )
  const results = <ResultsPanel dv={dv} onLoad={(m) => { commit(m); if (phone) setTab('map') }} onChoose={choose} />
  const insights = <InsightsPanel w={w} content={content} dv={dv} fresh={fresh} />

  // --- the sheets of a tile's parts and of a shelf item
  let sheetEl: React.ReactNode = null
  if (sheet?.kind === 'item') {
    sheetEl = <ItemSheet item={sheet.item} locked={!unlocked.has(sheet.item.id)} lockedBy={lockedBy} onClose={() => setSheet(null)} words={{ locked: P2.locked, lockedNoAction: P2.lockedNoAction, close: P2.close, open: P2.open }} />
  } else if (sheet?.kind === 'part') {
    const t = tileOf(map, sheet.tile)
    const w2 = t ? content.workers.find((x) => x.id === t.kind) : undefined
    if (t && w2) {
      const close = () => setSheet(null)
      const set = (part: Part, value: string | null) => { commit(setPart(map, v, t.id, part, value)); close() }
      if (sheet.part === 'prompt') {
        sheetEl = <PromptSheet title={P2.promptOf(w2.label)} prompts={content.prompts} current={t.prompt} unlocked={unlocked} lockedBy={lockedBy}
          onPick={(id) => set('prompt', id)} onClose={close}
          words={{ intro: P2.promptIntro, use: P2.use, inUse: P2.inUse, isDefault: P2.isDefault, close: P2.close, locked: P2.locked, lockedNoAction: P2.lockedNoAction }} />
      } else if (sheet.part === 'model') {
        sheetEl = <PartSheet title={P2.modelOf(w2.label)} onPick={(id) => set('model', id)} onClose={close}
          words={{ close: P2.close, current: P2.current, clear: P2.clear }}
          choices={content.models.map((m) => ({
            id: m.id, label: m.label, detail: m.costLine ?? m.description, current: t.model === m.id,
            disabled: !w2.models.includes(m.id) ? P2.cannotCarry : !unlocked.has(m.id) ? P2.locked(lockedBy[m.id] ?? '') : null,
          }))} />
      } else {
        const model = content.models.find((m) => m.id === t.model)
        sheetEl = <PartSheet title={P2.computeOf(w2.label)} intro={P2.computeIntro(model?.label ?? null)} onPick={(id) => set('runsOn', id)} onClose={close}
          words={{ close: P2.close, current: P2.current, clear: P2.clear }}
          choices={content.compute.map((c) => ({
            id: c.id, label: c.label, detail: [c.description, c.costLine].filter(Boolean).join(' '), current: t.runsOn === c.id,
            disabled: !unlocked.has(c.id) ? P2.locked(lockedBy[c.id] ?? '') : model && !model.runsOn.includes(c.id)
              ? P2.cannotRun(model.short, model.runsOn.map((x) => content.compute.find((y) => y.id === x)?.short ?? x).join(', ')) : null,
          }))} />
      }
    }
  }
  const closeBrief = () => { store.setFlag(briefFlag); setBriefOpen(false) }
  const overlays = (
    <>
      {sheetEl}
      {toast && <Toast text={toast.text} onShow={toast.show} onClose={() => setToast(null)} />}
      {warning && <div className="toast warnbar" role="status">{warning}</div>}
      {briefOpen && <BriefSheet w={w} phase="development" onClose={closeBrief} words={{ started: P2.phaseStarted, start: P2.briefStart, stays: P2.letterStays }} />}
    </>
  )

  if (phone) {
    const counts: Record<Tab, string> = {
      map: `${map.tiles.length}`, actions: dv.actionsRunning.length ? `${dv.actionsRunning.length} running` : `${dv.actionsDone.length} done`,
      toolbox: '', results: dv.validations.length ? P2.pct(dv.validations.at(-1)!.accuracy) : '–',
    }
    return (
      <div className="p2-phone">
        <div className="p2-phone-main">
          {tab === 'map' && (
            <div className="p2pmap">
              <Purse dv={dv} content={content} />
              {bar}
              {shelves}
              <div className="gridscroll">{grid}</div>
              {footer}
            </div>
          )}
          {tab === 'actions' && <div className="p2pcol"><Purse dv={dv} content={content} /><div className="bwline pad">{P2.moneyLine}</div>{actions}</div>}
          {tab === 'toolbox' && <div className="p2pcol">{toolbox}</div>}
          {tab === 'results' && <div className="p2pcol pad">{results}{insights}</div>}
        </div>
        <nav className="ptabs four" aria-label={P2.phase}>
          {(['map', 'actions', 'toolbox', 'results'] as const).map((t) => (
            <button key={t} type="button" className={tab === t ? 'on' : ''} aria-pressed={tab === t} onClick={() => setTab(t)}>
              <span className="tl">{P2.tab[t]}</span>{counts[t] && <span className="tc">{counts[t]}</span>}
            </button>
          ))}
        </nav>
        {overlays}
      </div>
    )
  }

  return (
    <div className="p2">
      <div className="p2-top">
        <section className="colbox p2-actions" aria-label={P2.actions}>
          <div className="colhead sun"><h2>{P2.actions}</h2><span className="s">{dv.actionsDone.length} / {content.actions.length}</span></div>
          <div className="colscroll">{actions}</div>
        </section>
        <section className="colbox p2-map" aria-label={P2.map}>
          <div className="colhead sky maphead"><h2>{P2.map}</h2>{bar}</div>
          {shelves}
          <div className="gridwrap">{grid}</div>
          {footer}
        </section>
        <section className="colbox p2-tools" aria-label={P2.toolbox}>
          <div className="colhead lav"><h2>{P2.toolbox}</h2></div>
          <div className="colscroll">{toolbox}</div>
        </section>
      </div>
      <div className="p2-below">
        {results}
        {insights}
      </div>
      {overlays}
    </div>
  )
}

/** Phase 2 from its first stage to the break that follows it. */
export function Development({ w, onSlides }: { w: Welcome; onSlides?: (() => void) | null }) {
  const view = usePlayer((s) => s.view)!
  const content = usePlayer((s) => s.content.development) as DevelopmentContent | undefined
  const dv = view.development
  if (!dv || !content) return <div className="banner">{P2.map}…</div>
  if (dv.reveal) return <DevReveal w={w} content={content} dv={dv} inBreak={view.stage === 'break.development'} onSlides={onSlides ?? null} />
  return <DevPlay w={w} content={content} />
}
