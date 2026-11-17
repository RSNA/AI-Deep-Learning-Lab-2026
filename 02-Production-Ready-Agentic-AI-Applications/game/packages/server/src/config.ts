// Server configuration from the environment (engineering spec, section 7.9).
import { resolve } from 'node:path'

export type Config = {
  port: number
  host: string
  contentDir: string
  dataDir: string
  hostPasscode: string
  publicUrl: string
  answerKeyFile: string | null
  logLevel: 'debug' | 'info' | 'warn' | 'error' | 'silent'
  clientDir: string | null
  systems: string[] | undefined
  production: boolean
  build: string
  /** Wall clock in ms. Tests replace it. Nothing else in the server reads the time. */
  wallNow: () => number
  tickMs: number
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env, defaults: Partial<Config> = {}): Config {
  const production = env.NODE_ENV === 'production'
  const passcode = env.HOST_PASSCODE ?? (production ? '' : 'demo')
  if (production && passcode.length < 16) {
    throw new Error('HOST_PASSCODE must be set and at least 16 characters long in production')
  }
  const level = (env.LOG_LEVEL ?? 'info') as Config['logLevel']
  return {
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? '127.0.0.1',
    contentDir: resolve(env.CONTENT_DIR ?? './content-demo'),
    dataDir: resolve(env.DATA_DIR ?? './data'),
    hostPasscode: passcode,
    publicUrl: (env.PUBLIC_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
    answerKeyFile: env.ANSWER_KEY_FILE ? resolve(env.ANSWER_KEY_FILE) : null,
    logLevel: ['debug', 'info', 'warn', 'error', 'silent'].includes(level) ? level : 'info',
    clientDir: env.CLIENT_DIR ? resolve(env.CLIENT_DIR) : null,
    systems: env.SYSTEMS ? env.SYSTEMS.split(',').map((x) => x.trim()).filter(Boolean) : undefined,
    production,
    build: env.BUILD_ID ?? process.env.BUILD_ID ?? 'dev',
    wallNow: () => Date.now(),
    tickMs: 250,
    ...defaults,
  }
}
