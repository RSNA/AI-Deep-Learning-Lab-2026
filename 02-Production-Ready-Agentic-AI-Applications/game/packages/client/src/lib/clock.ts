// The countdown. A browser counts down from the last clock message and never trusts its own
// wall clock against the server's (engineering spec, section 7.4).
import { useEffect, useState } from 'react'
import type { Clock } from '@lab02/protocol'

export type ClockRef = { clock: Clock; at: number }

export function gameNow(c: ClockRef, perfNow = performance.now()): number {
  return c.clock.running ? c.clock.gameMs + (perfNow - c.at) * c.clock.scale : c.clock.gameMs
}

/** Seconds left in the timed stage, or in the host's guide for an untimed one. */
export function secondsLeft(c: ClockRef | null, guide = false): number | null {
  if (!c) return null
  const end = guide ? c.clock.stageEndsAtMs ?? c.clock.guideEndsAtMs : c.clock.stageEndsAtMs
  if (end === null) return null
  return Math.max(0, (end - gameNow(c)) / 1000)
}

export function useTick(ms = 250): number {
  const [n, setN] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setN((x) => x + 1), ms)
    return () => clearInterval(id)
  }, [ms])
  return n
}

export function fmt(seconds: number | null): string {
  if (seconds === null) return '--:--'
  const s = Math.ceil(seconds)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}
