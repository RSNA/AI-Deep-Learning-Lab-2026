// The band of the room a cropped view shows, and where people stand in it (engineering spec,
// sections 10.3 and 10.4).
import { describe, expect, it } from 'vitest'
import { STAGE_BAND, cropScale, inView, sceneScale, spotsIn, stripHeight, visibleSpan, wholeRoom, type Point, type View } from '../src/scene/band.ts'

const ROOM_H = 180
// A neutral layout: posts across the height of a 320 x 180 room.
const SPOTS: Point[] = [[20, 20, 'front'], [60, 58, 'front'], [100, 60, 'front'], [140, 100, 'left'], [180, 132, 'right'], [220, 140, 'front'], [260, 160, 'back']]

describe('the visible band of the room', () => {
  it('shows the whole room when the view is as high as the room', () => {
    expect(visibleSpan(ROOM_H, 2, 360, 104)).toEqual([0, 180])
  })

  it('is centred on the focus and stays inside the room', () => {
    expect(visibleSpan(ROOM_H, 2, 192, 104)).toEqual([56, 152])
    expect(visibleSpan(ROOM_H, 2, 192, 10)).toEqual([0, 96])
    expect(visibleSpan(ROOM_H, 2, 192, 175)).toEqual([84, 180])
  })

  it('never shows less than the band: the scale steps down, on a phone not below 2', () => {
    expect(cropScale(4, 266, false)).toBe(2)
    expect(cropScale(4, STAGE_BAND * 3, false)).toBe(3)
    expect(cropScale(2, 400, false)).toBe(2)
    expect(cropScale(3, 200, true)).toBe(2)
    expect(cropScale(2, 100, true)).toBe(2)
    for (const [width, winH] of [[660, 720], [800, 900], [1370, 1107], [1370, 1300], [1700, 1440]] as const) {
      const h = stripHeight(false, width, winH)
      const scale = cropScale(sceneScale(width, 320, false), h, false)
      const [top, bottom] = visibleSpan(ROOM_H, scale, Math.min(ROOM_H * scale, h), 104)
      expect(bottom - top, `${width} x ${winH}`).toBeGreaterThanOrEqual(STAGE_BAND)
      expect(h, `${width} x ${winH}`).toBeLessThanOrEqual(Math.max(266, winH * 0.3))
    }
  })

  it('gives the strip of Phase 1 its height', () => {
    expect(stripHeight(true, 390, 844)).toBe(200)
    expect(stripHeight(false, 660, 720)).toBe(192)
    expect(stripHeight(false, 800, 900)).toBe(266)
    expect(stripHeight(false, 1370, 1107)).toBe(288)
    expect(stripHeight(false, 1370, 1300)).toBe(384)
  })
})

describe('where people stand in a cropped view', () => {
  const view: View = { rows: [56, 152], cols: [0, 320] }

  it('counts a spot only when the person shows whole, with room over the head', () => {
    expect(inView([0, 58, 'front'], view)).toBe(true)
    expect(inView([0, 57, 'front'], view)).toBe(false)
    expect(inView([0, 136, 'front'], view)).toBe(true)
    expect(inView([0, 137, 'front'], view)).toBe(false)
    const narrow: View = { rows: [0, ROOM_H], cols: [8.5, 295.5] }
    expect(inView([279, 100, 'front'], narrow)).toBe(true)
    expect(inView([282, 100, 'front'], narrow)).toBe(false)
    expect(inView([8, 100, 'front'], narrow)).toBe(false)
  })

  it('takes the spots in view first and moves the others into view', () => {
    const spots = spotsIn(SPOTS, view)
    expect(spots).toHaveLength(SPOTS.length)
    expect(spots.slice(0, 4).map((p) => p[1])).toEqual([58, 60, 100, 132])
    for (const p of spots) expect(inView(p, view), String(p)).toBe(true)
    // A moved spot keeps its column and its facing.
    expect(spots.at(-1)).toEqual([260, 136, 'back'])
    expect(spots[4]).toEqual([20, 58, 'front'])
    // A view cropped a little at the sides moves a spot at the edge inwards.
    const narrow: View = { rows: [0, ROOM_H], cols: [8.5, 295.5] }
    expect(spotsIn([[282, 112, 'front'], [4, 60, 'back']], narrow)).toEqual([[279, 112, 'front'], [9, 60, 'back']])
  })

  it('leaves every spot alone when the whole room shows', () => {
    expect(spotsIn(SPOTS, wholeRoom([320, ROOM_H]))).toEqual(SPOTS)
  })
})
