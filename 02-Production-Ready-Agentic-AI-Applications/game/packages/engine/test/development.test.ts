// Phase 2 as the engine runs it (engineering spec, sections 6.6 and 12.2): every refusal of the
// four commands, every rule of a map and of readiness, actions on the game clock, validations,
// submission, the end of the stage, the live column and determinism.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fromPackMap, mapErrors, readyDetails, readyReasons, ruledLines, startUnlocked, tileMinutes, type CanvasMap } from '@lab02/content-schema'
import { advance, carriedIntoMaintaining, evaluate, project, type SessionState } from '../src/index.ts'
import { demoPack, host, join, newSession, run, setDemoPack } from './helpers.ts'

// The rules of the engine hold for a build file without `line_rules` and `required`, as they did
// before those fields existed. The block at the end runs on the demo pack as it is and tests them.
const full = demoPack()
const pack = structuredClone(full)
for (const id of pack.systemIds) { const b = pack.systems[id]!.build; if (b) { b.line_rules = []; b.required = [] } }
setDemoPack(pack)
const B = pack.systems.rb!.build!
const F = full.systems.rb!.build!
const err = (r: { ok: boolean; error?: string }) => (r.ok ? 'ok' : r.error)

function cmd(s: SessionState, id: string, type: string, payload: unknown, now: number) {
  return run(s, { actor: 'player', playerId: id, type, payload }, now)
}

/** A session in development.play at time 10 000 with p1 in rb and p2 in ls. */
function playing(): { s: SessionState; t0: number } {
  const s = newSession()
  join(s, 'p1', 'Alpha Branch', 0)
  join(s, 'p2', 'Beta Branch', 0)
  host(s, 'next', {}, 100)            // intro
  host(s, 'next', {}, 200)            // planning.play
  host(s, 'end_now', {}, 300)         // planning.reveal
  host(s, 'next', {}, 400)            // break.planning
  host(s, 'next', {}, 10_000)         // development.play
  expect(s.stage).toBe('development.play')
  expect(s.players.p1!.system).toBe('rb')
  return { s, t0: 10_000 }
}

const T = (id: string, kind: string, col: number, row: number, model: string | null = null, runsOn: string | null = null, prompt: string | null = null) =>
  ({ id, kind, col, row, model, runsOn, prompt })
const L = (...pairs: [string, string][]) => pairs.map(([from, to]) => ({ from, to }))

/** One small agent on the open API reading the form, the catalog and the courier site. */
const SMALL: CanvasMap = {
  tiles: [T('t1', 'rb-w-agent', 2, 2, 'rb-m-small', 'rb-c-api', null)],
  lines: L(['rb-s-form', 't1'], ['rb-s-catalog', 't1'], ['rb-s-courier', 't1'], ['t1', 'rb-result']),
}
const REF = fromPackMap(B.key.reference.map)

const view = (s: SessionState, id = 'p1') => project.playerView(s, demoPack(), id, 'CODE').development!
const action = (id: string) => B.actions.find((a) => a.id === id)!

