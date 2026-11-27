// Everything a browser may receive (engineering spec, sections 8.3, 8.4 and 9.2).
// Every schema is strict: an unknown field stops the message before it is sent.
import { z } from 'zod'
import { AvatarId, Kind, Method, Mode, PhaseId, ProgrammeShow, SceneId, StageId, Theme } from './ids.ts'
import { ReportCard } from './report.ts'

const S = <T extends Record<string, z.ZodType>>(shape: T) => z.strictObject(shape)
export const Text = z.string()
const Ms = z.number()
const Int = z.number().int()

// ------------------------------------------------------------------------------------------
// Pieces
// ------------------------------------------------------------------------------------------
export const Rung = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)])
export type Rung = z.infer<typeof Rung>

/** How a person's pixel character looks: free words from the pack, read by the sprite builder. */
export const Look = S({ hair: Text.optional(), hairStyle: Text.optional(), skin: Text.optional(), top: Text.optional(), detail: Text.optional() })
export type Look = z.infer<typeof Look>

export const Character = S({
  id: z.string(), name: Text, role: Text, portrait: z.string(),
  look: Look,
  extra: z.boolean(),               // lives in the scene, has no interview and no letter
  clickLines: z.array(Text),        // what the person says when clicked
})
export type Character = z.infer<typeof Character>

export const SystemPublic = S({
  id: z.string(),
  index: Int,                 // position in the session's list, which sets color and shape
  name: Text, setting: Text, premise: Text,
  practiceProfile: z.array(S({ label: Text, value: z.union([Text, z.number()]) })),
  baseline: z.array(S({ label: Text, value: z.union([Text, z.number()]), unit: Text.optional() })),
  cast: z.array(Character),         // everyone in the practice, extras included
  banter: z.array(S({ id: z.string(), lines: z.array(S({ speaker: z.string(), text: Text })) })),
})
export type SystemPublic = z.infer<typeof SystemPublic>

export const SystemRef = S({ id: z.string(), index: Int, name: Text })
export type SystemRef = z.infer<typeof SystemRef>

/** A rung of the ladder, with the Phase 1 class it falls in (teaching material for the menu). */
export const LadderRung = S({ rung: Rung, label: Text, fitsWhen: Text, example: Text, classId: z.string(), classShort: Text })
export type LadderRung = z.infer<typeof LadderRung>

export const PackArt = S({
  base: z.string(),                  // URL prefix of the pack's art folder
  portraits: z.array(z.string()),    // art keys that have a portrait file
  room: z.boolean(),                 // the pack brings its own room
})
export type PackArt = z.infer<typeof PackArt>

export const Tile = z.discriminatedUnion('type', [
  S({ type: z.literal('stat'), headline: Text, body: Text,
      data: S({ value: z.union([Text, z.number()]), unit: Text.optional(), label: Text, comparison: Text.optional() }) }),
  S({ type: z.literal('chart'), headline: Text, body: Text,
      data: S({ kind: z.enum(['bar', 'line']), xLabel: Text, yLabel: Text,
                series: z.array(S({ name: Text, points: z.array(z.tuple([z.union([Text, z.number()]), z.number()])) })),
                note: Text.optional() }) }),
  S({ type: z.literal('quote'), headline: Text, body: Text, data: S({ speaker: z.string(), lines: z.array(Text) }) }),
  S({ type: z.literal('audit'), headline: Text, body: Text,
      data: S({ sampleSize: Int, findings: z.array(S({ label: Text, count: Int })), note: Text.optional() }) }),
])
export type Tile = z.infer<typeof Tile>

/** A phase's points as a player sees them: the band by its label, never its id or a raw score. */
export const PhasePoints = S({ points: Int, band: Text.nullable() })   // band: its label from game.yaml, null without one
export type PhasePoints = z.infer<typeof PhasePoints>

// ------------------------------------------------------------------------------------------
// Static content of a phase (fetched once per phase)
// ------------------------------------------------------------------------------------------
const Brief = S({ from: z.string(), title: Text, text: Text }).nullable()

export const PlanningClass = S({
  id: z.string(), label: Text, short: Text, fitsWhen: Text,
  rungs: z.array(Rung),
  capacity: Int,                    // the spots of the class on the board
})
export type PlanningClass = z.infer<typeof PlanningClass>

