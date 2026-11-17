// The leak scan (engineering spec, section 12.3). Bots play a whole game. Every byte sent to a
// player or screen socket and every content response is recorded with the stage it arrived in.
// The scan fails if a protected string of the pack appears before its moment.
// `npm run test:leak` runs it on the pack in CONTENT_DIR (with SYSTEMS if set).
import { describe, expect, it } from 'vitest'
import { loadPack, protectedStrings } from '@lab02/content-schema'
import { STAGES, type StageId } from '@lab02/protocol'
import { DEMO, attach, hostConn, hostToken, joinBot, startServer, step, until, type Bot } from './helpers.ts'

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
      const token = await hostToken(srv.url)
      const host = hostConn(srv.ws, token, code)
      await until(() => host.status === 'open')
      await host.command('set_scale', { scale: 50 })
      const bots: Bot[] = []
      for (let i = 0; i < 8; i++) {
        const b = await joinBot(srv, code, `Leak Bot ${i}`)
        b.conn.on('*', (m) => records.push({ stage: room.state.stage, text: JSON.stringify(m) }))
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
        if (room.state.stageEndsAtMs === null || before.endsWith('.play') || before.startsWith('maintaining.')) await step(srv.app, host, code)
        await until(() => room.state.stage !== before, 15_000, `leaving ${before}`)
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
      expect(records.length).toBeGreaterThan(100)
      expect(leaks).toEqual([])
    } finally {
      await srv.app.close()
      srv.cleanup()
    }
  }, 120_000)
})
