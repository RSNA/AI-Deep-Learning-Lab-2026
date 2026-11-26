// The personal report card (engineering spec, sections 6.12 and 10.7): what one practice did in
// the game, as a record that is complete in itself. The server keeps it after the session is
// closed, so that a player can come back to it. It holds what the reveals already sent to that
// player and nothing more: points, bands, ranks, a few counts, and the public names of the
// papers behind the game.
import { fromPackMap, type BuildFile, type Pack } from '@lab02/content-schema'
import { PHASES, type PhaseId, type ReportCard, type ReportCardPhase } from '@lab02/protocol'
import { evaluate } from '../canvas.ts'
import { overallPoints, rankOf } from '../leaderboard.ts'
import { bandOf } from '../scoring.ts'
import type { PlayerId, PlayerState, SessionState } from '../state.ts'

/** What a line of the pack's report card file may ask about (`when`). */
export type ReportFacts = Record<string, string | number | boolean>

/** The accuracy of the reference map of a build file. Scored once per file: every card of a session asks for it. */
const referenceCache = new WeakMap<object, number>()
function referenceAccuracy(b: BuildFile): number {
  let a = referenceCache.get(b)
  if (a === undefined) {
    a = evaluate(fromPackMap(b.key.reference.map), b).accuracy
    referenceCache.set(b, a)
  }
  return a
}

const one = (x: number) => (Math.round(10 * x) / 10).toFixed(1)
const percent = (x: number) => `${(Math.round(1000 * x) / 10).toFixed(1)}%`

/** Whether the game is at its end for the players: the card is on their screens. */
export function reportCardShown(s: SessionState): boolean {
  return s.stage === 'winners' || s.stage === 'closed'
}

type Part = { facts: ReportCardPhase['facts']; periods?: ReportCardPhase['periods'] }
const NOTHING: Part = { facts: [] }

function planningPart(s: SessionState, pack: Pack, p: PlayerState, facts: ReportFacts): Part {
  const r = p.planning?.result
  if (!s.closedPhases.includes('planning') || !r) return NOTHING
  const problems = pack.systems[p.system]?.problems ?? []
  const exact = r.graded.filter((g) => g.picked !== null && problems.find((x) => x.id === g.problem)?.key.class === g.picked).length
  const found = (r.flagship ?? 0) > 0
  const started = r.investigations?.total ? r.investigations.started : p.planning?.done.length ?? 0
  const total = r.investigations?.total || (pack.systems[p.system]?.insights ?? []).length
  facts.planning_exact = exact
  facts.flagship_found = found
  facts.investigations_started = started
  return { facts: [
    { label: 'Problems in their true class', value: `${exact} of ${r.graded.length}` },
    { label: 'The agent project', value: found ? 'Found' : 'Not found' },
    { label: 'Investigations run', value: `${started} of ${total}` },
  ] }
}

function developmentPart(s: SessionState, pack: Pack, p: PlayerState, facts: ReportFacts): Part {
  const st = p.development
  const b = pack.systems[p.system]?.build
  if (!s.closedPhases.includes('development') || !st?.result || !b) return NOTHING
  const reference = referenceAccuracy(b)
  const validated = st.result.validation !== null
  facts.map_validated = validated
  facts.map_beats_reference = validated && st.result.accuracy >= reference - 1e-9
  facts.validations_used = st.validations.length
  return { facts: [
    { label: 'Accuracy of your map', value: validated ? percent(st.result.accuracy) : 'No map was validated' },
    { label: 'Accuracy of the reference map', value: percent(reference) },
    { label: 'Validations used', value: `${st.validations.length} of ${b.validate.runs}` },
  ] }
}

/**
 * Phase 3: the score of the year, what was spent, and the two numbers of every report. A
 * practice whose Phase 3 kept no reports (an older session, a phase without content) shows
 * its points alone.
 */
