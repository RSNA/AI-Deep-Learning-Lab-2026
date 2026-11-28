// The guided first build of Phase 2 (engineering spec, section 10.5): which step a player is at,
// read off the pack, the view and the draft, so that a step done out of turn is caught up with.
import { describe, expect, it } from 'vitest'
import type { CanvasMap } from '@lab02/protocol'
import { P2, count } from '../src/phase2/copy.ts'
import { firstPlan, firstStep, firstStepList, firstStepNumber, WAIT_FOR_CARD_S } from '../src/phase2/firstBuild.ts'

type Content = Parameters<typeof firstPlan>[0]
type View = Parameters<typeof firstPlan>[1]

const worker = (id: string, kind: 'ai' | 'fixed' | 'person', group: string, needsModel = false) => ({
  id, kind, label: id, short: id, description: '', icon: '', task: null, group, costLine: null, needsModel, models: needsModel ? ['m-small', 'm-large'] : [], pool: null, minutes: null,
})
const part = (id: string) => ({ id, label: id, short: id, description: '', costLine: null })
const action = (id: string, money: number, requires: string[] = []) => ({ id, group: 'learn', title: `Title of ${id}`, teaser: '', money, developers: 0, seconds: 10, storyTime: null, unlocks: [], requires })
const content = {
  workers: [worker('w-step', 'ai', 'tools', true), worker('w-clerk', 'person', 'operators'), worker('w-agent', 'ai', 'operators', true), worker('w-signer', 'person', 'operators'), worker('w-rule', 'fixed', 'tools')],
  models: [{ ...part('m-small'), runsOn: ['c-api'] }, { ...part('m-large'), runsOn: ['c-api', 'c-own'] }, { ...part('m-open'), runsOn: ['c-own'] }],
  compute: [{ ...part('c-api'), protectsPrivateData: false }, { ...part('c-own'), protectsPrivateData: true }],
  prompts: [{ id: 'p-line', label: 'One line', short: null, description: '', sample: null, samples: [] }, { id: 'p-steps', label: 'Steps', short: null, description: '', sample: null, samples: [] }],
  actions: [action('a-buy', 10), action('a-later', 0, ['a-buy']), action('a-read', 0), action('a-talk', 0)],
  sources: [{ id: 's-locked', label: 'Locked', description: '', icon: '', privateData: false }, { id: 's-order', label: 'The order', description: '', icon: '', privateData: false }],
  result: { id: 'result', label: 'The plan', description: '' },
} as unknown as Content

const view = (over: Partial<View> = {}): View => ({
  unlocked: ['w-step', 'w-clerk', 'w-agent', 'w-signer', 'w-rule', 'm-small', 'm-large', 'c-api', 'p-line', 'p-steps', 's-order'],
  actionsDone: [], actionsRunning: [], insights: [],
  ready: { ok: false, reasons: [], details: [{ reason: 'required_missing', workers: ['w-signer'], text: '' }] },
  validating: null, validations: [], validationsLeft: 6, ...over,
})
const T = (id: string, kind: string, model: string | null = null, runsOn: string | null = null, prompt: string | null = null) => ({ id, kind, col: 1, row: 1, model, runsOn, prompt })
const map = (tiles: CanvasMap['tiles'] = [], lines: [string, string][] = []): CanvasMap => ({ tiles, lines: lines.map(([from, to]) => ({ from, to })) })
const NOT_TOLD = { read: false, promptKept: false }
const TOLD = { read: true, promptKept: true }
const insight = (a: string) => ({ action: a, tile: {} }) as unknown as View['insights'][number]

