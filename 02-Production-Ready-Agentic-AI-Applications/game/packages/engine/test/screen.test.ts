// The big screen, the deck and the story of the round 8 contract (engineering spec, sections
// 6.11, 6.12 and 9): slides and where they may go, the stage rules of the screen, the empty
// letter, band labels, and the people of a practice.
import { describe, expect, it } from 'vitest'
import { PLAY_STAGES, type SlideView } from '@lab02/protocol'

type SlideChart = SlideView['charts'][number]
import { advance, deckSlides, project, sectionStartFor, shownScene, slidesMirrored } from '../src/index.ts'
import { demoPack, host, join, newSession, run } from './helpers.ts'

const pack = demoPack()
const flat = deckSlides(pack)

describe('the deck', () => {
  it('flattens its sections in order and finds the section of a stage', () => {
    expect(flat.length).toBe(pack.deck!.sections.reduce((n, s) => n + s.slides.length, 0))
    expect(flat.map((f) => f.index)).toEqual(flat.map((_, i) => i))
    const sec = pack.deck!.sections[1]!
    expect(sectionStartFor(pack, sec.stage as never)).toBe(flat.findIndex((f) => f.section.id === sec.id))
    expect(sectionStartFor(pack, 'planning.play')).toBeNull()
  })

  it('moves one slide at a time, stops at both ends, and refuses an index past the end', () => {
    const s = newSession()
    expect(host(s, 'slide', { delta: -1 }).ok).toBe(true)
    expect(s.screen.slide).toBe(0)
    expect(host(s, 'slide', { delta: 2 })).toMatchObject({ ok: false, error: 'bad_message' })
    for (let i = 0; i < flat.length + 3; i++) host(s, 'slide', { delta: 1 })
    expect(s.screen.slide).toBe(flat.length - 1)
    expect(host(s, 'slide_to', { index: 2 }).ok).toBe(true)
    expect(s.screen.slide).toBe(2)
    expect(host(s, 'slide_to', { index: flat.length })).toMatchObject({ ok: false, error: 'unknown_id' })
  })

  it('following the game into a slide stage, moves to its section and mirrors it, unless the host is inside it', () => {
    const s = newSession()
    join(s, 'p1', 'Alpha Branch')
    const intro = sectionStartFor(pack, 'intro')!
    host(s, 'slide_to', { index: intro + 1 })
    host(s, 'next') // intro: already inside its section, so the position stays
    expect(shownScene(s, pack)).toBe('slides')
    expect(s.screen.slide).toBe(intro + 1)
    expect(slidesMirrored(s, pack)).toBe(true)
    expect(project.playerView(s, pack, 'p1', 'C').slide?.id).toBe(flat[intro + 1]!.slide.id)
    // A play stage ends the mirror; the break moves the deck to its own section and mirrors again.
    host(s, 'next', {}, 1000)
    expect(slidesMirrored(s, pack)).toBe(false)
    host(s, 'end_now', {}, 2000)
    host(s, 'next', {}, 3000)
    expect(s.stage).toBe('break.planning')
    expect(s.screen.slide).toBe(sectionStartFor(pack, 'break.planning'))
    expect(slidesMirrored(s, pack)).toBe(true)
  })

  it('leaves a pinned projector alone at a stage change, and resumes at the slide shown last', () => {
    const s = newSession()
    host(s, 'screen_scene', { scene: 'lobby' })
    host(s, 'slide_to', { index: 3 })
    host(s, 'next') // intro, but pinned to the lobby
    expect(shownScene(s, pack)).toBe('lobby')
    expect(s.screen.slide).toBe(3)
    expect(s.screen.mirror).toBe(false)
    host(s, 'screen_scene', { scene: 'slides' })
    expect(project.screenView(s, pack, 'http://x').slide?.id).toBe(flat[3]!.slide.id)
  })

  it('ends the mirror when the projector leaves the slides, for any reason', () => {
    const s = newSession()
    join(s, 'p1', 'Alpha Branch')
    host(s, 'screen_scene', { scene: 'slides', mirror: true })
    expect(s.screen.mirror).toBe(true)
    host(s, 'screen_scene', { scene: 'lobby' })
    expect(s.screen.mirror).toBe(false)
    host(s, 'screen_scene', { scene: 'slides' })
    expect(slidesMirrored(s, pack)).toBe(false)
    host(s, 'screen_mirror', { mirror: true })
    expect(host(s, 'spotlight', { playerId: 'p1' }).ok).toBe(true)
    expect(s.screen.mirror).toBe(false)
    host(s, 'spotlight', { playerId: null })
    expect(slidesMirrored(s, pack)).toBe(false)
  })
})

