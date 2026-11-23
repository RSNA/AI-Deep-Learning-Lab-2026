// npm run dev: the server with the demo pack (or CONTENT_DIR) and the client with hot reload.
import { spawn } from 'node:child_process'

// Port 3000 is often taken on a laptop, so the dev server defaults to 3100.
const port = process.env.PORT ?? '3100'
const env = { ...process.env, PORT: port, LAB02_SERVER: `http://127.0.0.1:${port}`, PUBLIC_URL: process.env.PUBLIC_URL ?? 'http://localhost:5173', HOST: process.env.HOST ?? '0.0.0.0' }
const procs = [
  spawn('npx', ['tsx', 'watch', '--clear-screen=false', 'packages/server/src/main.ts'], { stdio: 'inherit', env }),
  spawn('npx', ['vite'], { stdio: 'inherit', env, cwd: 'packages/client' }),
]
const stop = () => { for (const p of procs) p.kill('SIGTERM'); process.exit(0) }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
for (const p of procs) p.on('exit', (code) => { if (code) stop() })
