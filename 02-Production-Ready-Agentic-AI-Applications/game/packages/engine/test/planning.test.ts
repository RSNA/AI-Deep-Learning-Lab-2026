// Phase 1 as the engine runs it (engineering spec, sections 6.4, 6.5, 6.9, 12.2).
import { describe, expect, it } from 'vitest'
import { advance, createSession, project, type SessionState } from '../src/index.ts'
import { lineAt } from '../src/phases/planning.ts'
import { demoPack, host, join, newSession, run } from './helpers.ts'

const pack = demoPack()
const rules = pack.game.phases.planning
const RB = pack.systems.rb!

function cmd(s: SessionState, id: string, type: string, payload: unknown, now: number) {
  return run(s, { actor: 'player', playerId: id, type, payload }, now)
}

/** A session in planning.play at time 1000 with one player in system rb. */
function playing(mode: 'test' | 'rehearsal' | 'event' = 'test'): { s: SessionState; t0: number } {
  const s = newSession(mode)
  join(s, 'p1', 'Alpha Branch', 0)
  host(s, 'next', {}, 500)            // intro
  host(s, 'next', {}, 1000)           // planning.play
  expect(s.stage).toBe('planning.play')
  expect(s.players.p1!.system).toBe('rb')
  return { s, t0: 1000 }
}

const inv = (id: string) => RB.insights!.find((x) => x.id === id)!
const interview = RB.insights!.find((x) => x.method === 'interview')!
const heavy = RB.insights!.find((x) => x.bandwidth === 3)!
const truth = Object.fromEntries(RB.problems!.map((p) => [p.id, p.key.class]))

describe('investigations', () => {
  it('holds bandwidth while running and frees it when the tile lands', () => {
    const { s, t0 } = playing()
    expect(cmd(s, 'p1', 'planning.investigate', { id: heavy.id }, t0).ok).toBe(true)
    const v1 = project.playerView(s, pack, 'p1', 'CODE')
    expect(v1.planning!.bandwidthFree).toBe(rules.investigations.bandwidth - heavy.bandwidth)
    const r = cmd(s, 'p1', 'planning.investigate', { id: interview.id }, t0 + 10)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('no_bandwidth')
    advance(s, pack, t0 + heavy.seconds * 1000)
    const v2 = project.playerView(s, pack, 'p1', 'CODE')
    expect(v2.planning!.tiles.map((x) => x.investigation)).toEqual([heavy.id])
    expect(v2.planning!.tiles[0]!.unlockedAtMs).toBe(t0 + heavy.seconds * 1000)
    expect(v2.planning!.bandwidthFree).toBe(rules.investigations.bandwidth)
  })

  it('refuses every case in its table', () => {
    const { s, t0 } = playing()
    const err = (r: ReturnType<typeof cmd>) => (r.ok ? 'ok' : r.error)
    expect(err(cmd(s, 'p1', 'planning.investigate', { id: 'rb-nothing' }, t0))).toBe('unknown_id')
    expect(err(cmd(s, 'p1', 'planning.investigate', { id: interview.id }, t0))).toBe('ok')
    expect(err(cmd(s, 'p1', 'planning.investigate', { id: interview.id }, t0 + 1))).toBe('already_done')
    advance(s, pack, t0 + interview.seconds * 1000)
    expect(err(cmd(s, 'p1', 'planning.investigate', { id: interview.id }, t0 + interview.seconds * 1000 + 1))).toBe('already_done')
    expect(err(cmd(s, 'p1', 'planning.submit', {}, t0 + 30_000))).toBe('ok')
    expect(err(cmd(s, 'p1', 'planning.investigate', { id: heavy.id }, t0 + 30_001))).toBe('already_submitted')
    expect(err(cmd(s, 'p1', 'planning.set_report', { picks: {} }, t0 + 30_002))).toBe('already_submitted')
    expect(err(cmd(s, 'p1', 'planning.submit', {}, t0 + 30_003))).toBe('already_submitted')
    host(s, 'end_now', {}, t0 + 40_000)
    expect(s.stage).toBe('planning.reveal')
    expect(err(cmd(s, 'p1', 'planning.investigate', { id: heavy.id }, t0 + 40_001))).toBe('wrong_stage')
    const lobby = newSession()
    join(lobby, 'p1', 'Alpha Branch')
    expect(err(cmd(lobby, 'p1', 'planning.investigate', { id: heavy.id }, 10))).toBe('wrong_stage')
  })

  it('releases interview lines on the schedule k × s ÷ (n + 1) and never early', () => {
    const { s, t0 } = playing()
    const lines = interview.tile.type === 'quote' ? interview.tile.data.text.split('\n') : []
    const n = lines.length
    const end = t0 + interview.seconds * 1000
    expect(cmd(s, 'p1', 'planning.investigate', { id: interview.id }, t0).ok).toBe(true)
    for (let k = 1; k <= n; k++) {
      const at = lineAt(t0, end, k, n)
      expect(at).toBe(t0 + Math.floor((k * interview.seconds * 1000) / (n + 1)))
      const before = advance(s, pack, at - 1)
      expect(before.events.filter((e) => e.kind === 'moment')).toEqual([])
      expect(project.playerView(s, pack, 'p1', 'C').planning!.running[0]!.lines).toEqual(lines.slice(0, k - 1))
      const out = advance(s, pack, at)
      const m = out.events.find((e) => e.kind === 'moment')
      expect(m && m.kind === 'moment' && m.ref).toEqual({ type: 'interview_line', investigation: interview.id, index: k - 1 })
      expect(project.moment(s, pack, 'p1', { type: 'interview_line', investigation: interview.id, index: k - 1 })).toMatchObject({ kind: 'interview_line', text: lines[k - 1] })
    }
    expect(project.playerView(s, pack, 'p1', 'C').planning!.tiles).toEqual([])
    const out = advance(s, pack, end)
    expect(out.events.some((e) => e.kind === 'moment' && e.ref.type === 'tile')).toBe(true)
    expect(project.playerView(s, pack, 'p1', 'C').planning!.running).toEqual([])
  })

  it('runs investigations in parallel and is path independent', () => {
    const mk = () => {
      const { s, t0 } = playing()
      cmd(s, 'p1', 'planning.investigate', { id: interview.id }, t0)
      cmd(s, 'p1', 'planning.investigate', { id: 'rb-look-queue' }, t0 + 700)
      return s
    }
    const a = mk()
    const b = mk()
    const T = 1000 + 60_000
    advance(a, pack, T)
    for (let t = 1000; t <= T; t += 37) advance(b, pack, t)
    advance(b, pack, T)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    expect(a.players.p1!.planning!.done.map((d) => d.id)).toEqual([interview.id, 'rb-look-queue'])
  })

  it('drops investigations still running when the stage ends', () => {
    const { s, t0 } = playing()
    cmd(s, 'p1', 'planning.investigate', { id: heavy.id }, t0)
    host(s, 'end_now', {}, t0 + 1000)
    expect(s.players.p1!.planning!.running).toEqual([])
    expect(s.players.p1!.planning!.done).toEqual([])
  })
})

