// The leak scan (engineering spec, section 12.3). Bots play a whole game. Every byte sent to a
// player or screen socket and every content response is recorded with the stage it arrived in.
// The scan fails if a protected string of the pack appears before its moment.
// `npm run test:leak` runs it on the pack in CONTENT_DIR (with SYSTEMS if set).
import { describe, expect, it } from 'vitest'
import { loadPack, protectedStrings, type Pack, type Tile } from '@lab02/content-schema'
import { STAGES, type StageId } from '@lab02/protocol'
import { DEMO, attach, hostConn, hostToken, joinBot, playPlanning, startServer, step, until, type Bot } from './helpers.ts'
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
      const records: { stage: StageId; text: string }[] = []
      const tileLeaks: string[] = []
      const open = publicTexts(loaded.pack)
      let tilesSeen = 0
      const token = await hostToken(srv.url)
      const host = hostConn(srv.ws, token, code)
      await until(() => host.status === 'open')
      await host.command('set_scale', { scale: 50 })
      const bots: Bot[] = []
      for (let i = 0; i < 8; i++) {
        const b = await joinBot(srv, code, `Leak Bot ${i}`)
        b.conn.on('*', (m) => {
          const text = JSON.stringify(m)
          records.push({ stage: room.state.stage, text })
          // A tile reaches its own player only, and only when their investigation has ended.
          if (text.includes('"tiles":[{')) tilesSeen++
          for (const x of forbiddenFor(room, loaded.pack, b.playerId, open)) {
            if (text.includes(JSON.stringify(x).slice(1, -1))) { tileLeaks.push(`a tile text reached ${b.playerId} during ${room.state.stage} before its investigation ended: ${x.slice(0, 24)}`); break }
          }
        })
        playPlanning(b, srv.url, i + 7)
        bots.push(b)
      }
      const scrLink = await fetch(`${srv.url}/api/host/screen-link`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ code }) })
      const screenToken = ((await scrLink.json()) as { path: string }).path.split('#')[1]!
      const screen = attach(srv.ws, screenToken)
      screen.conn.on('*', (m) => records.push({ stage: room.state.stage, text: JSON.stringify(m) }))
      await until(() => bots.every((b) => b.status === 'open') && screen.status === 'open')

      while (room.state.stage !== 'closed') {
        const before = room.state.stage
        for (const b of bots) {
          for (const phase of ['planning', 'development', 'maintaining']) {
            const res = await fetch(`${srv.url}/api/content/${phase}`, { headers: { authorization: `Bearer ${b.token}` } })
            records.push({ stage: room.state.stage, text: await res.text() })
          }
        }
        const sess = await fetch(`${srv.url}/api/session/${code}`)
        records.push({ stage: room.state.stage, text: await sess.text() })
        // Phase 1 runs on its own clock, so the bots earn their tiles. Later phases are stubs.
        if (before !== 'planning.play' && (room.state.stageEndsAtMs === null || before.endsWith('.play') || before.startsWith('maintaining.'))) await step(srv.app, host, code)
        await until(() => room.state.stage !== before, 40_000, `leaving ${before}`)
      }
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
      expect(records.length).toBeGreaterThan(100)
      expect(tilesSeen).toBeGreaterThan(0)
      expect(structural).toEqual([])
      expect(tileLeaks).toEqual([])
      expect(leaks).toEqual([])
    } finally {
      await srv.app.close()
      srv.cleanup()
    }
  }, 120_000)
})
