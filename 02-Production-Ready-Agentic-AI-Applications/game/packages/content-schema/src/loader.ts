// The pack loader (engineering spec, section 5.4): parse, validate in three layers, hash, freeze.
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { z } from 'zod'
import {
  BuildFile, CharactersFile, GameFile, HelpSlidesFile, InsightsFile, MaintainFile, MonitorsFile,
  PaletteFile, PHASES, ProblemsFile, ReportCardFile, StoryFile, SystemFile, setCollectWarnings,
  type Condition, type PhaseId,
} from './schema.ts'

export type Issue = { file: string; path: string; message: string }

export type SystemPack = {
  readonly id: string
  readonly folder: string
  readonly system: SystemFile
  readonly problems: ProblemsFile | null
  readonly insights: InsightsFile | null
  readonly build: BuildFile | null
  readonly maintain: MaintainFile | null
  readonly story: StoryFile | null
}

export type Pack = {
  readonly dir: string
  readonly hash: string
  readonly game: GameFile
  readonly palette: PaletteFile | null
  readonly monitors: MonitorsFile | null
  readonly characters: CharactersFile
  /** Health systems in play, in the order of `game.health_systems`. */
  readonly systemIds: readonly string[]
  readonly systems: Readonly<Record<string, SystemPack>>
  readonly helpSlides: HelpSlidesFile | null
  readonly reportCard: ReportCardFile | null
  readonly phasesAvailable: Readonly<Record<PhaseId, boolean>>
  /** Files under `art/`, relative to it. */
  readonly artFiles: readonly string[]
  /** Whether any health system in play has a provisional or missing anchor. */
  readonly provisional: boolean
}

export type LoadOptions = {
  /** Load only these health systems (a play check while the pack is incomplete). */
  systems?: string[]
}

export type LoadResult =
  | { ok: true; pack: Pack; warnings: Issue[] }
  | { ok: false; errors: Issue[]; warnings: Issue[] }

// ------------------------------------------------------------------------------------------
// Reading files
// ------------------------------------------------------------------------------------------
type Ctx = { dir: string; errors: Issue[]; warnings: Issue[]; raw: Record<string, unknown> }

function readYaml(ctx: Ctx, rel: string, required: boolean): unknown {
  const path = join(ctx.dir, rel)
  if (!existsSync(path)) {
    if (required) ctx.errors.push({ file: rel, path: '', message: 'file is missing' })
    return undefined
  }
  try {
    const value: unknown = parseYaml(readFileSync(path, 'utf8'))
    ctx.raw[rel] = value
    return value
  } catch (err) {
    ctx.errors.push({ file: rel, path: '', message: `YAML does not parse: ${(err as Error).message}` })
    return undefined
  }
}

function pathOf(p: readonly PropertyKey[]): string {
  return p.map((k) => (typeof k === 'number' ? `[${k}]` : `.${String(k)}`)).join('').replace(/^\./, '')
}

function validate<T extends z.ZodType>(ctx: Ctx, rel: string, schema: T, value: unknown): z.infer<T> | null {
  if (value === undefined) return null
  setCollectWarnings(true)
  const first = schema.safeParse(value)
  setCollectWarnings(false)
  if (first.success) return first.data
  let hardErrors = 0
  for (const issue of first.error.issues) {
    const params = (issue as { params?: { warning?: boolean } }).params
    if (params?.warning) ctx.warnings.push({ file: rel, path: pathOf(issue.path), message: issue.message })
    else {
      hardErrors++
      ctx.errors.push({ file: rel, path: pathOf(issue.path), message: issue.message })
    }
  }
  if (hardErrors > 0) return null
  const second = schema.safeParse(value)
  return second.success ? second.data : null
}

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      if (name.startsWith('.')) continue
      const full = join(d, name)
      if (statSync(full).isDirectory()) walk(full)
      else out.push(relative(dir, full))
    }
  }
  walk(dir)
  return out
}

// ------------------------------------------------------------------------------------------
// Canonical hash
// ------------------------------------------------------------------------------------------
function canonical(x: unknown): string {
  if (x === null || typeof x !== 'object') return JSON.stringify(x) ?? 'null'
  if (Array.isArray(x)) return `[${x.map(canonical).join(',')}]`
  const keys = Object.keys(x as object).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical((x as Record<string, unknown>)[k])}`).join(',')}}`
}

