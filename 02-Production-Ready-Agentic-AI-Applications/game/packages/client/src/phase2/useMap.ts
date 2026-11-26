// The draft map of one player, in Phase 2 or Phase 3 (engineering spec, section 10.5): the browser keeps it with an undo
// and redo history of its own, and sends `set_map` after every change, never a map it knows to be
// invalid. Whenever nothing local waits to be saved, the server's draft wins: after a reload, a
// reconnect or a refusal.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AckData, CanvasMap } from '@lab02/protocol'
import { mapProblem, sameMap, type Vocabulary } from '../canvas/model.ts'
import { plainError } from '../lib/errors.ts'
import { usePlayer } from '../lib/player.ts'
import { P2 } from './copy.ts'

const DEPTH = 40
type History = { map: CanvasMap; past: CanvasMap[]; future: CanvasMap[] }

function load(key: string): History | null {
  try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) as History) : null } catch { return null }
}
function save(key: string, h: History): void {
  try { localStorage.setItem(key, JSON.stringify(h)) } catch { /* storage unavailable */ }
}

export type MapDraft = ReturnType<typeof useMap>

/** `onRefused` hears of a line that a rule of the pack refuses, with its words; the map goes back as it was. */
export function useMap(phase: 'development' | 'maintaining', v: Vocabulary, unlocked: ReadonlySet<string>, locked: boolean, onRefused?: (d: AckData) => void) {
  const view = usePlayer((s) => s.view)!
  const send = usePlayer((s) => s.send)
  const server = (view[phase] as { map: CanvasMap } | null)!.map
  // Phase 2 keeps the key it always had. Phase 3 has a history of its own.
  const key = phase === 'development' ? `lab02.map.${view.me.id}.${view.run}` : `lab02.map.${phase}.${view.me.id}.${view.run}`
  const [h, setH] = useState<History>(() => {
    const kept = load(key)
    return kept && sameMap(kept.map, server) ? kept : { map: server, past: kept?.past ?? [], future: [] }
  })
  const [error, setError] = useState<string | null>(null)
  const pending = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const unlockedRef = useRef(unlocked)
  unlockedRef.current = unlocked
  const refusedRef = useRef(onRefused)
  refusedRef.current = onRefused
  const hRef = useRef(h)
  hRef.current = h

  useEffect(() => { save(key, h) }, [key, h])

  // The server's draft wins whenever nothing local waits to be saved.
  const serverKey = JSON.stringify(server)
  useEffect(() => {
    if (pending.current) return
    setH((prev) => (sameMap(prev.map, server) ? prev : { ...prev, map: server }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverKey])

  // Whoever must act on the saved draft (a validation) waits until nothing is on its way.
  const waiters = useRef<(() => void)[]>([])
  const release = () => { const w = waiters.current; waiters.current = []; for (const f of w) f() }
  const settled = useCallback((): Promise<void> => (pending.current ? new Promise((resolve) => { waiters.current.push(resolve) }) : Promise.resolve()), [])

  // Every change gets a number. Only the answer to the newest change ends the wait, so a view of
  // an older draft never overwrites a newer one.
  const seq = useRef(0)
  const pushRef = useRef<(map: CanvasMap) => void>(() => {})
  const push = useCallback((map: CanvasMap) => {
    pending.current = true
    const mine = ++seq.current
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      void send(`${phase}.set_map`, { map }).then((r) => {
        if (mine !== seq.current) return
        pending.current = false
        const now = (usePlayer.getState().view?.[phase] as { map: CanvasMap } | null | undefined)?.map
        if (!r.ok) {
          // A line that a rule refuses is said at its place, not in the bar.
          const d = r.error === 'line_refused' ? (r.data as AckData | undefined) : undefined
          if (d && refusedRef.current) refusedRef.current(d)
          else setError(`${P2.refusedMap} ${plainError(r.error)}`)
          // A refused line is taken off the draft and the rest is kept and saved: changes made in
          // the same moment (before the last save went out) must not be lost with it.
          const cur = hRef.current
          const isIt = (l: { from: string; to: string }) => !!d && l.from === d.line.from && l.to === d.line.to
          if (d && cur.map.lines.some(isIt)) {
            const cleaned = { tiles: cur.map.tiles, lines: cur.map.lines.filter((l) => !isIt(l)) }
            const h2 = { ...cur, map: cleaned, past: cur.past.length && sameMap(cur.past.at(-1)!, cleaned) ? cur.past.slice(0, -1) : cur.past }
            hRef.current = h2
            setH(h2)
            if (!now || !sameMap(cleaned, now)) pushRef.current(cleaned)
            else release()
            return
          }
          if (now) setH((prev) => ({ ...prev, map: now, past: prev.past.length && sameMap(prev.past.at(-1)!, now) ? prev.past.slice(0, -1) : prev.past }))
        }
        release()
      })
    }, 200)
  }, [send, phase])
  pushRef.current = push

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); release() }, [])

  /** Make a change. Returns false when the browser can tell it breaks a rule. */
  const commit = useCallback((next: CanvasMap): boolean => {
    if (locked) return false
    if (mapProblem(next, v, unlockedRef.current) !== null) return false
    const prev = hRef.current
    if (sameMap(prev.map, next)) return true
    const h2 = { map: next, past: [...prev.past, prev.map].slice(-DEPTH), future: [] }
    hRef.current = h2
    setH(h2)
    setError(null)
    push(next)
    return true
  }, [locked, v, push])

  const step = useCallback((back: boolean) => {
    if (locked) return
    const prev = hRef.current
    const from = back ? prev.past : prev.future
    // An earlier map may hold an item the practice can no longer use: skip it.
    for (let i = from.length - 1; i >= 0; i--) {
      const m = from[i]!
      if (mapProblem(m, v, unlockedRef.current) !== null) continue
      const rest = from.slice(0, i)
      const h2 = back ? { map: m, past: rest, future: [...prev.future, prev.map] } : { map: m, past: [...prev.past, prev.map], future: rest }
      hRef.current = h2
      setH(h2)
      push(m)
      return
    }
  }, [locked, v, push])

  return {
    map: h.map,
    canUndo: h.past.length > 0 && !locked,
    canRedo: h.future.length > 0 && !locked,
    commit,
    undo: () => step(true),
    redo: () => step(false),
    error,
    clearError: () => setError(null),
    /** Resolves once the last change has been saved, at once when nothing waits. */
    settled,
  }
}
