// npm run check:no-private (engineering spec, section 12.5). Reads the private pack when
// CONTENT_DIR points to one, takes every text of 25 characters or more, and searches the working
// tree of this folder for it. Only the YAML files of the pack are read: SCHEMA.md describes the
// format, which the public spec documents on purpose. Also fails on any file under a content or review folder that is not
// the demo pack.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const SKIP = new Set(['node_modules', 'dist', '.git', 'test-results', 'playwright-report', 'data', 'coverage'])
const BINARY = /\.(png|jpe?g|webp|gif|woff2?|ttf|ico|sqlite.*)$/i

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

const files = walk(root)
const problems: string[] = []

for (const f of files) {
  const rel = relative(root, f)
  const parts = rel.split(sep)
  if ((parts.includes('content') || parts.includes('review')) && parts[0] !== 'content-demo') problems.push(`${rel}: a file under a content or review folder`)
}

const dir = process.env.CONTENT_DIR ? resolve(process.env.CONTENT_DIR) : null
if (!dir || dir.startsWith(join(root, 'content-demo'))) {
  console.log('check:no-private: CONTENT_DIR is not set to the private pack, so only the folder check ran.')
} else {
  const texts = new Set<string>()
  const collect = (x: unknown) => {
    // Prose only: ids and enum values are part of the public format.
    if (typeof x === 'string') { const t = x.trim(); if (t.length >= 25 && t.split(' ').length >= 4) texts.add(t) }
    else if (Array.isArray(x)) x.forEach(collect)
    else if (x && typeof x === 'object') Object.values(x).forEach(collect)
  }
  for (const f of walk(dir)) {
    if (/\.ya?ml$/.test(f)) {
      try { collect(parse(readFileSync(f, 'utf8'))) } catch { /* the loader reports YAML errors */ }
    }
  }
  const list = [...texts]
  for (const f of files) {
    if (BINARY.test(f)) continue
    const body = readFileSync(f, 'utf8')
    for (const t of list) {
      if (body.includes(t)) { problems.push(`${relative(root, f)}: holds text of the private pack ("${t.slice(0, 40)}…")`); break }
    }
  }
  console.log(`check:no-private: searched ${files.length} files for ${list.length} texts of the private pack.`)
}

if (problems.length) {
  console.error(problems.join('\n'))
  process.exit(1)
}
console.log('check:no-private: clean.')
