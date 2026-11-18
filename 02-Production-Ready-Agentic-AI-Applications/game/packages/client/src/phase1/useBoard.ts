// The board of one player: the local layout, saved to the server 300 ms after the last change
// (engineering spec, section 10.4). A refusal puts the board back to what the server holds.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PlanningContent } from '@lab02/protocol'
import { usePlayer } from '../lib/player.ts'
import { dropInClass, dropOnSpot, picksOf, reconcile, replaceIn, unsort, whereIs, type Layout } from './model.ts'

const KEY = (player: string) => `lab02.layout.${player}`

function loadLayout(player: string): Layout | null {
  try { const raw = localStorage.getItem(KEY(player)); return raw ? (JSON.parse(raw) as Layout) : null } catch { return null }
}
function saveLayout(player: string, l: Layout): void {
  try { localStorage.setItem(KEY(player), JSON.stringify(l)) } catch { /* storage unavailable */ }
}

const same = (a: Record<string, string>, b: Record<string, string>) => {
  const ka = Object.keys(a), kb = Object.keys(b)
  return ka.length === kb.length && ka.every((k) => a[k] === b[k])
}

export type Board = ReturnType<typeof useBoard>

export function useBoard(content: PlanningContent) {
  const view = usePlayer((s) => s.view)!
  const send = usePlayer((s) => s.send)
  const me = view.me.id
  const server = view.planning?.picks ?? {}
  const classes = content.rules.classes
  const ids = content.problems.map((p) => p.id)
  const [layout, setLayout] = useState<Layout>(() => reconcile(classes, ids, server, loadLayout(me)))
  const [error, setError] = useState<string | null>(null)
  const [ask, setAsk] = useState<{ pid: string; cls: string } | null>(null)
  const pending = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const locked = view.planning?.status !== 'playing'

  // The server's picks win whenever nothing local is waiting to be saved.
  const serverKey = JSON.stringify(server)
  useEffect(() => {
    if (pending.current) return
    setLayout((prev) => (same(picksOf(prev), server) ? prev : reconcile(classes, ids, server, prev)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverKey])

  useEffect(() => { saveLayout(me, layout) }, [me, layout])

  const commit = useCallback((next: Layout) => {
    if (locked) return
    setLayout(next)
    setError(null)
    pending.current = true
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const picks = picksOf(next)
      void send('planning.set_report', { picks }).then((r) => {
        pending.current = false
        if (!r.ok) {
          setError(r.error ?? 'refused')
          const now = usePlayer.getState().view?.planning?.picks ?? {}
          setLayout((prev) => reconcile(classes, ids, now, prev))
        }
      })
    }, 300)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked, send])

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  /** Send a problem to a class. A full class asks which of its problems leaves. */
  const toClass = useCallback((pid: string, cls: string) => {
    const next = dropInClass(layout, pid, cls)
    if (next === null) setAsk({ pid, cls })
    else if (next !== layout) commit(next)
  }, [layout, commit])

  return {
    layout, classes, locked, error, ask,
    picks: picksOf(layout),
    where: (pid: string) => whereIs(layout, pid),
    toClass,
    toSpot: (pid: string, cls: string, spot: number) => commit(dropOnSpot(layout, pid, cls, spot)),
    unsort: (pid: string) => commit(unsort(layout, pid)),
    replace: (pid: string, leaving: string) => { commit(replaceIn(layout, pid, leaving)); setAsk(null) },
    cancelAsk: () => setAsk(null),
    clearError: () => setError(null),
    /** Keys 1 to 4 pick the class in class_order, 0 clears (the keyboard path). */
    onKey: (pid: string, e: React.KeyboardEvent) => {
      if (locked || e.altKey || e.ctrlKey || e.metaKey) return
      const n = Number(e.key)
      if (e.key === '0') { e.preventDefault(); commit(unsort(layout, pid)) }
      else if (Number.isInteger(n) && n >= 1 && n <= classes.length) { e.preventDefault(); toClass(pid, classes[n - 1]!.id) }
    },
  }
}
