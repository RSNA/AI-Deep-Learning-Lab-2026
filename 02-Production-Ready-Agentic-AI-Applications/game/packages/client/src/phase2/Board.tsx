// The board of Phases 2 and 3 (engineering spec, sections 10.5 and 10.6). On a laptop three
// titled columns side by side, Actions, the map and the Toolbox, and under them what the phase
// adds: its results on the left, the letters and insights on the right, and for Phase 3 one cell
// across both. Below 1280 px the same parts as tabs. The canvas, the shelves, the toolbox and the
// action list come from ../canvas and know nothing of a phase. This file knows that there are
// two phases and nothing of what either scores: each phase passes its panels and its words.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { CanvasMap, DevelopmentContent, DevelopmentView, InboxItem, LineSide, Welcome } from '@lab02/protocol'
import { Grid, LineLegend, type Mode, type Part, type Selection } from '../canvas/Grid.tsx'
import { addLine, lineKey, marksOf, moveTile, placeTile, removeLine, removeTile, sameLayout, setPart, targetsOf, tileAt, tileNames, tileOf, type Vocabulary } from '../canvas/model.ts'
import { ActionList, ItemSheet, PartSheet, PromptSheet, Shelves, Toolbox, type ActionRow, type Item } from '../canvas/Panels.tsx'
import { PopLayer, type PopInfo } from '../canvas/Pop.tsx'
import { ClampCard } from '../components/Clamp.tsx'
import { HelpSheet, Tour, useTour, type TourStep } from '../components/Tour.tsx'
import { Portrait, Sheet as Dialog } from '../components/ui.tsx'
import { COPY } from '../copy.ts'
import { gameNow, useTick } from '../lib/clock.ts'
import { plainError } from '../lib/errors.ts'
import { Paragraphs } from '../lib/marks.tsx'
import { usePlayer } from '../lib/player.ts'
import { store } from '../lib/storage.ts'
import { TileBody } from '../phase1/Cards.tsx'
import { BriefSheet, useNarrow, useWarnings, type BriefWords } from '../phase1/Phase1.tsx'
import { P2, money, setMoneyUnit } from './copy.ts'
import { guideOf, lineRefusal, type Guide } from './guide.ts'
import { lineEnds } from './lineEnds.ts'
import { useMap } from './useMap.ts'

// ------------------------------------------------------------------------------------------
// What the board reads of a phase
// ------------------------------------------------------------------------------------------
export type BoardPhase = 'development' | 'maintaining'
/** The part of a phase's view that the board reads. The views of Phases 2 and 3 both carry it. */
export type BoardView = Pick<DevelopmentView, 'money' | 'developers' | 'unlocked' | 'marks' | 'actionsRunning' | 'insights' | 'map' | 'ready' | 'lineAdvice' | 'tileMinutes' | 'rushed' | 'flags' | 'running' | 'validationsLeft' | 'validating'> & {
  actionsDone: { id: string; atMs: number }[]
  validations: { id: string; map: CanvasMap; accuracy: number }[]
}
/** `repeat`: the action may be started again after it finished (Phase 3). */
export type BoardAction = DevelopmentContent['actions'][number] & { repeat?: boolean; upkeep?: number }
export type BoardContent = Omit<DevelopmentContent, 'phase' | 'actions'> & { actions: BoardAction[] }

export function vocabularyOf(c: BoardContent): Vocabulary {
  return {
    cols: c.rules.cols, rows: c.rules.rows, columns: c.rules.columns,
    sources: c.sources.map((s) => ({ id: s.id, label: s.label, icon: s.icon, privateData: s.privateData })),
    result: { id: c.result.id, label: c.result.label },
    workers: c.workers.map((w) => ({ id: w.id, kind: w.kind, label: w.label, short: w.short, icon: w.icon, task: w.task, needsModel: w.needsModel, models: w.models })),
    models: c.models.map((m) => ({ id: m.id, label: m.label, short: m.short, runsOn: m.runsOn })),
    compute: c.compute.map((x) => ({ id: x.id, label: x.label, short: x.short, protectsPrivateData: x.protectsPrivateData })),
    prompts: c.prompts.map((p) => ({ id: p.id, label: p.short ?? p.label })),
  }
}

/** The title of the action that opens each locked item. */
export function lockedByOf(c: BoardContent): Record<string, string> {
  const out: Record<string, string> = {}
  for (const a of c.actions) for (const id of a.unlocks) if (!out[id]) out[id] = a.title
  return out
}

/** Below this width the board shows its tabs: three columns side by side need more room. */
export const P2_TABS_BELOW = 1280

export const gridWords = { ...P2.grid, pickModel: P2.pickModel, pickCompute: P2.pickCompute, defaultPrompt: P2.defaultPrompt, locked: P2.locked, lockedNoAction: P2.lockedNoAction, lockedShort: P2.lockedShort, model: P2.model, compute: P2.compute, prompt: P2.prompt }

export const labelOf = (c: BoardContent, id: string): string =>
  c.sources.find((x) => x.id === id)?.label ?? c.workers.find((x) => x.id === id)?.label ?? c.models.find((x) => x.id === id)?.label
  ?? c.compute.find((x) => x.id === id)?.label ?? c.prompts.find((x) => x.id === id)?.label ?? (c.result.id === id ? c.result.label : id)

/** A reason why a map cannot be validated, in words, for the host's view of a player. No reason id reaches a screen. */
export function reasonText(r: string, pools: { id: string; label: string }[]): string {
  if (r.startsWith('too_many_minutes:')) return P2.hostReason.minutes(pools.find((x) => x.id === r.split(':')[1])?.label ?? '')
  if (r.startsWith('required_missing:')) return P2.hostReason.required
  return (P2.hostReason as unknown as Record<string, string | undefined>)[r] ?? P2.hostReason.nothing_reaches_result
}

// ------------------------------------------------------------------------------------------
// Small parts
// ------------------------------------------------------------------------------------------
export function Toast({ text, onShow, onClose }: { text: string; onShow?: () => void; onClose: () => void }) {
  // The notice goes after six seconds, counted from its text. The board draws itself again many
  // times in those seconds (a countdown ticks), and a new `onClose` must not start the count again.
  const close = useRef(onClose)
  useEffect(() => { close.current = onClose })
  useEffect(() => { const id = setTimeout(() => close.current(), 6000); return () => clearTimeout(id) }, [text])
  return (
    <div className="toast p2toast" role="status">
      <span>{text}</span>
      {onShow && <button type="button" className="btn small" onClick={() => { onShow(); onClose() }}>{P2.show}</button>}
    </div>
  )
}

