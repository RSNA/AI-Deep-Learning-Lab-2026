// The session: creation, time, stages, joining and host commands (engineering spec, 6.1 to 6.4).
// Pure: no clock, no network, no storage, no randomness. `now` always comes from the caller.
import type { Pack } from '@lab02/content-schema'
import { HostCommand } from '@lab02/protocol/host'
import {
  AVATARS, PHASES, PLAY_STAGES, STAGES, phaseOfStage, resetPhaseOf,
  SCENES, type AvatarId, type ErrorCode, type Mode, type PhaseId, type SceneId, type StageId,
} from '@lab02/protocol'
import { deckSlides, sectionOf, sectionStartFor } from './deck.ts'
import { computeBoard } from './leaderboard.ts'
import { checkName } from './names.ts'
import { PHASE_MODULES } from './phases/index.ts'
import { bandOf, pointsOf } from './scoring.ts'
import { closeStory, fireDialogue, idleLinePending, idleMs, openStory } from './story.ts'
import type { ApplyResult, Command, EngineEvent, GameMs, Outcome, PlayerId, PlayerState, SessionState } from './state.ts'

export const MAX_PLAYERS = 250

// ------------------------------------------------------------------------------------------
// Stages
// ------------------------------------------------------------------------------------------
export function nextStageOf(stage: StageId): StageId | null {
  const i = STAGES.indexOf(stage)
  return i >= 0 && i < STAGES.length - 1 ? STAGES[i + 1]! : null
}

/** Length of a timed stage in game ms, or null for a stage that waits for the host. */
export function stageLengthMs(pack: Pack, stage: StageId): number | null {
  const ph = pack.game.phases
  switch (stage) {
    case 'planning.play': return ph.planning.play_seconds * 1000
    case 'development.play': return ph.development.play_seconds * 1000
    case 'maintaining.year': return ph.maintaining.rounds * ph.maintaining.round_seconds * 1000
    default: return null
  }
}

/** The run-of-show segment that a stage stands for. */
export const SEGMENT_OF_STAGE: Partial<Record<StageId, string>> = {
  'lobby': 'join', 'intro': 'intro_slides',
  'planning.play': 'planning', 'planning.reveal': 'planning', 'break.planning': 'help_slides_1',
  'development.play': 'development', 'development.reveal': 'development', 'break.development': 'help_slides_2',
  'maintaining.year': 'maintaining', 'maintaining.reveal': 'maintaining',
  'break.maintaining': 'help_slides_3', 'reflection': 'reflection', 'winners': 'winners',
}

/** The host's guide countdown for an untimed stage, in game ms from the stage start. */
export function guideLengthMs(pack: Pack, stage: StageId): number | null {
  if (stageLengthMs(pack, stage) !== null) return null
  if (stage === 'planning.reveal') return pack.game.phases.planning.reveal_seconds * 1000
  if (stage === 'development.reveal') return pack.game.phases.development.reveal_seconds * 1000
  if (stage === 'maintaining.reveal') return pack.game.phases.maintaining.reveal_seconds * 1000
  const seg = SEGMENT_OF_STAGE[stage]
  const row = pack.game.run_of_show.find((r) => r.segment === seg)
  return row ? (row.end - row.start) * 60_000 : null
}

const FIRST_STAGE: Record<PhaseId, StageId> = {
  planning: 'planning.play', development: 'development.play', maintaining: 'maintaining.year',
}
const CLOSING_STAGE: Record<PhaseId, StageId> = {
  planning: 'planning.reveal', development: 'development.reveal', maintaining: 'maintaining.reveal',
}

/** The round of Phase 3 in progress, 1 to `rounds`, or null outside its play stage (section 6.7). */
export function currentRound(s: SessionState, pack: Pack, now: GameMs): number | null {
  if (s.stage !== 'maintaining.year' || s.stageEndsAtMs === null) return null
  const mt = pack.game.phases.maintaining
  // The end of round r is the stage end minus the rounds after it, so an extension by the host
  // lengthens the round in progress.
  const left = Math.max(0, s.stageEndsAtMs - now)
  return Math.max(1, Math.min(mt.rounds, mt.rounds - Math.ceil(left / (mt.round_seconds * 1000)) + 1))
}

