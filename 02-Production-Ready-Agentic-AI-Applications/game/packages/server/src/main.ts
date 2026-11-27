// The server entry point. Loads the pack, restores open sessions, listens.
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createApp } from './app.ts'

// The bundled server finds the client build next to it (dist/server and dist/client).
const bundled = fileURLToPath(new URL('../client', import.meta.url))
const overrides = !process.env.CLIENT_DIR && existsSync(`${bundled}/index.html`) ? { clientDir: bundled } : {}

const app = createApp(overrides)
await app.listen()
let stopping = false
const stop = async (signal: string) => {
  if (stopping) return
  stopping = true
  app.log.info('shutting down', { signal })
  await app.close()
  process.exit(0)
}
process.on('SIGTERM', () => void stop('SIGTERM'))
process.on('SIGINT', () => void stop('SIGINT'))
