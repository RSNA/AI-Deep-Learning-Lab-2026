// Projection: the only code that turns pack data into something a browser may see
// (engineering spec, section 9). Every outgoing object is built field by field. Nothing here
// spreads, passes through or strips a pack object.
import type { Pack, Tile as PackTile } from '@lab02/content-schema'
import type {
  Board, BoardColumn, BoardRow, Clock, ColumnId, LadderRung, Moment, PackArt, PhaseId,
  PlanningContent, PlanningView, PlayerView, ScreenView, SessionInfo, Standing, StageId,
  SystemPublic, SystemRef, Tile,
} from '@lab02/protocol'
import type { HostPlayerRow, HostView } from '@lab02/protocol/host'
import { COLUMNS, PHASES, phaseOfStage } from '@lab02/protocol'
import { livePhase, overallPoints, rankOf } from '../leaderboard.ts'
import { PHASE_MODULES } from '../phases/index.ts'
import { bandwidthFree } from '../phases/planning.ts'
import { SEGMENT_OF_STAGE, guideLengthMs, nextStageOf } from '../session.ts'
import type { GameMs, MomentRef, PlayerId, PlayerState, SessionState } from '../state.ts'

// ------------------------------------------------------------------------------------------
// Session, system, ladder, art
// ------------------------------------------------------------------------------------------
export function systemRefs(s: SessionState, pack: Pack): SystemRef[] {
  return s.systems.map((id, index) => ({ id, index, name: pack.systems[id]!.system.public.name }))
}

export function sessionInfo(s: SessionState, pack: Pack, publicUrl: string): SessionInfo {
  const ph = pack.game.phases
  return {
    code: s.code,
    label: s.label,
    title: pack.game.game.title,
    mode: s.mode,
    systems: systemRefs(s, pack),
    joinUrl: `${publicUrl.replace(/\/$/, '')}/j/${s.code}`,
    phaseLabels: { planning: ph.planning.label, development: ph.development.label, maintaining: ph.maintaining.label },
  }
}

export function systemPublic(s: SessionState, pack: Pack, systemId: string): SystemPublic {
  const sys = pack.systems[systemId]!.system.public
  return {
    id: systemId,
    index: s.systems.indexOf(systemId),
    name: sys.name,
    setting: sys.setting,
    premise: sys.premise,
    practiceProfile: sys.practice_profile.map((r) => ({ label: r.label, value: r.value })),
    baseline: sys.baseline.map((r) => (r.unit === undefined ? { label: r.label, value: r.value } : { label: r.label, value: r.value, unit: r.unit })),
    cast: sys.cast.map((id) => {
      const c = pack.characters.find((x) => x.id === id)!
      return { id: c.id, name: c.public.name, role: c.public.role, portrait: c.public.portrait }
    }),
  }
}

export function ladder(pack: Pack): LadderRung[] {
  const classes = pack.game.phases.planning.classes
  return pack.game.ladder.map((r) => {
    const c = classes.find((x) => x.rungs.includes(r.rung))!
    return { rung: r.rung, label: r.label, fitsWhen: r.fits_when, example: r.example, classId: c.id, classShort: c.short }
  })
}

export function packArt(pack: Pack): PackArt {
  const portraits: string[] = []
  for (const f of pack.artFiles) {
    const m = /^portraits\/([a-z0-9_-]+)\.png$/.exec(f)
    if (m) portraits.push(m[1]!)
  }
  return {
    base: `/pack-art/${pack.hash.slice(0, 12)}/`,
    portraits,
    room: pack.artFiles.includes('room/room_day.png') && pack.artFiles.includes('room/scene.json'),
  }
}

export function clockView(s: SessionState, pack: Pack, clk: { gameMs: GameMs; running: boolean; scale: number }): Clock {
  const guide = guideLengthMs(pack, s.stage)
  return {
    gameMs: clk.gameMs,
    running: clk.running,
    scale: clk.scale,
    stage: s.stage,
    stageEndsAtMs: s.stageEndsAtMs,
    guideEndsAtMs: guide === null ? null : s.stageStartedMs + guide,
    warnings: [...pack.game.clock.warnings_seconds_left],
  }
}

