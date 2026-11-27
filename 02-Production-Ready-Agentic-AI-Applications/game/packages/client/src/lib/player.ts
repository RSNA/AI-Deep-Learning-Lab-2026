// The player's state in the browser: what the server last sent. The server owns everything.
// Moments only animate what a view already holds (speech bubbles, a new card), so a missed
// moment loses nothing.
import { create } from 'zustand'
import { PROTOCOL_VERSION, type ConnStatus, type GameConnection, type JoinResult, type Kind, type Moment, type PhaseContent, type PlayerView, type Review, type Standing, type Welcome } from '@lab02/protocol'
import type { ClockRef } from './clock.ts'
import { api, connect, reloadForNewBuild } from './net.ts'
import { store, type PastGame } from './storage.ts'

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
  /** The host started a phase or the whole game again while this browser was in it. */
  restarted: { kind: 'phase' | 'game'; run: number } | null
  clearRestarted(): void
  /** Show a game that ended, from what the server kept of it (section 7.5). Nothing is connected. */
  load(review: Review): void
  /** Forget everything of the game on show, before another one is opened. */
  unload(): void
  start(token: string): void
  stop(): void
  send(type: string, payload: unknown): Promise<{ ok: boolean; error?: string; data?: unknown }>
}

let bubbleKey = 0

/** Keeps the practice and its points in this browser, so they can be shown after the game has gone from the server. */
let kept = ''
function remember(w: Welcome | null, view: PlayerView | null, standing: Standing | null): void {
  if (!w || !view) return
  const pts = view.points
  const g: PastGame = {
    session: w.session.code, label: w.session.label, name: view.me.name, avatar: view.me.avatar, system: w.system.name,
    points: { planning: pts.planning?.points ?? null, development: pts.development?.points ?? null, maintaining: pts.maintaining?.points ?? null, total: pts.total },
    rank: standing?.ranks.overall ?? null, of: standing?.ranks.of ?? null,
    scored: pts.planning !== null || pts.development !== null || pts.maintaining !== null,
  }
  const text = JSON.stringify(g)
  if (text === kept) return
  kept = text
  store.setLast(g)
}

/** A view of a later run: what the browser kept of the run before is stale. */
function restartOf(prev: PlayerView | null, next: PlayerView): { kind: 'phase' | 'game'; run: number } | null {
  if (!prev || next.run <= prev.run) return null
  return { kind: next.stage === 'lobby' ? 'game' : 'phase', run: next.run }
}

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
  restarted: null,
  clearRestarted: () => set({ restarted: null }),
  load(review) {
    get().conn?.close()
    const view: PlayerView = { ...review.view, stage: 'closed' }
    const clock = { gameMs: 0, running: false, scale: 1, stage: 'closed' as const, stageEndsAtMs: null, guideEndsAtMs: null, warnings: [] }
    set({
      conn: null, status: 'idle', view, standing: review.standing, said: [], arrived: {}, restarted: null,
      clock: { clock, at: performance.now() },
      welcome: { t: 'welcome', protocol: PROTOCOL_VERSION, build: '', role: 'player', session: review.session, system: review.system, ladder: review.ladder, art: review.art, clock, view },
      content: Object.fromEntries(review.content.map((c) => [c.phase, c])),
    })
  },
  unload() {
    get().conn?.close()
    set({ conn: null, status: 'idle', welcome: null, view: null, clock: null, standing: null, content: {}, said: [], arrived: {}, restarted: null })
  },
  start(token) {
    get().conn?.close()
    const conn = connect(token)
    // The content of a phase is fetched once the phase has opened, also after the game has
    // ended, so that a player can look at a result again. The content of a board is made for
    // its player and holds only what is on their board: a view names the `board` it goes with,
    // and the content is asked again when more has come onto the board.
    const asked = new Set<string>()
    const boardOf = (x: unknown): number | null => (x && typeof (x as { board?: unknown }).board === 'number' ? (x as { board: number }).board : null)
    const fetchContent = (view: PlayerView) => {
      for (const phase of ['planning', 'development', 'maintaining'] as const) {
        if (view[phase] === null) continue
        const want = boardOf(view[phase])
        const have = get().content[phase]
        if (have && boardOf(have) === want) continue
        const key = `${phase}:${view.run}:${want ?? ''}`
        if (asked.has(key)) continue
        asked.add(key)
        void api.content(token, phase).then((r) => {
          if (r.ok) set((s) => ({ content: { ...s.content, [phase]: r.data } }))
          else asked.delete(key)
        })
      }
    }
    conn.onStatus((status) => set({ status }))
    conn.on('welcome', (m) => {
      const w = m as unknown as Welcome
      // Lines of interviews that run now are in the view: the transcript starts from them.
      const said: Bubble[] = []
      for (const r of w.view.planning?.running ?? []) r.lines.forEach((text) => said.push({ key: ++bubbleKey, speaker: '', inv: r.id, text, at: 0 }))
      const again = restartOf(get().view, w.view)
      set({
        welcome: w, view: w.view, clock: { clock: w.clock, at: performance.now() },
        said: get().said.length && !again ? get().said : said,
        ...(again ? { restarted: again, arrived: {} } : {}),
      })
      remember(w, w.view, get().standing)
      fetchContent(w.view)
    })
    conn.on('view', (m) => {
      const view = (m as unknown as { view: PlayerView }).view
      const prev = get().view
      if (prev && view.rev < prev.rev && view.stage === prev.stage && view.run === prev.run) return
      const again = restartOf(prev, view)
      set(again ? { view, restarted: again, said: [], arrived: {} } : { view })
      remember(get().welcome, view, get().standing)
      fetchContent(view)
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
    conn.on('standing', (m) => {
      const standing = (m as unknown as { standing: Standing }).standing
      set({ standing })
      remember(get().welcome, get().view, standing)
    })
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
    return r.ok ? { ok: true } : { ok: false, error: r.error, ...(r.data ? { data: r.data } : {}) }
  },
}))

export function forgetPlayer(): void {
  store.setPlayer(null)
}

/** This browser is in a game: it holds the practice, and keeps the game in its list (section 7.7). */
export function enterGame(r: JoinResult, game: { name: string; label: string; kind: Kind }): void {
  store.setPlayer({ session: r.session, token: r.token, playerId: r.playerId, rejoinCode: r.rejoinCode })
  store.keepResult({ session: r.session, label: game.label, name: game.name, rejoinCode: r.rejoinCode, kind: game.kind, token: r.token, playerId: r.playerId, startedAt: Date.now() })
}
