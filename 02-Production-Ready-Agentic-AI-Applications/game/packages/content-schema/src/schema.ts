// Schemas of the pack files (engineering spec, section 5.5).
//
// Three kinds of object:
//   S  strict. An unknown field is an error. Used inside `public`, options, costs, effects,
//      conditions and events, where a typo would change a result.
//   W  warn. An unknown field is accepted and reported as a warning with its path.
//   K  key. Read loosely: the typed fields are checked, every other field is carried silently.
import { z } from 'zod'

// ------------------------------------------------------------------------------------------
// Warning collection. The loader parses twice: once collecting warnings as issues marked
// `warning`, and once with collection off to obtain the data.
// ------------------------------------------------------------------------------------------
let collectWarnings = false
export function setCollectWarnings(on: boolean): void {
  collectWarnings = on
}

type Shape = Record<string, z.ZodType>

const S = <T extends Shape>(shape: T) => z.strictObject(shape)
const K = <T extends Shape>(shape: T) => z.looseObject(shape)
const W = <T extends Shape>(shape: T) =>
  z.looseObject(shape).superRefine((value, ctx) => {
    if (!collectWarnings) return
    for (const k of Object.keys(value)) {
      if (!(k in shape) && k !== 'source') {
        ctx.addIssue({ code: 'custom', message: `unknown field "${k}"`, path: [k], params: { warning: true } })
      }
    }
  })

// ------------------------------------------------------------------------------------------
// Basic types
// ------------------------------------------------------------------------------------------
export const Text = z.string()
const Id = z.string().regex(/^[a-z0-9][a-z0-9_-]*$/, 'ids are lowercase letters, digits, hyphens and underscores')
const Num = z.number().finite()
const Int = z.number().int()
// A rule of the pack that the loader does not read yet: the rulebook of Phases 2 and 3, and
// rules that only the content tools read (tools/render_key.py and tools/lab_scoring.py of the
// private side). Declaring it keeps check:content quiet on the real pack while a misspelled
// field still warns. Each one gets its real type when the code that reads it is built.
const Later = z.unknown().optional()
const NonNeg = Num.min(0)
const PosInt = Int.min(1)
const SourceIds = z.array(z.string())

export const PHASES = ['planning', 'development', 'maintaining'] as const
export const PhaseId = z.enum(PHASES)
export type PhaseId = z.infer<typeof PhaseId>
export const METRICS = ['validity', 'reliability', 'cost', 'complexity'] as const
export const Metric = z.enum(METRICS)
export type Metric = z.infer<typeof Metric>
export const METHODS = ['interview', 'data_pull', 'audit', 'observation'] as const
export const Method = z.enum(METHODS)
export type Method = z.infer<typeof Method>
const SystemId = Id

/** Run-of-show segments. Each maps to a stage of the session (engine, section 6.3). */
export const SEGMENTS = [
  'join', 'intro_slides', 'planning', 'help_slides_1', 'development', 'help_slides_2',
  'maintaining', 'help_slides_3', 'reflection', 'winners',
] as const

/** Tie-break keys the engine implements (section 6.9). */
export const TIE_KEYS = [
  'total_points', 'planning_points', 'development_points', 'maintaining_points', 'points',
  'earlier_join', 'earlier_submit', 'fewer_validations', 'fewer_pilot_runs', 'higher_last_period_value',
] as const
const TieKey = z.enum(TIE_KEYS)

// ------------------------------------------------------------------------------------------
// game.yaml
// ------------------------------------------------------------------------------------------
const RungLit = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)])

const PlanningClass = W({
  id: Id, label: Text, short: Text, fits_when: Text,
  rungs: z.array(RungLit),
  capacity: PosInt,                      // the spots of the class on the board. Equals its class_mix
})
export type PlanningClass = z.infer<typeof PlanningClass>

const PlanningRules = W({
  label: Text, play_seconds: PosInt, reveal_seconds: NonNeg,
  candidates: PosInt,
  classes: z.array(PlanningClass).min(2),
  class_order: z.array(Id).min(2),
  class_mix: z.record(z.string(), Int.min(0)),
  flagship_class: Id,
  show_class_mix: z.literal(true),
  investigations: W({
    per_system: PosInt,
    story: Int.min(0).optional(),        // read by the private checker only
    bandwidth: PosInt,
    levels: z.array(W({ bandwidth: PosInt, seconds: PosInt })).min(1),
    method_levels: z.partialRecord(Method, z.array(PosInt)),
    total_work: W({ min: NonNeg, max: NonNeg }),
    reachable_work: NonNeg,
    parallel: z.literal(true),
    cancel: z.literal('none'),
    board_stays_usable_while_running: Later, methods: Later, method_mix: Later,
  }),
  live_leaderboard: W({ metric: z.literal('progress'), label: Text, correctness_hidden: Later }),
  submission: W({
    draft_autosave: z.boolean().optional(),
    early_lock: z.string().optional(),
    unsorted_allowed: z.boolean().optional(),
    auto_submit: z.boolean().optional(),
    letter_empty_below: Int.min(0).optional(),   // fewer sorted problems than this: the letter's "empty" variant
  }).optional(),
  scoring: W({
    classify: W({ exact: Num, adjacent: Num, other: Later, max: Later }),
    flagship: W({ bonus: Num, max: Later }),
    // Up to `max` for the investigations a player did not start, in proportion to how well the
    // board is sorted (section 6.5). Without it the investigations do not count.
    economy: W({ max: NonNeg, counts: Later }).optional(),
  }),
  slot_seconds: Later, teaches: Later, traps_required: Later, evidence: Later,
})
export type PlanningRules = z.infer<typeof PlanningRules>

