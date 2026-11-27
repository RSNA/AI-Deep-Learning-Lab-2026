// Phase 2: Development (engineering spec, section 6.6). The player builds a map on a grid, from
// the sources on the left to the result on the right, unlocks items through actions that cost
// money, developers and time, and validates the map. The accuracy of the submitted map is the
// whole score of the phase. The scoring itself is `evaluate` in ../canvas.ts.
import {
  copyLine, mapErrors, readyReasons, ruledLines, startUnlocked, type BuildFile, type CanvasMap, type Pack,
} from '@lab02/content-schema'
import type { ErrorCode } from '@lab02/protocol'
import { evaluate } from '../canvas.ts'
import { fireDialogue } from '../story.ts'
import type {
  DevelopmentResult, DevelopmentState, DevelopmentValidation, EngineEvent, FeedEntry, GameMs, PlayerState, SessionState,
} from '../state.ts'
import type { PhaseModule } from './types.ts'

export function buildOf(pack: Pack, p: PlayerState): BuildFile {
  const b = pack.systems[p.system]?.build
  if (!b) throw new Error(`health system ${p.system} has no build.yaml`)
  return b
}

/** Every item that no action unlocks, plus what the actions done so far unlocked. */
export function unlockedOf(pack: Pack, p: PlayerState): Set<string> {
  const b = buildOf(pack, p)
  const out = startUnlocked(b)
  for (const d of p.development?.actionsDone ?? []) for (const id of b.actions.find((a) => a.id === d.id)?.unlocks ?? []) out.add(id)
  return out
}

export function developersFree(pack: Pack, p: PlayerState): number {
  const b = buildOf(pack, p)
  const held = (p.development?.actionsRunning ?? []).reduce((n, r) => n + (b.actions.find((a) => a.id === r.id)?.developers ?? 0), 0)
  return b.budget.developers - held
}

/**
 * The actions on a player's list in Phase 2: an action that requires another is not shown, and
 * cannot be started, until that one is done (section 6.6, "What is on the board"). An action
 * that was started stays.
 */
export function shownActions(pack: Pack, p: PlayerState): BuildFile['actions'] {
  const st = p.development
  const done = new Set(st?.actionsDone.map((d) => d.id) ?? [])
  const running = new Set(st?.actionsRunning.map((r) => r.id) ?? [])
  return buildOf(pack, p).actions.filter((a) => done.has(a.id) || running.has(a.id) || a.requires.every((r) => done.has(r)))
}

/** A plain copy of a map, so that nothing of a command's payload is kept by reference. */
export function copyMap(m: CanvasMap): CanvasMap {
  return {
    tiles: m.tiles.map((t) => ({ id: t.id, kind: t.kind, col: t.col, row: t.row, model: t.model ?? null, runsOn: t.runsOn ?? null, prompt: t.prompt ?? null })),
    lines: m.lines.map(copyLine),
  }
}

export const EMPTY_MAP: CanvasMap = { tiles: [], lines: [] }

/** The best accuracy of a player's validations, the earliest on a tie. */
function best(st: DevelopmentState): DevelopmentValidation | null {
  let out: DevelopmentValidation | null = null
  for (const v of st.validations) if (!out || v.accuracy > out.accuracy) out = v
  return out
}

/** The validation that would be submitted now: the chosen one, or the best. */
export function submitted(st: DevelopmentState): DevelopmentValidation | null {
  return (st.chosen ? st.validations.find((v) => v.id === st.chosen) : undefined) ?? best(st)
}

export function liveOf(st: DevelopmentState | null): number {
  const b = st ? best(st) : null
  return b ? 100 * b.accuracy : 0
}

/** The rank of this player in the live column if their best accuracy were `value` from `since`. */
function liveRank(s: SessionState, p: PlayerState, value: number, since: GameMs): { rank: number; of: number } {
  const active = s.order.map((id) => s.players[id]!).filter((x) => !x.removed)
  let rank = 1
  for (const o of active) {
    if (o.id === p.id) continue
    const v = liveOf(o.development)
    const at = o.live.development.sinceMs
    if (v > value || (v === value && (at < since || (at === since && o.joinSeq < p.joinSeq)))) rank++
  }
  return { rank, of: active.length }
}

// ------------------------------------------------------------------------------------------
// Timers
// ------------------------------------------------------------------------------------------
/** An action ends: its developers are free, its items are unlocked and its insight lands. */
function finishAction(pack: Pack, p: PlayerState, id: string, at: GameMs): EngineEvent[] {
  const st = p.development!
  st.actionsRunning = st.actionsRunning.filter((r) => r.id !== id)
  st.actionsDone.push({ id, atMs: at })
  const a = buildOf(pack, p).actions.find((x) => x.id === id)
  const events: EngineEvent[] = []
  if (a?.insight) events.push({ kind: 'moment', playerId: p.id, atMs: at, ref: { type: 'insight', action: id } })
  events.push(...fireDialogue(pack, p, 'development', `insight:${id}`, at))
  return events
}