export const PlanningContent = S({
  phase: z.literal('planning'),
  brief: Brief,
  // `economy`: the score has a part for the investigations a player did not start (section 6.5).
  rules: S({ bandwidth: Int, economy: z.boolean(), classes: z.array(PlanningClass) }),   // classes in class_order
  problems: z.array(S({ id: z.string(), title: Text, description: Text })),
  investigations: z.array(S({
    id: z.string(), method: Method, character: z.string().nullable(),
    title: Text, teaser: Text, bandwidth: Int, seconds: z.number(), storyTime: Text.nullable(),
  })),
})
export type PlanningContent = z.infer<typeof PlanningContent>

// ------------------------------------------------------------------------------------------
// Phase 2: the canvas (section 6.6). The map, its legend and the content of the phase.
// ------------------------------------------------------------------------------------------
const Id = z.string().max(64)
export const CanvasTile = S({
  id: z.string().max(16), kind: Id, col: Int, row: Int,
  model: Id.nullable(), runsOn: Id.nullable(), prompt: Id.nullable(),
})
export type CanvasTile = z.infer<typeof CanvasTile>
export const LineSide = z.enum(['top', 'right', 'bottom', 'left'])
export type LineSide = z.infer<typeof LineSide>
/**
 * A line. `fromSide` and `toSide` are the sides of its two tiles where the player attached it.
 * They change how the line is drawn and never a score. Without them it joins the sides that
 * face each other. A source and the result have one place for a line and take no side.
 */
export const CanvasLine = S({ from: Id, to: Id, fromSide: LineSide.optional(), toSide: LineSide.optional() })
export type CanvasLine = z.infer<typeof CanvasLine>
/** A map: tiles on the cells of the grid, and lines that run any way but never in a loop. */
export const CanvasMap = S({ tiles: z.array(CanvasTile).max(64), lines: z.array(CanvasLine).max(160) })
export type CanvasMap = z.infer<typeof CanvasMap>

/** What it takes to draw a map read-only: the grid and the public names of everything on it. */
/** The name of the stage a column stands for, and one sentence on it. Names only. */
export const CanvasColumn = S({ label: Text, hint: Text })
export type CanvasColumn = z.infer<typeof CanvasColumn>

export const CanvasLegend = S({
  cols: Int, rows: Int,
  columns: z.array(CanvasColumn).nullable(),    // one per column, or null: nothing stands above the columns
  sources: z.array(S({ id: z.string(), label: Text, icon: z.string(), privateData: z.boolean() })),
  result: S({ id: z.string(), label: Text }),
  // `task` is the job of a worker, on its tile where the tile has no boxes of parts.
  workers: z.array(S({ id: z.string(), kind: z.enum(['ai', 'fixed', 'person']), label: Text, short: Text, icon: z.string(), task: Text.nullable() })),
  models: z.array(S({ id: z.string(), label: Text, short: Text })),
  compute: z.array(S({ id: z.string(), label: Text, short: Text, protectsPrivateData: z.boolean() })),
  prompts: z.array(S({ id: z.string(), label: Text })),
})
export type CanvasLegend = z.infer<typeof CanvasLegend>

/** What a map would take to run a month: money, minutes per case of each pool, complexity. */
export const Running = S({ money: z.number(), minutes: z.record(z.string(), z.number()), complexity: z.number() })
export type Running = z.infer<typeof Running>

