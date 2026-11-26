// Phase 3 as the engine runs it (engineering spec, sections 6.7 and 12.2): what a player carries
// from Phase 2, the reports at the round boundaries, every refusal of the five commands, a
// reference map taken, repairs and lenses, a host who extends or ends the stage, a late player,
// the score of the year, and what a view may and may not say.
import { describe, expect, it } from 'vitest'
import { fromPackMap, phase3Build, referenceMaps, type CanvasMap } from '@lab02/content-schema'
import { advance, project, type SessionState } from '../src/index.ts'
import { live, period } from '../src/maintain.ts'
import { demoPack, host, join, newSession, run } from './helpers.ts'

const pack = demoPack()
const B = pack.systems.rb!.build!
const M = pack.systems.rb!.maintain!
const B3 = phase3Build(B, M)
const ROUND = pack.game.phases.maintaining.round_seconds * 1000
const ROUNDS = pack.game.phases.maintaining.rounds
const err = (r: { ok: boolean; error?: string }) => (r.ok ? 'ok' : r.error)
const cmd = (s: SessionState, id: string, type: string, payload: unknown, now: number) => run(s, { actor: 'player', playerId: id, type, payload }, now)
const T = (id: string, kind: string, col: number, row: number, model: string | null = null, runsOn: string | null = null, prompt: string | null = null) =>
  ({ id, kind, col, row, model, runsOn, prompt })
const L = (...pairs: [string, string][]) => pairs.map(([from, to]) => ({ from, to }))

/** One small agent on the open API, checked by a librarian: a first map that every player can build. */
const SMALL: CanvasMap = {
  tiles: [T('t1', 'rb-w-agent', 2, 2, 'rb-m-small', 'rb-c-api', null), T('t2', 'rb-w-librarian', 4, 2)],
  lines: L(['rb-s-form', 't1'], ['rb-s-catalog', 't1'], ['rb-s-courier', 't1'], ['t1', 't2'], ['t2', 'rb-result']),
}
/** The same map with the card reader, which the drift of the summer acts on. */
const CARDS: CanvasMap = {
  tiles: [...SMALL.tiles, T('t3', 'rb-w-reader', 1, 4)],
  lines: [...SMALL.lines, ...L(['rb-s-cards', 't3'], ['t3', 't1'])],
}

/**
 * A session at the start of maintaining.year. p1 (rb) validated SMALL in Phase 2 after one
 * action, p2 (ls) did nothing, p3 (rb) joined and built no map.
 */
function year(build: (s: SessionState, t: number) => void = () => {}): { s: SessionState; t0: number } {
  const s = newSession()
  join(s, 'p1', 'Alpha Branch', 0)
  join(s, 'p2', 'Beta Branch', 0)
  join(s, 'p3', 'Gamma Branch', 0)
  host(s, 'next', {}, 100)
  host(s, 'next', {}, 200)
  host(s, 'end_now', {}, 300)
  host(s, 'next', {}, 400)
  host(s, 'next', {}, 10_000)
  expect(s.stage).toBe('development.play')
  expect(err(cmd(s, 'p1', 'development.act', { id: 'rb-a-cards' }, 10_000))).toBe('ok')
  expect(err(cmd(s, 'p1', 'development.set_map', { map: SMALL }, 30_000))).toBe('ok')
  expect(err(cmd(s, 'p1', 'development.validate', {}, 30_000))).toBe('ok')
  build(s, 40_000)
  host(s, 'end_now', {}, 60_000)
  host(s, 'next', {}, 61_000)        // break.development
  host(s, 'next', {}, 100_000)       // maintaining.year
  expect(s.stage).toBe('maintaining.year')
  return { s, t0: 100_000 }
}
const st = (s: SessionState, id = 'p1') => s.players[id]!.maintaining!
const view = (s: SessionState, id = 'p1') => project.playerView(s, pack, id, 'CODE').maintaining!
const boundary = (t0: number, r: number) => t0 + r * ROUND