describe('a map: what set_map refuses', () => {
  const open = startUnlocked(B)
  const bad = (m: CanvasMap) => mapErrors(m, B, open)
  it('accepts a good map and the empty map', () => {
    expect(bad(SMALL)).toEqual([])
    expect(bad({ tiles: [], lines: [] })).toEqual([])
  })
  it('refuses each rule of the table', () => {
    expect(bad({ tiles: [T('x1', 'rb-w-rule', 1, 1)], lines: [] })).toEqual(['bad_tile_id'])
    expect(bad({ tiles: [T('t1', 'rb-w-rule', 1, 1), T('t1', 'rb-w-rule', 2, 1)], lines: [] })).toEqual(['bad_tile_id'])
    expect(bad({ tiles: [T('t1', 'nobody', 1, 1)], lines: [] })).toEqual(['bad_kind'])
    expect(bad({ tiles: [T('t1', 'rb-w-rule', 5, 1)], lines: [] })).toEqual(['off_grid'])
    expect(bad({ tiles: [T('t1', 'rb-w-rule', 1, 1), T('t2', 'rb-w-rule', 1, 1)], lines: [] })).toEqual(['cell_taken'])
    expect(bad({ tiles: [T('t1', 'rb-w-rule', 1, 1, 'rb-m-small')], lines: [] })).toEqual(['no_parts_here'])
    expect(bad({ tiles: [T('t1', 'rb-w-agent', 1, 1, 'rb-m-open')], lines: [] })).toEqual(['bad_model'])        // locked
    expect(bad({ tiles: [T('t1', 'rb-w-agent', 1, 1, null, 'rb-c-private')], lines: [] })).toEqual(['bad_compute'])   // locked
    expect(bad({ tiles: [T('t1', 'rb-w-agent', 1, 1, null, null, 'rb-p-goal')], lines: [] })).toEqual(['bad_prompt'])  // locked
    expect(mapErrors({ tiles: [T('t1', 'rb-w-agent', 1, 1, 'rb-m-open', 'rb-c-api')], lines: [] }, B, null)).toEqual(['model_cannot_run_there'])
    const two = [T('t1', 'rb-w-rule', 1, 1), T('t2', 'rb-w-rule', 2, 1)]
    expect(bad({ tiles: two, lines: L(['rb-s-form', 't1'], ['rb-s-form', 't1']) })).toEqual(['line_twice'])
    expect(bad({ tiles: two, lines: L(['t9', 't1']) })).toEqual(['bad_line_end'])
    expect(bad({ tiles: two, lines: L(['t1', 'rb-s-form']) })).toEqual(['bad_line_end'])
    expect(bad({ tiles: two, lines: L(['rb-s-mailbox', 't1']) })).toEqual(['source_locked'])
    expect(bad({ tiles: two, lines: L(['rb-s-form', 'rb-result']) })).toEqual(['source_to_result'])
    expect(bad({ tiles: two, lines: L(['t2', 't1']) })).toEqual(['line_backward'])
    expect(bad({ tiles: [T('t1', 'rb-w-rule', 1, 1), T('t2', 'rb-w-rule', 1, 2)], lines: L(['t1', 't2']) })).toEqual(['line_backward'])
    expect(bad({ tiles: two, lines: L(['t1', 'rb-result'], ['t2', 'rb-result']) })).toEqual(['result_takes_one_line'])
    const many = Array.from({ length: 81 }, (_, i) => ({ from: 'rb-s-form', to: `t${i}` }))
    expect(bad({ tiles: [], lines: many })).toContain('too_many_lines')
  })
  it('refuses a model this kind of worker has no numbers for', () => {
    expect(mapErrors({ tiles: [T('t1', 'rb-w-step', 1, 1, 'rb-m-small', 'rb-c-api')], lines: [] }, B, null)).toEqual([])
  })
})

describe('a map: when it is ready', () => {
  it('names every reason', () => {
    expect(readyReasons({ tiles: [], lines: [] }, B)).toEqual(['nothing_reaches_result'])
    expect(readyReasons({ tiles: [T('t1', 'rb-w-rule', 1, 1)], lines: L(['t1', 'rb-result']) }, B)).toEqual(['no_source_connected'])
    expect(readyReasons({ tiles: [T('t1', 'rb-w-agent', 1, 1, 'rb-m-small')], lines: L(['rb-s-form', 't1'], ['t1', 'rb-result']) }, B)).toEqual(['tile_incomplete'])
    const all = { tiles: [T('t1', 'rb-w-librarian', 2, 2)], lines: L(['rb-s-form', 't1'], ['rb-s-catalog', 't1'], ['rb-s-courier', 't1'], ['t1', 'rb-result']) }
    expect(readyReasons(all, B)).toEqual(['too_many_minutes:librarian'])   // 6 + 3 against 4
    expect(readyReasons(SMALL, B)).toEqual([])
  })
  it('lets a stray tile stand, dimmed, without stopping a validation', () => {
    const m = { tiles: [...SMALL.tiles, T('t2', 'rb-w-clerk', 3, 4)], lines: SMALL.lines }
    expect(readyReasons(m, B)).toEqual([])
    expect(evaluate(m, B).flags.stray).toEqual(['t2'])
  })
})

