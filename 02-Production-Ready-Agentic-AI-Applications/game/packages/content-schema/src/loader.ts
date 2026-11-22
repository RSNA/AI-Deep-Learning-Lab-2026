// The pack loader (engineering spec, section 5.4): parse, validate in three layers, hash, freeze.
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { z } from 'zod'
import {
  BuildFile, CharactersFile, DeckFile, GameFile, InsightsFile, MaintainFile, MonitorsFile,
  PHASES, ProblemsFile, ReportCardFile, StoryFile, SystemFile, setCollectWarnings,
  type PhaseId,
} from './schema.ts'
import { checkBuild } from './build-check.ts'

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
  readonly monitors: MonitorsFile | null
  readonly characters: CharactersFile
  /** Health systems in play, in the order of `game.health_systems`. */
  readonly systemIds: readonly string[]
  readonly systems: Readonly<Record<string, SystemPack>>
  /** The deck of the session (teaching/deck.yaml), or null. */
  readonly deck: DeckFile | null
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
  const monitors = validate(ctx, 'monitors.yaml', MonitorsFile, readYaml(ctx, 'monitors.yaml', false))
  const deck = validate(ctx, 'teaching/deck.yaml', DeckFile, readYaml(ctx, 'teaching/deck.yaml', false))
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
    checkReferences(ctx, game, characters, monitors, systems, systemIds, deck, reportCard, listFiles(join(dir, 'art')))
    checkCounts(ctx, game, systems)
  }
  if (ctx.errors.length > 0 || !characters) return { ok: false, errors: ctx.errors, warnings: ctx.warnings }

  const all = (f: (s: SystemPack) => unknown) => systemIds.every((id) => systems[id] && f(systems[id]))
  const phasesAvailable: Record<PhaseId, boolean> = {
    planning: all((s) => s.problems && s.insights),
    development: game.phases.development.board === 'canvas' && all((s) => s.build),
    maintaining: !!monitors && all((s) => s.maintain),
  }
  const provisional = systemIds.some((id) =>
    PHASES.some((p) => {
      const c = systems[id]!.system.calibration[p]
      return c.provisional || c.zero === null || c.floor === null || c.ceiling === null
    }))

  const pack: Pack = {
    dir, hash: contentHash(ctx.raw), game, monitors, characters,
    systemIds, systems, deck, reportCard, phasesAvailable,
    artFiles: listFiles(join(dir, 'art')), provisional,
  }
  return { ok: true, pack: deepFreeze(pack), warnings: ctx.warnings }
}

// ------------------------------------------------------------------------------------------
// Layer 2: references
// ------------------------------------------------------------------------------------------
/** The stages a deck section may open at: the slide stages of section 6.13. */
const DECK_STAGES = ['intro', 'break.planning', 'break.development', 'break.maintaining', 'reflection'] as const