describe('the board', () => {
  it('accepts a board within the spots and refuses one that breaks a rule', () => {
    const { s, t0 } = playing()
    const err = (picks: Record<string, string>) => { const r = cmd(s, 'p1', 'planning.set_report', { picks }, t0); return r.ok ? 'ok' : r.error }
    expect(err({})).toBe('ok')
    expect(err({ 'rb-q-monday': 'no_ai', 'rb-q-email': 'no_ai' })).toBe('ok')
    expect(err({ 'rb-q-monday': 'no_ai', 'rb-q-email': 'no_ai', 'rb-q-events': 'no_ai' })).toBe('invalid_report')  // three in two spots
    expect(err({ 'rb-q-partner': 'agentic', 'rb-q-events': 'agentic' })).toBe('invalid_report')                     // two in the flagship class
    expect(err({ 'rb-q-monday': 'ladder' })).toBe('invalid_report')
    expect(err({ 'rb-nope': 'no_ai' })).toBe('invalid_report')
    // A refusal changes nothing.
    expect(s.players.p1!.planning!.picks).toEqual({ 'rb-q-monday': 'no_ai', 'rb-q-email': 'no_ai' })
  })

  it('scores the true board at the maximum and an empty board at 0', () => {
    const { s, t0 } = playing()
    join(s, 'p2', 'Beta Branch', t0)
    join(s, 'p3', 'Gamma Branch', t0)
    expect(s.players.p3!.system).toBe('rb')
    expect(cmd(s, 'p1', 'planning.set_report', { picks: truth }, t0 + 10).ok).toBe(true)
    host(s, 'end_now', {}, t0 + 2000)
    const r = s.players.p1!.planning!.result!
    expect(r.raw).toBe(rules.candidates * rules.scoring.classify.exact + rules.scoring.flagship.bonus)
    expect(r.flagship).toBe(rules.scoring.flagship.bonus)
    expect(s.players.p3!.planning!.result!.raw).toBe(0)
    expect(s.players.p3!.planning!.result!.graded.every((g) => g.picked === null && g.points === 0)).toBe(true)
    // The draft of a player who did not send is sent as it stands.
    expect(s.players.p3!.submittedAtMs.planning).toBe(t0 + 2000)
  })

  it('gives partial credit one class off among the real classes, and none across the decoy line', () => {
    const { s, t0 } = playing()
    // A no-AI problem called one model is one class off. A decoy called no AI earns nothing.
    cmd(s, 'p1', 'planning.set_report', { picks: { 'rb-q-monday': 'single_model', 'rb-q-kiosk': 'no_ai', 'rb-q-partner': 'agentic' } }, t0)
    host(s, 'end_now', {}, t0 + 1000)
    const g = Object.fromEntries(s.players.p1!.planning!.result!.graded.map((x) => [x.problem, x.points]))
    expect(g['rb-q-monday']).toBe(rules.scoring.classify.adjacent)
    expect(g['rb-q-kiosk']).toBe(0)
    expect(g['rb-q-partner']).toBe(rules.scoring.classify.exact)
  })
})

