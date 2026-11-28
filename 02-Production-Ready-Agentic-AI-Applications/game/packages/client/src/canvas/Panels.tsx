// The parts around the canvas (engineering spec, section 10.5): the shelves of models and places
// to run, the toolbox of workers, the list of actions, and the choosers of a tile's parts. Each
// takes its content and its state as inputs and does not know which phase shows it.
import { useState, type ReactNode } from 'react'
import { ClampCard } from '../components/Clamp.tsx'
import { Sheet } from '../components/ui.tsx'
import { Icon } from './icons.tsx'
import type { MarkTag } from './model.ts'
import { popHandlers, usePop, type PopInfo } from './Pop.tsx'

/** `marks`: what an action that is done changed about it, as tags. */
export type Item = { id: string; label: string; short?: string; description: string; costLine?: string | null; icon?: string; kind?: string; marks?: MarkTag[] }

/** The tags of an item, each with what it means behind it. */
export function MarkTags({ marks, short = false }: { marks: MarkTag[] | undefined; short?: boolean }) {
  if (!marks?.length) return null
  return <>{marks.map((m) => <span key={m.tag} className="marktag" title={m.tip}>{short ? m.short : m.tag}</span>)}</>
}

const lockText = (lockedBy: Record<string, string> | undefined, id: string, w: { locked: (a: string) => string; lockedNoAction: string }) => {
  const by = lockedBy?.[id]
  return by ? w.locked(by) : w.lockedNoAction
}

// ------------------------------------------------------------------------------------------
// Shelves: they only inform. Choosing happens on a tile.
// ------------------------------------------------------------------------------------------
export function Shelves({ rows, unlocked, lockedBy, onInfo, popOf, words, fresh, onSeen }: {
  /** `more`: the shelf will hold more than it shows, and says so in a few quiet words. */
  rows: { title: string; icon: string; items: Item[]; more?: boolean }[]
  unlocked: ReadonlySet<string>
  lockedBy?: Record<string, string>
  onInfo: (item: Item) => void
  /** What the card beside a chip says while it is pointed at. */
  popOf?: (id: string) => PopInfo | null
  words: { locked: (a: string) => string; lockedNoAction: string; info: (label: string) => string; more?: string; moreLong?: string; newTag?: string }
  /** Items that have just come onto the board, marked until the player has looked at them. */
  fresh?: ReadonlySet<string>
  onSeen?: (id: string) => void
}) {
  const pop = usePop()
  return (
    <div className="shelves">
      {rows.map((r) => (
        <div key={r.title} className="shelf">
          <span className="shelf-t">{r.title}</span>
          <div className="shelf-items">
            {r.items.map((it) => {
              const lock = !unlocked.has(it.id)
              const isNew = !!fresh?.has(it.id)
              return (
                <button key={it.id} type="button" className={`schip${lock ? ' is-locked' : ''}${isNew ? ' is-new' : ''}`} onClick={() => { onSeen?.(it.id); onInfo(it) }}
                  onPointerEnter={isNew ? () => onSeen?.(it.id) : undefined}
                  aria-label={`${words.info(it.label)}${lock ? `. ${lockText(lockedBy, it.id, words)}` : ''}`}
                  {...(popOf ? popHandlers(pop, `shelf:${it.id}`, 'below', () => popOf(it.id)) : { title: lock ? lockText(lockedBy, it.id, words) : it.label })}>
                  <Icon name={r.icon} size={12} />
                  <span>{it.short ?? it.label}</span>
                  {lock && <Icon name="lock" size={11} />}
                  <MarkTags marks={it.marks} />
                  {isNew && words.newTag && <span className="newtag">{words.newTag}</span>}
                </button>
              )
            })}
            {r.more && words.more && <span className="shelf-more" title={words.moreLong}>{words.more}</span>}
          </div>
        </div>
      ))}
    </div>
  )
}

