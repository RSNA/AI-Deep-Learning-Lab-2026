// The player's state in the browser: what the server last sent. The server owns everything.
import { create } from 'zustand'
import type { ConnStatus, GameConnection, PhaseContent, PlayerView, Standing, Welcome } from '@lab02/protocol'
import type { ClockRef } from './clock.ts'
import { api, connect, reloadForNewBuild } from './net.ts'
import { store } from './storage.ts'

type PlayerStore = {
  status: ConnStatus | 'idle'
  welcome: Welcome | null
  view: PlayerView | null
  clock: ClockRef | null
  standing: Standing | null
  content: Partial<Record<string, PhaseContent>>
  conn: GameConnection | null
  start(token: string): void
  stop(): void
}

export const usePlayer = create<PlayerStore>((set, get) => ({
  status: 'idle',
  welcome: null,
  view: null,
  clock: null,
  standing: null,
  content: {},
  conn: null,
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
      set({ welcome: w, view: w.view, clock: { clock: w.clock, at: performance.now() } })
      fetchContent(w.view.stage, w.view.planning !== null)
    })
    conn.on('view', (m) => {
      const view = (m as unknown as { view: PlayerView }).view
      const prev = get().view
      if (prev && view.rev < prev.rev && view.stage === prev.stage) return
      set({ view })
      fetchContent(view.stage, view.planning !== null)
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
}))

export function forgetPlayer(): void {
  store.setPlayer(null)
}