export function joinOpen(s: SessionState, pack: Pack, now: GameMs): boolean {
  if (s.closed) return false
  const until = pack.game.join.late_join.open_until
  const first = STAGES.indexOf(FIRST_STAGE[until.phase])
  const i = STAGES.indexOf(s.stage)
  if (i < first) return true
  if (until.phase === 'maintaining' && s.stage === 'maintaining.year') {
    return until.round === undefined || (currentRound(s, pack, now) ?? 0) <= until.round
  }
  return s.stage === FIRST_STAGE[until.phase] && until.phase !== 'maintaining'
}

// ------------------------------------------------------------------------------------------
// Creation
// ------------------------------------------------------------------------------------------
export type CreateOptions = { code: string; label: string; mode: Mode; nowMs?: GameMs }

export class ProvisionalAnchorsError extends Error {
  constructor() {
    super('An event session needs measured anchors. This pack has provisional or missing anchors.')
  }
}

export function createSession(pack: Pack, opts: CreateOptions): SessionState {
  if (opts.mode === 'event' && pack.provisional) throw new ProvisionalAnchorsError()
  const now = opts.nowMs ?? 0
  const s: SessionState = {
    v: 1,
    code: opts.code, label: opts.label, mode: opts.mode, contentHash: pack.hash,
    systems: [...pack.systemIds],
    createdAtMs: now,
    stage: 'lobby', stageStartedMs: now, stageEndsAtMs: null,
    stageLog: [{ stage: 'lobby', atMs: now }],
    rev: 0, joinSeq: 0,
    players: {}, order: [],
    opened: [], closedPhases: [],
    board: { atMs: now, live: null, order: { overall: [], planning: [], development: [], maintaining: [] },
             values: { overall: {}, planning: {}, development: {}, maintaining: {} }, systems: [] },
    nextBeatMs: now + pack.game.leaderboards.refresh_seconds * 1000,
    screen: { scene: 'auto', theme: 'light', slide: 0, spotlight: null, filter: null, mirror: false },
    closed: false,
  }
  s.board = computeBoard(s, pack, now)
  return s
}

// ------------------------------------------------------------------------------------------
// Time
// ------------------------------------------------------------------------------------------
function merge(into: Outcome, add: Outcome): void {
  if (into.dirty !== 'all') into.dirty = add.dirty === 'all' ? 'all' : [...new Set([...into.dirty, ...add.dirty])]
  into.events.push(...add.events)
}

/** When the idle line of the phase in play fires for a player, or null. */
function idleDue(s: SessionState, pack: Pack, p: PlayerState): GameMs | null {
  const phase = phaseOfStage(s.stage)
  if (!phase || s.stage !== FIRST_STAGE[phase] || s.stageEndsAtMs === null || p.removed) return null
  if (!idleLinePending(pack, p, phase)) return null
  const t = Math.max(p.lastCmdMs ?? 0, p.joinedAtMs, s.stageStartedMs) + idleMs(pack)
  return t < s.stageEndsAtMs ? t : null
}

/** The earliest timer of any player, and the first player (in join order) who has it. */
function playerDue(s: SessionState, pack: Pack): { at: GameMs; p: PlayerState } | null {
  const phase = phaseOfStage(s.stage)
  const mod = phase ? PHASE_MODULES[phase] : null
  let best: { at: GameMs; p: PlayerState } | null = null
  for (const id of s.order) {
    const p = s.players[id]!
    if (p.removed) continue
    const a = mod?.nextDue?.(s, pack, p) ?? null
    const b = idleDue(s, pack, p)
    const t = a === null ? b : b === null ? a : Math.min(a, b)
    if (t !== null && (best === null || t < best.at)) best = { at: t, p }
  }
  return best
}

/** The live value moves when a command or a timer moves it, so a tie goes to who got there first. */
function refreshLive(s: SessionState, pack: Pack, p: PlayerState, at: GameMs): void {
  const phase = phaseOfStage(s.stage)
  if (!phase || !s.opened.includes(phase) || s.closedPhases.includes(phase)) return
  const v = PHASE_MODULES[phase].liveValue(s, pack, p)
  if (p.live[phase].value !== v) p.live[phase] = { value: v, sinceMs: at }
}

