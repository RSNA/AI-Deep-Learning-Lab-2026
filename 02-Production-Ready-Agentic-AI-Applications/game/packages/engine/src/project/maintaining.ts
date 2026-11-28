// Projection of Phase 3 (engineering spec, sections 6.7, 9 and 10.8): the content of the phase,
// a player's own year, and the same year beside the key for a host. Built field by field. An
// event reaches a player only as the symptom of a report it acted in, its cause only with the
// lens it asks for, and its lesson at the reveal.
import {
  overPools, periodName, phase3Build, readyDetails, readyReasons, referenceMaps, ruledLines, tileMinutes,
  type BuildFile, type CanvasMap, type MaintainFile, type Pack,
} from '@lab02/content-schema'
import type { MaintainingContent, MaintainingReport as ReportView, MaintainingSpent, MaintainingView } from '@lab02/protocol'
import type { HostInspect } from '@lab02/protocol/host'
import { running as runningOf, type BillLine } from '../canvas.ts'
import { costFirst, mapHints, type MapHints } from '../hints.ts'
import { baselineMap, counts, lensHeld, year, type HeldAction } from '../maintain.ts'
import {
  developersFreeIn3, heldActions, paidOf, referenceOffer, roundEndMs, roundsNow, runsUsed, scoreSoFar, shownActionsIn3, unlockedIn3, unseenModels,
} from '../phases/maintaining.ts'
import type { MaintainingReport, MaintainingState, PlayerState, RiskEntry, SessionState } from '../state.ts'
import { actionView, boardNumber, canvasContent, canvasLegend, detailView, incompleteTiles, mapView, marksView, missedView, readsView, referenceViews, runningView, tileView, type BoardShown } from './canvas.ts'

type Files = { b: BuildFile; mt: MaintainFile; b3: BuildFile }

function filesOf(pack: Pack, p: PlayerState): Files | null {
  const sp = pack.systems[p.system]
  if (!sp?.build || !sp.maintain) return null
  return { b: sp.build, mt: sp.maintain, b3: phase3Build(sp.build, sp.maintain) }
}

/** What of the board of Phase 3 this player has. */
function boardShown(pack: Pack, p: PlayerState): Omit<BoardShown, 'actions'> & { actions: BuildFile['actions'] } {
  return { unlocked: unlockedIn3(pack, p), actions: shownActionsIn3(pack, p), unseen: unseenModels(pack, p) }
}

/**
 * What a purchase of a reference map is called in its offer. An action on the player's board
 * goes by its title. One that is still hidden goes by what it puts on the board (the tool, the
 * source, the model), whose names a player may see, so that the offer gives no hidden action away.
 */
export function offerTitle(pack: Pack, p: PlayerState, b3: BuildFile, actionId: string, title: string): string {
  if (shownActionsIn3(pack, p).some((a) => a.id === actionId)) return title
  const label = (id: string) =>
    b3.workers.find((x) => x.id === id)?.public.label ?? b3.sources.find((x) => x.id === id)?.public.label ?? b3.models.find((x) => x.id === id)?.public.label
    ?? b3.compute.find((x) => x.id === id)?.public.label ?? b3.prompts.find((x) => x.id === id)?.public.label
  const gives = (b3.actions.find((a) => a.id === actionId)?.unlocks ?? []).map(label).filter((x): x is string => !!x)
  return gives.length ? gives.join(', ') : 'What the system needs'
}

export function maintainingContent(s: SessionState, pack: Pack, playerId: string): MaintainingContent {
  const p = s.players[playerId]!
  const sp = pack.systems[p.system]!
  const { b, mt, b3 } = filesOf(pack, p)!
  const rules = pack.game.phases.maintaining
  const own = new Map(mt.actions.map((a) => [a.id, a]))
  const shown = boardShown(pack, p)
  return {
    phase: 'maintaining',
    ...canvasContent(pack, sp, b3, {
      brief: sp.story?.briefs?.maintaining, validations: mt.validate.runs, validateSeconds: mt.validate.seconds,
      actionGroups: [...(pack.game.phases.development.action_groups ?? []), ...rules.action_groups],
    }, shown),
    actions: shown.actions.map((a) => ({ ...actionView(a), repeat: !!own.get(a.id)?.repeat, upkeep: own.get(a.id)?.run ?? 0 })),
    year: {
      baselineLabel: mt.baseline.public.label,
      costPerPoint: mt.score.cost_per_point,
    },
    references: referenceViews(b, b3),
  }
}