/** Score the copy of the map and store the result. The case and the note shown join the player's list. */
function finishValidation(s: SessionState, pack: Pack, p: PlayerState, v: { id: string; map: CanvasMap }, at: GameMs): EngineEvent[] {
  const st = p.development!
  const r = evaluate(v.map, buildOf(pack, p), st.shownCases, st.shownNotes)
  const before = liveOf(st)
  const value = Math.max(before, 100 * r.accuracy)
  const since = value > before ? at : p.live.development.sinceMs
  const { rank, of } = liveRank(s, p, value, since)
  st.validations.push({ id: v.id, atMs: at, map: v.map, accuracy: r.accuracy, unhurried: r.unhurried, missed: r.missed, note: r.note, running: r.running, rank, of })
  st.validating = null
  if (r.missed && !st.shownCases.includes(r.missed.case)) st.shownCases.push(r.missed.case)
  if (r.note && !st.shownNotes.includes(r.note)) st.shownNotes.push(r.note)
  const events: EngineEvent[] = [{ kind: 'moment', playerId: p.id, atMs: at, ref: { type: 'validated', id: v.id } }]
  events.push(...fireDialogue(pack, p, 'development', 'run_result', at))
  if (r.missed) events.push(...fireDialogue(pack, p, 'development', `trace:${r.missed.case}`, at))
  return events
}

function nextValidationId(st: DevelopmentState): string {
  return `v${st.validations.length + (st.validating ? 1 : 0) + 1}`
}

const fail = (error: ErrorCode) => ({ ok: false as const, error })
const ok = (p: PlayerState, events: EngineEvent[] = []) => ({ ok: true as const, dirty: [p.id], events })

