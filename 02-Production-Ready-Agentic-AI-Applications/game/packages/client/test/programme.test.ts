// The projector's loop of views (engineering spec, section 6.13).
import { describe, expect, it } from 'vitest'
import { ago, programmeSlot } from '../src/lib/programme.ts'

const P = [
  { show: 'activity', seconds: 20 },
  { show: 'phase_board', seconds: 10 },
  { show: 'activity', seconds: 20 },
  { show: 'player', seconds: 8 },
] as const

describe('programmeSlot', () => {
  it('walks the list in order and starts again', () => {
    expect(programmeSlot(P, 0)).toEqual({ show: 'activity', index: 0, round: 0 })
    expect(programmeSlot(P, 19.9).index).toBe(0)
    expect(programmeSlot(P, 20)).toEqual({ show: 'phase_board', index: 1, round: 0 })
    expect(programmeSlot(P, 30).index).toBe(2)
    expect(programmeSlot(P, 50)).toEqual({ show: 'player', index: 3, round: 0 })
    expect(programmeSlot(P, 58)).toEqual({ show: 'activity', index: 0, round: 1 })
    expect(programmeSlot(P, 58 * 7 + 51)).toEqual({ show: 'player', index: 3, round: 7 })
  })
  it('gives the activity list for an empty programme and for a time before the start', () => {
    expect(programmeSlot([], 12).show).toBe('activity')
    expect(programmeSlot(P, -5)).toEqual({ show: 'activity', index: 0, round: 0 })
  })
})

describe('ago', () => {
  it('rounds to what a room can read', () => {
    expect(ago(0)).toBe('now')
    expect(ago(4.9)).toBe('now')
    expect(ago(12)).toBe('10 s ago')
    expect(ago(59)).toBe('55 s ago')
    expect(ago(60)).toBe('1 min ago')
    expect(ago(185)).toBe('3 min ago')
  })
})