// ------------------------------------------------------------------------------------------
// A report
// ------------------------------------------------------------------------------------------
/** The first band whose `min` the value reaches, read from the highest down. */
function bandText(bands: readonly { min: number; text: string }[], value: number): string | null {
  return bands.find((x) => value >= x.min - 1e-9)?.text ?? null
}

/** The public name of a part that can fail. */
function partLabel(b3: BuildFile, e: RiskEntry): string {
  switch (e.part) {
    case 'worker': return b3.workers.find((w) => w.id === e.id)?.public.label ?? 'A tile'
    case 'source': return b3.sources.find((x) => x.id === e.id)?.public.label ?? 'A source'
    case 'compute': return b3.compute.find((x) => x.id === e.id)?.public.label ?? 'A place to run'
    case 'handoff': return 'A handoff between two tiles'
    case 'new_map': return 'The new map'
    case 'event': return 'The whole system'
  }
}

/** A line of a bill in the words of the pack: what was paid for. */
function billLabel(b3: BuildFile, x: BillLine): string {
  const place = () => b3.compute.find((c) => c.id === x.id)?.public
  switch (x.kind) {
    case 'calls': return `${place()?.label ?? 'A place to run'}: model calls`
    case 'place': return `${place()?.label ?? 'A place to run'}: ${place()?.bill_line ?? 'monthly cost'}`
    case 'worker': return `${b3.workers.find((w) => w.id === x.id)?.public.label ?? 'A tile'}${x.count > 1 ? ` × ${x.count}` : ''}`
    case 'source': return `${b3.sources.find((s) => s.id === x.id)?.public.label ?? 'A source'}: access`
    case 'action': return b3.actions.find((a) => a.id === x.id)?.public.title ?? 'An action'
    case 'fine': return 'Fine'
  }
}

/** One model of a bill: the tile, its model, and about how much it read for a patient. */
export function readLabel(m: { name: string; model: string; tokens: number }): string {
  return `${m.name} on ${m.model} read about ${m.tokens.toLocaleString('en-US')} tokens per patient`
}

/** What happened to the part that failed most: the symptom of the event that added the risk, or the incident of the part. */
function partText(mt: MaintainFile, e: RiskEntry): string | null {
  if (e.event !== null) return mt.events.find((x) => x.id === e.event)?.symptom ?? null
  const inc = mt.incidents
  switch (e.part) {
    case 'worker': return (e.id !== null ? inc.workers[e.id] : undefined) ?? inc.default_worker ?? null
    case 'source': return (e.id !== null ? inc.sources[e.id] : undefined) ?? null
    case 'compute': return (e.id !== null ? inc.compute[e.id] : undefined) ?? null
    case 'handoff': return inc.handoff ?? null
    case 'new_map': return inc.new_map ?? null
    case 'event': return null
  }
}

/** Every part that failed, grouped by what it is, with the share of the cases it lost, the largest first. */
function partsView(b3: BuildFile, r: MaintainingReport): { label: string; share: number }[] {
  const groups = new Map<string, { label: string; share: number }>()
  for (const e of r.components) {
    const key = `${e.part}:${e.id ?? ''}`
    const g = groups.get(key) ?? { label: partLabel(b3, e), share: 0 }
    g.share += e.risk
    groups.set(key, g)
  }
  return [...groups.values()].sort((x, y) => y.share - x.share)
}

