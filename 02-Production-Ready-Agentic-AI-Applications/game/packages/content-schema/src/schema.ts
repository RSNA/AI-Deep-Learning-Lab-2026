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
  'earlier_join', 'earlier_submit', 'fewer_validations', 'fewer_pilot_runs', 'higher_final_month_health',
  'fewer_credits_spent',
] as const
const TieKey = z.enum(TIE_KEYS)

const MetricDeltas = S({
  validity: Num.optional(), reliability: Num.optional(), cost: Num.optional(), complexity: Num.optional(),
})

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

const MaintainingRules = W({
  label: Text, reveal_seconds: NonNeg,
  setup_seconds: PosInt, months: PosInt, month_seconds: PosInt, event_response_seconds: PosInt,
  credits: Int.min(0), actions_per_month: Int.min(0),
  live_leaderboard: W({ label: Text, metric: Later }),
  slot_seconds: Later, play_seconds: Later, teaches: Later, action_kinds: Later,
  actions_per_system: Later, monitors_locked_after_setup: Later, events_per_system: Later,
  max_events_revealed_per_month: Later, scoring: Later,
})

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
      open_until: W({ phase: PhaseId, month: PosInt.optional() }),
      missed_phase_points: z.literal(0),
      mid_phase: z.literal('full_budget_remaining_clock'),
      maintaining_after_setup: z.literal('inherit_do_nothing'),
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
      programme: z.array(W({ show: z.enum(['activity', 'phase_board', 'player']), seconds: PosInt })).min(1),
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
// monitors.yaml, characters.yaml
// ------------------------------------------------------------------------------------------
export const MonitorsFile = W({
  monitors: z.array(W({
    id: Id,
    public: S({ label: Text, description: Text, icon: z.string() }),
    credits: Int.min(0),
    upkeep: MetricDeltas.optional(),
    key: K({}).optional(),
  })),
})
export type MonitorsFile = z.infer<typeof MonitorsFile>

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
export const PackMap = S({ tiles: z.array(MapTile), lines: z.array(S({ from: z.string(), to: z.string() })) })
export type PackMap = z.infer<typeof PackMap>

export const NOTE_IDS = ['rushed', 'private_data', 'overloaded', 'distracting', 'prompt', 'stray'] as const
export const WORKER_KINDS = ['ai', 'fixed', 'person'] as const

const PartPublic = S({ label: Text, short: Text, description: Text, cost_line: Text.optional() })

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
  validate: S({ runs: Int.min(0), seconds: PosInt }),
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
  workers: z.array(W({
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
  })).min(1),
  models: z.array(W({
    id: Id, public: PartPublic,
    run: NonNeg.optional(),
    runs_on: z.array(Id).min(1),
    key: K({}).optional(),
  })).default([]),
  compute: z.array(W({
    id: Id, public: PartPublic,
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
  actions: z.array(W({
    id: Id,
    group: Id,
    public: S({ title: Text, teaser: Text }),
    money: NonNeg,
    developers: Int.min(0),
    seconds: PosInt,
    requires: z.array(Id).default([]),
    unlocks: z.array(Id).default([]),
    insight: Tile.nullable().optional(),
    story_time: Text.optional(),
    key: K({}).optional(),
  })).default([]),
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
  line_rules: z.array(S({ from: Id, to: Id, refuse: z.boolean(), text: Text })).default([]),
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
    traps: z.array(K({ id: Id, kind: z.enum(['overbuilt', 'underbuilt', 'shortcut']), map: PackMap })).optional(),
  }),
})
export type BuildFile = z.infer<typeof BuildFile>

