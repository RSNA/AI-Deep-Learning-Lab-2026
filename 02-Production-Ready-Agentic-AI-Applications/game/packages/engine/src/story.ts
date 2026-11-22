// Story hooks (engineering spec, section 6.11). Briefs open a phase, letters arrive with a
// reveal, dialogue fires once per player when its trigger occurs. Nothing here changes a score.
import type { Pack } from '@lab02/content-schema'
import type { PhaseId } from '@lab02/protocol'
import { bandOf } from './scoring.ts'
import type { EngineEvent, GameMs, PlayerState } from './state.ts'

const LETTER_OF: Record<PhaseId, 'planning_reveal' | 'development_reveal' | 'annual_review'> = {
  planning: 'planning_reveal', development: 'development_reveal', maintaining: 'annual_review',
}

/** Fire every dialogue line of the player's system for this phase and trigger, once each. */
export function fireDialogue(pack: Pack, p: PlayerState, phase: PhaseId, on: string, at: GameMs): EngineEvent[] {
  const lines = pack.systems[p.system]?.story?.dialogue ?? []
  const out: EngineEvent[] = []
  for (const d of lines) {
    if (d.trigger.phase !== phase || d.trigger.on !== on || p.said.includes(d.id)) continue
    p.said.push(d.id)
    out.push({ kind: 'moment', playerId: p.id, atMs: at, ref: { type: 'dialogue', id: d.id } })
  }
  return out
}

/** Whether an idle line is still to fire for this player in this phase. */
export function idleLinePending(pack: Pack, p: PlayerState, phase: PhaseId): boolean {
  const lines = pack.systems[p.system]?.story?.dialogue ?? []
  return lines.some((d) => d.trigger.phase === phase && d.trigger.on === 'idle' && !p.said.includes(d.id))
}

export function idleMs(pack: Pack): number {
  return (pack.game.clock.idle_seconds ?? 45) * 1000
}

/**
 * The first paragraph of the Phase 2 letter: `hit` for a player whose Phase 1 board had the
 * flagship problem in the flagship class, `missed` for one whose board had not, and none for a
 * player without a Phase 1 result. Both are public, and Phase 1 is over when the letter comes.
 */
export function developmentOpening(pack: Pack, p: PlayerState): string | null {
  const sp = pack.systems[p.system]
  const op = sp?.story?.briefs?.development?.opening
  const result = p.planning?.result
  if (!sp || !op || !result) return null
  const picked = result.graded.find((g) => g.problem === sp.system.key.flagship_problem)?.picked ?? null
  return picked !== null && picked === pack.game.phases.planning.flagship_class ? op.hit : op.missed
}

/** A phase opens for a player: the brief goes to the inbox, and the start lines fire. */
export function openStory(pack: Pack, p: PlayerState, phase: PhaseId, at: GameMs): EngineEvent[] {
  // A reset of the stage opens the phase again: its story starts over.
  const own = new Set((pack.systems[p.system]?.story?.dialogue ?? []).filter((d) => d.trigger.phase === phase).map((d) => d.id))
  p.said = p.said.filter((id) => !own.has(id))
  p.inbox = p.inbox.filter((m) => !m.id.startsWith(`${phase}:`))
  const brief = pack.systems[p.system]?.story?.briefs?.[phase]
  if (brief) {
    const opening = phase === 'development' ? developmentOpening(pack, p) : null
    p.inbox.push({ id: `${phase}:brief`, kind: 'brief', from: brief.from, title: brief.title, text: opening ? `${opening}\n\n${brief.text}` : brief.text, atMs: at })
  }
  return fireDialogue(pack, p, phase, 'start', at)
}

/**
 * A phase closes for a player: the letter for their band, and the reveal lines. A board that was
 * left (nearly) empty gets the letter's `empty` variant in place of the band's.
 */
export function closeStory(pack: Pack, p: PlayerState, phase: PhaseId, points: number, at: GameMs, empty = false): EngineEvent[] {
  const out: EngineEvent[] = []
  const letter = pack.systems[p.system]?.story?.letters?.[LETTER_OF[phase]]
  if (letter) {
    const band = bandOf(points, pack.game.scoring.score_bands)
    const variant = (empty ? letter.variants.empty : undefined) ?? letter.variants[band]
    const text = variant ? `${letter.always}\n\n${variant}` : letter.always
    p.inbox = p.inbox.filter((m) => m.id !== `${phase}:letter`)
    p.inbox.push({ id: `${phase}:letter`, kind: 'letter', from: letter.from, text, atMs: at })
    out.push({ kind: 'moment', playerId: p.id, atMs: at, ref: { type: 'letter', phase } })
  }
  out.push(...fireDialogue(pack, p, phase, 'reveal', at))
  return out
}