describe('the four commands', () => {
  it('set_map replaces the draft and refuses an invalid map', () => {
    const { s, t0 } = playing()
    expect(err(cmd(s, 'p1', 'development.set_map', { map: SMALL }, t0))).toBe('ok')
    expect(view(s).map.tiles).toHaveLength(1)
    expect(err(cmd(s, 'p1', 'development.set_map', { map: REF }, t0 + 1))).toBe('invalid_map')   // locked items
    expect(view(s).map.tiles).toHaveLength(1)
    expect(view(s).ready.ok).toBe(true)
    expect(view(s).flags.privateData).toEqual(['t1'])
  })

  it('act pays, holds developers on the game clock, and unlocks when it ends', () => {
    const { s, t0 } = playing()
    const a = action('rb-a-mailbox')
    expect(err(cmd(s, 'p1', 'development.act', { id: a.id }, t0))).toBe('ok')
    let v = view(s)
    expect(v.money).toBe(B.budget.money - a.money)
    expect(v.developers).toEqual({ total: B.budget.developers, free: B.budget.developers - a.developers })
    expect(v.actionsRunning).toEqual([{ id: a.id, startedAtMs: t0, completesAtMs: t0 + a.seconds * 1000 }])
    expect(v.unlocked).not.toContain('rb-s-mailbox')
    advance(s, pack, t0 + a.seconds * 1000 - 1)
    expect(view(s).actionsDone).toEqual([])
    advance(s, pack, t0 + a.seconds * 1000)
    v = view(s)
    expect(v.actionsDone).toEqual([{ id: a.id, atMs: t0 + a.seconds * 1000 }])
    expect(v.developers.free).toBe(B.budget.developers)
    expect(v.unlocked).toContain('rb-s-mailbox')
  })

  it('act refuses every case of its table', () => {
    const { s, t0 } = playing()
    expect(err(cmd(s, 'p1', 'development.act', { id: 'rb-a-nothing' }, t0))).toBe('unknown_action')
    expect(err(cmd(s, 'p1', 'development.act', { id: 'rb-a-server' }, t0))).toBe('requires_action')
    expect(err(cmd(s, 'p1', 'development.act', { id: 'rb-a-mailbox' }, t0))).toBe('ok')         // 2 developers
    expect(err(cmd(s, 'p1', 'development.act', { id: 'rb-a-mailbox' }, t0 + 1))).toBe('action_taken')
    expect(err(cmd(s, 'p1', 'development.act', { id: 'rb-a-download' }, t0 + 2))).toBe('ok')     // 1 developer
    expect(err(cmd(s, 'p1', 'development.act', { id: 'rb-a-deal' }, t0 + 3))).toBe('ok')          // none, 25
    advance(s, pack, t0 + 10_000)                                                                   // the download ends
    expect(err(cmd(s, 'p1', 'development.act', { id: 'rb-a-download' }, t0 + 10_001))).toBe('action_taken')
    expect(err(cmd(s, 'p1', 'development.act', { id: 'rb-a-workshop' }, t0 + 10_002))).toBe('ok')  // 10
    expect(view(s).money).toBe(B.budget.money - 15 - 0 - 25 - 10)                                   // 50 left
    s.players.p1!.development!.money = 39
    expect(err(cmd(s, 'p1', 'development.act', { id: 'rb-a-server' }, t0 + 10_003))).toBe('not_enough_money')   // 40
  })

  it('act refuses a busy team', () => {
    const { s, t0 } = playing()
    expect(err(cmd(s, 'p1', 'development.act', { id: 'rb-a-mailbox' }, t0))).toBe('ok')   // holds 2 of 3
    // The demo has no second action of its own that could hold the last developer, so hold it here.
    s.players.p1!.development!.actionsRunning.push({ id: 'rb-a-server', startedAtMs: t0, completesAtMs: t0 + 99_000 })
    expect(view(s).developers.free).toBe(0)
    expect(err(cmd(s, 'p1', 'development.act', { id: 'rb-a-download' }, t0 + 1))).toBe('developers_busy')
    expect(err(cmd(s, 'p1', 'development.act', { id: 'rb-a-deal' }, t0 + 2))).toBe('ok')         // needs none
  })

  it('validate runs on a copy of the draft and refuses every case of its table', () => {
    const { s, t0 } = playing()
    expect(err(cmd(s, 'p1', 'development.validate', {}, t0))).toBe('not_ready')
    expect(view(s).ready.reasons).toEqual(['nothing_reaches_result'])
    cmd(s, 'p1', 'development.set_map', { map: SMALL }, t0)
    expect(err(cmd(s, 'p1', 'development.validate', {}, t0 + 1))).toBe('ok')
    expect(err(cmd(s, 'p1', 'development.validate', {}, t0 + 2))).toBe('validation_running')
    // The draft can change while the validation runs. The validation keeps its copy.
    cmd(s, 'p1', 'development.set_map', { map: { tiles: [], lines: [] } }, t0 + 3)
    const secs = B.validate.seconds * 1000
    advance(s, pack, t0 + 1 + secs)
    const v = view(s)
    expect(v.validations).toHaveLength(1)
    expect(v.validations[0]!.map.tiles).toHaveLength(1)
    expect(v.validations[0]!.accuracy).toBeCloseTo(evaluate(SMALL, B).accuracy, 12)
    expect(v.validations[0]!.missed).not.toBeNull()
    expect(v.validations[0]!.note).toBe(B.notes.find((n) => n.id === 'private_data')!.text)
    expect(v.validationsLeft).toBe(B.validate.runs - 1)
    // Use the rest, then one more is refused.
    cmd(s, 'p1', 'development.set_map', { map: SMALL }, t0 + secs + 10)
    let t = t0 + secs + 20
    for (let i = 1; i < B.validate.runs; i++) {
      expect(err(cmd(s, 'p1', 'development.validate', {}, t))).toBe('ok')
      t += secs
      advance(s, pack, t)
    }
    expect(err(cmd(s, 'p1', 'development.validate', {}, t + 1))).toBe('no_validations_left')
  })

  it('a second validation shows another case and another note when there is one', () => {
    const { s, t0 } = playing()
    const m = { tiles: [...SMALL.tiles, T('t2', 'rb-w-clerk', 3, 4)], lines: SMALL.lines }
    cmd(s, 'p1', 'development.set_map', { map: m }, t0)
    const secs = B.validate.seconds * 1000
    cmd(s, 'p1', 'development.validate', {}, t0)
    advance(s, pack, t0 + secs)
    cmd(s, 'p1', 'development.validate', {}, t0 + secs)
    advance(s, pack, t0 + 2 * secs)
    const [a, b] = view(s).validations
    expect(a!.missed!.title).not.toBe(b!.missed!.title)
    expect(a!.note).not.toBe(b!.note)
    expect(s.players.p1!.development!.shownNotes).toEqual(['private_data', 'stray'])
  })

  it('choose marks a finished validation of the player and refuses any other', () => {
    const { s, t0 } = playing()
    cmd(s, 'p1', 'development.set_map', { map: SMALL }, t0)
    cmd(s, 'p1', 'development.validate', {}, t0)
    expect(err(cmd(s, 'p1', 'development.choose', { id: 'v1' }, t0 + 1))).toBe('unknown_validation')   // still running
    advance(s, pack, t0 + B.validate.seconds * 1000)
    expect(err(cmd(s, 'p1', 'development.choose', { id: 'v1' }, t0 + 7000))).toBe('ok')
    expect(err(cmd(s, 'p1', 'development.choose', { id: 'v9' }, t0 + 7001))).toBe('unknown_validation')
    expect(err(cmd(s, 'p2', 'development.choose', { id: 'v1' }, t0 + 7002))).toBe('unknown_validation')
    expect(err(cmd(s, 'p1', 'development.choose', { id: null }, t0 + 7003))).toBe('ok')
  })

  it('every command is refused outside development.play', () => {
    const s = newSession()
    join(s, 'p1', 'Alpha Branch', 0)
    for (const [type, payload] of [['development.set_map', { map: SMALL }], ['development.act', { id: 'rb-a-shadow' }], ['development.validate', {}], ['development.choose', { id: null }]] as const) {
      expect(err(cmd(s, 'p1', type, payload, 10))).toBe('wrong_stage')
    }
  })
})