describe('the year opens', () => {
  it('with what the player carries from Phase 2 and the first report', () => {
    const { s, t0 } = year()
    const m = st(s)
    expect(m.validations.map((v) => [v.id, v.origin])).toEqual([['v1', 'phase2']])
    expect(m.deployed).toBe('v1')
    expect(m.actionsDone).toEqual([{ id: 'rb-a-cards', atMs: expect.any(Number) as number, started: 0, done: 0 }])
    expect(m.paidPhase2).toBe(10)
    // What was left of Phase 2 plus the grant of round 1.
    expect(m.money).toBe(B.budget.money - 10 + M.grants.find((g) => g.round === 1)!.money)
    expect(m.reports).toHaveLength(1)
    const want = period(B3, M, 1, SMALL, [{ id: 'rb-a-cards', started: 0, done: 0 }])
    expect(m.reports[0]).toMatchObject({ period: 1, map: 'v1', validity: want.validity, reliability: want.reliability, value: want.value, atMs: t0 })
    expect(m.reports[0]!.validity).not.toBeCloseTo(m.reports[0]!.test, 6)   // a real year is not the test set
    // The news of round 1 is in the inbox, beside the letter that opens the phase.
    const inbox = s.players.p1!.inbox.map((x) => x.id)
    expect(inbox).toContain('maintaining:brief')
    expect(inbox).toContain('news:rb-n-mail')
    expect(inbox).not.toContain('news:rb-n-upgrade')
  })
  it('a player with no map of Phase 2 runs no map, and one without Phase 2 starts with the budget', () => {
    const { s } = year()
    expect(st(s, 'p3').deployed).toBeNull()
    expect(st(s, 'p3').reports[0]).toMatchObject({ noMap: true, map: null, reliability: 1, runCost: 0 })
    expect(view(s, 'p3').reports[0]!.sentences.noMap).toBe(M.report.no_map)
    expect(st(s, 'p3').money).toBe(B.budget.money + 20)
  })
  it('the view carries the round, the reports and the content of the phase', () => {
    const { s, t0 } = year()
    const v = view(s)
    expect(v.round).toEqual({ index: 1, of: ROUNDS, endsAtMs: boundary(t0, 1) })
    expect(v.seen).toBe(1)
    expect(v.reports[0]).toMatchObject({ period: 1, label: 'January and February', short: 'Jan-Feb', of: 3 })
    expect(v.validations[0]).toMatchObject({ id: 'v1', origin: 'phase2', fresh: false, reliability: null, label: null })
    expect(v.validationsLeft).toBe(M.validate.runs)
    const c = project.maintainingContent(s, pack, 'p1')
    expect(c.year.periods).toHaveLength(ROUNDS + 1)
    expect(c.workers.map((w) => w.id)).toContain('rb-w-gateway')
    expect(c.actions.find((a) => a.id === 'rb-a-retrain')).toMatchObject({ repeat: true, group: 'maintain' })
    expect(c.actions.find((a) => a.id === 'rb-a-monitor')!.upkeep).toBe(0.5)
    expect(c.rules.actionGroups.map((g) => g.id)).toEqual(['learn', 'build', 'buy', 'negotiate', 'watch', 'maintain'])
    expect(c.references.map((r) => r.id)).toEqual(['lean', 'clerk', 'pair'])
    expect(c.rules.validations).toBe(M.validate.runs)
  })
})

