// Phase 3: Maintaining (engineering spec, section 6.7). Phase 2 played on: the same board with
// what Phase 3 adds, over a year of periods. One validated map is deployed. A round is the time
// to act before the report of the next period, and a report is made from whatever is deployed
// and whatever action has finished when the round ends. The scoring of a period is in
// ../maintain.ts.
import {
  mapErrors, movedPlaces, phase3Build, readyReasons, referenceMaps, ruledLines, startUnlocked,
  type BuildFile, type CanvasMap, type MaintainFile, type Pack, type ReferenceEntry,
} from '@lab02/content-schema'
import type { ErrorCode } from '@lab02/protocol'
import { evaluate } from '../canvas.ts'
import { counts, live, period, touches, validation, type HeldAction } from '../maintain.ts'
import type {
  EngineEvent, FeedEntry, GameMs, MaintainingReport, MaintainingState, MaintainingValidation, PlayerState, SessionState,
} from '../state.ts'
import { fireDialogue } from '../story.ts'
import { EMPTY_MAP, copyMap, moveMaps } from './development.ts'
import type { PhaseModule } from './types.ts'

export function maintainOf(pack: Pack, p: PlayerState): MaintainFile {
  const m = pack.systems[p.system]?.maintain
  if (!m) throw new Error(`health system ${p.system} has no maintain.yaml`)
  return m
}

/** The build file of Phase 3 for this player's health system. */
export function build3Of(pack: Pack, p: PlayerState): BuildFile {
  const sp = pack.systems[p.system]
  if (!sp?.build) throw new Error(`health system ${p.system} has no build.yaml`)
  return phase3Build(sp.build, sp.maintain)
}

type Appears = NonNullable<MaintainFile['actions'][number]['appears']>

/**
 * Whether something of Phase 3 with `appears` is on this player's board: its round has opened,
 * the actions it requires are done, and an investigation has found the events it names.
 */
function appeared(st: MaintainingState, a: Appears | undefined): boolean {
  if (!a) return true
  if (a.round !== undefined && st.roundsOpened < a.round) return false
  if (a.requires?.some((id) => !st.actionsDone.some((d) => d.id === id))) return false
  if (a.found?.some((id) => !st.found.includes(id))) return false
  return true
}

/**
 * Every item that no action unlocks, plus what the actions done so far unlocked. A model of
 * Phase 3 that has not appeared yet is left out.
 */
export function unlockedIn3(pack: Pack, p: PlayerState): Set<string> {
  const b3 = build3Of(pack, p)
  const st = p.maintaining
  const out = startUnlocked(b3)
  for (const d of st?.actionsDone ?? []) for (const id of b3.actions.find((a) => a.id === d.id)?.unlocks ?? []) out.add(id)
  for (const from of movedPlaces(b3, (st?.actionsDone ?? []).map((d) => d.id)).keys()) out.delete(from)
  for (const mo of maintainOf(pack, p).models) if (!st || !appeared(st, mo.appears)) out.delete(mo.id)
  return out
}

/** The models of Phase 3 that are not on this player's shelf yet: nothing of them reaches the browser. */
export function unseenModels(pack: Pack, p: PlayerState): Set<string> {
  const st = p.maintaining
  return new Set(maintainOf(pack, p).models.filter((mo) => !st || !appeared(st, mo.appears)).map((mo) => mo.id))
}

/**
 * The actions on a player's list in Phase 3 (section 6.7, "What is on the board"): an action
 * that requires another, or that waits for a round or a finding, is not shown and cannot be
 * started until then. An action that was started stays.
 */
export function shownActionsIn3(pack: Pack, p: PlayerState): BuildFile['actions'] {
  const st = p.maintaining
  if (!st) return []
  const own = new Map(maintainOf(pack, p).actions.map((a) => [a.id, a]))
  const done = new Set(st.actionsDone.map((d) => d.id))
  const running = new Set(st.actionsRunning.map((r) => r.id))
  return build3Of(pack, p).actions.filter((a) => done.has(a.id) || running.has(a.id) || (a.requires.every((r) => done.has(r)) && appeared(st, own.get(a.id)?.appears)))
}