function reportView(f: Files, held: readonly HeldAction[], found: readonly string[], r: MaintainingReport, before: MaintainingReport | undefined, rank: { rank: number | null; of: number }, ran: CanvasMap, shown: BoardShown): ReportView {
  const { mt, b3 } = f
  const label = periodName(mt, r.period)
  const lens = (name: string) => lensHeld(mt, name, held, r.period)
  const worst = r.worstPart === null ? undefined : r.components[r.worstPart]
  const worstText = worst ? partText(mt, worst) : null
  const event = r.worstEvent === null ? undefined : mt.events.find((e) => e.id === r.worstEvent)
  const people = mt.report.radiologists
  const worse = !!before && !before.noMap && (r.validity < before.validity - 0.005 || r.reliability < before.reliability - 0.005)
  return {
    period: r.period, label: label?.label ?? '', short: label?.short ?? '', atMs: r.atMs,
    map: r.map,
    validity: r.validity, test: r.test, reliability: r.reliability, interruptions: r.interruptions,
    value: r.value, off: r.off, runCost: r.runCost, fine: r.fine,
    // Under the model calls of a place: every model that ran there, with what it read.
    bill: r.bill.map((x) => ({
      label: billLabel(b3, x), money: x.money,
      parts: x.kind === 'calls'
        ? readsView(r.reads, ran, b3).filter((m) => r.reads?.[m.tile]?.place === x.id).map((m) => ({ label: readLabel(m), money: m.money }))
        : [],
    })),
    granted: r.granted, account: r.account,
    spent: r.spent, score: r.score,
    rank: rank.rank, of: rank.of,
    sentences: {
      validity: r.noMap ? null : bandText(mt.report.validity, 100 * r.validity),
      reliability: r.noMap ? null : bandText(mt.report.reliability, 100 * r.reliability),
      gap: !r.noMap && 100 * (r.test - r.validity) > (mt.report.gap_points ?? 2) ? mt.report.gap ?? null : null,
      people: r.noMap || !people ? null : r.hurry < 1 ? people.rushed : r.poolTiles > 1 ? people.extra_look : people.content,
      steady: !r.noMap && !event && !worse ? mt.report.steady ?? null : null,
      noMap: r.noMap ? mt.report.no_map ?? null : null,
    },
    missed: missedView(b3, r.missed, ran, shown),
    note: r.note ? b3.notes.find((n) => n.id === r.note)?.text ?? null : null,
    worstPart: worst && worstText !== null ? { label: partLabel(b3, worst), text: worstText } : null,
    worstChange: event?.symptom !== undefined ? { symptom: event.symptom, cause: event.cause && (event.cause.lens !== undefined ? lens(event.cause.lens) : found.includes(event.id)) ? event.cause.text : null } : null,
    parts: !r.noMap && lens('incident_log') ? partsView(b3, r) : null,
    kinds: lens('case_mix') ? b3.cases.map((k) => ({ title: k.public.title, solved: r.perCase[k.id] ?? 0 })) : null,
  }
}

/** The rank of a player's report among the practices that hold the report of the same period. */
function reportRank(s: SessionState, p: PlayerState, index: number): { rank: number | null; of: number } {
  const mine = p.maintaining?.reports[index]
  let rank = 1, of = 0
  for (const id of s.order) {
    const o = s.players[id]!
    const theirs = o.removed ? undefined : o.maintaining?.reports[index]
    if (!theirs) continue
    of++
    if (mine && o.id !== p.id && (theirs.score > mine.score + 1e-9 || (Math.abs(theirs.score - mine.score) <= 1e-9 && o.joinSeq < p.joinSeq))) rank++
  }
  return { rank: mine && !p.removed ? rank : null, of }
}

function spentView(st: MaintainingState): MaintainingSpent {
  const running = st.reports.reduce((sum, r) => sum + r.runCost, 0)
  const fines = st.reports.reduce((sum, r) => sum + r.fine, 0)
  return { phase2: st.paidPhase2, actions: st.paidActions, adoption: st.paidAdoption, running, fines, total: paidOf(st) + running + fines }
}

// ------------------------------------------------------------------------------------------
// The reveal: the year of each reference map left alone, and of a practice with no map
// ------------------------------------------------------------------------------------------
type RevealYears = { references: NonNullable<MaintainingView['reveal']>['references']; baseline: NonNullable<MaintainingView['reveal']>['baseline'] }
const years = new WeakMap<MaintainFile, Map<number, RevealYears>>()