describe('rounds and reports', () => {
  it('a report arrives when each round ends, and the last one with the stage', () => {
    const { s, t0 } = year()
    advance(s, pack, boundary(t0, 1) - 1)
    expect(st(s).reports).toHaveLength(1)
    const out = advance(s, pack, boundary(t0, 1))
    expect(st(s).reports).toHaveLength(2)
    expect(out.events).toContainEqual({ kind: 'moment', playerId: 'p1', atMs: boundary(t0, 1), ref: { type: 'report', period: 2 } })
    expect(out.events).toContainEqual({ kind: 'moment', playerId: 'p1', atMs: boundary(t0, 1), ref: { type: 'news', id: 'news:rb-n-upgrade' } })
    expect(view(s).round).toEqual({ index: 2, of: ROUNDS, endsAtMs: boundary(t0, 2) })
    advance(s, pack, boundary(t0, 4))
    expect(st(s).reports).toHaveLength(5)
    expect(s.stage).toBe('maintaining.year')
    expect(view(s).round).toEqual({ index: 5, of: ROUNDS, endsAtMs: boundary(t0, 5) })
    advance(s, pack, boundary(t0, 5))
    expect(s.stage).toBe('maintaining.reveal')
    expect(st(s).reports).toHaveLength(6)
    expect(st(s).result).not.toBeNull()
  })
  it('a grant lands at the start of its round', () => {
    const { s, t0 } = year()
    const before = st(s).money
    advance(s, pack, boundary(t0, 1))
    expect(st(s).money).toBe(before)
    advance(s, pack, boundary(t0, 2))
    expect(st(s).money).toBe(before + M.grants.find((g) => g.round === 3)!.money)
  })
  it('an extension lengthens the round in progress and moves the later ones, and never a past one', () => {
    const { s, t0 } = year()
    advance(s, pack, boundary(t0, 1))
    expect(host(s, 'extend', { seconds: 30 }, boundary(t0, 1) + 5000).ok).toBe(true)
    advance(s, pack, boundary(t0, 2) + 29_999)
    expect(st(s).reports).toHaveLength(2)
    advance(s, pack, boundary(t0, 2) + 30_000)
    expect(st(s).reports).toHaveLength(3)
    expect(st(s).reports[1]!.atMs).toBe(boundary(t0, 1))
    advance(s, pack, boundary(t0, 5) + 30_000)
    expect(s.stage).toBe('maintaining.reveal')
  })
  it('a host who ends the stage early gets every report that is left, from the same state', () => {
    const { s, t0 } = year()
    advance(s, pack, boundary(t0, 1))
    host(s, 'end_now', {}, boundary(t0, 1) + 1000)
    expect(s.stage).toBe('maintaining.reveal')
    expect(st(s).reports.map((r) => r.period)).toEqual([1, 2, 3, 4, 5, 6])
    expect(s.players.p1!.results.maintaining!.raw).toBeCloseTo(st(s).result!.raw, 9)
  })
  it('is path independent: one late advance equals many small ones', () => {
    const a = year(), b = year()
    for (const x of [a, b]) {
      cmd(x.s, 'p1', 'maintaining.act', { id: 'rb-a-trace' }, x.t0 + 1000)
      cmd(x.s, 'p1', 'maintaining.adopt', { id: 'lean' }, x.t0 + ROUND + 500)
    }
    const until = boundary(a.t0, 5) + 5000
    advance(a.s, pack, until)
    for (let t = a.t0; t <= until; t += 777) advance(b.s, pack, t)
    advance(b.s, pack, until)
    expect(JSON.stringify(a.s)).toBe(JSON.stringify(b.s))
  })
  it('what finishes at the very moment a round ends counts for its report', () => {
    const { s, t0 } = year()
    const secs = M.actions.find((a) => a.id === 'rb-a-harden')!.seconds * 1000
    expect(err(cmd(s, 'p1', 'maintaining.act', { id: 'rb-a-harden' }, boundary(t0, 1) - secs))).toBe('ok')
    advance(s, pack, boundary(t0, 1))
    expect(st(s).actionsDone.at(-1)).toMatchObject({ id: 'rb-a-harden', started: 1, done: 1 })
    const agent = st(s).reports[1]!.components.find((c) => c.part === 'worker' && c.id === 'rb-w-agent' && c.event === null)!
    expect(agent.risk).toBeCloseTo(M.reliability.workers['rb-w-agent']! * 0.5, 12)
  })
})

