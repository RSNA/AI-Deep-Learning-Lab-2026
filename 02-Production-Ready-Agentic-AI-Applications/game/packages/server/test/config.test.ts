// The host passcode rule (engineering spec, section 7.9).
import { describe, expect, it } from 'vitest'
import { configFromEnv } from '../src/config.ts'

describe('the host passcode in production', () => {
  const prod = { NODE_ENV: 'production' }
  it('refuses a missing or short passcode', () => {
    expect(() => configFromEnv({ ...prod })).toThrow(/HOST_PASSCODE/)
    expect(() => configFromEnv({ ...prod, HOST_PASSCODE: 'short' })).toThrow(/16 characters/)
  })
  it('accepts a long passcode, and is not weak', () => {
    expect(configFromEnv({ ...prod, HOST_PASSCODE: 'a-long-passcode-0123' }).weakPasscode).toBe(false)
  })
  it('accepts a short passcode only with ALLOW_WEAK_PASSCODE=1, and marks it weak', () => {
    const c = configFromEnv({ ...prod, HOST_PASSCODE: 'short', ALLOW_WEAK_PASSCODE: '1' })
    expect(c.weakPasscode).toBe(true)
    expect(() => configFromEnv({ ...prod, HOST_PASSCODE: '', ALLOW_WEAK_PASSCODE: '1' })).toThrow(/HOST_PASSCODE/)
  })
})
