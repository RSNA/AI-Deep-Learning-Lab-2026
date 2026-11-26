import { describe, expect, it } from 'vitest'
import { STAGES } from '@lab02/protocol'
import {
  ProvisionalAnchorsError, advance, avatarFor, bandOf, createSession, isProfane, pointsOf, project, roundHalfUp,
  type SessionState,
} from '../src/index.ts'
import { demoPack, host, join, newSession, run } from './helpers.ts'

const pack = demoPack()
const PLAY = pack.game.phases.planning.play_seconds * 1000

function toStage(s: SessionState, stage: string, now = 0): number {
  let t = now
  for (let i = 0; i < 40 && s.stage !== stage; i++) {
    const r = s.stageEndsAtMs !== null ? host(s, 'end_now', {}, t) : host(s, 'next', {}, t)
    expect(r.ok).toBe(true)
    t += 1000
  }
  expect(s.stage).toBe(stage)
  return t
}

describe('session and stages', () => {
  it('starts in the lobby with an empty board', () => {
    const s = newSession()
    expect(s.stage).toBe('lobby')
    expect(s.board.order.overall).toEqual([])
  })

  it('refuses an event session while anchors are provisional', () => {
    expect(() => createSession(pack, { code: 'X', label: 'x', mode: 'event' })).toThrow(ProvisionalAnchorsError)
  })

  it('walks every stage with next and end_now and closes each phase', () => {
    const s = newSession()
    join(s, 'p1', 'Alpha Branch')
    const seen: string[] = [s.stage]
    let t = 0
    while (s.stage !== 'closed') {
      t += 1000
      const r = s.stageEndsAtMs !== null ? host(s, 'end_now', {}, t) : host(s, 'next', {}, t)
      expect(r.ok).toBe(true)
      seen.push(s.stage)
    }
    expect(seen).toEqual([...STAGES])
    expect(s.closedPhases).toEqual(['planning', 'development', 'maintaining'])
    expect(s.players.p1!.results.planning).not.toBeNull()
    expect(s.closed).toBe(true)
  })

  it('refuses next in a timed stage and end_now or extend in an untimed one', () => {
    const s = newSession()
    expect(host(s, 'end_now').ok).toBe(false)
    expect(host(s, 'extend', { seconds: 30 }).ok).toBe(false)
    toStage(s, 'planning.play')
    const r = host(s, 'next')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('wrong_stage')
  })

  it('ends a play stage by itself at zero, and extend moves the end', () => {
    const s = newSession()
    const t0 = toStage(s, 'planning.play')
    const end = s.stageEndsAtMs!
    expect(end).toBe(s.stageStartedMs + PLAY)
    expect(host(s, 'extend', { seconds: 60 }, t0).ok).toBe(true)
    expect(s.stageEndsAtMs).toBe(end + 60_000)
    advance(s, pack, end + 59_999)
    expect(s.stage).toBe('planning.play')
    advance(s, pack, end + 60_000)
    expect(s.stage).toBe('planning.reveal')
  })

  it('runs the year of Phase 3 on its own timer, one round after the other', () => {
    const s = newSession()
    toStage(s, 'maintaining.year')
    const m = pack.game.phases.maintaining
    expect(s.stage).toBe('maintaining.year')
    expect(s.stageEndsAtMs! - s.stageStartedMs).toBe(m.rounds * m.round_seconds * 1000)
    advance(s, pack, s.stageEndsAtMs!)
    expect(s.stage).toBe('maintaining.reveal')
  })

  it('is path independent: one late advance equals many small ones', () => {
    const a = newSession()
    const b = newSession()
    for (const s of [a, b]) {
      join(s, 'p1', 'Alpha Branch')
      join(s, 'p2', 'Beta Branch', 500)
      toStage(s, 'development.play', 1000)
    }
    const until = a.stageEndsAtMs! + 123_456
    advance(a, pack, until)
    for (let t = 0; t <= until; t += 777) advance(b, pack, t)
    advance(b, pack, until)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('reset_stage puts everyone back at the start of the phase, outside event mode only', () => {
    const s = newSession()
    join(s, 'p1', 'Alpha Branch')
    toStage(s, 'planning.reveal')
    expect(s.players.p1!.results.planning).not.toBeNull()
    expect(host(s, 'reset_stage', { confirm: 'WRONG' }).ok).toBe(false)
    expect(host(s, 'reset_stage', { confirm: s.code.toLowerCase() }, 50_000).ok).toBe(true)
    expect(s.stage).toBe('planning.play')
    expect(s.players.p1!.results.planning).toBeNull()
    expect(s.closedPhases).toEqual([])
    expect(s.stageEndsAtMs).toBe(50_000 + PLAY)
    // A browser learns from the run number that what it kept for the phase is stale.
    expect(project.playerView(s, pack, 'p1', 'CODE').run).toBe(1)
  })

  it('reset_stage at a break starts the phase before it again and keeps the earlier phases', () => {
    const s = newSession()
    join(s, 'p1', 'Alpha Branch')
    const t = toStage(s, 'break.development')
    const planning = s.players.p1!.results.planning
    expect(planning).not.toBeNull()
    expect(s.players.p1!.results.development).not.toBeNull()
    expect(host(s, 'reset_stage', { confirm: s.code }, t).ok).toBe(true)
    expect(s.stage).toBe('development.play')
    expect(s.players.p1!.results.development).toBeNull()
    expect(s.players.p1!.results.planning).toEqual(planning)
    expect(s.closedPhases).toEqual(['planning'])
    // Outside a phase and its break there is nothing to reset.
    const lobby = newSession()
    expect(host(lobby, 'reset_stage', { confirm: lobby.code }).ok).toBe(false)
  })

  it('restart_game takes the same players back to the lobby with nothing kept, outside event mode only', () => {
    const s = newSession()
    join(s, 'p1', 'Alpha Branch')
    join(s, 'p2', 'Beta Branch')
    const system = s.players.p1!.system
    const t = toStage(s, 'break.planning')
    host(s, 'remove_player', { playerId: 'p2' }, t)
    expect(host(s, 'restart_game', { confirm: 'WRONG' }, t).ok).toBe(false)
    expect(host(s, 'restart_game', { confirm: s.code.toLowerCase() }, t).ok).toBe(true)
    expect(s.stage).toBe('lobby')
    expect(s.stageEndsAtMs).toBeNull()
    expect(s.opened).toEqual([])
    expect(s.closedPhases).toEqual([])
    expect(s.stageLog).toEqual([{ stage: 'lobby', atMs: t }])
    const p = s.players.p1!
    expect([p.name, p.system, p.removed]).toEqual(['Alpha Branch', system, false])
    expect(p.results).toEqual({ planning: null, development: null, maintaining: null })
    expect(p.planning).toBeNull()
    expect(p.inbox).toEqual([])
    expect(s.players.p2!.removed).toBe(true)
    expect(project.playerView(s, pack, 'p1', 'CODE').points.total).toBe(0)
    expect(project.playerView(s, pack, 'p1', 'CODE').run).toBe(1)
    // The game plays again from the start, and a new player may join.
    expect(join(s, 'p3', 'Gamma Branch', t).ok).toBe(true)
    toStage(s, 'planning.reveal', t)
    expect(s.players.p1!.results.planning).not.toBeNull()
    // A closed session does not start over.
    host(s, 'close', { confirm: s.code })
    expect(host(s, 'restart_game', { confirm: s.code }).ok).toBe(false)
    const ev = createSession(pack, { code: 'EVENT1', label: 'x', mode: 'test' })
    ev.mode = 'event'
    expect(host(ev, 'restart_game', { confirm: ev.code }).ok).toBe(false)
  })

  it('close needs the session code', () => {
    const s = newSession()
    expect(host(s, 'close', { confirm: 'nope' }).ok).toBe(false)
    expect(host(s, 'close', { confirm: s.code }).ok).toBe(true)
    expect(s.stage).toBe('closed')
    expect(host(s, 'next').ok).toBe(false)
  })

  it('refuses unknown host commands and bad payloads', () => {
    const s = newSession()
    expect(host(s, 'pause').ok).toBe(false)
    expect(host(s, 'nonsense').ok).toBe(false)
    expect(host(s, 'extend', { seconds: 45 }).ok).toBe(false)
  })
})

describe('joining', () => {
  it('balances health systems and breaks ties by tie_order', () => {
    const s = newSession()
    for (let i = 0; i < 6; i++) join(s, `p${i}`, `Branch number ${i}`)
    const order = pack.game.join.tie_order
    expect(s.players.p0!.system).toBe(order[0])
    expect(s.players.p1!.system).toBe(order[1])
    const counts = Object.values(s.players).reduce<Record<string, number>>((c, p) => ({ ...c, [p.system]: (c[p.system] ?? 0) + 1 }), {})
    expect(Object.values(counts)).toEqual([3, 3])
  })

  it('does not count removed players when balancing', () => {
    const s = newSession()
    join(s, 'a', 'First Branch')
    join(s, 'b', 'Second Branch')
    host(s, 'remove_player', { playerId: 'a' })
    join(s, 'c', 'Third Branch')
    expect(s.players.c!.system).toBe(s.players.a!.system)
  })

  it('refuses a name that a practice has, without regard to case, and creates nothing', () => {
    const s = newSession()
    expect(join(s, 'a', 'Maple Branch').ok).toBe(true)
    const r = join(s, 'b', '  maple   BRANCH ')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('name_taken')
    expect(s.order).toEqual(['a'])
  })

  it('checks length and profanity', () => {
    const s = newSession()
    const short = join(s, 'a', 'ab')
    const long = join(s, 'b', 'x'.repeat(25))
    const rude = join(s, 'c', 'Sh1t Branch')
    for (const r of [short, long, rude]) {
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toBe('name_invalid')
    }
    expect(isProfane('Scunthorpe General')).toBe(true) // a known false positive, accepted
    expect(isProfane('Maple Branch')).toBe(false)
  })

  it('replaces a missing or unknown avatar by one picked from the id', () => {
    const s = newSession()
    join(s, 'abc', 'Some Branch', 0, 'nope')
    expect(s.players.abc!.avatar).toBe(avatarFor('abc', null))
    join(s, 'def', 'Other Branch', 0, 'av07')
    expect(s.players.def!.avatar).toBe('av07')
  })

  it('a late joiner gets the phase in play and 0 for a closed phase', () => {
    const s = newSession()
    toStage(s, 'planning.play')
    expect(join(s, 'late1', 'Late One', 2000).ok).toBe(true)
    expect(s.players.late1!.planning).not.toBeNull()
    toStage(s, 'development.play', 10_000)
    expect(join(s, 'late2', 'Late Two', 20_000).ok).toBe(true)
    expect(s.players.late2!.results.planning).toMatchObject({ points: 0, raw: 0 })
  })

  it('closes joining after open_until', () => {
    const s = newSession()
    toStage(s, 'maintaining.year')
    const round = pack.game.phases.maintaining.round_seconds * 1000
    const until = pack.game.join.late_join.open_until.round!
    expect(join(s, 'x', 'Still In Time', s.stageStartedMs + (until - 1) * round + 10).ok).toBe(true)
    const r = join(s, 'y', 'Too Late Now', s.stageStartedMs + until * round + 10)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('join_closed')
  })

  it('a removed player is refused and leaves the rankings', () => {
    const s = newSession()
    join(s, 'a', 'Alpha Branch')
    join(s, 'b', 'Beta Branch')
    host(s, 'remove_player', { playerId: 'a' })
    const r = run(s, { actor: 'player', playerId: 'a', type: 'planning.submit', payload: {} }, 0)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('removed')
    toStage(s, 'planning.reveal')
    expect(s.board.order.planning).toEqual(['b'])
  })

  it('renames with the same rules', () => {
    const s = newSession()
    join(s, 'a', 'Alpha Branch')
    join(s, 'b', 'Beta Branch')
    expect(host(s, 'rename_player', { playerId: 'a', name: 'beta branch' }).ok).toBe(false)
    expect(host(s, 'rename_player', { playerId: 'a', name: 'Gamma Branch' }).ok).toBe(true)
    expect(s.players.a!.name).toBe('Gamma Branch')
  })
})

describe('leaderboards', () => {
  it('beats on refresh_seconds of game time', () => {
    const s = newSession()
    const beat = pack.game.leaderboards.refresh_seconds * 1000
    const out = advance(s, pack, beat * 3)
    expect(out.events.filter((e) => e.kind === 'beat')).toHaveLength(3)
    expect(s.nextBeatMs).toBe(beat * 4)
  })

  it('shows the live column during a phase and points after it closes', () => {
    const s = newSession()
    join(s, 'a', 'Alpha Branch')
    join(s, 'b', 'Beta Branch', 10)
    toStage(s, 'planning.play')
    expect(s.board.live).toBe('planning')
    expect(s.board.order.planning).toEqual(['a', 'b'])
    expect(s.board.order.overall).toEqual([])
    toStage(s, 'planning.reveal')
    expect(s.board.live).toBeNull()
    const v = project.boardView(s, pack, { system: null, rows: 10 })
    expect(v.columns.planning.state).toBe('final')
    expect(v.columns.overall.state).toBe('sum')
    expect(v.columns.development.state).toBe('empty')
  })

  it('ranks inside a health system', () => {
    const s = newSession()
    for (let i = 0; i < 4; i++) join(s, `p${i}`, `Branch number ${i}`, i)
    toStage(s, 'planning.reveal')
    const st = project.standing(s, pack, 'p2')
    expect(st.ranks.overall).toBe(3)
    expect(st.ranks.system).toBe(2)
    expect(st.ranks.ofSystem).toBe(2)
    expect(st.board.columns.overall.rows).toHaveLength(3)
  })

  it('filters the board by health system', () => {
    const s = newSession()
    for (let i = 0; i < 4; i++) join(s, `p${i}`, `Branch number ${i}`, i)
    toStage(s, 'planning.reveal')
    const v = project.boardView(s, pack, { system: 'ls', rows: 10 })
    expect(v.columns.overall.rows.every((r) => r.system === 'ls')).toBe(true)
    expect(v.columns.overall.rows.map((r) => r.rank)).toEqual([1, 2])
  })
})

describe('scores, points and bands', () => {
  const norm = { floor_points: 270, max_points: 1000 }
  it('rounds half up', () => {
    expect(roundHalfUp(2.5)).toBe(3)
    expect(roundHalfUp(2.4999)).toBe(2)
  })
  it('without anchors, keeps the raw score in range and marks it provisional', () => {
    expect(pointsOf(1234.4, { zero: null, floor: null, ceiling: null, provisional: false }, norm)).toEqual({ points: 1000, provisional: true })
    expect(pointsOf(-5, { zero: 0, floor: null, ceiling: 900, provisional: false }, norm)).toEqual({ points: 0, provisional: true })
  })
  it('maps with three anchors', () => {
    expect(pointsOf(150, { zero: 0, floor: 150, ceiling: 850, provisional: true }, norm)).toEqual({ points: 270, provisional: true })
    expect(pointsOf(850, { zero: 0, floor: 150, ceiling: 850, provisional: false }, norm)).toEqual({ points: 1000, provisional: false })
  })
  it('finds the band', () => {
    expect(bandOf(0, pack.game.scoring.score_bands)).toBe('rough')
    expect(bandOf(650, pack.game.scoring.score_bands)).toBe('strong')
    expect(bandOf(1000, pack.game.scoring.score_bands)).toBe('outstanding')
  })
})

describe('projection', () => {
  it('the player view never carries a key field', () => {
    const s = newSession()
    join(s, 'a', 'Alpha Branch')
    toStage(s, 'planning.play')
    const text = JSON.stringify([project.playerView(s, pack, 'a', 'ABCDEF'), project.planningContent(s, pack, 'a'), project.screenView(s, pack, 'http://x')])
    for (const p of pack.systems.rb!.problems!) expect(text).not.toContain(p.key.rationale)
    expect(text).not.toContain('"key"')
    expect(text).not.toContain('calibration')
  })
})
