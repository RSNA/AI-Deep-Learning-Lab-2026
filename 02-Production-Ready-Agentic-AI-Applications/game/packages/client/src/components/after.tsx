// After a game: the way on to the game that is open now, and what this browser kept of its
// last game (engineering spec, sections 7.7 and 10.2).
import { useEffect, useState } from 'react'
import { COPY, PHASE_NUMBER } from '../copy.ts'
import { api } from '../lib/net.ts'
import type { PastGame } from '../lib/storage.ts'
import { Avatar } from './ui.tsx'

type Open = { code: string; label: string }

/**
 * The session that was opened after the game `after` and takes players now. Asked again every
 * 8 seconds. With `on` false nothing is asked and the answer is null.
 */
export function useOpenGame(after: string, on: boolean = true): Open | null {
  const [open, setOpen] = useState<Open | null>(null)
  useEffect(() => {
    if (!on) { setOpen(null); return }
    let live = true
    const load = () => api.open(after).then((r) => {
      if (!live || !r.ok) return
      const s = r.data.session
      setOpen(s && s.code !== after ? { code: s.code, label: s.label } : null)
    })
    void load()
    const id = setInterval(load, 8000)
    return () => { live = false; clearInterval(id) }
  }, [after, on])
  return open
}

/**
 * For a practice run (a test or a rehearsal) that is still open while the host has opened a
 * newer one: the way over to it. An event never shows this, so no player leaves it by a slip.
 */
export function NewerGame({ after, on, onJoin }: { after: string; on: boolean; onJoin: (code: string) => void }) {
  const open = useOpenGame(after, on)
  if (!open) return null
  return (
    <section className="panel newgame" role="status">
      <div className="panel-head">{COPY.newerGameTitle}</div>
      <div className="panel-body">
        <div style={{ fontWeight: 800, fontSize: 17 }}>{open.label}</div>
        <div className="hint">{COPY.newerGameStill}</div>
        <button type="button" className="btn small newerbtn" onClick={() => onJoin(open.code)}>{COPY.joinNewerGame}</button>
      </div>
    </section>
  )
}

/** A panel that leads to the game the host opened after the game `after`. Before there is one it says so. */
export function NewGame({ after, onJoin }: { after: string; onJoin: (code: string) => void }) {
  const open = useOpenGame(after)
  if (!open) return <p className="muted" role="status">{COPY.noNewGame}</p>
  return (
    <section className="panel newgame" role="status">
      <div className="panel-head">{COPY.newGameTitle}</div>
      <div className="panel-body">
        <div style={{ fontWeight: 800, fontSize: 17 }}>{open.label}</div>
        <button type="button" className="btn go big" onClick={() => onJoin(open.code)}>{COPY.joinNewGame}</button>
      </div>
    </section>
  )
}

/** The practice and its points, as this browser kept them. */
export function PastGameCard({ game, title }: { game: PastGame; title?: string }) {
  const phases = ['planning', 'development', 'maintaining'] as const
  return (
    <section className="panel">
      <div className="panel-head lav">{title ?? game.label}</div>
      <div className="panel-body">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Avatar id={game.avatar} size={40} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 17 }}>{game.name}</div>
            <div className="muted" style={{ fontSize: 14 }}>{title ? `${game.label} · ${game.system}` : game.system}</div>
          </div>
          {game.rank !== null && game.of !== null && (
            <div className="num" style={{ marginLeft: 'auto', fontSize: 32, whiteSpace: 'nowrap' }}>#{game.rank} <span className="muted" style={{ fontSize: 18 }}>{COPY.ofWord} {game.of}</span></div>
          )}
        </div>
        {game.scored ? (
          <div>
            {phases.map((ph) => (
              <div key={ph} className="kv"><span>{`Phase ${PHASE_NUMBER[ph]}`}</span><span className="v">{game.points[ph] ?? '–'}</span></div>
            ))}
            <div className="kv" style={{ borderBottom: 0 }}><span style={{ fontWeight: 800 }}>{COPY.total}</span><span className="v" style={{ fontSize: 24 }}>{game.points.total}</span></div>
          </div>
        ) : <p className="muted">{COPY.noPhaseScored}</p>}
      </div>
    </section>
  )
}