/** Over `n` periods, as many as the year of the session had. The same for every player of a health system, so it is worked out once. */
function revealYears(f: Files, n: number): RevealYears {
  const byLength = years.get(f.mt) ?? new Map<number, RevealYears>()
  years.set(f.mt, byLength)
  const cached = byLength.get(n)
  if (cached) return cached
  const references = referenceMaps(f.b).map((ref) => {
    // Left alone: the map runs all year with the actions it needed, and nothing else is done.
    const actions = ref.needsActions.map((id) => ({ id, started: 0, done: 0 }))
    const paid = ref.needsActions.reduce((sum, id) => sum + (f.b3.actions.find((a) => a.id === id)?.money ?? 0), 0)
    const y = year(f.b3, f.mt, Array.from({ length: n }, () => ({ map: ref.map, actions, newMap: false })), paid)
    return { id: ref.id, label: ref.label, values: y.values, validity: y.validity, reliability: y.reliability, mean: y.mean, spent: y.spent, score: y.score }
  })
  const none = year(f.b3, f.mt, Array.from({ length: n }, () => ({ map: null, actions: [], newMap: false })), 0)
  const out: RevealYears = { references, baseline: { label: f.mt.baseline.public.label, values: none.values, score: none.score } }
  byLength.set(n, out)
  return out
}

// ------------------------------------------------------------------------------------------
// The player view
// ------------------------------------------------------------------------------------------
export function maintainingView(s: SessionState, pack: Pack, p: PlayerState): MaintainingView | null {
  const st = p.maintaining
  const f = filesOf(pack, p)
  if (!st || !f) return null
  const { b, mt, b3 } = f
  const show = pack.game.phases.development.show_running ?? true
  const closed = s.closedPhases.includes('maintaining')
  const seen = st.reports.length
  // A year that is over had one round less than it has reports. One that runs has the rounds of its clock.
  const rounds = closed ? Math.max(1, seen - 1) : roundsNow(s, pack)
  const total = Math.max(seen, rounds + 1)
  const held = heldActions(st)
  const shown = boardShown(pack, p)
  const reasons = readyReasons(st.map, b3)
  const run = runningOf(st.map, b3)
  const refLabel = new Map(referenceMaps(b).map((r) => [r.id, r.label]))
  const insights: MaintainingView['insights'] = []
  // One card per action: that of its last run. A look action that found something shows what it found.
  for (const d of st.actionsDone) {
    const a = b3.actions.find((x) => x.id === d.id)
    const found = d.found === undefined ? undefined : mt.actions.find((x) => x.id === d.id)?.finds?.find((x) => x.event === d.found)?.insight
    const tile = found ?? a?.insight
    if (!a || !tile) continue
    // The card of a later run takes the place of the earlier one, at the end of the list.
    const at = insights.findIndex((x) => x.action === a.id)
    if (at >= 0) insights.splice(at, 1)
    insights.push({ action: a.id, tile: tileView(tile) })
  }
  let reveal: MaintainingView['reveal'] = null
  if (closed && st.result) {
    const y = revealYears(f, seen)
    reveal = {
      score: st.result.score, raw: st.result.raw, mean: st.result.mean,
      values: st.reports.map((r) => r.value),
      spent: spentView(st),
      costPerPoint: mt.score.cost_per_point,
      events: mt.events.filter((e) => e.reveal).map((e) => {
        const periods = st.reports.filter((r) => r.events.some((x) => x.id === e.id && x.hit)).map((r) => r.period)
        return { id: e.id, title: e.reveal!.title, text: e.reveal!.text, from: e.from, acted: periods.length > 0, periods }
      }),
      references: y.references.map((r) => ({ id: r.id, label: r.label, values: [...r.values], validity: [...r.validity], reliability: [...r.reliability], mean: r.mean, spent: r.spent, score: r.score })),
      baseline: { label: y.baseline.label, values: [...y.baseline.values], score: y.baseline.score },
    }
  }
  const lens = (name: string) => lensHeld(mt, name, held, seen + 1)
  const roundEnd = closed ? null : roundEndMs(s, pack, seen) ?? (s.stage === 'maintaining.year' ? s.stageEndsAtMs : null)
  return {
    money: st.money,
    developers: { total: b3.budget.developers, free: developersFreeIn3(pack, p) },
    board: boardNumber(shown),
    unlocked: [...unlockedIn3(pack, p)].sort(),
    marks: marksView(b3, st.actionsDone.map((d) => d.id)),
    actionsDone: st.actionsDone.map((d) => ({ id: d.id, atMs: d.atMs, phase: d.started === 0 ? 'development' as const : 'maintaining' as const })),
    actionsRunning: st.actionsRunning.map((r) => ({ id: r.id, startedAtMs: r.startedAtMs, completesAtMs: r.completesAtMs })),
    insights,
    map: mapView(st.map),
    ready: { ok: reasons.length === 0, reasons: [...reasons], details: readyDetails(st.map, b3).map(detailView) },
    lineAdvice: ruledLines(st.map, b3).filter((x) => !x.rule.refuse).map((x) => ({ from: x.line.from, to: x.line.to, text: x.rule.text })),
    tileMinutes: show ? { ...tileMinutes(st.map, b3) } : {},
    rushed: overPools(st.map, b3).filter((o) => o.rush).map((o) => ({ pool: o.pool, used: o.used, max: o.max, tiles: [...o.tiles] })),
    flags: { stray: run.stray, incomplete: incompleteTiles(b3, st.map), privateData: run.privateData },
    running: show ? runningView(run.running, st.map, b3) : null,
    validationsLeft: Math.max(0, mt.validate.runs - runsUsed(st)),
    validating: st.validating ? { id: st.validating.id, startedAtMs: st.validating.startedAtMs, completesAtMs: st.validating.completesAtMs } : null,
    validations: st.validations.map((v) => ({
      id: v.id, atMs: v.atMs, map: mapView(v.map), accuracy: v.accuracy, unhurried: v.unhurried ?? null,
      missed: missedView(b3, v.missed, v.map, shown),
      note: v.note ? b3.notes.find((n) => n.id === v.note)?.text ?? null : null,
      running: show ? runningView(v.running, v.map, b3) : null,
      origin: v.origin,
      label: v.reference !== null ? refLabel.get(v.reference) ?? null : null,
      reference: v.reference,
      fresh: v.fresh,
      reliability: v.reliability,
    })),
    deployed: st.deployed,
    round: { index: Math.max(1, Math.min(rounds, seen)), of: rounds, endsAtMs: roundEnd },
    slots: Array.from({ length: total }, (_x, i) => { const name = periodName(mt, i + 1); return { tick: name.tick, mark: name.mark } }),
    next: closed || seen >= total ? null : { label: periodName(mt, seen + 1).label, short: periodName(mt, seen + 1).short },
    seen,
    reports: st.reports.map((r, i) => reportView(f, held, st.found, r, st.reports[i - 1], reportRank(s, p, i), st.validations.find((v) => v.id === r.map)?.map ?? baselineMap(mt), shown)),
    adopted: [...st.adopted],
    offers: referenceMaps(b).filter((r) => !st.adopted.includes(r.id)).map((r) => {
      const o = referenceOffer(pack, p, r)
      return { id: r.id, buys: o.needs.map((n) => ({ title: offerTitle(pack, p, b3, n.id, n.title), money: n.money })), price: o.price }
    }),
    lenses: { freshTestSet: lens('fresh_test_set'), dryRun: lens('dry_run'), incidentLog: lens('incident_log'), caseMix: lens('case_mix'), driftAlarm: lens('drift_alarm') },
    spent: spentView(st),
    score: scoreSoFar(pack, p),
    reveal,
  }
}