/** The card of one shelf item: its description, what it costs to run, and what opens it. */
export function ItemSheet({ item, locked, lockedBy, onClose, words, more = [], state = true, extra }: {
  item: Item; locked: boolean; lockedBy?: Record<string, string>; onClose: () => void
  words: { locked: (a: string) => string; lockedNoAction: string; close: string; open: string }
  /** Further quiet lines: where a model runs, what a source holds. */
  more?: (string | null | undefined)[]
  /** Whether the card says that the item is open or what opens it. The result has no such state. */
  state?: boolean
  /** What the board adds to the card of this item, above Close: the buttons that move a source in its column. */
  extra?: ReactNode
}) {
  return (
    <Sheet title={item.label} head="sky" onClose={onClose}>
      <p style={{ fontSize: 16, lineHeight: 1.45 }}>{item.description}</p>
      {[item.costLine, ...more].filter(Boolean).map((x, i) => <p key={i} className="muted" style={{ fontSize: 15 }}>{x}</p>)}
      {state && <div className={`chip ${locked ? 'sun' : 'go'}`} style={{ alignSelf: 'flex-start' }}>{locked ? lockText(lockedBy, item.id, words) : words.open}</div>}
      {extra}
      <div className="sheet-actions"><button type="button" className="btn" onClick={onClose}>{words.close}</button></div>
    </Sheet>
  )
}

// ------------------------------------------------------------------------------------------
// The toolbox: the kinds of tile, under the headings of their groups. Click one, then an empty
// cell. A drag does the same. On a laptop a row is short (icon, name, kind, its job, and what
// opens it while it is locked), and a card beside it says the rest while it is pointed at. A phone has the
// width for the full rows and no pointer to rest.
// ------------------------------------------------------------------------------------------
export type ToolboxItem = Item & { task?: string | null; group?: string | null; extra?: string | null }