describe('the five commands', () => {
  it('set_map works on the board of Phase 3 and refuses an invalid map', () => {
    const { s, t0 } = year()
    expect(err(cmd(s, 'p1', 'maintaining.set_map', { map: CARDS }, t0 + 1))).toBe('ok')
    expect(err(cmd(s, 'p1', 'maintaining.set_map', { map: { tiles: [T('t1', 'nobody', 1, 1)], lines: [] } }, t0 + 2))).toBe('invalid_map')
    // A tool of Phase 3 is locked until its action is done.
    const gate = { tiles: [...SMALL.tiles, T('t3', 'rb-w-gateway', 1, 1)], lines: SMALL.lines }
    expect(err(cmd(s, 'p1', 'maintaining.set_map', { map: gate }, t0 + 3))).toBe('invalid_map')
    cmd(s, 'p1', 'maintaining.act', { id: 'rb-a-gateway' }, t0 + 4)
    advance(s, pack, t0 + 4 + 14_000)
    expect(err(cmd(s, 'p1', 'maintaining.set_map', { map: gate }, t0 + 20_000))).toBe('ok')
    // A line that a rule of Phase 3 refuses comes back with the rule's words.
    const bad = { tiles: gate.tiles, lines: [...gate.lines, { from: 'rb-s-cards', to: 't3' }] }
    const r = cmd(s, 'p1', 'maintaining.set_map', { map: bad }, t0 + 20_001)
    expect(r).toMatchObject({ ok: false, error: 'line_refused', data: { line: { from: 'rb-s-cards', to: 't3' }, text: M.line_rules[0]!.text } })
  })
  it('act: every refusal', () => {
    const { s, t0 } = year()
    expect(err(cmd(s, 'p1', 'maintaining.act', { id: 'nope' }, t0))).toBe('unknown_action')
    expect(err(cmd(s, 'p1', 'maintaining.act', { id: 'rb-a-cards' }, t0))).toBe('action_taken')        // done in Phase 2
    expect(err(cmd(s, 'p1', 'maintaining.act', { id: 'rb-a-workshop' }, t0))).toBe('ok')               // left over from Phase 2
    expect(err(cmd(s, 'p1', 'maintaining.act', { id: 'rb-a-workshop' }, t0 + 1))).toBe('action_taken') // running
    expect(err(cmd(s, 'p1', 'maintaining.act', { id: 'rb-a-monitor' }, t0 + 2))).toBe('ok')            // two developers
    expect(err(cmd(s, 'p1', 'maintaining.act', { id: 'rb-a-harden' }, t0 + 3))).toBe('developers_busy')
    st(s).money = 1
    expect(err(cmd(s, 'p1', 'maintaining.act', { id: 'rb-a-testset' }, t0 + 4))).toBe('not_enough_money')
    expect(err(cmd(s, 'p2', 'maintaining.act', { id: 'rb-a-trace' }, t0 + 5))).toBe('unknown_action')  // another health system
  })
  it('a repeat action may be done again after it finished, and is paid for each time', () => {
    const { s, t0 } = year()
    const a = M.actions.find((x) => x.id === 'rb-a-retrain')!
    expect(err(cmd(s, 'p1', 'maintaining.act', { id: a.id }, t0))).toBe('ok')
    expect(err(cmd(s, 'p1', 'maintaining.act', { id: a.id }, t0 + 1))).toBe('action_taken')
    advance(s, pack, t0 + a.seconds * 1000)
    expect(err(cmd(s, 'p1', 'maintaining.act', { id: a.id }, t0 + a.seconds * 1000 + 1))).toBe('ok')
    expect(st(s).paidActions).toBe(2 * a.money)
    advance(s, pack, t0 + 2 * a.seconds * 1000 + 1)
    expect(view(s).actionsDone.filter((d) => d.id === a.id)).toHaveLength(2)
    expect(view(s).actionsDone.find((d) => d.id === 'rb-a-cards')!.phase).toBe('development')
  })
  it('validate: every refusal, a count of its own, and the test set unless a lens says more', () => {
    const { s, t0 } = year()
    expect(err(cmd(s, 'p3', 'maintaining.validate', {}, t0))).toBe('not_ready')
    expect(err(cmd(s, 'p1', 'maintaining.validate', {}, t0))).toBe('ok')
    expect(err(cmd(s, 'p1', 'maintaining.validate', {}, t0 + 1))).toBe('validation_running')
    advance(s, pack, t0 + M.validate.seconds * 1000)
    const v = st(s).validations.at(-1)!
    expect(v).toMatchObject({ id: 'm1', origin: 'phase3', fresh: false, reliability: null })
    expect(v.accuracy).toBeCloseTo(st(s).validations[0]!.accuracy, 12)      // the same map on the same test set
    let t = t0 + M.validate.seconds * 1000
    for (let i = 1; i < M.validate.runs; i++) { expect(err(cmd(s, 'p1', 'maintaining.validate', {}, t))).toBe('ok'); t += M.validate.seconds * 1000; advance(s, pack, t) }
    expect(err(cmd(s, 'p1', 'maintaining.validate', {}, t))).toBe('no_validations_left')
    expect(view(s).validationsLeft).toBe(0)
  })
  it('with the lenses a validation is the next report', () => {
    const { s, t0 } = year()
    cmd(s, 'p1', 'maintaining.act', { id: 'rb-a-testset' }, t0)
    cmd(s, 'p1', 'maintaining.act', { id: 'rb-a-staging' }, t0 + 1)
    advance(s, pack, t0 + 15_000)
    expect(view(s).lenses).toMatchObject({ freshTestSet: true, dryRun: true, incidentLog: false })
    cmd(s, 'p1', 'maintaining.validate', {}, t0 + 15_000)
    advance(s, pack, t0 + 15_000 + M.validate.seconds * 1000)
    const v = st(s).validations.at(-1)!
    cmd(s, 'p1', 'maintaining.deploy', { id: v.id }, t0 + 22_000)
    advance(s, pack, boundary(t0, 1))
    const r = st(s).reports[1]!
    expect(v.fresh).toBe(true)
    expect(v.accuracy).toBeCloseTo(r.validity, 12)
    expect(v.reliability).toBeCloseTo(r.reliability, 12)                    // staging also spares the new map its teething troubles
    expect(r.components.some((c) => c.part === 'new_map')).toBe(false)
  })
  it('adopt takes a reference map into the list, unlocks what it needs, counts the price and deploys it', () => {
    const { s, t0 } = year()
    expect(err(cmd(s, 'p1', 'maintaining.adopt', { id: 'nope' }, t0))).toBe('unknown_id')
    const money = st(s).money
    expect(err(cmd(s, 'p1', 'maintaining.adopt', { id: 'clerk' }, t0 + 1))).toBe('ok')
    expect(err(cmd(s, 'p1', 'maintaining.adopt', { id: 'clerk' }, t0 + 2))).toBe('action_taken')
    const m = st(s)
    const ref = referenceMaps(B).find((r) => r.id === 'clerk')!
    expect(m.validations.at(-1)).toMatchObject({ id: 'r2', origin: 'reference', reference: 'clerk' })
    expect(m.deployed).toBe('r2')
    expect(m.money).toBe(money)                                             // not taken from the account
    expect(m.paidAdoption).toBe(ref.needsActions.reduce((sum, id) => sum + B.actions.find((a) => a.id === id)!.money, 0))
    expect(m.actionsDone.filter((d) => ref.needsActions.includes(d.id)).every((d) => d.started === 1 && d.done === 1)).toBe(true)
    expect(view(s).unlocked).toEqual(expect.arrayContaining(['rb-s-mailbox', 'rb-c-private', 'rb-p-goal']))
    expect(view(s).validations.at(-1)).toMatchObject({ label: 'Map B', reference: 'clerk' })
    expect(view(s).validationsLeft).toBe(M.validate.runs)                   // it costs no validation
    expect(view(s).adopted).toEqual(['clerk'])
    // The new map runs in the next period, with the teething troubles of a new map.
    advance(s, pack, boundary(t0, 1))
    expect(m.reports[1]).toMatchObject({ map: 'r2' })
    expect(m.reports[1]!.components.some((c) => c.part === 'new_map')).toBe(true)
    // An action it needed that the player had done is not paid twice.
    expect(err(cmd(s, 'p1', 'maintaining.adopt', { id: 'lean' }, boundary(t0, 1) + 1))).toBe('ok')
    expect(m.paidAdoption).toBe(50)
  })
  it('a reference map taken with an empty canvas lands on the canvas too, and never replaces a draft', () => {
    const { s, t0 } = year()
    const ref = referenceMaps(B).find((r) => r.id === 'clerk')!
    const draft = st(s).map
    if (draft.tiles.length) {
      // The player brought a map: taking a reference map leaves their draft alone.
      expect(err(cmd(s, 'p1', 'maintaining.adopt', { id: 'clerk' }, t0 + 1))).toBe('ok')
      expect(st(s).map).toEqual(draft)
    }
    expect(err(cmd(s, 'p1', 'maintaining.set_map', { map: { tiles: [], lines: [] } }, t0 + 2))).toBe('ok')
    expect(err(cmd(s, 'p1', 'maintaining.adopt', { id: 'lean' }, t0 + 3))).toBe('ok')
    const lean = referenceMaps(B).find((r) => r.id === 'lean')!
    expect(st(s).map.tiles.map((t) => t.kind)).toEqual(lean.map.tiles.map((t) => t.kind))
    expect(st(s).map.lines.length).toBe(lean.map.lines.length)
    expect(ref.map.tiles.length).toBeGreaterThan(0)
  })
  it('deploy: any map of the list or no map, and nothing else', () => {
    const { s, t0 } = year()
    expect(err(cmd(s, 'p1', 'maintaining.deploy', { id: 'v9' }, t0))).toBe('unknown_validation')
    expect(err(cmd(s, 'p1', 'maintaining.deploy', { id: null }, t0 + 1))).toBe('ok')
    advance(s, pack, boundary(t0, 1))
    expect(st(s).reports[1]).toMatchObject({ noMap: true, map: null })
    expect(err(cmd(s, 'p1', 'maintaining.deploy', { id: 'v1' }, boundary(t0, 1) + 1))).toBe('ok')
    advance(s, pack, boundary(t0, 2))
    expect(st(s).reports[2]).toMatchObject({ noMap: false, map: 'v1' })
  })
  it('refuses every command outside the play stage', () => {
    const { s, t0 } = year()
    host(s, 'end_now', {}, t0 + 1000)
    for (const [type, payload] of [['maintaining.set_map', { map: SMALL }], ['maintaining.act', { id: 'rb-a-trace' }], ['maintaining.validate', {}], ['maintaining.adopt', { id: 'lean' }], ['maintaining.deploy', { id: null }]] as const) {
      expect(err(cmd(s, 'p1', type, payload, t0 + 2000))).toBe('wrong_stage')
    }
  })
})