export function developersFreeIn3(pack: Pack, p: PlayerState): number {
  const b3 = build3Of(pack, p)
  const held = (p.maintaining?.actionsRunning ?? []).reduce((n, r) => n + (b3.actions.find((a) => a.id === r.id)?.developers ?? 0), 0)
  return b3.budget.developers - held
}

/** The actions a player holds, as the scoring reads them. */
export function heldActions(st: MaintainingState): HeldAction[] {
  return st.actionsDone.map((a) => ({ id: a.id, started: a.started, done: a.done }))
}

/** Everything paid so far that is not a running cost: the actions of both phases and what the reference maps needed. */
export function paidOf(st: MaintainingState): number {
  return st.paidPhase2 + st.paidActions + st.paidAdoption
}

/** The score of the year over the reports held, with the money paid up to now. */
export function scoreSoFar(pack: Pack, p: PlayerState): number {
  const st = p.maintaining
  return st ? live(maintainOf(pack, p), st.reports, paidOf(st)).score : 0
}

/** Whether the account pays a price. What costs nothing can always be had, also by an account below zero. */
export function affords(st: MaintainingState, price: number): boolean {
  return price <= 0 || price <= st.money + 1e-9
}

/** The validations of Phase 3 that count against its number of runs. */
export function runsUsed(st: MaintainingState): number {
  return st.validations.filter((v) => v.origin === 'phase3').length + (st.validating ? 1 : 0)
}

const roundMs = (pack: Pack) => pack.game.phases.maintaining.round_seconds * 1000

/**
 * The rounds of the year as its clock stands: one for every whole `round_seconds` between the
 * start of the stage and its end. Time that the facilitator adds makes more rounds, each closed
 * by a report, past the planned year. Outside the play stage: the planned number.
 */
export function roundsNow(s: SessionState, pack: Pack): number {
  if (s.stage !== 'maintaining.year' || s.stageEndsAtMs === null) return pack.game.phases.maintaining.rounds
  return Math.max(1, Math.floor((s.stageEndsAtMs - s.stageStartedMs) / roundMs(pack)))
}

/**
 * When round `r` ends: `r` rounds after the start of the stage. Null for the last round, which
 * takes what is left over and ends with the stage.
 */
export function roundEndMs(s: SessionState, pack: Pack, r: number): GameMs | null {
  if (s.stage !== 'maintaining.year' || s.stageEndsAtMs === null || r >= roundsNow(s, pack)) return null
  return s.stageStartedMs + r * roundMs(pack)
}

// ------------------------------------------------------------------------------------------
// Rounds and reports
// ------------------------------------------------------------------------------------------
/** A round starts for a player: its news lands in the inbox. Its grants came with the report before it. */
function openRound(pack: Pack, p: PlayerState, round: number, at: GameMs): EngineEvent[] {
  const st = p.maintaining!
  const mt = maintainOf(pack, p)
  const events: EngineEvent[] = []
  if (round <= st.roundsOpened) return events
  st.roundsOpened = round
  // A letter with `if_event` goes only to a practice on whose map in service that event acted
  // in the report just made, at the first round from its own on at which it did.
  const acted = new Set(st.reports.at(-1)?.events.map((x) => x.id) ?? [])
  for (const n of mt.news) {
    if (n.if_event === undefined ? n.round !== round : n.round > round || !acted.has(n.if_event)) continue
    const id = `news:${n.id}`
    if (p.inbox.some((m) => m.id === id)) continue
    p.inbox.push({ id, kind: n.kind, from: n.from, ...(n.title !== undefined ? { title: n.title } : {}), text: n.text, atMs: at })
    events.push({ kind: 'moment', playerId: p.id, atMs: at, ref: { type: 'news', id } })
  }
  return events
}

/**
 * The report of the next period, from what is deployed and what has finished at this moment.
 * The grants of the round it opens land in the account, and the bill of the period is taken
 * from it. The account may go below zero: nothing can then be bought until it is positive again.
 */
