// The sorting board (engineering spec, section 10.4): ten spots in four bins, an Unsorted tray
// that scrolls inside itself, dragging with pointer events, and a class control on every
// problem card that does the same by tap or by the keys 1 to 4 and 0.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PlanningClass, PlanningContent } from '@lab02/protocol'
import { Sheet } from '../components/ui.tsx'
import { usePlayer } from '../lib/player.ts'
import { P1 } from './copy.ts'
import { askLine, isFull } from './model.ts'
import type { Board } from './useBoard.ts'

type Problem = PlanningContent['problems'][number]

export const classTone = (i: number) => `tone-${i % 4}`

// ------------------------------------------------------------------------------------------
// The class control: one button per class, and a way to clear
// ------------------------------------------------------------------------------------------
export function ClassControl({ board, pid, big = false }: { board: Board; pid: string; big?: boolean }) {
  const at = board.where(pid)
  return (
    <div className={`four${big ? ' big' : ''}`} role="group" aria-label="Class">
      {board.classes.map((c, i) => {
        const on = at?.cls === c.id
        const full = !on && isFull(board.layout, c.id)
        return (
          <button key={c.id} type="button" className={`${classTone(i)}${on ? ' on' : ''}${full ? ' full' : ''}`} aria-pressed={on}
            disabled={board.locked} title={`${i + 1}: ${c.label}${full ? ` (${P1.full})` : ''}`}
            onClick={(e) => { e.stopPropagation(); if (!on) board.toClass(pid, c.id) }}>
            <span>{c.short}</span>{full && <small>{P1.full}</small>}
          </button>
        )
      })}
      {at && !board.locked && (
        <button type="button" className="clr" aria-label={P1.clearLabel} title={`0: ${P1.clearLabel}`} onClick={(e) => { e.stopPropagation(); board.unsort(pid) }}>✕</button>
      )}
    </div>
  )
}

// ------------------------------------------------------------------------------------------
// Dragging with pointer events. A mouse drags a whole card; a finger drags from the grip, so
// the tray still scrolls by touch.
// ------------------------------------------------------------------------------------------
type DragState = { pid: string; title: string; x: number; y: number; w: number; dx: number; dy: number }
type Target = { kind: 'spot'; cls: string; spot: number } | { kind: 'bin'; cls: string } | { kind: 'tray' } | null

function targetAt(x: number, y: number): Target {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-spot],[data-bin],[data-tray]')
  if (!el) return null
  if (el.dataset.spot) {
    const [cls, spot] = el.dataset.spot.split(':')
    return { kind: 'spot', cls: cls!, spot: Number(spot) }
  }
  if (el.dataset.bin) return { kind: 'bin', cls: el.dataset.bin }
  return { kind: 'tray' }
}

function useDrag(board: Board) {
  const [drag, setDrag] = useState<DragState | null>(null)
  const [over, setOver] = useState<Target>(null)
  const startRef = useRef<{ pid: string; title: string; x: number; y: number; el: HTMLElement; id: number } | null>(null)
  const suppressClick = useRef(false)

  const onPointerDown = useCallback((e: React.PointerEvent, pid: string, title: string) => {
    if (board.locked || e.button !== 0) return
    const fromGrip = (e.target as HTMLElement).closest('.grip')
    if (e.pointerType !== 'mouse' && !fromGrip) return
    if ((e.target as HTMLElement).closest('button') && !fromGrip) return
    startRef.current = { pid, title, x: e.clientX, y: e.clientY, el: e.currentTarget as HTMLElement, id: e.pointerId }
  }, [board.locked])

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const st = startRef.current
      if (!st || e.pointerId !== st.id) return
      if (!drag && Math.hypot(e.clientX - st.x, e.clientY - st.y) < 6) return
      e.preventDefault()
      const r = st.el.getBoundingClientRect()
      setDrag((d) => d ? { ...d, x: e.clientX, y: e.clientY } : { pid: st.pid, title: st.title, x: e.clientX, y: e.clientY, w: Math.min(320, r.width), dx: st.x - r.left, dy: st.y - r.top })
      setOver(targetAt(e.clientX, e.clientY))
    }
    const up = (e: PointerEvent) => {
      const st = startRef.current
      if (!st || e.pointerId !== st.id) return
      startRef.current = null
      if (!drag) return
      suppressClick.current = true
      setTimeout(() => { suppressClick.current = false }, 0)
      const t = targetAt(e.clientX, e.clientY)
      setDrag(null)
      setOver(null)
      if (!t) return
      if (t.kind === 'spot') board.toSpot(st.pid, t.cls, t.spot)
      else if (t.kind === 'bin') board.toClass(st.pid, t.cls)
      else board.unsort(st.pid)
    }
    const cancel = () => { startRef.current = null; setDrag(null); setOver(null) }
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
    }
  }, [drag, board])

  return { drag, over, onPointerDown, suppressClick }
}

