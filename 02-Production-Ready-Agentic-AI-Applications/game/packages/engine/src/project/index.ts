// Projection: the only code that turns pack data into something a browser may see
// (engineering spec, section 9). Every outgoing object is built field by field. Nothing here
// spreads, passes through or strips a pack object.
import type { Pack, Tile as PackTile } from '@lab02/content-schema'
import type {
  Board, BoardColumn, BoardRow, Character, Clock, ColumnId, LadderRung, Moment, PackArt, PhaseId,
  PlanningContent, PlanningView, PlayerView, ScreenView, SessionInfo, SlideView, Standing, StageId,
  SystemPublic, SystemRef, Tile,
} from '@lab02/protocol'
import type { HostDeck, HostInspect, HostPlayerRow, HostView } from '@lab02/protocol/host'
import { COLUMNS, PHASES, PLAY_STAGES, phaseOfStage } from '@lab02/protocol'
import { livePhase, overallPoints, rankOf } from '../leaderboard.ts'
import { PHASE_MODULES } from '../phases/index.ts'
import { bandwidthFree, markOf } from '../phases/planning.ts'
import { deckSlides } from '../deck.ts'
import { SEGMENT_OF_STAGE, guideLengthMs, nextStageOf, shownScene, slidesMirrored } from '../session.ts'
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
    cast: peopleOf(pack, systemId).map(characterView),
    banter: (pack.systems[systemId]!.story?.banter ?? []).map((b) => ({
      id: b.id, lines: b.lines.map((l) => ({ speaker: l.speaker, text: l.text })),
    })),
  }
}

/** Everyone in a practice: the cast of system.yaml, then the extras of the system. */
function peopleOf(pack: Pack, systemId: string): Pack['characters'][number][] {
  const ids = pack.systems[systemId]!.system.public.cast
  const cast = ids.map((id) => pack.characters.find((x) => x.id === id)!)
  const extras = pack.characters.filter((c) => c.extra && (c.system === systemId || c.system === 'all') && !ids.includes(c.id))
  return [...cast, ...extras]
}

function characterView(c: Pack['characters'][number]): Character {
  const look: Character['look'] = {}
  const l = c.look
  if (l?.hair !== undefined) look.hair = l.hair
  if (l?.hair_style !== undefined) look.hairStyle = l.hair_style
  if (l?.skin !== undefined) look.skin = l.skin
  if (l?.top !== undefined) look.top = l.top
  if (l?.detail !== undefined) look.detail = l.detail
  return {
    id: c.id, name: c.public.name, role: c.public.role, portrait: c.public.portrait,
    look, extra: !!c.extra, clickLines: [...(c.click_lines ?? [])],
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
      classify: st.result.classify, flagship: st.result.flagship,
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
    return r ? { points: r.points, band: pack.game.scoring.score_bands.find((b) => b.id === r.band)?.label ?? null } : null
  }
  return {
    rev: p.rev,
    me: { id: p.id, name: p.name, avatar: p.avatar, system: p.system, rejoinCode },
    stage: s.stage,
    run: s.run ?? 0,
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
    slide: slidesMirrored(s, pack) ? slideView(s, pack, s.screen.slide) : null,
  }
}

// ------------------------------------------------------------------------------------------
// Slides
// ------------------------------------------------------------------------------------------
/** The players whose Phase 1 is scored. */
function planningDone(s: SessionState): PlayerState[] {
  if (!s.closedPhases.includes('planning')) return []
  return s.order.map((id) => s.players[id]!).filter((p) => !p.removed && p.acted.planning && p.planning?.result)
}

/**
 * A room statistic that a slide shows live (`live_stat`, section 6.10). Two are drawn so far:
 * the share of the room that found the agent project, as one number, and how well the room
 * placed the problems of each class, as bars. The others show nothing until Step 11.
 */
function liveStat(s: SessionState, name: string): SlideView['stat'] {
  if (name !== 'flagship_hit_rate') return null
  const label = 'of the room found the agent project'
  const done = planningDone(s)
  if (!done.length) return { label, value: '–' }
  const hits = done.filter((p) => (p.planning!.result!.flagship ?? 0) > 0).length
  return { label, value: `${Math.round((100 * hits) / done.length)}%` }
}

const CLASS_TONES = ['lav', 'sky', 'sun', 'go'] as const
const SYSTEM_TONES = ['sky', 'sun', 'rose', 'go'] as const
type Chart = SlideView['charts'][number]