function firePlayer(s: SessionState, pack: Pack, p: PlayerState, at: GameMs): Outcome {
  const phase = phaseOfStage(s.stage)!
  const mod = PHASE_MODULES[phase]
  const events: EngineEvent[] = []
  const a = mod.nextDue?.(s, pack, p) ?? null
  if (a !== null && a <= at) events.push(...(mod.fire?.(s, pack, p, at) ?? []))
  const b = idleDue(s, pack, p)
  if (b !== null && b <= at) events.push(...fireDialogue(pack, p, phase, 'idle', b))
  refreshLive(s, pack, p, at)
  touch(s, p)
  return { dirty: [p.id], events }
}

/**
 * Process every timer due at or before `now`, in order of due time. At the same instant the
 * timers of players run first (in join order), then a stage end, then a leaderboard beat.
 * Calling it once with a late time gives the same state as calling it many times on the way.
 */
export function advance(s: SessionState, pack: Pack, now: GameMs): Outcome {
  const out: Outcome = { dirty: [], events: [] }
  const beatMs = pack.game.leaderboards.refresh_seconds * 1000
  for (let guard = 0; guard < 100_000; guard++) {
    const stageDue = s.stageEndsAtMs !== null && s.stageEndsAtMs <= now ? s.stageEndsAtMs : null
    const beatDue = s.nextBeatMs <= now ? s.nextBeatMs : null
    const pd = s.closed ? null : playerDue(s, pack)
    const pDue = pd && pd.at <= now ? pd : null
    if (stageDue === null && beatDue === null && pDue === null) break
    if (pDue !== null && (stageDue === null || pDue.at <= stageDue) && (beatDue === null || pDue.at <= beatDue)) {
      merge(out, firePlayer(s, pack, pDue.p, pDue.at))
    } else if (stageDue !== null && (beatDue === null || stageDue <= beatDue)) {
      merge(out, enterStage(s, pack, nextStageOf(s.stage)!, stageDue))
    } else {
      s.board = computeBoard(s, pack, beatDue!)
      s.nextBeatMs = beatDue! + beatMs
      out.events.push({ kind: 'beat', atMs: beatDue! })
    }
  }
  return out
}

function touchAll(s: SessionState): void {
  s.rev++
  for (const p of Object.values(s.players)) p.rev++
}

function touch(s: SessionState, p: PlayerState): void {
  s.rev++
  p.rev++
}

function openPhase(s: SessionState, pack: Pack, phase: PhaseId, at: GameMs): EngineEvent[] {
  if (!s.opened.includes(phase)) s.opened.push(phase)
  const events: EngineEvent[] = []
  for (const id of s.order) {
    const p = s.players[id]!
    if (p.removed) continue
    PHASE_MODULES[phase].open(s, pack, p, at)
    p.live[phase] = { value: 0, sinceMs: at }
    events.push(...openStory(pack, p, phase, at))
  }
  return events
}

/**
 * Whether the letter of the reveal takes its `empty` line: in Phase 1 a board with fewer problems
 * sorted than `submission.letter_empty_below`, in Phase 2 a player who never validated a map.
 */
function emptyBoard(pack: Pack, p: PlayerState, phase: PhaseId): boolean {
  if (phase === 'development') return !p.development?.result?.validation
  // Phase 3: no map of this player ran in any period of the year.
  if (phase === 'maintaining') return !p.maintaining || p.maintaining.reports.every((r) => r.map === null)
  if (phase !== 'planning') return false
  const below = pack.game.phases.planning.submission?.letter_empty_below
  return below !== undefined && Object.keys(p.planning?.picks ?? {}).length < below
}

