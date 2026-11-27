// Scores, points and bands (engineering spec, section 6.8). The reference scorer of the private
// pack is the executable definition; the parity vectors check these functions against it.

export type Anchors = { zero: number | null; floor: number | null; ceiling: number | null }
export type NormConfig = { floor_points: number; max_points: number }
export type Weights = { validity: number; reliability: number; cost: number; complexity: number }

export function roundHalfUp(x: number): number {
  return Math.floor(x + 0.5)
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x))
}

/** Raw phase score to points through the three anchors. Throws when the anchors are out of order. */
export function normalize(raw: number, anchors: { zero: number; floor: number; ceiling: number }, norm: NormConfig): number {
  const { zero, floor, ceiling } = anchors
  if (!(zero <= floor && floor < ceiling)) throw new Error(`anchors must satisfy zero <= floor < ceiling: ${JSON.stringify(anchors)}`)
  let pts: number
  if (raw <= zero) pts = 0
  else if (raw < floor) pts = (norm.floor_points * (raw - zero)) / (floor - zero)
  else if (raw >= ceiling) pts = norm.max_points
  else pts = norm.floor_points + ((norm.max_points - norm.floor_points) * (raw - floor)) / (ceiling - floor)
  return roundHalfUp(pts)
}

/** Points of a phase. Without a full set of anchors the raw score is rounded and kept in range. */
export function pointsOf(raw: number, anchors: Anchors & { provisional: boolean }, norm: NormConfig): { points: number; provisional: boolean } {
  const { zero, floor, ceiling } = anchors
  if (zero === null || floor === null || ceiling === null) {
    return { points: clamp(roundHalfUp(raw), 0, norm.max_points), provisional: true }
  }
  return { points: normalize(raw, { zero, floor, ceiling }, norm), provisional: anchors.provisional }
}

export function fourMetricScore(v: number, r: number, c: number, x: number, w: Weights): number {
  return w.validity * v + w.reliability * r + (v / 100) * (w.cost * c + w.complexity * x)
}

export function bandOf(points: number, bands: readonly { id: string; min: number; max: number }[]): string {
  for (const b of bands) if (b.min <= points && points <= b.max) return b.id
  return bands[0]?.id ?? 'none'
}
