import { describe, expect, it } from 'vitest'
import { STAGES } from '@lab02/protocol'
import {
  ProvisionalAnchorsError, advance, apply, avatarFor, bandOf, createSession, deckSlides, isProfane, joinOpen, pointsOf, project, roundHalfUp,
  soloCommand, type SessionState,
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

  it('nobody enters a phase in play: a late joiner waits it out, scores 0 for it and enters the next phase', () => {
    const s = newSession()
    join(s, 'p1', 'Alpha Branch')
    toStage(s, 'planning.play')
    expect(join(s, 'late1', 'Late One', 2000).ok).toBe(true)
    const late = s.players.late1!
    expect(late.waitingFor).toBe('planning')
    expect(late.planning).toBeNull()
    // No board, so no command of the phase, no timer and no idle line.
    expect(run(s, { actor: 'player', playerId: 'late1', type: 'planning.submit', payload: {} }, 3000)).toMatchObject({ ok: false, error: 'wrong_stage' })
    const waiting = project.playerView(s, pack, 'late1', 'CODE').waiting!
    expect(waiting.phase).toBe('planning')
    expect(waiting.slides.map((x) => x.section)).toEqual(expect.arrayContaining([expect.any(String)]))
    expect(project.standing(s, pack, 'late1').board.columns.planning.rows.length).toBeGreaterThan(0)
    // Not in the phase, so not in its live ranking, at this beat or the next.
    advance(s, pack, 3000 + pack.game.leaderboards.refresh_seconds * 1000)
    expect(s.board.order.planning).toEqual(['p1'])
    expect(project.standing(s, pack, 'late1').ranks.phase).toBeNull()
    // The phase closes: 0 points for it, and the player still sits out its reveal and its break.
    const t = toStage(s, 'planning.reveal', 10_000)
    expect(late.waitingFor).toBeNull()
    expect(late.results.planning).toMatchObject({ points: 0, raw: 0 })
    expect(late.missed).toEqual(['planning'])
    expect(project.playerView(s, pack, 'late1', 'CODE').waiting?.phase).toBe('planning')
    toStage(s, 'development.play', t)
    expect(late.development).not.toBeNull()
    expect(project.playerView(s, pack, 'late1', 'CODE').waiting).toBeNull()
    // Someone who joins between two phases enters the next one, and the phases before it score 0.
    const s2 = newSession()
    const t2 = toStage(s2, 'break.planning')
    expect(join(s2, 'late2', 'Late Two', t2).ok).toBe(true)
    expect(s2.players.late2!.waitingFor).toBeNull()
    expect(s2.players.late2!.results.planning).toMatchObject({ points: 0, raw: 0 })
    expect(project.playerView(s2, pack, 'late2', 'CODE').waiting?.phase).toBe('planning')
  })

  it('a player who is in a phase is not shown the waiting room', () => {
    const s = newSession()
    join(s, 'p1', 'Alpha Branch')
    toStage(s, 'planning.play')
    expect(project.playerView(s, pack, 'p1', 'CODE').waiting).toBeNull()
    toStage(s, 'break.planning', 5000)
    expect(project.playerView(s, pack, 'p1', 'CODE').waiting).toBeNull()
  })

  it('closes joining when the last phase to enter has started', () => {
    const s = newSession()
    const t = toStage(s, 'break.development')
    expect(joinOpen(s, pack)).toBe(true)
    expect(join(s, 'x', 'Still In Time', t).ok).toBe(true)
    toStage(s, 'maintaining.year', t)
    expect(joinOpen(s, pack)).toBe(false)
    const r = join(s, 'y', 'Too Late Now', s.stageStartedMs + 10)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('join_closed')
  })

  it('keeps the slides that were on show, in the order they came up, for those who join later', () => {
    const s = newSession()
    join(s, 'p1', 'Alpha Branch')
    expect(s.shown ?? []).toEqual([])
    host(s, 'next')                               // intro: its section goes on show
    const first = s.screen.slide
    host(s, 'slide', { delta: 1 })
    host(s, 'slide', { delta: -1 })
    expect(s.shown).toEqual([first, first + 1])
    host(s, 'next', {}, 1000)                     // planning.play
    join(s, 'late', 'Late Branch', 2000)
    expect(project.playerView(s, pack, 'late', 'CODE').waiting!.slides.map((x) => x.index)).toEqual([first, first + 1])
    expect(project.playerView(s, pack, 'p1', 'CODE').waiting).toBeNull()
  })

  it('renames the session in the lobby and refuses once the game runs', () => {
    const s = newSession()
    expect(host(s, 'rename_session', { label: '  Sunday lab  ' }).ok).toBe(true)
    expect(s.label).toBe('Sunday lab')
    expect(host(s, 'rename_session', { label: '   ' })).toMatchObject({ ok: false, error: 'bad_message' })
    host(s, 'next')
    expect(host(s, 'rename_session', { label: 'Too late' })).toMatchObject({ ok: false, error: 'wrong_stage' })
    expect(s.label).toBe('Sunday lab')
  })
})

