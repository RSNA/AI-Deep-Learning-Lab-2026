// Bundles the server into one file, so the event server needs no npm install (spec, section 4).
import { build } from 'esbuild'
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'

const id = process.env.BUILD_ID ?? 'dev'
rmSync('dist', { recursive: true, force: true })
mkdirSync('dist/server', { recursive: true })
await build({
  entryPoints: ['packages/server/src/main.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: 'dist/server/server.mjs',
  define: { 'process.env.BUILD_ID': JSON.stringify(id) },
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  external: ['bufferutil', 'utf-8-validate'],
  logLevel: 'warning',
})
cpSync('packages/client/dist', 'dist/client', { recursive: true })
writeFileSync('dist/BUILD', `${id}\n`)
console.log(`built ${id} into dist/`)
