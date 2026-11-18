// Browser storage, wrapped: a private window or blocked storage must never break the game.
export type PlayerAuth = { session: string; token: string; playerId: string; rejoinCode: string }

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
