// The steps of the guided first build of Phase 2 (engineering spec, section 10.5). One pure
// function reads the pack, the view and the draft on the canvas and says which step the player
// is at. Nothing here listens to clicks: a player who does a later step on their own, by a click
// or by a drag, is caught up with, and one who undoes a step is taken back to it.
import type { CanvasMap, DevelopmentContent, DevelopmentView } from '@lab02/protocol'

/** What the tutorial builds with, read off the pack once it is on the board. */
export type FirstPlan = {
  /** The first action that costs no money and waits for nothing. Null: the pack has none. */
  action: string | null
  /** The AI operator that needs a model, a place to run and a prompt. */
  agent: string
  /** The person who checks the work before it goes out. Null: the pack has no person. */
  person: string | null
  /** Whether the pack has prompts to choose from. */
  prompts: boolean
}

export type FirstStep =
  | { id: 'action'; action: string }
  | { id: 'wait'; action: string; seconds: number }
  | { id: 'card'; action: string }
  | { id: 'place'; worker: string }
  | { id: 'model' | 'runsOn' | 'prompt'; tile: string; choices: number }
  | { id: 'source'; tile: string; first: string | null }
  | { id: 'person'; worker: string }
  | { id: 'handoff'; from: string; to: string }
  | { id: 'result'; from: string }
  | { id: 'validate' }
  | { id: 'validating' }
  | { id: 'done'; free: boolean; left: number }

export type FirstStepId = FirstStep['id']

type Content = Pick<DevelopmentContent, 'workers' | 'models' | 'compute' | 'prompts' | 'actions' | 'sources' | 'result'>
type View = Pick<DevelopmentView, 'unlocked' | 'actionsRunning' | 'insights' | 'ready' | 'validating' | 'validations' | 'validationsLeft'> & { actionsDone: { id: string }[] }

/** A card that arrives later than this is not waited for: the player builds on. */
export const WAIT_FOR_CARD_S = 25

/**
 * What the tutorial builds with. `person` is the worker the pack requires on the way to the
 * result when the view names one, and the first person of the toolbox otherwise. Null when the
 * board has no AI operator that needs a model: there is nothing to guide then. `before` is the
 * plan the tutorial began with: it is kept, so that the steps do not change under the player,
 * except for a person the pack turns out to require.
 */
export function firstPlan(c: Content, dv: View, before: FirstPlan | null = null): FirstPlan | null {
  const open = new Set(dv.unlocked)
  const workers = c.workers.filter((w) => open.has(w.id))
  const people = workers.filter((w) => w.kind === 'person')
  const ai = workers.filter((w) => w.needsModel)
  // Among several, the one that stands with the people of the toolbox is the operator.
  const agent = ai.find((w) => w.group !== null && people.some((x) => x.group === w.group)) ?? ai[0]
  if (!agent) return null
  const required = dv.ready.details.flatMap((d) => (d.reason === 'required_missing' ? d.workers : []))
  const named = people.find((w) => required.includes(w.id))
  if (before) return named && named.id !== before.person ? { ...before, person: named.id } : before
  const person = named ?? people[0] ?? null
  const done = new Set(dv.actionsDone.map((d) => d.id))
  const action = c.actions.find((a) => a.money === 0 && a.requires.every((r) => done.has(r))) ?? null
  return { action: action?.id ?? null, agent: agent.id, person: person?.id ?? null, prompts: c.prompts.some((p) => open.has(p.id)) }
}

/** The steps a plan has, in order, for "Step 3 of 10". */
export function firstStepList(plan: FirstPlan): FirstStepId[] {
  return [
    ...(plan.action ? ['action', 'card'] as const : []),
    'place', 'model', 'runsOn', ...(plan.prompts ? ['prompt'] as const : []), 'source',
    ...(plan.person ? ['person', 'handoff'] as const : []), 'result', 'validate',
  ]
}

/** Where a step stands in that list. Waiting belongs to the card, and the end to Validate. */
export function firstStepNumber(plan: FirstPlan, id: FirstStepId): { n: number; of: number } {
  const list = firstStepList(plan)
  const as: FirstStepId = id === 'wait' ? 'card' : id === 'validating' || id === 'done' ? 'validate' : id
  return { n: Math.max(1, list.indexOf(as) + 1), of: list.length }
}

/**
 * The step the player is at. `told`: what only the player can say (the card was read, the
 * prompt the tile came with is kept). `nowMs` is the game clock.
 */
export function firstStep(plan: FirstPlan, c: Content, dv: View, map: CanvasMap, told: { read: boolean; promptKept: boolean }, nowMs: number): FirstStep {
  // A validation ends the tutorial, whatever came before it.
  if (dv.validations.length) return { id: 'done', free: dv.validations[0]!.free, left: dv.validationsLeft }
  if (dv.validating) return { id: 'validating' }

  const open = new Set(dv.unlocked)
  const started = dv.actionsRunning.length + dv.actionsDone.length > 0
  if (plan.action && !started) return { id: 'action', action: plan.action }
  if (plan.action && !told.read) {
    const card = dv.insights.at(-1)
    if (card) return { id: 'card', action: card.action }
    // A card that is a few seconds away is worth the wait. A long action is not.
    const soon = dv.actionsRunning.map((r) => ({ id: r.id, s: (r.completesAtMs - nowMs) / 1000 })).filter((r) => r.s <= WAIT_FOR_CARD_S).sort((a, b) => a.s - b.s)[0]
    if (soon) return { id: 'wait', action: soon.id, seconds: Math.max(0, Math.ceil(soon.s)) }
  }

  const agent = map.tiles.find((t) => t.kind === plan.agent)
  if (!agent) return { id: 'place', worker: plan.agent }
  const w = c.workers.find((x) => x.id === plan.agent)
  if (agent.model === null) return { id: 'model', tile: agent.id, choices: c.models.filter((m) => open.has(m.id) && (w?.models.includes(m.id) ?? true)).length }
  if (agent.runsOn === null) {
    const model = c.models.find((m) => m.id === agent.model)
    return { id: 'runsOn', tile: agent.id, choices: c.compute.filter((x) => open.has(x.id) && (model?.runsOn.includes(x.id) ?? true)).length }
  }
  if (plan.prompts && agent.prompt === null && !told.promptKept) return { id: 'prompt', tile: agent.id, choices: c.prompts.filter((p) => open.has(p.id)).length }

  const sources = c.sources.filter((s) => open.has(s.id)).map((s) => s.id)
  if (!map.lines.some((l) => l.to === agent.id && sources.includes(l.from))) return { id: 'source', tile: agent.id, first: sources[0] ?? null }

  let last = agent.id
  if (plan.person) {
    const person = map.tiles.find((t) => t.kind === plan.person)
    if (!person) return { id: 'person', worker: plan.person }
    if (!map.lines.some((l) => l.from === agent.id && l.to === person.id)) return { id: 'handoff', from: agent.id, to: person.id }
    last = person.id
  }
  if (!map.lines.some((l) => l.to === c.result.id)) return { id: 'result', from: last }
  return { id: 'validate' }
}
