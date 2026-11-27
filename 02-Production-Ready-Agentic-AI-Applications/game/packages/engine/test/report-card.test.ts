// The personal report card (engineering spec, section 6.12).
import { describe, expect, it } from 'vitest'
import { PlayerView, ReportCard } from '@lab02/protocol'
import { project, type SessionState } from '../src/index.ts'
import { demoPack, host, join, newSession, run } from './helpers.ts'

const pack = demoPack()

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

/** A session with two practices. The first sorts every problem into its true class. */
function played(until: string): SessionState {
  const s = newSession('rehearsal')
  join(s, 'p1', 'Alpha Branch')
  join(s, 'p2', 'Beta Branch')
  const t = toStage(s, 'planning.play')
  const problems = pack.systems[s.players.p1!.system]!.problems!
  const picks: Record<string, string> = {}
  for (const p of problems) picks[p.id] = p.key.class
  expect(run(s, { actor: 'player', playerId: 'p1', type: 'planning.set_report', payload: { picks } }, t + 10).ok).toBe(true)
  toStage(s, until, t + 1000)
  return s
}

describe('the report card', () => {
  it('is on the player view at winners and after the session is closed, and nowhere before', () => {
    const s = played('reflection')
    expect(project.playerView(s, pack, 'p1', 'ABC234').reportCard).toBeNull()
    toStage(s, 'winners', 900_000)
    const v = project.playerView(s, pack, 'p1', 'ABC234', 1_700_000_000_000)
    expect(PlayerView.safeParse(v).success).toBe(true)
    expect(v.reportCard).not.toBeNull()
    expect(v.reportCard!.session).toEqual({ code: 'TEST01', label: 'Test', title: pack.game.game.title, playedAtMs: 1_700_000_000_000, kind: 'multi' })
    toStage(s, 'closed', 950_000)
    expect(project.playerView(s, pack, 'p1', 'ABC234').reportCard).not.toBeNull()
  })

  it('holds the points, band and rank of each phase, the facts of Phase 1, and the papers by their public names', () => {
    const s = played('winners')
    const card = project.reportCard(s, pack, 'p1', 'ABC234', null)!
    expect(ReportCard.safeParse(card).success).toBe(true)
    expect(card.final).toBe(true)
    expect(card.practice).toEqual({ name: 'Alpha Branch', avatar: s.players.p1!.avatar, system: pack.systems[s.players.p1!.system]!.system.public.name, rejoinCode: 'ABC234' })
    expect(card.phases.map((p) => [p.phase, p.number, p.scored])).toEqual([['planning', 1, true], ['development', 2, true], ['maintaining', 3, true]])
    const p1 = card.phases[0]!
    const n = pack.systems[s.players.p1!.system]!.problems!.length
    expect(p1.points).toBe(s.players.p1!.results.planning!.points)
    expect(p1.band).toBe(pack.game.scoring.score_bands.find((b) => b.id === s.players.p1!.results.planning!.band)!.label)
    expect(p1.rank).toBe(1)
    expect(p1.of).toBe(2)
    expect(p1.facts).toContainEqual({ label: 'Problems in their true class', value: `${n} of ${n}` })
    expect(p1.facts).toContainEqual({ label: 'The agent project', value: 'Found' })
    expect(card.total).toBe(card.phases.reduce((sum, p) => sum + (p.points ?? 0), 0))
    expect(card.maxTotal).toBe(3 * pack.game.scoring.phase_max_points)
    expect(card.rank).toBe(1)
    expect(card.readMore).toEqual(Object.values(pack.game.public_source_labels))
    // The other practice sorted nothing: no agent project, and the last rank.
    const other = project.reportCard(s, pack, 'p2', 'XYZ567', null)!
    expect(other.phases[0]!.facts).toContainEqual({ label: 'The agent project', value: 'Not found' })
    expect(other.rank).toBe(2)
  })

  it('shows the lines of the pack whose conditions hold, with the public name of their paper, and the closing of the band', () => {
    const s = played('winners')
    const card = project.reportCard(s, pack, 'p1', 'ABC234', null)!
    const file = pack.reportCard!
    const found = file.sections[0]!.lines.find((l) => l.when.flagship_found === true)!
    expect(card.lines).toContainEqual({ section: file.sections[0]!.title, text: found.text, source: pack.game.public_source_labels.HANDBOOK })
    const missed = file.sections[0]!.lines.filter((l) => l.when.flagship_found === false).map((l) => l.text)
    expect(card.lines.some((l) => missed.includes(l.text))).toBe(false)
    expect(Object.values(file.closing)).toContain(card.closing)
    // Nothing of a key is on a card: not a class, not a rationale, not the gist of a source.
    const text = JSON.stringify(card)
    for (const p of pack.systems[s.players.p1!.system]!.problems!) expect(text).not.toContain(p.key.rationale)
    for (const src of Object.values(pack.game.sources)) expect(text).not.toContain(src.gist)
  })

  it('shows the year of Phase 3: its score, what was spent, and the two numbers of every period', () => {
    const s = played('winners')
    const p = s.players.p1!
    const card = project.reportCard(s, pack, 'p1', 'ABC234', null)!
    const year = card.phases[2]!
    const mt = pack.systems[p.system]!.maintain!
    const reports = p.maintaining!.reports
    expect(reports.length).toBe(mt.periods.length)
    expect(year.periods.map((r) => r.label)).toEqual(mt.periods.map((x) => x.short))
    expect(year.periods.map((r) => r.value)).toEqual(reports.map((r) => r.value))
    expect(year.periods[0]).toMatchObject({ validity: 100 * reports[0]!.validity, reliability: 100 * reports[0]!.reliability })
    expect(year.facts).toContainEqual({ label: 'Score of the year', value: (Math.round(10 * p.maintaining!.result!.score) / 10).toFixed(1) })
    // This practice validated no map in Phase 2 and deployed none: the year ran without one.
    expect(year.facts).toContainEqual({ label: 'Periods with a map running', value: `0 of ${reports.length}` })
    expect(card.lines.some((l) => l.section === pack.reportCard!.sections[1]!.title)).toBe(true)
  })

  it('counts only the phases that were scored, and says so', () => {
    const s = played('break.planning')
    const card = project.reportCard(s, pack, 'p1', 'ABC234', null)!
    expect(card.final).toBe(false)
    expect(card.closing).toBeNull()
    expect(card.phases.map((p) => p.scored)).toEqual([true, false, false])
    expect(card.phases[1]).toMatchObject({ points: null, band: null, rank: null, facts: [] })
    expect(card.total).toBe(s.players.p1!.results.planning!.points)
  })

  it('gives no card to a practice that was removed', () => {
    const s = played('winners')
    expect(host(s, 'remove_player', { playerId: 'p2' }, 990_000).ok).toBe(true)
    expect(project.reportCard(s, pack, 'p2', 'XYZ567', null)).toBeNull()
    expect(project.reportCard(s, pack, 'p1', 'ABC234', null)!.of).toBe(1)
  })
})
