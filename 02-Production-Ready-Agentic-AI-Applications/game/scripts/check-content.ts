// npm run check:content: loads the pack in CONTENT_DIR and prints every error and warning.
import { loadPack } from '@lab02/content-schema'

const dir = process.env.CONTENT_DIR ?? 'content-demo'
const systems = process.env.SYSTEMS ? process.env.SYSTEMS.split(',').map((s) => s.trim()).filter(Boolean) : undefined
const res = loadPack(dir, { systems })
const fmt = (i: { file: string; path: string; message: string }) => `  ${i.file}${i.path ? ` ${i.path}` : ''}: ${i.message}`
if (res.warnings.length) {
  console.log(`${res.warnings.length} warning(s):`)
  for (const w of res.warnings) console.log(fmt(w))
}
if (!res.ok) {
  console.log(`${res.errors.length} error(s):`)
  for (const e of res.errors) console.log(fmt(e))
  process.exit(1)
}
const p = res.pack
console.log(`pack ok: ${dir}`)
console.log(`  hash ${p.hash.slice(0, 16)}`)
console.log(`  health systems ${p.systemIds.join(', ')}`)
console.log(`  phases that can run: ${Object.entries(p.phasesAvailable).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none'}`)
console.log(`  anchors ${p.provisional ? 'provisional' : 'measured'}`)