// ------------------------------------------------------------------------------------------
// Phase 1
// ------------------------------------------------------------------------------------------
export function tileView(t: PackTile): Tile {
  switch (t.type) {
    case 'stat': {
      const d = t.data
      const data: Extract<Tile, { type: 'stat' }>['data'] = { value: d.value, label: d.label }
      if (d.unit !== undefined) data.unit = d.unit
      if (d.comparison !== undefined) data.comparison = d.comparison
      return { type: 'stat', headline: t.headline, body: t.body, data }
    }
    case 'chart': {
      const d = t.data
      const data: Extract<Tile, { type: 'chart' }>['data'] = {
        kind: d.kind, xLabel: d.x_label, yLabel: d.y_label,
        series: d.series.map((sr) => ({ name: sr.name, points: sr.points.map(([x, y]) => [x, y] as [string | number, number]) })),
      }
      if (d.note !== undefined) data.note = d.note
      return { type: 'chart', headline: t.headline, body: t.body, data }
    }
    case 'quote':
      return { type: 'quote', headline: t.headline, body: t.body, data: { speaker: t.data.speaker, lines: t.data.text.split('\n') } }
    case 'audit': {
      const d = t.data
      const data: Extract<Tile, { type: 'audit' }>['data'] = {
        sampleSize: d.sample_size, findings: d.findings.map((f) => ({ label: f.label, count: f.count })),
      }
      if (d.note !== undefined) data.note = d.note
      return { type: 'audit', headline: t.headline, body: t.body, data }
    }
  }
}

export function planningContent(s: SessionState, pack: Pack, playerId: PlayerId): PlanningContent {
  const p = s.players[playerId]!
  const sp = pack.systems[p.system]!
  const rules = pack.game.phases.planning
  const brief = sp.story?.briefs?.planning
  const stands = pack.game.story_time?.planning?.investigation_stands_for ?? {}
  return {
    phase: 'planning',
    brief: brief ? { from: brief.from, title: brief.title, text: brief.text } : null,
    rules: {
      bandwidth: rules.investigations.bandwidth,
      classes: rules.class_order.map((id) => {
        const c = rules.classes.find((x) => x.id === id)!
        return { id: c.id, label: c.label, short: c.short, fitsWhen: c.fits_when, rungs: [...c.rungs], capacity: c.capacity }
      }),
    },
    problems: (sp.problems ?? []).map((x) => ({ id: x.id, title: x.public.title, description: x.public.description })),
    investigations: (sp.insights ?? []).map((x) => ({
      id: x.id, method: x.method, character: x.character,
      title: x.public.title, teaser: x.public.teaser,
      bandwidth: x.bandwidth, seconds: x.seconds,
      storyTime: stands[String(x.bandwidth)] ?? null,
    })),
  }
}

/** The interview lines of a running investigation that are out so far. */
function releasedLines(pack: Pack, p: PlayerState, id: string, released: number): string[] {
  const inv = pack.systems[p.system]!.insights!.find((x) => x.id === id)!
  if (inv.tile.type !== 'quote') return []
  return inv.tile.data.text.split('\n').slice(0, released)
}

function planningView(s: SessionState, pack: Pack, p: PlayerState): PlanningView | null {
  const st = p.planning
  if (!st) return null
  const closed = s.closedPhases.includes('planning')
  const sp = pack.systems[p.system]!
  let reveal: PlanningView['reveal'] = null
  if (closed && st.result) {
    reveal = {
      problems: (sp.problems ?? []).map((x) => {
        const out: NonNullable<PlanningView['reveal']>['problems'][number] = {
          id: x.id, class: x.key.class, tier: x.key.tier, flagship: x.key.flagship, rationale: x.key.rationale,
        }
        if (x.key.burden) out.burden = { kind: x.key.burden.kind, size: x.key.burden.size, note: x.key.burden.note }
        return out
      }),
      graded: st.result.graded.map((g) => ({ problem: g.problem, picked: g.picked, points: g.points })),
      classify: st.result.classify, flagship: st.result.flagship, raw: st.result.raw,
    }
  }
  const picks: Record<string, string> = {}
  for (const [k, v] of Object.entries(st.picks)) picks[k] = v
  return {
    status: closed ? 'closed' : st.submittedAtMs !== null ? 'submitted' : 'playing',
    bandwidthFree: bandwidthFree(pack, p),
    running: st.running.map((r) => ({ id: r.id, startedAtMs: r.startedAtMs, completesAtMs: r.completesAtMs, lines: releasedLines(pack, p, r.id, r.released) })),
    tiles: st.done.map((d) => ({
      investigation: d.id, unlockedAtMs: d.atMs,
      tile: tileView(sp.insights!.find((x) => x.id === d.id)!.tile),
    })),
    picks,
    reveal,
  }
}