function closePhase(s: SessionState, pack: Pack, phase: PhaseId, at: GameMs): EngineEvent[] {
  const norm = pack.game.scoring.normalization
  const events: EngineEvent[] = []
  for (const id of s.order) {
    const p = s.players[id]!
    if (p.removed || p.results[phase]) continue
    const raw = PHASE_MODULES[phase].close(s, pack, p, at)
    const cal = pack.systems[p.system]!.system.calibration[phase]
    const { points, provisional } = pointsOf(raw, cal, norm)
    p.results[phase] = { raw, points, band: bandOf(points, pack.game.scoring.score_bands), provisional }
    if (PHASE_MODULES[phase].implemented) events.push(...closeStory(pack, p, phase, points, at, emptyBoard(pack, p, phase)))
  }
  if (!s.closedPhases.includes(phase)) s.closedPhases.push(phase)
  return events
}

function enterStage(s: SessionState, pack: Pack, stage: StageId, at: GameMs): Outcome {
  const leaving = s.stage
  const leavingPhase = phaseOfStage(leaving)
  const story: EngineEvent[] = []
  // Leaving the last timed stage of a phase closes it.
  if (leavingPhase && CLOSING_STAGE[leavingPhase] === stage) story.push(...closePhase(s, pack, leavingPhase, at))
  s.stage = stage
  s.stageStartedMs = at
  const len = stageLengthMs(pack, stage)
  s.stageEndsAtMs = len === null ? null : at + len
  s.stageLog.push({ stage, atMs: at })
  for (const ph of PHASES) if (FIRST_STAGE[ph] === stage) story.push(...openPhase(s, pack, ph, at))
  if (stage === 'closed') s.closed = true
  // Section 6.13. Following the game into a slide stage, the deck moves to the section unless the
  // host is already inside it, and the slides go to every player's screen. A play stage ends
  // the mirror, and so does any stage where the projector leaves the slides.
  const sec = s.screen.scene === 'auto' ? sectionOf(pack, stage) : null
  if (sec) {
    if (s.screen.slide < sec.start || s.screen.slide >= sec.start + sec.count) s.screen.slide = sec.start
    s.screen.mirror = true
  }
  endMirrorIfOff(s, pack)
  touchAll(s)
  s.board = computeBoard(s, pack, at)
  const events: EngineEvent[] = [{ kind: 'stage', stage, atMs: at }, ...story]
  if (stage === 'closed') events.push({ kind: 'closed', atMs: at })
  return { dirty: 'all', events }
}

// ------------------------------------------------------------------------------------------
// Commands
// ------------------------------------------------------------------------------------------
const fail = (error: ErrorCode): ApplyResult => ({ ok: false, error, dirty: [], events: [] })
const done = (o: Partial<Outcome> = {}): ApplyResult => ({ ok: true, dirty: o.dirty ?? [], events: o.events ?? [] })