describe('events, repairs and lenses', () => {
  /** p1 validated the map with the card reader in Phase 2. */
  const cards = () => year((s, t) => {
    cmd(s, 'p1', 'development.set_map', { map: CARDS }, t)
    cmd(s, 'p1', 'development.validate', {}, t)
    advance(s, pack, t + 10_000)
    cmd(s, 'p1', 'development.choose', { id: 'v2' }, t + 10_001)
  })
  it('a silent event shows as a symptom, and its cause only with the lens', () => {
    const { s, t0 } = cards()
    expect(st(s).deployed).toBe('v2')
    advance(s, pack, boundary(t0, 3))
    const r4 = view(s).reports[3]!
    const drift = M.events.find((e) => e.id === 'rb-e-handwriting')!
    expect(st(s).reports[3]!.events.find((x) => x.id === drift.id)).toMatchObject({ hit: true })
    expect(r4.worstChange).toEqual({ symptom: drift.symptom, cause: null })
    expect(JSON.stringify(view(s))).not.toContain(drift.cause!.text)
    expect(JSON.stringify(view(s))).not.toContain(drift.reveal!.text)
    expect(r4.parts).toBeNull()
    expect(r4.kinds).toBeNull()
  })
  it('a lens bought after the event began says so at once, and a repair started after the report ends it', () => {
    const { s, t0 } = cards()
    advance(s, pack, boundary(t0, 3))
    const drift = M.events.find((e) => e.id === 'rb-e-handwriting')!
    cmd(s, 'p1', 'maintaining.act', { id: 'rb-a-monitor' }, boundary(t0, 3) + 100)
    expect(err(cmd(s, 'p1', 'maintaining.act', { id: 'rb-a-retrain' }, boundary(t0, 3) + 100))).toBe('ok')
    const out = advance(s, pack, boundary(t0, 3) + 100 + 14_000)
    expect(s.players.p1!.inbox.at(-1)).toMatchObject({ id: `news:alarm:${drift.id}`, kind: 'announcement', from: M.alarm_from, text: drift.alarm })
    expect(out.events).toContainEqual({ kind: 'moment', playerId: 'p1', atMs: boundary(t0, 3) + 14_100, ref: { type: 'news', id: `news:alarm:${drift.id}` } })
    advance(s, pack, boundary(t0, 4))
    const r5 = st(s).reports[4]!
    expect(r5.events.some((x) => x.id === drift.id)).toBe(false)
    // Without the repair the same period would have gone worse.
    expect(r5.validity).toBeGreaterThan(period(B3, M, 5, CARDS, [{ id: 'rb-a-cards', started: 0, done: 0 }]).validity)
    // The upkeep of the monitoring counts in the running cost from the period after it finished.
    expect(r5.runCost - st(s).reports[3]!.runCost).toBeCloseTo(2 * M.actions.find((a) => a.id === 'rb-a-monitor')!.run!, 9)
  })
  it('a repair started before the break repairs nothing, and with the lens the report names the cause', () => {
    const { s, t0 } = cards()
    cmd(s, 'p1', 'maintaining.act', { id: 'rb-a-retrain' }, t0 + 10)
    cmd(s, 'p1', 'maintaining.act', { id: 'rb-a-monitor' }, t0 + 20)
    advance(s, pack, boundary(t0, 3))
    const drift = M.events.find((e) => e.id === 'rb-e-handwriting')!
    expect(st(s).reports[3]!.events.some((x) => x.id === drift.id && x.hit)).toBe(true)
    expect(view(s).reports[3]!.worstChange).toEqual({ symptom: drift.symptom, cause: drift.cause!.text })
    expect(s.players.p1!.inbox.some((m) => m.id.startsWith('news:alarm:'))).toBe(false)   // the report said it
  })
  it('with tracing and a tally a report lists every part and every kind of case', () => {
    const { s, t0 } = year()
    cmd(s, 'p1', 'maintaining.act', { id: 'rb-a-trace' }, t0)
    cmd(s, 'p1', 'maintaining.act', { id: 'rb-a-tally' }, t0 + 1)
    advance(s, pack, boundary(t0, 1))
    const [r1, r2] = view(s).reports
    expect(r1!.parts).toBeNull()                                            // the lens was not held for the first report
    expect(r2!.parts!.map((x) => x.label)).toContain('Agent')
    expect(r2!.parts![0]!.share).toBeGreaterThanOrEqual(r2!.parts![1]!.share)
    expect(r2!.kinds!.map((k) => k.title)).toEqual(B.cases.map((k) => k.public.title))
    expect(r2!.worstPart).toEqual({ label: 'Agent', text: M.incidents.workers['rb-w-agent'] })
  })
  it('the audit fines a map on a place that does not protect private data, for one period', () => {
    const { s, t0 } = year()
    advance(s, pack, boundary(t0, 5))
    const reports = st(s).reports
    expect(reports[4]).toMatchObject({ fine: 10 })
    expect(reports[4]!.reliability).toBeCloseTo(0.5 * reports[3]!.reliability / (reports[3]!.reliability / reports[4]!.reliability * 0.5), 9)
    expect(reports[4]!.components.at(-1)).toMatchObject({ part: 'event', id: 'rb-e-audit', risk: 0.5 })
    expect(reports[5]!.fine).toBe(0)
    expect(view(s).reports[4]!.worstPart).toEqual({ label: 'The whole system', text: M.events.find((e) => e.id === 'rb-e-audit')!.symptom })
  })
})