function checkReferences(
  ctx: Ctx, game: GameFile, characters: CharactersFile,
  monitors: MonitorsFile | null, systems: Record<string, SystemPack>, systemIds: string[],
  deck: DeckFile | null, reportCard: ReportCardFile | null, artFiles: string[],
) {
  const err = (file: string, path: string, message: string) => ctx.errors.push({ file, path, message })
  const warn = (file: string, path: string, message: string) => ctx.warnings.push({ file, path, message })
  const limits = game.text_limits ?? {}
  /** A word limit of `text_limits` gives a warning, like everywhere. */
  const words = (text: string, limit: string, file: string, path: string) => {
    const max = limits[limit]
    const n = text.split(/\s+/).filter(Boolean).length
    if (max !== undefined && n > max) warn(file, path, `${n} words, over the ${limit} limit of ${max}`)
  }
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
    if (c.click_lines !== undefined && c.click_lines.length < 3) warn('characters.yaml', `[${i}].click_lines`, 'a person needs three or more click lines')
    c.click_lines?.forEach((l, j) => words(l, 'click_line', 'characters.yaml', `[${i}].click_lines[${j}]`))
    if (c.look === undefined) warn('characters.yaml', `[${i}].look`, 'no look: the sprite falls back to one made from the id')
  })
  const charOk = (id: string, sys: string) => charIds.has(id) && (charIds.get(id) === 'all' || charIds.get(id) === sys)

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
    if (sp.build) {
      // While game.yaml still describes the board of the first version, Phase 2 cannot open,
      // and Phase 1 still plays.
      if (game.phases.development.board !== 'canvas') warn('game.yaml', 'phases.development.board', `${f('build')} exists, and Phase 2 opens only when this is "canvas"`)
      const groups = (game.phases.development.action_groups ?? []).map((g) => g.id)
      checkBuild(sp.build, { problemIds, groups, insightTileOk: (speaker) => charOk(speaker, sid) },
        (path, message) => err(f('build'), path, message), (path, message) => warn(f('build'), path, message))
    }
    if (sp.maintain) checkMaintain(ctx, f('maintain'), sp.maintain, monitorIds, prefixed)
    if (sp.story) {
      const st = sp.story
      const insightIds = new Set((sp.insights ?? []).map((x) => x.id))
      const eventIds = new Set((sp.maintain?.events ?? []).map((x) => x.id))
      const caseIds = new Set((sp.build?.cases ?? []).map((x) => x.id))
      const actionIds = new Set((sp.build?.actions ?? []).map((x) => x.id))
      for (const [phase, b] of Object.entries((st.briefs ?? {}) as Record<string, { from: string } | undefined>)) if (b && !charOk(b.from, sid)) err(f('story'), `briefs.${phase}.from`, `unknown character "${b.from}"`)
      const op = st.briefs?.development?.opening
      if (op) for (const k of ['hit', 'missed'] as const) words(op[k], 'phase_brief_opening', f('story'), `briefs.development.opening.${k}`)
      st.banter?.forEach((b, i) => {
        unique(b.id, f('story'), `banter[${i}].id`)
        b.lines.forEach((l, j) => {
          if (!charOk(l.speaker, sid)) err(f('story'), `banter[${i}].lines[${j}].speaker`, `unknown character "${l.speaker}"`)
          words(l.text, 'banter_line', f('story'), `banter[${i}].lines[${j}].text`)
        })
      })
      for (const [k, l] of Object.entries((st.letters ?? {}) as Record<string, { from: string; variants: Record<string, string> } | undefined>)) {
        if (!l) continue
        if (!charOk(l.from, sid)) err(f('story'), `letters.${k}.from`, `unknown character "${l.from}"`)
        for (const band of Object.keys(l.variants)) if (band !== 'empty' && !game.scoring.score_bands.some((b) => b.id === band)) err(f('story'), `letters.${k}.variants.${band}`, `unknown band "${band}"`)
      }
      st.dialogue?.forEach((d, i) => {
        prefixed(d.id, f('story'), `dialogue[${i}].id`)
        if (!charOk(d.speaker, sid)) err(f('story'), `dialogue[${i}].speaker`, `unknown character "${d.speaker}"`)
        const [on, ref] = d.trigger.on.split(':') as [string, string | undefined]
        // In Phase 1 an insight comes from an investigation, in Phase 2 from an action.
        const fromAction = d.trigger.phase === 'development'
        // Lines of Phase 2 wait for its build file: until it exists the phase cannot open.
        if (fromAction && !sp.build) return
        if (on === 'insight' && !(fromAction ? actionIds : insightIds).has(ref!)) err(f('story'), `dialogue[${i}].trigger.on`, `unknown ${fromAction ? 'action' : 'investigation'} "${ref}"`)
        if (on === 'event' && !eventIds.has(ref!)) err(f('story'), `dialogue[${i}].trigger.on`, `unknown event "${ref}"`)
        if (on === 'trace' && !caseIds.has(ref!)) err(f('story'), `dialogue[${i}].trigger.on`, `unknown case "${ref}"`)
      })
      st.announcements?.forEach((a, i) => {
        prefixed(a.id, f('story'), `announcements[${i}].id`)
        if (!charOk(a.from, sid)) err(f('story'), `announcements[${i}].from`, `unknown character "${a.from}"`)
        if (a.offer) err(f('story'), `announcements[${i}].offer`, `unknown offer "${a.offer}": Phase 2 has no offers`)
      })
    }
  }

  deck?.sections.forEach((sec, i) => {
    unique(sec.id, 'teaching/deck.yaml', `sections[${i}].id`)
    if (!(DECK_STAGES as readonly string[]).includes(sec.stage)) err('teaching/deck.yaml', `sections[${i}].stage`, `unknown stage "${sec.stage}": a section opens at ${DECK_STAGES.join(', ')}`)
    if (deck.sections.findIndex((x) => x.stage === sec.stage) !== i) err('teaching/deck.yaml', `sections[${i}].stage`, `two sections open at "${sec.stage}"`)
    sec.slides.forEach((sl, j) => {
      unique(sl.id, 'teaching/deck.yaml', `sections[${i}].slides[${j}].id`)
      const at = `sections[${i}].slides[${j}]`
      // Every picture of a slide is a file under art/, which is public by definition.
      const picture = (path: string | undefined, where: string) => {
        if (path === undefined) return
        if (!/^[a-z0-9_/-]+\.(png|webp)$/.test(path)) err('teaching/deck.yaml', where, 'an image is a path under art/, ending in .png or .webp')
        else if (!artFiles.includes(path)) err('teaching/deck.yaml', where, `art/${path} does not exist`)
      }
      picture(sl.image, `${at}.image`)
      sl.people?.forEach((p, k) => picture(p.photo, `${at}.people[${k}].photo`))
      sl.figures?.forEach((f, k) => picture(f.image, `${at}.figures[${k}].image`))
      const layout = sl.layout ?? 'bullets'
      if (layout === 'cards' && !sl.cards?.length) err('teaching/deck.yaml', `${at}.cards`, 'a slide with the layout "cards" needs cards')
      if (layout === 'figures' && !sl.figures?.length) err('teaching/deck.yaml', `${at}.figures`, 'a slide with the layout "figures" needs figures')
      if (sl.qr?.show === 'join' && sl.qr.url !== undefined) err('teaching/deck.yaml', `${at}.qr.url`, 'the join code takes its link from the session')
      words(sl.title, 'slide_title', 'teaching/deck.yaml', `${at}.title`)
      if (sl.subtitle !== undefined) words(sl.subtitle, 'slide_bullet', 'teaching/deck.yaml', `${at}.subtitle`)
      sl.bullets.forEach((b, k) => words(b, 'slide_bullet', 'teaching/deck.yaml', `${at}.bullets[${k}]`))
      sl.cards?.forEach((c, k) => {
        words(c.title, 'slide_title', 'teaching/deck.yaml', `${at}.cards[${k}].title`)
        if (c.text !== undefined) words(c.text, 'slide_card', 'teaching/deck.yaml', `${at}.cards[${k}].text`)
        c.points?.forEach((x, n) => words(x, 'slide_bullet', 'teaching/deck.yaml', `${at}.cards[${k}].points[${n}]`))
        if (c.system !== undefined && !allSystems.includes(c.system)) err('teaching/deck.yaml', `${at}.cards[${k}].system`, `unknown health system "${c.system}"`)
      })
      sl.figures?.forEach((f, k) => { if (f.caption !== undefined) words(f.caption, 'slide_card', 'teaching/deck.yaml', `${at}.figures[${k}].caption`) })
    })
  })
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
  checkClasses(ctx, game)
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
  if (dev.board === 'canvas') {
    // A setting with one implemented value is validated to hold it (section 5.4).
    const one = (path: string, value: string | undefined, want: string) => { if (value !== undefined && value !== want) err('game.yaml', `phases.development.${path}`, `must be "${want}"`) }
    one('submission.default', dev.submission?.default, 'best_validation')
    one('submission.player_may_choose', dev.submission?.player_may_choose, 'any_own_validation')
    one('submission.none_at_the_end', dev.submission?.none_at_the_end, 'validate_the_draft_if_ready')
    one('live_leaderboard.metric', dev.live_leaderboard.metric, 'best_validation_accuracy')
    if (!dev.action_groups?.length) err('game.yaml', 'phases.development.action_groups', 'the canvas needs its groups of actions')
  }
  const groups = dev.action_groups ?? []
  groups.forEach((g, i) => { if (groups.findIndex((x) => x.id === g.id) !== i) err('game.yaml', `phases.development.action_groups[${i}].id`, `group "${g.id}" is listed twice`) })

  for (const sp of Object.values(systems)) {
    const f = (name: string) => `${sp.folder}/${name}.yaml`
    if (sp.problems && sp.problems.length !== pl.candidates) err(f('problems'), '', `holds ${sp.problems.length} problems, game.yaml asks for ${pl.candidates}`)
    if (sp.problems) checkProblemClasses(ctx, f('problems'), game, sp)
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
  }
}