function maintainingPart(s: SessionState, pack: Pack, p: PlayerState, facts: ReportFacts): Part {
  const st = p.maintaining
  const m = pack.systems[p.system]?.maintain
  if (!s.closedPhases.includes('maintaining') || !st?.result || !m) return NOTHING
  const reports = st.reports
  const ran = reports.filter((r) => !r.noMap).length
  facts.ran_a_map = reports.length > 0 && !reports[reports.length - 1]!.noMap
  facts.map_all_year = reports.length > 0 && ran === reports.length
  const unit = pack.game.phases.development.money_unit
  return {
    facts: [
      { label: 'Score of the year', value: one(st.result.score) },
      { label: 'Money spent, in all', value: `${Math.round(st.result.spent)}${unit ? ` ${unit}` : ''}` },
      { label: 'Periods with a map running', value: `${ran} of ${reports.length}` },
    ],
    periods: reports.map((r) => ({
      label: m.periods[r.period - 1]?.short ?? `Period ${r.period}`,
      validity: 100 * r.validity, reliability: 100 * r.reliability, value: r.value,
    })),
  }
}

const PARTS: Record<PhaseId, (s: SessionState, pack: Pack, p: PlayerState, facts: ReportFacts) => Part> = {
  planning: planningPart,
  development: developmentPart,
  maintaining: maintainingPart,
}

/** The lines of the pack's report card file whose conditions all hold. */
function linesOf(pack: Pack, facts: ReportFacts): ReportCard['lines'] {
  const out: ReportCard['lines'] = []
  for (const sec of pack.reportCard?.sections ?? []) {
    for (const line of sec.lines) {
      if (!Object.entries(line.when).every(([k, v]) => facts[k] === v)) continue
      const papers = [...new Set((line.source ?? []).map((id) => pack.game.sources[id]?.paper).filter((x): x is string => !!x))]
      const labels = papers.map((x) => pack.game.public_source_labels[x]).filter((x): x is string => !!x)
      out.push({ section: sec.title, text: line.text, source: labels.length ? labels.join('; ') : null })
    }
  }
  return out
}

/**
 * The card of one practice, from the phases that are scored. `playedAtMs` is the wall time the
 * session was opened, which only the server knows. Null for a practice that was removed.
 */
export function reportCard(s: SessionState, pack: Pack, playerId: PlayerId, rejoinCode: string, playedAtMs: number | null = null): ReportCard | null {
  const p = s.players[playerId]
  if (!p || p.removed) return null
  const active = s.order.filter((id) => !s.players[id]!.removed)
  const bands = pack.game.scoring.score_bands
  const max = pack.game.scoring.phase_max_points
  const facts: ReportFacts = {}
  const phases: ReportCardPhase[] = PHASES.map((ph, i) => {
    const r = s.closedPhases.includes(ph) ? p.results[ph] : null
    facts[`${ph}_band`] = r ? r.band : 'none'
    const part = PARTS[ph](s, pack, p, facts)
    return {
      phase: ph, number: i + 1, label: pack.game.phases[ph].label, scored: !!r,
      points: r ? r.points : null, max,
      band: r ? bands.find((b) => b.id === r.band)?.label ?? null : null,
      rank: r ? rankOf(s, ph, playerId, false) : null, of: active.length,
      facts: part.facts,
      periods: part.periods ?? [],
    }
  })
  const final = PHASES.every((ph) => s.closedPhases.includes(ph))
  const total = overallPoints(s, p)
  const overall = bandOf(Math.round(total / PHASES.length), bands)
  facts.final = final
  facts.overall_band = final ? overall : 'none'
  const system = pack.systems[p.system]
  return {
    session: { code: s.code, label: s.label, title: pack.game.game.title, playedAtMs },
    practice: { name: p.name, avatar: p.avatar, system: system?.system.public.name ?? p.system, rejoinCode },
    final,
    total, maxTotal: max * PHASES.length,
    rank: s.closedPhases.length ? rankOf(s, 'overall', playerId, false) : null, of: active.length,
    systems: s.systems.length,
    systemRank: s.closedPhases.length ? rankOf(s, 'overall', playerId, true) : null,
    ofSystem: active.filter((id) => s.players[id]!.system === p.system).length,
    phases,
    lines: linesOf(pack, facts),
    closing: final ? pack.reportCard?.closing[overall] ?? null : null,
    readMore: Object.values(pack.game.public_source_labels),
    links: (pack.reportCard?.links ?? []).map((l) => ({ label: l.label, url: l.url })),
  }
}