describe('the score of the year', () => {
  it('is the mean of the periods less everything spent, and the live column follows it', () => {
    const { s, t0 } = year()
    cmd(s, 'p1', 'maintaining.act', { id: 'rb-a-testset' }, t0)
    advance(s, pack, boundary(t0, 2))
    const m = st(s)
    const want = live(M, m.reports, m.paidPhase2 + m.paidActions + m.paidAdoption)
    expect(view(s).score).toBeCloseTo(want.score, 9)
    expect(view(s).spent).toMatchObject({ phase2: 10, actions: 4, adoption: 0, total: want.spent })
    expect(s.players.p1!.live.maintaining.value).toBeCloseTo(Math.round(10 * want.score) / 10, 9)
    advance(s, pack, boundary(t0, 5))
    const end = live(M, m.reports, m.paidPhase2 + m.paidActions + m.paidAdoption)
    expect(s.players.p1!.results.maintaining!.raw).toBeCloseTo(end.raw, 9)
    expect(m.reports.at(-1)!.score).toBeCloseTo(end.score, 9)
  })
  it('the reveal carries the parts of the score, every event, and the year of each reference map and of no map', () => {
    const { s, t0 } = year()
    advance(s, pack, boundary(t0, 5))
    const r = view(s).reveal!
    expect(r.values).toHaveLength(6)
    expect(r.mean - r.spent.total / r.costPerPoint).toBeCloseTo(r.score, 9)
    expect(r.events.map((e) => e.id)).toEqual(M.events.map((e) => e.id))
    expect(r.events.find((e) => e.id === 'rb-e-audit')).toMatchObject({ acted: true, periods: [5] })
    expect(r.events.find((e) => e.id === 'rb-e-handwriting')).toMatchObject({ acted: false, periods: [] })
    expect(r.references.map((x) => x.id)).toEqual(['lean', 'clerk', 'pair'])
    expect(r.references.every((x) => x.values.length === 6 && x.validity.length === 6)).toBe(true)
    expect(r.baseline.values).toEqual(st(s, 'p3').reports.map((x) => x.value))
    // The letter of the year: the empty variant for a player whose map never ran.
    expect(s.players.p3!.inbox.find((m) => m.id === 'maintaining:letter')!.text).toContain(pack.systems.rb!.story!.letters!.maintaining_reveal!.variants.empty!)
    expect(s.players.p1!.inbox.find((m) => m.id === 'maintaining:letter')!.text).not.toContain(pack.systems.rb!.story!.letters!.maintaining_reveal!.variants.empty!)
    // Before the reveal, no view names an event.
    const again = year()
    advance(again.s, pack, boundary(again.t0, 4))
    expect(view(again.s).reveal).toBeNull()
  })
  it('breaks a tie on the value of the last period', () => {
    const { s, t0 } = year()
    advance(s, pack, boundary(t0, 5))
    expect(s.board.order.maintaining[0]).toBeDefined()
    expect(s.board.values.maintaining.p1).toBe(s.players.p1!.results.maintaining!.points)
  })
})