const Part = { id: z.string(), label: Text, short: Text, description: Text, costLine: Text.nullable() }
const CanvasAction = {
  id: z.string(), group: z.string(), title: Text, teaser: Text,
  money: z.number(), developers: Int, seconds: z.number(),
  requires: z.array(z.string()), unlocks: z.array(z.string()), storyTime: Text.nullable(),
}
/** What Phases 2 and 3 both send about the board: the rules, and the public part of everything on it. */
const CanvasContent = {
  // What is on this player's board (section 6.6, "What is on the board"). An item that is not
  // unlocked yet comes with its names only, so that a map drawn for the player can name it, and
  // is not shown in the toolbox or on a shelf. An action that waits for another, for a round or
  // for a finding is not in `actions` at all. `board` changes whenever more comes onto the
  // board: the view carries the same number, and a browser whose content is behind asks again.
  board: Int,
  brief: Brief,
  problem: S({ id: z.string(), title: Text, description: Text }),
  rules: S({
    cols: Int, rows: Int, money: z.number(), developers: Int,
    columns: z.array(CanvasColumn).nullable(),
    validations: Int, validateSeconds: z.number(), showRunning: z.boolean(),
    moneyUnit: Text.nullable(),         // written after a sum of money, such as k$
    pools: z.array(S({ id: z.string(), label: Text, max: z.number() })),
    actionGroups: z.array(S({ id: z.string(), label: Text })),
    toolboxGroups: z.array(S({ id: z.string(), label: Text })),   // empty: the toolbox is one list
    // Where more can still come onto the board through what the practice learns, builds and
    // buys: the groups of the toolbox and of the actions that hold something hidden, and the
    // shelves. Never what, and never how many.
    more: S({ toolbox: z.array(z.string()), actions: z.array(z.string()), models: z.boolean(), compute: z.boolean(), prompts: z.boolean() }),
  }),
  sources: z.array(S({ id: z.string(), label: Text, description: Text, icon: z.string(), privateData: z.boolean() })),
  result: S({ id: z.string(), label: Text, description: Text }),
  workers: z.array(S({
    id: z.string(), kind: z.enum(['ai', 'fixed', 'person']), label: Text, short: Text, description: Text, icon: z.string(),
    task: Text.nullable(),                // a few words on the job it does
    group: z.string().nullable(),         // a toolbox group
    costLine: Text.nullable(), needsModel: z.boolean(),
    models: z.array(z.string()),          // the models this kind of worker may carry
    pool: z.string().nullable(),
    // The minutes a case of deciding alone and of checking. What a line from a source adds depends
    // on the effort of the source, which stays on the server: the view carries the totals.
    minutes: S({ decide: z.number(), check: z.number() }).nullable(),
  })),
  models: z.array(S({ ...Part, runsOn: z.array(z.string()) })),
  compute: z.array(S({ ...Part, protectsPrivateData: z.boolean() })),
  // The first is the default. A card shows `samples`, each under its label, or else `sample`.
  prompts: z.array(S({ id: z.string(), label: Text, short: Text.nullable(), description: Text, sample: Text.nullable(), samples: z.array(S({ label: Text, text: Text })) })),
}
export const DevelopmentContent = S({
  phase: z.literal('development'),
  ...CanvasContent,
  actions: z.array(S(CanvasAction)),
})
export type DevelopmentContent = z.infer<typeof DevelopmentContent>

/** A reference map of the pack, as a player may see it: at the reveal of Phase 2 and in Phase 3. */
export const ReferenceMap = S({ id: z.string(), label: Text, summary: Text, map: CanvasMap, accuracy: z.number() })
export type ReferenceMap = z.infer<typeof ReferenceMap>

/**
 * Phase 3 (section 6.7): the board of Phase 2 with what Phase 3 adds (tools, actions, groups of
 * actions) and the reference maps a player may take. The periods and rounds of the year are
 * in the view, because time that the facilitator adds makes more of them.
 */
export const MaintainingContent = S({
  phase: z.literal('maintaining'),
  ...CanvasContent,                   // `rules.validations` and `validateSeconds` are those of Phase 3
  // `repeat`: the action may be done again after it finished. `upkeep`: money a month from the
  // period after it finished, counted in the money spent.
  actions: z.array(S({ ...CanvasAction, repeat: z.boolean(), upkeep: z.number() })),
  year: S({
    baselineLabel: Text,              // what a practice with no deployed map is called
    costPerPoint: z.number(),         // money that takes one point off the score of the year
  }),
  references: z.array(ReferenceMap),
})
export type MaintainingContent = z.infer<typeof MaintainingContent>

export const PhaseContent = z.discriminatedUnion('phase', [PlanningContent, DevelopmentContent, MaintainingContent])
export type PhaseContent = z.infer<typeof PhaseContent>

// ------------------------------------------------------------------------------------------
// Slides (one deck per session). A slide reaches a browser only while it is shown.
// ------------------------------------------------------------------------------------------
export const SLIDE_LAYOUTS = ['bullets', 'title', 'cards', 'figures', 'closing', 'standings'] as const
export const SlideLayout = z.enum(SLIDE_LAYOUTS)
export type SlideLayout = z.infer<typeof SlideLayout>
export const SlideTone = z.enum(['go', 'sky', 'sun', 'lav', 'rose'])
export type SlideTone = z.infer<typeof SlideTone>

