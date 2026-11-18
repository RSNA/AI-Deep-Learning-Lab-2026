// The loader on the demo pack, and a set of broken packs with one fault each (spec, 12.3).
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { loadPack, protectedStrings } from '../src/index.ts'

const DEMO = fileURLToPath(new URL('../../../content-demo', import.meta.url))
const tmp = mkdtempSync(join(tmpdir(), 'lab02-packs-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

let n = 0
function broken(file: string, edit: (text: string) => string): string {
  const dir = join(tmp, `p${n++}`)
  cpSync(DEMO, dir, { recursive: true })
  const path = join(dir, file)
  writeFileSync(path, edit(readFileSync(path, 'utf8')))
  return dir
}

describe('the demo pack', () => {
  const r = loadPack(DEMO)
  it('loads without errors or warnings', () => {
    expect(r.ok ? [] : r.errors).toEqual([])
    expect(r.warnings).toEqual([])
  })
  it('can run Phase 1 and is provisional', () => {
    if (!r.ok) throw new Error('not ok')
    expect(r.pack.phasesAvailable.planning).toBe(true)
    expect(r.pack.provisional).toBe(true)
    expect(Object.isFrozen(r.pack.game)).toBe(true)
  })
  it('has a stable hash that changes with the content', () => {
    if (!r.ok) throw new Error('not ok')
    const again = loadPack(DEMO)
    expect(again.ok && again.pack.hash).toBe(r.pack.hash)
    const other = loadPack(broken('game.yaml', (t) => t.replace('title: Branch Director', 'title: Branch Directors')))
    expect(other.ok && other.pack.hash).not.toBe(r.pack.hash)
  })
  it('restricts the health systems with SYSTEMS', () => {
    const one = loadPack(DEMO, { systems: ['ls'] })
    expect(one.ok && one.pack.systemIds).toEqual(['ls'])
    const bad = loadPack(DEMO, { systems: ['zz'] })
    expect(bad.ok).toBe(false)
  })
  it('lists protected strings with their moments', () => {
    if (!r.ok) throw new Error('not ok')
    const list = protectedStrings(r.pack)
    const rationale = r.pack.systems.rb!.problems![0]!.key.rationale
    expect(list.find((p) => p.text === rationale)?.from).toBe('planning.reveal')
    expect(list.find((p) => p.text === r.pack.game.sources['DEMO-1']!.gist)?.from).toBe('never')
  })
})

const RB = 'systems/rb-riverbend'
const cases: [string, string, (t: string) => string, RegExp][] = [
  ['a missing required field', 'game.yaml', (t) => t.replace('    candidates: 6\n', ''), /phases\.planning\.candidates/],
  ['a typo inside public', `${RB}/problems.yaml`, (t) => t.replace('    title: Holds pile up on Mondays', '    titel: Holds pile up on Mondays'), /\[0\]\.public/],
  ['an unknown character in a cast', `${RB}/system.yaml`, (t) => t.replace('cast: [demo-mara,', 'cast: [demo-nobody,'), /public\.cast\[0\]/],
  ['two flagships', `${RB}/problems.yaml`, (t) => t.replace('    flagship: false\n    rationale: The Monday', '    flagship: true\n    rationale: The Monday'), /exactly one problem/],
  ['the wrong number of problems', `${RB}/problems.yaml`, (t) => t.slice(0, t.indexOf('- id: rb-q-shelf')), /holds 5 problems/],
  ['seconds that do not match the level', `${RB}/insights.yaml`, (t) => t.replace('  bandwidth: 1\n  seconds: 10', '  bandwidth: 1\n  seconds: 25'), /\[0\]\.seconds/],
  ['a method on a level it may not use', `${RB}/insights.yaml`, (t) => t.replace('  method: interview\n  character: demo-mara', '  method: observation\n  character: demo-mara'), /\[0\]/],
  ['an unknown source', `${RB}/problems.yaml`, (t) => t.replace('source: [DEMO-1]', 'source: [NOPE-9]'), /unknown source/],
  ['an id without the system prefix', `${RB}/insights.yaml`, (t) => t.replace('- id: rb-look-mara', '- id: look-mara'), /must start with "rb-"/],
  ['a band gap', 'game.yaml', (t) => t.replace('{id: steady,      min: 400', '{id: steady,      min: 401'), /score_bands/],
  ['a YAML syntax error', 'characters.yaml', (t) => `${t}\n  - : [`, /does not parse/],
  ['an assignment that does not exist', 'game.yaml', (t) => t.replace('assignment: balanced', 'assignment: random'), /join\.assignment/],
  // The classes of Phase 1 (section 12.3)
  ['a class that disagrees with the tier', `${RB}/problems.yaml`, (t) => t.replace('    class: single_model\n    tier: 4', '    class: no_ai\n    tier: 4'), /\[2\]\.key\.class.*does not cover rung 4/],
  ['a mix that the problems do not match', `${RB}/problems.yaml`, (t) => t.replace('    real: false\n    class: not_real\n    tier: null', '    real: true\n    class: no_ai\n    tier: 2'), /class_mix asks for/],
  ['a capacity that differs from its share', 'game.yaml', (t) => t.replace('        rungs: [3, 4]\n        capacity: 1', '        rungs: [3, 4]\n        capacity: 2'), /classes\[2\]\.capacity/],
  ['a class without a capacity', 'game.yaml', (t) => t.replace('        rungs: [3, 4]\n        capacity: 1\n', '        rungs: [3, 4]\n'), /classes\[2\]\.capacity/],
  ['a rung that no class covers', 'game.yaml', (t) => t.replace('rungs: [3, 4]', 'rungs: [3]'), /rung 4 must belong to exactly one class/],
  ['a flagship outside the flagship class', `${RB}/problems.yaml`, (t) => t.replace('    flagship: false\n    rationale: Answers come', '    flagship: true\n    rationale: Answers come').replace('    flagship: true\n    rationale: Each request', '    flagship: false\n    rationale: Each request'), /flagship must be in the flagship class/],
  ['an unknown class in the order', 'game.yaml', (t) => t.replace('class_order: [not_real, no_ai, single_model, agentic]', 'class_order: [not_real, no_ai, one_model, agentic]'), /unknown class "one_model"/],
  ['a flagship class that is not last', 'game.yaml', (t) => t.replace('class_order: [not_real, no_ai, single_model, agentic]', 'class_order: [not_real, no_ai, agentic, single_model]'), /must come last/],
  ['a live column that does not exist', 'game.yaml', (t) => t.replace('metric: progress', 'metric: points'), /live_leaderboard\.metric/],
  // Round 8: the deck, banter, the empty letter
  ['a deck section at a stage that does not exist', 'teaching/deck.yaml', (t) => t.replace('    stage: intro', '    stage: opening'), /sections\[0\]\.stage.*unknown stage "opening"/],
  ['a deck section at a play stage', 'teaching/deck.yaml', (t) => t.replace('    stage: intro', '    stage: planning.play'), /sections\[0\]\.stage.*unknown stage "planning\.play"/],
  ['two deck sections at one stage', 'teaching/deck.yaml', (t) => t.replace('    stage: break.development', '    stage: break.planning'), /two sections open at "break\.planning"/],
  ['a deck section without slides', 'teaching/deck.yaml', (t) => t.replace(/ {2}- id: closing\n {4}title: Reflection\n {4}stage: reflection\n {4}slides:[\s\S]*$/, '  - id: closing\n    title: Reflection\n    stage: reflection\n    slides: []\n'), /sections\[4\]\.slides/],
  ['a slide image that does not exist', 'teaching/deck.yaml', (t) => t.replace('        notes: Keep this short.', '        image: slides/none.png\n        notes: Keep this short.'), /art\/slides\/none\.png does not exist/],
  ['a live statistic that does not exist', 'teaching/deck.yaml', (t) => t.replace('live_stat: flagship_hit_rate', 'live_stat: players'), /live_stat/],
  ['an empty-letter line below more problems than there are', 'game.yaml', (t) => t.replace('submission: {letter_empty_below: 2}', 'submission: {letter_empty_below: 7}'), /letter_empty_below.*between 0 and the 6 candidates/],
  ['a hair style outside the four', 'characters.yaml', (t) => t.replace('hair_style: long, skin: light', 'hair_style: mohawk, skin: light'), /\[0\]\.look\.hair_style/],
  ['two slides with one id', 'teaching/deck.yaml', (t) => t.replace('      - id: welcome-2', '      - id: welcome-1'), /duplicate id "welcome-1"|welcome-1/],
  ['a slide without bullets', 'teaching/deck.yaml', (t) => t.replace(/ {8}bullets:\n {10}- Each of you[^\n]*\n {10}- Two library[^\n]*\n/, ''), /slides\[0\]\.bullets/],
  ['a banter line by someone who is not in the system', `${RB}/story.yaml`, (t) => t.replace('{speaker: demo-mara, text: Who moved', '{speaker: demo-nobody, text: Who moved'), /banter\[0\]\.lines\[0\]\.speaker/],
  ['an exchange of one line', `${RB}/story.yaml`, (t) => t.replace(/ {6}- \{speaker: demo-tom, text: It was evidence[^\n]*\n/, ''), /banter\[0\]\.lines/],
  ['a letter variant for a band that does not exist', `${RB}/story.yaml`, (t) => t.replace('      empty: You sent', '      hollow: You sent'), /unknown band "hollow"/],
]

describe('broken packs fail with the right path', () => {
  for (const [name, file, edit, pattern] of cases) {
    it(name, () => {
      const r = loadPack(broken(file, edit))
      expect(r.ok).toBe(false)
      if (r.ok) return
      const text = r.errors.map((e) => `${e.file} ${e.path}: ${e.message}`).join('\n')
      expect(text).toMatch(pattern)
    })
  }

  it('a person with fewer than three click lines, or no look, is a warning', () => {
    const r = loadPack(broken('characters.yaml', (t) => t.replace(/ {2}look: \{hair: auburn[^\n]*\n/, '').replace(/ {4}- If it beeps[^\n]*\n/, '')))
    expect(r.ok).toBe(true)
    expect(r.warnings.map((w) => w.path)).toEqual(expect.arrayContaining(['[0].look', '[0].click_lines']))
  })

  it('an unknown field outside the strict areas is a warning, not an error', () => {
    const r = loadPack(broken('game.yaml', (t) => t.replace('version: 1', 'version: 1\nauthor_note: hello')))
    expect(r.ok).toBe(true)
    expect(r.warnings.map((w) => w.path)).toContain('author_note')
  })
})