/** A moment for one player, built from what the engine announced. */
export function moment(s: SessionState, pack: Pack, playerId: PlayerId, ref: MomentRef): Moment | null {
  const p = s.players[playerId]
  if (!p) return null
  const sp = pack.systems[p.system]!
  switch (ref.type) {
    case 'interview_line': {
      const inv = sp.insights?.find((x) => x.id === ref.investigation)
      if (!inv || inv.tile.type !== 'quote') return null
      const text = inv.tile.data.text.split('\n')[ref.index]
      if (text === undefined) return null
      return { kind: 'interview_line', investigation: inv.id, speaker: inv.tile.data.speaker, index: ref.index, text }
    }
    case 'tile':
      return { kind: 'tile', investigation: ref.investigation }
    case 'dialogue': {
      const d = sp.story?.dialogue?.find((x) => x.id === ref.id)
      return d ? { kind: 'dialogue', id: d.id, speaker: d.speaker, text: d.text } : null
    }
    case 'letter':
      return { kind: 'letter', phase: ref.phase }
  }
}

// ------------------------------------------------------------------------------------------
// The player view
// ------------------------------------------------------------------------------------------
export function playerView(s: SessionState, pack: Pack, playerId: PlayerId, rejoinCode: string): PlayerView {
  const p = s.players[playerId]!
  const pts = (ph: PhaseId) => {
    const r = p.results[ph]
    return r ? { points: r.points, band: r.band, provisional: r.provisional } : null
  }
  return {
    rev: p.rev,
    me: { id: p.id, name: p.name, avatar: p.avatar, system: p.system, rejoinCode },
    stage: s.stage,
    points: {
      planning: pts('planning'), development: pts('development'), maintaining: pts('maintaining'),
      total: overallPoints(s, p),
    },
    planning: planningView(s, pack, p),
    development: null,
    maintaining: null,
    inbox: p.inbox.map((m) => {
      const item: PlayerView['inbox'][number] = { id: m.id, kind: m.kind, from: m.from, text: m.text, atMs: m.atMs }
      if (m.title !== undefined) item.title = m.title
      return item
    }),
    reportCard: null,
  }
}

// ------------------------------------------------------------------------------------------
// Leaderboards
// ------------------------------------------------------------------------------------------
function columnLabel(pack: Pack, col: ColumnId, state: BoardColumn['state']): string {
  if (col === 'overall') return 'Total points'
  if (state === 'live') return pack.game.phases[col].live_leaderboard.label
  return 'Points'
}

export function boardView(s: SessionState, pack: Pack, opts: { system: string | null; rows: number; me?: PlayerId }): Board {
  const b = s.board
  const columns = {} as Board['columns']
  for (const col of COLUMNS) {
    const state: BoardColumn['state'] =
      b.order[col].length === 0 ? 'empty'
        : col === 'overall' ? 'sum'
          : b.live === col ? 'live' : 'final'
    const rows: BoardRow[] = []
    let rank = 0
    for (const id of b.order[col]) {
      const p = s.players[id]
      if (!p || p.removed) continue
      if (opts.system && p.system !== opts.system) continue
      rank++
      if (rows.length < opts.rows) {
        const row: BoardRow = { rank, name: p.name, avatar: p.avatar, system: p.system, value: b.values[col][id] ?? 0 }
        if (opts.me === id) row.me = true
        rows.push(row)
      }
    }
    const column: BoardColumn = { state, label: columnLabel(pack, col, state), rows }
    if (state === 'live' && col !== 'overall') {
      const max = PHASE_MODULES[col].liveMax?.(pack) ?? null
      if (max !== null) column.of = max
    }
    columns[col] = column
  }
  return { atMs: b.atMs, live: b.live, system: opts.system, columns, systems: b.systems.map((x) => ({ id: x.id, rank: x.rank, score: x.score })) }
}

export function standing(s: SessionState, pack: Pack, playerId: PlayerId): Standing {
  const p = s.players[playerId]!
  const live = s.board.live ?? ([...s.closedPhases].pop() ?? null)
  const active = s.order.filter((id) => !s.players[id]!.removed)
  return {
    ranks: {
      overall: s.closedPhases.length ? rankOf(s, 'overall', playerId, false) : null,
      system: s.closedPhases.length ? rankOf(s, 'overall', playerId, true) : null,
      phase: live ? rankOf(s, live, playerId, false) : null,
      of: active.length,
      ofSystem: active.filter((id) => s.players[id]!.system === p.system).length,
    },
    board: boardView(s, pack, { system: null, rows: 3, me: playerId }),
  }
}

