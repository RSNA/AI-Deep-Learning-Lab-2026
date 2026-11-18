// The big screen, the deck and the story of the round 8 contract (engineering spec, sections
// 6.11, 6.12 and 9): slides and where they may go, the stage rules of the screen, the empty
// letter, band labels, and the people of a practice.
import { describe, expect, it } from 'vitest'
import { PLAY_STAGES } from '@lab02/protocol'
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
    const hv = project.hostView(s, pack, { clock: { gameMs: 0, running: true, scale: 1 }, connected: () => false, publicUrl: 'http://x', wallNowMs: 0, stageWall: {}, answerKey: false, screens: 0 })
    expect(hv.deck.current!.notes).toBe(flat[0]!.slide.notes ?? null)
    expect(hv.deck.next!.slide.id).toBe(flat[1]!.slide.id)
    expect(hv.screen.available).toEqual({ play: false, winners: false, slides: true })
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