// Phase 2 on a canvas (spec, section 5.5). The fields of the slot board of the first version
// (pilot, offers, the four sub-scores) are gone: a pack that still holds them loads, and each
// gives a warning, so that Phase 1 plays while the content catches up.
export const ACTION_GROUPS = ['learn', 'build', 'buy', 'negotiate'] as const
const DevelopmentRules = W({
  label: Text, play_seconds: PosInt, reveal_seconds: NonNeg,
  board: z.literal('canvas').optional(),          // required once a health system has a build.yaml
  action_groups: z.array(W({ id: Id, label: Text })).min(1).optional(),
  show_running: z.boolean().optional(),           // show what the map would take to run. Never scored here
  money_unit: Text.optional(),                    // what one unit of money is, written after a sum, such as k$
  // Each of these has one implemented value, which the loader asks for once `board` is canvas.
  submission: W({
    default: z.string().optional(),               // best_validation
    player_may_choose: z.string().optional(),     // any_own_validation
    none_at_the_end: z.string().optional(),       // validate_the_draft_if_ready
  }).optional(),
  live_leaderboard: W({ label: Text, metric: z.string().optional() }),   // best_validation_accuracy
  scoring: Later, carries_over: Later,
  slot_seconds: Later, teaches: Later,
})
export type DevelopmentRules = z.infer<typeof DevelopmentRules>

// Phase 3 (spec, section 5.5): the year in rounds. A round is the time to act before the report
// of the next period. The phase plays `rounds` of them, each `round_seconds` long, and the last
// one takes what `play_seconds` leaves over.
const MaintainingRules = W({
  label: Text, reveal_seconds: NonNeg,
  rounds: PosInt, round_seconds: PosInt,
  // The play time. Absent: rounds times round_seconds. Given: at least that, and less than one
  // round more.
  play_seconds: PosInt.optional(),
  // The groups of actions that Phase 3 adds, shown after the groups of development.
  action_groups: z.array(W({ id: Id, label: Text })).default([]),
  live_leaderboard: W({ label: Text, metric: z.string().optional() }),   // year_score_so_far
  slot_seconds: Later, teaches: Later, scoring: Later,
})
export type MaintainingRules = z.infer<typeof MaintainingRules>

