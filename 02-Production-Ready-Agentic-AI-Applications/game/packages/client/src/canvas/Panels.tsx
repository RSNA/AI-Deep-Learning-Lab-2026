// The parts around the canvas (engineering spec, section 10.5): the shelves of models and places
// to run, the toolbox of workers, the list of actions, and the choosers of a tile's parts. Each
// takes its content and its state as inputs and does not know which phase shows it.
import type { ReactNode } from 'react'
import { Sheet } from '../components/ui.tsx'
import { Icon } from './icons.tsx'

export type Item = { id: string; label: string; short?: string; description: string; costLine?: string | null; icon?: string; kind?: string }

const lockText = (lockedBy: Record<string, string> | undefined, id: string, w: { locked: (a: string) => string; lockedNoAction: string }) => {
  const by = lockedBy?.[id]
  return by ? w.locked(by) : w.lockedNoAction
}

// ------------------------------------------------------------------------------------------
// Shelves: they only inform. Choosing happens on a tile.
// ------------------------------------------------------------------------------------------
export function Shelves({ rows, unlocked, lockedBy, onInfo, words }: {
  rows: { title: string; icon: string; items: Item[] }[]
  unlocked: ReadonlySet<string>
  lockedBy?: Record<string, string>
  onInfo: (item: Item) => void
  words: { locked: (a: string) => string; lockedNoAction: string; info: (label: string) => string }
}) {
  return (
    <div className="shelves">
      {rows.map((r) => (
        <div key={r.title} className="shelf">
          <span className="shelf-t">{r.title}</span>
          <div className="shelf-items">
            {r.items.map((it) => {
              const lock = !unlocked.has(it.id)
              return (
                <button key={it.id} type="button" className={`schip${lock ? ' is-locked' : ''}`} onClick={() => onInfo(it)}
                  title={lock ? lockText(lockedBy, it.id, words) : it.label} aria-label={`${words.info(it.label)}${lock ? `. ${lockText(lockedBy, it.id, words)}` : ''}`}>
                  <Icon name={r.icon} size={12} />
                  <span>{it.short ?? it.label}</span>
                  {lock && <Icon name="lock" size={11} />}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

/** The card of one shelf item: its description, what it costs to run, and what opens it. */
export function ItemSheet({ item, locked, lockedBy, onClose, words }: {
  item: Item; locked: boolean; lockedBy?: Record<string, string>; onClose: () => void
  words: { locked: (a: string) => string; lockedNoAction: string; close: string; open: string }
}) {
  return (
    <Sheet title={item.label} head="sky" onClose={onClose}>
      <p style={{ fontSize: 16, lineHeight: 1.45 }}>{item.description}</p>
      {item.costLine && <p className="muted" style={{ fontSize: 15 }}>{item.costLine}</p>}
      <div className={`chip ${locked ? 'sun' : 'go'}`} style={{ alignSelf: 'flex-start' }}>{locked ? lockText(lockedBy, item.id, words) : words.open}</div>
      <div className="sheet-actions"><button type="button" className="btn" onClick={onClose}>{words.close}</button></div>
    </Sheet>
  )
}

// ------------------------------------------------------------------------------------------
// The toolbox: the kinds of worker. Click one, then an empty cell. A drag does the same.
// ------------------------------------------------------------------------------------------
export function Toolbox({ workers, unlocked, lockedBy, picked, onPick, words, phone = false }: {
  workers: Item[]; unlocked: ReadonlySet<string>; lockedBy?: Record<string, string>
  picked: string | null; onPick: (id: string | null) => void; phone?: boolean
  words: { locked: (a: string) => string; lockedNoAction: string; pickHint: string; picked: string; kinds: Record<string, string> }
}) {
  return (
    <div className={`toolbox${phone ? ' phone' : ''}`}>
      <div className="tb-hint">{words.pickHint}</div>
      {workers.map((w) => {
        const lock = !unlocked.has(w.id)
        const on = picked === w.id
        return (
          <button key={w.id} type="button" className={`tbrow k-${w.kind}${on ? ' on' : ''}${lock ? ' is-locked' : ''}`} disabled={lock} aria-pressed={on}
            draggable={!lock && !phone}
            onDragStart={(e) => { e.dataTransfer.setData('text/x-lab02-kind', w.id); e.dataTransfer.effectAllowed = 'copy' }}
            onClick={() => onPick(on ? null : w.id)}>
            <span className="tb-ic"><Icon name={w.icon ?? ''} kind={w.kind} size={18} /></span>
            <span className="tb-tx">
              <span className="tb-l">{w.label}<span className="tb-k">{words.kinds[w.kind ?? ''] ?? ''}</span></span>
              <span className="tb-d">{w.description}</span>
              {w.costLine && <span className="tb-c">{w.costLine}</span>}
              {lock && <span className="tb-lock"><Icon name="lock" size={11} /> {lockText(lockedBy, w.id, words)}</span>}
              {on && <span className="tb-on">{words.picked}</span>}
            </span>
          </button>
        )
      })}
    </div>
  )
}

// ------------------------------------------------------------------------------------------
// Actions, under their group headings.
// ------------------------------------------------------------------------------------------
export type ActionRow = {
  id: string; group: string; title: string; teaser: string
  money: number; developers: number; seconds: number; storyTime: string | null
  opens: string[]                       // labels of what it unlocks
  state: 'ready' | 'running' | 'done' | 'blocked'
  blocked?: string                      // why it cannot start
  left?: number; share?: number         // seconds left and the share done, while it runs
}

export function ActionList({ groups, rows, onStart, refused, words }: {
  groups: { id: string; label: string }[]; rows: ActionRow[]
  onStart: (id: string) => void; refused: { id: string; text: string } | null
  words: { start: string; done: string; cost: (money: number, devs: number, secs: number, story: string | null) => string; opens: (list: string) => string; left: (s: number) => string; holds: (n: number) => string; noCancel: string }
}) {
  const anyStarted = rows.some((r) => r.state === 'running' || r.state === 'done')
  return (
    <div className="alist">
      {!anyStarted && <div className="inv-note">{words.noCancel}</div>}
      {groups.map((g) => {
        const mine = rows.filter((r) => r.group === g.id)
        if (!mine.length) return null
        return (
          <div key={g.id} className="agroup">
            <div className="agroup-t">{g.label}</div>
            {mine.map((a) => (
              <div key={a.id} className={`arow ${a.state}`} data-action={a.id}>
                <div className="ttl">
                  <div className="t">{a.title}</div>
                  <div className="tz">{a.teaser}</div>
                  <div className="meta">{words.cost(a.money, a.developers, a.seconds, a.storyTime)}</div>
                  {a.opens.length > 0 && <div className="meta opens">{words.opens(a.opens.join(', '))}</div>}
                </div>
                <div className="iact">
                  {a.state === 'ready' && <button type="button" className="ibtn start" onClick={() => onStart(a.id)}>{words.start}</button>}
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
                {a.state === 'blocked' && a.blocked && <div className="ablock">{a.blocked}</div>}
                {refused?.id === a.id && <div className="err irefused" role="alert">{refused.text}</div>}
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}

// ------------------------------------------------------------------------------------------
// The choosers of a tile's parts.
// ------------------------------------------------------------------------------------------
export type Choice = { id: string; label: string; detail?: string; disabled?: string | null; current?: boolean }

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
            <span className="pr-l">{c.label}{c.current && <span className="pr-cur">{words.current}</span>}</span>
            {c.detail && <span className="pr-d">{c.detail}</span>}
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
 * each with its label, its description and the opening of such a prompt in a typewriter face.
 * Nothing on a card says which one is better.
 */
export function PromptSheet({ title, prompts, current, unlocked, lockedBy, onPick, onClose, words }: {
  title: string; prompts: { id: string; label: string; description: string; sample: string }[]
  current: string | null; unlocked: ReadonlySet<string>; lockedBy?: Record<string, string>
  onPick: (id: string) => void; onClose: () => void
  words: { intro: string; use: string; inUse: string; isDefault: string; close: string; locked: (a: string) => string; lockedNoAction: string }
}) {
  const shown = current ?? prompts[0]?.id ?? null
  return (
    <Sheet title={title} head="lav" onClose={onClose} className="promptsheet">
      <p className="muted" style={{ fontSize: 15 }}>{words.intro}</p>
      <div className="pcards">
        {prompts.map((p, i) => {
          const lock = !unlocked.has(p.id)
          const on = shown === p.id
          return (
            <article key={p.id} className={`pcard${on ? ' on' : ''}${lock ? ' is-locked' : ''}`}>
              <div className="pc-head"><span>{p.label}</span>{i === 0 && <span className="pc-def">{words.isDefault}</span>}</div>
              <p className="pc-desc">{p.description}</p>
              <pre className="pc-sample">{p.sample}</pre>
              <div className="pc-foot">
                {lock
                  ? <span className="pc-lock"><Icon name="lock" size={11} /> {lockText(lockedBy, p.id, words)}</span>
                  : on ? <span className="pc-in">✓ {words.inUse}</span>
                    : <button type="button" className="btn small go" onClick={() => onPick(p.id)}>{words.use}</button>}
              </div>
            </article>
          )
        })}
      </div>
      <div className="sheet-actions"><button type="button" className="btn" onClick={onClose}>{words.close}</button></div>
    </Sheet>
  )
}