/** Money, developers and validations: what the phase spends, in one quiet strip. */
export function Purse({ dv, content, bar = false }: { dv: Pick<BoardView, 'money' | 'developers' | 'validationsLeft'>; content: Pick<BoardContent, 'rules'>; bar?: boolean }) {
  return (
    <div className="purse" aria-label={`${P2.money} ${dv.money}. ${P2.developers} ${P2.freeOf(dv.developers.free, dv.developers.total)}. ${P2.validations} ${P2.left(dv.validationsLeft)}`}>
      <span className={`pf${dv.money < 0 ? ' below' : ''}`} title={dv.money < 0 ? P2.belowZero : undefined}><span className="pl">{P2.money}</span><b className="num">{money(dv.money)}</b>{content.rules.moneyUnit && <span className="unit">{content.rules.moneyUnit}</span>}</span>
      <span className="pf"><span className="pl">{P2.developers}</span><span className="devs" aria-hidden="true">{Array.from({ length: dv.developers.total }, (_, i) => <i key={i} className={i < dv.developers.total - dv.developers.free ? 'held' : ''} />)}</span><b>{P2.freeOf(dv.developers.free, dv.developers.total)}</b></span>
      {!bar && <span className="pf" title={`${dv.validationsLeft} of ${content.rules.validations}`}><span className="pl">{P2.validations}</span><b>{P2.left(dv.validationsLeft)}</b></span>}
    </div>
  )
}

/** What the map on the canvas takes to run: money a month, and the minutes it asks of each pool of people. */
function RunningLine({ dv, content }: { dv: BoardView; content: BoardContent }) {
  const r = dv.running
  if (!r) return null
  return (
    <div className="runline">
      <span><b>{P2.toRun}</b> {P2.perMonth(r.money)}</span>
      {content.rules.pools.map((pl) => <span key={pl.id} className={(r.minutes[pl.id] ?? 0) > pl.max ? 'over' : ''}>{P2.minutes(pl.label, r.minutes[pl.id] ?? 0, pl.max)}</span>)}
      {P2.reads(r.reads) && <span className="runreads" data-testid="runreads">{P2.reads(r.reads)}</span>}
    </div>
  )
}

/**
 * Validate is never a dead control. While it cannot act, the line beside it says the next thing to
 * do (and how many more follow), a press says it again and marks its tile, and before the first
 * validation the same line guides through the first map.
 */
function ValidateButton({ dv, guide, first, free, onValidate, onWhy, refused, ready }: { dv: BoardView; guide: Guide; first: boolean; free: boolean; onValidate: () => void; onWhy: () => void; refused: string | null; ready: string }) {
  useTick(250)
  const clock = usePlayer((s) => s.clock)
  const now = clock ? gameNow(clock) : 0
  const [flash, setFlash] = useState(0)
  if (dv.validating) {
    const total = dv.validating.completesAtMs - dv.validating.startedAtMs
    const left = Math.max(0, dv.validating.completesAtMs - now)
    return (
      <div className="vwrap" data-tour="p2-validate">
        <span className="vwhy">{P2.why.running}</span>
        <div className="vbtn running" role="status">
          <span>{P2.validating(left / 1000)}</span>
          <span className="runbar"><i style={{ width: `${100 * (1 - left / Math.max(1, total))}%` }} /></span>
        </div>
      </div>
    )
  }
  const why = guide.first
  const warn = !why && guide.ready ? guide.warn : null
  const line = refused ?? why?.text ?? warn?.text ?? (first && guide.ready ? ready : null)
  return (
    <div className="vwrap" data-tour="p2-validate">
      {line && (
        <span key={flash} className={`vwhy${why || refused ? ' block' : warn ? ' warn' : ' ok'}${flash ? ' flash' : ''}`} id="p2-vwhy" role="status">
          {line}{why && !refused && guide.others > 0 && <span className="vmore"> {P2.why.more(guide.others)}</span>}
        </span>
      )}
      <button type="button" className={`btn go vbtn${why ? ' off' : ''}`} aria-disabled={why ? true : undefined} aria-describedby={line ? 'p2-vwhy' : undefined}
        title={why?.text} onClick={() => { if (why) { setFlash((n) => n + 1); onWhy() } else onValidate() }}>{free ? P2.validateFree : P2.validateLeft(dv.validationsLeft)}</button>
    </div>
  )
}

/** The bar of a card that is opened in a window takes the color of the group of its action. */
const POP_HEAD: Record<string, string> = { learn: 'sky', build: '', buy: 'sun', negotiate: 'lav', watch: 'rose', maintain: 'orange' }

/**
 * The letters and the insights of the phase as one row of cards, the newest first: the letters
 * and memos that arrived (Phase 3), a card per action that brought an insight, and the letter
 * that opened the phase, each at the time it came.
 */
export function InsightsPanel({ w, content, dv, fresh, phase = 'development', letters = [], title = P2.insights, freshLetters }: {
  w: Welcome; content: BoardContent; dv: Pick<BoardView, 'insights' | 'actionsDone'>; fresh: Set<string>
  phase?: BoardPhase
  /** Letters and memos of the inbox that stay as cards, the newest first. */
  letters?: InboxItem[]
  title?: string
  freshLetters?: Set<string>
}) {
  // The letter as the player received it, with the opening that follows from their Phase 1.
  const inbox = usePlayer((s) => s.view?.inbox.find((m) => m.id === `${phase}:brief`))
  const b = content.brief ? { ...content.brief, text: inbox?.text ?? content.brief.text } : null
  const idx = b ? w.system.cast.findIndex((c) => c.id === b.from) : -1
  const from = idx >= 0 ? w.system.cast[idx] : undefined
  const person = (id: string) => { const i = w.system.cast.findIndex((c) => c.id === id); return i >= 0 ? { c: w.system.cast[i]!, i } : null }
  // When the insight of an action came: with its last run.
  const doneAt = new Map<string, number>()
  for (const d of dv.actionsDone) doneAt.set(d.id, Math.max(d.atMs, doneAt.get(d.id) ?? 0))
  const cards: { at: number; card: ReactNode }[] = []
  for (const m of letters) {
    const p = person(m.from)
    cards.push({ at: m.atMs, card: (
      <ClampCard key={m.id} className={`card letter${freshLetters?.has(m.id) ? ' fresh' : ''}`} bodyClass="cbody" data-letter={m.id} words={{ more: P2.showMore, less: P2.showLess }}
        pop={{ title: `${m.kind === 'announcement' ? P2.memoCard : P2.letterCard}${p ? ` · ${p.c.role}` : ''}`, head: m.kind === 'announcement' ? 'sky' : 'sun', close: P2.close }}
        head={<div className={`chead ${m.kind === 'announcement' ? 'h-memo' : 'h-letter'}`}><span className="src">{m.kind === 'announcement' ? P2.memoCard : P2.letterCard}{p ? ` · ${p.c.role}` : ''}</span></div>}>
        {m.title && <h3>{m.title}</h3>}
        {p && <div className="speaker"><Portrait c={p.c} cast={w.system.cast} index={p.i} size={48} /><div><div className="nm">{p.c.name}</div><div className="rl">{p.c.role}</div></div></div>}
        <div className="letter-text"><Paragraphs text={m.text} /></div>
      </ClampCard>
    ) })
  }
  if (b) {
    cards.push({ at: inbox?.atMs ?? 0, card: (
      <ClampCard key="brief" className="card letter" bodyClass="cbody" data-letter="brief" words={{ more: P2.showMore, less: P2.showLess }} pop={{ title: `${P2.letterCard}${from ? ` · ${from.role}` : ''}`, head: 'sun', close: P2.close }}
        head={<div className="chead h-letter"><span className="src">{P2.letterCard}{from ? ` · ${from.role}` : ''}</span></div>}>
        <h3>{b.title}</h3>
        {from && <div className="speaker"><Portrait c={from} cast={w.system.cast} index={idx} size={48} /><div><div className="nm">{from.name}</div><div className="rl">{from.role}</div></div></div>}
        <div className="letter-text"><Paragraphs text={b.text} /></div>
      </ClampCard>
    ) })
  }
  for (const x of [...dv.insights].reverse()) {
    const a = content.actions.find((y) => y.id === x.action)
    cards.push({ at: doneAt.get(x.action) ?? 0, card: (
      <ClampCard key={x.action} className={`card${fresh.has(x.action) ? ' fresh' : ''}`} bodyClass="cbody" data-insight={x.action} words={{ more: P2.showMore, less: P2.showLess }}
        pop={{ title: P2.fromAction(a?.title ?? ''), head: POP_HEAD[a?.group ?? 'learn'] ?? 'lav', close: P2.close }}
        head={<div className={`chead h-g-${a?.group ?? 'learn'}`}><span className="src">{P2.fromAction(a?.title ?? '')}</span></div>}>
        <h3>{x.tile.headline}</h3>
        <TileBody tile={x.tile} cast={w.system.cast} />
      </ClampCard>
    ) })
  }
  // Each kind is listed above with its newest first, and cards of one moment keep that order.
  const row = [...cards].sort((x, y) => y.at - x.at)
  return (
    <section className="panel p2insights" id="p2-insights">
      <div className="panel-head lav"><span>{title}</span><span className="sub">{dv.insights.length + letters.length}</span></div>
      <div className="panel-body">
        <div className="icards">{row.map((c) => c.card)}</div>
        {!dv.insights.length && <p className="muted">{P2.insightsEmpty}</p>}
      </div>
    </section>
  )
}