function hash32(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

export function avatarFor(playerId: string, requested: string | null | undefined): AvatarId {
  if (requested && (AVATARS as readonly string[]).includes(requested)) return requested as AvatarId
  return AVATARS[hash32(playerId) % AVATARS.length]!
}

function activePlayers(s: SessionState): PlayerState[] {
  return s.order.map((id) => s.players[id]!).filter((p) => !p.removed)
}

function nameTaken(s: SessionState, lower: string, except?: PlayerId): boolean {
  return activePlayers(s).some((p) => p.id !== except && p.name.toLowerCase() === lower)
}

/** The health system with the fewest active players. `join.tie_order` breaks a tie. */
/** Whether players of this session may pick their health system at join (section 6.4). */
export function canPickSystem(s: SessionState, pack: Pack): boolean {
  return (pack.game.join.choose_system_in_modes ?? []).includes(s.mode)
}

export function assignSystem(s: SessionState, pack: Pack): string {
  const counts = new Map(s.systems.map((id) => [id, 0]))
  for (const p of activePlayers(s)) counts.set(p.system, (counts.get(p.system) ?? 0) + 1)
  const order = [...pack.game.join.tie_order.filter((x) => s.systems.includes(x)), ...s.systems.filter((x) => !pack.game.join.tie_order.includes(x))]
  let best = order[0]!
  for (const id of order) if (counts.get(id)! < counts.get(best)!) best = id
  return best
}

function join(s: SessionState, pack: Pack, payload: { playerId: PlayerId; name: string; avatar?: string | null; system?: string | null }, now: GameMs): ApplyResult {
  if (s.players[payload.playerId]) return fail('bad_message')
  if (!joinOpen(s, pack, now)) return fail('join_closed')
  if (activePlayers(s).length >= MAX_PLAYERS) return fail('session_full')
  // A pick is honored only in the modes that allow it, and ignored elsewhere.
  const picked = canPickSystem(s, pack) && payload.system ? payload.system : null
  if (picked !== null && !s.systems.includes(picked)) return fail('unknown_system')
  const check = checkName(payload.name, pack.game.join.practice_name, (lower) => nameTaken(s, lower))
  if (!check.ok) return fail(check.error)
  const system = picked ?? assignSystem(s, pack)
  const p: PlayerState = {
    id: payload.playerId, name: check.name, avatar: avatarFor(payload.playerId, payload.avatar), system,
    joinSeq: ++s.joinSeq, joinedAtMs: now, removed: false, rev: 1, lastCmdMs: null,
    acted: { planning: false, development: false, maintaining: false },
    submittedAtMs: { planning: null, development: null, maintaining: null },
    live: { planning: { value: 0, sinceMs: now }, development: { value: 0, sinceMs: now }, maintaining: { value: 0, sinceMs: now } },
    results: { planning: null, development: null, maintaining: null },
    planning: null, development: null, maintaining: null,
    inbox: [],
    said: [],
  }
  s.players[p.id] = p
  s.order.push(p.id)
  s.rev++
  // A phase that closed before the player joined scores 0. A phase in play is joined with its full budget.
  for (const ph of s.closedPhases) {
    p.results[ph] = { raw: 0, points: 0, band: bandOf(0, pack.game.scoring.score_bands), provisional: pack.systems[system]!.system.calibration[ph].provisional }
  }
  const events: EngineEvent[] = [{ kind: 'joined', playerId: p.id, atMs: now }]
  for (const ph of s.opened) {
    if (s.closedPhases.includes(ph)) continue
    PHASE_MODULES[ph].open(s, pack, p, now)
    events.push(...openStory(pack, p, ph, now))
  }
  return done({ dirty: [p.id], events })
}

function playerCommand(s: SessionState, pack: Pack, playerId: PlayerId, type: string, payload: unknown, now: GameMs): ApplyResult {
  const p = s.players[playerId]
  if (!p) return fail('unknown_player')
  if (p.removed) return fail('removed')
  const phaseName = type.split('.')[0] as PhaseId
  const mod = (PHASE_MODULES as Record<string, (typeof PHASE_MODULES)[PhaseId] | undefined>)[phaseName]
  const handler = mod?.commands[type]
  if (!mod || !handler) return fail(mod ? 'not_available' : 'bad_message')
  if (phaseOfStage(s.stage) !== mod.phase) return fail('wrong_stage')
  const res = handler(s, pack, p, payload, now)
  if (!res.ok) return { ...fail(res.error), ...(res.data ? { data: res.data } : {}) }
  p.lastCmdMs = now
  p.acted[mod.phase] = true
  refreshLive(s, pack, p, now)
  touch(s, p)
  return { ...res, ok: true }
}

function hostCommand(s: SessionState, pack: Pack, type: string, payload: unknown, now: GameMs): ApplyResult {
  const parsed = HostCommand.safeParse({ type, payload })
  if (!parsed.success) return fail('bad_message')
  const cmd = parsed.data
  const timed = s.stageEndsAtMs !== null
  switch (cmd.type) {
    case 'next': {
      if (timed || s.stage === 'closed') return fail('wrong_stage')
      const next = nextStageOf(s.stage)!
      const opens = PHASES.find((ph) => FIRST_STAGE[ph] === next)
      if (opens && PHASE_MODULES[opens].implemented && !pack.phasesAvailable[opens]) return fail('not_available')
      return { ok: true, ...enterStage(s, pack, next, now) }
    }
    case 'extend': {
      if (!timed) return fail('wrong_stage')
      s.stageEndsAtMs! += cmd.payload.seconds * 1000
      touchAll(s)
      return done({ dirty: 'all' })
    }
    case 'end_now': {
      if (!timed) return fail('wrong_stage')
      return { ok: true, ...enterStage(s, pack, nextStageOf(s.stage)!, now) }
    }
    case 'rename_player': {
      const p = s.players[cmd.payload.playerId]
      if (!p || p.removed) return fail('unknown_player')
      if (!pack.game.join.practice_name.host_can_rename) return fail('not_available')
      const check = checkName(cmd.payload.name, pack.game.join.practice_name, (lower) => nameTaken(s, lower, p.id))
      if (!check.ok) return fail(check.error)
      p.name = check.name
      touch(s, p)
      return done({ dirty: [p.id], events: [{ kind: 'renamed', playerId: p.id, atMs: now }] })
    }
    case 'remove_player': {
      const p = s.players[cmd.payload.playerId]
      if (!p || p.removed) return fail('unknown_player')
      if (!pack.game.join.practice_name.host_can_remove) return fail('not_available')
      p.removed = true
      touch(s, p)
      if (s.screen.spotlight === p.id) s.screen.spotlight = null
      return done({ dirty: [p.id], events: [{ kind: 'removed', playerId: p.id, atMs: now }] })
    }
    case 'reset_stage': {
      if (s.mode === 'event') return fail('not_available')
      if (cmd.payload.confirm.toUpperCase() !== s.code) return fail('confirm_mismatch')
      // At a break the phase before it starts again. Earlier phases keep their points.
      const phase = resetPhaseOf(s.stage)
      if (!phase) return fail('wrong_stage')
      for (const p of activePlayers(s)) {
        p.results[phase] = null
        p.acted[phase] = false
        p.submittedAtMs[phase] = null
      }
      s.closedPhases = s.closedPhases.filter((x) => x !== phase)
      s.opened = s.opened.filter((x) => x !== phase)
      s.run = (s.run ?? 0) + 1
      return { ok: true, ...enterStage(s, pack, FIRST_STAGE[phase], now) }
    }
    case 'restart_game': {
      // The same room starts over: every player stays, with the same name, character, health
      // system and rejoin code, and nothing of the game played so far is kept.
      if (s.mode === 'event') return fail('not_available')
      if (cmd.payload.confirm.toUpperCase() !== s.code) return fail('confirm_mismatch')
      if (s.closed) return fail('wrong_stage')
      for (const p of Object.values(s.players)) {
        p.acted = { planning: false, development: false, maintaining: false }
        p.submittedAtMs = { planning: null, development: null, maintaining: null }
        p.live = { planning: { value: 0, sinceMs: now }, development: { value: 0, sinceMs: now }, maintaining: { value: 0, sinceMs: now } }
        p.results = { planning: null, development: null, maintaining: null }
        p.planning = null
        p.development = null
        p.maintaining = null
        p.inbox = []
        p.said = []
        p.lastCmdMs = null
      }
      s.opened = []
      s.closedPhases = []
      s.stageLog = []
      s.run = (s.run ?? 0) + 1
      s.screen = { ...s.screen, scene: 'auto', slide: 0, spotlight: null, mirror: false }
      return { ok: true, ...enterStage(s, pack, 'lobby', now) }
    }
    case 'close': {
      if (cmd.payload.confirm.toUpperCase() !== s.code) return fail('confirm_mismatch')
      if (s.stage === 'closed') return fail('wrong_stage')
      return { ok: true, ...enterStage(s, pack, 'closed', now) }
    }
    case 'screen_scene': {
      const scene = cmd.payload.scene
      if (scene === 'winners' && s.closedPhases.length === 0) return fail('no_scores_yet')
      if (scene === 'play' && s.opened.length === 0) return fail('no_scores_yet')
      if (scene === 'slides' && deckSlides(pack).length === 0) return fail('no_deck')
      if (scene === 'spotlight' && !s.screen.spotlight) return fail('unknown_player')
      if (cmd.payload.mirror && (scene !== 'slides' || PLAY_STAGES.includes(s.stage))) return fail('not_during_play')
      s.screen.scene = scene
      s.screen.mirror = scene === 'slides' && !!cmd.payload.mirror
      break
    }
    case 'screen_mirror': {
      if (cmd.payload.mirror && (PLAY_STAGES.includes(s.stage) || shownScene(s, pack) !== 'slides')) return fail('not_during_play')
      s.screen.mirror = cmd.payload.mirror
      touchAll(s)
      s.rev++
      return done({ dirty: 'all', events: [{ kind: 'screen', atMs: now }] })
    }
    case 'slide_to': {
      const n = deckSlides(pack).length
      if (n === 0) return fail('no_deck')
      if (cmd.payload.index >= n) return fail('unknown_id')
      s.screen.slide = cmd.payload.index
      break
    }
    case 'screen_theme': s.screen.theme = cmd.payload.theme; break
    case 'screen_filter':
      if (cmd.payload.system !== null && !s.systems.includes(cmd.payload.system)) return fail('unknown_id')
      s.screen.filter = cmd.payload.system
      s.screen.phase = cmd.payload.phase ?? null
      break
    case 'slide': {
      const n = deckSlides(pack).length
      if (n === 0) return fail('no_deck')
      s.screen.slide = Math.max(0, Math.min(n - 1, s.screen.slide + cmd.payload.delta))   // delta is 1 or -1
      break
    }
    case 'spotlight': {
      const id = cmd.payload.playerId
      if (id !== null && (!s.players[id] || s.players[id]!.removed)) return fail('unknown_player')
      s.screen.spotlight = id
      if (id !== null) s.screen.scene = 'spotlight'
      else if (s.screen.scene === 'spotlight') s.screen.scene = 'auto'
      break
    }
    default:
      // pause, resume, set_scale, rejoin_code and spectate act on the server, not on the engine.
      return fail('bad_message')
  }
  s.rev++
  const wasMirrored = !!s.screen.mirror
  endMirrorIfOff(s, pack)
  // A mirrored slide is part of every player's view.
  if (s.screen.mirror || wasMirrored || cmd.type === 'screen_scene' || cmd.type === 'spotlight') {
    touchAll(s)
    return done({ dirty: 'all', events: [{ kind: 'screen', atMs: now }] })
  }
  return done({ events: [{ kind: 'screen', atMs: now }] })
}

/** What the projector shows: the scene the host picked, or what following the game resolves to. */
export function shownScene(s: SessionState, pack: Pack): SceneId {
  const sc = s.screen.scene as string
  if (sc !== 'auto' && (SCENES as readonly string[]).includes(sc)) return sc as SceneId
  const st = s.stage
  if (st === 'lobby') return 'lobby'
  if (sectionStartFor(pack, st) !== null) return 'slides'
  if (st === 'intro') return 'intro'
  if (st.endsWith('.reveal')) return 'reveal'
  if (st === 'reflection') return 'reflection'
  if (st === 'winners' || st === 'closed') return 'winners'
  return 'play'
}

/** The mirror ends when the projector does not show the slides, and in every play stage. */
function endMirrorIfOff(s: SessionState, pack: Pack): void {
  if (s.screen.mirror && (PLAY_STAGES.includes(s.stage) || shownScene(s, pack) !== 'slides')) s.screen.mirror = false
}

/** Whether every player's screen shows the current slide now. */
export function slidesMirrored(s: SessionState, pack: Pack): boolean {
  return !!s.screen.mirror && !PLAY_STAGES.includes(s.stage) && shownScene(s, pack) === 'slides' && deckSlides(pack).length > 0
}

/** Apply one command at game time `now`. The caller has already called `advance(s, pack, now)`. */
export function apply(s: SessionState, pack: Pack, command: Command, now: GameMs): ApplyResult {
  if (command.actor === 'system') {
    if (command.type === 'join') return join(s, pack, command.payload, now)
    return fail('bad_message')
  }
  if (command.actor === 'player') {
    if (s.closed) return fail('wrong_stage')
    return playerCommand(s, pack, command.playerId, command.type, command.payload, now)
  }
  return hostCommand(s, pack, command.type, command.payload, now)
}

/** Host commands that the engine applies (the rest act on the server's clock or sockets). */
export const ENGINE_HOST_COMMANDS = new Set([
  'next', 'extend', 'end_now', 'rename_player', 'remove_player', 'reset_stage', 'restart_game', 'close',
  'screen_scene', 'screen_mirror', 'slide_to', 'screen_theme', 'screen_filter', 'slide', 'spotlight',
])