function makeReport(pack: Pack, p: PlayerState, at: GameMs): MaintainingReport {
  const st = p.maintaining!
  const mt = maintainOf(pack, p)
  const n = st.reports.length + 1
  const v = st.deployed === null ? undefined : st.validations.find((x) => x.id === st.deployed)
  const ranBefore = st.reports.at(-1)?.map ?? null
  const ps = period(build3Of(pack, p), mt, n, v ? v.map : null, heldActions(st), n >= 2 && (v?.id ?? null) !== ranBefore, st.shownCases, st.shownNotes)
  if (ps.missed && !st.shownCases.includes(ps.missed.case)) st.shownCases.push(ps.missed.case)
  if (ps.note && !st.shownNotes.includes(ps.note)) st.shownNotes.push(ps.note)
  const paid = paidOf(st)
  const sofar = live(mt, [...st.reports, ps], paid)
  const granted = mt.grants.reduce((sum, g) => sum + (g.round === n ? g.money : 0), 0)
  st.money += granted - ps.runCost - ps.fine
  const report: MaintainingReport = { ...ps, period: n, atMs: at, map: v?.id ?? null, paid, spent: sofar.spent, score: sofar.score, granted, account: st.money }
  st.reports.push(report)
  return report
}

/**
 * The alarm of an event, said at once when an action of the lens it asks for finishes while the
 * event acts on the map that ran in the last report. Each alarm is said once.
 */
function alarmsFor(pack: Pack, p: PlayerState, actionId: string, at: GameMs): EngineEvent[] {
  const st = p.maintaining!
  const mt = maintainOf(pack, p)
  const lenses = Object.entries(mt.lenses).filter(([, ids]) => ids?.includes(actionId)).map(([name]) => name)
  const last = st.reports.at(-1)
  const events: EngineEvent[] = []
  if (!lenses.length || !last || mt.alarm_from === undefined) return events
  for (const e of mt.events) {
    if (e.alarm === undefined || e.cause?.lens === undefined || !lenses.includes(e.cause.lens)) continue
    if (!last.events.some((x) => x.id === e.id && x.hit)) continue
    const id = `news:alarm:${e.id}`
    if (p.inbox.some((m) => m.id === id)) continue
    p.inbox.push({ id, kind: 'announcement', from: mt.alarm_from, text: e.alarm, atMs: at })
    events.push({ kind: 'moment', playerId: p.id, atMs: at, ref: { type: 'news', id } })
  }
  return events
}

/**
 * What a look action finds when it finishes (`finds` of the pack): the first event it names
 * that has shown in a report the player holds, is not repaired, and has a part of the map in
 * service to act on. Null when there is nothing to find, and before the event has shown.
 */
function findingOf(pack: Pack, p: PlayerState, actionId: string): string | null {
  const st = p.maintaining!
  const mt = maintainOf(pack, p)
  const finds = mt.actions.find((a) => a.id === actionId)?.finds
  const run = st.deployed === null ? undefined : st.validations.find((v) => v.id === st.deployed)
  if (!finds?.length || !run) return null
  const seen = st.reports.length
  const held = heldActions(st)
  const b3 = build3Of(pack, p)
  for (const f of finds) {
    const e = mt.events.find((x) => x.id === f.event)
    if (!e || e.from > seen || seen > (e.to ?? Infinity)) continue
    if (counts(held, e.repaired_by, seen + 1, e.from)) continue
    if (touches(e, run.map, b3)) return e.id
  }
  return null
}