describe('the screen by stage', () => {
  it('refuses the leaderboard and the winners before any score, and the winners until Phase 1 is scored', () => {
    const s = newSession()
    join(s, 'p1', 'Alpha Branch')
    expect(host(s, 'screen_scene', { scene: 'play' })).toMatchObject({ ok: false, error: 'no_scores_yet' })
    expect(host(s, 'screen_scene', { scene: 'winners' })).toMatchObject({ ok: false, error: 'no_scores_yet' })
    host(s, 'next'); host(s, 'next', {}, 1000)
    expect(s.stage).toBe('planning.play')
    expect(host(s, 'screen_scene', { scene: 'play' }, 2000).ok).toBe(true)
    expect(host(s, 'screen_scene', { scene: 'winners' }, 2000)).toMatchObject({ ok: false, error: 'no_scores_yet' })
    host(s, 'end_now', {}, 3000)
    expect(host(s, 'screen_scene', { scene: 'winners' }, 4000).ok).toBe(true)
    const v = project.screenView(s, pack, 'http://x')
    expect(v.scene).toBe('winners')
    expect(v.winners!.final).toBe(false)
    // Standings so far name every health system of the session, also the one with no points.
    expect(s.systems.length).toBeGreaterThan(1)
    expect(v.winners!.topSystems.map((x) => x.id).sort()).toEqual([...s.systems].sort())
  })

  it('shows slides during a phase on the projector only, and mirrors them to players outside play', () => {
    const s = newSession()
    join(s, 'p1', 'Alpha Branch')
    expect(host(s, 'screen_scene', { scene: 'slides', mirror: true }).ok).toBe(true)
    expect(slidesMirrored(s, pack)).toBe(true)
    const pv = project.playerView(s, pack, 'p1', 'C')
    expect(pv.slide?.id).toBe(flat[0]!.slide.id)
    expect(JSON.stringify(pv)).not.toContain('notes')
    // Entering a phase takes the slides off every player's screen.
    host(s, 'next'); host(s, 'next', {}, 1000)
    expect(PLAY_STAGES).toContain(s.stage)
    expect(slidesMirrored(s, pack)).toBe(false)
    expect(project.playerView(s, pack, 'p1', 'C').slide).toBeNull()
    expect(host(s, 'screen_scene', { scene: 'slides', mirror: true }, 2000)).toMatchObject({ ok: false, error: 'not_during_play' })
    expect(host(s, 'screen_mirror', { mirror: true }, 2000)).toMatchObject({ ok: false, error: 'not_during_play' })
    expect(host(s, 'screen_scene', { scene: 'slides' }, 2000).ok).toBe(true)
    expect(project.screenView(s, pack, 'http://x').slide).not.toBeNull()
    expect(project.playerView(s, pack, 'p1', 'C').slide).toBeNull()
    // Leaving the slides returns every mirrored screen to the game.
    host(s, 'end_now', {}, 3000)
    expect(host(s, 'screen_mirror', { mirror: true }, 4000).ok).toBe(true)
    expect(project.playerView(s, pack, 'p1', 'C').slide).not.toBeNull()
    host(s, 'screen_scene', { scene: 'auto' }, 5000)
    expect(project.playerView(s, pack, 'p1', 'C').slide).toBeNull()
  })

  it('sends a slide to the screen only while it is shown, and its notes only to a host', () => {
    const s = newSession()
    const sv = () => JSON.stringify(project.screenView(s, pack, 'http://x'))
    const titles = flat.map((f) => f.slide.title)
    expect(titles.some((t) => sv().includes(t))).toBe(false)
    host(s, 'screen_scene', { scene: 'slides' })
    expect(sv()).toContain(flat[0]!.slide.title)
    expect(titles.slice(1).some((t) => sv().includes(t))).toBe(false)
    const notes = flat.map((f) => f.slide.notes).filter((x): x is string => !!x)
    expect(notes.some((n) => sv().includes(n))).toBe(false)
    const hv = project.hostView(s, pack, { clock: { gameMs: 0, running: true, scale: 1 }, connected: () => false, publicUrl: 'http://x', wallNowMs: 0, stageWall: {}, answerKey: false, guide: false, screens: 0 })
    expect(hv.deck.current!.notes).toBe(flat[0]!.slide.notes ?? null)
    expect(hv.deck.next!.slide.id).toBe(flat[1]!.slide.id)
    expect(hv.screen.available).toEqual({ play: false, winners: false, slides: true })
  })
})