export function Toolbox({ workers, groups = [], unlocked, lockedBy, picked, onPick, popOf, words, phone = false, more = [], fresh, onSeen }: {
  workers: ToolboxItem[]; groups?: { id: string; label: string }[]; unlocked: ReadonlySet<string>; lockedBy?: Record<string, string>
  picked: string | null; onPick: (id: string | null) => void; phone?: boolean
  popOf?: (id: string) => PopInfo | null
  words: { locked: (a: string) => string; lockedNoAction: string; pickHint: string; picked: string; kinds: Record<string, string>; lockedTold?: (action: string | null) => string; more?: string; newTag?: string }
  /** The groups that will hold more than they show: each says so in one quiet line. */
  more?: string[]
  /** Kinds that have just come onto the board, marked until the player has looked at them. */
  fresh?: ReadonlySet<string>
  onSeen?: (id: string) => void
}) {
  const pop = usePop()
  // A press on a locked kind says, in its row, what opens it.
  const [told, setTold] = useState<string | null>(null)
  const known = new Set(groups.map((g) => g.id))
  // A group that shows nothing yet still stands with its heading when more will come into it.
  const sections: { id: string; label: string | null; list: ToolboxItem[] }[] = groups.length
    ? [...groups.map((g) => ({ id: g.id, label: g.label, list: workers.filter((w) => w.group === g.id) })),
       { id: '_', label: null, list: workers.filter((w) => !w.group || !known.has(w.group)) }].filter((x) => x.list.length || more.includes(x.id))
    : [{ id: '_', label: null, list: workers }]
  const details = (w: ToolboxItem) => (
    <>
      <span className="tb-d">{w.description}</span>
      {w.costLine && <span className="tb-c">{w.costLine}</span>}
      {w.extra && <span className="tb-c">{w.extra}</span>}
    </>
  )
  // A locked row is not a disabled button, so that pointing at it still shows its card.
  const lockLine = (w: ToolboxItem) => <span className="tb-lock"><Icon name="lock" size={11} /> <span>{lockText(lockedBy, w.id, words)}</span></span>
  const row = (w: ToolboxItem) => {
    const lock = !unlocked.has(w.id)
    const on = picked === w.id
    const isNew = !!fresh?.has(w.id)
    return (
      <button key={w.id} type="button" className={`tbrow k-${w.kind}${on ? ' on' : ''}${lock ? ' is-locked' : ''}${isNew ? ' is-new' : ''}`} aria-disabled={lock || undefined} aria-pressed={on}
        onPointerEnter={isNew ? () => onSeen?.(w.id) : undefined}
        data-worker={w.id} draggable={!lock && !phone}
        aria-label={[w.label, words.kinds[w.kind ?? ''], w.task, w.description, w.costLine, w.extra, lock ? lockText(lockedBy, w.id, words) : null].filter(Boolean).join('. ')}
        onDragStart={(e) => { pop.hide(); e.dataTransfer.setData('text/x-lab02-kind', w.id); e.dataTransfer.effectAllowed = 'copy' }}
        {...(popOf && !phone ? popHandlers(pop, `tool:${w.id}`, 'left', () => popOf(w.id)) : {})}
        onClick={() => { onSeen?.(w.id); if (lock) { setTold(w.id); return } setTold(null); pop.hide(); onPick(on ? null : w.id) }}>
        <span className="tb-ic"><Icon name={w.icon ?? ''} kind={w.kind} size={phone ? 18 : 15} /></span>
        <span className="tb-tx">
          <span className="tb-l"><span className="tb-ln">{w.label}</span>{lock && !phone && <span className="tb-lk"><Icon name="lock" size={11} /></span>}<MarkTags marks={w.marks} short />{isNew && words.newTag && <span className="newtag">{words.newTag}</span>}<span className="tb-k">{words.kinds[w.kind ?? ''] ?? ''}</span></span>
          {w.task && <span className="tb-task">{w.task}</span>}
          {phone && details(w)}
          {lock && phone && lockLine(w)}
          {on && <span className="tb-on">{words.picked}</span>}
          {lock && told === w.id && words.lockedTold && <span className="tb-told" role="status">{words.lockedTold(lockedBy?.[w.id] ?? null)}</span>}
        </span>
      </button>
    )
  }
  return (
    <div className={`toolbox${phone ? ' phone' : ''}`}>
      {phone && <div className="tb-hint">{words.pickHint}</div>}
      {sections.map((sec) => (
        <div key={sec.id} className="tbgroup">
          {sec.label && <div className="tbgroup-t">{sec.label}</div>}
          {sec.list.map(row)}
          {words.more && (more.includes(sec.id) || (sec.id === '_' && more.includes(''))) && <div className="more-line">{words.more}</div>}
        </div>
      ))}
    </div>
  )
}

// ------------------------------------------------------------------------------------------
// Actions, under their group headings. A row is compact: the title, one line with money,
// developers and wait, and the Start button. A click on the title opens the teaser, the story
// time and what it opens.
// ------------------------------------------------------------------------------------------
export type ActionRow = {
  id: string; group: string; title: string; teaser: string
  money: number; developers: number; seconds: number; storyTime: string | null
  opens: string[]                       // labels of what it unlocks
  state: 'ready' | 'running' | 'done' | 'blocked'
  blocked?: string                      // why it cannot start
  left?: number; share?: number         // seconds left and the share done, while it runs
  again?: string                        // the label of Start, for an action that was done and may be done again
  tag?: string                          // a quiet word under the title: how often it was done
  upkeep?: string | null                // what it costs a month once it is done
  inPlace?: boolean                     // it changes what is already on the board
}

