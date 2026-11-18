// JSON lines on standard output. Never a token, a passcode or key content.
type Level = 'debug' | 'info' | 'warn' | 'error'
const ORDER: Record<Level | 'silent', number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 }

export type Logger = Record<Level, (msg: string, fields?: Record<string, unknown>) => void>

export function createLogger(level: Level | 'silent', wallNow: () => number = Date.now): Logger {
  const make = (l: Level) => (msg: string, fields: Record<string, unknown> = {}) => {
    if (ORDER[l] < ORDER[level]) return
    process.stdout.write(`${JSON.stringify({ t: new Date(wallNow()).toISOString(), level: l, msg, ...fields })}\n`)
  }
  return { debug: make('debug'), info: make('info'), warn: make('warn'), error: make('error') }
}