export function contentHash(raw: Record<string, unknown>): string {
  return createHash('sha256').update(canonical(raw)).digest('hex')
}

function deepFreeze<T>(x: T): T {
  if (x && typeof x === 'object' && !Object.isFrozen(x)) {
    Object.freeze(x)
    for (const v of Object.values(x as object)) deepFreeze(v)
  }
  return x
}

// ------------------------------------------------------------------------------------------
// Loading
// ------------------------------------------------------------------------------------------
export function loadPack(dir: string, opts: LoadOptions = {}): LoadResult {
  const ctx: Ctx = { dir, errors: [], warnings: [], raw: {} }
  if (!existsSync(dir)) {
    return { ok: false, errors: [{ file: '', path: '', message: `pack folder not found: ${dir}` }], warnings: [] }
  }

  const game = validate(ctx, 'game.yaml', GameFile, readYaml(ctx, 'game.yaml', true))
  const characters = validate(ctx, 'characters.yaml', CharactersFile, readYaml(ctx, 'characters.yaml', true))
  const palette = validate(ctx, 'palette.yaml', PaletteFile, readYaml(ctx, 'palette.yaml', false))
  const monitors = validate(ctx, 'monitors.yaml', MonitorsFile, readYaml(ctx, 'monitors.yaml', false))
  const helpSlides = validate(ctx, 'teaching/help-slides.yaml', HelpSlidesFile, readYaml(ctx, 'teaching/help-slides.yaml', false))
  const reportCard = validate(ctx, 'teaching/report-card.yaml', ReportCardFile, readYaml(ctx, 'teaching/report-card.yaml', false))

  if (!game) return { ok: false, errors: ctx.errors, warnings: ctx.warnings }

  // Which health systems are in play.
  let systemIds = [...game.game.health_systems]
  if (opts.systems && opts.systems.length > 0) {
    for (const s of opts.systems) {
      if (!systemIds.includes(s)) ctx.errors.push({ file: 'game.yaml', path: 'game.health_systems', message: `SYSTEMS names "${s}", which the pack does not list` })
    }
    systemIds = systemIds.filter((s) => opts.systems!.includes(s))
  }

  // Health system folders: systems/<id>-<slug>/
  const systemsDir = join(dir, 'systems')
  const folders = existsSync(systemsDir) ? readdirSync(systemsDir).filter((n) => statSync(join(systemsDir, n)).isDirectory()).sort() : []
  const systems: Record<string, SystemPack> = {}
  for (const id of systemIds) {
    const folder = folders.find((f) => f === id || f.startsWith(`${id}-`))
    if (!folder) {
      ctx.errors.push({ file: `systems/${id}-*/system.yaml`, path: '', message: `health system "${id}" has no folder` })
      continue
    }
    const base = `systems/${folder}`
    const system = validate(ctx, `${base}/system.yaml`, SystemFile, readYaml(ctx, `${base}/system.yaml`, true))
    if (!system) continue
    systems[id] = {
      id, folder: base, system,
      problems: validate(ctx, `${base}/problems.yaml`, ProblemsFile, readYaml(ctx, `${base}/problems.yaml`, false)),
      insights: validate(ctx, `${base}/insights.yaml`, InsightsFile, readYaml(ctx, `${base}/insights.yaml`, false)),
      build: validate(ctx, `${base}/build.yaml`, BuildFile, readYaml(ctx, `${base}/build.yaml`, false)),
      maintain: validate(ctx, `${base}/maintain.yaml`, MaintainFile, readYaml(ctx, `${base}/maintain.yaml`, false)),
      story: validate(ctx, `${base}/story.yaml`, StoryFile, readYaml(ctx, `${base}/story.yaml`, false)),
    }
  }
  // Folders of systems that are not in play are still read for the hash, never validated.
  for (const f of folders) {
    if (Object.values(systems).some((s) => s.folder === `systems/${f}`)) continue
    for (const name of ['system', 'problems', 'insights', 'build', 'maintain', 'story']) {
      readYaml(ctx, `systems/${f}/${name}.yaml`, false)
    }
  }

  if (ctx.errors.length === 0 && characters) {
    checkReferences(ctx, game, characters, palette, monitors, systems, systemIds, helpSlides, reportCard)
    checkCounts(ctx, game, systems)
  }
  if (ctx.errors.length > 0 || !characters) return { ok: false, errors: ctx.errors, warnings: ctx.warnings }

  const all = (f: (s: SystemPack) => unknown) => systemIds.every((id) => systems[id] && f(systems[id]))
  const phasesAvailable: Record<PhaseId, boolean> = {
    planning: all((s) => s.problems && s.insights),
    development: !!palette && all((s) => s.build),
    maintaining: !!monitors && all((s) => s.maintain),
  }
  const provisional = systemIds.some((id) =>
    PHASES.some((p) => {
      const c = systems[id]!.system.calibration[p]
      return c.provisional || c.zero === null || c.floor === null || c.ceiling === null
    }))

  const pack: Pack = {
    dir, hash: contentHash(ctx.raw), game, palette, monitors, characters,
    systemIds, systems, helpSlides, reportCard, phasesAvailable,
    artFiles: listFiles(join(dir, 'art')), provisional,
  }
  return { ok: true, pack: deepFreeze(pack), warnings: ctx.warnings }
}