describe('a slide as a browser gets it', () => {
  const at = (id: string) => flat.findIndex((f) => f.slide.id === id)
  it('carries its layout and its parts, with a color for every box and the photo as a URL', () => {
    const s = newSession()
    const title = project.slideView(s, pack, at('welcome-1'))!
    expect(title).toMatchObject({ layout: 'title', subtitle: 'A sample session with two library networks', bullets: [], cards: [], references: [] })
    expect(title.people).toEqual([{ name: 'Ada Brook', role: 'Moderator', photo: null }, { name: 'Noor Vale', role: 'Presenter', photo: null }])
    // The join link is the session's own: the slide only says that it wants it.
    expect(title.qr).toEqual({ show: 'join', url: null, label: 'Join with your phone' })
    const cards = project.slideView(s, pack, at('welcome-2'))!
    expect(cards.layout).toBe('cards')
    expect(cards.cards.map((c) => c.tag)).toEqual(['1', '2', '3'])
    expect(cards.cards.map((c) => c.points)).toEqual([['Ask the staff', 'Count the requests'], [], []])
    expect(new Set(cards.cards.map((c) => c.tone)).size).toBe(3)
    // A box of a health system carries that system's place in the session, which is its color and shape.
    const nets = project.slideView(s, pack, at('welcome-3'))!
    expect(nets.cards.map((c) => c.system)).toEqual([s.systems.indexOf('rb'), s.systems.indexOf('ls')])
    expect(cards.cards.every((c) => c.system === null)).toBe(true)
    // A plain slide of the pack has the default layout and no part it did not ask for.
    expect(project.slideView(s, pack, at('planning-1'))).toMatchObject({ layout: 'bullets', subtitle: null, qr: null, people: [], figures: [], charts: [] })
    const closing = project.slideView(s, pack, at('closing-2'))!
    expect(closing.qr).toEqual({ show: 'link', url: null, label: 'Tell us how it went' })
    expect(closing.references.length).toBe(2)
    expect(project.slideView(s, pack, at('closing-1'))!.figures.map((f) => f.image)).toEqual([null, null])
  })

  it('draws how the room sorted each class and who found the big project once Phase 1 is scored, and empty frames before', () => {
    const s = newSession()
    join(s, 'p1', 'Alpha Branch', 0)
    join(s, 'p2', 'Beta Works', 1)
    host(s, 'next', {}, 500)
    host(s, 'next', {}, 1000)
    const i = at('planning-2')
    // Before the phase is scored the two charts are there without a number, and the one number reads as a dash.
    const before = project.slideView(s, pack, i)!.charts
    expect(before.map((c) => c.bars.length)).toEqual([pack.game.phases.planning.class_order.length, s.systems.length])
    expect(before.every((c) => c.bars.every((b) => b.value === null && b.note === null))).toBe(true)
    expect(project.slideView(s, pack, at('planning-1'))!.stat).toEqual({ label: 'of the room found the agent project', value: '–' })
    // One practice puts every problem in its true class, the other sorts nothing.
    const keys = pack.systems[s.players.p1!.system]!.problems!
    const picks = Object.fromEntries(keys.map((k) => [k.id, k.key.class]))
    expect(run(s, { actor: 'player', playerId: 'p1', type: 'planning.set_report', payload: { picks } }, 1500).ok).toBe(true)
    const other = pack.systems[s.players.p2!.system]!.problems![0]!
    const wrong = pack.game.phases.planning.class_order.find((c) => c !== other.key.class)!
    expect(run(s, { actor: 'player', playerId: 'p2', type: 'planning.set_report', payload: { picks: { [other.id]: wrong } } }, 1600).ok).toBe(true)
    host(s, 'end_now', {}, 2000)
    const [chart, bySystem] = project.slideView(s, pack, i)!.charts as [SlideChart, SlideChart]
    const order = [...pack.game.phases.planning.class_order].reverse()
    expect(chart.bars.map((b) => b.label)).toEqual(order.map((id) => pack.game.phases.planning.classes.find((c) => c.id === id)!.short))
    // Half of the room placed each class right: every bar is at 50 percent.
    expect(chart.bars.every((b) => b.value === 50)).toBe(true)
    // The practice that sorted everything found the big project, the other did not: one system at 100, one at 0.
    expect(bySystem.bars.map((b) => b.label)).toEqual(s.systems.map((id) => pack.systems[id]!.system.public.name))
    expect(bySystem.bars.map((b) => b.system)).toEqual(s.systems.map((_, i) => i))
    expect(chart.bars.every((b) => b.system === null)).toBe(true)
    expect(bySystem.bars.find((b) => b.label === pack.systems[s.players.p1!.system]!.system.public.name)).toMatchObject({ value: 100, note: '1 of 1' })
    expect(bySystem.bars.find((b) => b.label === pack.systems[s.players.p2!.system]!.system.public.name)).toMatchObject({ value: 0, note: '0 of 1' })
    expect(project.slideView(s, pack, at('planning-1'))!.stat!.value).toBe('50%')
  })

  it('gives a host the whole deck with the notes, and one player beside the key', () => {
    const s = newSession()
    join(s, 'p1', 'Alpha Branch', 0)
    const deck = project.hostDeck(s, pack)
    expect(deck.slides.map((x) => x.slide.id)).toEqual(flat.map((f) => f.slide.id))
    expect(deck.slides[0]!.notes).toBe(flat[0]!.slide.notes)
    expect(project.hostInspect(s, pack, 'nobody', false)).toBeNull()
    expect(project.hostInspect(s, pack, 'p1', true)).toMatchObject({ name: 'Alpha Branch', connected: true, planning: null })
    host(s, 'next', {}, 500)
    host(s, 'next', {}, 1000)
    const keys = pack.systems[s.players.p1!.system]!.problems!
    const rules = pack.game.phases.planning
    const real = rules.class_order.filter((id) => rules.classes.find((c) => c.id === id)!.rungs.length > 0)
    // One right, one a class off among the real ones, the rest not sorted.
    const a = keys[0]!
    const b = keys.find((k) => k.id !== a.id && real.includes(k.key.class))!
    const near = real[real.indexOf(b.key.class) + 1] ?? real[real.indexOf(b.key.class) - 1]!
    expect(run(s, { actor: 'player', playerId: 'p1', type: 'planning.set_report', payload: { picks: { [a.id]: a.key.class, [b.id]: near } } }, 1500).ok).toBe(true)
    const v = project.hostInspect(s, pack, 'p1', true)!.planning!
    expect(v.status).toBe('playing')
    expect(v.classes.map((c) => c.id)).toEqual(rules.class_order)
    expect(v.problems.find((x) => x.id === a.id)).toMatchObject({ picked: a.key.class, truth: a.key.class, mark: 'right', points: null })
    expect(v.problems.find((x) => x.id === b.id)).toMatchObject({ picked: near, mark: 'near' })
    expect(v.problems.filter((x) => x.mark === 'unsorted').length).toBe(keys.length - 2)
    expect(v.problems.every((x) => x.rationale === keys.find((k) => k.id === x.id)!.key.rationale)).toBe(true)
    host(s, 'end_now', {}, 2000)
    const done = project.hostInspect(s, pack, 'p1', true)!.planning!
    expect(done.status).toBe('closed')
    expect(done.problems.find((x) => x.id === a.id)!.points).toBe(rules.scoring.classify.exact)
    expect(done.classify).toBeGreaterThan(0)
  })
})