describe('a late player', () => {
  it('holds the report of a practice with no map for every period that ended, and the grants and news so far', () => {
    const { s, t0 } = year()
    advance(s, pack, boundary(t0, 1) + 10)
    expect(join(s, 'late', 'Late Branch', boundary(t0, 1) + 10).ok).toBe(true)
    const m = st(s, 'late')
    expect(m.reports.map((r) => [r.period, r.noMap])).toEqual([[1, true], [2, true]])
    expect(m.money).toBe(pack.systems[s.players.late!.system]!.build!.budget.money + 20)
    expect(m.roundsOpened).toBe(2)
    advance(s, pack, boundary(t0, 2))
    expect(m.reports).toHaveLength(3)
    expect(join(s, 'later', 'Later Branch', boundary(t0, 2) + 10).ok).toBe(false)   // open_until round 2
  })
})

describe('the host and the projector', () => {
  it('the host sees the year beside the key, with a few lines on what holds the player back', () => {
    const { s, t0 } = year()
    advance(s, pack, boundary(t0, 5) - 10)
    const h = project.hostInspect(s, pack, 'p1', true)!.maintaining!
    expect(h.status).toBe('playing')
    expect(h.reports).toHaveLength(5)
    expect(h.reports[4]!.events.map((e) => e.id)).toContain('rb-e-audit')
    expect(h.glimpse.holds).toContain(M.events.find((e) => e.id === 'rb-e-audit')!.key!.coach!.holds)
    expect(h.glimpse.say).toContain(M.events.find((e) => e.id === 'rb-e-audit')!.key!.coach!.say)
    expect(h.key.references.map((r) => r.id)).toEqual(['lean', 'clerk', 'pair'])
    expect(h.key.guide.map((g) => g.id)).toEqual(expect.arrayContaining(['rb-w-gateway', 'rb-a-monitor', 'rb-w-agent']))
    expect(h.legend.workers.map((w) => w.id)).toContain('rb-w-gateway')
    const none = project.hostInspect(s, pack, 'p3', true)!.maintaining!
    expect(none.glimpse.holds[0]).toMatch(/No map/)
    // Nothing of the key is in the player's own view.
    expect(JSON.stringify(view(s))).not.toContain(M.events.find((e) => e.id === 'rb-e-audit')!.key!.coach!.holds)
  })
  it('the projector shows the room at work and a practice with the map that runs', () => {
    const { s, t0 } = year()
    cmd(s, 'p1', 'maintaining.act', { id: 'rb-a-trace' }, t0 + 5)
    cmd(s, 'p1', 'maintaining.deploy', { id: null }, t0 + 6)
    cmd(s, 'p1', 'maintaining.deploy', { id: 'v1' }, t0 + 7)
    advance(s, pack, t0 + 12_000)
    const sv = project.screenView(s, pack, 'http://x')
    expect(sv.activity).toMatchObject({ players: 3, acted: 1, insights: 1, sent: 1 })
    expect(sv.feed.map((f) => f.kind)).toEqual(expect.arrayContaining(['finished', 'deployed']))
    expect(sv.phaseBoard).toMatchObject({ phase: 'maintaining', state: 'live', label: pack.game.phases.maintaining.live_leaderboard.label })
    expect(sv.cards[0]).toMatchObject({ name: 'Alpha Branch' })
    expect(sv.cards[0]!.map).toEqual(project.mapView(SMALL))
    expect(sv.legends.find((l) => l.system === 'rb')!.legend.workers.map((w) => w.id)).toContain('rb-w-gateway')
  })
})

describe('the reference maps of the demo pack', () => {
  it('are ready on the board of Phase 3 and part ways over the year', () => {
    const ys = referenceMaps(B).map((r) => {
      const actions = r.needsActions.map((id) => ({ id, started: 0, done: 0 }))
      return [1, 2, 3, 4, 5, 6].map((p) => period(B3, M, p, r.map, actions).value)
    })
    expect(ys).toHaveLength(3)
    expect(new Set(ys.map((v) => v.reduce((a, b) => a + b, 0).toFixed(6))).size).toBe(3)
    expect(fromPackMap(M.baseline.map).tiles).toHaveLength(2)
  })
})
