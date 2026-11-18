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
const OptId = z.union([Id, z.literal('n/a')])
const Num = z.number().finite()
const Int = z.number().int()
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
  'earlier_join', 'earlier_submit', 'fewer_pilot_runs', 'higher_final_month_health',
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
  }),
  live_leaderboard: W({ metric: z.literal('progress'), label: Text }),
  submission: W({
    draft_autosave: z.boolean().optional(),
    early_lock: z.string().optional(),
    unsorted_allowed: z.boolean().optional(),
    auto_submit: z.boolean().optional(),
    letter_empty_below: Int.min(0).optional(),   // fewer sorted problems than this: the letter's "empty" variant
  }).optional(),
  scoring: W({
    classify: W({ exact: Num, adjacent: Num }),
    flagship: W({ bonus: Num }),
  }),
})
export type PlanningRules = z.infer<typeof PlanningRules>

const DevelopmentRules = W({
  label: Text, play_seconds: PosInt, reveal_seconds: NonNeg,
  pilot: W({ runs: Int.min(0), seconds: PosInt, concurrent: z.literal(1) }),
  offers: W({
    per_system: Int.min(0), announce_at_seconds: z.array(NonNeg),
    claim_window_seconds: PosInt, claim_fraction: Num.min(0).max(1),
  }),
  live_leaderboard: W({ label: Text }),
  scoring: W({ pilot_weight: Num, heldout_weight: Num }),
})

const MaintainingRules = W({
  label: Text, reveal_seconds: NonNeg,
  setup_seconds: PosInt, months: PosInt, month_seconds: PosInt, event_response_seconds: PosInt,
  credits: Int.min(0), actions_per_month: Int.min(0),
  live_leaderboard: W({ label: Text }),
})

export const GameFile = W({
  version: Num,
  game: W({
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
  }),
  run_of_show: z.array(W({ start: NonNeg, end: NonNeg, segment: z.enum(SEGMENTS), driver: z.string() })),
  story_time: W({
    planning: W({ span: Text, investigation_stands_for: z.record(z.string(), Text).optional() }).optional(),
    development: W({ span: Text, pilot_run_stands_for: Text.optional() }).optional(),
    maintaining: W({ span: Text, tick_stands_for: Text.optional() }).optional(),
  }).optional(),
  ladder: z.array(W({
    rung: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
    id: Id, label: Text, fits_when: Text, example: Text,
  })).length(5),
  scoring: W({
    phase_max_points: PosInt,
    normalization: W({ floor_points: NonNeg, max_points: PosInt }),
    four_metric_score: W({ weights: S({ validity: Num, reliability: Num, cost: Num, complexity: Num }) }),
    score_bands: z.array(W({ id: Id, min: Num, max: Num, label: Text.optional() })).min(1),   // label: the name a player may see
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
  }),
  text_limits: z.record(z.string(), PosInt).optional(),
  sources: z.record(z.string(), W({ paper: z.string(), locator: Text, gist: Text })),
  public_source_labels: z.record(z.string(), Text),
})
export type GameFile = z.infer<typeof GameFile>

// ------------------------------------------------------------------------------------------
// palette.yaml, monitors.yaml, characters.yaml
// ------------------------------------------------------------------------------------------
const Money = S({ visible: Num.optional(), hidden: Num.optional(), year: Num.optional() })

export const PaletteFile = W({
  components: z.array(W({
    id: Id,
    public: S({ label: Text, short: Text, description: Text, icon: z.string() }),
    tags: z.array(z.string()).optional(),
    cost: Money.optional(),
    developers: NonNeg.optional(), complexity: NonNeg.optional(), delivery_runs: Int.min(0).optional(),
    key: K({}).optional(),
  })),
})
export type PaletteFile = z.infer<typeof PaletteFile>

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

/** How a person's pixel character looks. Free words, read by the client's sprite builder. */
export const Look = W({ hair: Text.optional(), hair_style: Text.optional(), skin: Text.optional(), top: Text.optional(), detail: Text.optional() })
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
// build.yaml
// ------------------------------------------------------------------------------------------
export type Condition = {
  choice?: string; is?: string[]; is_not?: string[]; has_tag?: string
  count_tag?: string; kind?: ChoiceKind; min?: number; max?: number
  has_offer?: string
  all?: Condition[]; any?: Condition[]; not?: Condition
}
const CHOICE_KINDS = ['slot', 'link', 'tool', 'agent_setting', 'setting', 'resource'] as const
export type ChoiceKind = (typeof CHOICE_KINDS)[number]
export const Condition: z.ZodType<Condition> = z.lazy(() => S({
  choice: Id.optional(), is: z.array(OptId).optional(), is_not: z.array(OptId).optional(),
  has_tag: z.string().optional(),
  count_tag: z.string().optional(), kind: z.enum(CHOICE_KINDS).optional(),
  min: Num.optional(), max: Num.optional(),
  has_offer: Id.optional(),
  all: z.array(Condition).optional(), any: z.array(Condition).optional(), not: Condition.optional(),
}))