// ------------------------------------------------------------------------------------------
// Layer 2: references
// ------------------------------------------------------------------------------------------
function checkReferences(
  ctx: Ctx, game: GameFile, characters: CharactersFile, palette: PaletteFile | null,
  monitors: MonitorsFile | null, systems: Record<string, SystemPack>, systemIds: string[],
  helpSlides: HelpSlidesFile | null, reportCard: ReportCardFile | null,
) {
  const err = (file: string, path: string, message: string) => ctx.errors.push({ file, path, message })
  const allSystems = game.game.health_systems
  const seen = new Map<string, string>()
  const unique = (id: string, file: string, path: string) => {
    const prev = seen.get(id)
    if (prev) err(file, path, `id "${id}" is used twice (also in ${prev})`)
    else seen.set(id, `${file} ${path}`)
  }

  for (const s of game.join.tie_order) if (!allSystems.includes(s)) err('game.yaml', 'join.tie_order', `unknown health system "${s}"`)
  for (const s of allSystems) if (!game.join.tie_order.includes(s)) err('game.yaml', 'join.tie_order', `health system "${s}" is missing`)

  const charIds = new Map<string, string>()
  characters.forEach((c, i) => {
    unique(c.id, 'characters.yaml', `[${i}].id`)
    charIds.set(c.id, c.system)
    if (c.system !== 'all' && !allSystems.includes(c.system)) err('characters.yaml', `[${i}].system`, `unknown health system "${c.system}"`)
  })
  const charOk = (id: string, sys: string) => charIds.has(id) && (charIds.get(id) === 'all' || charIds.get(id) === sys)

  const componentIds = new Set((palette?.components ?? []).map((c) => c.id))
  palette?.components.forEach((c, i) => {
    unique(c.id, 'palette.yaml', `components[${i}].id`)
    if (c.id === 'empty' || c.id === 'n/a') err('palette.yaml', `components[${i}].id`, `"${c.id}" is reserved`)
  })
  const monitorIds = new Set((monitors?.monitors ?? []).map((m) => m.id))
  monitors?.monitors.forEach((m, i) => unique(m.id, 'monitors.yaml', `monitors[${i}].id`))

  for (const sid of systemIds) {
    const sp = systems[sid]
    if (!sp) continue
    const f = (name: string) => `${sp.folder}/${name}.yaml`
    const sys = sp.system
    if (sys.id !== sid) err(f('system'), 'id', `id "${sys.id}" does not match the folder of health system "${sid}"`)
    // The slug may carry the id already (b-community) or not (community).
    const okFolders = [`systems/${sid}-${sys.slug}`, `systems/${sys.slug}`, `systems/${sid}`]
    if (!okFolders.includes(sp.folder) || (sp.folder === `systems/${sys.slug}` && !sys.slug.startsWith(`${sid}-`))) {
      err(f('system'), 'slug', `the folder should be systems/${sid}-${sys.slug}`)
    }
    sys.public.cast.forEach((c, i) => { if (!charOk(c, sid)) err(f('system'), `public.cast[${i}]`, `unknown character "${c}" for this health system`) })
    const prefixed = (id: string, file: string, path: string) => {
      if (!id.startsWith(`${sid}-`)) err(file, path, `id "${id}" must start with "${sid}-"`)
      unique(id, file, path)
    }

    const problemIds = new Set<string>()
    if (sp.problems) {
      const flagships = sp.problems.filter((p) => p.key.flagship)
      sp.problems.forEach((p, i) => {
        prefixed(p.id, f('problems'), `[${i}].id`)
        problemIds.add(p.id)
        if (p.key.real && p.key.tier === null) err(f('problems'), `[${i}].key.tier`, 'a real problem needs a tier')
        if (!p.key.real && p.key.tier !== null) err(f('problems'), `[${i}].key.tier`, 'a problem that is not real has tier null')
      })
      if (flagships.length !== 1) err(f('problems'), '', `exactly one problem must be the flagship, found ${flagships.length}`)
      else {
        const fl = flagships[0]!
        if (!fl.key.real) err(f('problems'), '', `the flagship "${fl.id}" must be real`)
        if (fl.id !== sys.key.flagship_problem) err(f('system'), 'key.flagship_problem', `must equal the flagship of problems.yaml, "${fl.id}"`)
      }
    }
    if (sp.insights) {
      sp.insights.forEach((inv, i) => {
        prefixed(inv.id, f('insights'), `[${i}].id`)
        if (inv.method === 'interview') {
          if (!inv.character) err(f('insights'), `[${i}].character`, 'an interview needs a character')
          if (inv.tile.type !== 'quote') err(f('insights'), `[${i}].tile.type`, 'an interview gives a quote tile')
        }
        if (inv.character && !charOk(inv.character, sid)) err(f('insights'), `[${i}].character`, `unknown character "${inv.character}"`)
        if (inv.tile.type === 'quote' && !charOk(inv.tile.data.speaker, sid)) err(f('insights'), `[${i}].tile.data.speaker`, `unknown character "${inv.tile.data.speaker}"`)
      })
    }
    if (sp.build) checkBuild(ctx, f('build'), sp.build, componentIds, problemIds, prefixed)
    if (sp.maintain) checkMaintain(ctx, f('maintain'), sp.maintain, monitorIds, prefixed)
    if (sp.story) {
      const st = sp.story
      const insightIds = new Set((sp.insights ?? []).map((x) => x.id))
      const eventIds = new Set((sp.maintain?.events ?? []).map((x) => x.id))
      const caseIds = new Set((sp.build?.cases ?? []).map((x) => x.id))
      const offerIds = new Set((sp.build?.offers ?? []).map((x) => x.id))
      for (const [phase, b] of Object.entries((st.briefs ?? {}) as Record<string, { from: string } | undefined>)) if (b && !charOk(b.from, sid)) err(f('story'), `briefs.${phase}.from`, `unknown character "${b.from}"`)
      for (const [k, l] of Object.entries((st.letters ?? {}) as Record<string, { from: string; variants: Record<string, string> } | undefined>)) {
        if (!l) continue
        if (!charOk(l.from, sid)) err(f('story'), `letters.${k}.from`, `unknown character "${l.from}"`)
        for (const band of Object.keys(l.variants)) if (!game.scoring.score_bands.some((b) => b.id === band)) err(f('story'), `letters.${k}.variants.${band}`, `unknown band "${band}"`)
      }
      st.dialogue?.forEach((d, i) => {
        prefixed(d.id, f('story'), `dialogue[${i}].id`)
        if (!charOk(d.speaker, sid)) err(f('story'), `dialogue[${i}].speaker`, `unknown character "${d.speaker}"`)
        const [on, ref] = d.trigger.on.split(':') as [string, string | undefined]
        if (on === 'insight' && !insightIds.has(ref!)) err(f('story'), `dialogue[${i}].trigger.on`, `unknown investigation "${ref}"`)
        if (on === 'event' && !eventIds.has(ref!)) err(f('story'), `dialogue[${i}].trigger.on`, `unknown event "${ref}"`)
        if (on === 'trace' && !caseIds.has(ref!)) err(f('story'), `dialogue[${i}].trigger.on`, `unknown case "${ref}"`)
      })
      st.announcements?.forEach((a, i) => {
        prefixed(a.id, f('story'), `announcements[${i}].id`)
        if (!charOk(a.from, sid)) err(f('story'), `announcements[${i}].from`, `unknown character "${a.from}"`)
        if (a.offer && !offerIds.has(a.offer)) err(f('story'), `announcements[${i}].offer`, `unknown offer "${a.offer}"`)
      })
    }
  }

  if (helpSlides) Object.entries(helpSlides.breaks as Record<string, { id: string }[] | undefined>).forEach(([k, slides]) => slides?.forEach((s, i) => unique(s.id, 'teaching/help-slides.yaml', `breaks.${k}[${i}].id`)))
  reportCard?.sections.forEach((s, i) => unique(s.id, 'teaching/report-card.yaml', `sections[${i}].id`))

  // Every `source` list names ids of the source registry.
  const walkSources = (file: string, x: unknown, path: string) => {
    if (Array.isArray(x)) x.forEach((v, i) => walkSources(file, v, `${path}[${i}]`))
    else if (x && typeof x === 'object') {
      for (const [k, v] of Object.entries(x)) {
        if (k === 'source' && Array.isArray(v)) {
          v.forEach((s, i) => { if (typeof s === 'string' && !(s in game.sources)) err(file, `${path}.source[${i}]`.replace(/^\./, ''), `unknown source "${s}"`) })
        } else walkSources(file, v, `${path}.${k}`)
      }
    }
  }
  for (const [file, value] of Object.entries(ctx.raw)) walkSources(file, value, '')
  for (const paper of new Set(Object.values(game.sources).map((s) => s.paper))) {
    if (!(paper in game.public_source_labels)) err('game.yaml', 'public_source_labels', `no label for paper "${paper}"`)
  }
}

