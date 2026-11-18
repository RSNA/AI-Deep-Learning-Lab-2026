// GameConnection: the one client of the socket, used by the browser, the bots, the load test
// and the LLM agent players (engineering spec, section 8). Runs in a browser and in Node 22.
import type { ErrorCode } from './ids.ts'

export const CLOSE = {
  unauthorized: 4001,
  superseded: 4002,
  removed: 4003,
  closed: 4004,
  helloTimeout: 4005,
  tooSlow: 4006,
} as const

export type ConnStatus = 'connecting' | 'open' | 'reconnecting' | 'closed' | 'superseded' | 'removed' | 'unauthorized'
export type CommandResult = { ok: boolean; error?: ErrorCode; data?: unknown }

type AnyMsg = { t: string; [k: string]: unknown }
type Listener = (msg: AnyMsg) => void

type WsLike = {
  readyState: number
  send(data: string): void
  close(code?: number, reason?: string): void
  onopen: ((ev: unknown) => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
  onclose: ((ev: { code: number }) => void) | null
  onerror: ((ev: unknown) => void) | null
}
type WsCtor = new (url: string) => WsLike

export type GameConnectionOptions = {
  /** Full socket URL, for example wss://example.org/ws */
  url: string
  token: string
  build: string
  /** A host names the session it drives. */
  session?: string
  /** A host console's name, shown to the other consoles, and its id, random per tab. */
  name?: string
  console?: string
  /** 'cmd' for players, 'hostcmd' for hosts. */
  commandFrame?: 'cmd' | 'hostcmd'
  WebSocketImpl?: WsCtor
  minDelayMs?: number
  maxDelayMs?: number
  random?: () => number
}

let cidCounter = 0
function newCid(random: () => number): string {
  cidCounter = (cidCounter + 1) % 1_000_000
  return `${Math.floor(random() * 2 ** 32).toString(36)}-${cidCounter.toString(36)}`
}

export class GameConnection {
  status: ConnStatus = 'connecting'
  private ws: WsLike | null = null
  private listeners = new Map<string, Set<Listener>>()
  private statusListeners = new Set<(s: ConnStatus) => void>()
  private pending = new Map<string, { frame: string; resolve: (r: CommandResult) => void }>()
  private attempt = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private stopped = false
  private welcomed = false
  private readonly opts: Required<Omit<GameConnectionOptions, 'session' | 'name' | 'console' | 'WebSocketImpl'>> & Pick<GameConnectionOptions, 'session' | 'name' | 'console' | 'WebSocketImpl'>

  constructor(opts: GameConnectionOptions) {
    this.opts = { commandFrame: 'cmd', minDelayMs: 500, maxDelayMs: 5000, random: Math.random, ...opts }
    this.connect()
  }

  /** Listen to one message type ('welcome', 'view', 'clock', ...). Returns an unsubscribe. */
  on(t: string, fn: Listener): () => void {
    let set = this.listeners.get(t)
    if (!set) this.listeners.set(t, (set = new Set()))
    set.add(fn)
    return () => set!.delete(fn)
  }

  onStatus(fn: (s: ConnStatus) => void): () => void {
    this.statusListeners.add(fn)
    return () => this.statusListeners.delete(fn)
  }

  /** Send a command. It is retried with the same id across reconnects until acknowledged. */
  command(type: string, payload: unknown = {}): Promise<CommandResult> {
    if (this.stopped) return Promise.resolve({ ok: false, error: 'bad_message' })
    const cid = newCid(this.opts.random)
    const frame = JSON.stringify({ t: this.opts.commandFrame, cid, type, payload })
    return new Promise((resolve) => {
      this.pending.set(cid, { frame, resolve })
      if (this.welcomed && this.ws && this.ws.readyState === 1) this.ws.send(frame)
    })
  }

  close(): void {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.setStatus('closed')
    this.ws?.close(1000)
    for (const p of this.pending.values()) p.resolve({ ok: false, error: 'bad_message' })
    this.pending.clear()
  }

  private setStatus(s: ConnStatus) {
    if (this.status === s) return
    this.status = s
    for (const fn of this.statusListeners) fn(s)
  }

  private emit(msg: AnyMsg) {
    for (const fn of this.listeners.get(msg.t) ?? []) fn(msg)
    for (const fn of this.listeners.get('*') ?? []) fn(msg)
  }

  private connect() {
    if (this.stopped) return
    const Impl = this.opts.WebSocketImpl ?? (globalThis as unknown as { WebSocket: WsCtor }).WebSocket
    const ws = new Impl(this.opts.url)
    this.ws = ws
    this.welcomed = false
    ws.onopen = () => {
      const hello: Record<string, unknown> = { t: 'hello', token: this.opts.token, build: this.opts.build }
      if (this.opts.session) hello.session = this.opts.session
      if (this.opts.name) hello.name = this.opts.name
      if (this.opts.console) hello.console = this.opts.console
      ws.send(JSON.stringify(hello))
    }
    ws.onmessage = (ev) => {
      let msg: AnyMsg
      try {
        msg = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)) as AnyMsg
      } catch {
        return
      }
      if (msg.t === 'welcome') {
        this.welcomed = true
        this.attempt = 0
        this.setStatus('open')
        this.emit(msg)
        for (const p of this.pending.values()) ws.send(p.frame)
        return
      }
      if (msg.t === 'ack') {
        const p = this.pending.get(msg.cid as string)
        if (p) {
          this.pending.delete(msg.cid as string)
          p.resolve({ ok: !!msg.ok, error: msg.error as ErrorCode | undefined, data: msg.data })
        }
      }
      this.emit(msg)
    }
    ws.onerror = () => { /* onclose follows */ }
    ws.onclose = (ev) => {
      if (this.ws !== ws) return
      this.ws = null
      if (this.stopped) return
      if (ev.code === CLOSE.superseded) return this.stop('superseded')
      if (ev.code === CLOSE.removed) return this.stop('removed')
      if (ev.code === CLOSE.unauthorized || ev.code === CLOSE.closed) return this.stop('unauthorized')
      this.setStatus('reconnecting')
      const base = Math.min(this.opts.maxDelayMs, this.opts.minDelayMs * 2 ** this.attempt)
      this.attempt++
      const delay = base * (0.5 + this.opts.random() * 0.5)
      this.timer = setTimeout(() => this.connect(), delay)
    }
  }

  private stop(s: ConnStatus) {
    this.stopped = true
    this.setStatus(s)
    for (const p of this.pending.values()) p.resolve({ ok: false, error: s === 'removed' ? 'removed' : 'bad_message' })
    this.pending.clear()
  }
}