export const SlideView = S({
  id: z.string(),
  index: Int, count: Int,           // "Slide 2 of 6", across the whole deck
  section: Text,
  layout: SlideLayout,
  title: Text,
  subtitle: Text.nullable(),
  bullets: z.array(Text),
  // `system`: the index of a health system of the session, when the box belongs to one. It then
  // takes that system's color and shape in place of its tone.
  cards: z.array(S({ title: Text, text: Text.nullable(), points: z.array(Text), tag: Text.nullable(), tone: SlideTone, system: Int.nullable() })),
  people: z.array(S({ name: Text, role: Text.nullable(), photo: z.string().nullable() })),   // photo: URL under the pack's art
  figures: z.array(S({ image: z.string().nullable(), title: Text, caption: Text.nullable(), tone: SlideTone })),
  // A QR code. `join` is the join link of the session, which every client already holds.
  // `link` carries its own URL, or null for a frame that waits for one.
  qr: S({ show: z.enum(['join', 'link']), url: z.string().nullable(), label: Text.nullable() }).nullable(),
  references: z.array(Text),
  image: z.string().nullable(),     // URL under the pack's art
  stat: S({ label: Text, value: Text }).nullable(),   // a room statistic that is one number. "–" until the room has it
  // Room statistics drawn as bars, each a share in percent. A bar has no value until the phase
  // behind it is scored: the frame of the chart shows before the numbers do.
  charts: z.array(S({ title: Text, bars: z.array(S({ label: Text, value: z.number().nullable(), note: Text.nullable(), tone: SlideTone, system: Int.nullable() })) })),
  // The leaderboard of the game on a slide: the first players by their total points, with the
  // first `highlight` of them drawn large. `final` once every phase is scored. Before any
  // phase is scored there are no rows, and the slide says that it fills in later.
  standings: S({ final: z.boolean(), highlight: Int, rows: z.array(S({ rank: Int, name: Text, avatar: AvatarId, value: z.number() })) }).nullable(),
})
export type SlideView = z.infer<typeof SlideView>

// ------------------------------------------------------------------------------------------
// The player view (always complete)
// ------------------------------------------------------------------------------------------
export const PlanningView = S({
  status: z.enum(['playing', 'submitted', 'closed']),
  bandwidthFree: Int,
  running: z.array(S({ id: z.string(), startedAtMs: Ms, completesAtMs: Ms, lines: z.array(Text) })),
  tiles: z.array(S({ investigation: z.string(), unlockedAtMs: Ms, tile: Tile })),
  picks: z.record(z.string(), z.string()),     // problem id to class id. Unsorted problems have no entry
  reveal: S({
    problems: z.array(S({
      id: z.string(), class: z.string(), tier: Rung.nullable(), flagship: z.boolean(), rationale: Text,
      burden: S({ kind: z.string(), size: z.string(), note: Text }).optional(),
    })),
    graded: z.array(S({ problem: z.string(), picked: z.string().nullable(), points: z.number() })),   // every problem, in pack order
    classify: z.number(), flagship: z.number(),      // the parts of the score
    economy: z.number(),                             // 0 when the pack has no economy part
    investigations: S({ started: Int, total: Int }), // total is 0 when the pack has no economy part
  }).nullable(),
})
export type PlanningView = z.infer<typeof PlanningView>

const Missed = S({ title: Text, text: Text, why: Text })
export const ReadyDetail = z.discriminatedUnion('reason', [
  S({ reason: z.literal('nothing_reaches_result') }),
  S({ reason: z.literal('no_source_connected') }),
  S({ reason: z.literal('tile_incomplete'), tile: z.string(), missing: z.array(z.enum(['model', 'runsOn'])) }),
  S({ reason: z.literal('required_missing'), workers: z.array(z.string()), text: Text }),
  S({ reason: z.literal('too_many_minutes'), pool: z.string(), used: z.number(), max: z.number(), tiles: z.array(z.string()) }),
])
export type ReadyDetail = z.infer<typeof ReadyDetail>

