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
  it('can run Phases 1 and 2 and is provisional', () => {
    if (!r.ok) throw new Error('not ok')
    expect(r.pack.phasesAvailable.planning).toBe(true)
    expect(r.pack.phasesAvailable.development).toBe(true)
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
  ['a slide of boxes without boxes', 'teaching/deck.yaml', (t) => t.replace(/ {8}cards:\n( {10}- \{tag[^\n]*\n)+/, ''), /slides\[1\]\.cards/],
  ['a slide with a layout that does not exist', 'teaching/deck.yaml', (t) => t.replace('layout: title', 'layout: poster'), /slides\[0\]\.layout/],
  ['a photo that is not in the art folder', 'teaching/deck.yaml', (t) => t.replace('{name: Ada Brook, role: Moderator}', '{name: Ada Brook, role: Moderator, photo: people/ada.png}'), /people\[0\]\.photo/],
  ['a box of a health system the pack does not have', 'teaching/deck.yaml', (t) => t.replace('{system: rb, tag: Half of you', '{system: zz, tag: Half of you'), /cards\[0\]\.system/],
  ['a join code with a link of its own', 'teaching/deck.yaml', (t) => t.replace('qr: {show: join, label: Join with your phone}', 'qr: {show: join, url: "https://example.org"}'), /qr\.url/],
  ['a banter line by someone who is not in the system', `${RB}/story.yaml`, (t) => t.replace('{speaker: demo-mara, text: Who moved', '{speaker: demo-nobody, text: Who moved'), /banter\[0\]\.lines\[0\]\.speaker/],
  ['an exchange of one line', `${RB}/story.yaml`, (t) => t.replace(/ {6}- \{speaker: demo-tom, text: It was evidence[^\n]*\n/, ''), /banter\[0\]\.lines/],
  ['a letter variant for a band that does not exist', `${RB}/story.yaml`, (t) => t.replace('      empty: You sent', '      hollow: You sent'), /unknown band "hollow"/],
  // Phase 2: the canvas (section 12.3)
  ['an unlock of an item that does not exist', `${RB}/build.yaml`, (t) => t.replace('unlocks: [rb-s-mailbox]', 'unlocks: [rb-s-nowhere]'), /actions\[2\]\.unlocks\[0\].*unknown item "rb-s-nowhere"/],
  ['a model on a compute that does not exist', `${RB}/build.yaml`, (t) => t.replace('runs_on: [rb-c-rented, rb-c-owned]', 'runs_on: [rb-c-rented, rb-c-moon]'), /models\[2\]\.runs_on\[1\].*unknown compute "rb-c-moon"/],
  ['numbers for a model that does not exist', `${RB}/build.yaml`, (t) => t.replace('      rb-m-open:  {fetch: {easy: 0.94', '      rb-m-gone:  {fetch: {easy: 0.94'), /workers\[0\]\.by_model\.rb-m-gone.*unknown model/],
  ['a case that needs a fact no source gives', `${RB}/build.yaml`, (t) => t.replace('    gives: {rb-f-copies: 0.9, rb-f-terms: 1.0}', '    gives: {rb-f-copies: 0.9}').replace('gives: {rb-f-copies: 0.95, rb-f-terms: 0.6}', 'gives: {rb-f-copies: 0.95}'), /cases\[2\]\.needs\[2\].*no source gives fact "rb-f-terms"/],
  ['a person without a pool', `${RB}/build.yaml`, (t) => t.replace('    pool: librarian\n', ''), /workers\[4\]\.pool.*a person needs a pool/],
  ['a person without minutes', `${RB}/build.yaml`, (t) => t.replace('    minutes: {decide: 6, check: 2, per_line: {easy: 1, hard: 5, scan: 6}}\n', ''), /workers\[4\]\.minutes.*a person needs minutes/],
  ['an action that does nothing', `${RB}/build.yaml`, (t) => t.replace('    unlocks: [rb-m-open]\n', ''), /actions\[4\]: an action unlocks nothing and has no insight/],
  ['a reference map that is refused', `${RB}/build.yaml`, (t) => t.replace('        - {id: t2, kind: rb-w-librarian, col: 4, row: 2}', '        - {id: t2, kind: rb-w-librarian, col: 9, row: 2}'), /key\.reference\.map.*refused: off_grid/],
  ['a reference map that is not ready', `${RB}/build.yaml`, (t) => t.replace('    needs_actions: [rb-a-mailbox, rb-a-deal, rb-a-workshop]', '    needs_actions: [rb-a-mailbox, rb-a-workshop]'), /key\.reference\.map.*refused: bad_compute/],
  ['reference actions the budget cannot pay', `${RB}/build.yaml`, (t) => t.replace('budget: {money: 100, developers: 3}', 'budget: {money: 30, developers: 3}'), /needs_actions.*cost 50, the budget is 30/],
  ['an action in a group that does not exist', `${RB}/build.yaml`, (t) => t.replace('    group: negotiate', '    group: bargain'), /actions\[6\]\.group.*unknown group "bargain"/],
  ['a source with an effort that is not listed', `${RB}/build.yaml`, (t) => t.replace('    effort: scan', '    effort: smudge'), /sources\[5\]\.effort.*unknown effort "smudge"/],
  ['a worker without a number for a listed effort', `${RB}/build.yaml`, (t) => t.replace('{easy: 0.9, hard: 0.0, scan: 0.97}', '{easy: 0.9, hard: 0.0}'), /workers\[3\]\.quality\.fetch.*no number for the effort "scan"/],
  ['a person without minutes for a listed effort', `${RB}/build.yaml`, (t) => t.replace('per_line: {easy: 1, hard: 6, scan: 5}', 'per_line: {easy: 1, hard: 6}'), /workers\[5\]\.minutes\.per_line.*no minutes for the effort "scan"/],
  ['a worker in a toolbox group that does not exist', `${RB}/build.yaml`, (t) => t.replace('    group: tools\n    public:\n      label: Rule', '    group: gadgets\n    public:\n      label: Rule'), /workers\[2\]\.group.*unknown group "gadgets"/],
  ['a worker without a group when the toolbox has groups', `${RB}/build.yaml`, (t) => t.replace('    group: operators\n    public:\n      label: Agent', '    public:\n      label: Agent'), /workers\[0\]\.group.*needs a group/],
  ['column names that do not match the columns', `${RB}/build.yaml`, (t) => t.replace('    - {label: Check and send, hint: A last look before the patron gets the answer.}\n', ''), /grid\.columns.*3 column names for 4 columns/],
  ['a prompt without a sample', `${RB}/build.yaml`, (t) => t.replace('      sample: A single sentence', '      note_only: A single sentence').replace('      sample: Find the book in this request at a partner library and arrange the loan.\n', ''), /prompts\[0\]\.public.*needs sample or samples/],
  ['two items with one id', `${RB}/build.yaml`, (t) => t.replace('  - id: rb-c-owned', '  - id: rb-c-rented'), /compute\[3\]\.id.*used twice/],
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

  it('a pack without build.yaml still plays Phase 1, and one whose game.yaml is not on the canvas waits for it', () => {
    const dir = broken('game.yaml', (t) => t.replace('    board: canvas\n', ''))
    const r = loadPack(dir)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.pack.phasesAvailable).toMatchObject({ planning: true, development: false })
    expect(r.warnings.map((w) => w.path)).toContain('phases.development.board')
    rmSync(join(dir, 'systems/rb-riverbend/build.yaml'))
    rmSync(join(dir, 'systems/ls-lakeshore/build.yaml'))
    const none = loadPack(dir)
    expect(none.ok && none.pack.phasesAvailable).toMatchObject({ planning: true, development: false })
  })

  it('a rule the loader does not read yet is quiet, and a misspelling of it still warns', () => {
    const r = loadPack(broken('game.yaml', (t) => t.replace('version: 1', 'version: 1\nstatus: draft\ntiming_model: {a: 1}\nstatuss: draft')))
    expect(r.ok).toBe(true)
    expect(r.warnings.map((w) => w.path)).toEqual(['statuss'])
  })
})