// ------------------------------------------------------------------------------------------
// maintain.yaml
// ------------------------------------------------------------------------------------------
const EventOption = S({
  id: Id,
  public: S({ label: Text, text: Text }),
  available: z.enum(['both', 'early', 'late']).optional(),
  requires_monitor: Id.nullable().optional(),
  effects: MetricDeltas.optional(),
  stops_drift: z.boolean().optional(),
  restore: Num.min(0).max(1).optional(),
  arms: z.array(Id).optional(), disarms: z.array(Id).optional(),
  grants_monitor: Id.nullable().optional(),
  key: K({ verdict: z.enum(['best', 'acceptable', 'poor']).optional(), rationale: Text.optional() }).optional(),
})
export const MaintainFile = W({
  start: S({ validity: Num, reliability: Num, cost: Num, complexity: Num }),
  monitors: z.record(z.string(), W({ public: S({ local_note: Text }) })).optional(),
  actions: z.array(W({
    id: Id, kind: z.enum(['look', 'change']),
    public: S({ label: Text, text: Text }),
    credits: Int.min(0), once: z.boolean().optional(),
    months: S({ from: PosInt.optional(), to: PosInt.optional() }).optional(),
    reveals: z.array(Id).optional(), effects: MetricDeltas.optional(),
    disarms: z.array(Id).optional(), arms: z.array(Id).optional(),
    key: K({ verdict: z.enum(['good', 'depends', 'poor']).optional(), rationale: Text.optional() }).optional(),
  })),
  events: z.array(S({
    id: Id, archetype: z.string(),
    requires_trigger: z.boolean().optional(),
    onset: z.union([S({ month: PosInt }), S({ after_trigger: Int.min(0) })]),
    detect: S({ loud: z.boolean().optional(), monitors: z.array(Id).optional(), late_after_months: Int.min(0).nullable().optional() }),
    drift: MetricDeltas.optional(),
    public: S({ early: S({ title: Text, text: Text }), late: S({ title: Text, text: Text }) }),
    default_option: Id,
    options: z.array(EventOption).min(1),
    key: K({ teaches: Text.optional() }).optional(),
  })),
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
    planning_reveal: Letter.optional(), development_reveal: Letter.optional(), annual_review: Letter.optional(),
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
  'flagship_hit_rate', 'sorting_by_class', 'flagship_by_system', 'most_reported_decoy', 'class_confusion', 'median_pilot_runs', 'most_common_trace',
  'pilot_to_heldout_drop', 'share_overbuilt', 'monitors_funded', 'silent_events_caught_early', 'most_missed_event',
] as const

/** How a slide is laid out (section 10.9). `bullets` is the plain slide and the default. */
export const SLIDE_LAYOUTS = ['bullets', 'title', 'cards', 'figures', 'closing'] as const
/** The colors a box of a slide may take. They are the colors of the design system. */
export const SLIDE_TONES = ['go', 'sky', 'sun', 'lav', 'rose'] as const

export const DeckSlide = W({
  id: Id, title: Text, bullets: z.array(Text).default([]),
  layout: z.enum(SLIDE_LAYOUTS).optional(),
  subtitle: Text.optional(),
  /** Boxes side by side: a colored head with an optional tag, a title and a text. */
  /** `system` names a health system: the box then takes that system's color and shape, as everywhere in the game. */
  cards: z.array(W({ title: Text, text: Text.optional(), points: z.array(Text).max(4).optional(), tag: Text.optional(), tone: z.enum(SLIDE_TONES).optional(), system: Id.optional() })).max(4).optional(),
  /** The people who give the session. `photo` is a path under art/. */
  people: z.array(W({ name: Text, role: Text.optional(), photo: z.string().optional() })).max(6).optional(),
  /** Pictures side by side, each with a title and a caption. Without an image the title stands in a box. */
  figures: z.array(W({ image: z.string().optional(), title: Text, caption: Text.optional(), tone: z.enum(SLIDE_TONES).optional() })).max(3).optional(),
  /** A QR code: the join link of the session, or a link of the pack. A link without a url shows an empty frame. */
  qr: W({ show: z.enum(['join', 'link']), url: z.string().url().optional(), label: Text.optional() }).optional(),
  /** Lines to read later, such as the articles behind the session. */
  references: z.array(Text).max(6).optional(),
  image: z.string().optional(),
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