// ------------------------------------------------------------------------------------------
// The classes of Phase 1 (section 5.5)
// ------------------------------------------------------------------------------------------
const PL = 'phases.planning'

function checkClasses(ctx: Ctx, game: GameFile) {
  const err = (path: string, message: string) => ctx.errors.push({ file: 'game.yaml', path, message })
  const pl = game.phases.planning
  const below = pl.submission?.letter_empty_below
  if (below !== undefined && below > pl.candidates) err(`${PL}.submission.letter_empty_below`, `must lie between 0 and the ${pl.candidates} candidates`)
  const ids = pl.classes.map((c) => c.id)
  pl.classes.forEach((c, i) => { if (ids.indexOf(c.id) !== i) err(`${PL}.classes[${i}].id`, `class "${c.id}" is listed twice`) })
  // class_order lists every class once.
  for (const id of pl.class_order) if (!ids.includes(id)) err(`${PL}.class_order`, `unknown class "${id}"`)
  for (const id of ids) if (pl.class_order.filter((x) => x === id).length !== 1) err(`${PL}.class_order`, `class "${id}" must appear exactly once`)
  // Exactly one class has no rungs, and it comes first.
  const decoy = pl.classes.filter((c) => c.rungs.length === 0)
  if (decoy.length !== 1) err(`${PL}.classes`, `exactly one class must have empty rungs, found ${decoy.length}`)
  else if (pl.class_order[0] !== decoy[0]!.id) err(`${PL}.class_order`, `the class with empty rungs ("${decoy[0]!.id}") must come first`)
  // Every rung belongs to exactly one class.
  for (const r of game.ladder) {
    const holders = pl.classes.filter((c) => c.rungs.includes(r.rung))
    if (holders.length !== 1) err(`${PL}.classes`, `rung ${r.rung} must belong to exactly one class, found ${holders.length}`)
  }
  // class_mix names every class and adds up to candidates.
  for (const k of Object.keys(pl.class_mix)) if (!ids.includes(k)) err(`${PL}.class_mix.${k}`, `unknown class "${k}"`)
  let sum = 0
  pl.classes.forEach((c, i) => {
    const mix = pl.class_mix[c.id]
    if (mix === undefined) { err(`${PL}.class_mix`, `class "${c.id}" is missing`); return }
    sum += mix
    if (c.capacity !== mix) err(`${PL}.classes[${i}].capacity`, `capacity ${c.capacity} differs from its class_mix ${mix}`)
  })
  if (sum !== pl.candidates) err(`${PL}.class_mix`, `adds up to ${sum}, candidates is ${pl.candidates}`)
  // The flagship class comes last and has one spot.
  const fc = pl.classes.find((c) => c.id === pl.flagship_class)
  if (!fc) err(`${PL}.flagship_class`, `unknown class "${pl.flagship_class}"`)
  else {
    if (pl.class_order.at(-1) !== fc.id) err(`${PL}.class_order`, `the flagship class "${fc.id}" must come last`)
    if (fc.capacity !== 1) err(`${PL}.classes`, `the flagship class "${fc.id}" must have one spot`)
    if (fc.rungs.length === 0) err(`${PL}.flagship_class`, 'the flagship class cannot be the class of problems that are not real')
  }
}

