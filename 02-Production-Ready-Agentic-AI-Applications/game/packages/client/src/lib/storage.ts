// Browser storage, wrapped: a private window or blocked storage must never break the game.
export type PlayerAuth = { session: string; token: string; playerId: string; rejoinCode: string }

/** What this browser keeps of its last game: the practice and its points, never an answer. */
export type PastGame = {
  session: string; label: string; name: string; avatar: string; system: string
  points: { planning: number | null; development: number | null; maintaining: number | null; total: number }
  rank: number | null; of: number | null; scored: boolean
}

/**
 * A game whose report card this browser can ask for again (section 7.7): the session and the
 * rejoin code of the practice, which is what the server asks for. Newest first, ten at most.
 */
export type KeptResult = { session: string; label: string; name: string; rejoinCode: string }

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
  /** Put a game first in the list. The same game is kept once. */
  keepResult: (r: KeptResult) => {
    const rest = store.results().filter((x) => x.session !== r.session)
    const next = [r, ...rest].slice(0, 10)
    if (JSON.stringify(next) !== JSON.stringify(store.results())) write('lab02.results', next)
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