/**
 * A room statistic that is a set of bars. `sorting_by_class`: per class, from the top of the
 * ladder down, the share of its problems the room placed right. `flagship_by_system`: per
 * health system, the share of its practices that found the agent project. Before Phase 1 is
 * scored the bars have no value, so a host who looks through the deck sees that a chart
 * belongs on the slide.
 */
function liveChart(s: SessionState, pack: Pack, name: string): Chart | null {
  const done = planningDone(s)
  const rules = pack.game.phases.planning
  if (name === 'sorting_by_class') {
    const bars = rules.class_order.map((cid, i) => {
      const c = rules.classes.find((x) => x.id === cid)!
      let right = 0
      let all = 0
      for (const p of done) {
        const keys = pack.systems[p.system]!.problems ?? []
        for (const g of p.planning!.result!.graded) {
          if (keys.find((k) => k.id === g.problem)?.key.class !== cid) continue
          all++
          if (g.picked === cid) right++
        }
      }
      return { label: c.short, value: all ? Math.round((100 * right) / all) : null, note: all ? `${right} of ${all}` : null, tone: CLASS_TONES[i % CLASS_TONES.length]!, system: null }
    }).reverse()
    return { title: 'Placed in the right class, by the room', bars }
  }
  if (name === 'flagship_by_system') {
    const bars = s.systems.map((id, i) => {
      const ps = done.filter((p) => p.system === id)
      const hits = ps.filter((p) => (p.planning!.result!.flagship ?? 0) > 0).length
      return {
        label: pack.systems[id]!.system.public.name, value: ps.length ? Math.round((100 * hits) / ps.length) : null,
        note: ps.length ? `${hits} of ${ps.length}` : null, tone: SYSTEM_TONES[i % SYSTEM_TONES.length]!, system: i,
      }
    })
    return { title: 'Found the agent project, by health system', bars }
  }
  return null
}

const SLIDE_TONES = ['sky', 'sun', 'go', 'lav', 'rose'] as const

export function slideView(s: SessionState, pack: Pack, index: number): SlideView | null {
  const all = deckSlides(pack)
  const x = all[Math.max(0, Math.min(all.length - 1, index))]
  if (!x) return null
  const sl = x.slide
  const art = packArt(pack).base
  const stats = sl.live_stat === undefined ? [] : Array.isArray(sl.live_stat) ? sl.live_stat : [sl.live_stat]
  return {
    id: sl.id, index: x.index, count: all.length,
    section: x.section.title,
    layout: sl.layout ?? 'bullets',
    title: sl.title,
    subtitle: sl.subtitle ?? null,
    bullets: [...sl.bullets],
    cards: (sl.cards ?? []).map((c, i) => {
      // A box of a health system that plays in this session carries its index. One that does not play keeps its tone.
      const at = c.system === undefined ? -1 : s.systems.indexOf(c.system)
      return { title: c.title, text: c.text ?? null, points: [...(c.points ?? [])], tag: c.tag ?? null, tone: c.tone ?? SLIDE_TONES[i % SLIDE_TONES.length]!, system: at >= 0 ? at : null }
    }),
    people: (sl.people ?? []).map((p) => ({ name: p.name, role: p.role ?? null, photo: p.photo ? `${art}${p.photo}` : null })),
    figures: (sl.figures ?? []).map((f, i) => ({ image: f.image ? `${art}${f.image}` : null, title: f.title, caption: f.caption ?? null, tone: f.tone ?? SLIDE_TONES[i % SLIDE_TONES.length]! })),
    qr: sl.qr ? { show: sl.qr.show, url: sl.qr.show === 'link' ? sl.qr.url ?? null : null, label: sl.qr.label ?? null } : null,
    references: [...(sl.references ?? [])],
    image: sl.image ? `${art}${sl.image}` : null,
    stat: stats.map((n) => liveStat(s, n)).find((x) => x !== null) ?? null,
    charts: stats.map((n) => liveChart(s, pack, n)).filter((x): x is Chart => x !== null),
  }
}

/** Every slide with its notes, for a host who looks through the deck alone. Never for a player. */
export function hostDeck(s: SessionState, pack: Pack): HostDeck {
  return {
    slides: deckSlides(pack).map((x) => ({
      slide: slideView(s, pack, x.index)!, notes: x.slide.notes ?? null, placeholder: !!x.slide.placeholder, section: x.section.id,
    })),
  }
}

