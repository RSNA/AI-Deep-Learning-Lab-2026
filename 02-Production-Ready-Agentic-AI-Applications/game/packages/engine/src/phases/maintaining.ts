// Phase 3: Maintaining (engineering spec, section 6.7). Phase 2 played on: the same board with
// what Phase 3 adds, over a year of periods. One validated map is deployed. A round is the time
// to act before the report of the next period, and a report is made from whatever is deployed
// and whatever action has finished when the round ends. The scoring of a period is in
// ../maintain.ts.
import {
  mapErrors, phase3Build, readyReasons, referenceMaps, ruledLines, startUnlocked,
  type BuildFile, type CanvasMap, type MaintainFile, type Pack,
} from '@lab02/content-schema'
import type { ErrorCode } from '@lab02/protocol'
import { evaluate } from '../canvas.ts'
import { live, period, validation, type HeldAction } from '../maintain.ts'
import type {
  EngineEvent, FeedEntry, GameMs, MaintainingReport, MaintainingState, MaintainingValidation, PlayerState, SessionState,
} from '../state.ts'
import { fireDialogue } from '../story.ts'
import { EMPTY_MAP, copyMap } from './development.ts'
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

/** Every item that no action unlocks, plus what the actions done so far unlocked. */
export function unlockedIn3(pack: Pack, p: PlayerState): Set<string> {
  const b3 = build3Of(pack, p)
  const out = startUnlocked(b3)
  for (const d of p.maintaining?.actionsDone ?? []) for (const id of b3.actions.find((a) => a.id === d.id)?.unlocks ?? []) out.add(id)
  return out
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

/** The validations of Phase 3 that count against its number of runs. */
export function runsUsed(st: MaintainingState): number {
  return st.validations.filter((v) => v.origin === 'phase3').length + (st.validating ? 1 : 0)
}

const roundMs = (pack: Pack) => pack.game.phases.maintaining.round_seconds * 1000

/**
 * When round `r` ends: the end of the stage minus the rounds after it, so an extension by the
 * host lengthens the round in progress. Null for the last round, which ends with the stage.
 */
export function roundEndMs(s: SessionState, pack: Pack, r: number): GameMs | null {
  const rounds = pack.game.phases.maintaining.rounds
  if (s.stage !== 'maintaining.year' || s.stageEndsAtMs === null || r >= rounds) return null
  return s.stageEndsAtMs - (rounds - r) * roundMs(pack)
}

// ------------------------------------------------------------------------------------------
// Rounds and reports
// ------------------------------------------------------------------------------------------
/** A round starts for a player: its grants land in the account and its news in the inbox. */
function openRound(pack: Pack, p: PlayerState, round: number, at: GameMs): EngineEvent[] {
  const st = p.maintaining!
  const mt = maintainOf(pack, p)
  const events: EngineEvent[] = []
  if (round <= st.roundsOpened) return events
  st.roundsOpened = round
  for (const g of mt.grants) if (g.round === round) st.money += g.money
  for (const n of mt.news) {
    if (n.round !== round) continue
    const id = `news:${n.id}`
    if (p.inbox.some((m) => m.id === id)) continue
    p.inbox.push({ id, kind: n.kind, from: n.from, ...(n.title !== undefined ? { title: n.title } : {}), text: n.text, atMs: at })
    events.push({ kind: 'moment', playerId: p.id, atMs: at, ref: { type: 'news', id } })
  }
  return events
}

/** The report of the next period, from what is deployed and what has finished at this moment. */
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
  const report: MaintainingReport = { ...ps, period: n, atMs: at, map: v?.id ?? null, paid, spent: sofar.spent, score: sofar.score }
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
    if (e.alarm === undefined || !e.cause || !lenses.includes(e.cause.lens)) continue
    if (!last.events.some((x) => x.id === e.id && x.hit)) continue
    const id = `news:alarm:${e.id}`
    if (p.inbox.some((m) => m.id === id)) continue
    p.inbox.push({ id, kind: 'announcement', from: mt.alarm_from, text: e.alarm, atMs: at })
    events.push({ kind: 'moment', playerId: p.id, atMs: at, ref: { type: 'news', id } })
  }
  return events
}

// ------------------------------------------------------------------------------------------
// Timers
// ------------------------------------------------------------------------------------------
/** An action ends: its developers are free, its items are unlocked, its insight lands, and it counts from the next report. */
function finishAction(pack: Pack, p: PlayerState, r: { id: string; started: number }, at: GameMs): EngineEvent[] {
  const st = p.maintaining!
  st.actionsRunning = st.actionsRunning.filter((x) => x.id !== r.id)
  st.actionsDone.push({ id: r.id, atMs: at, started: r.started, done: st.reports.length })
  const a = build3Of(pack, p).actions.find((x) => x.id === r.id)
  const events: EngineEvent[] = []
  if (a?.insight) events.push({ kind: 'moment', playerId: p.id, atMs: at, ref: { type: 'insight', action: r.id } })
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
      adopted: [], reports: [], roundsOpened: 0, result: null,
    }
    p.inbox = p.inbox.filter((m) => !m.id.startsWith('news:'))
    // Report 1 is made when the stage opens. A player who joins later holds, for every period
    // that ended before, the report of a practice with no map, and the grants and news so far.
    const rounds = pack.game.phases.maintaining.rounds
    let due = 1
    for (let r = 1; r < rounds; r++) { const end = roundEndMs(s, pack, r); if (end !== null && end <= now) due++ }
    for (let k = 1; k <= due; k++) {
      makeReport(pack, p, now)
      openRound(pack, p, k, now)
    }
  },
  close(_s, pack, p, now) {
    const st = p.maintaining
    if (!st) return 0
    // An action that runs ends at once with its full effect, and a validation with its result,
    // before the last report is made. A stage that the host ended early reports every period
    // that is left from the same state.
    for (const r of [...st.actionsRunning].sort((x, y) => x.completesAtMs - y.completesAtMs)) finishAction(pack, p, r, now)
    if (st.validating) finishValidation(pack, p, st.validating, now)
    const mt = maintainOf(pack, p)
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
        { label: 'Reports so far', value: `${st.reports.length} of ${mt.periods.length}` },
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
      if (!a) return fail('unknown_action')
      // An action that may be done again is refused only while it runs.
      const again = !!maintainOf(pack, p).actions.find((x) => x.id === id)?.repeat
      if (st.actionsRunning.some((r) => r.id === id) || (!again && st.actionsDone.some((d) => d.id === id))) return fail('action_taken')
      if (a.requires.some((r) => !st.actionsDone.some((d) => d.id === r))) return fail('requires_action')
      if (a.money > st.money + 1e-9) return fail('not_enough_money')
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
      // The items the map needs are unlocked without a wait. Their price is not taken from the
      // account: it counts as money spent.
      const seen = st.reports.length
      for (const need of ref.needsActions) {
        if (st.actionsDone.some((d) => d.id === need) || st.actionsRunning.some((r) => r.id === need)) continue
        st.actionsDone.push({ id: need, atMs: now, started: seen, done: seen })
        st.paidAdoption += b3.actions.find((a) => a.id === need)?.money ?? 0
      }
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