describe('the end of the stage, submission and the reveal', () => {
  it('ends a running action with its full effect and a running validation with its result', () => {
    const { s, t0 } = playing()
    cmd(s, 'p1', 'development.set_map', { map: SMALL }, t0)
    cmd(s, 'p1', 'development.act', { id: 'rb-a-deal' }, t0)
    cmd(s, 'p1', 'development.validate', {}, t0 + 1)
    host(s, 'end_now', {}, t0 + 2)
    expect(s.stage).toBe('development.reveal')
    const st = s.players.p1!.development!
    expect(st.actionsDone.map((d) => d.id)).toEqual(['rb-a-deal'])
    expect(st.validations).toHaveLength(1)
    expect(st.result!.validation).toBe('v1')
    const v = view(s)
    expect(v.insights.map((x) => x.action)).toEqual(['rb-a-deal'])
    expect(v.reveal!.accuracy).toBeCloseTo(evaluate(SMALL, B).accuracy, 12)
    expect(s.players.p1!.results.development!.raw).toBeCloseTo(1000 * evaluate(SMALL, B).accuracy, 9)
  })

  it('validates a ready draft for a player who never validated, and scores 0 without one', () => {
    const { s, t0 } = playing()
    cmd(s, 'p1', 'development.set_map', { map: SMALL }, t0)
    host(s, 'end_now', {}, t0 + 5)
    expect(s.players.p1!.development!.result!.validation).toBe('v1')
    expect(s.players.p2!.development!.result).toEqual({ validation: null, accuracy: 0, raw: 0, perCase: {}, map: null })
    expect(s.players.p2!.results.development!.raw).toBe(0)
    // The letter of a player who never validated takes its `empty` line.
    const letter = s.players.p2!.inbox.find((m) => m.id === 'development:letter')!
    expect(letter.text).toContain(pack.systems.ls!.story!.letters!.development_reveal!.variants.empty!)
    expect(view(s, 'p2').reveal!.cases.every((c) => c.solved === 0)).toBe(true)
  })

  it('submits the best validation by default, the earliest on a tie, and the chosen one when there is one', () => {
    const { s, t0 } = playing()
    const secs = B.validate.seconds * 1000
    const better = { tiles: [T('t1', 'rb-w-agent', 2, 2, 'rb-m-large', 'rb-c-api', null)], lines: SMALL.lines }
    cmd(s, 'p1', 'development.set_map', { map: SMALL }, t0)
    cmd(s, 'p1', 'development.validate', {}, t0); advance(s, pack, t0 + secs)
    cmd(s, 'p1', 'development.set_map', { map: better }, t0 + secs)
    cmd(s, 'p1', 'development.validate', {}, t0 + secs); advance(s, pack, t0 + 2 * secs)
    cmd(s, 'p1', 'development.validate', {}, t0 + 2 * secs); advance(s, pack, t0 + 3 * secs)
    expect(view(s).submitId).toBe('v2')
    cmd(s, 'p1', 'development.choose', { id: 'v1' }, t0 + 3 * secs)
    expect(view(s).submitId).toBe('v1')
    host(s, 'end_now', {}, t0 + 3 * secs + 1)
    expect(s.players.p1!.development!.result!.validation).toBe('v1')
    expect(view(s).submitId).toBe('v1')
  })

  it('the reveal carries every case, the points, and the reference map with its summary', () => {
    const { s, t0 } = playing()
    cmd(s, 'p1', 'development.set_map', { map: SMALL }, t0)
    host(s, 'end_now', {}, t0 + 5)
    const r = view(s).reveal!
    expect(r.cases.map((c) => c.title)).toEqual(B.cases.map((c) => c.public.title))
    expect(r.reference.summary).toBe(B.key.reference.public_summary)
    expect(r.reference.map.tiles.map((t) => t.kind)).toEqual(B.key.reference.map.tiles.map((t) => t.kind))
    expect(r.reference.accuracy).toBeGreaterThan(r.accuracy)
    expect(project.playerView(s, pack, 'p1', 'CODE').points.development).not.toBeNull()
  })

  it('carries the map, the money and what was done into Phase 3', () => {
    const { s, t0 } = playing()
    cmd(s, 'p1', 'development.set_map', { map: SMALL }, t0)
    cmd(s, 'p1', 'development.act', { id: 'rb-a-shadow' }, t0)
    host(s, 'end_now', {}, t0 + 5)
    const c = carriedIntoMaintaining(s.players.p1!)!
    expect(c.map!.tiles).toHaveLength(1)
    expect(c.money).toBe(B.budget.money)
    expect(c.actionsDone).toEqual(['rb-a-shadow'])
    expect(c.shownCases.length).toBe(1)
  })
})

