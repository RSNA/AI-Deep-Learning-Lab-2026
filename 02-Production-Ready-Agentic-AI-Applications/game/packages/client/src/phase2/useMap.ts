// The draft map of one player (engineering spec, section 10.5): the browser keeps it with an undo
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
export function useMap(v: Vocabulary, unlocked: ReadonlySet<string>, locked: boolean, onRefused?: (d: AckData) => void) {
  const view = usePlayer((s) => s.view)!
  const send = usePlayer((s) => s.send)
  const server = view.development!.map
  const key = `lab02.map.${view.me.id}.${view.run}`
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

  // Every change gets a number. Only the answer to the newest change ends the wait, so a view of
  // an older draft never overwrites a newer one.
  const seq = useRef(0)
  const push = useCallback((map: CanvasMap) => {
    pending.current = true
    const mine = ++seq.current
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      void send('development.set_map', { map }).then((r) => {
        if (mine !== seq.current) return
        pending.current = false
        const now = usePlayer.getState().view?.development?.map
        if (!r.ok) {
          // A line that a rule refuses is said at its place, not in the bar.
          const d = r.error === 'line_refused' ? (r.data as AckData | undefined) : undefined
          if (d && refusedRef.current) refusedRef.current(d)
          else setError(`${P2.refusedMap} ${plainError(r.error)}`)
          if (now) setH((prev) => ({ ...prev, map: now, past: prev.past.length && sameMap(prev.past.at(-1)!, now) ? prev.past.slice(0, -1) : prev.past }))
        }
      })
    }, 200)
  }, [send])

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

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
  }
}