// ------------------------------------------------------------------------------------------
// The board in play
// ------------------------------------------------------------------------------------------
export type BoardTab = 'map' | 'actions' | 'toolbox' | 'year' | 'results'
type Sheet = { kind: 'part'; tile: string; part: Part } | { kind: 'item'; item: Item; more?: (string | null)[]; state?: boolean } | { kind: 'clear' } | { kind: 'same'; text: string } | null

/** What the panels of a phase may ask of the board. */
export type BoardApi = {
  /** The draft on the canvas now. */
  map: CanvasMap
  phone: boolean
  /** Put a map on the canvas, say `said`, and bring the canvas into view. */
  load: (m: CanvasMap, said: string) => void
  /** Save what was just changed on the canvas before a command that reads the server's draft. */
  settled: () => Promise<void>
  /** Show a tab of a phone, or scroll a laptop to the panel with that id. */
  show: (tab: BoardTab, panelId?: string) => void
  toast: (text: string, show?: () => void) => void
  /** True while the opening letter is in front of the player. */
  briefOpen: boolean
  /** True while the tour runs. */
  touring: boolean
}

export type BoardWords = {
  /** The name of the tabs of a phone, for a screen reader. */
  phase: string
  tour: TourStep[]
  helpTitle: string
  helpIntro: string
  brief: BriefWords
  warn: (s: number) => string
  /** Beside Validate when no validation is left, and when the map is ready before the first one. */
  whyNoneLeft: string
  whyReady: string
  /** What is said when a map joins the list of validations. */
  /** `n`: the number of the system that the validation made. */
  doneToast: (v: BoardView['validations'][number], n: number) => string
  tab: Record<BoardTab, string>
  insightsTitle: string
  /** The label of Start on an action that may be done again, and the word for how often it was done. */
  again?: string
  doneTimes?: (n: number) => string
  /** What an action costs a month once it is done (Phase 3). */
  upkeep?: (x: number) => string
}

export const P2_BOARD_WORDS: BoardWords = {
  phase: P2.phase, tour: P2.tour, helpTitle: P2.helpTitle, helpIntro: P2.helpIntro,
  brief: { started: P2.phaseStarted, start: P2.briefStart, stays: P2.letterStays },
  warn: P2.warn, whyNoneLeft: P2.why.noneLeft, whyReady: P2.why.ready, doneToast: (v, n) => P2.doneToast(n, v.accuracy),
  tab: { ...P2.tab, year: '' }, insightsTitle: P2.insights,
}

