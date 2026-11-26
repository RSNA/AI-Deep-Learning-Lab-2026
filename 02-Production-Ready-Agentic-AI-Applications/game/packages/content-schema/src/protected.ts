// The strings of a pack that must not leave the server, and the moment from which they may
// (engineering spec, sections 9.2 and 12.3). The leak scan uses this list.
import type { Pack } from './loader.ts'
import { phase3Build } from './maintain.ts'

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
      // Every `key` of the canvas stays on the server. The reference map's summary comes out at
      // the reveal. The texts of a case, a missed fact and a note reach a player one at a time,
      // with a validation: the leak scan checks them per player (`perPlayerTexts`).
      const b = sp.build
      for (const list of [b.facts, b.sources, b.workers, b.models, b.compute, b.prompts, b.actions, b.cases, b.efforts ?? []]) {
        for (const x of list as readonly { id: string; key?: unknown }[]) add(x.key, 'never', `${id}.build.${x.id}.key`)
      }
      const { reference, references, ...other } = b.key
      add(reference.public_summary, 'development.reveal', `${id}.build.key.reference.public_summary`)
      add(reference.rationale, 'never', `${id}.build.key.reference.rationale`)
      // The label and the summary of every reference map come out at the reveal of Phase 2.
      references?.forEach((r) => {
        const { public: shown, id: _id, map: _map, needs_actions: _needs, ...rest } = r
        add(shown, 'development.reveal', `${id}.build.key.references.${r.id}.public`)
        add(rest, 'never', `${id}.build.key.references.${r.id}`)
      })
      add(other, 'never', `${id}.build.key`)
    }
    if (sp.maintain) {
      // Phase 3: every `key` stays on the server, and so does everything an event says. The
      // symptom, the cause and the alarm of an event, the sentences of a report and of an
      // incident, and a news item reach a player one at a time (`maintainTexts`). The lesson of
      // an event comes out at the reveal.
      const m = sp.maintain
      for (const list of [m.workers, m.actions]) for (const x of list as readonly { id: string; key?: unknown }[]) add(x.key, 'never', `${id}.maintain.${x.id}.key`)
      m.events.forEach((e) => {
        add(e.key, 'never', `${id}.maintain.${e.id}.key`)
        add(e.reveal, 'maintaining.reveal', `${id}.maintain.${e.id}.reveal`)
      })
      add(m.key, 'never', `${id}.maintain.key`)
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
    pub([sp.system, sp.problems, sp.insights, sp.build, sp.maintain?.workers, sp.maintain?.actions, sp.maintain?.baseline], false)
    // Banter is public, but it is not allowed to repeat a protected string: it stays out of the
    // published set, so the scan flags a line that does.
    if (sp.story) pub({ ...sp.story, banter: undefined }, true)
    // The ids of the canvas are part of every map that a player builds.
    const b = sp.build
    if (b) for (const list of [b.facts, b.sources, b.workers, b.models, b.compute, b.prompts, b.actions, b.cases, [b.result]]) for (const x of list) published.add(x.id)
  }
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

/**
 * Texts of Phase 2 that a player receives one at a time, with their own validation or action:
 * the title and text of a case, what a missed fact or a decision says, a note, and the insight of
 * an action. They are in no list above, and the leak scan checks them per player. `rules` are the
 * words of `line_rules` and `required`, which reach a player only with a line or a draft of their
 * own and are never in the static content.
 */
export function perPlayerTexts(pack: Pack, system: string): {
  cases: Record<string, string[]>; facts: Record<string, string[]>; notes: Record<string, string>; insights: Record<string, string[]>
  rules: string[]
} {
  const base = pack.systems[system]?.build
  const out = { cases: {} as Record<string, string[]>, facts: {} as Record<string, string[]>, notes: {} as Record<string, string>, insights: {} as Record<string, string[]>, rules: [] as string[] }
  if (!base) return out
  // Phase 3 plays on the same board with a few more actions and line rules.
  const b = phase3Build(base, pack.systems[system]?.maintain)
  out.rules = [...b.line_rules.map((r) => r.text), ...b.required.map((r) => r.text)].filter((x) => x.length >= LEAK_MIN_CHARS)
  for (const c of b.cases) out.cases[c.id] = [c.public.title, c.public.text, c.decision_miss]
  for (const f of b.facts) out.facts[f.id] = [f.miss.missing, f.miss.weak]
  for (const n of b.notes) out.notes[n.id] = n.text
  for (const a of b.actions) {
    if (!a.insight) continue
    const t = a.insight
    const texts = [t.headline, t.body]
    if (t.type === 'stat') texts.push(t.data.label, String(t.data.value), t.data.comparison ?? '')
    if (t.type === 'chart') texts.push(t.data.note ?? '', t.data.x_label, t.data.y_label)
    if (t.type === 'audit') texts.push(t.data.note ?? '', ...t.data.findings.map((f) => f.label))
    if (t.type === 'quote') texts.push(...t.data.text.split('\n'))
    out.insights[a.id] = texts.filter((x) => x.length >= LEAK_MIN_CHARS)
  }
  return out
}

/**
 * Texts of Phase 3 that a player receives one at a time: a news item at the start of its round,
 * and with a report the symptom of an event, its cause (only with the lens it asks for), a
 * sentence of the report and of an incident. The alarm of an event comes with a lens action. The
 * leak scan checks them per player.
 */
export function maintainTexts(pack: Pack, system: string): {
  news: Record<string, { round: number; texts: string[] }>
  events: Record<string, { from: number; symptom: string | null; cause: { lens: string; text: string } | null; alarm: string | null }>
  incidents: string[]; report: string[]
} {
  const m = pack.systems[system]?.maintain
  const out = { news: {} as Record<string, { round: number; texts: string[] }>, events: {} as Record<string, { from: number; symptom: string | null; cause: { lens: string; text: string } | null; alarm: string | null }>, incidents: [] as string[], report: [] as string[] }
  if (!m) return out
  const long = (x: string | undefined): x is string => x !== undefined && x.length >= LEAK_MIN_CHARS
  for (const n of m.news) out.news[n.id] = { round: n.round, texts: [n.title, n.text].filter(long) }
  for (const e of m.events) out.events[e.id] = { from: e.from, symptom: long(e.symptom) ? e.symptom : null, cause: e.cause && long(e.cause.text) ? { lens: e.cause.lens, text: e.cause.text } : null, alarm: long(e.alarm) ? e.alarm : null }
  const inc = m.incidents
  out.incidents = [...Object.values(inc.workers), inc.default_worker, ...Object.values(inc.sources), inc.handoff, ...Object.values(inc.compute), inc.new_map].filter(long)
  const r = m.report
  out.report = [...r.validity.map((x) => x.text), ...r.reliability.map((x) => x.text), r.gap, r.radiologists?.content, r.radiologists?.extra_look, r.radiologists?.rushed, r.steady, r.no_map].filter(long)
  return out
}