// ------------------------------------------------------------------------------------------
// Big screen
// ------------------------------------------------------------------------------------------
export function autoScene(stage: StageId): ScreenView['scene'] {
  if (stage === 'lobby') return 'lobby'
  if (stage === 'intro') return 'intro'
  if (stage.endsWith('.reveal')) return 'reveal'
  if (stage.startsWith('break.')) return 'help'
  if (stage === 'reflection') return 'reflection'
  if (stage === 'winners' || stage === 'closed') return 'winners'
  return 'play'
}

export function screenView(s: SessionState, pack: Pack, publicUrl: string): ScreenView {
  const active = s.order.map((id) => s.players[id]!).filter((p) => !p.removed)
  const scene = s.screen.scene === 'auto' ? autoScene(s.stage) : s.screen.scene
  const rowsN = pack.game.leaderboards.big_screen_rows
  const sp = s.screen.spotlight ? s.players[s.screen.spotlight] : undefined
  const w = pack.game.leaderboards.winners
  const showWinners = scene === 'winners' || s.stage === 'winners' || s.stage === 'closed'
  let winners: ScreenView['winners'] = null
  if (showWinners && s.closedPhases.length > 0) {
    const all = boardView(s, pack, { system: null, rows: w.overall_top })
    winners = {
      overall: all.columns.overall.rows,
      perSystem: s.systems.map((id) => ({
        system: id,
        row: boardView(s, pack, { system: id, rows: w.per_system_top }).columns.overall.rows[0] ?? null,
      })),
      topSystems: all.systems.slice(0, w.top_system),
    }
  }
  return {
    session: sessionInfo(s, pack, publicUrl),
    stage: s.stage,
    scene,
    theme: s.screen.theme,
    reveal: screenReveal(s, pack),
    counts: { total: active.length, bySystem: s.systems.map((id) => ({ id, players: active.filter((p) => p.system === id).length })) },
    arrivals: active.slice(-12).reverse().map((p) => ({ name: p.name, avatar: p.avatar, system: p.system })),
    board: boardView(s, pack, { system: s.screen.filter, rows: rowsN }),
    spotlight: sp && !sp.removed ? {
      name: sp.name, avatar: sp.avatar, system: sp.system, stage: s.stage,
      points: {
        planning: sp.results.planning?.points ?? null, development: sp.results.development?.points ?? null,
        maintaining: sp.results.maintaining?.points ?? null, total: overallPoints(s, sp),
      },
      tiles: sp.planning?.done.length ?? 0,
    } : null,
    winners,
  }
}

/** The results of the phase that closed last, for the room (big screen reveal). */
function screenReveal(s: SessionState, pack: Pack): ScreenView['reveal'] {
  const phase = [...s.closedPhases].pop()
  if (!phase) return null
  const max = pack.game.scoring.normalization.max_points
  const active = s.order.map((id) => s.players[id]!).filter((p) => !p.removed && p.acted[phase])
  const histogram = new Array<number>(10).fill(0)
  for (const p of active) {
    const pts = p.results[phase]?.points ?? 0
    histogram[Math.min(9, Math.floor((10 * pts) / max))]!++
  }
  return {
    phase,
    histogram,
    systems: s.systems.map((id) => {
      const ps = active.filter((p) => p.system === id)
      const mean = ps.length ? ps.reduce((sum, p) => sum + (p.results[phase]?.points ?? 0), 0) / ps.length : 0
      const hits = phase === 'planning' ? ps.filter((p) => (p.planning?.result?.flagship ?? 0) > 0).length : 0
      return { id, players: ps.length, meanPoints: Math.round(mean * 10) / 10, flagshipHits: hits }
    }),
  }
}

// ------------------------------------------------------------------------------------------
// Host console
// ------------------------------------------------------------------------------------------
const SEGMENT_LABELS: Record<string, string> = {
  join: 'Join', intro_slides: 'Intro', planning: 'Phase 1', help_slides_1: 'Help 1',
  development: 'Phase 2', help_slides_2: 'Help 2', maintaining: 'Phase 3', help_slides_3: 'Help 3',
  reflection: 'Reflection', winners: 'Winners',
}