describe('what the guided first build builds with', () => {
  it('takes the AI operator that stands with the people, the person the pack requires, and the first action that costs nothing and waits for nothing', () => {
    expect(firstPlan(content, view())).toEqual({ action: 'a-read', agent: 'w-agent', person: 'w-signer', prompts: true })
  })
  it('takes the first person of the toolbox when the pack requires none, and none when there is none', () => {
    const free = view({ ready: { ok: false, reasons: [], details: [] } })
    expect(firstPlan(content, free)!.person).toBe('w-clerk')
    expect(firstPlan(content, { ...free, unlocked: free.unlocked.filter((x) => x !== 'w-clerk' && x !== 'w-signer') })).toMatchObject({ agent: 'w-step', person: null })
  })
  it('has nothing to guide on a board with no AI operator', () => {
    expect(firstPlan(content, view({ unlocked: ['w-clerk', 'w-rule'] }))).toBeNull()
  })
  it('keeps the plan it began with, except for a person that turns out to be required', () => {
    const begun = firstPlan(content, view({ ready: { ok: false, reasons: [], details: [] } }))!
    expect(begun.person).toBe('w-clerk')
    expect(firstPlan(content, view({ actionsDone: [{ id: 'a-buy' }], ready: { ok: false, reasons: [], details: [] } }), begun)).toBe(begun)
    expect(firstPlan(content, view(), begun)).toEqual({ ...begun, person: 'w-signer' })
  })
  it('counts its steps, with the prompt and the person only where the pack has them', () => {
    const plan = firstPlan(content, view())!
    expect(firstStepList(plan)).toEqual(['action', 'card', 'place', 'model', 'runsOn', 'prompt', 'source', 'person', 'handoff', 'result', 'validate'])
    expect(firstStepList({ ...plan, action: null, person: null, prompts: false })).toEqual(['place', 'model', 'runsOn', 'source', 'result', 'validate'])
    expect(firstStepNumber(plan, 'wait')).toEqual({ n: 2, of: 11 })
    expect(firstStepNumber(plan, 'done')).toEqual({ n: 11, of: 11 })
  })
})

describe('the step a player is at', () => {
  const plan = firstPlan(content, view())!
  const step = (dv: Partial<View>, m: CanvasMap, told = TOLD, now = 0) => firstStep(plan, content, view(dv), m, told, now)
  const started = { actionsDone: [{ id: 'a-read' }] }

  it('starts with an action, waits for a card that is near, and asks that it be read', () => {
    expect(step({}, map(), NOT_TOLD)).toEqual({ id: 'action', action: 'a-read' })
    const running = { actionsRunning: [{ id: 'a-talk', startedAtMs: 0, completesAtMs: 12_000 }] }
    expect(step(running, map(), NOT_TOLD, 2_000)).toEqual({ id: 'wait', action: 'a-talk', seconds: 10 })
    expect(step({ ...started, insights: [insight('a-read')] }, map(), NOT_TOLD)).toEqual({ id: 'card', action: 'a-read' })
    expect(step({ ...started, insights: [insight('a-read')] }, map(), TOLD)).toEqual({ id: 'place', worker: 'w-agent' })
  })
  it('does not wait for a card that is far away, or that will not come', () => {
    const long = { actionsRunning: [{ id: 'a-buy', startedAtMs: 0, completesAtMs: (WAIT_FOR_CARD_S + 30) * 1000 }] }
    expect(step(long, map(), NOT_TOLD).id).toBe('place')
    expect(step(started, map(), NOT_TOLD).id).toBe('place')
  })
  it('walks the agent through its model, its place and its prompt, with the choices there are now', () => {
    expect(step(started, map([T('t1', 'w-agent')]))).toEqual({ id: 'model', tile: 't1', choices: 2 })
    expect(step(started, map([T('t1', 'w-agent', 'm-large')]))).toEqual({ id: 'runsOn', tile: 't1', choices: 1 })
    expect(step(started, map([T('t1', 'w-agent', 'm-large', 'c-api')]), NOT_TOLD)).toEqual({ id: 'prompt', tile: 't1', choices: 2 })
    // A prompt that was chosen, and one that was kept, both end the step.
    expect(step(started, map([T('t1', 'w-agent', 'm-large', 'c-api', 'p-steps')]), NOT_TOLD).id).toBe('source')
    expect(step(started, map([T('t1', 'w-agent', 'm-large', 'c-api')]), { read: false, promptKept: true }).id).toBe('source')
  })
  it('asks for a source that is open, then the person, the handoff, the result and the validation', () => {
    const agent = T('t1', 'w-agent', 'm-large', 'c-api', 'p-line')
    expect(step(started, map([agent]))).toEqual({ id: 'source', tile: 't1', first: 's-order' })
    expect(step(started, map([agent], [['s-locked', 't1']])).id).toBe('source')
    expect(step(started, map([agent], [['s-order', 't1']]))).toEqual({ id: 'person', worker: 'w-signer' })
    const both = [agent, T('t2', 'w-signer')]
    expect(step(started, map(both, [['s-order', 't1']]))).toEqual({ id: 'handoff', from: 't1', to: 't2' })
    expect(step(started, map(both, [['s-order', 't1'], ['t1', 't2']]))).toEqual({ id: 'result', from: 't2' })
    expect(step(started, map(both, [['s-order', 't1'], ['t1', 't2'], ['t2', 'result']]))).toEqual({ id: 'validate' })
  })
  it('catches up with a player who went ahead, and goes back with one who took a step back', () => {
    const agent = T('t1', 'w-agent', 'm-large', 'c-api', 'p-line')
    // The person and the last line are there before the agent has anything to read.
    expect(step(started, map([agent, T('t2', 'w-signer')], [['t1', 't2'], ['t2', 'result']])).id).toBe('source')
    // The agent was taken off the map again.
    expect(step(started, map([T('t2', 'w-signer')], [['t2', 'result']])).id).toBe('place')
    // A validation ends it, whatever the map looks like.
    expect(step({ validating: { id: 'v1', startedAtMs: 0, completesAtMs: 1 } }, map(), NOT_TOLD).id).toBe('validating')
    expect(step({ validations: [{ free: true }] as View['validations'], validationsLeft: 6 }, map(), NOT_TOLD)).toEqual({ id: 'done', free: true, left: 6 })
  })
  it('joins the agent to the result when the pack has no person', () => {
    const alone = { ...plan, person: null }
    const m = map([T('t1', 'w-agent', 'm-large', 'c-api', 'p-line')], [['s-order', 't1']])
    expect(firstStep(alone, content, view(started), m, TOLD, 0)).toEqual({ id: 'result', from: 't1' })
  })
})

