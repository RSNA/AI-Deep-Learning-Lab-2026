// The strings of a pack that must not leave the server, and the moment from which they may
// (engineering spec, sections 9.2 and 12.3). The leak scan uses this list.
import type { Pack } from './loader.ts'

export type Moment = 'never' | 'planning.reveal' | 'development.reveal' | 'maintaining.reveal'
export type ProtectedString = { text: string; from: Moment; where: string }

/** Strings shorter than this are not scanned (ids, single words and numbers repeat by chance). */
export const LEAK_MIN_CHARS = 12

export function protectedStrings(pack: Pack): ProtectedString[] {
  const out: ProtectedString[] = []
  const add = (x: unknown, from: Moment, where: string) => {
    if (typeof x === 'string') { if (x.length >= LEAK_MIN_CHARS) out.push({ text: x, from, where }) }
    else if (Array.isArray(x)) x.forEach((v, i) => add(v, from, `${where}[${i}]`))
    else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) add(v, from, `${where}.${k}`)
  }

  for (const [k, s] of Object.entries(pack.game.sources)) add(s.gist, 'never', `game.sources.${k}.gist`)
  pack.characters.forEach((c) => {
    // The name, the role, the look and the lines a person says when clicked are public.
    const open = ['id', 'system', 'public', 'extra', 'click_lines', 'look']
    for (const [k, v] of Object.entries(c)) if (!open.includes(k)) add(v, 'never', `characters.${c.id}.${k}`)
  })
  // Slide notes are for the host console only.
  pack.deck?.sections.forEach((sec) => sec.slides.forEach((sl) => add(sl.notes, 'never', `deck.${sl.id}.notes`)))
  pack.palette?.components.forEach((c) => add(c.key, 'never', `palette.${c.id}.key`))
  pack.monitors?.monitors.forEach((m) => add(m.key, 'never', `monitors.${m.id}.key`))

  for (const id of pack.systemIds) {
    const sp = pack.systems[id]!
    for (const [k, v] of Object.entries(sp.system.key)) if (k !== 'flagship_problem') add(v, 'never', `${id}.system.key.${k}`)
    sp.problems?.forEach((p) => {
      for (const [k, v] of Object.entries(p.key)) {
        const revealed = k === 'rationale' || k === 'burden' || k === 'class' || k === 'tier' || k === 'flagship'
        add(v, revealed ? 'planning.reveal' : 'never', `${p.id}.key.${k}`)
      }
    })
    sp.insights?.forEach((x) => add(x.key, 'never', `${x.id}.key`))
    if (sp.build) {
      const b = sp.build
      b.rules?.forEach((r) => add(r.key, 'never', `${r.id}.key`))
      b.cases.forEach((c) => {
        add(c.key, 'never', `${c.id}.key`)
        c.extra_cost?.forEach((e, i) => add(e.note, 'never', `${c.id}.extra_cost[${i}].note`))
      })
      b.offers?.forEach((o) => add(o.key, 'never', `${o.id}.key`))
      const { reference, ...other } = b.key
      add(reference.rationale, 'development.reveal', `${id}.build.key.reference.rationale`)
      add(reference.public_summary, 'development.reveal', `${id}.build.key.reference.public_summary`)
      add(other, 'never', `${id}.build.key`)
    }
    if (sp.maintain) {
      sp.maintain.actions.forEach((a) => add(a.key, 'maintaining.reveal', `${a.id}.key`))
      sp.maintain.events.forEach((e) => {
        add(e.key, 'maintaining.reveal', `${e.id}.key`)
        e.options.forEach((o) => add(o.key, 'maintaining.reveal', `${e.id}.${o.id}.key`))
      })
    }
  }
  // A key may repeat public text, for example the label of a baseline row it refers to. Text that
  // the pack also publishes is not protected.
  const published = new Set<string>()
  const pub = (x: unknown, inside: boolean) => {
    if (typeof x === 'string') { if (inside) published.add(x) }
    else if (Array.isArray(x)) x.forEach((v) => pub(v, inside))
    else if (x && typeof x === 'object') {
      for (const [k, v] of Object.entries(x)) if (k !== 'key') pub(v, inside || k === 'public' || k === 'tile')
    }
  }
  pub(pack.characters, false)
  pub(pack.game.ladder, true)
  // The classes of Phase 1 go out with its content: ids, labels and what each fits.
  pub(pack.game.phases.planning.classes, true)
  for (const id of pack.systemIds) {
    const sp = pack.systems[id]!
    pub([sp.system, sp.problems, sp.insights, sp.build, sp.maintain], false)
    // Banter is public, but it is not allowed to repeat a protected string: it stays out of the
    // published set, so the scan flags a line that does.
    if (sp.story) pub({ ...sp.story, banter: undefined }, true)
  }
  pub([pack.palette, pack.monitors], false)
  for (let i = out.length - 1; i >= 0; i--) if (published.has(out[i]!.text)) out.splice(i, 1)

  // The same text may be listed twice with different moments. Keep the strictest.
  const rank: Record<Moment, number> = { 'never': 3, 'maintaining.reveal': 2, 'development.reveal': 1, 'planning.reveal': 0 }
  const best = new Map<string, ProtectedString>()
  for (const p of out) {
    const prev = best.get(p.text)
    if (!prev || rank[p.from] > rank[prev.from]) best.set(p.text, p)
  }
  return [...best.values()]
}