export const GameFile = W({
  version: Num,
  status: Later, updated: Later, timing_model: Later,
  game: W({
    design_capacity_players: Later, load_test_players: Later,
    title: Text.nullable(),
    phase_order: z.tuple([z.literal('planning'), z.literal('development'), z.literal('maintaining')]),
    health_systems: z.array(SystemId).min(1),
  }),
  join: W({
    assignment: z.literal('balanced'),
    tie_order: z.array(SystemId),
    choose_system_in_modes: z.array(z.enum(['test', 'rehearsal', 'event'])).optional(),
    practice_name: W({
      min_chars: PosInt, max_chars: PosInt, unique_per_session: z.literal(true),
      filter_profanity: z.boolean(), host_can_rename: z.boolean(), host_can_remove: z.boolean(),
    }),
    reconnect: z.literal('token'),
    late_join: W({
      // The last phase a newcomer may enter. Joining closes when that phase starts.
      open_until: W({ phase: PhaseId }),
      missed_phase_points: z.literal(0),
      // Nobody enters a phase in play: who joins then waits for the next phase.
      mid_phase: z.literal('wait_for_next_phase'),
    }),
  }),
  clock: W({
    time_scale_default: Num.positive(),
    warnings_seconds_left: z.array(PosInt),
    idle_seconds: PosInt.optional(),
    auto_submit_at_zero: z.literal(true),
    pause_freezes: z.literal('all'),
    unit: Later, host_controls: Later, disconnect: Later,
  }),
  run_of_show: z.array(W({ start: NonNeg, end: NonNeg, segment: z.enum(SEGMENTS), driver: z.string() })),
  story_time: W({
    planning: W({ span: Text, investigation_stands_for: z.record(z.string(), Text).optional() }).optional(),
    development: W({ span: Text, pilot_run_stands_for: Text.optional() }).optional(),
    maintaining: W({ span: Text, tick_stands_for: Text.optional() }).optional(),
    rule: Later, no_idle_rule: Later,
  }).optional(),
  ladder: z.array(W({
    rung: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
    id: Id, label: Text, fits_when: Text, example: Text,
  })).length(5),
  scoring: W({
    phase_max_points: PosInt,
    normalization: W({ floor_points: NonNeg, max_points: PosInt, method: Later, anchors_measured_by: Later }),
    four_metric_score: W({ weights: S({ validity: Num, reliability: Num, cost: Num, complexity: Num }), cost_and_complexity_scaled_by: Later }),
    score_bands: z.array(W({ id: Id, min: Num, max: Num, label: Text.optional() })).min(1),   // label: the name a player may see
    total_max_points: Later, carry_over: Later, rounding: Later,
  }),
  phases: W({ planning: PlanningRules, development: DevelopmentRules, maintaining: MaintainingRules }),
  leaderboards: W({
    columns: z.tuple([z.literal('overall'), z.literal('planning'), z.literal('development'), z.literal('maintaining')]),
    refresh_seconds: PosInt,
    big_screen_rows: PosInt,
    tie_breaks: W({
      overall: z.array(TieKey), planning: z.array(TieKey),
      development: z.array(TieKey), maintaining: z.array(TieKey),
    }),
    winners: W({ overall_top: PosInt, per_system_top: PosInt, top_system: PosInt }),
    // What "Follow the game" shows on the projector while a phase is played (section 6.13).
    projector: W({
      feed_rows: PosInt,
      cards: PosInt,
      programme: z.array(W({ show: z.enum(['activity', 'phase_board', 'player', 'news']), seconds: PosInt })).min(1),
    }).optional(),
    filters: Later, systems_strip: Later, live_column: Later, live_column_marked: Later,
    planning_live: Later, overall_during_play: Later, player_sees: Later, system_score: Later,
  }),
  text_limits: z.record(z.string(), PosInt).optional(),
  sources: z.record(z.string(), W({ paper: z.string(), locator: Text, gist: Text })),
  public_source_labels: z.record(z.string(), Text),
})
export type GameFile = z.infer<typeof GameFile>

// ------------------------------------------------------------------------------------------
// characters.yaml
// ------------------------------------------------------------------------------------------
/** How a person's pixel character looks: free words, read by the client's sprite builder (11.4). */
export const HAIR_STYLES = ['short', 'long', 'bald', 'covered'] as const
export const Look = W({ hair: Text, hair_style: z.enum(HAIR_STYLES), skin: Text, top: Text, detail: Text.optional() })
export type Look = z.infer<typeof Look>

export const CharactersFile = z.array(W({
  id: Id,
  system: z.union([SystemId, z.literal('all')]),
  public: S({ name: Text, role: Text, portrait: z.string() }),
  extra: z.boolean().optional(),         // a person with no interview and no letter, who still lives in the scene
  click_lines: z.array(Text).optional(), // what the person says when clicked
  look: Look.optional(),
  key: K({}).optional(),                 // authoring notes (voice, portrait prompt), never read
}))
export type CharactersFile = z.infer<typeof CharactersFile>

// ------------------------------------------------------------------------------------------
// system.yaml, problems.yaml, insights.yaml
// ------------------------------------------------------------------------------------------
const Anchor = Num.nullable()
const Calibration = W({ zero: Anchor, floor: Anchor, ceiling: Anchor, provisional: z.boolean() })

export const SystemFile = W({
  id: SystemId,
  slug: z.string(),
  public: S({
    name: Text, setting: Text, premise: Text,
    practice_profile: z.array(S({ label: Text, value: z.union([Text, Num]) })),
    baseline: z.array(S({ label: Text, value: z.union([Text, Num]), unit: Text.optional() })),
    cast: z.array(Id),
  }),
  key: K({ flagship_problem: Id, summary: Text.optional() }),
  calibration: W({ planning: Calibration, development: Calibration, maintaining: Calibration }),
})
export type SystemFile = z.infer<typeof SystemFile>

export const ProblemsFile = z.array(W({
  id: Id,
  public: S({ title: Text, description: Text }),
  key: K({
    real: z.boolean(),
    class: Id,                           // the true answer of Phase 1
    tier: RungLit.nullable(),
    flagship: z.boolean(),
    rationale: Text,
    burden: K({ kind: z.string(), size: z.string(), note: Text }).optional(),
    source: SourceIds.optional(),
  }),
}))
export type ProblemsFile = z.infer<typeof ProblemsFile>

