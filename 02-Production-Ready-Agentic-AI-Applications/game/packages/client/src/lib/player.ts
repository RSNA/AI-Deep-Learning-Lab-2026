// The player's state in the browser: what the server last sent. The server owns everything.
// Moments only animate what a view already holds (speech bubbles, a new card), so a missed
// moment loses nothing.
import { create } from 'zustand'
import type { ConnStatus, GameConnection, Moment, PhaseContent, PlayerView, Standing, Welcome } from '@lab02/protocol'
import type { ClockRef } from './clock.ts'
import { api, connect, reloadForNewBuild } from './net.ts'
import { store } from './storage.ts'

export type Bubble = { key: number; speaker: string; text: string; at: number; inv?: string }

type PlayerStore = {
  status: ConnStatus | 'idle'
  welcome: Welcome | null
  view: PlayerView | null
  clock: ClockRef | null
  standing: Standing | null
  content: Partial<Record<string, PhaseContent>>
  conn: GameConnection | null
  /** Lines said in the room, newest last: interview lines and dialogue. */
  said: Bubble[]
  /** Investigations whose card arrived in this browser, with the time it arrived. */
  arrived: Record<string, number>
  start(token: string): void
  stop(): void
  send(type: string, payload: unknown): Promise<{ ok: boolean; error?: string }>
}

let bubbleKey = 0

export const usePlayer = create<PlayerStore>((set, get) => ({
  status: 'idle',
  welcome: null,
  view: null,
  clock: null,
  standing: null,
  content: {},
  conn: null,
  said: [],
  arrived: {},
  start(token) {
    get().conn?.close()
    const conn = connect(token)
    const fetchContent = (stage: string, opened: boolean) => {
      const phase = stage.split('.')[0]!
      if (!opened || get().content[phase]) return
      void api.content(token, phase).then((r) => {
        if (r.ok) set((s) => ({ content: { ...s.content, [phase]: r.data } }))
      })
    }
    conn.onStatus((status) => set({ status }))
    conn.on('welcome', (m) => {
      const w = m as unknown as Welcome
      // Lines of interviews that run now are in the view: the transcript starts from them.
      const said: Bubble[] = []
      for (const r of w.view.planning?.running ?? []) r.lines.forEach((text) => said.push({ key: ++bubbleKey, speaker: '', inv: r.id, text, at: 0 }))
      set({ welcome: w, view: w.view, clock: { clock: w.clock, at: performance.now() }, said: get().said.length ? get().said : said })
      fetchContent(w.view.stage, w.view.planning !== null)
    })
    conn.on('view', (m) => {
      const view = (m as unknown as { view: PlayerView }).view
      const prev = get().view
      if (prev && view.rev < prev.rev && view.stage === prev.stage) return
      set({ view })
      fetchContent(view.stage, view.planning !== null)
    })
    conn.on('moment', (m) => {
      const mo = (m as unknown as { moment: Moment }).moment
      if (mo.kind === 'interview_line' || mo.kind === 'dialogue') {
        const b: Bubble = { key: ++bubbleKey, speaker: mo.speaker, text: mo.text, at: performance.now(), ...(mo.kind === 'interview_line' ? { inv: mo.investigation } : {}) }
        set((s) => ({ said: [...s.said, b].slice(-40) }))
      } else if (mo.kind === 'tile') {
        set((s) => ({ arrived: { ...s.arrived, [mo.investigation]: performance.now() } }))
      }
    })
    conn.on('clock', (m) => set({ clock: { clock: (m as unknown as { clock: ClockRef['clock'] }).clock, at: performance.now() } }))
    conn.on('standing', (m) => set({ standing: (m as unknown as { standing: Standing }).standing }))
    conn.on('reload', () => reloadForNewBuild())
    set({ conn, status: 'connecting' })
  },
  stop() {
    get().conn?.close()
    set({ conn: null, status: 'idle' })
  },
  async send(type, payload) {
    const conn = get().conn
    if (!conn) return { ok: false, error: 'network' }
    const r = await conn.command(type, payload)
    return r.ok ? { ok: true } : { ok: false, error: r.error }
  },
}))

export function forgetPlayer(): void {
  store.setPlayer(null)
}