// ------------------------------------------------------------------------------------------
// Timers
// ------------------------------------------------------------------------------------------
/** An action ends: its developers are free, its items are unlocked, its insight lands, and it counts from the next report. */
function finishAction(pack: Pack, p: PlayerState, r: { id: string; started: number }, at: GameMs): EngineEvent[] {
  const st = p.maintaining!
  st.actionsRunning = st.actionsRunning.filter((x) => x.id !== r.id)
  const found = findingOf(pack, p, r.id)
  st.actionsDone.push({ id: r.id, atMs: at, started: r.started, done: st.reports.length, ...(found !== null ? { found } : {}) })
  if (found !== null && !st.found.includes(found)) st.found.push(found)
  const a = build3Of(pack, p).actions.find((x) => x.id === r.id)
  if (a?.moves) moveMaps(build3Of(pack, p), st.actionsDone, st)
  const events: EngineEvent[] = []
  if (a?.insight || found !== null) events.push({ kind: 'moment', playerId: p.id, atMs: at, ref: { type: 'insight', action: r.id } })
  events.push(...alarmsFor(pack, p, r.id, at))
  events.push(...fireDialogue(pack, p, 'maintaining', `insight:${r.id}`, at))
  return events
}

/** Score the copy of the map and add it to the list. A new validation is a map that has not run yet. */
function finishValidation(pack: Pack, p: PlayerState, v: { id: string; map: CanvasMap }, at: GameMs): EngineEvent[] {
  const st = p.maintaining!
  const r = validation(build3Of(pack, p), maintainOf(pack, p), st.reports.length, v.map, heldActions(st), true, st.shownCases, st.shownNotes)
  st.validations.push({
    id: v.id, atMs: at, map: v.map, accuracy: r.accuracy, unhurried: r.unhurried, missed: r.missed, note: r.note, running: r.running,
    origin: 'phase3', reference: null, fresh: r.fresh, reliability: r.reliability,
  })
  st.validating = null
  if (r.missed && !st.shownCases.includes(r.missed.case)) st.shownCases.push(r.missed.case)
  if (r.note && !st.shownNotes.includes(r.note)) st.shownNotes.push(r.note)
  return [{ kind: 'moment', playerId: p.id, atMs: at, ref: { type: 'validated', id: v.id } }, ...fireDialogue(pack, p, 'maintaining', 'run_result', at)]
}

function nextValidationId(st: MaintainingState): string {
  return `m${runsUsed(st) + 1}`
}

const fail = (error: ErrorCode) => ({ ok: false as const, error })
const ok = (p: PlayerState, events: EngineEvent[] = []) => ({ ok: true as const, dirty: [p.id], events })

/**
 * A player who was not in Phase 2 (a late joiner, section 6.4) starts the year as somebody who
 * built the first reference map of the pack: that map is in the list and in service, what it
 * needs is unlocked, and the account holds what its builder would have left.
 */
function startFromReference(pack: Pack, p: PlayerState, now: GameMs): void {
  const st = p.maintaining!
  const b3 = build3Of(pack, p)
  const ref = referenceMaps(pack.systems[p.system]!.build!)[0]
  if (!ref) return
  for (const need of ref.needsActions) {
    st.actionsDone.push({ id: need, atMs: now, started: 0, done: 0 })
    st.paidPhase2 += b3.actions.find((a) => a.id === need)?.money ?? 0
  }
  st.money = Math.max(0, st.money - st.paidPhase2)
  const ev = evaluate(ref.map, b3)
  st.validations.push({
    id: 'r1', atMs: now, map: copyMap(ref.map), accuracy: ev.accuracy, unhurried: ev.unhurried, missed: null, note: null, running: ev.running,
    origin: 'reference', reference: ref.id, fresh: false, reliability: null,
  })
  st.adopted.push(ref.id)
  st.map = copyMap(ref.map)
  st.deployed = 'r1'
}

/**
 * What taking a reference map would buy for this player now: the actions it needs that are
 * neither done nor running, and their price. The account pays all of it, so a player whose
 * account holds less cannot take the map.
 */
export function referenceOffer(pack: Pack, p: PlayerState, ref: ReferenceEntry): { needs: { id: string; title: string; money: number }[]; price: number } {
  const st = p.maintaining!
  const b3 = build3Of(pack, p)
  const needs = ref.needsActions
    .filter((id) => !st.actionsDone.some((d) => d.id === id) && !st.actionsRunning.some((r) => r.id === id))
    .map((id) => { const a = b3.actions.find((x) => x.id === id); return { id, title: a?.public.title ?? id, money: a?.money ?? 0 } })
  return { needs, price: needs.reduce((sum, n) => sum + n.money, 0) }
}