// ------------------------------------------------------------------------------------------
// Pieces of the laptop board
// ------------------------------------------------------------------------------------------
function TrayCard({ p, board, dragging, onPointerDown }: { p: Problem; board: Board; dragging: boolean; onPointerDown: (e: React.PointerEvent) => void }) {
  return (
    <div className={`pcard${dragging ? ' lifted' : ''}`} tabIndex={0} data-problem={p.id} onPointerDown={onPointerDown} onKeyDown={(e) => board.onKey(p.id, e)}
      aria-label={`${p.title}. ${P1.keys}`}>
      <span className="grip" aria-hidden="true" />
      <div className="pt">{p.title}</div>
      <div className="pd">{p.description}</div>
      <ClassControl board={board} pid={p.id} />
    </div>
  )
}

function Chip({ p, board, open, setOpen, dragging, onPointerDown, suppress }: {
  p: Problem; board: Board; open: boolean; setOpen: (o: boolean) => void; dragging: boolean
  onPointerDown: (e: React.PointerEvent) => void; suppress: React.RefObject<boolean>
}) {
  return (
    <div className={`schip${open ? ' open' : ''}${dragging ? ' lifted' : ''}`} tabIndex={0} data-problem={p.id}
      onPointerDown={onPointerDown}
      onClick={() => { if (!suppress.current) setOpen(!open) }}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setOpen(!open) } else board.onKey(p.id, e) }}
      aria-expanded={open} aria-label={`${p.title}. ${P1.keys}`}>
      <span className="grip" aria-hidden="true" />
      <span className="ct">{p.title}</span>
      {open && (
        <div className="chip-more" onClick={(e) => e.stopPropagation()}>
          <div className="pd">{p.description}</div>
          <ClassControl board={board} pid={p.id} />
        </div>
      )}
    </div>
  )
}

function BinLabel({ c, i, filled }: { c: PlanningClass; i: number; filled: number }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={`blab ${classTone(i)}`}>
      <button type="button" className="bs" onClick={() => setOpen(!open)} aria-expanded={open} title={c.label}>{c.short}</button>
      <div className="bn num">{P1.filled(filled, c.capacity)}</div>
      {open && (
        <div className="fits" role="note" onClick={() => setOpen(false)}>
          <b>{c.label}.</b> {c.fitsWhen}
          <div className="muted">{P1.rungs}: {c.rungs.length ? c.rungs.join(', ') : '–'}</div>
        </div>
      )}
    </div>
  )
}

export function AskSheet({ board, content }: { board: Board; content: PlanningContent }) {
  const a = board.ask
  if (!a) return null
  const cls = board.classes.find((c) => c.id === a.cls)!
  const title = content.problems.find((p) => p.id === a.pid)?.title ?? ''
  const inClass = (board.layout[a.cls] ?? []).filter((x): x is string => !!x)
  return (
    <Sheet title={P1.whoLeaves(cls.short)} head="sun" onClose={board.cancelAsk}>
      <p>{P1.whoLeavesText(title, cls.label)}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {inClass.map((pid) => (
          <button key={pid} type="button" className="btn text leavebtn" onClick={() => board.replace(a.pid, pid)}>
            <span>{content.problems.find((p) => p.id === pid)?.title}</span><span className="muted">{P1.leaves}</span>
          </button>
        ))}
      </div>
      <button type="button" className="btn small" onClick={board.cancelAsk}>{P1.cancel}</button>
    </Sheet>
  )
}