const Point = z.tuple([z.union([Text, Num]), Num])
export const Tile = z.discriminatedUnion('type', [
  S({ type: z.literal('stat'), headline: Text, body: Text,
      data: S({ value: z.union([Text, Num]), unit: Text.optional(), label: Text, comparison: Text.optional() }) }),
  S({ type: z.literal('chart'), headline: Text, body: Text,
      data: S({ kind: z.enum(['bar', 'line']), x_label: Text, y_label: Text,
                series: z.array(S({ name: Text, points: z.array(Point) })).min(1), note: Text.optional() }) }),
  S({ type: z.literal('quote'), headline: Text, body: Text,
      data: S({ speaker: Id, text: Text }) }),
  S({ type: z.literal('audit'), headline: Text, body: Text,
      data: S({ sample_size: Int.min(0), findings: z.array(S({ label: Text, count: Int.min(0) })).min(1), note: Text.optional() }) }),
])
export type Tile = z.infer<typeof Tile>

export const InsightsFile = z.array(W({
  id: Id,
  method: Method,
  character: Id.nullable(),
  public: S({ title: Text, teaser: Text }),
  bandwidth: PosInt,
  seconds: PosInt,
  tile: Tile,
  key: K({}).optional(),
}))
export type InsightsFile = z.infer<typeof InsightsFile>

// ------------------------------------------------------------------------------------------
// build.yaml: the canvas of Phases 2 and 3 (spec, section 5.5). Only the fields that the
// engine reads are typed. Everything under `key` is read loosely, and every number of quality
// stays on the server.
// ------------------------------------------------------------------------------------------
const Unit = Num.min(0).max(1)
// How much digging a fact takes at a source: easy and hard in the contract. A pack may name more
// kinds, as the reference scorer allows, as long as every worker has numbers for each.
const Effort = Id
export type Effort = z.infer<typeof Effort>
const Difficulty = z.enum(['plain', 'hard'])
export type Difficulty = z.infer<typeof Difficulty>
const Quality = S({
  fetch: z.record(Id, Unit),
  decide: S({ plain: Unit, hard: Unit }),
  catch: Unit.optional(),
  // What the worker holds of a fact without a line to a source, by fact.
  knows: z.record(Id, Unit).optional(),
})
export type Quality = z.infer<typeof Quality>

/** A tile of a map in a pack file. The engine works with `runsOn`, the file with `runs_on`. */
const MapTile = S({
  id: z.string(), kind: Id, col: Int, row: Int,
  model: Id.nullable().optional(), runs_on: Id.nullable().optional(), prompt: Id.nullable().optional(),
})
const MapSide = z.enum(['top', 'right', 'bottom', 'left'])
/** A line of a map in a pack file. `from_side` and `to_side` are optional and only change how it is drawn. */
export const PackMap = S({ tiles: z.array(MapTile), lines: z.array(S({ from: z.string(), to: z.string(), from_side: MapSide.optional(), to_side: MapSide.optional() })) })
export type PackMap = z.infer<typeof PackMap>

export const NOTE_IDS = ['rushed', 'private_data', 'overloaded', 'distracting', 'prompt', 'stray'] as const
export const WORKER_KINDS = ['ai', 'fixed', 'person'] as const

const PartPublic = S({ label: Text, short: Text, description: Text, cost_line: Text.optional() })

/** A kind of tile of the toolbox. Phase 3 may add more of them (`workers` of maintain.yaml). */
const Worker = W({
  id: Id,
  kind: z.enum(WORKER_KINDS),
  group: Id.optional(),
  public: S({ label: Text, short: Text, task: Text.optional(), description: Text, icon: z.string(), cost_line: Text.optional() }),
  needs_model: z.boolean(),
  by_model: z.record(z.string(), Quality).optional(),
  quality: Quality.optional(),
  load: S({ free: Int.min(0), factor: Unit }).optional(),
  calls: NonNeg.optional(),
  run: NonNeg.optional(),
  complexity: NonNeg.optional(),
  pool: Id.optional(),
  minutes: S({ decide: NonNeg, check: NonNeg, per_line: z.record(Id, NonNeg) }).optional(),
  // A tool that prepares its sources for the worker behind it: per kind of effort, the kind
  // it becomes for that worker and its weight in that worker's load (1 when absent).
  prepares: z.record(Id, S({ as: Id, load: Unit.optional() })).optional(),
  key: K({}).optional(),
})
/** An action of the list. Phase 3 adds two fields to it (`repeat`, `run`). */
const ActionShape = {
  id: Id,
  group: Id,
  public: S({ title: Text, teaser: Text }),
  money: NonNeg,
  developers: Int.min(0),
  seconds: PosInt,
  requires: z.array(Id).default([]),
  unlocks: z.array(Id).default([]),
  // `moves`: when the action is done, every tile that runs on a place named as a key runs on the
  // place named as its value, on every map the player holds, and the first place leaves the
  // shelf (an agreement that covers the calls a practice already makes).
  moves: z.record(Id, Id).optional(),
  insight: Tile.nullable().optional(),
  story_time: Text.optional(),
  key: K({}).optional(),
}
const LineRule = S({ from: Id, to: Id, refuse: z.boolean(), text: Text })