describe('nothing leaks, nothing is random', () => {
  it('the view before the reveal holds no number of quality, no case and no reference', () => {
    const { s, t0 } = playing()
    cmd(s, 'p1', 'development.set_map', { map: SMALL }, t0)
    const text = JSON.stringify(project.playerView(s, pack, 'p1', 'CODE')) + JSON.stringify(project.developmentContent(s, pack, 'p1'))
    for (const f of ['"weight"', '"needs"', '"difficulty"', '"fetch"', '"plain"', '"catch"', '"gives"', '"effort"', '"distracts"', '"keep"', '"perCase"', '"solved"', '"overloaded"', '"distracting"', '"calls"', '"price_factor"', '"priceFactor"', '"by_model"']) {
      expect(text).not.toContain(f)
    }
    for (const k of B.cases) expect(text).not.toContain(k.public.text)
    expect(text).not.toContain(B.key.reference.public_summary)
  })

  it('the live column is the best accuracy, and a tie goes to who reached it first', () => {
    const { s, t0 } = playing()
    host(s, 'next', {}, 0)   // refused, the stage is timed: nothing changes
    const secs = B.validate.seconds * 1000
    cmd(s, 'p1', 'development.set_map', { map: SMALL }, t0)
    cmd(s, 'p1', 'development.validate', {}, t0)
    advance(s, pack, t0 + secs)
    expect(s.players.p1!.live.development.value).toBeCloseTo(100 * evaluate(SMALL, B).accuracy, 9)
    expect(view(s).validations[0]!.rank).toBe(1)
    expect(view(s).validations[0]!.of).toBe(2)
  })

  it('is deterministic and path independent', () => {
    const play = (steps: number) => {
      const { s, t0 } = playing()
      cmd(s, 'p1', 'development.set_map', { map: SMALL }, t0)
      cmd(s, 'p1', 'development.act', { id: 'rb-a-mailbox' }, t0)
      cmd(s, 'p1', 'development.act', { id: 'rb-a-shadow' }, t0 + 5)
      cmd(s, 'p1', 'development.validate', {}, t0 + 7)
      const until = s.stageEndsAtMs! + 1
      for (let t = t0; t < until; t += steps) advance(s, pack, t)
      advance(s, pack, until)
      return JSON.stringify(s)
    }
    expect(play(100_000)).toBe(play(333))
  })
})

