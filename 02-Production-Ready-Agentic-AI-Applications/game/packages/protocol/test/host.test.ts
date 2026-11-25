// The commands of a host (engineering spec, section 7): the steps by which a phase is extended.
import { describe, expect, it } from 'vitest'
import { HostCommand } from '../src/host.ts'

describe('extend', () => {
  it('takes thirty seconds, a minute or five minutes, and no other step', () => {
    for (const seconds of [30, 60, 300]) expect(HostCommand.safeParse({ type: 'extend', payload: { seconds } }).success).toBe(true)
    for (const seconds of [0, 45, 600]) expect(HostCommand.safeParse({ type: 'extend', payload: { seconds } }).success).toBe(false)
  })
})