/** One short line for the players table of the host console (section 10.8). */
export function maintainingStatus(pack: Pack, p: PlayerState): string {
  const st = p.maintaining
  const f = filesOf(pack, p)
  if (!st || !f) return 'Running the year'
  const last = st.reports.at(-1)
  const parts = [`report ${st.reports.length} of ${Math.max(st.reports.length, f.mt.periods.length)}`]
  if (last) parts.push(last.noMap ? 'no system runs' : `${Math.round(100 * last.validity)}% right · ${Math.round(100 * last.reliability)}% of the time`)
  parts.push(`score ${Math.max(0, Math.round(10 * scoreSoFar(pack, p)) / 10)}`)
  if (st.actionsRunning.length) parts.push(`${st.actionsRunning.length} running`)
  if (st.validating) parts.push('validating')
  return parts.join(' · ')
}

// ------------------------------------------------------------------------------------------
// The host's view of a player
// ------------------------------------------------------------------------------------------
/** A few lines for a host who helps this player: what holds them back, what to say, what is good. */
function glimpse(f: Files, st: MaintainingState, held: readonly HeldAction[]): NonNullable<HostInspect['maintaining']>['glimpse'] {
  const { mt, b3 } = f
  const holds: string[] = [], say: string[] = [], good: string[] = []
  const last = st.reports.at(-1)
  const seen = st.reports.length
  const run = st.deployed === null ? undefined : st.validations.find((v) => v.id === st.deployed)
  if (!run) {
    holds.push('No system of theirs runs. The practice works as it did before the project.')
    say.push(st.validations.length ? 'They have a system on their list. Ask why it is not deployed.' : 'Ask whether they want to start from the proposed system, and deploy it.')
  }
  // An account below zero stops every purchase, so it stands before everything else that is said.
  if (st.money < 0) {
    holds.push('Their account is below zero, so they cannot buy anything. Every report takes the running cost of the system in service.')
    if (last && last.runCost > 0) say.push('Ask which line of their last bill is the largest. A text tool in front of a long source, a smaller model for the agent that gathers, or another place to run the models would each make it smaller.')
  }
  // What acts on them now: every event that cost them something in the last report.
  for (const x of last?.events ?? []) {
    if (!x.hit) continue
    const coach = mt.events.find((e) => e.id === x.id)?.key?.coach
    if (!coach) continue
    if (holds.length < 4) holds.push(coach.holds)
    if (say.length < 4) say.push(coach.say)
  }
  // Up to here the lines stand before the hints on the shape of the system (`first`).
  const first = { holds: holds.length, say: say.length }
  if (last && !last.noMap) {
    if (last.reliability < 0.85 && run) holds.push(`Their map stops often: ${run.map.tiles.length} tiles and ${run.map.lines.length} lines, and each one can fail.`)
    if (last.off > 0) holds.push('The people who check are asked more than once, or for more minutes than they have.')
    if (100 * (last.test - last.validity) > (mt.report.gap_points ?? 2) && !lensHeld(mt, 'fresh_test_set', held, seen + 1)) {
      holds.push('Their validations still run on the test set, which no longer looks like the year.')
    }
    if (last.reliability >= 0.92) good.push('Their system runs almost without a break.')
    if (last.validity >= 0.9) good.push('Nearly every result that goes out is right.')
  }
  const lenses = Object.entries(mt.lenses).filter(([name]) => lensHeld(mt, name, held, seen + 1)).length
  if (lenses === 0 && seen >= 2) say.push('Ask what they would want to know before changing anything, and which action would tell them.')
  if (lenses > 0) good.push(`They look before they change: ${lenses} of the actions that make a report say more are done.`)
  const repaired = mt.events.filter((e) => e.from <= seen && counts(held, e.repaired_by, seen + 1, e.from) && e.reveal).map((e) => e.reveal!.title)
  if (repaired.length) good.push(`They repaired what broke: ${repaired.join(', ')}.`)
  const start = mt.grants.reduce((sum, g) => sum + (g.round <= st.roundsOpened ? g.money : 0), 0)
  if (seen >= 3 && st.money > 0.6 * start && (last?.events.some((x) => x.hit) ?? false)) say.push('They still hold most of their money. Ask what the last report says is worth paying for.')
  if (run && b3.sources.length && st.adopted.length === 0 && run.origin !== 'reference') good.push('They run a system of their own.')
  return { holds, say, good, first }
}

