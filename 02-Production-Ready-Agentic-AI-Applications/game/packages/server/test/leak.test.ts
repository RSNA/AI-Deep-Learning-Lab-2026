// The leak scan (engineering spec, section 12.3). Bots play a whole game. Every byte sent to a
// player or screen socket and every content response is recorded with the stage it arrived in.
// The scan fails if a protected string of the pack appears before its moment.
// `npm run test:leak` runs it on the pack in CONTENT_DIR (with SYSTEMS if set).
import { describe, expect, it } from 'vitest'
import { loadPack, perPlayerTexts, protectedStrings, type Pack, type Tile } from '@lab02/content-schema'
import { STAGES, type StageId } from '@lab02/protocol'
import { deckSlides, shownScene, slidesMirrored } from '@lab02/engine'
import { DEMO, attach, hostConn, hostToken, joinBot, playDevelopment, playPlanning, startServer, step, until, type Bot } from './helpers.ts'
import type { Room } from '../src/room.ts'

/** Every text of a tile, with the interview lines apart (they may arrive one by one before the tile). */
function tileTexts(t: Tile): { fixed: string[]; lines: string[] } {
  const fixed = [t.headline, t.body]
  const lines: string[] = []
  if (t.type === 'stat') fixed.push(t.data.label, String(t.data.value), t.data.unit ?? '', t.data.comparison ?? '')
  if (t.type === 'chart') fixed.push(t.data.x_label, t.data.y_label, t.data.note ?? '', ...t.data.series.map((x) => x.name))
  if (t.type === 'audit') fixed.push(t.data.note ?? '', ...t.data.findings.map((f) => f.label))
  if (t.type === 'quote') lines.push(...t.data.text.split('\n'))
  return { fixed: fixed.filter((x) => x.length >= 12), lines: lines.filter((x) => x.length >= 12) }
}

/** Text a player may hold at any time: the public fields of the pack. */
function publicTexts(pack: Pack): Set<string> {
  const out = new Set<string>()
  const add = (x: unknown) => {
    if (typeof x === 'string') out.add(x)
    else if (Array.isArray(x)) x.forEach(add)
    else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) if (k !== 'key' && k !== 'tile') add(v)
  }
  for (const id of pack.systemIds) {
    const sp = pack.systems[id]!
    add(sp.system.public); add(sp.problems); add(sp.insights); add(sp.story)
  }
  add(pack.characters); add(pack.game.ladder); add(pack.game.phases.planning.classes)
  return out
}

/** The tile texts of one player's investigations that must not have reached them yet. */
function forbiddenFor(room: Room, pack: Pack, playerId: string, open: Set<string>): string[] {
  const p = room.state.players[playerId]
  if (!p) return []
  const st = p.planning
  const done = new Set(st?.done.map((d) => d.id) ?? [])
  const allowed = new Set(open)
  const out: string[] = []
  const invs = pack.systems[p.system]?.insights ?? []
  for (const inv of invs) {
    const tx = tileTexts(inv.tile)
    if (done.has(inv.id)) { tx.fixed.forEach((x) => allowed.add(x)); tx.lines.forEach((x) => allowed.add(x)) }
    const run = st?.running.find((r) => r.id === inv.id)
    if (run && inv.tile.type === 'quote') inv.tile.data.text.split('\n').slice(0, run.released).forEach((x) => allowed.add(x))
  }
  for (const inv of invs) {
    if (done.has(inv.id)) continue
    const tx = tileTexts(inv.tile)
    for (const x of [...tx.fixed, ...tx.lines]) if (!allowed.has(x)) out.push(x)
  }
  return out
}

/**
 * Phase 2 texts that must not have reached this player yet: a case, what a missed fact or a
 * decision says, and a note reach a player with their own validation; an insight with their own
 * action. At the reveal every case arrives with its title and text.
 */
function devForbiddenFor(room: Room, pack: Pack, playerId: string): string[] {
  const p = room.state.players[playerId]
  if (!p) return []
  const t = perPlayerTexts(pack, p.system)
  const st = p.development
  const revealed = room.state.closedPhases.includes('development')
  const allowed = new Set<string>()
  const b = pack.systems[p.system]?.build
  for (const v of st?.validations ?? []) {
    if (v.missed) {
      const k = b?.cases.find((x) => x.id === v.missed!.case)
      if (k) { allowed.add(k.public.title); allowed.add(k.public.text) }
      const f = v.missed.fact ? b?.facts.find((x) => x.id === v.missed!.fact) : undefined
      if (v.missed.reason === 'missing' && f) allowed.add(f.miss.missing)
      if (v.missed.reason === 'weak' && f) allowed.add(f.miss.weak)
      if (v.missed.reason === 'decision' && k) allowed.add(k.decision_miss)
    }
    if (v.note && t.notes[v.note]) allowed.add(t.notes[v.note]!)
  }
  if (revealed) for (const k of b?.cases ?? []) { allowed.add(k.public.title); allowed.add(k.public.text) }
  for (const d of st?.actionsDone ?? []) for (const x of t.insights[d.id] ?? []) allowed.add(x)
  const out: string[] = []
  for (const list of [...Object.values(t.cases), ...Object.values(t.facts), Object.values(t.notes), ...Object.values(t.insights)]) {
    for (const x of list) if (x.length >= 12 && !allowed.has(x)) out.push(x)
  }
  return out
}