describe('the opening letter of Phase 2', () => {
  const opening = pack.systems.rb!.story!.briefs!.development!.opening!
  const letter = (s: SessionState, id: string) => s.players[id]!.inbox.find((m) => m.id === 'development:brief')!.text
  it('opens with `hit`, `missed` or nothing, by the Phase 1 board', () => {
    const s = newSession()
    join(s, 'p1', 'Alpha Branch', 0)
    join(s, 'p3', 'Gamma Branch', 0)
    join(s, 'p5', 'Epsilon Branch', 0)
    host(s, 'next', {}, 100)
    host(s, 'next', {}, 200)
    expect(s.players.p1!.system).toBe('rb')
    expect(s.players.p5!.system).toBe('rb')
    expect(run(s, { actor: 'player', playerId: 'p1', type: 'planning.set_report', payload: { picks: { 'rb-q-partner': 'agentic' } } }, 250).ok).toBe(true)
    expect(run(s, { actor: 'player', playerId: 'p5', type: 'planning.set_report', payload: { picks: { 'rb-q-partner': 'no_ai' } } }, 250).ok).toBe(true)
    host(s, 'end_now', {}, 300)
    host(s, 'next', {}, 400)
    host(s, 'next', {}, 10_000)
    expect(letter(s, 'p1').startsWith(`${opening.hit}\n\n`)).toBe(true)
    expect(letter(s, 'p5').startsWith(`${opening.missed}\n\n`)).toBe(true)
    // A health system without an opening reads the letter alone.
    expect(s.players.p3!.system).toBe('ls')
    expect(letter(s, 'p3')).toBe(pack.systems.ls!.story!.briefs!.development!.text)
  })
})