export type HostExtras = {
  clock: { gameMs: GameMs; running: boolean; scale: number }
  connected: (playerId: PlayerId) => boolean
  publicUrl: string
  wallNowMs: number
  /** Wall time at which each stage was first entered. */
  stageWall: Partial<Record<StageId, number>>
  answerKey: boolean
  screens: number
}

function playerStatus(s: SessionState, p: PlayerState): string {
  if (p.removed) return 'Removed'
  const ph = phaseOfStage(s.stage)
  if (!ph) return s.stage === 'lobby' ? 'In the lobby' : 'Watching the big screen'
  if (s.closedPhases.includes(ph)) return `Phase result: ${p.results[ph]?.points ?? 0} points`
  if (ph === 'planning') {
    const st = p.planning
    if (!st) return 'Planning'
    const sent = st.submittedAtMs !== null ? ', board sent' : ''
    return `${st.done.length} insights, ${st.running.length} running, ${Object.keys(st.picks).length} sorted${sent}`
  }
  return ph === 'development' ? 'Designing' : 'Running the year'
}

export function hostView(s: SessionState, pack: Pack, x: HostExtras): HostView {
  const active = s.order.map((id) => s.players[id]!)
  const live = livePhase(s)
  const nowGame = x.clock.gameMs

  // The schedule: the run of show against the wall clock, from the moment the intro began.
  const seg = SEGMENT_OF_STAGE[s.stage] ?? null
  const ros = pack.game.run_of_show
  const curIdx = ros.findIndex((r) => r.segment === seg)
  let behind: number | null = null
  const introWall = x.stageWall.intro
  const introRow = ros.find((r) => r.segment === 'intro_slides')
  if (introWall !== undefined && introRow && curIdx >= 0) {
    const origin = introWall - introRow.start * 60_000
    const row = ros[curIdx]!
    const firstEntry = Math.min(...Object.entries(x.stageWall).filter(([st]) => SEGMENT_OF_STAGE[st as StageId] === row.segment).map(([, w]) => w!))
    const lateStart = firstEntry - (origin + row.start * 60_000)
    const overrun = x.wallNowMs - (origin + row.end * 60_000)
    behind = Math.round(Math.max(lateStart, overrun) / 1000)
  }

  const counts = {
    total: active.filter((p) => !p.removed).length,
    connected: active.filter((p) => !p.removed && x.connected(p.id)).length,
    bySystem: s.systems.map((id) => ({
      id,
      players: active.filter((p) => !p.removed && p.system === id).length,
      connected: active.filter((p) => !p.removed && p.system === id && x.connected(p.id)).length,
    })),
  }
  const players: HostPlayerRow[] = active.map((p) => ({
    id: p.id, name: p.name, avatar: p.avatar, system: p.system,
    connected: x.connected(p.id), removed: p.removed,
    status: playerStatus(s, p),
    points: {
      planning: p.results.planning?.points ?? null, development: p.results.development?.points ?? null,
      maintaining: p.results.maintaining?.points ?? null, total: overallPoints(s, p),
    },
    idleSeconds: p.lastCmdMs === null ? null : Math.max(0, Math.round((nowGame - p.lastCmdMs) / 1000)),
    joinedAtMs: p.joinedAtMs,
  }))
  return {
    session: sessionInfo(s, pack, x.publicUrl),
    closed: s.closed,
    contentHash: s.contentHash.slice(0, 12),
    phasesAvailable: { ...pack.phasesAvailable },
    provisional: pack.provisional,
    clock: clockView(s, pack, x.clock),
    stage: s.stage,
    timed: s.stageEndsAtMs !== null,
    next: nextStageOf(s.stage),
    schedule: {
      segments: ros.map((r, i) => ({
        segment: r.segment, label: SEGMENT_LABELS[r.segment] ?? r.segment, start: r.start, end: r.end,
        state: curIdx < 0 ? 'later' : i < curIdx ? 'done' : i === curIdx ? 'now' : 'later',
      })),
      behindSeconds: behind,
    },
    players,
    counts,
    board: boardView(s, pack, { system: null, rows: pack.game.leaderboards.big_screen_rows }),
    screen: { scene: s.screen.scene, theme: s.screen.theme, slide: s.screen.slide, spotlight: s.screen.spotlight, filter: s.screen.filter, screens: x.screens },
    answerKey: x.answerKey,
    phaseLive: live,
    pickModes: [...(pack.game.join.choose_system_in_modes ?? [])],
  }
}

export { PHASES }
