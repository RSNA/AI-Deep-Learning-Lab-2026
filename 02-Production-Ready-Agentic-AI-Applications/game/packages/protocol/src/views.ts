// Everything a browser may receive (engineering spec, sections 8.3, 8.4 and 9.2).
// Every schema is strict: an unknown field stops the message before it is sent.
import { z } from 'zod'
import { AvatarId, Method, Mode, PhaseId, ProgrammeShow, SceneId, StageId, Theme } from './ids.ts'

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
  rules: S({ bandwidth: Int, classes: z.array(PlanningClass) }),   // classes in class_order
  problems: z.array(S({ id: z.string(), title: Text, description: Text })),
  investigations: z.array(S({
    id: z.string(), method: Method, character: z.string().nullable(),
    title: Text, teaser: Text, bandwidth: Int, seconds: z.number(), storyTime: Text.nullable(),
  })),
})
export type PlanningContent = z.infer<typeof PlanningContent>

/** Phase 2 and Phase 3 content are added by their build steps. */
export const PhaseContent = z.discriminatedUnion('phase', [PlanningContent])
export type PhaseContent = z.infer<typeof PhaseContent>

// ------------------------------------------------------------------------------------------
// Slides (one deck per session). A slide reaches a browser only while it is shown.
// ------------------------------------------------------------------------------------------
export const SLIDE_LAYOUTS = ['bullets', 'title', 'cards', 'figures', 'closing'] as const
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
  cards: z.array(S({ title: Text, text: Text.nullable(), points: z.array(Text), tag: Text.nullable(), tone: SlideTone })),
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
  charts: z.array(S({ title: Text, bars: z.array(S({ label: Text, value: z.number().nullable(), note: Text.nullable(), tone: SlideTone })) })),
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
    classify: z.number(), flagship: z.number(),      // the two parts of the score
  }).nullable(),
})
export type PlanningView = z.infer<typeof PlanningView>

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
  development: z.null(),            // Step 7 defines DevelopmentView
  maintaining: z.null(),            // Step 9 defines MaintainingView
  inbox: z.array(InboxItem),
  reportCard: z.null(),             // Step 9 defines the report card
  slide: SlideView.nullable(),      // the slide the host mirrors to every player, outside play
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
  code: z.string(), label: Text, title: Text.nullable(), mode: Mode,
  systems: z.array(SystemRef),
  joinUrl: z.string(),
  phaseLabels: S({ planning: Text, development: Text, maintaining: Text }),
})
export type SessionInfo = z.infer<typeof SessionInfo>

// ------------------------------------------------------------------------------------------
// The big screen
// ------------------------------------------------------------------------------------------
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
  feed: z.array(S({ name: Text, avatar: AvatarId, system: z.string(), kind: z.enum(['started', 'finished', 'sent']), text: Text.nullable(), atMs: Ms })),
  // One phase, the health systems side by side: the phase the host picked, or the running one.
  phaseBoard: S({
    phase: PhaseId, state: z.enum(['empty', 'live', 'final']), label: Text, of: Int.optional(),
    systems: z.array(S({ id: z.string(), rows: z.array(BoardRow) })),
  }).nullable(),
  // Practices the rotation looks at, one per round: what they work on and how far they are.
  // Counts only. A card never shows a class or an insight.
  cards: z.array(S({
    name: Text, avatar: AvatarId, system: z.string(),
    now: z.array(Text),             // what runs at this moment
    facts: z.array(S({ label: Text, value: Text })),
  })),
  winners: S({
    final: z.boolean(),             // every phase is scored. Before that: the standings so far, no podium
    overall: z.array(BoardRow),
    perSystem: z.array(S({ system: z.string(), row: BoardRow.nullable() })),
    topSystems: z.array(SystemStanding),
  }).nullable(),
})
export type ScreenView = z.infer<typeof ScreenView>
