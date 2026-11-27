// The geometry of the practice scene (engineering spec, sections 10.2 to 10.4): the scale of the
// room, the band a cropped view shows, and where people may stand inside it. Pure functions.
import type { Facing } from './people.ts'

export type Point = [number, number, Facing]

/**
 * The scale of the scene (sections 10.2 and 10.4): the smallest whole number at which the room
 * covers the width, as long as the crop stays within 10 percent of the room's width, else the
 * scale below on a backdrop. On a phone the camera crops instead of shrinking the room.
 */
export function sceneScale(width: number, roomW: number, phone: boolean): number {
  if (width <= 0) return 1
  const cover = Math.ceil(width / roomW)
  if (phone) return Math.max(2, cover > 2 && (cover * roomW - width) / (cover * roomW) > 0.1 ? cover - 1 : cover)
  if ((cover * roomW - width) / (cover * roomW) <= 0.1) return cover
  return Math.max(1, cover - 1)
}

/**
 * A cropped view shows a band of the room (sections 10.3 and 10.4). The band is never lower
 * than STAGE_BAND room pixels, which holds the table, its seats and the posts around it: the
 * scale steps down until it is. Inside a cropped view people stand and walk only where they
 * show whole, with room for a marker over the head, so nobody is cut by the edge and everyone
 * with an interview to give can be clicked. On a phone the camera crops the room at the sides
 * by design, so there only the rows count.
 */
export const ROOM_W = 320
export const STAGE_BAND = 96
const HEAD_ROOM = 2
const BODY = 16

/** The largest scale at which a view of this height still shows the whole band. */
export function cropScale(scale: number, cropHeight: number, phone: boolean): number {
  return Math.max(phone ? 2 : 1, Math.min(scale, Math.floor(cropHeight / STAGE_BAND)))
}

/**
 * The rows (or the columns) of the room that a view shows, as [from, to) in room pixels: `room`
 * is the height (or width) of the room, `view` that of the view in screen pixels, and `focus`
 * the row (or column) the camera centres on.
 */
export function visibleSpan(room: number, scale: number, view: number, focus: number): [number, number] {
  const span = view / scale
  if (span >= room) return [0, room]
  const from = Math.max(0, Math.min(room - span, focus - span / 2))
  return [from, from + span]
}

/** The part of the room a view shows: its rows and its columns, in room pixels. */
export type View = { rows: readonly [number, number]; cols: readonly [number, number] }

/** The whole room. */
export const wholeRoom = (size: readonly [number, number]): View => ({ rows: [0, size[1]], cols: [0, size[0]] })

/** Whether a person at this spot shows whole inside the view. */
export function inView(p: readonly [number, number, ...unknown[]], v: View): boolean {
  return p[1] >= v.rows[0] + HEAD_ROOM && p[1] + BODY <= v.rows[1] && p[0] >= v.cols[0] && p[0] + BODY <= v.cols[1]
}

/** The same spot, moved until it is inside the view. */
export function intoView(p: Point, v: View): Point {
  const into = (at: number, from: number, to: number) => Math.max(Math.ceil(from), Math.min(Math.floor(to - BODY), at))
  return [into(p[0], v.cols[0], v.cols[1]), into(p[1], v.rows[0] + HEAD_ROOM, v.rows[1]), p[2]]
}

/** The spots people take, in order: first those inside the view, then the others moved into it. */
export function spotsIn(all: Point[], v: View): Point[] {
  return [...all.filter((p) => inView(p, v)), ...all.filter((p) => !inView(p, v)).map((p) => intoView(p, v))]
}

/**
 * The height of the reading room above the evidence of Phase 1 (section 10.4). The room always
 * shows the band with the table and the people around it. On a tall window a wide column shows
 * the room larger and the strip grows with it, up to 30 percent of the window.
 */
export function stripHeight(phone: boolean, columnWidth: number, windowHeight: number): number {
  if (phone) return 200
  if (windowHeight < 800) return STAGE_BAND * 2
  for (let k = sceneScale(columnWidth, ROOM_W, false); k > 2; k--) if (STAGE_BAND * k <= windowHeight * 0.3) return STAGE_BAND * k
  return 266
}