export const BuildFile = W({
  problem: Id,
  // `columns` names the stage of the work each column stands for. Names only: no rule ties a
  // worker to a column. Without it the columns keep their numbers.
  grid: S({ cols: PosInt.max(8), rows: PosInt.max(8), columns: z.array(S({ label: Text, hint: Text })).optional() }),
  // The kinds of effort a fact takes to get out of a source. Without the list they are the ones
  // the sources name. Never sent to a browser.
  efforts: z.array(W({ id: Id, key: K({}).optional() })).optional(),
  // The headings of the toolbox, in this order. Without them the toolbox is one list.
  toolbox_groups: z.array(S({ id: Id, label: Text })).default([]),
  budget: S({ money: NonNeg, developers: Int.min(0) }),
  // `free`: the first validations of the phase that do not count against `runs` (a first try under guidance).
  validate: S({ runs: Int.min(0), seconds: PosInt, free: Int.min(0).optional() }),
  // `over` says what happens when a map asks more minutes of a pool than `max`: `refuse` (the
  // default) keeps the map from being validated, `rush` lets it through and the people of the pool
  // get through a share of the cases (section 6.6).
  pools: z.array(W({ id: Id, public: S({ label: Text }), max: NonNeg, over: z.enum(['refuse', 'rush']).optional() })).default([]),
  handoff: S({ keep: Unit }),
  quality_cap: Unit.optional(),
  facts: z.array(W({
    id: Id,
    miss: S({ missing: Text, weak: Text }),
    key: K({}).optional(),
  })).min(1),
  sources: z.array(W({
    id: Id,
    public: S({ label: Text, description: Text, icon: z.string() }),
    gives: z.record(z.string(), Unit),
    effort: Effort,
    private_data: z.boolean(),
    distracts: Unit.optional(),
    run: NonNeg.optional(),
    key: K({}).optional(),
  })).min(1),
  result: W({ id: Id, public: S({ label: Text, description: Text }) }),
  workers: z.array(Worker).min(1),
  models: z.array(W({
    id: Id, public: PartPublic,
    run: NonNeg.optional(),
    runs_on: z.array(Id).min(1),
    key: K({}).optional(),
  })).default([]),
  compute: z.array(W({
    // `bill_line`: what the fixed cost of the place is called on a bill of Phase 3, such as "rent".
    id: Id, public: PartPublic.extend({ bill_line: Text.optional() }),
    protects_private_data: z.boolean(),
    price_factor: NonNeg.optional(),
    run_fixed: NonNeg.optional(),
    key: K({}).optional(),
  })).default([]),
  prompts: z.array(W({
    id: Id,
    // `samples`, when present, are shown in place of `sample`, each under its label.
    // `short` is the name on a tile, where the label of a card would be cut.
    public: S({ label: Text, short: Text.optional(), description: Text, sample: Text.optional(), samples: z.array(S({ label: Text, text: Text })).min(1).optional() }),
    fetch: Num.positive().optional(),
    decide: Num.positive().optional(),
    by_worker: z.record(z.string(), S({ fetch: Num.positive().optional(), decide: Num.positive().optional() })).optional(),
    key: K({}).optional(),
  })).default([]),
  actions: z.array(W(ActionShape)).default([]),
  cases: z.array(W({
    id: Id,
    weight: Num.positive(),
    public: S({ title: Text, text: Text }),
    needs: z.array(Id).min(1),
    difficulty: Difficulty,
    decision_miss: Text,
    key: K({}).optional(),
  })).min(1),
  notes: z.array(S({ id: z.enum(NOTE_IDS), text: Text })).default([]),
  // Lines the practice cannot draw (`refuse: true`) or should think twice about. `from` is a
  // source or a kind of worker, `to` a kind of worker. The text reaches a player only when a line
  // of theirs matches. Never in the static content.
  line_rules: z.array(LineRule).default([]),
  // Kinds of worker a map must have on a path to the result before it can be validated. The
  // text is said to the player while the entry fails.
  required: z.array(S({ workers: z.array(Id).min(1), text: Text })).default([]),
  key: K({
    reference: K({
      map: PackMap,
      needs_actions: z.array(Id).default([]),
      public_summary: Text,
      rationale: Text.optional(),
    }),
    // Every reference map: shown at the reveal of Phase 2 and offered in Phase 3. The first is
    // the map of `reference`. Without the list, `reference` is the only one.
    references: z.array(K({
      id: Id, public: S({ label: Text, summary: Text }), map: PackMap, needs_actions: z.array(Id).default([]),
    })).optional(),
    traps: z.array(K({ id: Id, kind: z.enum(['overbuilt', 'underbuilt', 'shortcut']), map: PackMap })).optional(),
    // For every kind of worker: the best way to use it and the wrong choices. A host sees it
    // beside a player's map. Never sent to a player.
    guide: z.record(Id, K({ best: Text, wrong: Text })).optional(),
  }),
})
export type BuildFile = z.infer<typeof BuildFile>