export const development: PhaseModule = {
  phase: 'development',
  implemented: true,
  open(_s, pack, p) {
    const b = buildOf(pack, p)
    p.development = {
      money: b.budget.money, actionsDone: [], actionsRunning: [], map: copyMap(EMPTY_MAP),
      validating: null, validations: [], shownCases: [], shownNotes: [], chosen: null, result: null,
    }
  },
  close(s, pack, p, now) {
    const st = p.development
    if (!st) return 0
    // An action that runs ends at once with its full effect, because it was paid for. A
    // validation that runs ends at once with its result.
    for (const r of [...st.actionsRunning].sort((x, y) => x.completesAtMs - y.completesAtMs)) finishAction(pack, p, r.id, now)
    if (st.validating) finishValidation(s, pack, p, st.validating, now)
    // A player who never validated has a ready draft validated.
    const b = buildOf(pack, p)
    if (!st.validations.length && !mapErrors(st.map, b, unlockedOf(pack, p)).length && !readyReasons(st.map, b).length) {
      finishValidation(s, pack, p, { id: nextValidationId(st), map: copyMap(st.map) }, now)
    }
    const v = submitted(st)
    let result: DevelopmentResult
    if (v) {
      const r = evaluate(v.map, b)
      result = { validation: v.id, accuracy: v.accuracy, raw: 1000 * v.accuracy, perCase: r.perCase, map: copyMap(v.map) }
      st.chosen = v.id
      p.submittedAtMs.development = v.atMs
    } else {
      result = { validation: null, accuracy: 0, raw: 0, perCase: {}, map: null }
    }
    st.result = result
    return result.raw
  },
  liveValue(_s, _pack, p) {
    return liveOf(p.development)
  },
  nextDue(s, _pack, p) {
    const st = p.development
    if (!st || s.stage !== 'development.play') return null
    let due: GameMs | null = st.validating?.completesAtMs ?? null
    for (const r of st.actionsRunning) if (due === null || r.completesAtMs < due) due = r.completesAtMs
    return due
  },
  fire(s, pack, p, at) {
    const st = p.development!
    const events: EngineEvent[] = []
    // Actions first, in the order they end (and started), then the validation.
    const due = st.actionsRunning.filter((r) => r.completesAtMs <= at).sort((x, y) => x.completesAtMs - y.completesAtMs)
    for (const r of due) events.push(...finishAction(pack, p, r.id, r.completesAtMs))
    if (st.validating && st.validating.completesAtMs <= at) events.push(...finishValidation(s, pack, p, st.validating, st.validating.completesAtMs))
    return events
  },
  feed(_s, pack, p) {
    const st = p.development
    if (!st) return []
    const title = (id: string) => buildOf(pack, p).actions.find((a) => a.id === id)?.public.title ?? null
    const out: FeedEntry[] = []
    for (const d of st.actionsDone) out.push({ kind: 'finished', text: title(d.id), atMs: d.atMs })
    for (const r of st.actionsRunning) out.push({ kind: 'started', text: title(r.id), atMs: r.startedAtMs })
    for (const v of st.validations) out.push({ kind: 'validated', text: null, atMs: v.atMs })
    return out
  },
  card(_s, pack, p) {
    const st = p.development
    const b = buildOf(pack, p)
    const now = (st?.actionsRunning ?? []).map((r) => b.actions.find((a) => a.id === r.id)?.public.title ?? '').filter(Boolean)
    if (st?.validating) now.push('A validation')
    const top = st ? best(st) : null
    return {
      now,
      facts: [
        { label: 'Best accuracy', value: top ? `${Math.round(100 * top.accuracy)}%` : 'Not validated yet' },
        { label: 'Validations used', value: `${st?.validations.length ?? 0} of ${b.validate.runs}` },
        { label: 'Actions done', value: `${st?.actionsDone.length ?? 0} of ${b.actions.length}` },
      ],
      map: st ? copyMap(st.map) : null,
    }
  },
  commands: {
    'development.set_map'(s, pack, p, payload) {
      if (s.stage !== 'development.play') return fail('wrong_stage')
      const st = p.development
      if (!st) return fail('wrong_stage')
      const map = copyMap((payload as { map: CanvasMap }).map)
      const b = buildOf(pack, p)
      const errs = mapErrors(map, b, unlockedOf(pack, p))
      if (errs.length) {
        // A line that a rule of the pack refuses is named, with the rule's words (spec 6.6).
        const refused = errs.length === 1 && errs[0] === 'line_refused' ? ruledLines(map, b).find((x) => x.rule.refuse) : undefined
        if (refused) return { ok: false as const, error: 'line_refused' as const, data: { line: refused.line, text: refused.rule.text } }
        return fail('invalid_map')
      }
      st.map = map
      return ok(p)
    },
    'development.act'(s, pack, p, payload, now) {
      if (s.stage !== 'development.play') return fail('wrong_stage')
      const st = p.development
      if (!st) return fail('wrong_stage')
      const id = (payload as { id: string }).id
      const a = buildOf(pack, p).actions.find((x) => x.id === id)
      if (!a) return fail('unknown_action')
      if (st.actionsDone.some((d) => d.id === id) || st.actionsRunning.some((r) => r.id === id)) return fail('action_taken')
      if (a.requires.some((r) => !st.actionsDone.some((d) => d.id === r))) return fail('requires_action')
      if (a.money > st.money + 1e-9) return fail('not_enough_money')
      if (a.developers > developersFree(pack, p)) return fail('developers_busy')
      st.money -= a.money
      st.actionsRunning.push({ id, startedAtMs: now, completesAtMs: now + a.seconds * 1000 })
      return ok(p)
    },
    'development.validate'(s, pack, p, _payload, now) {
      if (s.stage !== 'development.play') return fail('wrong_stage')
      const st = p.development
      if (!st) return fail('wrong_stage')
      const b = buildOf(pack, p)
      if (st.validating) return fail('validation_running')
      if (st.validations.length >= b.validate.runs) return fail('no_validations_left')
      if (mapErrors(st.map, b, unlockedOf(pack, p)).length || readyReasons(st.map, b).length) return fail('not_ready')
      st.validating = { id: nextValidationId(st), startedAtMs: now, completesAtMs: now + b.validate.seconds * 1000, map: copyMap(st.map) }
      return ok(p)
    },
    'development.choose'(s, _pack, p, payload) {
      if (s.stage !== 'development.play') return fail('wrong_stage')
      const st = p.development
      if (!st) return fail('wrong_stage')
      const id = (payload as { id: string | null }).id
      if (id !== null && !st.validations.some((v) => v.id === id)) return fail('unknown_validation')
      st.chosen = id
      return ok(p)
    },
  },
}

/** What a player carries from Phase 2 into Phase 3 (section 6.6). Phase 3 reads it in its step. */
export function carriedIntoMaintaining(p: PlayerState): { map: CanvasMap | null; money: number; actionsDone: string[]; shownCases: string[]; shownNotes: string[] } | null {
  const st = p.development
  if (!st?.result) return null
  return {
    map: st.result.map ? copyMap(st.result.map) : null, money: st.money,
    actionsDone: st.actionsDone.map((d) => d.id), shownCases: [...st.shownCases], shownNotes: [...st.shownNotes],
  }
}