const usePrivate = process.env.LEAK_PACK === '1'
const dir = usePrivate ? process.env.CONTENT_DIR! : DEMO

describe(`leak scan on ${usePrivate ? 'CONTENT_DIR' : 'the demo pack'}`, () => {
  it('no protected string reaches a browser before its moment', async () => {
    const systems = process.env.SYSTEMS?.split(',').filter(Boolean)
    const loaded = loadPack(dir, { systems })
    if (!loaded.ok) throw new Error(`pack does not load: ${loaded.errors[0]?.message}`)
    const list = protectedStrings(loaded.pack)
    expect(list.length).toBeGreaterThan(0)
    const srv = await startServer({ contentDir: dir, systems })
    try {
      const r = srv.app.manager.create('Leak scan', 'test')
      if (!r.ok) throw new Error(r.error)
      const code = r.room.code
      const room = r.room
      const records: { stage: StageId; text: string; slide: string | null }[] = []
      const flat = deckSlides(loaded.pack)
      // The slide that the projector (or, for a player, their own screen) shows at this moment.
      const visible = (player: boolean) => {
        const shown = shownScene(room.state, loaded.pack) === 'slides' && (!player || slidesMirrored(room.state, loaded.pack))
        return shown ? flat[room.state.screen.slide]?.slide.id ?? null : null
      }
      const shownEver = new Set<string>()
      const tileLeaks: string[] = []
      const open = publicTexts(loaded.pack)
      let tilesSeen = 0
      let devSeen = 0
      const devLeaks: string[] = []
      const token = await hostToken(srv.url)
      const host = hostConn(srv.ws, token, code)
      await until(() => host.status === 'open')
      await host.command('set_scale', { scale: 50 })
      const bots: Bot[] = []
      for (let i = 0; i < 8; i++) {
        const b = await joinBot(srv, code, `Leak Bot ${i}`)
        b.conn.on('*', (m) => {
          const text = JSON.stringify(m)
          records.push({ stage: room.state.stage, text, slide: visible(true) })
          // A tile reaches its own player only, and only when their investigation has ended.
          if (text.includes('"tiles":[{')) tilesSeen++
          for (const x of forbiddenFor(room, loaded.pack, b.playerId, open)) {
            if (text.includes(JSON.stringify(x).slice(1, -1))) { tileLeaks.push(`a tile text reached ${b.playerId} during ${room.state.stage} before its investigation ended: ${x.slice(0, 24)}`); break }
          }
          if (text.includes('"development":{') || text.includes('"phase":"development"')) devSeen++
          for (const x of devForbiddenFor(room, loaded.pack, b.playerId)) {
            if (text.includes(JSON.stringify(x).slice(1, -1))) { devLeaks.push(`a Phase 2 text reached ${b.playerId} during ${room.state.stage} before it was theirs: ${x.slice(0, 24)}`); break }
          }
        })
        playPlanning(b, srv.url, i + 7)
        playDevelopment(b, srv.url)
        bots.push(b)
      }
      const scrLink = await fetch(`${srv.url}/api/host/screen-link`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ code }) })
      const screenToken = ((await scrLink.json()) as { path: string }).path.split('#')[1]!
      const screen = attach(srv.ws, screenToken)
      screen.conn.on('*', (m) => records.push({ stage: room.state.stage, text: JSON.stringify(m), slide: visible(false) }))
      await until(() => bots.every((b) => b.status === 'open') && screen.status === 'open')
      // Slides in the lobby, on every screen, then the next one. Later the screen follows the game.
      if (flat.length > 1) {
        expect((await host.command('screen_scene', { scene: 'slides', mirror: true })).ok).toBe(true)
        shownEver.add(flat[0]!.slide.id)
        await new Promise((r) => setTimeout(r, 300))
        expect((await host.command('slide', { delta: 1 })).ok).toBe(true)
        shownEver.add(flat[1]!.slide.id)
        await new Promise((r) => setTimeout(r, 300))
        expect((await host.command('screen_mirror', { mirror: false })).ok).toBe(true)
        await new Promise((r) => setTimeout(r, 200))
        expect((await host.command('screen_scene', { scene: 'auto' })).ok).toBe(true)
      }
      let pinnedInPlay = false
      const watchSlides = setInterval(() => { const v = visible(false); if (v) shownEver.add(v) }, 20)

      while (room.state.stage !== 'closed') {
        const before = room.state.stage
        for (const b of bots) {
          for (const phase of ['planning', 'development', 'maintaining']) {
            const res = await fetch(`${srv.url}/api/content/${phase}`, { headers: { authorization: `Bearer ${b.token}` } })
            const text = await res.text()
            records.push({ stage: room.state.stage, text, slide: visible(true) })
            // The words of a line rule or a required worker are never in the static content.
            for (const x of perPlayerTexts(loaded.pack, room.state.players[b.playerId]!.system).rules) {
              if (text.includes(JSON.stringify(x).slice(1, -1))) devLeaks.push(`the words of a rule are in the static content of ${phase}: ${x.slice(0, 24)}`)
            }
          }
        }
        const sess = await fetch(`${srv.url}/api/session/${code}`)
        records.push({ stage: room.state.stage, text: await sess.text(), slide: visible(true) })
        // Once in Phase 1 the host puts the slides on the projector only, then follows the game again.
        if (before === 'planning.play' && !pinnedInPlay && flat.length) {
          pinnedInPlay = true
          expect((await host.command('screen_scene', { scene: 'slides' })).ok).toBe(true)
          await new Promise((r) => setTimeout(r, 300))
          expect((await host.command('screen_scene', { scene: 'auto' })).ok).toBe(true)
        }
        // Phases 1 and 2 run on their own clock, so the bots earn their tiles, actions and
        // validations. Phase 3 is a stub.
        if (before !== 'planning.play' && before !== 'development.play' && (room.state.stageEndsAtMs === null || before.endsWith('.play') || before.startsWith('maintaining.'))) await step(srv.app, host, code)
        await until(() => room.state.stage !== before, 40_000, `leaving ${before}`)
      }
      clearInterval(watchSlides)
      for (const b of bots) b.conn.close()
      screen.conn.close()
      host.close()

      const idx = (s: string) => STAGES.indexOf(s as StageId)
      const leaks: string[] = []
      for (const p of list) {
        for (const rec of records) {
          if (!rec.text.includes(JSON.stringify(p.text).slice(1, -1))) continue
          if (p.from === 'never' || idx(rec.stage) < idx(p.from)) {
            leaks.push(`${p.where} (allowed ${p.from}) arrived during ${rec.stage}`)
            break
          }
        }
      }
      // No class, tier, rationale, burden or graded board reaches anyone before the Phase 1 reveal.
      const early = records.filter((r) => idx(r.stage) < idx('planning.reveal'))
      const fields = ['"tier":', '"rationale":', '"burden":', '"graded":', '"justification"', '"class":"']
      const structural = fields.filter((f) => early.some((r) => r.text.includes(f)))
      // No number of the canvas scoring and no case list reaches anyone before the Phase 2 reveal.
      const early2 = records.filter((r) => idx(r.stage) < idx('development.reveal'))
      const fields2 = ['"weight":', '"needs":', '"difficulty":', '"gives":', '"effort":', '"distracts":', '"keep":', '"fetch":', '"catch":', '"by_model"', '"perCase"', '"solved":', '"overloaded"', '"distracting"', '"summary":', '"reference":', '"perLine"', '"per_line"', '"efforts"']
      structural.push(...fields2.filter((f) => early2.some((r) => r.text.includes(f))))
      // A slide reaches a browser only while it is shown there. Notes never do (they are protected).
      const slideLeaks: string[] = []
      const openText = [...open].join('\n')
      for (const f of flat) {
        // A slide line that repeats text the pack publishes anyway (a class label, a ladder rung) proves nothing.
        const texts = [f.slide.title, ...f.slide.bullets].filter((x) => x.length >= 12 && !openText.includes(x))
        for (const rec of records) {
          if (rec.slide === f.slide.id) continue
          const hit = texts.find((x) => rec.text.includes(JSON.stringify(x).slice(1, -1)))
          if (hit) { slideLeaks.push(`slide ${f.slide.id} reached a browser during ${rec.stage} while ${rec.slide ?? 'no slide'} was shown`); break }
        }
      }
      expect(slideLeaks).toEqual([])
      // Banter and click lines are public: none of them may carry a protected string.
      const spoken: string[] = []
      for (const c of loaded.pack.characters) spoken.push(...(c.click_lines ?? []))
      for (const id of loaded.pack.systemIds) for (const b of loaded.pack.systems[id]!.story?.banter ?? []) spoken.push(...b.lines.map((l) => l.text))
      const spokenLeaks = list.filter((p) => spoken.some((x) => x.includes(p.text))).map((p) => p.where)
      expect(spokenLeaks).toEqual([])
      expect(pinnedInPlay || !flat.length).toBe(true)
      if (flat.length > 1) expect(records.some((r) => r.slide !== null)).toBe(true)
      expect(records.length).toBeGreaterThan(100)
      expect(tilesSeen).toBeGreaterThan(0)
      expect(structural).toEqual([])
      expect(tileLeaks).toEqual([])
      expect(devLeaks).toEqual([])
      if (loaded.pack.phasesAvailable.development) {
        expect(devSeen).toBeGreaterThan(0)
        // The bots validated, so cases and notes did reach their own players.
        expect(Object.values(room.state.players).some((p) => (p.development?.validations.length ?? 0) > 0)).toBe(true)
      }
      expect(leaks).toEqual([])
    } finally {
      await srv.app.close()
      srv.cleanup()
    }
  }, 120_000)
})