// ------------------------------------------------------------------------------------------
// maintain.yaml: Phase 3 on the canvas (spec, sections 5.5 and 6.7). A year in periods, events
// that change the tables of the scoring and the risks of the parts, and what Phase 3 adds to the
// board. Every number, every event and every `key` stays on the server.
// ------------------------------------------------------------------------------------------
export const LENSES = ['fresh_test_set', 'dry_run', 'incident_log', 'case_mix', 'drift_alarm'] as const
export type LensId = (typeof LENSES)[number]
export const MAP_FLAGS = ['private_data', 'overloaded', 'distracting', 'prompt', 'stray', 'rushed'] as const

const Factor = z.union([NonNeg, z.array(NonNeg).min(1)])
/** A change to the tables of the scoring while it holds (section 6.7, "The tables of a period"). */
export const Patch = z.discriminatedUnion('op', [
  S({ op: z.literal('weights'), cases: z.record(Id, NonNeg) }),
  S({ op: z.literal('fetch_as'), effort: Effort, as: Effort, factor: NonNeg }),
  // The keys of `fetch` are kinds of effort and of `decide` the two difficulties. "*" is every key.
  // A factor is a number, or a list by periods since the event began (the last one holds): a
  // change that grows for as long as it is left alone.
  S({ op: z.literal('worker'), worker: Id, fetch: z.record(z.string(), Factor).optional(), decide: z.record(z.string(), Factor).optional(), catch: Factor.optional() }),
  S({ op: z.literal('knows'), fact: Id, factor: NonNeg, workers: z.array(Id).min(1) }),
  S({ op: z.literal('gives'), source: Id, fact: Id, factor: NonNeg, unless_through: Id.optional() }),
  S({ op: z.literal('compute'), compute: Id, run_fixed: NonNeg.optional(), price_factor: NonNeg.optional() }),
  // The price of a model (`run`), and what every worker does with it (as the patch of a worker).
  S({ op: z.literal('model'), model: Id, run: Factor.optional(), fetch: z.record(z.string(), Factor).optional(), decide: z.record(z.string(), Factor).optional(), catch: Factor.optional() }),
])
export type Patch = z.infer<typeof Patch>

/** A risk an event adds while it acts: to lines from sources, to tiles of kinds, or to the whole system. */
const EventRisk = S({
  // `behind_connector`: the share of `line` that a line into a connector tile takes, in place
  // of the connector's own share. With 0 the event leaves such a line alone.
  sources: z.array(Id).optional(), line: Unit.optional(), behind_connector: Unit.optional(),
  // `tile`: added to every tile of these kinds, and to every tile that carries one of these models.
  workers: z.array(Id).optional(), models: z.array(Id).optional(), tile: Unit.optional(),
  all: Unit.optional(),
})
/**
 * When something of Phase 3 comes onto the board: from a round on, once the actions it
 * requires are done, once an investigation has found the events it names. Until then it is
 * not shown and cannot be used.
 */
const Appears = S({ round: PosInt.optional(), requires: z.array(Id).optional(), found: z.array(Id).optional() })
const Bands = z.array(S({ min: Num, text: Text })).min(1)