export function ActionList({ groups, rows, onStart, refused, popOf, notice, words, more = [], fresh, onSeen }: {
  groups: { id: string; label: string }[]; rows: ActionRow[]
  onStart: (id: string) => void; refused: { id: string; text: string } | null
  popOf?: (id: string) => PopInfo | null
  /** Something the player should read before the next action, above the list. */
  notice?: ReactNode
  words: {
    start: string; done: string; cost: (money: number, devs: number, secs: number) => string; story: (s: string) => string
    opens: (list: string, toUse: boolean) => string; inPlace?: string; left: (s: number) => string; holds: (n: number) => string; noCancel: string; noCancelLong: string; more: string
    moreHere?: string; newTag?: string
  }
  /** The groups that will hold more actions than they show: each says so in one quiet line. */
  more?: string[]
  /** Actions that have just come onto the list, marked until the player has looked at them. */
  fresh?: ReadonlySet<string>
  onSeen?: (id: string) => void
}) {
  const pop = usePop()
  const [open, setOpen] = useState<Set<string>>(new Set())
  const toggle = (id: string) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n })
  return (
    <div className="alist">
      {notice}
      <div className="inv-note one" title={words.noCancelLong}>{words.noCancel}</div>
      {groups.map((g) => {
        const mine = rows.filter((r) => r.group === g.id)
        const hasMore = more.includes(g.id)
        if (!mine.length && !hasMore) return null
        return (
          <div key={g.id} className="agroup">
            <div className="agroup-t">{g.label}</div>
            {mine.map((a) => {
              const isOpen = open.has(a.id)
              const isNew = !!fresh?.has(a.id)
              return (
                <div key={a.id} className={`arow ${a.state}${isOpen ? ' open' : ''}${isNew ? ' is-new' : ''}`} data-action={a.id}
                  onPointerEnter={isNew ? () => onSeen?.(a.id) : undefined}
                  {...(popOf ? popHandlers(pop, `act:${a.id}`, 'right', () => (open.has(a.id) ? null : popOf(a.id))) : {})}>
                  <button type="button" className="ttl" aria-expanded={isOpen} onClick={() => { onSeen?.(a.id); pop.hide(); toggle(a.id) }}>
                    <span className="t">{a.title}{isNew && words.newTag && <span className="newtag">{words.newTag}</span>}</span>
                    <span className="meta">{words.cost(a.money, a.developers, a.seconds)}<span className="amark" aria-hidden="true">{isOpen ? '▾' : '▸'}</span></span>
                  </button>
                  <div className="iact">
                    {a.state === 'ready' && <button type="button" className={`ibtn start${a.again ? ' again' : ''}`} onClick={() => onStart(a.id)}>{a.again ?? words.start}</button>}
                    {a.state === 'done' && <div className="ibtn done">✓ {words.done}</div>}
                    {a.state === 'running' && (
                      <div className="ibtn run" role="status">
                        <span className="runtxt">{words.left(a.left ?? 0)}</span>
                        <span className="runbar"><i style={{ width: `${100 * (a.share ?? 0)}%` }} /></span>
                        {a.developers > 0 && <small>{words.holds(a.developers)}</small>}
                      </div>
                    )}
                    {a.state === 'blocked' && <div className="ibtn wait">–</div>}
                  </div>
                  {isOpen && (
                    <div className="amore">
                      <span className="tz">{a.teaser}</span>
                      {a.upkeep && <span className="meta">{a.upkeep}</span>}
                      {a.storyTime && <span className="meta">{words.story(a.storyTime)}</span>}
                      {a.opens.length > 0 && <span className="meta opens">{words.opens(a.opens.join(', '), !a.inPlace)}</span>}
                      {a.inPlace && words.inPlace && <span className="meta opens">{words.inPlace}</span>}
                    </div>
                  )}
                  {a.tag && <div className="atag">{a.tag}</div>}
                  {a.state === 'blocked' && a.blocked && <div className="ablock">{a.blocked}</div>}
                  {refused?.id === a.id && <div className="err irefused" role="alert">{refused.text}</div>}
                </div>
              )
            })}
            {hasMore && words.moreHere && <div className="more-line">{words.moreHere}</div>}
          </div>
        )
      })}
    </div>
  )
}

// ------------------------------------------------------------------------------------------
// The choosers of a tile's parts.
// ------------------------------------------------------------------------------------------
export type Choice = { id: string; label: string; detail?: string; disabled?: string | null; current?: boolean; marks?: MarkTag[] }