describe('the letter and the points a player sees', () => {
  const play = (picks: Record<string, string>) => {
    const s = newSession()
    join(s, 'p1', 'Alpha Branch')
    host(s, 'next'); host(s, 'next', {}, 1000)
    run(s, { actor: 'player', playerId: 'p1', type: 'planning.set_report', payload: { picks } }, 2000)
    host(s, 'end_now', {}, 3000)
    advance(s, pack, 3000)
    return { s, v: project.playerView(s, pack, 'p1', 'C') }
  }
  const letter = () => pack.systems.rb!.story!.letters!.planning_reveal!

  it('uses the empty variant when fewer problems were sorted than letter_empty_below', () => {
    expect(pack.game.phases.planning.submission?.letter_empty_below).toBe(2)
    const { v } = play({ 'rb-q-partner': 'agentic' })
    const text = v.inbox.find((m) => m.kind === 'letter')!.text
    expect(text).toContain(letter().always)
    expect(text).toContain(letter().variants.empty!)
  })

  it('uses the band variant otherwise, and shows the band by its label', () => {
    const { s, v } = play({ 'rb-q-partner': 'agentic', 'rb-q-kiosk': 'no_ai' })
    const band = s.players.p1!.results.planning!.band
    expect(v.inbox.find((m) => m.kind === 'letter')!.text).toContain(letter().variants[band]!)
    expect(v.inbox.find((m) => m.kind === 'letter')!.text).not.toContain(letter().variants.empty!)
    expect(v.points.planning!.band).toBe(pack.game.scoring.score_bands.find((b) => b.id === band)!.label)
    expect(JSON.stringify(v.points)).not.toContain(`"${band}"`)
  })
})

