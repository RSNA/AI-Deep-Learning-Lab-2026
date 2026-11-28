// The guided first build of Phase 2 (engineering spec, section 10.5). After the tour, a second,
// hands-on tutorial in the manner of the first minutes of a video game: a ring around one part
// of the screen, a card that says in a sentence or two what to do there, and the next step only
// when the player has done it. The rest of the screen is dimmed and stays usable, so a player
// who does something else is never blocked, and one who does a later step is caught up with:
// the steps are read off the pack, the view and the draft (./firstBuild.ts), never off clicks.
// It runs once for each player in a browser, the help panel starts it again, and "Skip the
// tutorial" ends it at any step.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import type { DevelopmentContent, DevelopmentView } from '@lab02/protocol'
import { GUIDE_PAD, placeCard, useCardSize } from '../components/guideCard.ts'
import { gameNow, useTick } from '../lib/clock.ts'
import { bringIntoView, shownChildrenRect, shownRect, type Rect } from '../lib/inView.ts'
import { usePlayer } from '../lib/player.ts'
import { store } from '../lib/storage.ts'
import type { BoardApi, BoardTab } from './Board.tsx'
import { P2 } from './copy.ts'
import { firstPlan, firstStep, firstStepNumber, type FirstPlan, type FirstStep } from './firstBuild.ts'

/** Whether the tutorial is in front of the player. The help panel starts it again. */
export const useFirstBuild = create<{ open: boolean; start: () => void; end: () => void }>((set) => ({
  open: false,
  start: () => set({ open: true }),
  end: () => set({ open: false }),
}))

/** Where a step is: before its first press (`a`) or after it (`b`: something is picked, a chooser is open, a line is being drawn). */
type Half = 'a' | 'b'
const F = P2.first

/** The first element of a selector that is on the screen now (a phone tab may hide the others). */
function onScreen(selector: string): HTMLElement | null {
  return [...document.querySelectorAll<HTMLElement>(selector)].find((el) => el.getClientRects().length > 0) ?? null
}

/** A label inside a sentence: "radiologist", and "AI agent" as it is. */
const inline = (label: string) => (/^[A-Z][a-z]/.test(label) ? label.charAt(0).toLowerCase() + label.slice(1) : label)

/** Whether the chooser that is open is the one a title of the board names ("Model for ..."). */
function chooserIs(title: (label: string) => string): boolean {
  const said = document.querySelector('.scrim [role="dialog"]')?.getAttribute('aria-label')
  if (!said) return false
  const [before, after] = title('\u0000').split('\u0000') as [string, string]
  return said.startsWith(before) && said.endsWith(after)
}

/** The element a step is about, and which half of the step the screen is in. */
function targetOf(step: FirstStep): { el: HTMLElement | null; half: Half } {
  const tile = (id: string) => onScreen(`[data-tile="${id}"]`)
  // A line is being drawn when a dot of a tile or of a source is pressed in.
  const drawing = () => !!onScreen('.cport.on') || !!onScreen('.csource.from')
  const part = (id: string, at: number) => document.querySelectorAll<HTMLElement>(`[data-tile="${id}"] .ct-part`)[at] ?? tile(id)
  switch (step.id) {
    case 'action': case 'wait': return { el: onScreen(`[data-action="${step.action}"]`), half: 'a' }
    case 'card': return { el: onScreen(`[data-insight="${step.action}"]`) ?? onScreen('#p2-insights'), half: 'a' }
    case 'place': case 'person': {
      // Picked in the toolbox. A phone has gone to the map by then, where the empty cells carry a plus.
      const picked = !!onScreen(`.tbrow.on[data-worker="${step.worker}"]`) || (!onScreen('.tbrow') && !!onScreen('.ccell-plus'))
      return picked ? { el: onScreen('[data-tour="p2-grid"]'), half: 'b' } : { el: onScreen(`[data-worker="${step.worker}"]`), half: 'a' }
    }
    case 'model': return chooserIs(P2.modelOf) ? { el: onScreen('.scrim .partlist'), half: 'b' } : { el: part(step.tile, 0), half: 'a' }
    case 'runsOn': return chooserIs(P2.computeOf) ? { el: onScreen('.scrim .partlist'), half: 'b' } : { el: part(step.tile, 1), half: 'a' }
    case 'prompt': return chooserIs(P2.promptOf) ? { el: onScreen('.scrim .pcards'), half: 'b' } : { el: part(step.tile, 2), half: 'a' }
    case 'source': return drawing() ? { el: tile(step.tile), half: 'b' } : { el: onScreen('[data-tour="p2-sources"]'), half: 'a' }
    case 'handoff': return drawing() ? { el: tile(step.to), half: 'b' } : { el: tile(step.from), half: 'a' }
    case 'result': return drawing() ? { el: onScreen('[data-tour="p2-result"]'), half: 'b' } : { el: tile(step.from), half: 'a' }
    case 'validate': case 'validating': return { el: onScreen('[data-tour="p2-validate"]'), half: 'a' }
    case 'done': return { el: onScreen('#p2-results'), half: 'a' }
  }
}