/** A list of choices for a model or a place to run. Only what is open can be chosen. */
export function PartSheet({ title, intro, choices, onPick, onClose, words, extra }: {
  title: string; intro?: string; choices: Choice[]; onPick: (id: string | null) => void; onClose: () => void
  words: { close: string; current: string; clear: string }; extra?: ReactNode
}) {
  return (
    <Sheet title={title} head="sky" onClose={onClose}>
      {intro && <p className="muted" style={{ fontSize: 15 }}>{intro}</p>}
      <div className="partlist">
        {choices.map((c) => (
          <button key={c.id} type="button" className={`partrow${c.current ? ' on' : ''}`} disabled={!!c.disabled} aria-pressed={!!c.current}
            onClick={() => onPick(c.id)}>
            <span className="pr-l">{c.label}<MarkTags marks={c.marks} />{c.current && <span className="pr-cur">{words.current}</span>}</span>
            {c.detail && <span className="pr-d">{c.detail}</span>}
            {c.marks?.map((m) => <span key={m.tag} className="pr-d pr-mark">{m.tip}</span>)}
            {c.disabled && <span className="pr-x">{c.disabled}</span>}
          </button>
        ))}
      </div>
      {extra}
      <div className="sheet-actions">
        <button type="button" className="btn" onClick={() => onPick(null)}>{words.clear}</button>
        <button type="button" className="btn" onClick={onClose}>{words.close}</button>
      </div>
    </Sheet>
  )
}

/**
 * The prompt of an AI tile: one card per format, side by side on a laptop and stacked on a phone,
 * each with its label, its description and the opening of such a prompt in a typewriter face, or
 * several such openings, each under its own label. Above them, what this tile reads and from
 * which tiles it receives work, so that two agents with two jobs can be told apart.
 * Nothing on a card says which one is better.
 */
export function PromptSheet({ title, about, prompts, current, unlocked, lockedBy, onPick, onClose, words }: {
  title: string; about?: string
  prompts: { id: string; label: string; description: string; sample: string | null; samples: { label: string; text: string }[]; marks?: MarkTag[] }[]
  current: string | null; unlocked: ReadonlySet<string>; lockedBy?: Record<string, string>
  onPick: (id: string) => void; onClose: () => void
  words: { intro: string; use: string; inUse: string; isDefault: string; close: string; locked: (a: string) => string; lockedNoAction: string; more: string; less: string }
}) {
  const shown = current ?? prompts[0]?.id ?? null
  return (
    <Sheet title={title} head="lav" onClose={onClose} className="promptsheet">
      {about && <p className="pc-about">{about}</p>}
      <p className="muted pc-intro">{words.intro}</p>
      <div className="pcards">
        {prompts.map((p, i) => {
          const lock = !unlocked.has(p.id)
          const on = shown === p.id
          return (
            <ClampCard key={p.id} className={`pcard${on ? ' on' : ''}${lock ? ' is-locked' : ''}`} words={{ more: words.more, less: words.less }}
              head={<div className="pc-head"><span>{p.label}</span>{!lock && <MarkTags marks={p.marks} />}{i === 0 && <span className="pc-def">{words.isDefault}</span>}</div>}
              foot={(
                <div className="pc-foot">
                  {lock
                    ? <span className="pc-lock"><Icon name="lock" size={11} /> {lockText(lockedBy, p.id, words)}</span>
                    : on ? <span className="pc-in">✓ {words.inUse}</span>
                      : <button type="button" className="btn small go" onClick={() => onPick(p.id)}>{words.use}</button>}
                </div>
              )}>
              <p className="pc-desc">{p.description}</p>
              {p.samples.length
                ? p.samples.map((x, j) => <div key={j} className="pc-s"><div className="pc-sl">{x.label}</div><pre className="pc-sample">{x.text}</pre></div>)
                : p.sample && <pre className="pc-sample">{p.sample}</pre>}
            </ClampCard>
          )
        })}
      </div>
      <div className="sheet-actions"><button type="button" className="btn" onClick={onClose}>{words.close}</button></div>
    </Sheet>
  )
}