export const maintaining: PhaseModule = {
  phase: 'maintaining',
  implemented: true,
  open(s, pack, p, now) {
    const b = pack.systems[p.system]?.build
    if (!b || !pack.systems[p.system]?.maintain) { p.maintaining = null; return }
    const dev = p.development?.result ? p.development : null
    // What a player carries from Phase 2: the map that was chosen runs, every validation stays in
    // the list, the money that is left and everything unlocked. A player without Phase 2 starts
    // with the budget of the build file and no map.
    const validations: MaintainingValidation[] = (dev?.validations ?? []).map((v) => ({
      id: v.id, atMs: v.atMs, map: copyMap(v.map), accuracy: v.accuracy, unhurried: v.unhurried, missed: v.missed, note: v.note, running: v.running,
      origin: 'phase2', reference: null, fresh: false, reliability: null,
    }))
    const paidPhase2 = (dev?.actionsDone ?? []).reduce((sum, d) => sum + (b.actions.find((a) => a.id === d.id)?.money ?? 0), 0)
    p.maintaining = {
      money: dev ? dev.money : b.budget.money,
      paidPhase2, paidActions: 0, paidAdoption: 0,
      actionsDone: (dev?.actionsDone ?? []).map((d) => ({ id: d.id, atMs: d.atMs, started: 0, done: 0 })),
      actionsRunning: [],
      map: dev ? copyMap(dev.map) : copyMap(EMPTY_MAP),
      validating: null, validations,
      shownCases: [], shownNotes: [],
      deployed: dev?.result?.validation ?? null,
      deployedAtMs: null,
      adopted: [], reports: [], roundsOpened: 0, found: [], result: null,
    }
    if (!p.development) startFromReference(pack, p, now)
    p.inbox = p.inbox.filter((m) => !m.id.startsWith('news:'))
    // Report 1 is made when the stage opens. A player who joins later holds, for every period
    // that ended before, the report of a practice with no map, and the grants and news so far.
    let due = 1
    for (let end = roundEndMs(s, pack, due); end !== null && end <= now; end = roundEndMs(s, pack, due)) due++
    for (let k = 1; k <= due; k++) {
      makeReport(pack, p, now)
      openRound(pack, p, k, now)
    }
  },
  close(_s, pack, p, now) {
    const st = p.maintaining
    if (!st) return 0
    // An action that runs ends at once with its full effect, and a validation with its result,
    // before the report that ends the round in progress. A stage that the facilitator ended
    // early reports every period that is left of the planned year from the same state.
    for (const r of [...st.actionsRunning].sort((x, y) => x.completesAtMs - y.completesAtMs)) finishAction(pack, p, r, now)
    if (st.validating) finishValidation(pack, p, st.validating, now)
    const mt = maintainOf(pack, p)
    makeReport(pack, p, now)
    while (st.reports.length < mt.periods.length) makeReport(pack, p, now)
    const y = live(mt, st.reports, paidOf(st))
    st.result = { raw: y.raw, score: y.score, mean: y.mean, spent: y.spent }
    p.submittedAtMs.maintaining = now
    return y.raw
  },
  liveValue(_s, pack, p) {
    if (!p.maintaining) return 0
    return Math.max(0, Math.round(10 * scoreSoFar(pack, p)) / 10)
  },
  nextDue(s, pack, p) {
    const st = p.maintaining
    if (!st || s.stage !== 'maintaining.year') return null
    let due: GameMs | null = st.validating?.completesAtMs ?? null
    for (const r of st.actionsRunning) if (due === null || r.completesAtMs < due) due = r.completesAtMs
    const end = roundEndMs(s, pack, st.reports.length)
    if (end !== null && (due === null || end < due)) due = end
    return due
  },
  fire(s, pack, p, at) {
    const st = p.maintaining!
    const events: EngineEvent[] = []
    // Actions first, in the order they end, then the validation, then the end of the round:
    // what finishes at the very moment the round ends still counts for its report.
    const due = st.actionsRunning.filter((r) => r.completesAtMs <= at).sort((x, y) => x.completesAtMs - y.completesAtMs)
    for (const r of due) events.push(...finishAction(pack, p, r, r.completesAtMs))
    if (st.validating && st.validating.completesAtMs <= at) events.push(...finishValidation(pack, p, st.validating, st.validating.completesAtMs))
    const end = roundEndMs(s, pack, st.reports.length)
    if (end !== null && end <= at) {
      const report = makeReport(pack, p, end)
      events.push({ kind: 'moment', playerId: p.id, atMs: end, ref: { type: 'report', period: report.period } })
      events.push(...openRound(pack, p, report.period, end))
      events.push(...fireDialogue(pack, p, 'maintaining', `month:${report.period}`, end))
    }
    return events
  },
  feed(_s, pack, p) {
    const st = p.maintaining
    if (!st) return []
    const title = (id: string) => build3Of(pack, p).actions.find((a) => a.id === id)?.public.title ?? null
    const out: FeedEntry[] = []
    for (const d of st.actionsDone) if (d.started > 0) out.push({ kind: 'finished', text: title(d.id), atMs: d.atMs })
    for (const r of st.actionsRunning) out.push({ kind: 'started', text: title(r.id), atMs: r.startedAtMs })
    for (const v of st.validations) if (v.origin === 'phase3') out.push({ kind: 'validated', text: null, atMs: v.atMs })
    if (st.deployedAtMs !== null) out.push({ kind: 'deployed', text: null, atMs: st.deployedAtMs })
    return out
  },
  letter(_s, pack, p) {
    if (!p.maintaining) return null
    // Only a letter with `if_event` is a practice's own: the others go to the whole room.
    const own = new Set(maintainOf(pack, p).news.filter((n) => n.if_event !== undefined).map((n) => `news:${n.id}`))
    const last = p.inbox.filter((m) => own.has(m.id) && m.title !== undefined).sort((a, b) => b.atMs - a.atMs)[0]
    return last ? { from: last.from, title: last.title!, atMs: last.atMs } : null
  },
  card(_s, pack, p) {
    const st = p.maintaining
    if (!st) return { now: [], facts: [], map: null }
    const b3 = build3Of(pack, p)
    const mt = maintainOf(pack, p)
    const now = st.actionsRunning.map((r) => b3.actions.find((a) => a.id === r.id)?.public.title ?? '').filter(Boolean)
    if (st.validating) now.push('A validation')
    const last = st.reports.at(-1)
    const run = st.deployed === null ? undefined : st.validations.find((v) => v.id === st.deployed)
    return {
      now,
      facts: [
        { label: 'Reports so far', value: `${st.reports.length} of ${Math.max(st.reports.length, mt.periods.length)}` },
        { label: 'Last period', value: last ? `${Math.round(100 * last.validity)}% right · ${Math.round(100 * last.reliability)}% of the time` : 'No report yet' },
        { label: 'Score of the year so far', value: `${Math.max(0, Math.round(10 * scoreSoFar(pack, p)) / 10)}` },
      ],
      map: run ? copyMap(run.map) : null,
    }
  },
  commands: {
    'maintaining.set_map'(s, pack, p, payload) {
      if (s.stage !== 'maintaining.year') return fail('wrong_stage')
      const st = p.maintaining
      if (!st) return fail('wrong_stage')
      const map = copyMap((payload as { map: CanvasMap }).map)
      const b3 = build3Of(pack, p)
      const errs = mapErrors(map, b3, unlockedIn3(pack, p))
      if (errs.length) {
        const refused = errs.length === 1 && errs[0] === 'line_refused' ? ruledLines(map, b3).find((x) => x.rule.refuse) : undefined
        if (refused) return { ok: false as const, error: 'line_refused' as const, data: { line: refused.line, text: refused.rule.text } }
        return fail('invalid_map')
      }
      st.map = map
      return ok(p)
    },
    'maintaining.act'(s, pack, p, payload, now) {
      if (s.stage !== 'maintaining.year') return fail('wrong_stage')
      const st = p.maintaining
      if (!st) return fail('wrong_stage')
      const id = (payload as { id: string }).id
      const a = build3Of(pack, p).actions.find((x) => x.id === id)
      // An action that waits for a round or a finding does not exist for the player until then.
      if (!a || !appeared(st, maintainOf(pack, p).actions.find((x) => x.id === id)?.appears)) return fail('unknown_action')
      // An action that may be done again is refused only while it runs.
      const again = !!maintainOf(pack, p).actions.find((x) => x.id === id)?.repeat
      if (st.actionsRunning.some((r) => r.id === id) || (!again && st.actionsDone.some((d) => d.id === id))) return fail('action_taken')
      if (a.requires.some((r) => !st.actionsDone.some((d) => d.id === r))) return fail('requires_action')
      if (!affords(st, a.money)) return fail('not_enough_money')
      if (a.developers > developersFreeIn3(pack, p)) return fail('developers_busy')
      st.money -= a.money
      st.paidActions += a.money
      st.actionsRunning.push({ id, startedAtMs: now, completesAtMs: now + a.seconds * 1000, started: st.reports.length })
      return ok(p)
    },
    'maintaining.validate'(s, pack, p, _payload, now) {
      if (s.stage !== 'maintaining.year') return fail('wrong_stage')
      const st = p.maintaining
      if (!st) return fail('wrong_stage')
      const b3 = build3Of(pack, p)
      const mt = maintainOf(pack, p)
      if (st.validating) return fail('validation_running')
      if (runsUsed(st) >= mt.validate.runs) return fail('no_validations_left')
      if (mapErrors(st.map, b3, unlockedIn3(pack, p)).length || readyReasons(st.map, b3).length) return fail('not_ready')
      st.validating = { id: nextValidationId(st), startedAtMs: now, completesAtMs: now + mt.validate.seconds * 1000, map: copyMap(st.map) }
      return ok(p)
    },
    'maintaining.adopt'(s, pack, p, payload, now) {
      if (s.stage !== 'maintaining.year') return fail('wrong_stage')
      const st = p.maintaining
      if (!st) return fail('wrong_stage')
      const id = (payload as { id: string }).id
      const b3 = build3Of(pack, p)
      const refs = referenceMaps(pack.systems[p.system]!.build!)
      const index = refs.findIndex((r) => r.id === id)
      const ref = refs[index]
      if (!ref) return fail('unknown_id')
      if (st.adopted.includes(id)) return fail('action_taken')
      // What the map needs is bought at once, without a wait, as if the player had bought it,
      // from the account. A player who cannot pay for all of it does not get the map.
      const seen = st.reports.length
      const offer = referenceOffer(pack, p, ref)
      if (!affords(st, offer.price)) return fail('not_enough_money')
      for (const need of offer.needs) st.actionsDone.push({ id: need.id, atMs: now, started: seen, done: seen })
      moveMaps(b3, st.actionsDone, st)
      st.money -= offer.price
      st.paidAdoption += offer.price
      const ev = evaluate(ref.map, b3)
      const vid = `r${index + 1}`
      st.validations.push({
        id: vid, atMs: now, map: copyMap(ref.map), accuracy: ev.accuracy, unhurried: ev.unhurried, missed: null, note: null, running: ev.running,
        origin: 'reference', reference: ref.id, fresh: false, reliability: null,
      })
      st.adopted.push(id)
      // A player with an empty canvas gets the map they took on it, ready to change.
      if (!st.map.tiles.length) st.map = copyMap(ref.map)
      st.deployed = vid
      st.deployedAtMs = now
      return ok(p)
    },
    'maintaining.deploy'(s, _pack, p, payload, now) {
      if (s.stage !== 'maintaining.year') return fail('wrong_stage')
      const st = p.maintaining
      if (!st) return fail('wrong_stage')
      const id = (payload as { id: string | null }).id
      if (id !== null && !st.validations.some((v) => v.id === id)) return fail('unknown_validation')
      if (st.deployed !== id) { st.deployed = id; st.deployedAtMs = now }
      return ok(p)
    },
  },
}