const OptionCostFields = {
  cost: Money.optional(),
  developers: NonNeg.optional(), complexity: NonNeg.optional(), delivery_runs: Int.min(0).optional(),
  tags: z.array(z.string()).optional(), requires_offer: Id.nullable().optional(),
}
const SlotOption = S({ ...OptionCostFields, component: Id, public_note: Text.optional() })
const ListOption = S({
  ...OptionCostFields, id: Id,
  public: S({ label: Text, description: Text.optional() }),
  adds_developers: NonNeg.optional(),
})
const listChoice = <T extends 'link' | 'tool' | 'agent_setting' | 'setting' | 'resource'>(kind: T) =>
  W({
    id: Id, kind: z.literal(kind),
    public: S({ label: Text, description: Text.optional() }),
    applies_when: Condition.optional(),
    default: Id,
    options: z.array(ListOption).min(1),
  })
const Choice = z.discriminatedUnion('kind', [
  W({ id: Id, kind: z.literal('slot'), public: S({ label: Text, prompt: Text.optional() }), options: z.array(SlotOption).min(1) }),
  listChoice('link'), listChoice('tool'), listChoice('agent_setting'), listChoice('setting'), listChoice('resource'),
])
export type Choice = z.infer<typeof Choice>
const Trace = S({ when: Condition, trace: Text, priority: Num, source: SourceIds.optional() })
const Design = z.record(z.string(), OptId)

export const BuildFile = W({
  problem: Id,
  board: W({
    nodes: z.array(W({ id: Id, label: Text, kind: z.enum(['system', 'person']) })),
    flow: z.array(Id),
    links: z.array(z.tuple([Id, Id])).optional(),
  }),
  budget: W({ cost: W({ par: Num, ceiling: Num }), complexity: W({ par: Num, ceiling: Num }) }),
  team: W({ developers: NonNeg }),
  choices: z.array(Choice).min(1),
  rules: z.array(W({
    id: Id, when: Condition,
    effects: S({ cost: Num.optional(), cost_year: Num.optional(), complexity: Num.optional(), developers: Num.optional() }),
    key: K({}).optional(),
  })).optional(),
  advisories: z.array(Trace).optional(),
  cases: z.array(W({
    id: Id, set: z.enum(['pilot', 'heldout']), dimension: z.enum(['validity', 'reliability']),
    weight: Num.positive().optional(),
    public: S({ title: Text, text: Text }),
    fails_when: z.array(Trace).optional(),
    extra_cost: z.array(S({ when: Condition, cost: Num, note: Text.optional() })).optional(),
    key: K({}).optional(),
  })),
  offers: z.array(W({
    id: Id, index: PosInt,
    public: S({ title: Text, text: Text, trade_off: Text }),
    pilot_runs: Int,
    key: K({ verdict: z.enum(['take', 'leave', 'depends']).optional(), rationale: Text.optional() }).optional(),
  })).optional(),
  key: K({
    reference: K({ design: Design, rationale: z.record(z.string(), Text), public_summary: Text }),
    traps: z.array(K({ id: Id, kind: z.enum(['overbuilt', 'underbuilt', 'shortcut']), design: Design })).optional(),
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
    development: W({ from: Id, title: Text, text: Text }).optional(),
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
const Slide = W({ id: Id, title: Text, bullets: z.array(Text), live_stat: z.string().optional(), notes: Text.optional() })
export const HelpSlidesFile = W({
  intro: z.array(Slide).optional(),
  breaks: W({
    after_planning: z.array(Slide).optional(),
    after_development: z.array(Slide).optional(),
    after_maintaining: z.array(Slide).optional(),
  }),
  reflection_prompts: z.array(Text).optional(),
})
export type HelpSlidesFile = z.infer<typeof HelpSlidesFile>

/** teaching/deck.yaml: the one deck of the session, in sections. */
export const DeckSlide = W({
  id: Id, title: Text, bullets: z.array(Text),
  image: z.string().optional(), live_stat: z.string().optional(), notes: Text.optional(), placeholder: z.boolean().optional(),
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