function checkProblemClasses(ctx: Ctx, file: string, game: GameFile, sp: SystemPack) {
  const err = (path: string, message: string) => ctx.errors.push({ file, path, message })
  const pl = game.phases.planning
  const counts = new Map<string, number>()
  sp.problems!.forEach((p, i) => {
    const cls = pl.classes.find((c) => c.id === p.key.class)
    if (!cls) { err(`[${i}].key.class`, `unknown class "${p.key.class}"`); return }
    counts.set(cls.id, (counts.get(cls.id) ?? 0) + 1)
    if (!p.key.real && cls.rungs.length > 0) err(`[${i}].key.class`, `a problem that is not real belongs to the class with empty rungs, not "${cls.id}"`)
    if (p.key.real && p.key.tier !== null && !cls.rungs.includes(p.key.tier)) err(`[${i}].key.class`, `class "${cls.id}" does not cover rung ${p.key.tier}`)
    if (p.key.flagship && cls.id !== pl.flagship_class) err(`[${i}].key.class`, `the flagship must be in the flagship class "${pl.flagship_class}"`)
  })
  for (const c of pl.classes) {
    const want = pl.class_mix[c.id]
    const have = counts.get(c.id) ?? 0
    if (want !== undefined && have !== want) err('', `holds ${have} problem(s) of class "${c.id}", class_mix asks for ${want}`)
  }
}
