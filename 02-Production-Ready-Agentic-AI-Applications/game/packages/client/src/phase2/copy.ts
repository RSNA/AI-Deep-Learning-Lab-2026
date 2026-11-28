// The words of the Phase 2 screens. Content text comes from the pack.
// A placed thing is a tile. Its kinds are operators and tools, whose headings come from the pack.
import type { GridWords } from '../canvas/Grid.tsx'

const secs = (s: number) => `${Math.max(0, Math.ceil(s))} s`
const pct = (x: number) => `${Math.round(100 * x)}%`
// The accuracy of a map, with one decimal: at the top the maps of a pack differ by less than a point.
const acc1 = (x: number) => `${(Math.round(1000 * x) / 10).toFixed(1)}%`
/** A sum of money: whole when it is whole, else two decimals below 10 and one above. */
/** A sum of money, with a true minus sign below zero. */
export const money = (x: number) => (x < 0 ? '−' : '') + (Number.isInteger(x) ? Math.abs(x).toLocaleString('en-US') : Math.abs(x).toLocaleString('en-US', { maximumFractionDigits: 1 }))
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

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']
/** A small count in words, as a person would say it: "two models", "one place". */
export const count = (n: number, one: string, many: string) => `${WORDS[n] ?? String(n)} ${n === 1 ? one : many}`
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

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
  moneyLine: 'You pay for an action when it starts, and you get its developers back when it ends.',
  models: 'Models',
  computes: 'Where they run',
  // A tool that is plain software carries no tag: the card beside it says what it is.
  kinds: { ai: 'AI', fixed: '', person: 'Person' } as Record<string, string>,
  pickHint: 'Tap an operator or a tool, and then tap an empty cell of the map.',
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
  tidy: 'Tidy map',
  tidyTip: 'This puts the tiles and the sources where the arrows are short and cross less. It changes no line and no score.',
  tidyEmpty: 'There is nothing to tidy yet, because the map is empty.',
  tidyAlready: 'The map is already as tidy as this button can make it.',
  tidied: 'The map is tidy now, and every line still joins the same two things. Undo puts the tiles back where they were.',
  // A source in its column, on the card that a phone opens for it
  source: {
    up: 'Move up',
    down: 'Move down',
    place: (n: number, of: number) => `This source is number ${n} of ${of} in its column.`,
    why: 'You can move it next to the tile that reads it, so the arrow stays short.',
    top: 'It is at the top already, so it can only move down.',
    bottom: 'It is at the bottom already, so it can only move up.',
  },
  // Hints in the bar of the map
  hint: {
    idle: 'Pick an operator or a tool in the toolbox and then a cell. To join two tiles, drag from a round dot.',
    place: (label: string) => `Click an empty cell for the ${label}. Esc cancels.`,
    move: (label: string) => `Click an empty cell to move the ${label}. Esc cancels.`,
    join: (label: string) => `Click a lit tile, one of its dots, or the result to join ${label}. Esc cancels.`,
    tile: (label: string) => `${label} is selected.`,
    line: 'Drag an end of this line to another tile, or click the tile it should point to.',
    lineEnd: (end: 'from' | 'to') =>
      end === 'from' ? 'Click the source or the tile where this line should start. Esc cancels.' : 'Click the tile this line should point to. Esc cancels.',
  },
  replaced: 'The result takes one line. The new line replaced the old one.',
  refusedMap: 'The game did not accept that change, so the map is back as it was.',
  // The tour of the phase (section 10.1). It describes the screen, never an answer.
  tour: [
    { area: '[data-tour="p2-sources"]', tab: 'map', title: 'Sources', text: 'This is where patient data and evidence live. When you draw a line from a source to a tile, that operator or tool can read it. A source with a lock opens once you take the right action. You can drag a source up or down in its column, so that it sits next to the tile that reads it and the arrow stays short.' },
    { area: '[data-tour="p2-tools"]', tab: 'toolbox', title: 'Toolbox', text: 'Operators are the people and the agents, and each tool does one job. Pick one and then click any empty cell of the map to place it. Point at a row if you want to read more about it.' },
    { area: '[data-tour="p2-grid"]', tab: 'map', title: 'Your map', text: 'To connect two tiles, drag from a round dot of one tile to the other tile, or click the dot and then the tile. If you select a line, you can drag either of its ends somewhere else. Lines may run in any direction as long as they never form a loop, and the work has to end in the result.' },
    { area: '[data-tour="p2-result"]', tab: 'map', title: 'When it runs', text: 'Your map works on every case ahead of time, so the result is already waiting when the person who signs opens the case. The result takes one line, and you can bring that line in on any of its four sides.' },
    { area: '[data-tour="p2-tidy"]', tab: 'map', title: 'Tidy map', text: 'When the map gets crowded and the arrows start to tangle, press Tidy map. It moves the tiles and the sources so that the arrows are short and cross less. It never changes a line, so your score stays what it was, and Undo puts everything back.' },
    { area: '[data-tour="p2-shelves"]', tab: 'map', title: 'Models and places to run', text: 'An AI agent needs a model, a place to run and a prompt, and you choose them in the three boxes on its tile. These shelves show what you have so far.' },
    { area: '[data-tour="p2-actions"]', tab: 'actions', title: 'Actions', text: 'Here your team can learn, build, buy or negotiate. Every action costs money, keeps some of your developers busy and takes time, and it brings back an insight or opens something new. The more your team learns and buys, the more shows up on your board. Do explore, but choose with care, because the money does not come back.' },
    { area: '[data-tour="p2-validate"]', tab: 'map', title: 'Validate', text: 'Validate tests your map on patients whose answers people have already checked. When the button cannot be pressed, the line beside it tells you what to do next.' },
    { area: '[data-tour="p2-below"]', tab: 'results', title: 'Results and insights', text: 'Every validation adds a system to this list: System 1, System 2 and so on. Each one comes with its accuracy, one patient it got wrong and a hint on what would help. You can bring back the map of any of them. The opening letter and the cards from your actions are here too.' },
  ],
  // The guided first build (section 10.5): hands-on, one step at a time, after the tour. Every
  // sentence is said the way a friendly colleague would say it over the player's shoulder.
  first: {
    label: 'Your first build',
    stepOf: (n: number, of: number) => `Step ${n} of ${of}`,
    skip: 'Skip the tutorial',
    again: 'Do the guided first build',
    action: {
      title: 'Start by learning something',
      text: (action: string) => `Good teams learn before they build. Press Start on “${action}”. It costs nothing, and your team comes back with a card that is worth reading.`,
    },
    wait: {
      title: 'Your team is on it',
      text: (s: number) => `Give them a moment. The card arrives in about ${s} ${s === 1 ? 'second' : 'seconds'}. The clock of the phase keeps running in the meantime, just like in real life.`,
    },
    card: {
      title: 'Your first insight is in',
      text: 'This card is what your team brought back. Have a look at it, because cards like this one tell you what your map needs. Every action that teaches you something leaves a card here.',
      ok: 'I have read it',
    },
    pick: {
      title: (label: string) => `Put your first ${label} on the map`,
      text: (label: string) => `Press ${label} in the toolbox. It is the operator that works things out for itself, which is why it needs a model, a place to run and a prompt.`,
    },
    cell: {
      title: 'Give it a spot',
      text: (label: string) => `Now press any empty cell of the map. The ${label} works the same in every cell, so pick the spot you like.`,
    },
    model: {
      title: 'Choose its model',
      open: (name: string) => `Your ${name} cannot think without a model. Press the box that says “+ Model” on its tile.`,
      choose: (n: number) => `You have ${count(n, 'model', 'models')} for now. Pick ${n === 1 ? 'it' : 'the one you want'}. Keep learning and building, and more will show up here.`,
    },
    runsOn: {
      title: 'Choose where it runs',
      open: 'A model has to run somewhere. Press the box that says “+ Runs on”.',
      choose: (n: number) => `You have ${count(n, 'place', 'places')} to run it for now. Pick ${n === 1 ? 'it' : 'one'}. Keep learning and building, and more will show up here.`,
    },
    prompt: {
      title: 'Have a look at its prompt',
      open: 'The third box is the prompt, which is what you tell your agent to do. It came with a plain one. Press the box to see your choices.',
      choose: (n: number) => `You have ${count(n, 'prompt', 'prompts')} for now. Read how each one starts and pick the one you would hand to a new colleague. Keep learning, and more will show up here.`,
      keep: 'Keep the one it has',
    },
    source: {
      title: 'Give it something to read',
      from: (name: string, source: string | null) => `Right now your ${name} knows nothing about the patient. Press the round dot of a source on the left${source ? `, for example ${source}` : ''}.`,
      to: (name: string) => `Now press your ${name}. The line you draw lets it read that source. You can add more sources later in the same way.`,
    },
    person: {
      title: (label: string) => `Now bring in the ${label}`,
      pick: (label: string) => `An agent should not send its work out unchecked. Press ${label} in the toolbox.`,
      cell: (name: string) => `Press an empty cell to the right of your ${name}, so that the work flows from left to right.`,
    },
    handoff: {
      title: 'Hand the work on',
      from: (name: string) => `Press one of the round dots on your ${name}.`,
      to: (from: string, to: string) => `Now press the ${to}. The thick line means that your ${from} hands its work on.`,
    },
    result: {
      title: 'Bring it home',
      from: (name: string) => `One more line and you have a system. Press a round dot on the ${name}.`,
      to: (result: string) => `Now press “${result}” on the right. That is where the finished work goes.`,
    },
    validate: {
      title: 'Put it to the test',
      text: (free: boolean) => `Press Validate.${free ? ' This first one is free, so you have nothing to lose.' : ''} If the button is grey, the line beside it tells you what is still missing.`,
    },
    validating: {
      title: 'The test is running',
      text: 'Your map is working through patients whose answers people have already checked. The result is here in a few seconds.',
    },
    done: {
      title: 'You built a working system',
      text: (free: boolean, left: number) =>
        `${free ? 'This validation was free.' : 'That was your first validation.'} You still have ${count(left, 'validation', 'validations')} left. Keep going until you find the system you want.`,
      more: 'It is now on the list of your systems, with its accuracy and one patient it got wrong.',
      ok: 'Keep building',
    },
    cap,
  },
  helpTitle: 'Help · Phase 2',
  helpIntro: 'Build a map that solves the problem from the letter, and then validate it. Every validation makes a system with a number, and your score is the accuracy of the system you choose.',
  helpMarks: 'What the marks on the map mean',
  markWarn: 'Private data goes through a service that does not protect it.',
  markStray: 'A dashed, pale tile has no line out yet, so its work goes nowhere.',
  markMissing: 'A yellow box means that this AI tile still needs that part.',
  markGuide: 'A glowing outline shows what the line beside Validate is talking about.',
  markAdvice: 'An i on a line means there is advice about that line. Click it to read the advice again.',
  markLock: 'A lock means that the source opens with an action.',
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
    sourceMove: 'Drag it up or down to move it in its column.',
    resultHow: 'One line ends here, from the tile that signs. It can come in on any of the four sides.',
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
    lineEnd: (end: 'from' | 'to', from: string, to: string) =>
      end === 'from' ? `Move the start of the line from ${from} to ${to}` : `Move the arrow end of the line from ${from} to ${to}`,
    advice: 'Advice on this line', close: 'Close',
    moveSource: 'Drag it up or down to move it in its column, or hold Alt and press the up or the down arrow.',
    resultSide: (side: 'top' | 'right' | 'bottom' | 'left') => `End the line on the ${side} side of the result`,
  } as Omit<GridWords, 'pickModel' | 'pickCompute' | 'defaultPrompt' | 'locked' | 'lockedNoAction' | 'model' | 'compute' | 'prompt'>,
  // Actions
  start: 'Start',
  done: 'Done',
  noCancel: 'You pay up front, and an action cannot be stopped.',
  noCancelLong: 'An action is paid when it starts and cannot be stopped. Several can run at once while money and developers allow.',
  cost: (money: number, devs: number, s: number) =>
    [money ? (unit ? `${moneyOf(money)}${unit}` : `${moneyOf(money)} money`) : 'Free', devs ? `${devs} dev${devs === 1 ? '' : 's'}` : 'no devs', `${s} s`].join(' · '),
  story: (s: string) => `In the story: ${s}`,
  more: 'More',
  // What an action opens has to be used by a map. What it changes in place does not.
  opens: (list: string, toUse: boolean) => `Opens: ${list}.${toUse ? ' It does nothing until a map of yours uses it.' : ''}`,
  inPlace: 'It acts on every system you already have. You do not have to validate or deploy again for it.',
  leftS: (s: number) => `${secs(s)} left`,
  holds: (n: number) => `holds ${n}`,
  needsFirst: (title: string) => `Do “${title}” first.`,
  needsMoney: (n: number, have: number) =>
    have < 0
      ? `Your account is below zero, so it cannot pay ${moneyOf(n)}${unit || ' money'}.`
      : `Costs ${moneyOf(n)}${unit || ' money'}, and you have ${moneyOf(have)}${unit || ''} left.`,
  belowZero: 'Your account is below zero. Nothing can be bought until it is positive again.',
  hintLabel: 'What would help:',
  needsDevs: (n: number, free: number) => `Needs ${n} developer${n === 1 ? '' : 's'}, ${free} free.`,
  // Said once, when a player has started this many actions.
  spendAfter: 4,
  spendTitle: 'A word on money',
  spendText: (n: number) => `That is ${n === 4 ? 'four' : n} actions you paid for. Money spent on something your map does not use is gone, and what you keep stays in your budget. Pay for what the map needs.`,
  spendOk: 'Got it',
  // Running and validating
  toRun: 'To run:',
  perMonth: (x: number) => `${runCost(x)}${unit} a month, ${money(Math.round(12 * x))}${unit} a year`,
  minutes: (label: string, used: number, max: number) => `${poolPeople(label)}: needs ${num(used)} min per patient, has ${num(max)}`,
  complexity: (n: number) => `complexity ${n}`,
  privateWarn: 'Private data goes through a service that does not protect it.',
  validate: 'Validate',
  validateLeft: (n: number) => `Validate · ${n} left`,
  validateFree: 'Validate · free',
  validating: (s: number) => `Validating · ${secs(s)}`,
  noneLeft: 'No validations left',
  sameTitle: 'Validate the same map again?',
  sameLast: 'This is the map you validated last.',
  sameEarlier: (n: number) => `This is the map of System ${n}.`,
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
    noneLeft: 'No validations are left. Your chosen system counts when the time is up.',
    place: 'Place a tile first. Pick an operator or a tool in the toolbox, and then click an empty cell.',
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
    ready: 'Your map is ready. Press Validate to test it on patients whose answers people have already checked.',
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
    endSelf: 'A line cannot start and end at the same tile.',
    endNotHere: 'This end of the line cannot go there. A line starts at a source or a tile, and it ends at a tile or at the result.',
  },
  // Results
  // Every validated map is a system with a number, in the order the player made them.
  validationsTitle: 'Your systems',
  usedOf: (n: number, of: number) => `${n} of ${of} validations used`,
  systemN: (n: number) => `System ${n}`,
  freeTag: 'Free',
  usedOfFree: (n: number, of: number, free: number) => `${n} of ${of} validations used · ${free === 1 ? 'the first one was free' : `the first ${free} were free`}`,
  latest: 'Latest',
  accuracy: 'Accuracy',
  rank: (r: number, of: number) => `Rank ${r} of ${of}`,
  missedOne: 'One patient it got wrong, as an example',
  note: 'Note',
  // What happened when the people of a map had fewer minutes than it asks of them.
  rushedPool: (label: string, used: number, max: number) => `${poolPeople(label)}: this map needs ${num(used)} min per patient and there are ${num(max)}, so ${reach(used, max, true)}. The others passed without one.`,
  rushedPlain: 'The people on this map had fewer minutes than it asks of them, so part of the patients passed without a full look.',
  unhurried: (acc: number) => `With the time it asks for, this map would be right for ${acc1(acc)} of the patients.`,
  restoreMap: 'Restore this map',
  restored: (n: number) => `The map of System ${n} is back on your canvas. Undo returns to the one before.`,
  onCanvas: 'On your canvas now',
  useMap: 'Choose this system',
  willSend: 'Your chosen system so far',
  defaultSend: 'Unless you choose another, the system with the best accuracy counts when the time is up.',
  backToDefault: 'Go back to the best one',
  noValidation: 'You have no system yet. When something reaches the result, press Validate. It takes a few seconds, and the map stays usable meanwhile.',
  validationOf: (id: string, acc: number) => `${id.replace('v', 'System ')}: ${acc1(acc)}`,
  doneToast: (n: number, acc: number) => `System ${n} is validated: ${acc1(acc)}`,
  insightToast: (title: string) => `New insight: ${title}`,
  // What is not on the board yet is not shown. These say that there is more, and when it comes.
  newOnBoard: (names: string[]) => `New on your board: ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` and ${names.length - 3} more` : ''}`,
  newTag: 'New',
  moreTools: 'More tools appear as your team learns, builds and buys.',
  moreActions: 'More appears here as your team learns.',
  moreShelf: 'more to come',
  moreShelfLong: 'More appears on this shelf as your team sets up, buys and negotiates.',
  morePrompts: 'More formats appear as your team learns about prompts.',
  nowhereYet: 'nothing on your board yet',
  show: 'Show',
  insights: 'Insights',
  insightsEmpty: 'An action that brings an insight lands it here as a card.',
  fromAction: (title: string) => `ACTION · ${title}`,
  letterCard: 'LETTER',
  memoCard: 'MEMO',
  phaseStarted: 'Phase 2 has started.',
  briefStart: 'Start building',
  letterStays: 'You can read this letter again under Insights. New cards go above it.',
  warn: (s: number) => `${s} seconds left. Your chosen system, or the one with the best accuracy, counts when the time is up.`,
  pct,
  acc1,
  // Reveal
  letterTitle: 'A letter for you',
  timeUp: 'Time is up. The system you chose, or the one with the best accuracy, counts.',
  yourScore: 'Your score',
  accuracySent: 'Accuracy of your chosen system',
  phasePoints: 'Phase 2 points',
  scaleLine: 'Points put both health systems on one scale.',
  scaleLineOne: 'Points run from the practice as it works today to the best system that was found.',
  yourMap: 'Your system',
  referenceMap: 'The proposed system',
  referenceMaps: 'Proposed systems',
  referenceMapsLine: 'Several systems solve this problem about as well on the test set. Step through them. Phase 3 shows how each holds up in service.',
  cases: 'Every kind of case',
  yours: 'Yours',
  reference: 'Proposed',
  noMapSent: 'You validated no map, so no case was solved.',
  nextPhase: 'Your systems, your money and what you unlocked go with you into Phase 3.',
}
