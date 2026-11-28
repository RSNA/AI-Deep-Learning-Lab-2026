// A year of Phase 3 as a view, for the tests of the client. Made-up content in the library
// setting of the demo pack: no game content.
import type { CanvasMap, MaintainingView } from '@lab02/protocol'

type Report = MaintainingView['reports'][number]
type Entry = MaintainingView['validations'][number]

const map = (n: number): CanvasMap => ({
  tiles: Array.from({ length: n }, (_, i) => ({ id: `t${i + 1}`, kind: 'clerk', col: i + 1, row: 1, model: null, runsOn: null, prompt: null })),
  lines: [{ from: 's-catalog', to: 't1' }],
})

export const entry = (id: string, origin: Entry['origin'], over: Partial<Entry> = {}): Entry => ({
  id, atMs: 0, map: map(origin === 'reference' ? 3 : 1), accuracy: 0.8, unhurried: null, missed: null, note: null, running: null,
  origin, label: origin === 'reference' ? 'Map A' : null, reference: origin === 'reference' ? 'lean' : null, fresh: false, reliability: null, ...over,
})

export const report = (period: number, over: Partial<Report> = {}): Report => ({
  period, label: `Months ${2 * period - 1} and ${2 * period}`, short: `P${period}`, atMs: 0, map: 'v1',
  validity: 0.9, test: 0.94, reliability: 0.85, interruptions: 6, value: 76.5, off: 0, runCost: 4.4, fine: 0,
  bill: [{ label: 'Reading room link: model calls', money: 2.4 }, { label: 'Reading room link: monthly fee', money: 2 }], granted: 0, account: 37.6,
  spent: 66.4, score: 73.2,
  rank: 3, of: 40,
  sentences: { validity: 'Most loans came back on the right shelf.', reliability: 'The desk was closed on six days.', gap: null, people: 'The librarians are content.', steady: null, noMap: null },
  missed: { title: 'A book lent twice', text: 'Two readers held the same copy.', why: 'The shelf list was never read.', hint: 'Nothing on this map reads the shelf list. Give it a line to a tile that can read it.' }, note: null,
  worstPart: { label: 'Sorting agent', text: 'It looped on a cart of forty returns and timed out.' },
  worstChange: null, parts: null, kinds: null, ...over,
})

export const view = (over: Partial<MaintainingView> = {}): MaintainingView => ({
  money: 42, developers: { total: 3, free: 3 }, unlocked: [], actionsDone: [], actionsRunning: [], insights: [],
  map: map(1), ready: { ok: true, reasons: [], details: [] }, lineAdvice: [], tileMinutes: {}, rushed: [],
  flags: { stray: [], incomplete: [], privateData: [] }, running: null, validationsLeft: 6, validating: null,
  validations: [entry('v1', 'phase2'), entry('v2', 'phase2'), entry('r1', 'reference'), entry('v3', 'phase3')],
  deployed: 'v1', round: { index: 1, of: 5, endsAtMs: 120_000 }, slots: [{ tick: 'Jan–Feb', mark: null }, { tick: 'Mar–Apr', mark: null }], next: { label: 'March and April', short: 'Mar–Apr' },
  seen: 1, reports: [report(1)], adopted: ['lean'], offers: [],
  lenses: { freshTestSet: false, dryRun: false, incidentLog: false, caseMix: false, driftAlarm: false },
  spent: { phase2: 62, actions: 0, adoption: 0, running: 4.4, fines: 0, total: 66.4 }, score: 73.2, reveal: null, ...over,
})