export const MaintainFile = W({
  // The periods of the planned year, one for every report: rounds + 1.
  periods: z.array(S({ id: Id, label: Text, short: Text })).min(2),
  // How the periods repeat, for the reports that added time brings after the listed ones: the
  // first `cycle` periods are one calendar year, which began in `first_year`.
  calendar: S({ cycle: PosInt, first_year: PosInt }).optional(),
  grants: z.array(S({ round: PosInt, money: NonNeg })).default([]),
  validate: S({ runs: Int.min(0), seconds: PosInt }),
  baseline: W({ public: S({ label: Text }), map: PackMap }),
  score: S({ cost_per_point: Num.positive(), pool: Id, extra_look: NonNeg.default(0), rushed: NonNeg.default(0) }),
  reliability: S({
    workers: z.record(Id, Unit).default({}),
    default_worker: Unit.default(0),
    sources: z.record(Id, Unit).default({}),
    handoff: Unit.default(0),
    compute: z.record(Id, Unit).default({}),
    connectors: z.record(Id, Unit).default({}),
    new_map: S({ risk: Unit, spared_by: z.array(Id).default([]) }).optional(),
    hardening: z.array(S({ action: Id, workers: z.array(Id).optional(), factor: NonNeg })).default([]),
    interruption: Num.positive().default(0.025),
  }),
  lenses: z.partialRecord(z.enum(LENSES), z.array(Id)).default({}),
  workers: z.array(Worker).default([]),
  line_rules: z.array(LineRule).default([]),
  // Models that exist from Phase 3 on. `by_worker`: the numbers of each kind of worker that may
  // carry it, as `by_model` of a worker in build.yaml.
  models: z.array(W({
    id: Id, public: PartPublic, run: NonNeg.optional(), runs_on: z.array(Id).min(1),
    by_worker: z.record(Id, Quality), appears: Appears.optional(), key: K({}).optional(),
  })).default([]),
  // `finds`: what the action finds when it finishes while that event acts on the map in
  // service and has shown in a report. Its card then takes the place of `insight`.
  actions: z.array(W({
    ...ActionShape, repeat: z.boolean().optional(), run: NonNeg.optional(),
    appears: Appears.optional(), finds: z.array(S({ event: Id, insight: Tile })).optional(),
  })).default([]),
  world: z.array(Patch).default([]),
  events: z.array(W({
    id: Id,
    from: PosInt, to: PosInt.optional(),
    needs: S({
      workers: z.array(Id).optional(), sources: z.array(Id).optional(), compute: z.array(Id).optional(),
      models: z.array(Id).optional(),
      flag: z.enum(MAP_FLAGS).optional(),
    }).optional(),
    patches: z.array(Patch).default([]),
    risks: z.array(EventRisk).default([]),
    fine: NonNeg.optional(),
    repaired_by: z.array(Id).default([]),
    symptom: Text.optional(),
    // Shown with the symptom to a player who holds the lens, or (without a lens) who has found the event.
    cause: S({ lens: z.enum(LENSES).optional(), text: Text }).optional(),
    alarm: Text.optional(),
    reveal: S({ title: Text, text: Text }).optional(),
    // `coach`: for the host's view of a player on whose map the event acts.
    key: K({ teaches: Text.optional(), coach: K({ holds: Text, say: Text }).optional() }).optional(),
  })).default([]),
  news: z.array(W({
    id: Id, round: PosInt, kind: z.enum(['letter', 'announcement']),
    from: Id, title: Text.optional(), text: Text,
    // Only for a practice on whose map in service that event acts, at the first round from `round` on at which it does.
    if_event: Id.optional(),
  })).default([]),
  alarm_from: Id.optional(),
  incidents: S({
    workers: z.record(Id, Text).default({}), default_worker: Text.optional(),
    sources: z.record(Id, Text).default({}), handoff: Text.optional(),
    compute: z.record(Id, Text).default({}), new_map: Text.optional(),
  }).default({ workers: {}, sources: {}, compute: {} }),
  report: W({
    validity: Bands, reliability: Bands,
    gap: Text.optional(), gap_points: Num.optional(),
    // What the people of `score.pool` say: when the map asks them once and in time, when it
    // asks them more than once, and when it asks more minutes than they have.
    radiologists: S({ content: Text, extra_look: Text, rushed: Text }).optional(),
    steady: Text.optional(),
    no_map: Text.optional(),
  }),
  key: K({
    guide: z.record(Id, K({ best: Text, wrong: Text })).optional(),
    strategy: Text.optional(),
  }).optional(),
})
export type MaintainFile = z.infer<typeof MaintainFile>

// ------------------------------------------------------------------------------------------
// story.yaml
// ------------------------------------------------------------------------------------------
const Letter = W({ from: Id, always: Text, variants: z.record(z.string(), Text) })
export const StoryFile = W({
  briefs: W({
    planning: W({ from: Id, title: Text, text: Text }).optional(),
    // `opening` is a first paragraph by the result of Phase 1: `hit` for a player whose board had
    // the flagship problem in the flagship class, `missed` for one whose board had not.
    development: W({ from: Id, title: Text, text: Text, opening: S({ hit: Text, missed: Text }).optional() }).optional(),
    maintaining: W({ from: Id, title: Text, text: Text }).optional(),
  }).optional(),
  letters: W({
    planning_reveal: Letter.optional(), development_reveal: Letter.optional(), maintaining_reveal: Letter.optional(),
  }).optional(),
  dialogue: z.array(W({
    id: Id, speaker: Id, text: Text,
    trigger: S({ phase: PhaseId, on: z.string().regex(/^(start|idle|run_result|reveal|insight:.+|trace:.+|event:.+|month:\d+)$/) }),
  })).optional(),
  announcements: z.array(W({
    id: Id, phase: PhaseId, offer: Id.optional(), at_seconds: NonNeg.nullable().optional(),
    from: Id, text: Text,
  })).optional(),
  banter: z.array(W({ id: Id, lines: z.array(S({ speaker: Id, text: Text })).min(2).max(3) })).optional(),
})
export type StoryFile = z.infer<typeof StoryFile>

