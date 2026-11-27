// Browser storage, wrapped: a private window or blocked storage must never break the game.
export type PlayerAuth = { session: string; token: string; playerId: string; rejoinCode: string }

/** What this browser keeps of its last game: the practice and its points, never an answer. */
export type PastGame = {
  session: string; label: string; name: string; avatar: string; system: string
  points: { planning: number | null; development: number | null; maintaining: number | null; total: number }
  rank: number | null; of: number | null; scored: boolean
}

/**
 * A game this browser played (section 7.7), newest first, thirty at most. The session and the
 * rejoin code of the practice are what the server asks for to show its result again. The token
 * and the player id are kept from the join, so the same browser can go back into a game that
 * is still open. `startedAt` is when this browser joined.
 */
export type KeptResult = {
  session: string; label: string; name: string; rejoinCode: string
  kind?: 'multi' | 'solo'; token?: string; playerId?: string; startedAt?: number
}
const KEPT_MAX = 30

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}
function write(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch { /* storage unavailable */ }
}

export const store = {
  player: () => read<PlayerAuth>('lab02.player'),
  setPlayer: (a: PlayerAuth | null) => write('lab02.player', a),
  last: () => read<PastGame>('lab02.last'),
  setLast: (g: PastGame | null) => write('lab02.last', g),
  results: (): KeptResult[] => {
    const list = read<KeptResult[]>('lab02.results')
    return Array.isArray(list) ? list.filter((r) => r && typeof r.session === 'string' && typeof r.rejoinCode === 'string') : []
  },
  /** Keep a game. One that is already kept stays where it is in the list and takes what is new. */
  keepResult: (r: KeptResult) => {
    const all = store.results()
    const i = all.findIndex((x) => x.session === r.session)
    const next = (i >= 0 ? all.map((x, k) => (k === i ? { ...x, ...r } : x)) : [r, ...all]).slice(0, KEPT_MAX)
    if (JSON.stringify(next) !== JSON.stringify(all)) write('lab02.results', next)
  },
  /** Let go of the games the server no longer holds. */
  dropResults: (sessions: string[]) => {
    if (sessions.length) write('lab02.results', store.results().filter((x) => !sessions.includes(x.session)))
  },
  host: () => read<{ token: string; name?: string }>('lab02.host'),
  setHost: (a: { token: string; name?: string } | null) => write('lab02.host', a),
  screen: () => read<{ token: string }>('lab02.screen'),
  setScreen: (a: { token: string } | null) => write('lab02.screen', a),
  theme: () => read<'light' | 'dark'>('lab02.theme'),
  setTheme: (t: 'light' | 'dark' | null) => write('lab02.theme', t),
  flag: (k: string) => read<boolean>(`lab02.flag.${k}`) === true,
  setFlag: (k: string) => write(`lab02.flag.${k}`, true),
}

/** A random id for this browser tab's host console (section 7.10). It survives a reload. */
export function consoleId(): string {
  try {
    let id = sessionStorage.getItem('lab02.console')
    if (!id) { id = `k${Math.random().toString(36).slice(2, 12)}`; sessionStorage.setItem('lab02.console', id) }
    return id
  } catch {
    return `k${Math.random().toString(36).slice(2, 12)}`
  }
}