export function MapBoard({ w, phase, content, dv, words, results, above, status, strip, overlays, letters, freshLetters, held = false, spendWord = false, sameAs, tabCounts, helpMore }: {
  w: Welcome; phase: BoardPhase; content: BoardContent; dv: BoardView; words: BoardWords
  /** Under the map, on the left of the letters and insights: what the phase keeps of its validations. */
  results: (api: BoardApi) => ReactNode
  /** One cell across both columns under the map, above the results and the insights. A tab of its own on a phone. */
  above?: (api: BoardApi) => ReactNode
  /** One quiet line between the map and its footer. */
  status?: (api: BoardApi) => ReactNode
  /** One line above every tab of a phone. */
  strip?: ReactNode
  /** Sheets of the phase. */
  overlays?: (api: BoardApi) => ReactNode
  letters?: InboxItem[]
  freshLetters?: Set<string>
  /** Something of the phase is in front of the player: the tour waits for it. */
  held?: boolean
  /** Phase 2 says a word on money after a few paid actions. */
  spendWord?: boolean
  /** A sentence when the map on the canvas was validated before and a new validation would say the same. Null: validate at once. */
  sameAs: (map: CanvasMap) => string | null
  /** What a tab of a phone shows beside its name, where the phase knows better than the board. */
  tabCounts?: Partial<Record<BoardTab, string>>
  /** One more button at the foot of the help panel. */
  helpMore?: ReactNode
}) {
  useTick(500)
  const view = usePlayer((s) => s.view)!
  setMoneyUnit(content.rules.moneyUnit)
  const send = usePlayer((s) => s.send)
  const clock = usePlayer((s) => s.clock)
  const phone = useNarrow(P2_TABS_BELOW)
  const v = useMemo(() => vocabularyOf(content), [content])
  const lockedBy = useMemo(() => lockedByOf(content), [content])
  const unlockedKey = dv.unlocked.join(',')
  const unlocked = useMemo(() => new Set(dv.unlocked), [unlockedKey]) // eslint-disable-line react-hooks/exhaustive-deps
  // What the actions that are done changed on the board, as tags where they act.
  const marksKey = dv.marks.map((m) => `${m.id}:${m.tag}`).join(',')
  const marks = useMemo(() => marksOf(dv.marks), [marksKey]) // eslint-disable-line react-hooks/exhaustive-deps
  // A sentence at the place of an action: a refusal, or advice on a line. It stays until the next action.
  const [note, setNote] = useState<{ at: string; text: string; tone: 'refuse' | 'advice' } | null>(null)
  const refuse = (at: string, text: string) => setNote({ at, text, tone: 'refuse' })
  const draft = useMap(phase, v, unlocked, false, (d) => refuse(d.line.to, d.text || P2.refuse.server))
  const map = draft.map
  const [mode, setMode] = useState<Mode>({ kind: 'idle' })
  const [sel, setSel] = useState<Selection>(null)
  const [sheet, setSheet] = useState<Sheet>(null)
  const [tab, setTab] = useState<BoardTab>('map')
  const [toast, setToast] = useState<{ text: string; show?: () => void } | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [refusedAction, setRefusedAction] = useState<{ id: string; text: string } | null>(null)
  const [refusedValidate, setRefusedValidate] = useState<string | null>(null)
  const [fresh, setFresh] = useState<Set<string>>(new Set())
  const briefFlag = `brief-${phase}-${view.me.id}-${view.run}`
  const [briefOpen, setBriefOpen] = useState(() => !store.flag(briefFlag))
  const warning = useWarnings(words.warn)
  const now = clock ? gameNow(clock) : 0
  const touring = useTour((t) => t.open !== null)
  // The word on money, once, when the fourth action that costs money has been started. Things
  // to read or to watch that cost nothing do not count: they spend no budget.
  const spendFlag = `spend-told-${view.me.id}-${view.run}`
  const [spendSeen, setSpendSeen] = useState(() => !spendWord || store.flag(spendFlag))
  const started = [...dv.actionsDone, ...dv.actionsRunning].filter((x) => (content.actions.find((a) => a.id === x.id)?.money ?? 0) > 0).length

  const say = (text: string) => { setMsg(text); setTimeout(() => setMsg((m) => (m === text ? null : m)), 5000) }
  const reset = useCallback(() => { setMode({ kind: 'idle' }); setSel(null) }, [])

  // A validation that lands and an insight that lands are said without stealing the scroll.
  const seenV = useRef(dv.validations.length)
  const insightKey = (x: BoardView['insights'][number]) => `${x.action}:${x.tile.headline}`
  const seenI = useRef(new Set(dv.insights.map(insightKey)))
  const show = (t: BoardTab, panelId?: string) => {
    if (phone) setTab(t)
    else if (t === 'map') window.scrollTo({ top: 0, behavior: 'smooth' })
    else document.getElementById(panelId ?? (t === 'results' ? 'p2-results' : 'p2-insights'))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const showResults = () => show('results', 'p2-results')
  const showInsights = () => show('results', 'p2-insights')
  useEffect(() => {
    if (dv.validations.length > seenV.current) setToast({ text: words.doneToast(dv.validations.at(-1)!, dv.validations.length), show: showResults })
    seenV.current = dv.validations.length
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dv.validations.length])
  // A card is new when its action had none, and when a later run of the action brought another card.
  const insightsKey = dv.insights.map(insightKey).join('|')
  useEffect(() => {
    const x = dv.insights.findLast((i) => !seenI.current.has(insightKey(i)))
    if (x) {
      setToast({ text: P2.insightToast(x.tile.headline || (content.actions.find((a) => a.id === x.action)?.title ?? '')), show: showInsights })
      setFresh((f) => new Set([...f, x.action]))
      setTimeout(() => setFresh((f) => { const n = new Set(f); n.delete(x.action); return n }), 8000)
    }
    seenI.current = new Set(dv.insights.map(insightKey))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insightsKey])

  // --- what is on the board. An item that is not unlocked and an action that waits for something
  // are not shown. When one comes onto the board, a notice names it and it is marked until the
  // player has looked at it.
  const open = <X extends { id: string }>(list: X[]): X[] => list.filter((x) => unlocked.has(x.id))
  const shownWorkers = open(content.workers), shownModels = open(content.models), shownCompute = open(content.compute), shownPrompts = open(content.prompts)
  const boardKey = [...shownWorkers, ...shownModels, ...shownCompute, ...shownPrompts].map((x) => x.id).concat(content.actions.map((a) => `action:${a.id}`)).join(',')
  const usedKey = draft.map.tiles.flatMap((t) => [t.kind, t.model, t.runsOn, t.prompt]).filter((x): x is string => !!x).join(',')
  const boardSeen = useRef<Set<string> | null>(null)
  const [newIds, setNewIds] = useState<Set<string>>(new Set())
  const seen = useCallback((id: string) => setNewIds((n) => { if (!n.has(id)) return n; const next = new Set(n); next.delete(id); return next }), [])
  const seenAction = useCallback((id: string) => seen(`action:${id}`), [seen])
  useEffect(() => {
    const now = boardKey ? boardKey.split(',') : []
    const before = boardSeen.current
    boardSeen.current = new Set(now)
    if (!before) return
    // What is already on the map (a reference map that was taken) needs no mark.
    const added = now.filter((id) => !before.has(id) && !usedKey.split(',').includes(id))
    if (!added.length) return
    setNewIds((n) => new Set([...n, ...added]))
    setToast({ text: P2.newOnBoard(added.map((id) => (id.startsWith('action:') ? content.actions.find((a) => a.id === id.slice(7))?.title ?? '' : labelOf(content, id))).filter(Boolean)) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardKey])
  // An item that goes onto the map has been seen.
  useEffect(() => {
    const used = new Set(usedKey.split(','))
    setNewIds((n) => ([...n].some((id) => used.has(id)) ? new Set([...n].filter((id) => !used.has(id))) : n))
  }, [usedKey])
  const newActions = useMemo(() => new Set([...newIds].filter((id) => id.startsWith('action:')).map((id) => id.slice(7))), [newIds])

  const commit = (next: CanvasMap) => { setNote(null); if (!draft.commit(next)) say(P2.refusedMap) }
  // Two tiles of one kind carry a number, everywhere a tile is named.
  const names = tileNames(map, v)
  const nodeLabel = (id: string) => names.get(id)?.label ?? labelOf(content, id)

  // --- the canvas
  const onCell = (col: number, row: number) => {
    if (mode.kind === 'place') {
      const r = placeTile(map, mode.worker, col, row)
      commit(r.map)
      setSel({ kind: 'tile', id: r.id })
      setMode({ kind: 'idle' })
    } else if (mode.kind === 'move') {
      commit(moveTile(map, mode.tile, col, row))
      setMode({ kind: 'idle' })
    }
  }
  // A line that cannot be drawn says why at its place, and the player may pick another target.
  // `sides` are the dots the player pressed: where the line leaves its tile and where it enters.
  const join = (from: string, to: string, sides?: { from?: LineSide; to?: LineSide }) => {
    const no = lineRefusal(map, v, from, to, nodeLabel, unlocked, lockedBy)
    if (no) { refuse(no.at, no.text); return }
    if (!targetsOf(map, v, from).has(to)) return
    const replaced = to === v.result.id && map.lines.some((l) => l.to === v.result.id)
    commit(addLine(map, from, to, v.result.id, sides))
    if (replaced) say(P2.replaced)
    setMode({ kind: 'idle' })
  }
  // An end of a line that was picked up, or a node that is clicked while a line is selected.
  const ends = lineEnds({ map, v, mode, sel, unlocked, lockedBy, nodeLabel, commit, refuse, say, setMode, setSel })
  const onNode = (id: string, side?: LineSide) => {
    const src = content.sources.find((x) => x.id === id)
    if (ends.onNode(id, side)) return
    if (mode.kind === 'join') { if (id === mode.from) { setMode({ kind: 'idle' }); setNote(null) } else join(mode.from, id, { from: mode.side, to: side }); return }
    // A locked source says which action opens it.
    if (src) { if (!unlocked.has(id)) refuse(id, P2.refuse.locked(src.label, lockedBy[id] ?? null)); return }
    // A cell that is taken says so, where the player clicked.
    if (mode.kind === 'move' && id === mode.tile) { setMode({ kind: 'idle' }); return }
    if (mode.kind !== 'idle') { refuse(id, P2.refuse.taken); return }
    setNote(null)
    setSel({ kind: 'tile', id })
  }
  // A press on a dot starts a line that leaves on that side. The button "Draw a line" of the bar
  // gives no side, and the line then takes the side that faces its other tile.
  const onPort = (id: string, side?: LineSide) => {
    setSel(null)
    setNote(null)
    setMode((m) => (m.kind === 'join' && m.from === id && m.side === side ? { kind: 'idle' } : { kind: 'join', from: id, ...(side ? { side } : {}) }))
  }
  const remove = () => {
    if (sel?.kind === 'tile') commit(removeTile(map, sel.id))
    else if (sel?.kind === 'line') commit(removeLine(map, sel.key))
    setSel(null)
  }
  const empty = map.tiles.length === 0 && map.lines.length === 0
  const clearMap = () => { reset(); setSheet(null); commit({ tiles: [], lines: [] }); say(P2.cleared) }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.closest('[role="dialog"]'))) return
      const mod = e.metaKey || e.ctrlKey
      if (e.key === 'Escape') { reset(); setNote(null); return }
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); remove(); return }
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) draft.redo(); else draft.undo(); return }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); draft.redo() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // --- advice on a line: said once beside the line when it appears, and again from its mark
  const adviceKey = (k: string) => `advice-${view.me.id}-${view.run}-${k}`
  const advice = new Map(dv.lineAdvice.map((a) => [lineKey(a), a.text]))
  const adviceList = dv.lineAdvice.map((a) => lineKey(a)).join('|')
  useEffect(() => {
    const k = [...advice.keys()].find((x) => !store.flag(adviceKey(x)) && map.lines.some((l) => lineKey(l) === x))
    if (!k) return
    store.setFlag(adviceKey(k))
    setNote({ at: `line:${k}`, text: advice.get(k)!, tone: 'advice' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adviceList])

  // --- what to do next: the line beside Validate and the mark on the map
  const guide = guideOf(dv, content, map, nodeLabel, words.whyNoneLeft)
  const showWhy = () => {
    const g = guide.first
    if (phone) setTab('map')
    if (g?.nodes.length) document.querySelector(`[data-node="${g.nodes[0]}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  // --- what a tile without parts shows: a person's minutes against the limit of its pool
  const bodies: Record<string, { text: string; over?: boolean }> = {}
  for (const t of map.tiles) {
    const w2 = content.workers.find((x) => x.id === t.kind)
    const used = dv.tileMinutes[t.id]
    const pool = w2?.pool ? content.rules.pools.find((x) => x.id === w2.pool) : undefined
    if (pool && used !== undefined) bodies[t.id] = { text: P2.personBody(used, pool.max), over: (dv.running?.minutes[pool.id] ?? 0) > pool.max }
  }

  // A tile is marked only while it has no line out: the moment it hands its work on, it is quiet,
  // and what the whole map still lacks stands beside Validate.
  const noLineOut = map.tiles.filter((t) => !map.lines.some((l) => l.from === t.id)).map((t) => t.id)

  // --- actions
  const doneIds = new Set(dv.actionsDone.map((d) => d.id))
  const rows: ActionRow[] = content.actions.map((a) => {
    const run = dv.actionsRunning.find((r) => r.id === a.id)
    const times = dv.actionsDone.filter((d) => d.id === a.id).length
    const base = { id: a.id, group: a.group, title: a.title, teaser: a.teaser, money: a.money, developers: a.developers, seconds: a.seconds, storyTime: a.storyTime, opens: a.unlocks.map((u) => labelOf(content, u)), inPlace: a.inPlace, upkeep: a.upkeep && words.upkeep ? words.upkeep(a.upkeep) : null }
    if (run) {
      const left = Math.max(0, (run.completesAtMs - now) / 1000)
      return { ...base, state: 'running', left, share: 1 - left / a.seconds }
    }
    // An action that may be done again stays open after it finished, and says how often it was done.
    const again = a.repeat && times > 0 ? { again: words.again, tag: words.doneTimes?.(times) } : {}
    if (doneIds.has(a.id) && !a.repeat) return { ...base, state: 'done' }
    const first = a.requires.find((r) => !doneIds.has(r))
    if (first) return { ...base, ...again, state: 'blocked', blocked: P2.needsFirst(content.actions.find((x) => x.id === first)?.title ?? first) }
    if (a.money > 0 && a.money > dv.money + 1e-9) return { ...base, ...again, state: 'blocked', blocked: P2.needsMoney(a.money, dv.money) }
    if (a.developers > dv.developers.free) return { ...base, ...again, state: 'blocked', blocked: P2.needsDevs(a.developers, dv.developers.free) }
    return { ...base, ...again, state: 'ready' }
  })
  const start = (id: string) => {
    void send(`${phase}.act`, { id }).then((r) => {
      if (!r.ok) { setRefusedAction({ id, text: plainError(r.error) }); setTimeout(() => setRefusedAction((x) => (x?.id === id ? null : x)), 6000) }
    })
  }
  // The server validates the draft it holds, so a change made a moment ago is saved first.
  const runValidation = () => {
    void draft.settled().then(() => send(`${phase}.validate`, {})).then((r) => {
      if (!r.ok) { setRefusedValidate(plainError(r.error)); setTimeout(() => setRefusedValidate(null), 6000) }
    })
  }
  // A map that was validated before gives the same accuracy again: the player is asked first.
  const validate = () => {
    const text = sameAs(map)
    if (text) setSheet({ kind: 'same', text })
    else runValidation()
  }

  // --- the bar of the map: what the player is doing, and what they can do with the selection
  const selTile = sel?.kind === 'tile' ? tileOf(map, sel.id) : undefined
  const selLine = sel?.kind === 'line' ? map.lines.find((l) => lineKey(l) === sel.key) : undefined
  const workerLabel = (kind: string) => content.workers.find((x) => x.id === kind)?.label ?? kind
  let hint: React.ReactNode = <><LineLegend words={P2.legend} /> <span className="lg-tip">{P2.hint.idle}</span></>
  if (mode.kind === 'place') hint = P2.hint.place(workerLabel(mode.worker))
  else if (mode.kind === 'move') hint = P2.hint.move(nodeLabel(mode.tile))
  else if (mode.kind === 'join') hint = P2.hint.join(nodeLabel(mode.from))
  else if (ends.hint) hint = ends.hint
  else if (selTile) hint = P2.hint.tile(nodeLabel(selTile.id))
  else if (selLine) hint = P2.hint.line
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
      <button type="button" className={`btn small${empty ? ' off' : ''}`} aria-disabled={empty || undefined} title={empty ? P2.clearEmpty : undefined}
        onClick={() => { if (empty) say(P2.clearEmpty); else { reset(); setSheet({ kind: 'clear' }) } }}>{P2.clear}</button>
    </div>
  )

  const lockOf = (id: string): string | null => (unlocked.has(id) ? null : lockedBy[id] ? P2.locked(lockedBy[id]!) : P2.lockedNoAction)
  const shortOf = (id: string) => content.compute.find((x) => x.id === id)?.short ?? content.models.find((x) => x.id === id)?.short ?? id
  /** The quiet lines of a model or a place to run, beyond the words of the pack. */
  const shelfMore = (id: string): (string | null)[] => {
    const m = content.models.find((x) => x.id === id)
    const tips = (marks.get(id) ?? []).map((x) => x.tip)
    if (m) return [P2.pop.runsOn(m.runsOn.map(shortOf).join(', ')), ...tips]
    const c = content.compute.find((x) => x.id === id)
    if (!c) return []
    const here = content.models.filter((x) => x.runsOn.includes(c.id)).map((x) => x.short)
    return [c.protectsPrivateData ? P2.pop.protected : P2.pop.unprotected, here.length ? P2.pop.runsHere(here.join(', ')) : null, ...tips]
  }
  const nodeMore = (id: string): (string | null)[] => {
    const src = content.sources.find((x) => x.id === id)
    if (!src) return [P2.pop.resultHow]
    return [src.privateData ? P2.pop.privateSource : null, unlocked.has(id) ? P2.pop.sourceHow : null]
  }
  const popOfShelf = (id: string): PopInfo | null => {
    const it = content.models.find((x) => x.id === id) ?? content.compute.find((x) => x.id === id)
    return it ? { title: it.label, body: [it.description], meta: [it.costLine, ...shelfMore(id)], lock: lockOf(id) } : null
  }
  const popOfTool = (id: string): PopInfo | null => {
    const x = content.workers.find((y) => y.id === id)
    if (!x) return null
    return {
      title: x.label, tag: P2.kinds[x.kind] || null, tone: x.kind, lead: x.task, body: [x.description],
      meta: [x.costLine, x.minutes ? P2.personMinutes(x.minutes.decide, x.minutes.check) : null, x.needsModel ? P2.pop.needsParts : null, ...(marks.get(id) ?? []).map((m) => m.tip)], lock: lockOf(id),
    }
  }
  const popOfNode = (id: string): PopInfo | null => {
    const src = content.sources.find((x) => x.id === id)
    if (src) return { title: src.label, body: [src.description], meta: nodeMore(id), lock: lockOf(id) }
    return id === content.result.id ? { title: content.result.label, body: [content.result.description], meta: nodeMore(id) } : null
  }
  const shelves = (
    <div data-tour="p2-shelves"><Shelves unlocked={unlocked} lockedBy={lockedBy} onInfo={(item) => setSheet({ kind: 'item', item, more: shelfMore(item.id) })} popOf={phone ? undefined : popOfShelf}
      fresh={newIds} onSeen={seen}
      rows={[
        { title: P2.models, icon: 'model', more: content.rules.more.models, items: shownModels.map((m) => ({ id: m.id, label: m.label, short: m.short, description: m.description, costLine: m.costLine, marks: marks.get(m.id) })) },
        { title: P2.computes, icon: 'compute', more: content.rules.more.compute, items: shownCompute.map((c) => ({ id: c.id, label: c.label, short: c.short, description: c.description, costLine: c.costLine, marks: marks.get(c.id) })) },
      ]}
      words={{ locked: P2.locked, lockedNoAction: P2.lockedNoAction, info: P2.info, more: P2.moreShelf, moreLong: P2.moreShelfLong, newTag: P2.newTag }} /></div>
  )

  const api: BoardApi = {
    map, phone, briefOpen, touring, show,
    settled: draft.settled,
    load: (m, said) => { reset(); commit(m); say(said); if (phone) setTab('map'); else window.scrollTo({ top: 0, behavior: 'smooth' }) },
    toast: (text, onShow) => setToast({ text, show: onShow }),
  }

  const targets = mode.kind === 'join' ? targetsOf(map, v, mode.from) : ends.targets
  const grid = (
    <Grid v={v} map={map} flags={{ stray: noLineOut, incomplete: dv.flags.incomplete, privateData: dv.flags.privateData }} marks={marks}
      popOf={phone ? undefined : popOfNode}
      onAbout={(id) => {
        // A phone has no pointer to rest on a source, so a tap opens its card.
        if (!phone || mode.kind !== 'idle') return
        const src = content.sources.find((x) => x.id === id)
        const it = src ?? (id === content.result.id ? content.result : undefined)
        if (it) setSheet({ kind: 'item', item: { id: it.id, label: it.label, description: it.description }, more: nodeMore(id), state: !!src })
      }}
      unlocked={unlocked} lockedBy={lockedBy} mode={mode} selection={sel} targets={targets} label={P2.map}
      onCell={onCell} onNode={onNode} onPort={onPort} onPickEnd={ends.onPickEnd} onDropEnd={ends.onDropEnd}
      onLine={(key) => { if (mode.kind === 'idle') setSel((s) => (s?.kind === 'line' && s.key === key ? null : { kind: 'line', key })) }}
      onPart={(tile, part) => { reset(); setSheet({ kind: 'part', tile, part }) }}
      onDropKind={(kind, col, row) => { if (!tileAt(map, col, row)) { const r = placeTile(map, kind, col, row); commit(r.map); setSel({ kind: 'tile', id: r.id }); setMode({ kind: 'idle' }) } }}
      onDropTile={(id, col, row) => commit(moveTile(map, id, col, row))}
      onDragLine={(from, to, sides) => { join(from, to, sides); setMode({ kind: 'idle' }) }}
      bodies={bodies} guide={guide.first?.nodes.length ? { nodes: guide.first.nodes, part: guide.first.part ?? null } : null}
      note={note} onNoteClose={() => setNote(null)}
      advice={new Set(advice.keys())} onAdvice={(k) => setNote({ at: `line:${k}`, text: advice.get(k) ?? '', tone: 'advice' })}
      words={gridWords} />
  )
  const footer = (
    <div className="mapfoot">
      {status?.(api)}
      <RunningLine dv={dv} content={content} />
      <div className="footrow">
        {dv.flags.privateData.length > 0 && <span className="pwarn"><span className="cmark warn" aria-hidden="true">!</span> {P2.privateWarn}</span>}
        <ValidateButton dv={dv} guide={guide} first={dv.validations.length === 0} free={dv.validations.length < content.rules.freeValidations} onValidate={validate} onWhy={showWhy} refused={refusedValidate} ready={words.whyReady} />
      </div>
    </div>
  )
  const popOfAction = (id: string): PopInfo | null => {
    const a = rows.find((x) => x.id === id)
    if (!a) return null
    return {
      title: a.title, body: [a.teaser],
      meta: [P2.cost(a.money, a.developers, a.seconds), a.upkeep ?? null, a.storyTime ? P2.story(a.storyTime) : null, a.opens.length ? P2.opens(a.opens.join(', '), !a.inPlace) : null, a.inPlace ? P2.inPlace : null,
        a.tag ?? null, a.state === 'done' ? P2.pop.done : a.state === 'running' ? P2.pop.running(a.left ?? 0) : null],
      lock: a.state === 'blocked' ? a.blocked ?? null : null,
    }
  }
  const spendNote = !spendSeen && started >= P2.spendAfter ? (
    <div className="spendnote" role="status">
      <b>{P2.spendTitle}</b>
      <span>{P2.spendText(started)}</span>
      <button type="button" className="btn small" onClick={() => { store.setFlag(spendFlag); setSpendSeen(true) }}>{P2.spendOk}</button>
    </div>
  ) : null
  const actions = (
    <ActionList groups={content.rules.actionGroups} rows={rows} onStart={(id) => { seenAction(id); start(id) }} refused={refusedAction} popOf={phone ? undefined : popOfAction} notice={phone ? spendNote : null}
      more={content.rules.more.actions} fresh={newActions} onSeen={seenAction}
      words={{ start: P2.start, done: P2.done, cost: P2.cost, story: P2.story, opens: P2.opens, inPlace: P2.inPlace, left: P2.leftS, holds: P2.holds, noCancel: P2.noCancel, noCancelLong: P2.noCancelLong, more: P2.more, moreHere: P2.moreActions, newTag: P2.newTag }} />
  )
  const toolbox = (
    <Toolbox phone={phone} picked={mode.kind === 'place' ? mode.worker : null} unlocked={unlocked} lockedBy={lockedBy} groups={content.rules.toolboxGroups}
      popOf={phone ? undefined : popOfTool} more={content.rules.more.toolbox} fresh={newIds} onSeen={seen}
      onPick={(id) => { setSel(null); setNote(null); setMode(id ? { kind: 'place', worker: id } : { kind: 'idle' }); if (id && phone) setTab('map') }}
      workers={shownWorkers.map((x) => ({
        id: x.id, label: x.label, short: x.short, description: x.description, costLine: x.costLine, icon: x.icon, kind: x.kind,
        task: x.task, group: x.group, extra: x.minutes ? P2.personMinutes(x.minutes.decide, x.minutes.check) : null, marks: marks.get(x.id),
      }))}
      words={{ locked: P2.locked, lockedNoAction: P2.lockedNoAction, pickHint: P2.pickHint, picked: P2.picked, kinds: P2.kinds, lockedTold: P2.lockedTold, more: P2.moreTools, newTag: P2.newTag }} />
  )
  const insights = <InsightsPanel w={w} content={content} dv={dv} fresh={fresh} phase={phase} letters={letters} freshLetters={freshLetters} title={words.insightsTitle} />

  // --- the sheets of a tile's parts and of a shelf item
  let sheetEl: React.ReactNode = null
  if (sheet?.kind === 'item') {
    sheetEl = <ItemSheet item={sheet.item} more={sheet.more} state={sheet.state} locked={!unlocked.has(sheet.item.id)} lockedBy={lockedBy} onClose={() => setSheet(null)} words={{ locked: P2.locked, lockedNoAction: P2.lockedNoAction, close: P2.close, open: P2.open }} />
  } else if (sheet?.kind === 'clear') {
    sheetEl = (
      <Dialog title={P2.clearTitle} head="sun" onClose={() => setSheet(null)}>
        <p style={{ fontSize: 16, lineHeight: 1.45 }}>{P2.clearText(map.tiles.length, map.lines.length)}</p>
        <div className="sheet-actions">
          <button type="button" className="btn" onClick={() => setSheet(null)}>{P2.clearNo}</button>
          <button type="button" className="btn danger" onClick={clearMap}>{P2.clearYes}</button>
        </div>
      </Dialog>
    )
  } else if (sheet?.kind === 'same') {
    sheetEl = (
      <Dialog title={P2.sameTitle} head="sun" onClose={() => setSheet(null)}>
        <p style={{ fontSize: 16, lineHeight: 1.45 }}>{sheet.text} {P2.sameAsk(dv.validationsLeft)}</p>
        <div className="sheet-actions">
          <button type="button" className="btn go" onClick={() => setSheet(null)}>{P2.sameNo}</button>
          <button type="button" className="btn" onClick={() => { setSheet(null); runValidation() }}>{P2.sameYes}</button>
        </div>
      </Dialog>
    )
  } else if (sheet?.kind === 'part') {
    const t = tileOf(map, sheet.tile)
    // What the model of a tile reads with the lines it has now, as the server last counted it.
    const readOf = (id: string) => dv.running?.reads?.find((x) => x.tile === id && x.tokens > 0)
    const w2 = t ? content.workers.find((x) => x.id === t.kind) : undefined
    if (t && w2) {
      const name = nodeLabel(t.id)
      const close = () => setSheet(null)
      const set = (part: Part, value: string | null) => { commit(setPart(map, v, t.id, part, value)); close() }
      if (sheet.part === 'prompt') {
        const reads = map.lines.filter((l) => l.to === t.id && content.sources.some((x) => x.id === l.from)).map((l) => labelOf(content, l.from))
        const from = map.lines.filter((l) => l.to === t.id && tileOf(map, l.from)).map((l) => nodeLabel(l.from))
        sheetEl = <PromptSheet title={P2.promptOf(name)} about={P2.promptAbout(name, reads, from)} prompts={shownPrompts.map((x) => ({ ...x, marks: marks.get(x.id) }))} current={t.prompt} unlocked={unlocked} lockedBy={lockedBy}
          onPick={(id) => set('prompt', id)} onClose={close}
          words={{ intro: content.rules.more.prompts ? `${P2.promptIntro} ${P2.morePrompts}` : P2.promptIntro, use: P2.use, inUse: P2.inUse, isDefault: P2.isDefault, close: P2.close, locked: P2.locked, lockedNoAction: P2.lockedNoAction, more: P2.showMore, less: P2.showLess }} />
      } else if (sheet.part === 'model') {
        sheetEl = <PartSheet title={P2.modelOf(name)} onPick={(id) => set('model', id)} onClose={close}
          words={{ close: P2.close, current: P2.current, clear: P2.clearPart }}
          intro={[readOf(t.id) ? P2.readsIntro(name, readOf(t.id)!.model, readOf(t.id)!.tokens, readOf(t.id)!.money) : null, content.rules.more.models ? P2.moreShelfLong : null].filter(Boolean).join(' ') || undefined}
          choices={shownModels.map((m) => ({
            id: m.id, label: m.label, detail: m.costLine ?? m.description, current: t.model === m.id, marks: marks.get(m.id),
            disabled: !w2.models.includes(m.id) ? P2.cannotCarry : null,
          }))} />
      } else {
        const model = content.models.find((m) => m.id === t.model)
        // A model that runs nowhere on the board yet names what is on the board and says that more will come.
        sheetEl = <PartSheet title={P2.computeOf(name)} intro={[P2.computeIntro(model?.label ?? null), content.rules.more.compute ? P2.moreShelfLong : null].filter(Boolean).join(' ')} onPick={(id) => set('runsOn', id)} onClose={close}
          words={{ close: P2.close, current: P2.current, clear: P2.clearPart }}
          choices={shownCompute.map((c) => ({
            id: c.id, label: c.label, detail: [c.description, c.costLine].filter(Boolean).join(' '), current: t.runsOn === c.id, marks: marks.get(c.id),
            disabled: model && !model.runsOn.includes(c.id)
              ? P2.cannotRun(model.short, model.runsOn.filter((x) => unlocked.has(x)).map((x) => content.compute.find((y) => y.id === x)?.short ?? x).join(', ') || P2.nowhereYet) : null,
          }))} />
      }
    }
  }
  const closeBrief = () => { store.setFlag(briefFlag); setBriefOpen(false) }
  const doneCount = new Set(dv.actionsDone.map((d) => d.id)).size
  const tabs: BoardTab[] = above ? ['map', 'actions', 'toolbox', 'year', 'results'] : ['map', 'actions', 'toolbox', 'results']
  const overlayEls = (
    <>
      {sheetEl}
      {overlays?.(api)}
      {toast && <Toast text={toast.text} onShow={toast.show} onClose={() => setToast(null)} />}
      {warning && <div className="toast warnbar" role="status">{warning}</div>}
      {briefOpen && <BriefSheet w={w} phase={phase} onClose={closeBrief} words={words.brief} />}
      <Tour phase={phase} steps={words.tour} doneKey={`tour-${phase}-${view.me.id}-${view.run}`} autoStart={!briefOpen && !held} onTab={(t) => setTab(t as BoardTab)} onEnd={() => setTab('map')} words={COPY.tour} />
      <HelpSheet phase={phase} title={words.helpTitle} intro={words.helpIntro} steps={words.tour} tourLabel={COPY.takeTour} more={helpMore}>
        <div className="eyebrow">{P2.helpMarks}</div>
        <div className="help-marks">
          <div className="hm"><LineLegend words={P2.legend} /><span /></div>
          <div className="hm"><span className="cmark warn" aria-hidden="true">!</span><span>{P2.markWarn}</span></div>
          <div className="hm"><span className="hm-stray" aria-hidden="true" /><span>{P2.markStray}</span></div>
          <div className="hm"><span className="hm-missing" aria-hidden="true">{P2.pickModel}</span><span>{P2.markMissing}</span></div>
          <div className="hm"><span className="hm-guide" aria-hidden="true" /><span>{P2.markGuide}</span></div>
          <div className="hm"><svg width="22" height="22" viewBox="-11 -11 22 22" className="cadvice" aria-hidden="true"><circle r={9} /><text y={4.5} textAnchor="middle">i</text></svg><span>{P2.markAdvice}</span></div>
          <div className="hm"><span className="cmark lock" aria-hidden="true">🔒</span><span>{P2.markLock}</span></div>
        </div>
      </HelpSheet>
    </>
  )

  if (phone) {
    const counts: Record<BoardTab, string> = {
      map: `${map.tiles.length}`, actions: dv.actionsRunning.length ? `${dv.actionsRunning.length} running` : `${doneCount} done`,
      toolbox: '', year: '', results: dv.validations.length ? P2.acc1(dv.validations.at(-1)!.accuracy) : '–', ...tabCounts,
    }
    return (
      <PopLayer off>
      <div className="p2-phone">
        {strip}
        <div className="p2-phone-main">
          {tab === 'map' && (
            <div className="p2pmap">
              <Purse dv={dv} content={content} />
              {bar}
              {shelves}
              <div className="gridscroll" data-tour="p2-grid">{grid}</div>
              {footer}
            </div>
          )}
          {tab === 'actions' && <div className="p2pcol" data-tour="p2-actions"><Purse dv={dv} content={content} /><div className="bwline pad">{dv.money < 0 ? P2.belowZero : P2.moneyLine}</div>{actions}</div>}
          {tab === 'toolbox' && <div className="p2pcol" data-tour="p2-tools">{toolbox}</div>}
          {tab === 'year' && above && <div className="p2pcol pad">{above(api)}</div>}
          {tab === 'results' && <div className="p2pcol pad" data-tour="p2-below">{results(api)}{insights}</div>}
        </div>
        <nav className={`ptabs ${tabs.length === 5 ? 'five' : 'four'}`} aria-label={words.phase}>
          {tabs.map((t) => (
            <button key={t} type="button" className={tab === t ? 'on' : ''} aria-pressed={tab === t} onClick={() => setTab(t)}>
              <span className="tl">{words.tab[t]}</span>{counts[t] && <span className="tc">{counts[t]}</span>}
            </button>
          ))}
        </nav>
        {overlayEls}
      </div>
      </PopLayer>
    )
  }

  return (
    <PopLayer off={touring || sheet !== null}>
    <div className="p2">
      <div className={`p2-top${content.rules.cols >= 5 ? ' dense' : ''}`}>
        <section className="colbox p2-actions" aria-label={P2.actions} data-tour="p2-actions">
          <div className="colhead sun"><h2>{P2.actions}</h2><span className="s">{doneCount} / {content.actions.length}</span></div>
          {/* Above the list, outside what scrolls: a notice that lands while the list is scrolled is still seen. */}
          {spendNote}
          <div className="colscroll">{actions}</div>
        </section>
        <section className="colbox p2-map" aria-label={P2.map}>
          <div className="colhead sky maphead"><h2>{P2.map}</h2>{bar}</div>
          {shelves}
          <div className="gridwrap" data-tour="p2-grid">{grid}</div>
          {footer}
        </section>
        <section className="colbox p2-tools" aria-label={P2.toolbox} data-tour="p2-tools">
          <div className="colhead lav"><h2>{P2.toolbox}</h2></div>
          <div className="colscroll">{toolbox}</div>
        </section>
      </div>
      <div className={`p2-below${above ? ' with-above' : ''}`} data-tour="p2-below">
        {above && <div className="p2-above">{above(api)}</div>}
        {results(api)}
        {insights}
      </div>
      {overlayEls}
    </div>
    </PopLayer>
  )
}

/** The sentence for a map that was validated before, in the words of Phase 2. */
export function sameAsValidation(validations: { map: CanvasMap }[], map: CanvasMap): string | null {
  const at = validations.findLastIndex((x) => sameLayout(x.map, map))
  if (at < 0) return null
  return at === validations.length - 1 ? P2.sameLast : P2.sameEarlier(at + 1)
}