export function SendSheet({ board, content, onClose }: { board: Board; content: PlanningContent; onClose: () => void }) {
  const send = usePlayer((s) => s.send)
  const [busy, setBusy] = useState(false)
  const unsorted = content.problems.filter((p) => !board.picks[p.id])
  return (
    <Sheet title={P1.sendTitle} head="sun" onClose={onClose} wide>
      <div className="sendlist">
        {board.classes.map((c, i) => (
          <div key={c.id}>
            <div className={`sendhead ${classTone(i)}`}>{c.label} · {P1.filled(board.layout[c.id]!.filter(Boolean).length, c.capacity)}</div>
            <ul>{board.layout[c.id]!.filter((x): x is string => !!x).map((pid) => <li key={pid}>{content.problems.find((p) => p.id === pid)?.title}</li>)}</ul>
          </div>
        ))}
      </div>
      {unsorted.length > 0 && (
        <div className="err" style={{ color: 'var(--ink)' }}>
          {P1.stillUnsorted(unsorted.length)}
          <ul>{unsorted.map((p) => <li key={p.id}>{p.title}</li>)}</ul>
        </div>
      )}
      <p className="muted">{P1.sendText}</p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button type="button" className="btn go" disabled={busy} onClick={async () => {
          setBusy(true)
          await send('planning.submit', {})
          setBusy(false)
          onClose()
        }}>{P1.sendNow}</button>
        <button type="button" className="btn" onClick={onClose}>{P1.keepSorting}</button>
      </div>
    </Sheet>
  )
}

function SortHeader({ board, content, onSend }: { board: Board; content: PlanningContent; onSend: () => void }) {
  const n = Object.keys(board.picks).length
  return (
    <div className="coltitle">
      <h2>{P1.sort}</h2>
      <span className="sub">{P1.sorted(n, content.problems.length)}</span>
      {!board.locked && <button type="button" className="btn go sendbtn" onClick={onSend}>{P1.send}</button>}
    </div>
  )
}