function hostSlide(s: SessionState, pack: Pack, index: number): HostView['deck']['current'] {
  const all = deckSlides(pack)
  const x = all[index]
  const view = x ? slideView(s, pack, index) : null
  if (!x || !view) return null
  return { slide: view, notes: x.slide.notes ?? null, placeholder: !!x.slide.placeholder }
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
export function screenView(s: SessionState, pack: Pack, publicUrl: string): ScreenView {
  const active = s.order.map((id) => s.players[id]!).filter((p) => !p.removed)
  const scene = shownScene(s, pack)
  const rowsN = pack.game.leaderboards.big_screen_rows
  const sp = s.screen.spotlight ? s.players[s.screen.spotlight] : undefined
  const w = pack.game.leaderboards.winners
  const showWinners = scene === 'winners' || s.stage === 'winners' || s.stage === 'closed'
  let winners: ScreenView['winners'] = null
  if (showWinners && s.closedPhases.length > 0) {
    const all = boardView(s, pack, { system: null, rows: w.overall_top })
    const final = s.closedPhases.includes('maintaining')
    winners = {
      final,
      overall: all.columns.overall.rows,
      perSystem: s.systems.map((id) => ({
        system: id,
        row: boardView(s, pack, { system: id, rows: w.per_system_top }).columns.overall.rows[0] ?? null,
      })),
      // Standings so far name every health system, also one with no points yet (section 6.13).
      topSystems: final ? all.systems.slice(0, w.top_system) : all.systems,
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
    slide: scene === 'slides' ? slideView(s, pack, s.screen.slide) : null,
    activity: s.stage === 'planning.play' ? {
      players: active.length,
      acted: active.filter((p) => p.acted.planning).length,
      insights: active.reduce((n, p) => n + (p.planning?.done.length ?? 0), 0),
      sent: active.filter((p) => p.planning?.submittedAtMs !== null && p.planning?.submittedAtMs !== undefined).length,
    } : null,
    winners,
    ...followViews(s, pack, active, scene),
  }
}

/** A stable order that does not follow the join order, so the rotation does not favour early joiners. */
function mix(id: string): number {
  let h = 5381
  for (let i = 0; i < id.length; i++) h = ((h << 5) + h + id.charCodeAt(i)) >>> 0
  return h
}

/** "Follow the game" rotates through its programme in a play stage, unless the host pinned a scene. */
export function projectorRotates(s: SessionState, pack: Pack): boolean {
  return s.screen.scene === 'auto' && PLAY_STAGES.includes(s.stage) && !!pack.game.leaderboards.projector && shownScene(s, pack) === 'play'
}

/** The activity of the room, the leaderboard of one phase and the practice cards (section 6.13). */
function followViews(s: SessionState, pack: Pack, active: PlayerState[], scene: ScreenView['scene']): Pick<ScreenView, 'programme' | 'feed' | 'phaseBoard' | 'cards'> {
  const cfg = pack.game.leaderboards.projector
  const rotates = projectorRotates(s, pack)
  const playing = PLAY_STAGES.includes(s.stage) ? phaseOfStage(s.stage) : null
  const mod = playing ? PHASE_MODULES[playing] : null

  let feed: ScreenView['feed'] = []
  if (mod?.feed && (rotates || scene === 'feed')) {
    const all: ScreenView['feed'] = []
    for (const p of active) for (const e of mod.feed(s, pack, p)) all.push({ name: p.name, avatar: p.avatar, system: p.system, ...e })
    all.sort((a, b) => b.atMs - a.atMs)
    feed = all.slice(0, cfg?.feed_rows ?? 12)
  }

  const boardPhase = rotates ? playing : scene === 'play' ? s.screen.phase ?? null : null
  let phaseBoard: ScreenView['phaseBoard'] = null
  if (boardPhase) {
    const rows = pack.game.leaderboards.big_screen_rows
    const per = s.systems.map((id) => ({ id, col: boardView(s, pack, { system: id, rows }).columns[boardPhase] }))
    // A column of one health system is empty when nobody there has a value yet. The state of the
    // phase is the same for every system, so take it from the whole room.
    const whole = boardView(s, pack, { system: null, rows: 1 }).columns[boardPhase]
    phaseBoard = { phase: boardPhase, state: whole.state as 'empty' | 'live' | 'final', label: whole.label, systems: per.map((x) => ({ id: x.id, rows: x.col.rows })) }
    if (whole.of !== undefined) phaseBoard.of = whole.of
  }

  let cards: ScreenView['cards'] = []
  if (rotates && mod?.card && playing && cfg) {
    const at = s.stageStartedMs
    cards = active.filter((p) => p.acted[playing])
      .sort((a, b) => mix(a.id + at) - mix(b.id + at))
      .slice(0, cfg.cards)
      .map((p) => ({ name: p.name, avatar: p.avatar, system: p.system, ...mod.card!(s, pack, p) }))
  }
  return { programme: rotates && cfg ? cfg.programme.map((x) => ({ show: x.show, seconds: x.seconds })) : null, feed, phaseBoard, cards }
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
  join: 'Join', intro_slides: 'Intro slides', planning: 'Phase 1', help_slides_1: 'Help 1',
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
  // One short line for the players table (section 10.8).
  if (s.closedPhases.includes(ph)) return `Scored · ${p.results[ph]?.points ?? 0} points`
  if (ph === 'planning') {
    const st = p.planning
    if (!st) return 'Planning'
    const sent = st.submittedAtMs !== null ? ' · sent' : ''
    return `${st.done.length} insights · ${st.running.length} running · ${Object.keys(st.picks).length} sorted${sent}`
  }
  return ph === 'development' ? 'Designing' : 'Running the year'
}

/**
 * One player beside the key, for a host (section 10.8). The classes of the player are those held
 * now, or those sent. The key is on it in every stage, so it never goes to a player or a screen.
 */
export function hostInspect(s: SessionState, pack: Pack, playerId: PlayerId, connected: boolean): HostInspect | null {
  const p = s.players[playerId]
  if (!p) return null
  const sp = pack.systems[p.system]!
  const rules = pack.game.phases.planning
  const st = p.planning
  let planning: HostInspect['planning'] = null
  if (st) {
    const title = (id: string) => sp.insights?.find((x) => x.id === id)?.public.title ?? id
    const graded = new Map((st.result?.graded ?? []).map((g) => [g.problem, g]))
    planning = {
      status: s.closedPhases.includes('planning') ? 'closed' : st.submittedAtMs !== null ? 'submitted' : 'playing',
      insights: st.done.length,
      investigations: sp.insights?.length ?? 0,
      running: st.running.map((r) => title(r.id)),
      done: st.done.map((d) => title(d.id)),
      classes: rules.class_order.map((id) => {
        const c = rules.classes.find((x) => x.id === id)!
        return { id: c.id, label: c.label, short: c.short, capacity: c.capacity }
      }),
      problems: (sp.problems ?? []).map((x) => {
        const g = graded.get(x.id)
        const picked = g ? g.picked : st.picks[x.id] ?? null
        return {
          id: x.id, title: x.public.title,
          picked, mark: markOf(picked, x.key.class, rules),
          truth: x.key.class, tier: x.key.tier, flagship: x.key.flagship, rationale: x.key.rationale,
          points: g ? g.points : null,
        }
      }),
      classify: st.result?.classify ?? null,
      flagship: st.result?.flagship ?? null,
    }
  }
  return {
    id: p.id, name: p.name, avatar: p.avatar, system: p.system, connected,
    points: {
      planning: p.results.planning?.points ?? null, development: p.results.development?.points ?? null,
      maintaining: p.results.maintaining?.points ?? null, total: overallPoints(s, p),
    },
    planning,
  }
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
    screen: {
      scene: s.screen.scene, theme: s.screen.theme, slide: s.screen.slide, spotlight: s.screen.spotlight, filter: s.screen.filter, screens: x.screens,
      shown: shownScene(s, pack),
      phase: s.screen.phase ?? null,
      rotates: projectorRotates(s, pack),
      mirror: slidesMirrored(s, pack),
      available: { play: s.opened.length > 0, winners: s.closedPhases.length > 0, slides: deckSlides(pack).length > 0 },
    },
    preview: screenView(s, pack, x.publicUrl),
    deck: {
      count: deckSlides(pack).length,
      sections: (pack.deck?.sections ?? []).map((sec) => {
        const first = deckSlides(pack).find((d) => d.section.id === sec.id)!
        return { id: sec.id, title: sec.title, stage: sec.stage as StageId, start: first.index, count: sec.slides.length }
      }),
      current: hostSlide(s, pack, s.screen.slide),
      next: hostSlide(s, pack, s.screen.slide + 1),
    },
    control: { you: false, state: 'free', holder: null, watchers: [] },
    answerKey: x.answerKey,
    phaseLive: live,
    pickModes: [...(pack.game.join.choose_system_in_modes ?? [])],
  }
}

export { PHASES }
