import { GameConnection, playerApi } from '@lab02/protocol'

export const BUILD = __BUILD__
export const api = playerApi('')

export function socketUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${location.host}/ws`
}

export function connect(token: string, opts: { session?: string; host?: boolean; name?: string } = {}): GameConnection {
  return new GameConnection({
    url: socketUrl(), token, build: BUILD, session: opts.session, name: opts.name, commandFrame: opts.host ? 'hostcmd' : 'cmd',
  })
}

export async function hostFetch<T>(token: string, path: string, body?: unknown, method?: string): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string; message?: string }> {
  try {
    const res = await fetch(path, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok) return { ok: false, status: res.status, error: String(data.error ?? res.status), message: data.message as string | undefined }
    return { ok: true, data: data as T }
  } catch {
    return { ok: false, status: 0, error: 'network' }
  }
}

/** Reloads for a new build, but never twice within a minute, so a mismatch cannot loop. */
export function reloadForNewBuild(): void {
  try {
    const last = Number(sessionStorage.getItem('lab02.reloadAt') ?? 0)
    if (Date.now() - last < 60_000) return
    sessionStorage.setItem('lab02.reloadAt', String(Date.now()))
  } catch { /* storage unavailable: reload once anyway */ }
  location.reload()
}