describe('the live column and the reveal', () => {
  it('counts insights plus sorted problems, carries its maximum, and breaks ties by who got there first', () => {
    const { s, t0 } = playing()
    join(s, 'p2', 'Beta Branch', t0)
    host(s, 'next', {}, t0)  // refused in a timed stage, harmless
    expect(s.players.p2!.system).toBe('ls')
    expect(cmd(s, 'p2', 'planning.set_report', { picks: { 'ls-q-room': 'no_ai' } }, t0 + 100).ok).toBe(true)
    cmd(s, 'p1', 'planning.set_report', { picks: { 'rb-q-email': 'no_ai' } }, t0 + 200)
    advance(s, pack, t0 + pack.game.leaderboards.refresh_seconds * 1000)
    expect(s.board.order.planning).toEqual(['p2', 'p1'])
    const board = project.boardView(s, pack, { system: null, rows: 10 })
    expect(board.columns.planning.state).toBe('live')
    expect(board.columns.planning.of).toBe(rules.investigations.per_system + rules.candidates)
    expect(board.columns.planning.rows.map((r) => r.value)).toEqual([1, 1])
    // A refused draft does not move the value.
    cmd(s, 'p1', 'planning.set_report', { picks: { 'rb-q-monday': 'ladder' } }, t0 + 300)
    expect(project.boardView(s, pack, { system: null, rows: 10 }).columns.planning.rows.find((r) => r.name === 'Alpha Branch')!.value).toBe(1)
  })

  it('reveals the truth, the graded board, the two parts and the letter only after the stage ends', () => {
    const { s, t0 } = playing()
    cmd(s, 'p1', 'planning.set_report', { picks: { 'rb-q-partner': 'agentic', 'rb-q-kiosk': 'no_ai' } }, t0)
    const before = project.playerView(s, pack, 'p1', 'C')
    expect(before.planning!.reveal).toBeNull()
    expect(JSON.stringify(before)).not.toContain(RB.problems![0]!.key.rationale)
    expect(before.inbox.map((m) => m.kind)).toEqual(['brief'])
    host(s, 'end_now', {}, t0 + 1000)
    const v = project.playerView(s, pack, 'p1', 'C')
    const rv = v.planning!.reveal!
    expect(rv.problems.map((p) => p.id)).toEqual(RB.problems!.map((p) => p.id))
    expect(rv.problems.find((p) => p.flagship)!.class).toBe(rules.flagship_class)
    expect(rv.graded.length).toBe(rules.candidates)
    expect(rv.flagship).toBe(rules.scoring.flagship.bonus)
    expect(rv.classify + rv.flagship).toBe(s.players.p1!.results.planning!.raw)
    // A player never receives the raw score or a band id, only the band's label.
    expect(Object.keys(rv)).not.toContain('raw')
    const band = s.players.p1!.results.planning!.band
    expect(v.points.planning!.band).toBe(pack.game.scoring.score_bands.find((b) => b.id === band)!.label ?? null)
    const letter = v.inbox.find((m) => m.kind === 'letter')!
    expect(letter.text).toContain(RB.story!.letters!.planning_reveal!.always)
    expect(letter.text).toContain(RB.story!.letters!.planning_reveal!.variants[band]!)
  })
})