export const DevelopmentView = S({
  money: z.number(),
  developers: S({ total: Int, free: Int }),
  board: Int,                                       // the `board` of the content this view goes with
  unlocked: z.array(z.string()),
  actionsDone: z.array(S({ id: z.string(), atMs: Ms })),
  actionsRunning: z.array(S({ id: z.string(), startedAtMs: Ms, completesAtMs: Ms })),
  insights: z.array(S({ action: z.string(), tile: Tile })),
  map: CanvasMap,                                   // the draft
  // Why the draft cannot be validated: the codes, and each with what it names (spec 6.6).
  ready: S({ ok: z.boolean(), reasons: z.array(z.string()), details: z.array(ReadyDetail) }),
  // Lines of the draft that a rule of the pack advises on, with its words.
  lineAdvice: z.array(S({ from: z.string(), to: z.string(), text: Text })),
  // The minutes a case each person tile asks in this map. Empty when the pack does not show it.
  tileMinutes: z.record(z.string(), z.number()),
  // Pools of people that the draft asks more minutes of than they have and that rush: the map
  // can be validated, and these people get through a share of the cases (spec 6.6).
  rushed: z.array(S({ pool: z.string(), used: z.number(), max: z.number(), tiles: z.array(z.string()) })),
  flags: S({ stray: z.array(z.string()), incomplete: z.array(z.string()), privateData: z.array(z.string()) }),
  running: Running.nullable(),                      // null when the pack does not show it
  validationsLeft: Int,
  validating: S({ id: z.string(), startedAtMs: Ms, completesAtMs: Ms }).nullable(),
  validations: z.array(S({
    id: z.string(), atMs: Ms, map: CanvasMap, accuracy: z.number(),
    unhurried: z.number().nullable(),               // what the map would reach if nobody rushed
    rank: Int.nullable(), of: Int,                  // the rank in the live column right after it
    missed: Missed.nullable(),
    note: Text.nullable(),
    running: Running.nullable(),
  })),
  submitId: z.string().nullable(),                  // the validation that would be submitted now
  reveal: S({
    accuracy: z.number(), raw: z.number(),
    cases: z.array(S({ title: Text, text: Text, solved: z.number(), reference: z.number() })),
    reference: S({ map: CanvasMap, summary: Text, accuracy: z.number() }),   // the first of `references`
    references: z.array(ReferenceMap),             // every reference map of the pack, the first is `reference`
  }).nullable(),
})
export type DevelopmentView = z.infer<typeof DevelopmentView>

// ------------------------------------------------------------------------------------------
// Phase 3: the year (section 6.7). Shares run 0 to 1, values and scores 0 to 100.
// ------------------------------------------------------------------------------------------
/** Money spent so far, by part: everything counts in the score of the year. */
export const MaintainingSpent = S({
  phase2: z.number(),               // the actions of Phase 2
  actions: z.number(),              // the actions of Phase 3
  adoption: z.number(),             // the price of what the reference maps taken needed
  running: z.number(),              // the running cost of the periods reported
  fines: z.number(),
  total: z.number(),
})
export type MaintainingSpent = z.infer<typeof MaintainingSpent>

/** The report of one period of two months, for the player whose map ran. */
export const MaintainingReport = S({
  period: Int,                      // 1 is the first period
  label: Text, short: Text,
  atMs: Ms,
  map: z.string().nullable(),       // the validation that ran. Null: no map ran
  validity: z.number(),             // on the patients of the period
  test: z.number(),                 // the accuracy of the same map on the test set
  reliability: z.number(),
  interruptions: Int,
  value: z.number(),                // the score of the period
  off: z.number(),                  // points the people's part took off
  runCost: z.number(), fine: z.number(),
  // The bill of the period, line by line (running costs and fines, adding up to `runCost` +
  // `fine`), the money that arrived with the report, and the account after the bill was paid.
  // The account may be below zero: nothing can then be bought until it is positive again.
  bill: z.array(S({ label: Text, money: z.number() })),
  granted: z.number(),
  account: z.number(),
  spent: z.number(),                // everything spent up to this report
  score: z.number(),                // the score of the year after this report
  rank: Int.nullable(), of: Int,    // among the practices that hold this report
  // One sentence each, from the pack. Null when it does not apply.
  sentences: S({
    validity: Text.nullable(), reliability: Text.nullable(),
    gap: Text.nullable(),           // the validity lies well under the test set
    people: Text.nullable(),        // what the people who check say
    steady: Text.nullable(),        // nothing changed for the worse
    noMap: Text.nullable(),         // no map ran
  }),
  missed: Missed.nullable(),        // one failed case
  note: Text.nullable(),
  worstPart: S({ label: Text, text: Text }).nullable(),      // the part that failed most, and what happened
  // The worst change of the period, as a symptom. The cause only with the lens it asks for.
  worstChange: S({ symptom: Text, cause: Text.nullable() }).nullable(),
  // With the lens `incidentLog`: every part that failed, grouped by what it is, with the share of
  // the cases it lost. Null without the lens.
  parts: z.array(S({ label: Text, share: z.number() })).nullable(),
  // With the lens `caseMix`: the share solved of every kind of case. Null without the lens.
  kinds: z.array(S({ title: Text, solved: z.number() })).nullable(),
})
export type MaintainingReport = z.infer<typeof MaintainingReport>