// ------------------------------------------------------------------------------------------
// The laptop board
// ------------------------------------------------------------------------------------------
export function SortBoard({ board, content }: { board: Board; content: PlanningContent }) {
  const { drag, over, onPointerDown, suppressClick } = useDrag(board)
  const [openChip, setOpenChip] = useState<string | null>(null)
  useEffect(() => {
    if (!openChip) return
    const off = (e: PointerEvent) => { if (!(e.target as HTMLElement).closest(`[data-problem="${openChip}"]`)) setOpenChip(null) }
    window.addEventListener('pointerdown', off)
    return () => window.removeEventListener('pointerdown', off)
  }, [openChip])
  const [sending, setSending] = useState(false)
  const pv = usePlayer((s) => s.view?.planning)
  const unsorted = content.problems.filter((p) => !board.picks[p.id])
  const isOver = (t: Target) => JSON.stringify(t) === JSON.stringify(over)
  return (
    <section className={`sortcol${drag ? ' dragging' : ''}`} aria-label={P1.sort}>
      <SortHeader board={board} content={content} onSend={() => setSending(true)} />
      <div className="ask">{askLine(board.classes, content.problems.length)}</div>
      {board.locked && pv?.status === 'submitted' && <div className="locked">{P1.sent}</div>}
      <div className={`tray${isOver({ kind: 'tray' }) ? ' over' : ''}`} data-tray="1">
        <div className="thead"><span>{P1.unsorted(unsorted.length)}</span><span className="muted">{unsorted.length ? P1.dragHint : ''}</span></div>
        <div className="tlist">
          {unsorted.length === 0 && <div className="muted tray-empty">{P1.allSorted}</div>}
          {unsorted.map((p) => <TrayCard key={p.id} p={p} board={board} dragging={drag?.pid === p.id} onPointerDown={(e) => onPointerDown(e, p.id, p.title)} />)}
        </div>
      </div>
      <div className="bins">
        {board.classes.map((c, i) => {
          const spots = board.layout[c.id]!
          return (
            <div key={c.id} className={`bin${isOver({ kind: 'bin', cls: c.id }) ? ' over' : ''}${i >= board.classes.length / 2 ? ' up' : ''}`} data-bin={c.id}>
              <BinLabel c={c} i={i} filled={spots.filter(Boolean).length} />
              <div className="drop">
                {spots.map((pid, si) => {
                  const p = pid ? content.problems.find((x) => x.id === pid) : undefined
                  const hot = isOver({ kind: 'spot', cls: c.id, spot: si })
                  return (
                    <div key={si} className={`spot${p ? ' filled' : ''}${hot ? ' hot' : ''}`} data-spot={`${c.id}:${si}`}>
                      {p
                        ? <Chip p={p} board={board} open={openChip === p.id} setOpen={(o) => setOpenChip(o ? p.id : null)} dragging={drag?.pid === p.id}
                            onPointerDown={(e) => onPointerDown(e, p.id, p.title)} suppress={suppressClick} />
                        : <div className="empty">{hot ? P1.dropHere : P1.spot(si + 1)}</div>}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
      {drag && (
        <div className="ghost" style={{ left: drag.x - drag.dx, top: drag.y - drag.dy, width: drag.w }} aria-hidden="true">
          <span className="grip" />{drag.title}
        </div>
      )}
      {board.error && <div className="toast" role="alert" onClick={board.clearError}>{P1.refused}</div>}
      <AskSheet board={board} content={content} />
      {sending && <SendSheet board={board} content={content} onClose={() => setSending(false)} />}
    </section>
  )
}

// ------------------------------------------------------------------------------------------
// The phone board: the class control is the only way to sort
// ------------------------------------------------------------------------------------------
export function PhoneSort({ board, content, onEvidence, focus }: { board: Board; content: PlanningContent; onEvidence: (pid: string) => void; focus: string | null }) {
  const [sending, setSending] = useState(false)
  const pv = usePlayer((s) => s.view?.planning)
  useEffect(() => {
    if (focus) document.querySelector(`[data-problem="${focus}"]`)?.scrollIntoView({ block: 'center' })
  }, [focus])
  return (
    <section className="phone-sort sortcol" aria-label={P1.sort}>
      <SortHeader board={board} content={content} onSend={() => setSending(true)} />
      <div className="pstrip">
        {board.classes.map((c, i) => (
          <div key={c.id} className={classTone(i)}>
            <div className="n num">{board.layout[c.id]!.filter(Boolean).length}<span className="of"> of {c.capacity}</span></div>
            <div className="l">{c.short}</div>
          </div>
        ))}
      </div>
      <div className="ask">{askLine(board.classes, content.problems.length)}</div>
      {board.locked && pv?.status === 'submitted' && <div className="locked">{P1.sent}</div>}
      <div className="plist">
        {content.problems.map((p) => (
          <div key={p.id} className={`phcard${board.picks[p.id] ? ' sorted' : ''}`} data-problem={p.id}>
            <div className="pt">{p.title}</div>
            <div className="pd">{p.description}</div>
            <ClassControl board={board} pid={p.id} big />
            <button type="button" className="linkbtn" onClick={() => onEvidence(p.id)}>{P1.toEvidence} →</button>
          </div>
        ))}
      </div>
      {board.error && <div className="toast" role="alert" onClick={board.clearError}>{P1.refused}</div>}
      <AskSheet board={board} content={content} />
      {sending && <SendSheet board={board} content={content} onClose={() => setSending(false)} />}
    </section>
  )
}
