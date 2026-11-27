// npm run simulate: a year of Phase 3 for every reference map of the pack in CONTENT_DIR, left
// alone and with every repair made as soon as it can count, beside a practice with no map.
// Headless, on the engine's own scoring (engineering spec, sections 6.7 and 12.1). It prints
// numbers of the pack, so run it on the Mac and never paste its output into the repository.
import { loadPack, phase3Build, referenceMaps } from '@lab02/content-schema'
import { year, type HeldAction } from '@lab02/engine'

const dir = process.env.CONTENT_DIR ?? 'content-demo'
const systems = process.env.SYSTEMS ? process.env.SYSTEMS.split(',').map((s) => s.trim()).filter(Boolean) : undefined
const res = loadPack(dir, { systems })
if (!res.ok) {
  for (const e of res.errors) console.error(`${e.file} ${e.path}: ${e.message}`)
  process.exit(1)
}
const pct = (x: number) => `${(100 * x).toFixed(1)}`.padStart(6)
const num = (x: number) => x.toFixed(1).padStart(6)

for (const id of res.pack.systemIds) {
  const sp = res.pack.systems[id]!
  if (!sp.build || !sp.maintain) { console.log(`${id}: no Phase 3 in this pack`); continue }
  const b3 = phase3Build(sp.build, sp.maintain)
  const mt = sp.maintain
  const n = mt.periods.length
  const price = (ids: readonly string[]) => ids.reduce((sum, a) => sum + (b3.actions.find((x) => x.id === a)?.money ?? 0), 0)
  console.log(`\n${id}: ${sp.system.public.name}. A year of ${n} periods, ${mt.score.cost_per_point} of money for one point.`)
  console.log(`${'map'.padEnd(34)}${mt.periods.map((p) => p.short.padStart(8)).join('')}    mean   spent   score`)
  const row = (name: string, y: ReturnType<typeof year>) =>
    console.log(`${name.padEnd(34)}${y.values.map((v) => num(v).padStart(8)).join('')}  ${num(y.mean)}  ${num(y.spent)}  ${num(y.score)}`)
  row(mt.baseline.public.label, year(b3, mt, Array.from({ length: n }, () => ({ map: null, actions: [], newMap: false })), 0))
  for (const ref of referenceMaps(sp.build)) {
    const needs: HeldAction[] = ref.needsActions.map((a) => ({ id: a, started: 0, done: 0 }))
    const alone = year(b3, mt, Array.from({ length: n }, () => ({ map: ref.map, actions: needs, newMap: false })), price(ref.needsActions))
    row(`${ref.label}, left alone`, alone)
    console.log(`${''.padEnd(34)}${alone.validity.map((v, i) => `${pct(v)}/${pct(alone.reliability[i]!).trim()}`.padStart(8)).join('')}   (right / ran, percent)`)
    // Every repair, started with the report of the first period of its event.
    const repairs: HeldAction[] = mt.events.flatMap((e) => e.repaired_by.slice(0, 1).map((a) => ({ id: a, started: e.from, done: e.from })))
    row(`${ref.label}, every repair made`, year(b3, mt, Array.from({ length: n }, () => ({ map: ref.map, actions: [...needs, ...repairs], newMap: false })), price([...ref.needsActions, ...repairs.map((r) => r.id)])))
  }
}