export const MaintainingView = S({
  // The draft, the actions and the validations, as in Phase 2.
  money: z.number(),
  developers: S({ total: Int, free: Int }),
  board: Int,                       // the `board` of the content this view goes with
  unlocked: z.array(z.string()),
  // Every action that finished, those of Phase 2 too (`phase` tells them apart). A `repeat`
  // action is listed once for every time it finished.
  actionsDone: z.array(S({ id: z.string(), atMs: Ms, phase: z.enum(['development', 'maintaining']) })),
  actionsRunning: z.array(S({ id: z.string(), startedAtMs: Ms, completesAtMs: Ms })),
  insights: z.array(S({ action: z.string(), tile: Tile })),
  map: CanvasMap,
  ready: S({ ok: z.boolean(), reasons: z.array(z.string()), details: z.array(ReadyDetail) }),
  lineAdvice: z.array(S({ from: z.string(), to: z.string(), text: Text })),
  tileMinutes: z.record(z.string(), z.number()),
  rushed: z.array(S({ pool: z.string(), used: z.number(), max: z.number(), tiles: z.array(z.string()) })),
  flags: S({ stray: z.array(z.string()), incomplete: z.array(z.string()), privateData: z.array(z.string()) }),
  running: Running.nullable(),
  validationsLeft: Int,
  validating: S({ id: z.string(), startedAtMs: Ms, completesAtMs: Ms }).nullable(),
  // The list of maps: the validations of Phase 2, those of Phase 3, and the reference maps taken.
  validations: z.array(S({
    id: z.string(), atMs: Ms, map: CanvasMap, accuracy: z.number(),
    unhurried: z.number().nullable(),
    missed: Missed.nullable(),
    note: Text.nullable(),
    running: Running.nullable(),
    origin: z.enum(['phase2', 'phase3', 'reference']),
    label: Text.nullable(),         // the label of a reference map
    reference: z.string().nullable(),   // the id of the reference map it is
    fresh: z.boolean(),             // scored on the cases of the period in progress, not on the test set
    reliability: z.number().nullable(),   // what the map would have if deployed then. Null without the lens
  })),
  deployed: z.string().nullable(),  // the map that runs in the period in progress. Null: no map
  // The round in progress, 1 to `of`, and when it ends. After the last report `endsAtMs` is null.
  // `of` grows when the facilitator adds time: every whole round more ends with a report.
  round: S({ index: Int, of: Int, endsAtMs: Ms.nullable() }),
  // One slot of the chart for every period of the year as its clock stands, in order: the
  // months under the slot, and the calendar year where one begins.
  slots: z.array(S({ tick: Text, mark: Text.nullable() })),
  next: S({ label: Text, short: Text }).nullable(),   // the period that the round in progress ends with. Null when the year is over
  seen: Int,                        // the reports held
  reports: z.array(MaintainingReport),
  adopted: z.array(z.string()),     // ids of the reference maps taken
  // What taking each reference map would buy for this player now: what it needs and the player
  // does not have, and the price of that. The account pays all of it, and a player whose
  // account holds less than the price cannot take the map.
  offers: z.array(S({ id: z.string(), buys: z.array(S({ title: Text, money: z.number() })), price: z.number() })),
  lenses: S({ freshTestSet: z.boolean(), dryRun: z.boolean(), incidentLog: z.boolean(), caseMix: z.boolean(), driftAlarm: z.boolean() }),
  spent: MaintainingSpent,
  score: z.number(),                // the score of the year so far
  reveal: S({
    score: z.number(), raw: z.number(),
    mean: z.number(),               // the mean of the values of the periods
    values: z.array(z.number()),
    spent: MaintainingSpent,
    costPerPoint: z.number(),
    // Every event of the year: what it was, and the periods in which it acted on this player.
    events: z.array(S({ id: z.string(), title: Text, text: Text, from: Int, acted: z.boolean(), periods: z.array(Int) })),
    // The year of each reference map left alone, and of a practice with no map.
    references: z.array(S({ id: z.string(), label: Text, values: z.array(z.number()), validity: z.array(z.number()), reliability: z.array(z.number()), mean: z.number(), spent: z.number(), score: z.number() })),
    baseline: S({ label: Text, values: z.array(z.number()), score: z.number() }),
  }).nullable(),
})
export type MaintainingView = z.infer<typeof MaintainingView>