// ------------------------------------------------------------------------------------------
// teaching/
// ------------------------------------------------------------------------------------------


/** teaching/deck.yaml: the one deck of the session, in sections. */
/** The room statistics a slide may show (section 6.10). */
export const ROOM_STATS = [
  'flagship_hit_rate', 'sorting_by_class', 'sorting_by_problem', 'flagship_by_system', 'most_reported_decoy', 'class_confusion', 'median_pilot_runs', 'most_common_trace',
  'pilot_to_heldout_drop', 'share_overbuilt', 'monitors_funded', 'silent_events_caught_early', 'most_missed_event',
] as const

/**
 * How a slide is laid out (section 10.9). `bullets` is the plain slide and the default. `phase`
 * opens a part of the session with a few large words. `shot` gives most of the slide to its
 * picture, such as a screenshot of the game, with a few lines beside it.
 */
export const SLIDE_LAYOUTS = ['bullets', 'title', 'cards', 'figures', 'closing', 'standings', 'phase', 'shot'] as const
/** The colors a box of a slide may take. They are the colors of the design system. */
export const SLIDE_TONES = ['go', 'sky', 'sun', 'lav', 'rose'] as const

export const DeckSlide = W({
  id: Id, title: Text, bullets: z.array(Text).default([]),
  layout: z.enum(SLIDE_LAYOUTS).optional(),
  /** A short line over the title, such as "Phase 2". */
  kicker: Text.optional(),
  subtitle: Text.optional(),
  /** Boxes side by side: a colored head with an optional tag, a title and a text. */
  /** `system` names a health system: the box then takes that system's color and shape, as everywhere in the game. */
  cards: z.array(W({ title: Text, text: Text.optional(), points: z.array(Text).max(4).optional(), tag: Text.optional(), tone: z.enum(SLIDE_TONES).optional(), system: Id.optional() })).max(4).optional(),
  /** The people who give the session. `photo` is a path under art/. */
  people: z.array(W({ name: Text, role: Text.optional(), photo: z.string().optional() })).max(6).optional(),
  /**
   * Pictures one under the other, each with a title and a caption. Without an image a colored box
   * stands in its place: it carries `mark` (a few words, such as "in press"), or the caption when
   * there is no mark.
   */
  figures: z.array(W({ image: z.string().optional(), title: Text, caption: Text.optional(), mark: Text.optional(), tone: z.enum(SLIDE_TONES).optional() })).max(3).optional(),
  /** A QR code: the address where the room joins, or a link of the pack. A link without a url shows an empty frame. */
  qr: W({ show: z.enum(['join', 'link']), url: z.string().url().optional(), label: Text.optional() }).optional(),
  /**
   * A sentence that tells the room which passcode a single-player game asks for, on a closing
   * slide. The server puts the passcode in place of `{passcode}` when it shows the slide, so the
   * pack never holds it. While single-player games ask for no passcode the sentence is left out.
   */
  solo_passcode: Text.refine((t) => t.includes('{passcode}'), 'solo_passcode needs {passcode} where the passcode goes').optional(),
  /** Lines to read later, such as the articles behind the session. */
  references: z.array(Text).max(6).optional(),
  image: z.string().optional(),
  /** Up to two more pictures that stand beside `image` in one row (layout `shot`). */
  images: z.array(z.string()).max(2).optional(),
  /** The leaderboard of the game on a slide (layout `standings`): how many players it names, and how many of them stand out at the top. */
  standings: W({ rows: PosInt.max(12).default(10), highlight: z.number().int().min(0).max(5).default(3) }).optional(),
  /** One room statistic, or two that stand one under the other. */
  live_stat: z.union([z.enum(ROOM_STATS), z.array(z.enum(ROOM_STATS)).min(1).max(2)]).optional(),
  notes: Text.optional(), placeholder: z.boolean().optional(),
})
export const DeckFile = W({
  sections: z.array(W({ id: Id, title: Text, stage: z.string(), slides: z.array(DeckSlide).min(1) })).min(1),
})
export type DeckFile = z.infer<typeof DeckFile>

export const ReportCardFile = W({
  sections: z.array(W({
    id: Id, title: Text,
    lines: z.array(W({ when: z.record(z.string(), z.union([z.string(), Num, z.boolean()])), text: Text, source: SourceIds.optional() })),
  })),
  closing: z.record(z.string(), Text),
  links: z.array(W({ label: Text, url: z.string() })).optional(),
})
export type ReportCardFile = z.infer<typeof ReportCardFile>