/**
 * What the shape of the system in service says to a host who helps (`mapHints`). The money is
 * that of the last bill, per month, when that bill was for this system. When the bill is the
 * trouble (an account below zero, or the models as its largest line), the hints about cost
 * come first. The locked sources are a matter of Phase 2 and are left out.
 */
function serviceHints(pack: Pack, p: PlayerState, st: MaintainingState, b3: BuildFile): MapHints {
  const run = st.deployed === null ? undefined : st.validations.find((v) => v.id === st.deployed)
  if (!run) return { hints: [], good: [] }
  const last = st.reports[st.reports.length - 1]
  const billed = last && last.map === run.id && last.reads
    ? Object.fromEntries(Object.entries(last.reads).map(([tile, r]) => [tile, { money: r.money / 2 }]))
    : undefined
  const h = mapHints(run.map, b3, unlockedIn3(pack, p), null, billed)
  const calls = (last?.bill ?? []).filter((x) => x.kind === 'calls').reduce((sum, x) => sum + x.money, 0)
  const other = Math.max(0, ...(last?.bill ?? []).filter((x) => x.kind !== 'calls').map((x) => x.money))
  return st.money < 0 || (calls > 0 && calls >= other) ? costFirst(h) : h
}

/**
 * What the models of the system in service read and cost a month. The last report holds the
 * prices that act now (a provider may have raised them); before the first report of a system
 * the numbers of its validation stand in.
 */