function checkBuild(
  ctx: Ctx, file: string, b: BuildFile, componentIds: Set<string>, problemIds: Set<string>,
  prefixed: (id: string, file: string, path: string) => void,
) {
  const err = (path: string, message: string) => ctx.errors.push({ file, path, message })
  if (!problemIds.has(b.problem)) err('problem', `unknown problem "${b.problem}"`)
  const choices = new Map<string, Set<string>>()
  const offerIds = new Set((b.offers ?? []).map((o) => o.id))
  b.choices.forEach((c, i) => {
    if (choices.has(c.id)) err(`choices[${i}].id`, `choice "${c.id}" is listed twice`)
    if (c.kind === 'slot') {
      const opts = new Set<string>(['empty'])
      c.options.forEach((o, j) => {
        if (o.component !== 'empty' && !componentIds.has(o.component)) err(`choices[${i}].options[${j}].component`, `unknown component "${o.component}"`)
        if (o.requires_offer && !offerIds.has(o.requires_offer)) err(`choices[${i}].options[${j}].requires_offer`, `unknown offer "${o.requires_offer}"`)
        opts.add(o.component)
      })
      choices.set(c.id, opts)
    } else {
      const opts = new Set(c.options.map((o) => o.id))
      if (!opts.has(c.default)) err(`choices[${i}].default`, `"${c.default}" is not one of the options`)
      c.options.forEach((o, j) => { if (o.requires_offer && !offerIds.has(o.requires_offer)) err(`choices[${i}].options[${j}].requires_offer`, `unknown offer "${o.requires_offer}"`) })
      choices.set(c.id, opts)
    }
  })
  const nodeIds = new Set(b.board.nodes.map((n) => n.id))
  b.board.flow.forEach((id, i) => { if (!nodeIds.has(id) && !choices.has(id)) err(`board.flow[${i}]`, `unknown node or slot "${id}"`) })
  b.board.links?.forEach(([a, z], i) => {
    for (const id of [a, z]) if (!nodeIds.has(id) && !choices.has(id)) err(`board.links[${i}]`, `unknown node or slot "${id}"`)
  })
  const cond = (c: Condition, path: string) => {
    if (c.choice !== undefined) {
      const opts = choices.get(c.choice)
      if (!opts) err(path, `unknown choice "${c.choice}"`)
      else for (const o of [...(c.is ?? []), ...(c.is_not ?? [])]) if (o !== 'n/a' && !opts.has(o)) err(path, `choice "${c.choice}" has no option "${o}"`)
    }
    if (c.has_offer !== undefined && !offerIds.has(c.has_offer)) err(path, `unknown offer "${c.has_offer}"`)
    c.all?.forEach((x, i) => cond(x, `${path}.all[${i}]`))
    c.any?.forEach((x, i) => cond(x, `${path}.any[${i}]`))
    if (c.not) cond(c.not, `${path}.not`)
  }
  b.choices.forEach((c, i) => { if (c.kind !== 'slot' && c.applies_when) cond(c.applies_when, `choices[${i}].applies_when`) })
  b.rules?.forEach((r, i) => { prefixed(r.id, file, `rules[${i}].id`); cond(r.when, `rules[${i}].when`) })
  b.advisories?.forEach((a, i) => cond(a.when, `advisories[${i}].when`))
  b.cases.forEach((c, i) => {
    prefixed(c.id, file, `cases[${i}].id`)
    c.fails_when?.forEach((f, j) => cond(f.when, `cases[${i}].fails_when[${j}].when`))
    c.extra_cost?.forEach((e, j) => cond(e.when, `cases[${i}].extra_cost[${j}].when`))
  })
  b.offers?.forEach((o, i) => prefixed(o.id, file, `offers[${i}].id`))
  const design = (d: Record<string, string>, path: string) => {
    for (const [ch, opt] of Object.entries(d)) {
      const opts = choices.get(ch)
      if (!opts) err(path, `unknown choice "${ch}"`)
      else if (opt !== 'n/a' && !opts.has(opt)) err(path, `choice "${ch}" has no option "${opt}"`)
    }
  }
  design(b.key.reference.design, 'key.reference.design')
  b.key.traps?.forEach((t, i) => design(t.design, `key.traps[${i}].design`))
}