/** The tab of a phone that holds a step. */
function tabOf(step: FirstStep): BoardTab {
  switch (step.id) {
    case 'action': case 'wait': return 'actions'
    case 'card': case 'done': return 'results'
    case 'place': case 'person': return 'toolbox'
    default: return 'map'
  }
}

export function FirstBuild({ api, dv, content, who }: {
  api: BoardApi; dv: DevelopmentView; content: DevelopmentContent
  /** The player and the run of the game: the tutorial is remembered for each. */
  who: string
}) {
  useTick(500)
  const open = useFirstBuild((s) => s.open)
  const start = useFirstBuild((s) => s.start)
  const end = useFirstBuild((s) => s.end)
  const clock = usePlayer((s) => s.clock)
  const doneKey = `firstbuild-${who}`
  const [told, setTold] = useState({ read: false, promptKept: false })
  const planRef = useRef<FirstPlan | null>(null)
  const apiRef = useRef(api)
  apiRef.current = api

  // It starts by itself once, when the tour of the phase has ended and nothing else is in front
  // of the player. A player who has validated already knows the way.
  useEffect(() => {
    if (open || api.briefOpen || api.touring || store.flag(doneKey) || !store.flag(`tour-development-${who}`)) return
    if (dv.validations.length) { store.setFlag(doneKey); return }
    start()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, api.briefOpen, api.touring, doneKey, who])
  // It ends with the screen of the phase.
  useEffect(() => () => useFirstBuild.getState().end(), [])
  // Each time it starts, it starts from what the player has not said yet.
  useEffect(() => { if (open) setTold({ read: false, promptKept: false }) }, [open])

  const plan = open ? firstPlan(content, dv, planRef.current) : null
  planRef.current = plan
  const step = plan && open && !api.touring && !api.briefOpen ? firstStep(plan, content, dv, api.map, told, clock ? gameNow(clock) : 0) : null
  const finish = () => { store.setFlag(doneKey); end() }
  // A board with nothing to guide on ends the tutorial quietly.
  useEffect(() => { if (open && !plan) { store.setFlag(doneKey); end() } }, [open, plan, doneKey, end])

  // Where the ring is, for which step it was measured: a new step starts unmeasured.
  const [seen, setAt] = useState<{ key: string; rect: Rect | null; half: Half; sheet: boolean; covered: boolean }>({ key: '', rect: null, half: 'a', sheet: false, covered: false })
  const [vw, setVw] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }))
  const card = useRef<HTMLDivElement>(null)
  // What changes the place of the ring: the step, and what it names.
  const stepKey = step ? JSON.stringify({ ...step, seconds: undefined, left: undefined, choices: undefined }) : ''
  const size = useCardSize(card, step ? `${stepKey}:${seen.half}:${seen.covered}` : '')

  // A phone shows the tab that holds a new step, once. The player may go elsewhere afterwards.
  const stepId = step?.id ?? null
  useEffect(() => {
    if (step && apiRef.current.phone) apiRef.current.show(tabOf(step))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepId])

  useLayoutEffect(() => {
    if (!step) return
    let raf = 0
    let scrolledFor = ''
    const measure = () => {
      const t = targetOf(step)
      let rect: Rect | null = null
      if (t.el) {
        // The page comes to each half of a step once, wherever its part of the screen is: a row of
        // the board below the fold, a card under the board, a choice far down a list. After that
        // the player scrolls as they like.
        if (scrolledFor !== t.half) { scrolledFor = t.half; bringIntoView(t.el) }
        // The row of prompts is as wide as its window: the ring goes around the prompts that are in it.
        rect = t.el.classList.contains('pcards') ? shownChildrenRect(t.el) : shownRect(t.el)
      }
      const sheet = !!t.el?.closest('.scrim')
      // A window that the step is not about (a question, a letter, a card opened to read) comes
      // first: the tutorial steps aside until it is closed.
      const covered = !sheet && !!document.querySelector('.scrim')
      setAt((p) => {
        const same = p.key === stepKey && p.half === t.half && p.sheet === sheet && p.covered === covered && (p.rect === rect || (!!p.rect && !!rect
          && Math.abs(p.rect.x - rect.x) < 0.5 && Math.abs(p.rect.y - rect.y) < 0.5 && Math.abs(p.rect.w - rect.w) < 0.5 && Math.abs(p.rect.h - rect.h) < 0.5))
        return same ? p : { key: stepKey, rect, half: t.half, sheet, covered }
      })
      setVw((p) => (p.w === window.innerWidth && p.h === window.innerHeight ? p : { w: window.innerWidth, h: window.innerHeight }))
      raf = requestAnimationFrame(measure)
    }
    raf = requestAnimationFrame(measure)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepKey])

  if (!step || !plan) return null

  const labelOf = (id: string | null) => content.workers.find((w) => w.id === id)?.label ?? ''
  const agent = inline(labelOf(plan.agent))
  const person = inline(labelOf(plan.person))
  const at = seen.key === stepKey ? seen : { rect: null, half: 'a' as Half, sheet: false, covered: false }
  const { rect, half } = at
  let title = '', text = '', more: string | null = null
  let primary: { label: string; press: () => void } | null = null
  switch (step.id) {
    case 'action': title = F.action.title; text = F.action.text(content.actions.find((a) => a.id === step.action)?.title ?? ''); break
    case 'wait': title = F.wait.title; text = F.wait.text(step.seconds); break
    case 'card': title = F.card.title; text = F.card.text; primary = { label: F.card.ok, press: () => setTold((t) => ({ ...t, read: true })) }; break
    case 'place': title = half === 'a' ? F.pick.title(labelOf(step.worker)) : F.cell.title; text = half === 'a' ? F.pick.text(labelOf(step.worker)) : F.cell.text(agent); break
    case 'model': title = F.model.title; text = half === 'a' ? F.model.open(agent) : F.model.choose(step.choices); break
    case 'runsOn': title = F.runsOn.title; text = half === 'a' ? F.runsOn.open : F.runsOn.choose(step.choices); break
    case 'prompt':
      title = F.prompt.title; text = half === 'a' ? F.prompt.open : F.prompt.choose(step.choices)
      primary = { label: F.prompt.keep, press: () => setTold((t) => ({ ...t, promptKept: true })) }
      break
    case 'source': title = F.source.title; text = half === 'a' ? F.source.from(agent, content.sources.find((s) => s.id === step.first)?.label ?? null) : F.source.to(agent); break
    case 'person': title = F.person.title(person); text = half === 'a' ? F.person.pick(labelOf(step.worker)) : F.person.cell(agent); break
    case 'handoff': title = F.handoff.title; text = half === 'a' ? F.handoff.from(agent) : F.handoff.to(agent, person); break
    case 'result': title = F.result.title; text = half === 'a' ? F.result.from(plan.person ? person : agent) : F.result.to(content.result.label); break
    case 'validate': title = F.validate.title; text = F.validate.text(content.rules.freeValidations > 0); break
    case 'validating': title = F.validating.title; text = F.validating.text; break
    case 'done': title = F.done.title; text = F.done.text(step.free, step.left); more = F.done.more; primary = { label: F.done.ok, press: () => { finish(); apiRef.current.show('map') } }; break
  }

  // The card stands beside the ring and never over it while there is room (components/guideCard.ts).
  const { n, of } = firstStepNumber(plan, step.id)
  const { left, top, width } = placeCard(rect, vw, size, 'corner')

  if (at.covered) return null
  return (
    <div className="fb">
      {rect && <div className={`fb-ring${at.sheet ? ' in-sheet' : ''}`} style={{ left: rect.x - GUIDE_PAD, top: rect.y - GUIDE_PAD, width: rect.w + 2 * GUIDE_PAD, height: rect.h + 2 * GUIDE_PAD }} />}
      <div ref={card} className="fb-card guide-card" role="status" aria-live="polite" data-first-build={step.id} data-half={half} style={{ left, top, width }}>
        <div className="tour-top">
          <span className="tour-label">{F.label}</span>
          <span className="tour-n">{F.stepOf(n, of)}</span>
        </div>
        <h3>{title}</h3>
        <p>{text}</p>
        {more && <p className="fb-more">{more}</p>}
        <div className="tour-btns">
          {primary && <button type="button" className="btn small go" onClick={primary.press}>{primary.label}</button>}
          {step.id !== 'done' && <button type="button" className="btn small text tour-end" onClick={finish}>{F.skip}</button>}
        </div>
      </div>
    </div>
  )
}