function serviceReads(st: MaintainingState, b3: BuildFile): ReturnType<typeof readsView> {
  const run = st.deployed === null ? undefined : st.validations.find((v) => v.id === st.deployed)
  if (!run) return []
  const last = st.reports[st.reports.length - 1]
  if (last && last.map === run.id && last.reads) {
    return readsView(last.reads, run.map, b3).map((x) => ({ ...x, money: x.money / 2 }))
  }
  return readsView(run.running.reads, run.map, b3)
}

/** Phase 3 of one player beside the key, for a host only (section 10.8). */
export function maintainingInspect(s: SessionState, pack: Pack, p: PlayerState): HostInspect['maintaining'] {
  const st = p.maintaining
  const f = filesOf(pack, p)
  if (!st || !f) return null
  const { b, mt, b3 } = f
  const held = heldActions(st)
  const reasons = readyReasons(st.map, b3)
  const done = new Map<string, number>()
  for (const d of st.actionsDone) done.set(d.id, (done.get(d.id) ?? 0) + (d.started > 0 ? 1 : 0))
  const going = new Set(st.actionsRunning.map((r) => r.id))
  const refLabel = new Map(referenceMaps(b).map((r) => [r.id, r.label]))
  const run = st.deployed === null ? undefined : st.validations.find((v) => v.id === st.deployed)
  // The guide: what Phase 3 adds, and the kinds on the map that runs.
  const onMap = new Set(run?.map.tiles.map((x) => x.kind) ?? [])
  const guide = [
    ...Object.entries(mt.key?.guide ?? {}).map(([id, g]) => ({ id, best: g.best, wrong: g.wrong })),
    ...Object.entries(b.key.guide ?? {}).filter(([id]) => onMap.has(id)).map(([id, g]) => ({ id, best: g.best, wrong: g.wrong })),
  ]
  const closed = s.closedPhases.includes('maintaining')
  const rounds = closed ? Math.max(1, st.reports.length - 1) : roundsNow(s, pack)
  return {
    status: closed ? 'closed' : 'playing',
    moneyUnit: pack.game.phases.development.money_unit ?? null,
    money: st.money,
    developers: { total: b3.budget.developers, free: developersFreeIn3(pack, p) },
    legend: canvasLegend(b3),
    pools: b3.pools.map((x) => ({ id: x.id, label: x.public.label, max: x.max })),
    actions: b3.actions.map((a) => ({ id: a.id, title: a.public.title, group: a.group, state: going.has(a.id) ? 'running' as const : done.has(a.id) ? 'done' as const : 'open' as const, times: done.get(a.id) ?? 0 })),
    map: mapView(st.map),
    ready: { ok: reasons.length === 0, reasons: [...reasons] },
    validations: st.validations.map((v) => ({ id: v.id, atMs: v.atMs, accuracy: v.accuracy, map: mapView(v.map), origin: v.origin, label: v.reference !== null ? refLabel.get(v.reference) ?? null : null })),
    deployed: st.deployed,
    reads: serviceReads(st, b3),
    round: { index: Math.max(1, Math.min(rounds, st.reports.length)), of: rounds },
    reports: st.reports.map((r) => {
      const worst = r.worstPart === null ? undefined : r.components[r.worstPart]
      return {
        period: r.period, short: periodName(mt, r.period).short, map: r.map,
        validity: r.validity, test: r.test, reliability: r.reliability, interruptions: r.interruptions,
        value: r.value, off: r.off, runCost: r.runCost, fine: r.fine, score: r.score,
        worstPart: worst ? partLabel(b3, worst) : null,
        events: r.events.filter((x) => x.hit).map((x) => ({ id: x.id, title: mt.events.find((e) => e.id === x.id)?.reveal?.title ?? x.id, validityLoss: x.validityLoss, reliabilityLoss: x.reliabilityLoss })),
      }
    }),
    spent: spentView(st),
    score: scoreSoFar(pack, p),
    key: {
      references: referenceViews(b, b3).map((r) => ({ id: r.id, label: r.label, map: r.map, accuracy: r.accuracy })),
      guide,
    },
    glimpse: glimpse(f, st, held),
    ...serviceHints(pack, p, st, b3),
  }
}