describe('a single-player game', () => {
  const solo = () => createSession(pack, { code: 'SOLO01', label: 'Single player', mode: 'rehearsal', kind: 'solo' })
  const me = (s: SessionState, type: string, payload: unknown = {}, now = 0) => {
    advance(s, pack, now)
    const c = soloCommand(s, pack, type, payload)
    return typeof c === 'string' ? { ok: false as const, error: c } : apply(s, pack, { actor: 'host', type: c.type, payload: c.payload }, now)
  }

  it('belongs to one practice, and says so in its session info', () => {
    const s = solo()
    expect(project.sessionInfo(s, pack, 'http://x').kind).toBe('solo')
    expect(project.sessionInfo(newSession(), pack, 'http://x').kind).toBe('multi')
    expect(join(s, 'p1', 'Alpha Branch').ok).toBe(true)
    expect(join(s, 'p2', 'Beta Branch')).toMatchObject({ ok: false, error: 'join_closed' })
  })

  it('refuses the three commands in a session with a facilitator', () => {
    const s = newSession()
    for (const type of ['solo.next', 'solo.slide', 'solo.end_now']) expect(soloCommand(s, pack, type, { delta: 1 })).toBe('not_solo')
  })

  it('is moved on by its player: slides inside a section, next out of it, a phase ended early, to the end', () => {
    const s = solo()
    join(s, 'p1', 'Alpha Branch')
    const view = () => project.playerView(s, pack, 'p1', 'CODE')
    expect(view().solo).toEqual({ next: 'intro', timed: false, slide: null })
    expect(me(s, 'solo.end_now')).toMatchObject({ ok: false, error: 'wrong_stage' })
    expect(me(s, 'solo.slide', { delta: 1 })).toMatchObject({ ok: false, error: 'wrong_stage' })   // no slide in the lobby
    expect(me(s, 'solo.next').ok).toBe(true)
    expect(s.stage).toBe('intro')
    // The slides of the intro are on the player's screen, and the player steps through them.
    const sec = { start: s.screen.slide, count: deckSlides(pack).filter((x) => x.section.stage === 'intro').length }
    expect(view().slide).not.toBeNull()
    expect(view().solo!.slide).toEqual({ first: true, last: sec.count === 1 })
    expect(me(s, 'solo.slide', { delta: -1 })).toMatchObject({ ok: false, error: 'wrong_stage' })  // not before the section
    for (let i = 1; i < sec.count; i++) expect(me(s, 'solo.slide', { delta: 1 }).ok).toBe(true)
    expect(view().solo!.slide).toEqual({ first: sec.count === 1, last: true })
    expect(me(s, 'solo.slide', { delta: 1 })).toMatchObject({ ok: false, error: 'wrong_stage' })   // not past the section
    expect(me(s, 'solo.next', {}, 1000).ok).toBe(true)
    expect(s.stage).toBe('planning.play')
    expect(view().solo).toEqual({ next: null, timed: true, slide: null })
    expect(me(s, 'solo.next', {}, 2000)).toMatchObject({ ok: false, error: 'wrong_stage' })
    expect(me(s, 'solo.end_now', {}, 3000).ok).toBe(true)
    expect(s.stage).toBe('planning.reveal')
    let t = 4000
    while (!s.closed) {
      const r = s.stageEndsAtMs !== null ? me(s, 'solo.end_now', {}, t) : me(s, 'solo.next', {}, t)
      expect(r.ok).toBe(true)
      t += 1000
    }
    expect(s.closedPhases).toEqual(['planning', 'development', 'maintaining'])
    expect(view().solo).toEqual({ next: null, timed: false, slide: null })
    expect(me(s, 'solo.next', {}, t)).toMatchObject({ ok: false, error: 'wrong_stage' })
    expect(me(s, 'solo.other')).toMatchObject({ ok: false, error: 'wrong_stage' })
  })

  it('the clock closes no phase: each stays open past its time until its player ends it', () => {
    const s = solo()
    join(s, 'p1', 'Alpha Branch')
    let t = 0
    const to = (stage: string) => { while (s.stage !== stage) { t += 1000; expect((s.stageEndsAtMs !== null ? me(s, 'solo.end_now', {}, t) : me(s, 'solo.next', {}, t)).ok).toBe(true) } }
    for (const stage of ['planning.play', 'development.play'] as const) {
      to(stage)
      const end = s.stageEndsAtMs!
      // Long after its time the phase is open, its end stands where it was, and a command still lands.
      t = end + 10 * 60_000
      advance(s, pack, t)
      expect(s.stage).toBe(stage)
      expect(s.stageEndsAtMs).toBe(end)
      expect(project.playerView(s, pack, 'p1', 'CODE').solo).toEqual({ next: null, timed: true, slide: null })
      expect(me(s, 'solo.end_now', {}, t).ok).toBe(true)
      expect(s.stage).toBe(stage.replace('.play', '.reveal'))
    }
    // The year: every report comes at its time, and the last round waits for the player.
    to('maintaining.year')
    const mt = pack.game.phases.maintaining
    const end = s.stageEndsAtMs!
    advance(s, pack, end - 1)
    expect(s.players.p1!.maintaining!.reports).toHaveLength(mt.rounds)      // the first one opens the year
    t = end + 10 * 60_000
    advance(s, pack, t)
    expect(s.stage).toBe('maintaining.year')
    expect(s.players.p1!.maintaining!.reports).toHaveLength(mt.rounds)
    const mv = project.playerView(s, pack, 'p1', 'CODE').maintaining!
    expect(mv.round).toMatchObject({ index: mt.rounds, of: mt.rounds, endsAtMs: end })
    expect(me(s, 'solo.end_now', {}, t).ok).toBe(true)
    expect(s.stage).toBe('maintaining.reveal')
    expect(s.players.p1!.maintaining!.reports).toHaveLength(mt.rounds + 1)  // the last one closes it
  })

  it('a session with a facilitator still ends a phase when its time is over', () => {
    const s = newSession()
    join(s, 'p1', 'Alpha Branch')
    let t = 0
    while (s.stage !== 'planning.play') { t += 1000; expect(host(s, 'next', {}, t).ok).toBe(true) }
    advance(s, pack, s.stageEndsAtMs!)
    expect(s.stage).toBe('planning.reveal')
  })

  it('a game to look at again holds the reveals and nothing of the live session', () => {
    const s = solo()
    join(s, 'p1', 'Alpha Branch')
    let t = 0
    while (s.stage !== 'break.planning') { t += 1000; expect((s.stageEndsAtMs !== null ? me(s, 'solo.end_now', {}, t) : me(s, 'solo.next', {}, t)).ok).toBe(true) }
    expect(project.playerView(s, pack, 'p1', 'CODE').slide).not.toBeNull()
    const mine = project.reviewMine(s, pack, 'p1', 'CODE', null)
    expect(mine.view.slide).toBeNull()
    expect(mine.view.solo).toBeNull()
    expect(mine.view.planning!.reveal).not.toBeNull()
    const base = project.reviewBase(s, pack, 'p1', 'http://x')
    expect(base.content.map((c) => c.phase)).toEqual(['planning'])
    expect(base.session.kind).toBe('solo')
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