describe('the words of the guided first build', () => {
  it('counts in words and in the singular', () => {
    expect(count(2, 'model', 'models')).toBe('two models')
    expect(P2.first.model.choose(2)).toBe('You have two models for now. Pick the one you want. Keep learning and building, and more will show up here.')
    expect(P2.first.runsOn.choose(1)).toContain('You have one place to run it for now. Pick it.')
  })
  it('says that the first validation was free, and how many are left', () => {
    expect(P2.first.done.text(true, 6)).toBe('This validation was free. You still have six validations left. Keep going until you find the system you want.')
    expect(P2.first.done.text(false, 5)).toContain('That was your first validation. You still have five validations left.')
    expect(P2.first.validate.text(true)).toContain('This first one is free')
    expect(P2.usedOfFree(2, 6, 1)).toBe('2 of 6 validations used · the first one was free')
  })
  it('is written in whole sentences', () => {
    const all = [P2.first.action.text('x'), P2.first.wait.text(8), P2.first.card.text, P2.first.pick.text('x'), P2.first.cell.text('x'), P2.first.model.open('x'), P2.first.runsOn.open,
      P2.first.prompt.open, P2.first.prompt.choose(3), P2.first.source.from('x', 'y'), P2.first.source.to('x'), P2.first.person.pick('x'), P2.first.person.cell('x'),
      P2.first.handoff.from('x'), P2.first.handoff.to('x', 'y'), P2.first.result.from('x'), P2.first.result.to('y'), P2.first.validate.text(false), P2.first.validating.text, P2.first.done.more]
    for (const s of all) { expect(s).toMatch(/^[A-Z]/); expect(s).toMatch(/\.$/); expect(s).not.toMatch(/[:;–—]/) }
  })
})