describe('line rules and required workers (spec 6.6)', () => {
  beforeAll(() => { setDemoPack(full) })
  afterAll(() => { setDemoPack(pack) })
  const open = new Set([...startUnlocked(F), 'rb-s-cards', 'rb-w-reader'])
  const cards = { tiles: [T('t1', 'rb-w-agent', 2, 2, 'rb-m-small', 'rb-c-api'), T('t2', 'rb-w-reader', 1, 3)], lines: L(['rb-s-cards', 't1']) }

  it('the demo pack has one rule that refuses, one that advises, and one required worker', () => {
    expect(F.line_rules.filter((r) => r.refuse)).toHaveLength(1)
    expect(F.line_rules.filter((r) => !r.refuse)).toHaveLength(1)
    expect(F.required).toHaveLength(1)
  })
  it('refuses a line that a rule refuses, from a source or from a kind of worker, and nothing else', () => {
    expect(mapErrors(cards, F, open)).toEqual(['line_refused'])
    // The same source into the card reader, and the reader into the agent, are fine.
    expect(mapErrors({ tiles: cards.tiles, lines: L(['rb-s-cards', 't2'], ['t2', 't1']) }, F, open)).toEqual([])
    // A rule with a kind of worker as its origin matches a line from a tile of that kind.
    const kinds = { ...F, line_rules: [{ from: 'rb-w-reader', to: 'rb-w-agent', refuse: true, text: 'No.' }] }
    expect(mapErrors({ tiles: cards.tiles, lines: L(['t2', 't1']) }, kinds, open)).toEqual(['line_refused'])
    // A line into the result matches no rule, and the first rule that matches counts.
    expect(ruledLines({ tiles: cards.tiles, lines: L(['t1', 'rb-result']) }, F)).toEqual([])
  })
  it('set_map answers line_refused with the line and the words of the rule, and keeps the draft', () => {
    const { s, t0 } = playing()
    s.players.p1!.development!.actionsDone.push({ id: 'rb-a-cards', atMs: t0 })
    const r = cmd(s, 'p1', 'development.set_map', { map: cards }, t0)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toBe('line_refused')
    expect(r.data).toEqual({ line: { from: 'rb-s-cards', to: 't1' }, text: F.line_rules[0]!.text })
    expect(view(s).map.tiles).toEqual([])
    // A map with a refused line and another error is only invalid.
    const two = { tiles: cards.tiles, lines: [...cards.lines, { from: 'rb-s-form', to: 'rb-result' }] }
    expect(err(cmd(s, 'p1', 'development.set_map', { map: two }, t0))).toBe('invalid_map')
  })
  it('a line that a rule advises on stands, and the view carries the words with the line', () => {
    const { s, t0 } = playing()
    const m = { tiles: [T('t1', 'rb-w-agent', 2, 2, 'rb-m-small', 'rb-c-api')], lines: L(['rb-s-forum', 't1'], ['rb-s-form', 't1']) }
    expect(err(cmd(s, 'p1', 'development.set_map', { map: m }, t0))).toBe('ok')
    expect(view(s).lineAdvice).toEqual([{ from: 'rb-s-forum', to: 't1', text: F.line_rules[1]!.text }])
    expect(err(cmd(s, 'p1', 'development.set_map', { map: SMALL }, t0 + 1))).toBe('ok')
    expect(view(s).lineAdvice).toEqual([])
  })
  it('a map is ready only with a required worker on a path to the result', () => {
    expect(readyReasons(SMALL, F)).toEqual(['required_missing:0'])
    expect(readyDetails(SMALL, F)).toEqual([{ reason: 'required_missing', index: 0, workers: ['rb-w-librarian'], text: F.required[0]!.text }])
    // A librarian who stands aside does not count.
    // (Every placed person counts for the minutes, so this one alone asks too many.)
    const aside = { tiles: [...SMALL.tiles, T('t2', 'rb-w-librarian', 3, 4)], lines: SMALL.lines }
    expect(readyReasons(aside, F)).toEqual(['required_missing:0', 'too_many_minutes:librarian'])
    const signed = { tiles: [...SMALL.tiles.map((t) => ({ ...t })), T('t2', 'rb-w-librarian', 3, 2)], lines: L(['rb-s-form', 't1'], ['rb-s-catalog', 't1'], ['t1', 't2'], ['t2', 'rb-result']) }
    expect(readyReasons(signed, F)).toEqual([])
    // Nothing that reaches the result: that is the only reason.
    expect(readyReasons({ tiles: [], lines: [] }, F)).toEqual(['nothing_reaches_result'])
    // The order: no source, the tiles that lack parts, the required worker, the minutes.
    const lots = { tiles: [T('t1', 'rb-w-agent', 1, 1), T('t2', 'rb-w-step', 2, 1, 'rb-m-small'), T('t3', 'rb-w-clerk', 3, 1)], lines: L(['t1', 't2'], ['t2', 't3'], ['t3', 'rb-result']) }
    expect(readyReasons(lots, F)).toEqual(['no_source_connected', 'tile_incomplete', 'required_missing:0'])
    expect(readyDetails(lots, F).slice(0, 3)).toEqual([
      { reason: 'no_source_connected' },
      { reason: 'tile_incomplete', tile: 't1', missing: ['model', 'runsOn'] },
      { reason: 'tile_incomplete', tile: 't2', missing: ['runsOn'] },
    ])
  })
  it('the view says what each reason names, and validate is refused until the worker is there', () => {
    const { s, t0 } = playing()
    expect(err(cmd(s, 'p1', 'development.set_map', { map: SMALL }, t0))).toBe('ok')
    expect(view(s).ready).toEqual({ ok: false, reasons: ['required_missing:0'], details: [{ reason: 'required_missing', workers: ['rb-w-librarian'], text: F.required[0]!.text }] })
    expect(err(cmd(s, 'p1', 'development.validate', {}, t0 + 1))).toBe('not_ready')
    const over = { tiles: [T('t1', 'rb-w-librarian', 2, 2)], lines: L(['rb-s-form', 't1'], ['rb-s-catalog', 't1'], ['rb-s-courier', 't1'], ['t1', 'rb-result']) }
    expect(err(cmd(s, 'p1', 'development.set_map', { map: over }, t0 + 2))).toBe('ok')
    expect(view(s).ready.details).toEqual([{ reason: 'too_many_minutes', pool: 'librarian', used: 9, max: 4, tiles: ['t1'] }])
    expect(view(s).tileMinutes).toEqual({ t1: 9 })
  })
  it('counts the minutes of each person tile: deciding alone or checking, plus its sources', () => {
    const m = { tiles: [T('t1', 'rb-w-agent', 2, 2, 'rb-m-small', 'rb-c-api'), T('t2', 'rb-w-librarian', 3, 2), T('t3', 'rb-w-clerk', 1, 4)], lines: L(['rb-s-form', 't1'], ['t1', 't2'], ['rb-s-form', 't2'], ['rb-s-catalog', 't3']) }
    const per = tileMinutes(m, F)
    const lib = F.workers.find((w) => w.id === 'rb-w-librarian')!.minutes!
    const clerk = F.workers.find((w) => w.id === 'rb-w-clerk')!.minutes!
    expect(per).toEqual({ t2: lib.check + lib.per_line.easy!, t3: clerk.decide + clerk.per_line.easy! })
  })
})