describe('the people of a practice', () => {
  it('lists the cast and then the extras, with their looks, click lines and banter', () => {
    const s = newSession()
    const sys = project.systemPublic(s, pack, 'rb')
    const ids = pack.systems.rb!.system.public.cast
    expect(sys.cast.slice(0, ids.length).map((c) => c.id)).toEqual([...ids])
    const extras = sys.cast.filter((c) => c.extra)
    expect(extras.length).toBeGreaterThan(0)
    for (const c of sys.cast) {
      expect(c.clickLines.length).toBeGreaterThanOrEqual(3)
      expect(Object.keys(c.look).length).toBeGreaterThan(0)
    }
    expect(sys.banter.length).toBe(pack.systems.rb!.story!.banter!.length)
    for (const b of sys.banter) for (const l of b.lines) expect(sys.cast.some((c) => c.id === l.speaker)).toBe(true)
  })
})

describe('follow the game while a phase is played', () => {
  /** Two practices, one in each health system, in planning.play at 1000. */
  function playing() {
    const s = newSession()
    join(s, 'p1', 'Alpha Branch', 0)
    join(s, 'p2', 'Beta Works', 1)
    host(s, 'next', {}, 500)
    host(s, 'next', {}, 1000)
    expect(s.stage).toBe('planning.play')
    return s
  }
  const sv = (s: ReturnType<typeof newSession>) => project.screenView(s, pack, 'http://x')
  const act = (s: ReturnType<typeof newSession>, id: string, type: string, payload: unknown, now: number) =>
    run(s, { actor: 'player', playerId: id, type, payload }, now)

  it('rotates through the programme of the pack, and only while it follows a play stage', () => {
    const s = newSession()
    expect(sv(s).programme).toBeNull()
    join(s, 'p1', 'Alpha Branch', 0)
    host(s, 'next', {}, 500)
    host(s, 'next', {}, 1000)
    expect(sv(s).programme).toEqual(pack.game.leaderboards.projector!.programme)
    expect(project.projectorRotates(s, pack)).toBe(true)
    host(s, 'screen_scene', { scene: 'play' }, 1100)
    expect(sv(s).programme).toBeNull()
    expect(sv(s).cards).toEqual([])
    host(s, 'screen_scene', { scene: 'auto' }, 1200)
    host(s, 'end_now', {}, 2000)
    expect(s.stage).toBe('planning.reveal')
    expect(sv(s).programme).toBeNull()
    expect(sv(s).feed).toEqual([])
  })

  it('lists what the room does, newest first, with public titles and nothing of what was learned', () => {
    const s = playing()
    const sys1 = pack.systems[s.players.p1!.system]!
    const sys2 = pack.systems[s.players.p2!.system]!
    const a = sys1.insights!.find((x) => x.method === 'interview')!
    const b = sys2.insights!.find((x) => x.method !== 'interview')!
    act(s, 'p1', 'planning.investigate', { id: a.id }, 2000)
    act(s, 'p2', 'planning.investigate', { id: b.id }, 3000)
    let feed = sv(s).feed
    expect(feed.map((e) => [e.name, e.kind, e.text])).toEqual([
      ['Beta Works', 'started', b.public.title],
      ['Alpha Branch', 'started', a.public.title],
    ])
    advance(s, pack, 2000 + a.seconds * 1000)
    act(s, 'p1', 'planning.submit', {}, 2000 + a.seconds * 1000 + 500)
    feed = sv(s).feed
    expect(feed[0]).toMatchObject({ name: 'Alpha Branch', kind: 'sent', text: null })
    expect(feed.some((e) => e.name === 'Alpha Branch' && e.kind === 'finished' && e.text === a.public.title)).toBe(true)
    // The projector never carries a tile, a class or a pick.
    const text = JSON.stringify(sv(s))
    for (const sys of [sys1, sys2]) {
      for (const inv of sys.insights!) expect(text).not.toContain(inv.tile.headline)
    }
    expect(text).not.toContain('"picks"')
    // Pinned to the activity list, the list is still filled. On the leaderboard it is not sent.
    host(s, 'screen_scene', { scene: 'feed' }, 60_000)
    expect(sv(s).feed.length).toBeGreaterThan(0)
    host(s, 'screen_scene', { scene: 'play' }, 61_000)
    expect(sv(s).feed).toEqual([])
  })

  it('shows one phase by health system: the running one in the rotation, a picked one on the leaderboard', () => {
    const s = playing()
    const a = pack.systems[s.players.p1!.system]!.insights![0]!
    act(s, 'p1', 'planning.investigate', { id: a.id }, 2000)
    advance(s, pack, 1000 + pack.game.leaderboards.refresh_seconds * 1000 + a.seconds * 1000)
    const b = sv(s).phaseBoard!
    expect(b.phase).toBe('planning')
    expect(b.state).toBe('live')
    expect(b.systems.map((x) => x.id)).toEqual(s.systems)
    expect(b.systems.find((x) => x.id === s.players.p1!.system)!.rows.map((r) => r.name)).toEqual(['Alpha Branch'])
    expect(b.systems.find((x) => x.id === s.players.p2!.system)!.rows.map((r) => r.name)).toEqual(['Beta Works'])
    expect(b.systems.every((x) => x.rows.every((r) => r.rank === 1))).toBe(true)

    host(s, 'screen_scene', { scene: 'play' }, 50_000)
    expect(sv(s).phaseBoard).toBeNull()
    expect(host(s, 'screen_filter', { system: null, phase: 'planning' }, 50_100).ok).toBe(true)
    expect(sv(s).phaseBoard!.phase).toBe('planning')
    expect(host(s, 'screen_filter', { system: s.systems[0], phase: null }, 50_200).ok).toBe(true)
    expect(sv(s).phaseBoard).toBeNull()
    expect(sv(s).board.system).toBe(s.systems[0])
  })

  it('shows a practice at work in counts only', () => {
    const s = playing()
    const a = pack.systems[s.players.p1!.system]!.insights![0]!
    act(s, 'p1', 'planning.investigate', { id: a.id }, 2000)
    const cards = sv(s).cards
    expect(cards.map((c) => c.name)).toEqual(['Alpha Branch'])     // only who acted in the phase
    expect(cards[0]!.now).toEqual([a.public.title])
    expect(cards[0]!.facts.map((f) => f.label)).toEqual(['Insights found', 'Problems sorted', 'Assessment'])
    expect(cards[0]!.facts[0]!.value).toBe(`0 of ${pack.game.phases.planning.investigations.per_system}`)
  })
})
