// The words of the Phase 2 screens. Content text comes from the pack.
// A placed thing is a tile. Its kinds are operators and tools, whose headings come from the pack.
import type { GridWords } from '../canvas/Grid.tsx'

const secs = (s: number) => `${Math.max(0, Math.ceil(s))} s`
const pct = (x: number) => `${Math.round(100 * x)}%`
/** A sum of money: whole when it is whole, else two decimals below 10 and one above. */
export const money = (x: number) => (Number.isInteger(x) ? x.toLocaleString('en-US') : x.toLocaleString('en-US', { maximumFractionDigits: Math.abs(x) < 10 ? 2 : 1 }))
const num = (x: number) => (Number.isInteger(x) ? x.toLocaleString('en-US') : x.toLocaleString('en-US', { maximumFractionDigits: 1 }))
/** The unit of money of the pack, written after a sum. */
let unit = ''
export const setMoneyUnit = (u: string | null) => { unit = u ? ` ${u}` : '' }

const moneyOf = (x: number) => money(x)
/** What a map takes to run a month: one decimal, and a cost above zero never shows as zero. */
export const runCost = (x: number) => (x > 0 && x < 0.05 ? '< 0.1' : x.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }))
const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`)

/** The people a pool of minutes belongs to: "Radiologist minutes" names the radiologist. */
export const poolPeople = (label: string) => label.replace(/\s+minutes$/i, '').trim() || label
/**
 * How many of the patients get a full look when a map needs `used` minutes for each and its
 * people have `max`: "only 1 patient in 8 gets a full look" when it comes out even, else a share.
 */
export const reach = (used: number, max: number, past = false): string => {
  const n = used / Math.max(max, 1e-9)
  const even = Math.abs(n - Math.round(n)) < 0.05
  const who = even ? `1 patient in ${Math.round(n)}` : `about ${pct(max / used)} of the patients`
  return `only ${who} ${past ? 'got' : even ? 'gets' : 'get'} a full look`
}

export const P2 = {
  phase: 'Phase 2',
  actions: 'Actions',
  map: 'Your map',
  toolbox: 'Toolbox',
  results: 'Results',
  tab: { map: 'Map', actions: 'Actions', toolbox: 'Toolbox', results: 'Results' },
  money: 'Money',
  developers: 'Developers',
  validations: 'Validations',
  freeOf: (n: number, of: number) => `${n} of ${of} free`,
  left: (n: number) => `${n} left`,
  moneyLine: 'An action is paid when it starts. Its developers are back when it ends.',
  models: 'Models',
  computes: 'Where they run',
  // A tool that is plain software carries no tag: the card beside it says what it is.
  kinds: { ai: 'AI', fixed: '', person: 'Person' } as Record<string, string>,
  pickHint: 'Tap an operator or a tool, then an empty cell of the map.',
  picked: 'Now click an empty cell. Esc cancels.',
  locked: (action: string) => `Opens with: ${action}`,
  lockedNoAction: 'Not open in this phase',
  lockedShort: 'Locked',
  info: (label: string) => `About ${label}`,
  open: 'Open to use',
  close: 'Close',
  undo: 'Undo',
  redo: 'Redo',
  remove: 'Remove',
  move: 'Move',
  join: 'Draw a line',
  cancel: 'Cancel',
  clear: 'Clear map',
  clearTitle: 'Clear the map?',
  clearText: (tiles: number, lines: number) => `${tiles === 1 ? 'The one tile' : `All ${tiles} tiles`} and ${lines === 1 ? 'the one line' : `${lines} lines`} come off the map. Undo brings them back.`,
  clearYes: 'Clear the map',
  clearNo: 'Keep it',
  clearEmpty: 'The map is empty already.',
  cleared: 'The map is clear. Undo brings it back.',
  // Hints in the bar of the map
  hint: {
    idle: 'Pick an operator or a tool in the toolbox, then a cell. Join with the round port.',
    place: (label: string) => `Click an empty cell for the ${label}. Esc cancels.`,
    move: (label: string) => `Click an empty cell to move the ${label}. Esc cancels.`,
    join: (label: string) => `Click a lit tile or the result to join ${label}. Esc cancels.`,
    tile: (label: string) => `${label} is selected.`,
    line: (from: string, to: string) => `Line from ${from} to ${to}.`,
  },
  replaced: 'The result takes one line. The new line replaced the old one.',
  refusedMap: 'The game did not accept that change, so the map is back as it was.',
  // The tour of the phase (section 10.1). It describes the screen, never an answer.
  tour: [
    { area: '[data-tour="p2-sources"]', tab: 'map', title: 'Sources', text: 'Where patient data and evidence live. A line from a source to a tile lets that operator or tool read there. A locked source opens with an action.' },
    { area: '[data-tour="p2-tools"]', tab: 'toolbox', title: 'Toolbox', text: 'Operators are people and agents. Tools do one job each. Pick one, then click any empty cell of the map to place it. Point at a row to read more about it.' },
    { area: '[data-tour="p2-grid"]', tab: 'map', title: 'Your map', text: 'Draw a line from the round port on the right of a tile to the tile that gets its work. A line may run any way across the map, but never in a loop. The work ends in the result.' },
    { area: '[data-tour="p2-result"]', tab: 'map', title: 'When it runs', text: 'Your map works on every case ahead of time. The result is waiting when the person who signs opens the case.' },
    { area: '[data-tour="p2-shelves"]', tab: 'map', title: 'Models and places to run', text: 'An AI tile needs a model, a place to run and a prompt. Choose them in the three boxes on the tile. These shelves show what you have.' },
    { area: '[data-tour="p2-actions"]', tab: 'actions', title: 'Actions', text: 'Learn, build, buy or negotiate. An action costs money and developers, takes time, and brings an insight or opens new items. Money you keep stays with the practice, so pay for what your map will use.' },
    { area: '[data-tour="p2-validate"]', tab: 'map', title: 'Validate', text: 'Test the map against patients whose answers people checked. While the button cannot act, the line beside it says what to do next.' },
    { area: '[data-tour="p2-below"]', tab: 'results', title: 'Results and insights', text: 'Every validation stays here with its accuracy and one patient the map got wrong, and you can bring back the map of any of them. The opening letter and the insights of actions wait here too.' },
  ],
  helpTitle: 'Help · Phase 2',
  helpIntro: 'Build a map that solves the problem of the letter, then validate it. The accuracy of the map you send is your score.',
  helpMarks: 'What the marks on the map mean',
  markWarn: 'Private data goes through a service that does not protect it.',
  markStray: 'Dashed and pale: the tile has no line out yet, so its work goes nowhere.',
  markMissing: 'A box in yellow: this AI tile still needs that part.',
  markGuide: 'A glowing outline: what the line beside Validate is about.',
  markAdvice: 'An i on a line: advice about that line. Click it to read it again.',
  markLock: 'A lock: the item opens with an action.',
  lockedTold: (action: string | null) => (action ? `Locked. Do “${action}” in Actions to open it.` : 'Locked in this phase.'),
  personBody: (used: number, max: number) => `Needs ${num(used)} min per patient, has ${num(max)}`,
  // The parts of a tile
  pickModel: '+ Model',
  pickCompute: '+ Runs on',
  defaultPrompt: (label: string) => label,
  model: 'Model',
  compute: 'Runs on',
  prompt: 'Prompt',
  modelOf: (label: string) => `Model for ${label}`,
  computeOf: (label: string) => `Where ${label} runs`,
  promptOf: (label: string) => `Prompt for ${label}`,
  promptAbout: (name: string, reads: string[], from: string[]) =>
    `${name} ${reads.length ? `reads ${list(reads)}` : 'reads no source yet'}${from.length ? ` and receives work from ${list(from)}` : ', and no tile hands it work'}.`,
  personMinutes: (decide: number, check: number) => `Minutes per patient: ${num(decide)} to decide alone, ${num(check)} to check work handed on, plus some for each source it reads.`,
  legend: { read: 'From a source: may read it', handoff: 'Between tiles: hands its work on' },
  computeIntro: (model: string | null) => (model ? `Only places where ${model} can run can be chosen.` : 'Pick the model first, or pick a place now and a model that runs there.'),
  cannotCarry: 'This tile cannot carry this model',
  cannotRun: (model: string, places: string) => `${model} runs only on: ${places}`,
  current: 'In use',
  clearPart: 'Clear',
  promptIntro: 'Read how each prompt starts and pick the one this tile should get. A tile that searches and one that decides may need different ones.',
  use: 'Use this prompt',
  inUse: 'In use',
  isDefault: 'Default',
  showMore: 'Show more',
  showLess: 'Show less',
  // What a popover says about an item, beyond the words of the pack
  pop: {
    needsParts: 'Needs a model and a place to run. Its prompt is yours to choose.',
    runsOn: (places: string) => `Runs on: ${places}`,
    runsHere: (models: string) => `Models that run here: ${models}`,
    privateSource: 'Holds private data.',
    unprotected: 'Does not protect private data.',
    protected: 'Protects private data.',
    done: 'Done.',
    running: (s: number) => `Running, ${secs(s)} left.`,
    sourceHow: 'Draw a line from its round port to a tile that should read it.',
    resultHow: 'One line ends here, from the tile that signs.',
  },
  // The grid
  grid: {
    sources: 'Sources', result: 'Result', col: (n: number) => `Column ${n}`,
    stray: 'No line out yet. Join it to the next tile.', strayShort: 'No line out',
    privateData: 'Sends private data through a service that does not protect it.',
    incomplete: 'Needs a model and a place to run.',
    emptyCell: (c: number, r: number) => `Empty cell, column ${c}, row ${r}`,
    placeHere: 'Place it here', moveHere: 'Move it here',
    port: (label: string) => `Draw a line from ${label}`,
    joinHere: (label: string) => `Join to ${label}`,
    line: (from: string, to: string) => `Line from ${from} to ${to}. Select it to remove it.`,
    advice: 'Advice on this line', close: 'Close',
  } as Omit<GridWords, 'pickModel' | 'pickCompute' | 'defaultPrompt' | 'locked' | 'lockedNoAction' | 'model' | 'compute' | 'prompt'>,
  // Actions
  start: 'Start',
  done: 'Done',
  noCancel: 'Paid up front, cannot be stopped.',
  noCancelLong: 'An action is paid when it starts and cannot be stopped. Several can run at once while money and developers allow.',
  cost: (money: number, devs: number, s: number) =>
    [money ? (unit ? `${moneyOf(money)}${unit}` : `${moneyOf(money)} money`) : 'Free', devs ? `${devs} dev${devs === 1 ? '' : 's'}` : 'no devs', `${s} s`].join(' · '),
  story: (s: string) => `In the story: ${s}`,
  more: 'More',
  opens: (list: string) => `Opens: ${list}`,
  leftS: (s: number) => `${secs(s)} left`,
  holds: (n: number) => `holds ${n}`,
  needsFirst: (title: string) => `Do “${title}” first.`,
  needsMoney: (n: number) => `Needs ${moneyOf(n)}${unit || ' money'}.`,
  needsDevs: (n: number, free: number) => `Needs ${n} developer${n === 1 ? '' : 's'}, ${free} free.`,
  // Said once, when a player has started this many actions.
  spendAfter: 4,
  spendTitle: 'A word on money',
  spendText: (n: number) => `That is ${n === 4 ? 'four' : n} actions started. Money spent on something your map does not use is gone, and what you keep stays with the practice. Pay for what the map needs.`,
  spendOk: 'Got it',
  // Running and validating
  toRun: 'To run:',
  perMonth: (x: number) => `${runCost(x)}${unit} a month`,
  minutes: (label: string, used: number, max: number) => `${poolPeople(label)}: needs ${num(used)} min per patient, has ${num(max)}`,
  complexity: (n: number) => `complexity ${n}`,
  privateWarn: 'Private data goes through a service that does not protect it.',
  validate: 'Validate',
  validateLeft: (n: number) => `Validate · ${n} left`,
  validating: (s: number) => `Validating · ${secs(s)}`,
  noneLeft: 'No validations left',
  sameTitle: 'Validate the same map again?',
  sameLast: 'This is the map you validated last.',
  sameEarlier: (n: number) => `This is the map of validation ${n}.`,
  sameAsk: (left: number) => `Its accuracy will be the same. Validate again and use one of your ${left}?`,
  sameYes: 'Validate again',
  sameNo: 'Keep building',
  hostReason: {
    nothing_reaches_result: 'Nothing reaches the result.',
    no_source_connected: 'No source reaches the tiles that lead to the result.',
    tile_incomplete: 'An AI tile lacks a model or a place to run.',
    required: 'A tile the pack requires is not on the way to the result.',
    minutes: (label: string) => `${poolPeople(label)}: the map asks more minutes per patient than there are.`,
  },
  // Why Validate cannot act now, said as the next thing to do (section 10.5).
  why: {
    running: 'A validation is running. Its result comes in a few seconds.',
    noneLeft: 'No validations are left. Your best map is sent when the time is up.',
    place: 'Place a tile first: pick an operator or a tool in the toolbox, then click an empty cell.',
    joinSource: 'No source is joined to a tile. Draw a line from the round port of a source to a tile.',
    reachResult: 'Nothing reaches the result yet. Join a tile to it with the tile’s round port.',
    liveSource: 'No source reaches the tiles that lead to the result. Join a source to one of them.',
    noModel: (name: string) => `${name} has no model. Choose one in its box.`,
    noPlace: (name: string) => `${name} has no place to run. Choose one in its box.`,
    noParts: (name: string) => `${name} has no model and no place to run. Choose them in its boxes.`,
    minutesOne: (name: string, used: string, max: string) => `${name} would need ${used} min per patient and has ${max}. Take a line off, or let it check work instead.`,
    minutesPool: (label: string, used: string, max: string) => `${poolPeople(label)}: the map needs ${used} min per patient and the limit is ${max}. Take a line or a person off.`,
    rushOne: (name: string, used: number, max: number) => `${name} needs ${num(used)} min per patient and has ${num(max)}, so ${reach(used, max)}. You can still validate.`,
    rushPool: (label: string, used: number, max: number) => `${poolPeople(label)}: the map needs ${num(used)} min per patient and there are ${num(max)}, so ${reach(used, max)}. You can still validate.`,
    more: (n: number) => (n === 1 ? '1 more thing after this.' : `${n} more things after this.`),
    ready: 'Ready. Press Validate to test the map against patients whose answers people checked.',
  },
  // Why a placement or a line was refused, at its place (section 10.5).
  refuse: {
    taken: 'This cell is taken. Pick an empty cell, or move this tile first.',
    locked: (name: string, action: string | null) => (action ? `${name} is locked. Do “${action}” in Actions to open it.` : `${name} is not open in this phase.`),
    intoSource: (name: string) => `A line cannot end at ${name}. Lines run from a source to a tile.`,
    sourceToResult: (name: string) => `${name} cannot reach the result by itself. Join it to a tile, and the tile to the result.`,
    twice: (a: string, b: string) => `${a} is already joined to ${b}.`,
    loop: (a: string, b: string) => `That would close a loop: ${b} already hands its work on to ${a}, directly or through other tiles.`,
    server: 'That line cannot be drawn on this map.',
  },
  // Results
  validationsTitle: 'Your validations',
  usedOf: (n: number, of: number) => `${n} of ${of} used`,
  validationN: (n: number, of: number) => `Validation ${n} of ${of}`,
  latest: 'Latest',
  accuracy: 'Accuracy',
  rank: (r: number, of: number) => `Rank ${r} of ${of}`,
  missedOne: 'One patient it got wrong, as an example',
  note: 'Note',
  // What happened when the people of a map had fewer minutes than it asks of them.
  rushedPool: (label: string, used: number, max: number) => `${poolPeople(label)}: this map needs ${num(used)} min per patient and there are ${num(max)}, so ${reach(used, max, true)}. The others passed without one.`,
  rushedPlain: 'The people on this map had fewer minutes than it asks of them, so part of the patients passed without a full look.',
  unhurried: (acc: number) => `With the time it asks for, this map would be right for ${pct(acc)} of the patients.`,
  restoreMap: 'Restore this map',
  restored: (n: number) => `The map of validation ${n} is back on your canvas. Undo returns to the one before.`,
  onCanvas: 'On your canvas now',
  useMap: 'Send this map',
  willSend: 'This map will be sent',
  defaultSend: 'Unless you pick another, the map with the best accuracy is sent when the time is up.',
  backToDefault: 'Send the best one again',
  noValidation: 'No validation yet. When something reaches the result, press Validate. It takes a few seconds, and the map stays usable meanwhile.',
  validationOf: (id: string, acc: number) => `${id.replace('v', 'Validation ')}: ${pct(acc)}`,
  doneToast: (acc: number) => `Validation done: ${pct(acc)}`,
  insightToast: (title: string) => `New insight: ${title}`,
  show: 'Show',
  insights: 'Insights',
  insightsEmpty: 'An action that brings an insight lands it here as a card.',
  fromAction: (title: string) => `ACTION · ${title}`,
  letterCard: 'LETTER',
  phaseStarted: 'Phase 2 has started.',
  briefStart: 'Start building',
  letterStays: 'This letter stays as the first card under Insights.',
  warn: (s: number) => `${s} seconds left. The map with the best accuracy is sent when the time is up.`,
  pct,
  // Reveal
  letterTitle: 'A letter for you',
  timeUp: 'Time is up. The map you chose, or the one with the best accuracy, was sent.',
  yourScore: 'Your score',
  accuracySent: 'Accuracy of the map you sent',
  phasePoints: 'Phase 2 points',
  scaleLine: 'Points put both health systems on one scale.',
  yourMap: 'Your map',
  referenceMap: 'The reference map',
  cases: 'Every kind of case',
  yours: 'Yours',
  reference: 'Reference',
  noMapSent: 'You sent no map, so no case was solved.',
  nextPhase: 'Your map, your money and what you unlocked go with you into Phase 3.',
}