export const InboxItem = S({
  id: z.string(), kind: z.enum(['brief', 'letter', 'announcement']), from: z.string(),
  title: Text.optional(), text: Text, atMs: Ms,
})
export type InboxItem = z.infer<typeof InboxItem>

export const PlayerView = S({
  rev: Int,
  me: S({ id: z.string(), name: Text, avatar: AvatarId, system: z.string(), rejoinCode: z.string() }),
  stage: StageId,
  run: Int,                         // grows when the host starts a phase or the game again
  points: S({
    planning: PhasePoints.nullable(), development: PhasePoints.nullable(),
    maintaining: PhasePoints.nullable(), total: Int,
  }),
  planning: PlanningView.nullable(),
  development: DevelopmentView.nullable(),
  maintaining: MaintainingView.nullable(),
  inbox: z.array(InboxItem),
  reportCard: ReportCard.nullable(),   // at `winners` and after the session is closed (report.ts)
  slide: SlideView.nullable(),      // the slide the host mirrors to every player, outside play
  // A player who joined while a phase was in play has no board for it (section 6.4): they wait
  // with the leaderboard and the slides shown so far, and enter when the next phase starts.
  waiting: S({ phase: PhaseId, slides: z.array(SlideView) }).nullable(),
  // A single-player game (section 6.14): what its player may do to move it on. Null in a session
  // with a facilitator. `slide`: where the slide on show stands in its section.
  solo: S({
    next: StageId.nullable(),       // the stage `solo.next` leads to, or null in a timed stage and at the end
    timed: z.boolean(),             // a phase is in play: `solo.end_now` ends it
    slide: S({ first: z.boolean(), last: z.boolean() }).nullable(),
  }).nullable(),
})
export type PlayerView = z.infer<typeof PlayerView>

// ------------------------------------------------------------------------------------------
// Leaderboards
// ------------------------------------------------------------------------------------------
export const COLUMNS = ['overall', 'planning', 'development', 'maintaining'] as const
export const ColumnId = z.enum(COLUMNS)
export type ColumnId = z.infer<typeof ColumnId>

export const BoardRow = S({ rank: Int, name: Text, avatar: AvatarId, system: z.string(), value: z.number(), me: z.boolean().optional() })
export type BoardRow = z.infer<typeof BoardRow>

export const BoardColumn = S({
  // empty: the phase has not opened. live: in play, provisional. final: closed. sum: overall.
  state: z.enum(['empty', 'live', 'final', 'sum']),
  label: Text,                      // what the value means
  of: Int.optional(),               // the largest value a live column can reach ("17 of 22")
  rows: z.array(BoardRow),
})
export type BoardColumn = z.infer<typeof BoardColumn>

export const SystemStanding = S({ id: z.string(), rank: Int, score: z.number() })
export type SystemStanding = z.infer<typeof SystemStanding>

export const Board = S({
  atMs: Ms,
  live: PhaseId.nullable(),
  system: z.string().nullable(),    // the filter, or null for every practice
  columns: S({ overall: BoardColumn, planning: BoardColumn, development: BoardColumn, maintaining: BoardColumn }),
  systems: z.array(SystemStanding),
})
export type Board = z.infer<typeof Board>

export const Standing = S({
  ranks: S({ overall: Int.nullable(), system: Int.nullable(), phase: Int.nullable(), of: Int, ofSystem: Int }),
  board: Board,                     // top three of each column
})
export type Standing = z.infer<typeof Standing>