function checkMaintain(
  ctx: Ctx, file: string, m: MaintainFile, monitorIds: Set<string>,
  prefixed: (id: string, file: string, path: string) => void,
) {
  const err = (path: string, message: string) => ctx.errors.push({ file, path, message })
  const eventIds = new Set(m.events.map((e) => e.id))
  const evRefs = (ids: string[] | undefined, path: string) => ids?.forEach((id) => { if (!eventIds.has(id)) err(path, `unknown event "${id}"`) })
  const mon = (id: string | null | undefined, path: string) => { if (id && !monitorIds.has(id)) err(path, `unknown monitor "${id}"`) }
  for (const id of Object.keys(m.monitors ?? {})) mon(id, `monitors.${id}`)
  m.actions.forEach((a, i) => {
    prefixed(a.id, file, `actions[${i}].id`)
    evRefs(a.reveals, `actions[${i}].reveals`); evRefs(a.arms, `actions[${i}].arms`); evRefs(a.disarms, `actions[${i}].disarms`)
  })
  m.events.forEach((e, i) => {
    prefixed(e.id, file, `events[${i}].id`)
    e.detect.monitors?.forEach((id, j) => mon(id, `events[${i}].detect.monitors[${j}]`))
    if (!e.options.some((o) => o.id === e.default_option)) err(`events[${i}].default_option`, `"${e.default_option}" is not one of the options`)
    e.options.forEach((o, j) => {
      mon(o.requires_monitor, `events[${i}].options[${j}].requires_monitor`)
      mon(o.grants_monitor, `events[${i}].options[${j}].grants_monitor`)
      evRefs(o.arms, `events[${i}].options[${j}].arms`); evRefs(o.disarms, `events[${i}].options[${j}].disarms`)
    })
  })
}