describe('dialogue', () => {
  it('fires start at the opening, insight:<id> when the tile lands, idle after the idle time, reveal at the end, once each', () => {
    const s = newSession()
    join(s, 'p1', 'Alpha Branch', 0)
    host(s, 'next', {}, 0)
    const open = host(s, 'next', {}, 1000)
    expect(open.ok && open.events.filter((e) => e.kind === 'moment').map((e) => e.kind === 'moment' && e.ref)).toEqual([{ type: 'dialogue', id: 'rb-d-start' }])
    cmd(s, 'p1', 'planning.investigate', { id: 'rb-look-queue' }, 2000)
    cmd(s, 'p1', 'planning.set_report', { picks: {} }, 9000)
    const landed = advance(s, pack, 2000 + inv('rb-look-queue').seconds * 1000)
    expect(landed.events.some((e) => e.kind === 'moment' && e.ref.type === 'dialogue' && e.ref.id === 'rb-d-queue')).toBe(true)
    const idleAt = 9000 + (pack.game.clock.idle_seconds ?? 45) * 1000
    expect(idleAt).toBeGreaterThan(2000 + inv('rb-look-queue').seconds * 1000)
    expect(advance(s, pack, idleAt - 1).events.some((e) => e.kind === 'moment' && e.ref.type === 'dialogue')).toBe(false)
    expect(advance(s, pack, idleAt).events.some((e) => e.kind === 'moment' && e.ref.type === 'dialogue' && e.ref.id === 'rb-d-idle')).toBe(true)
    expect(advance(s, pack, idleAt + 50_000).events.some((e) => e.kind === 'moment' && e.ref.type === 'dialogue')).toBe(false)
    host(s, 'end_now', {}, idleAt + 60_000)
    expect(s.players.p1!.said).toEqual(['rb-d-start', 'rb-d-queue', 'rb-d-idle', 'rb-d-reveal'])
  })
})

describe('joining with a pick of the health system', () => {
  const pick = (s: SessionState, id: string, system: string | null, t = 0) =>
    run(s, { actor: 'system', type: 'join', payload: { playerId: id, name: `Practice ${id}`, avatar: null, system } }, t)

  it('ten joins alternate rb, ls', () => {
    const s = newSession()
    for (let i = 0; i < 10; i++) pick(s, `p${i}`, null)
    expect(s.order.map((id) => s.players[id]!.system)).toEqual(['rb', 'ls', 'rb', 'ls', 'rb', 'ls', 'rb', 'ls', 'rb', 'ls'])
  })

  for (const mode of ['test', 'rehearsal'] as const) {
    it(`honors a pick in a ${mode} session, and later joins restore the balance`, () => {
      const s = createSession(pack, { code: 'T', label: 't', mode })
      expect(pick(s, 'a', 'ls').ok).toBe(true)
      expect(pick(s, 'b', 'ls').ok).toBe(true)
      expect(pick(s, 'c', null).ok).toBe(true)
      expect(pick(s, 'd', null).ok).toBe(true)
      expect(['a', 'b', 'c', 'd'].map((id) => s.players[id]!.system)).toEqual(['ls', 'ls', 'rb', 'rb'])
      const r = pick(s, 'e', 'zz')
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toBe('unknown_system')
      expect(s.players.e).toBeUndefined()
    })
  }

  it('ignores a pick in an event session', () => {
    // An event session needs measured anchors, so this test gives the demo pack some.
    const measured = structuredClone(pack) as typeof pack & { provisional: boolean }
    ;(measured as { provisional: boolean }).provisional = false
    const s = createSession(measured, { code: 'E', label: 'e', mode: 'event' })
    const r1 = run(s, { actor: 'system', type: 'join', payload: { playerId: 'a', name: 'Practice a', avatar: null, system: 'ls' } }, 0)
    const r2 = run(s, { actor: 'system', type: 'join', payload: { playerId: 'b', name: 'Practice b', avatar: null, system: 'zz' } }, 0)
    expect(r1.ok && r2.ok).toBe(true)
    expect([s.players.a!.system, s.players.b!.system]).toEqual(['rb', 'ls'])
  })

  it('after a removal the next join goes to the smaller system', () => {
    const s = newSession()
    for (let i = 0; i < 4; i++) pick(s, `p${i}`, null)
    host(s, 'remove_player', { playerId: 'p1' })       // an ls player
    expect(pick(s, 'p9', null).ok).toBe(true)
    expect(s.players.p9!.system).toBe('ls')
  })
})