// ------------------------------------------------------------------------------------------
// Clock and session
// ------------------------------------------------------------------------------------------
export const Clock = S({
  gameMs: Ms, running: z.boolean(), scale: z.number(), stage: StageId,
  stageEndsAtMs: Ms.nullable(),     // timed stages
  guideEndsAtMs: Ms.nullable(),     // the host's guide countdown for untimed stages
  warnings: z.array(z.number()),    // seconds left at which the countdown changes color
})
export type Clock = z.infer<typeof Clock>

export const SessionInfo = S({
  code: z.string(), label: Text, title: Text.nullable(), mode: Mode, kind: Kind,
  systems: z.array(SystemRef),
  joinUrl: z.string(),
  phaseLabels: S({ planning: Text, development: Text, maintaining: Text }),
})
export type SessionInfo = z.infer<typeof SessionInfo>

// ------------------------------------------------------------------------------------------
// The big screen
// ------------------------------------------------------------------------------------------
/** One practice on the projector. `news`: the letter of its own that it got last, by its title and who wrote it. */
export const PracticeCard = S({
  name: Text, avatar: AvatarId, system: z.string(),
  now: z.array(Text),               // what runs at this moment
  facts: z.array(S({ label: Text, value: Text })),
  map: CanvasMap.nullable(),        // Phase 2 and 3: the practice's map, drawn with the legend of its system
  news: S({ from: Text, title: Text }).nullable(),
})
export type PracticeCard = z.infer<typeof PracticeCard>

export const ScreenView = S({
  session: SessionInfo,
  stage: StageId,
  scene: SceneId,                   // what to show now (never 'auto')
  theme: Theme,
  counts: S({ total: Int, bySystem: z.array(S({ id: z.string(), players: Int })) }),
  arrivals: z.array(S({ name: Text, avatar: AvatarId, system: z.string() })),   // newest first, lobby
  board: Board,
  spotlight: S({ name: Text, avatar: AvatarId, system: z.string(), stage: StageId,
                 points: S({ planning: Int.nullable(), development: Int.nullable(), maintaining: Int.nullable(), total: Int }),
                 tiles: Int }).nullable(),
  reveal: S({                       // the results of the phase that just closed, for the room
    phase: PhaseId,
    histogram: z.array(Int),        // practices per tenth of the points, 0-99 up to 900-1000
    systems: z.array(S({ id: z.string(), players: Int, meanPoints: z.number(), flagshipHits: Int })),
  }).nullable(),
  slide: SlideView.nullable(),      // only while the scene is 'slides'
  activity: S({ players: Int, acted: Int, insights: Int, sent: Int }).nullable(),   // the room in a play stage
  // "Follow the game" in a play stage: what the projector rotates through, in a loop on the wall
  // clock. Null when the host pinned a scene, outside play, and when the pack has no programme.
  programme: z.array(S({ show: ProgrammeShow, seconds: Int })).nullable(),
  // What the room just did, newest first. A line names the practice and the source of an
  // insight (a person, a data pull), never what was learned and never a class.
  feed: z.array(S({ name: Text, avatar: AvatarId, system: z.string(), kind: z.enum(['started', 'finished', 'sent', 'validated', 'deployed']), text: Text.nullable(), atMs: Ms })),
  // One phase, the health systems side by side: the phase the host picked, or the running one.
  phaseBoard: S({
    phase: PhaseId, state: z.enum(['empty', 'live', 'final']), label: Text, of: Int.optional(),
    systems: z.array(S({ id: z.string(), rows: z.array(BoardRow) })),
  }).nullable(),
  // Practices the rotation looks at, one per round: what they work on and how far they are.
  // Counts only. A card never shows a class or an insight.
  cards: z.array(PracticeCard),
  // Practices that got a letter of their own in the running phase (one that goes only to a
  // practice it concerns), the newest first, for the `news` turn of the programme.
  newsCards: z.array(PracticeCard),
  legends: z.array(S({ system: z.string(), legend: CanvasLegend })),   // for the maps of the cards
  winners: S({
    final: z.boolean(),             // every phase is scored. Before that: the standings so far, no podium
    overall: z.array(BoardRow),
    perSystem: z.array(S({ system: z.string(), row: BoardRow.nullable() })),
    topSystems: z.array(SystemStanding),
  }).nullable(),
})
export type ScreenView = z.infer<typeof ScreenView>