// ------------------------------------------------------------------------------------------
// Layer 3: counts from game.yaml
// ------------------------------------------------------------------------------------------
function checkCounts(ctx: Ctx, game: GameFile, systems: Record<string, SystemPack>) {
  const err = (file: string, path: string, message: string) => ctx.errors.push({ file, path, message })
  const pl = game.phases.planning
  const inv = pl.investigations

  // Global consistency
  game.ladder.forEach((r, i) => { if (r.rung !== i + 1) err('game.yaml', `ladder[${i}].rung`, `rungs must run 1 to 5 in order`) })
  if (pl.report_slots > pl.candidates) err('game.yaml', 'phases.planning.report_slots', 'more slots than candidates')
  if (pl.agent_rung_capacity > pl.report_slots) err('game.yaml', 'phases.planning.agent_rung_capacity', 'more than the report slots')
  const levels = new Map(inv.levels.map((l) => [l.bandwidth, l.seconds]))
  if (levels.size !== inv.levels.length) err('game.yaml', 'phases.planning.investigations.levels', 'two levels share a bandwidth')
  for (const l of inv.levels) if (l.bandwidth > inv.bandwidth) err('game.yaml', 'phases.planning.investigations.levels', `level ${l.bandwidth} is above the bandwidth`)
  for (const [m, ls] of Object.entries(inv.method_levels)) for (const b of ls ?? []) if (!levels.has(b)) err('game.yaml', `phases.planning.investigations.method_levels.${m}`, `no level with bandwidth ${b}`)
  if (inv.total_work.min > inv.total_work.max) err('game.yaml', 'phases.planning.investigations.total_work', 'min is above max')
  const bands = [...game.scoring.score_bands].sort((a, b) => a.min - b.min)
  let next = 0
  for (const b of bands) {
    if (b.min !== next) err('game.yaml', 'scoring.score_bands', `bands must cover 0 to ${game.scoring.normalization.max_points} without gaps (gap or overlap at ${b.min})`)
    next = b.max + 1
  }
  if (next - 1 < game.scoring.normalization.max_points) err('game.yaml', 'scoring.score_bands', `bands stop at ${next - 1}`)
  const until = game.join.late_join.open_until
  if (until.month !== undefined && until.phase !== 'maintaining') err('game.yaml', 'join.late_join.open_until.month', 'a month applies only to maintaining')
  const dev = game.phases.development
  if (dev.offers.per_system > dev.offers.announce_at_seconds.length) err('game.yaml', 'phases.development.offers', 'more offers than announcement times')

  for (const sp of Object.values(systems)) {
    const f = (name: string) => `${sp.folder}/${name}.yaml`
    if (sp.problems && sp.problems.length !== pl.candidates) err(f('problems'), '', `holds ${sp.problems.length} problems, game.yaml asks for ${pl.candidates}`)
    if (sp.insights) {
      if (sp.insights.length !== inv.per_system) err(f('insights'), '', `holds ${sp.insights.length} investigations, game.yaml asks for ${inv.per_system}`)
      let work = 0
      sp.insights.forEach((x, i) => {
        const secs = levels.get(x.bandwidth)
        if (secs === undefined) err(f('insights'), `[${i}].bandwidth`, `no level with bandwidth ${x.bandwidth}`)
        else if (secs !== x.seconds) err(f('insights'), `[${i}].seconds`, `bandwidth ${x.bandwidth} takes ${secs} seconds, not ${x.seconds}`)
        if (!(inv.method_levels[x.method] ?? []).includes(x.bandwidth)) err(f('insights'), `[${i}].bandwidth`, `a ${x.method} may not use bandwidth ${x.bandwidth}`)
        work += x.bandwidth * x.seconds
      })
      if (work < inv.total_work.min || work > inv.total_work.max) err(f('insights'), '', `total work ${work} lies outside ${inv.total_work.min} to ${inv.total_work.max}`)
    }
    if (sp.build) {
      const n = sp.build.offers?.length ?? 0
      if (n !== dev.offers.per_system) err(f('build'), 'offers', `holds ${n} offers, game.yaml asks for ${dev.offers.per_system}`)
      sp.build.offers?.forEach((o, i) => { if (o.index > dev.offers.announce_at_seconds.length) err(f('build'), `offers[${i}].index`, `no announcement time ${o.index}`) })
    }
  }
}
