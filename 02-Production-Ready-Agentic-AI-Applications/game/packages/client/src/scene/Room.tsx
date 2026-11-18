// The practice scene (engineering spec, section 10.3): one PixiJS canvas, drawn at 320 x 180 and
// shown at a whole-number scale. The browser animates it; the server sends no positions, and it
// never gates play. Without WebGL a still image with the same people takes its place.
//
// The scene lives: people walk between places on the floor, the worklist on the wall scrolls, the
// monitors change, and now and then two or three people trade lines from the banter of the
// story. A click on a person makes them stop, turn to the player, hop and say one of their lines.
// In Phase 1 a person with an interview to give carries a marker, and a click starts the
// interview; while it runs they sit at the table with the player's own character. One bubble is
// up at a time. With reduced motion nobody walks, the screens stand still and nobody hops; the
// bubbles, the banter and the clicks still work.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AvatarId, Character, PackArt, SystemPublic } from '@lab02/protocol'
import { Portrait, looksOf } from '../components/ui.tsx'
import { FACE_COL, spriteSheet, type Facing } from './people.ts'

type Point = [number, number, Facing]
export type SceneLayout = {
  size: [number, number]
  posts: Point[]
  table: { seats: Point[]; you: Point }
  you: Point
  door: [number, number]
  ambient: Point[]
  board: [number, number, number, number] | null
  /** Optional: more points people may walk to. */
  places?: Point[]
  /** Optional: monitor screens [x, y, w, h]. Without them the scene finds the screens itself. */
  monitors?: [number, number, number, number][]
}

const VARIANTS = 12
const CELL = 4
const LINE_MS = 3000
const MIN_LINE_MS = 2800

// Wall time and chance for the animation only. The scene never feeds anything back to the game.
const wallMs = () => performance.now()
const chance = () => Math.random()
const between = (a: number, b: number) => a + chance() * (b - a)

function avatarIndex(id: string): number {
  const n = Number(id.replace(/\D/g, ''))
  return Number.isFinite(n) && n >= 1 ? (n - 1) % VARIANTS : 0
}

function reducedMotion(): boolean {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
}

const TITLES = new Set(['dr', 'dr.', 'mr', 'mr.', 'mrs', 'mrs.', 'ms', 'ms.', 'mx', 'mx.', 'prof', 'prof.'])
/** The first name: no title before it and nothing after a comma. */
export function firstName(name: string): string {
  const words = (name.split(',')[0] ?? '').trim().split(/\s+/)
  while (words.length > 1 && TITLES.has(words[0]!.toLowerCase())) words.shift()
  return words[0] ?? name
}

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

type Actor = {
  key: string
  x: number
  y: number
  facing: Facing
  home: Point
  you: boolean
  path: [number, number][]
  /** Where the person stands while away from home, or null. */
  away: Point | null
  /** When the person may next set out, and until when they hold still. */
  nextAt: number
  holdUntil: number
  hopAt: number
}

// ------------------------------------------------------------------------------------------
// The floor: which 4 x 4 cells a person may stand on, read from the room image itself
// ------------------------------------------------------------------------------------------
type Floor = { w: number; h: number; ok: Uint8Array }

/**
 * The backdrop beside a room that is narrower than its panel (section 10.2): the wall color beside
 * the wall and the floor color beside the floor, with the tint of the image on show. Above the
 * wall line each row continues the edge of the wall (its main color in the 16 outermost pixels,
 * so a moulding runs on). Below it each row takes the mean of the floor pixels near that edge, so
 * a desk or a plant at the edge never streaks across the band. The result is a 2 x H image: the
 * left column, then the right column.
 */
type Bands = { url: string; fill: string }
type Pixels = { W: number; H: number; data: Uint8ClampedArray }
function pixelsOf(img: HTMLImageElement): Pixels | null {
  const W = img.naturalWidth, H = img.naturalHeight
  if (!W || !H) return null
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(img, 0, 0)
  try { return { W, H, data: ctx.getImageData(0, 0, W, H).data } } catch { return null }
}
/** The main colors of the floor, from under the player's own spot. */
function floorColors(px: Pixels, you: [number, number]): number[][] {
  const { W, H, data } = px
  const counts = new Map<number, number>()
  for (let y = you[1] + 8; y < Math.min(H, you[1] + 22); y++) for (let x = Math.max(0, you[0] - 4); x < Math.min(W, you[0] + 20); x++) {
    const i = (y * W + x) * 4
    const k = (data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  // A color counts only when it covers a good share: a dark seam between tiles is not the floor.
  const total = [...counts.values()].reduce((a, n) => a + n, 0)
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).filter(([, n]) => n >= Math.max(6, total * 0.2)).map(([k]) => [k >> 16, (k >> 8) & 255, k & 255])
}
const near = (cols: number[][], r: number, g: number, b: number, tol: number) => cols.some((f) => Math.abs(f[0]! - r) + Math.abs(f[1]! - g) + Math.abs(f[2]! - b) < tol)
/** The wall line: the first of eight rows in a row where the floor takes a good part of the
 * width. A single line of the wall in the floor's color (the rim of a panel) does not count. */
function wallLine(px: Pixels, floor: number[][]): number {
  const { W, H, data } = px
  let run = 0
  for (let y = 0; y < H; y++) {
    let n = 0
    for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; if (near(floor, data[i]!, data[i + 1]!, data[i + 2]!, 20)) n++ }
    run = n >= W * 0.3 ? run + 1 : 0
    if (run === 8) return y - 7
  }
  return Math.floor(H / 3)
}
function edgeBands(px: Pixels, floor: number[][], split: number): Bands | null {
  const { W, H, data } = px
  const out = document.createElement('canvas')
  out.width = 2
  out.height = H
  const octx = out.getContext('2d')
  if (!octx) return null
  const od = octx.createImageData(2, H)
  const mean = floor.length ? floor.reduce((a, f) => [a[0]! + f[0]! / floor.length, a[1]! + f[1]! / floor.length, a[2]! + f[2]! / floor.length], [0, 0, 0]) : [128, 128, 128]
  for (let side = 0; side < 2; side++) {
    let carry = mean
    for (let y = 0; y < H; y++) {
      let col: number[]
      if (y < split) {
        const counts = new Map<number, number>()
        let r = 0, g = 0, b = 0
        const strip = Math.min(16, W)
        for (let k = 0; k < strip; k++) {
          const i = (y * W + (side === 0 ? k : W - 1 - k)) * 4
          r += data[i]!; g += data[i + 1]!; b += data[i + 2]!
          const key = (data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!
          counts.set(key, (counts.get(key) ?? 0) + 1)
        }
        const [top, n] = [...counts.entries()].sort((p, q) => q[1] - p[1])[0]!
        col = n >= strip * 0.6 ? [top >> 16, (top >> 8) & 255, top & 255] : [r / strip, g / strip, b / strip]
      } else {
        let r = 0, g = 0, b = 0, n = 0
        for (let k = 0; k < Math.min(48, W); k++) {
          const i = (y * W + (side === 0 ? k : W - 1 - k)) * 4
          if (near(floor, data[i]!, data[i + 1]!, data[i + 2]!, 24)) { r += data[i]!; g += data[i + 1]!; b += data[i + 2]!; n++ }
        }
        if (n >= 6) carry = [r / n, g / n, b / n]
        col = carry
      }
      const o = (y * 2 + side) * 4
      od.data[o] = Math.round(col[0]!); od.data[o + 1] = Math.round(col[1]!); od.data[o + 2] = Math.round(col[2]!); od.data[o + 3] = 255
    }
  }
  octx.putImageData(od, 0, 0)
  const m = (Math.floor(Math.min(split, H) * 0.4) * 2) * 4
  return { url: out.toDataURL(), fill: `rgb(${od.data[m]},${od.data[m + 1]},${od.data[m + 2]})` }
}

function readRoom(img: HTMLImageElement, layout: SceneLayout): { floor: Floor; screens: [number, number, number, number][]; boardBg: number | null } | null {
  const [W, H] = layout.size
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(img, 0, 0)
  let data: Uint8ClampedArray
  try { data = ctx.getImageData(0, 0, W, H).data } catch { return null }
  const at = (x: number, y: number) => { const i = (y * W + x) * 4; return [data[i]!, data[i + 1]!, data[i + 2]!] as const }
  // The floor colours: the most common colours under the player's own spot.
  const counts = new Map<number, number>()
  const [ux, uy] = layout.you
  for (let y = uy + 8; y < Math.min(H, uy + 22); y++) for (let x = ux - 4; x < Math.min(W, ux + 20); x++) {
    const [r, g, b] = at(Math.max(0, x), y)
    const k = (r << 16) | (g << 8) | b
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  const floorCols = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).filter(([, n]) => n >= 6).map(([k]) => [k >> 16, (k >> 8) & 255, k & 255])
  const near = (r: number, g: number, b: number) => floorCols.some((f) => Math.abs(f[0]! - r) + Math.abs(f[1]! - g) + Math.abs(f[2]! - b) < 34)
  const w = Math.floor(W / CELL), h = Math.floor(H / CELL)
  const ok = new Uint8Array(w * h)
  for (let cy = 0; cy < h; cy++) for (let cx = 0; cx < w; cx++) {
    let n = 0
    for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) { const [r, g, b] = at(cx * CELL + x, cy * CELL + y); if (near(r, g, b)) n++ }
    ok[cy * w + cx] = n >= CELL * CELL * 0.7 ? 1 : 0
  }
  // A person is 10 px wide: keep a cell only when its neighbours left and right are floor too.
  const ok2 = new Uint8Array(ok)
  for (let cy = 0; cy < h; cy++) for (let cx = 0; cx < w; cx++) if (ok[cy * w + cx] && (!ok[cy * w + cx - 1] || !ok[cy * w + cx + 1])) ok2[cy * w + cx] = 0

  // Screens: small dark or lit rectangles of one colour.
  const seen = new Uint8Array(W * H)
  const isScreen = (x: number, y: number) => { const [r, g, b] = at(x, y); const lum = 0.3 * r + 0.59 * g + 0.11 * b; return (lum < 70 && b >= r) || (b > 180 && g > 140 && r < 140) }
  const screens: [number, number, number, number][] = []
  const board = layout.board
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (seen[y * W + x] || !isScreen(x, y)) continue
    let x0 = x, x1 = x, y0 = y, y1 = y, n = 0
    const stack = [[x, y]]
    seen[y * W + x] = 1
    while (stack.length) {
      const [px, py] = stack.pop()!
      n++
      x0 = Math.min(x0, px!); x1 = Math.max(x1, px!); y0 = Math.min(y0, py!); y1 = Math.max(y1, py!)
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const qx = px! + dx!, qy = py! + dy!
        if (qx < 0 || qy < 0 || qx >= W || qy >= H || seen[qy * W + qx] || !isScreen(qx, qy)) continue
        seen[qy * W + qx] = 1
        stack.push([qx, qy])
      }
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1
    const inBoard = board && x0 >= board[0] - 2 && x1 <= board[0] + board[2] + 2 && y0 >= board[1] - 2 && y1 <= board[1] + board[3] + 2
    if (!inBoard && bw >= 7 && bw <= 24 && bh >= 5 && bh <= 14 && n >= bw * bh * 0.45) screens.push([x0, y0, bw, bh])
  }
  let boardBg: number | null = null
  if (board) { const [r, g, b] = at(board[0] + 3, board[1] + 3); boardBg = (r << 16) | (g << 8) | b }
  return { floor: { w, h, ok: ok2 }, screens: layout.monitors ?? screens.slice(0, 16), boardBg }
}

/** A path for the feet from one spot to another on the floor, as turning points. */
function route(floor: Floor | null, from: [number, number], to: [number, number]): [number, number][] {
  const direct: [number, number][] = [[to[0], from[1]], [to[0], to[1]]]
  if (!floor) return direct
  const { w, h, ok } = floor
  const cellOf = (p: [number, number]) => [Math.max(0, Math.min(w - 1, Math.floor((p[0] + 8) / CELL))), Math.max(0, Math.min(h - 1, Math.floor((p[1] + 14) / CELL)))] as const
  const nearestOk = (cx: number, cy: number): [number, number] | null => {
    for (let r = 0; r < 12; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
      const x = cx + dx, y = cy + dy
      if (x >= 0 && y >= 0 && x < w && y < h && ok[y * w + x]) return [x, y]
    }
    return null
  }
  const [sx, sy] = cellOf(from), [tx, ty] = cellOf(to)
  const s = nearestOk(sx, sy), t = nearestOk(tx, ty)
  if (!s || !t) return direct
  const prev = new Int32Array(w * h).fill(-1)
  const q = [s[1] * w + s[0]]
  prev[q[0]!] = q[0]!
  for (let i = 0; i < q.length; i++) {
    const c = q[i]!
    if (c === t[1] * w + t[0]) break
    const cx = c % w, cy = Math.floor(c / w)
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = cx + dx!, y = cy + dy!
      if (x < 0 || y < 0 || x >= w || y >= h) continue
      const n = y * w + x
      if (prev[n] !== -1 || !ok[n]) continue
      prev[n] = c
      q.push(n)
    }
  }
  const end = t[1] * w + t[0]
  if (prev[end] === -1) return direct
  const cells: number[] = []
  for (let c = end; ; c = prev[c]!) { cells.push(c); if (prev[c] === c) break }
  cells.reverse()
  const toPos = (c: number): [number, number] => [(c % w) * CELL + CELL / 2 - 8, Math.floor(c / w) * CELL + CELL / 2 - 14]
  const pts: [number, number][] = []
  const first = toPos(cells[0]!)
  pts.push([first[0], from[1]], first)
  for (let i = 1; i < cells.length - 1; i++) {
    const a = cells[i - 1]!, b = cells[i]!, c = cells[i + 1]!
    if (b - a !== c - b) pts.push(toPos(b))
  }
  const last = toPos(cells[cells.length - 1]!)
  pts.push(last, [to[0], last[1]], [to[0], to[1]])
  return pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1]![0] || p[1] !== pts[i - 1]![1])
}

/** Where people may walk to: free posts, the places of the room, the wall board and the door. */
function placesOf(layout: SceneLayout): Point[] {
  const out: Point[] = [...layout.posts, ...layout.ambient, ...(layout.places ?? [])]
  if (layout.board) out.push([layout.board[0] + layout.board[2] / 2 - 8, layout.board[1] + layout.board[3] + 18, 'back'])
  out.push([layout.door[0] - 8, Math.min(layout.size[1] - 18, layout.door[1] + 4), 'back'])
  return out
}

/** Places every person of the practice and the player's own character on the layout. */
function castActors(layout: SceneLayout, cast: Character[], me: { avatar: AvatarId } | null, walkIn: boolean): Actor[] {
  // The cast take the posts in cast order, the extras the posts left and then the stations.
  const spots = [...layout.posts, ...layout.ambient, ...(layout.places ?? [])]
  const actors: Actor[] = cast.map((c, i) => {
    const home: Point = spots[i] ?? [24 + ((i * 37) % (layout.size[0] - 48)), layout.you[1] + ((i % 2) * 12) - 6, 'front']
    return { key: c.id, x: home[0], y: home[1], facing: home[2], home, you: false, path: [], away: null, nextAt: between(6000, 30_000), holdUntil: 0, hopAt: 0 }
  })
  if (me) {
    const home = layout.you
    const start = walkIn && !reducedMotion() ? [layout.door[0] - 8, layout.door[1] - 16] as [number, number] : [home[0], home[1]] as [number, number]
    const a: Actor = { key: 'you', x: start[0], y: start[1], facing: home[2], home, you: true, path: [], away: null, nextAt: Infinity, holdUntil: 0, hopAt: 0 }
    if (start[0] !== home[0] || start[1] !== home[1]) a.path = [[start[0], home[1]], [home[0], home[1]]]
    actors.push(a)
  }
  return actors
}

/** Where each actor should be now: at the table while interviewing, away or at home otherwise. */
function targetOf(a: Actor, layout: SceneLayout, meeting: string[]): Point {
  if (a.you) return meeting.length ? layout.table.you : a.home
  const i = meeting.indexOf(a.key)
  if (i >= 0) return layout.table.seats[i % layout.table.seats.length]!
  return a.away ?? a.home
}

type Line = { key: string; text: string; ms: number; kind: 'click' | 'banter' }

export type RoomProps = {
  art: PackArt | null
  /** Everyone in the practice, extras included. */
  cast: Character[]
  banter?: SystemPublic['banter']
  me: { avatar: AvatarId } | null
  theme: 'light' | 'dark'
  maxHeight?: number
  /** Crop the scene to this height in screen pixels, centred on focusY. */
  cropHeight?: number
  focusX?: number
  focusY?: number
  label?: string
  /** Characters at the meeting table, in the order their interviews started. */
  meeting?: string[]
  /** The interview or dialogue line being said now. It goes over everything else. */
  bubble?: { speaker: string; text: string } | null
  /** Characters who have an interview to give: they carry a marker and a click starts it. */
  available?: string[]
  onPick?: (characterId: string) => void
  /** A click from outside the scene, such as the list of people: that person turns and speaks. */
  poke?: { id: string; n: number } | null
}

export function Room({
  art, cast, banter = [], me, theme, maxHeight = 540, cropHeight, focusX = 160, focusY = 100, label = 'Your practice',
  meeting = [], bubble = null, available = [], onPick, poke = null,
}: RoomProps) {
  const host = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [layout, setLayout] = useState<SceneLayout | null>(null)
  const [fallback, setFallback] = useState(false)
  const [bands, setBands] = useState<{ day: Bands | null; night: Bands | null }>({ day: null, night: null })
  const base = art?.room ? `${art.base}room/` : '/art/room/'
  const tagsRef = useRef<HTMLDivElement>(null)
  const actorsRef = useRef<Actor[]>([])
  const meetingRef = useRef<string[]>(meeting)
  const bubbleRef = useRef(bubble)
  const setNightRef = useRef<((night: boolean) => void) | null>(null)
  const [line, setLine] = useState<Line | null>(null)
  const queue = useRef<Line[]>([])
  const lineTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const banterTimers = useRef<ReturnType<typeof setTimeout>[]>([])
  const clickN = useRef(new Map<string, number>())
  const [, setFrame] = useState(0)
  meetingRef.current = meeting
  bubbleRef.current = bubble
  const looks = useMemo(() => looksOf(cast), [cast])
  const castKey = cast.map((c) => c.id).join(',')

  useEffect(() => {
    const el = host.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(Math.floor(el.clientWidth)))
    ro.observe(el)
    setWidth(Math.floor(el.clientWidth))
    return () => ro.disconnect()
  }, [])

  // The backdrop beside the room, from both images, so that a change of theme keeps it right.
  // The wall line comes from the day image and holds for the night image too.
  const you = layout?.you
  useEffect(() => {
    if (!you) return
    let live = true
    const load = (name: string) => new Promise<Pixels | null>((res) => {
      const img = new Image()
      img.onload = () => res(pixelsOf(img))
      img.onerror = () => res(null)
      img.src = `${base}${name}`
    })
    void Promise.all([load('room_day.png'), load('room_night.png')]).then(([day, night]) => {
      if (!live || !day) return
      const at: [number, number] = [you[0], you[1]]
      const dayFloor = floorColors(day, at)
      const split = wallLine(day, dayFloor)
      setBands({ day: edgeBands(day, dayFloor, split), night: night ? edgeBands(night, floorColors(night, at), split) : null })
    })
    return () => { live = false }
  }, [base, you])

  useEffect(() => {
    let live = true
    fetch(`${base}scene.json`).then((r) => r.json()).then((j: SceneLayout) => { if (live) setLayout(j) }).catch(() => setFallback(true))
    return () => { live = false }
  }, [base])

  const [rw, rh] = layout?.size ?? [320, 180]
  const phone = width > 0 && width < 640
  let scale = sceneScale(width, rw, phone)
  if (!cropHeight) scale = Math.max(1, Math.min(scale, Math.floor(maxHeight / rh)))
  const viewW = width
  const viewH = Math.min(rh * scale, cropHeight ?? rh * scale)
  const offsetX = rw * scale > viewW ? Math.round(Math.max(viewW - rw * scale, Math.min(0, viewW / 2 - focusX * scale))) : Math.floor((viewW - rw * scale) / 2)
  const offsetY = rh * scale > viewH ? Math.round(Math.max(viewH - rh * scale, Math.min(0, viewH / 2 - focusY * scale))) : 0

  const screenPos = (a: { x: number; y: number }) => [Math.round(offsetX + (a.x + 8) * scale), Math.round(offsetY + (a.y + 1) * scale)] as const

  // Positions the hit areas, the markers and the bubble over the people.
  const placeTags = () => {
    const box = tagsRef.current
    if (!box) return
    for (const a of actorsRef.current) {
      const [x, y] = screenPos(a)
      for (const el of box.querySelectorAll<HTMLElement>(`[data-k="${a.key}"]`)) {
        if (el.dataset.role === 'say') {
          // A bubble goes over its speaker when it fits in the visible part, else at the top.
          const half = el.offsetWidth / 2
          const fits = y - el.offsetHeight - 10 >= 0 && x >= 0 && x <= viewW
          if (fits) {
            const left = Math.max(half + 4, Math.min(viewW - half - 4, x))
            el.style.transform = `translate(${left}px, ${y}px) translate(-50%, -100%)`
            el.style.setProperty('--tail', `${Math.round(x - left + half)}px`)
            el.classList.remove('top')
          } else {
            el.style.transform = `translate(${Math.round(viewW / 2)}px, 6px) translate(-50%, 0)`
            el.classList.add('top')
          }
        } else if (el.dataset.role === 'hit') el.style.transform = `translate(${x - 8 * scale}px, ${y - scale}px)`
        else el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`
      }
    }
  }

  // One bubble at a time: an interview or dialogue line goes first, the queue waits for it.
  const pump = () => {
    if (lineTimer.current || bubbleRef.current) return
    const next = queue.current.shift()
    if (!next) { setLine(null); return }
    setLine(next)
    lineTimer.current = setTimeout(() => { lineTimer.current = null; setLine(null); pump() }, Math.max(MIN_LINE_MS, next.ms))
  }
  const enqueue = (l: Line) => { queue.current.push(l); pump() }
  const stopBanter = () => {
    for (const t of banterTimers.current) clearTimeout(t)
    banterTimers.current = []
    queue.current = queue.current.filter((l) => l.kind !== 'banter')
    if (line?.kind === 'banter' && lineTimer.current) { clearTimeout(lineTimer.current); lineTimer.current = null; setLine(null) }
  }
  // A line of an interview or of dialogue ends any exchange at once; the queue resumes after it.
  useEffect(() => {
    if (bubble) stopBanter()
    else pump()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bubble?.text])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (lineTimer.current) clearTimeout(lineTimer.current); stopBanter() }, [])

  // A click on a person: they stop, turn to the player, hop, and say one of their lines.
  const clickPerson = (c: Character) => {
    if (available.includes(c.id) && onPick) { onPick(c.id); return }
    const a = actorsRef.current.find((x) => x.key === c.id)
    if (a) {
      a.path = []
      a.facing = 'front'
      a.holdUntil = wallMs() + LINE_MS + 800
      if (!reducedMotion()) a.hopAt = wallMs()
    }
    const lines = c.clickLines
    if (lines.length) {
      if (!clickN.current.has(c.id)) clickN.current.set(c.id, Math.floor(chance() * lines.length))
      const n = clickN.current.get(c.id)!
      clickN.current.set(c.id, n + 1)
      queue.current = queue.current.filter((l) => l.key !== c.id)
      enqueue({ key: c.id, text: lines[n % lines.length]!, ms: LINE_MS, kind: 'click' })
    }
    setFrame((f) => f + 1)
  }
  useEffect(() => {
    if (!poke) return
    const c = cast.find((x) => x.id === poke.id)
    if (c) clickPerson(c)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poke?.n])

  // Banter: every 20 to 40 seconds, one exchange, in a shuffled order that repeats only when all have played.
  const banterKey = banter.map((b) => b.id).join(',')
  useEffect(() => {
    if (!banter.length) return
    let stop = false
    let timer: ReturnType<typeof setTimeout>
    let order: typeof banter = []
    const schedule = (ms: number) => { timer = setTimeout(run, ms) }
    const run = () => {
      if (stop) return
      if (bubbleRef.current || lineTimer.current || queue.current.length || document.hidden) return schedule(4000)
      if (!order.length) order = [...banter].sort(() => chance() - 0.5)
      const ex = order[0]!
      const here = new Set(actorsRef.current.map((a) => a.key))
      if (!ex.lines.every((l) => here.has(l.speaker) && !meetingRef.current.includes(l.speaker))) { order.push(order.shift()!); return schedule(3000) }
      order.shift()
      // The speakers stop where they are and turn to each other.
      const speakers = [...new Set(ex.lines.map((l) => l.speaker))].map((id) => actorsRef.current.find((a) => a.key === id)!)
      const cx = speakers.reduce((n, a) => n + a.x, 0) / speakers.length
      const span = ex.lines.length * (LINE_MS + 200)
      for (const a of speakers) { a.path = []; a.facing = a.x < cx - 2 ? 'right' : a.x > cx + 2 ? 'left' : 'front'; a.holdUntil = wallMs() + span }
      ex.lines.forEach((l) => enqueue({ key: l.speaker, text: l.text, ms: LINE_MS, kind: 'banter' }))
      schedule(span + between(20_000, 40_000))
    }
    schedule(between(5000, 12_000))
    return () => { stop = true; clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [banterKey])

  // Walks a person to where they should be.
  const floorRef = useRef<Floor | null>(null)
  const steer = (a: Actor, lay: SceneLayout, still: boolean) => {
    const [tx, ty, tf] = targetOf(a, lay, meetingRef.current)
    const end = a.path.at(-1)
    if (end ? end[0] === tx && end[1] === ty : a.x === tx && a.y === ty) {
      if (!a.path.length && wallMs() > a.holdUntil) a.facing = tf
      return
    }
    if (wallMs() < a.holdUntil && !meetingRef.current.includes(a.key) && !a.you) return
    if (still) { a.x = tx; a.y = ty; a.facing = tf; a.path = []; return }
    a.path = route(floorRef.current, [a.x, a.y], [tx, ty])
  }

  // The PixiJS scene.
  useEffect(() => {
    if (!layout || !width || fallback) return
    let destroyed = false
    let cleanup = () => {}
    actorsRef.current = castActors(layout, cast, me, !!me)
    void (async () => {
      try {
        const PIXI = await import('pixi.js')
        await import('pixi.js/unsafe-eval')
        PIXI.TextureSource.defaultOptions.scaleMode = 'nearest'
        // Pixi decodes images in a worker made from a blob URL, which the content security policy
        // blocks. Decode on the main thread instead; the images are small.
        if (PIXI.loadTextures.config) PIXI.loadTextures.config.preferWorkers = false
        const app = new PIXI.Application()
        await app.init({ width: viewW, height: viewH, backgroundAlpha: 0, antialias: false, resolution: 1, preference: 'webgl' })
        if (destroyed) { app.destroy(true); return }
        const canvas = app.canvas
        canvas.className = 'px'
        canvas.setAttribute('aria-hidden', 'true')
        host.current?.querySelector('.room-canvas')?.replaceChildren(canvas)
        const textures = Promise.all([
          PIXI.Assets.load<InstanceType<typeof PIXI.Texture>>(`${base}room_day.png`),
          PIXI.Assets.load<InstanceType<typeof PIXI.Texture>>(`${base}room_night.png`),
          PIXI.Assets.load<InstanceType<typeof PIXI.Texture>>('/art/sprites.png'),
        ])
        // The room never gates play: if the art does not arrive, the still image takes over.
        const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('art timeout')), 8000))
        const [dayTex, nightTex, sheet] = await Promise.race([textures, timeout])
        if (destroyed) { app.destroy(true); return }
        // The floor and the screens, read once from the day image.
        const img = new Image()
        img.src = `${base}room_day.png`
        await img.decode().catch(() => {})
        const read = img.complete ? readRoom(img, layout) : null
        floorRef.current = read?.floor ?? null
        host.current?.setAttribute('data-ready', 'scene')
        const world = new PIXI.Container()
        world.scale.set(scale)
        world.x = offsetX
        world.y = offsetY
        app.stage.addChild(world)
        const bg = new PIXI.Sprite(theme === 'dark' ? nightTex : dayTex)
        world.addChild(bg)
        const still = reducedMotion()

        // The worklist on the wall moves up one row every 2 to 4 seconds; the monitors change.
        const deco = new PIXI.Container()
        world.addChild(deco)
        const board = layout.board
        const ROWC = [0xff7171, 0xffb83f, 0x3fc8a1, 0x4fb6e6, 0x3fc8a1, 0xa99ad6]
        const ROW_H = 4
        let worklist: { g: InstanceType<typeof PIXI.Graphics>; off: number; target: number; nextAt: number; rows: { w: number; c: number }[] } | null = null
        if (board && read) {
          const [bx, by, bw, bh] = board
          const g = new PIXI.Graphics()
          const mask = new PIXI.Graphics().rect(bx + 3, by + 3, bw - 6, bh - 6).fill(0xffffff)
          g.mask = mask
          deco.addChild(mask, g)
          worklist = { g, off: 0, target: 0, nextAt: between(2000, 4000), rows: Array.from({ length: 12 }, (_, i) => ({ w: 0.3 + ((i * 37) % 60) / 100, c: ROWC[i % ROWC.length]! })) }
        }
        const drawWorklist = () => {
          if (!worklist || !board) return
          const [bx, by, bw, bh] = board
          const g = worklist.g
          g.clear()
          g.rect(bx + 3, by + 3, bw - 6, bh - 6).fill(read?.boardBg ?? 0x25283d)
          const inner = bw - 18
          const loop = ROW_H * worklist.rows.length
          worklist.rows.forEach((r, i) => {
            const y0 = by + 4 + i * ROW_H - (worklist!.off % loop)
            for (const yy of [y0, y0 + loop]) {
              if (yy < by + 1 || yy > by + bh - 3) continue
              g.rect(bx + 5, Math.round(yy), Math.round(inner * r.w), 2).fill(r.c)
              g.rect(bx + bw - 12, Math.round(yy), 7, 2).fill(0x8a8fb0)
            }
          })
        }
        drawWorklist()
        const screens = (read?.screens ?? []).map(([x, y, w, h], i) => {
          const g = new PIXI.Graphics()
          deco.addChild(g)
          return { x, y, w, h, g, frame: i % 4, nextAt: between(800, 3000), pace: between(1500, 4000), lit: false }
        })
        const drawScreen = (s: (typeof screens)[number]) => {
          const g = s.g
          g.clear()
          const ix = s.x + 1, iy = s.y + 1, iw = s.w - 2, ih = s.h - 2
          if (iw < 3 || ih < 3) return
          const lite = s.lit ? 0x2c3260 : 0x1d2038
          g.rect(ix, iy, iw, ih).fill(lite)
          const fg = s.lit ? 0xffffff : 0xc8ccd8
          switch (s.frame) {
            case 0: // an image of a scan
              g.ellipse(ix + iw / 2, iy + ih / 2, Math.max(1, iw / 2 - 1), Math.max(1, ih / 2 - 1)).fill(fg)
              g.ellipse(ix + iw / 2, iy + ih / 2, Math.max(1, iw / 5), Math.max(1, ih / 5)).fill(0x7a7f99)
              break
            case 1: // the same scan, another slice
              g.ellipse(ix + iw / 2, iy + ih / 2, Math.max(1, iw / 2 - 2), Math.max(1, ih / 2 - 1)).fill(fg)
              g.ellipse(ix + iw / 2 + 1, iy + ih / 2 - 1, Math.max(1, iw / 4), Math.max(1, ih / 4)).fill(0x7a7f99)
              break
            case 2: // a list of studies
              for (let r = 0; r < ih - 1; r += 2) g.rect(ix + 1, iy + r + 1, Math.max(1, Math.round((iw - 2) * (0.4 + ((r * 29) % 50) / 100))), 1).fill(r % 4 ? 0x64c0e1 : fg)
              break
            default: // a report being typed
              for (let r = 0; r < Math.floor(ih / 2); r++) g.rect(ix + 1, iy + 1 + r * 2, r === Math.floor(ih / 2) - 1 ? Math.max(1, iw / 3) : iw - 2, 1).fill(fg)
          }
        }
        screens.forEach(drawScreen)
        setNightRef.current = (night) => { bg.texture = night ? nightTex : dayTex }

        const people = new PIXI.Container()
        people.sortableChildren = true
        world.addChild(people)
        const frames = new Map<string, InstanceType<typeof PIXI.Texture>>()
        const sheets = new Map<string, InstanceType<typeof PIXI.Texture>>()
        const youVariant = me ? avatarIndex(me.avatar) : 0
        const frame = (key: string, facing: Facing, step: number) => {
          const k = `${key}:${facing}:${step}`
          let t = frames.get(k)
          if (!t) {
            if (key === 'you') {
              t = new PIXI.Texture({ source: sheet.source, frame: new PIXI.Rectangle((FACE_COL[facing] * 3 + step) * 16, youVariant * 16, 16, 16) })
            } else {
              let b = sheets.get(key)
              if (!b) { b = PIXI.Texture.from(spriteSheet(key, looks.get(key)!)); sheets.set(key, b) }
              t = new PIXI.Texture({ source: b.source, frame: new PIXI.Rectangle((FACE_COL[facing] * 3 + step) * 16, 0, 16, 16) })
            }
            frames.set(k, t)
          }
          return t
        }
        const sprites = actorsRef.current.map((a) => {
          const shadow = new PIXI.Graphics().ellipse(8, 15, 5, 1.5).fill({ color: 0x281e3c, alpha: 0.28 })
          const sp = new PIXI.Sprite(frame(a.key, a.facing, 0))
          const c = new PIXI.Container()
          c.addChild(shadow, sp)
          c.x = a.x
          c.y = a.y
          c.zIndex = a.y
          people.addChild(c)
          return { a, c, sp }
        })
        placeTags()
        let t = 0
        const places = placesOf(layout)
        app.ticker.add((tk) => {
          const dt = tk.deltaMS
          t += dt
          const now = wallMs()
          let moved = false
          // Walking: someone sets out every 15 to 45 seconds to a free place, stays 4 to 10, and comes back.
          if (!still) {
            for (const s of sprites) {
              const a = s.a
              if (a.you || a.path.length || meetingRef.current.includes(a.key) || now < a.holdUntil || t < a.nextAt) continue
              if (a.away) { a.away = null; a.nextAt = t + between(15_000, 45_000); continue }
              const walkers = sprites.filter((x) => x.a.path.length).length
              if (walkers >= 3) { a.nextAt = t + 3000; continue }
              const taken = new Set(sprites.map((x) => { const p = targetOf(x.a, layout, meetingRef.current); return `${p[0]},${p[1]}` }))
              const free = places.filter((p) => !taken.has(`${p[0]},${p[1]}`))
              if (free.length) { a.away = free[Math.floor(chance() * free.length)]!; a.nextAt = t + 5000 + between(4000, 10_000) }
              else a.nextAt = t + between(15_000, 45_000)
            }
          }
          for (const s of sprites) {
            const a = s.a
            steer(a, layout, still)
            const hop = a.hopAt && now - a.hopAt < 260 ? -Math.round(Math.sin(((now - a.hopAt) / 260) * Math.PI) * 3) : 0
            if (hop === 0 && a.hopAt && now - a.hopAt >= 260) a.hopAt = 0
            if (still) { s.c.x = a.x; s.c.y = a.y; s.c.zIndex = a.y; s.sp.texture = frame(a.key, a.facing, 0); s.sp.y = 0; moved = true; continue }
            if (a.path.length) {
              const [tx, ty] = a.path[0]!
              const sp = 0.04 * dt // 40 px per second
              const dx = tx - a.x, dy = ty - a.y
              if (Math.abs(dx) > 0.01) { a.facing = dx > 0 ? 'right' : 'left'; a.x += Math.sign(dx) * Math.min(Math.abs(dx), sp) }
              else if (Math.abs(dy) > 0.01) { a.facing = dy > 0 ? 'front' : 'back'; a.y += Math.sign(dy) * Math.min(Math.abs(dy), sp) }
              if (Math.abs(tx - a.x) < 0.01 && Math.abs(ty - a.y) < 0.01) {
                a.x = tx
                a.y = ty
                a.path.shift()
                if (!a.path.length) a.facing = targetOf(a, layout, meetingRef.current)[2]
              }
              s.sp.texture = frame(a.key, a.facing, a.path.length ? 1 + (Math.floor(t / 160) % 2) : 0)
              s.c.x = Math.round(a.x)
              s.c.y = Math.round(a.y)
              s.c.zIndex = s.c.y
              moved = true
            } else if (s.sp.texture !== frame(a.key, a.facing, 0)) {
              s.sp.texture = frame(a.key, a.facing, 0)
            }
            if (s.sp.y !== hop) { s.sp.y = hop; moved = true }
          }
          if (!still) {
            if (worklist) {
              if (t > worklist.nextAt) { worklist.target += ROW_H; worklist.nextAt = t + between(2000, 4000) }
              if (worklist.off < worklist.target) { worklist.off = Math.min(worklist.target, worklist.off + dt * 0.02); drawWorklist() }
            }
            for (const s of screens) {
              const lit = sprites.some((x) => Math.abs(x.a.x + 8 - (s.x + s.w / 2)) < 12 && x.a.y > s.y && x.a.y - s.y < 30)
              if (t > s.nextAt || lit !== s.lit) {
                if (t > s.nextAt) { s.frame = (s.frame + 1) % 4; s.nextAt = t + s.pace }
                s.lit = lit
                drawScreen(s)
              }
            }
          }
          if (moved) placeTags()
        })
        const onVis = () => (document.hidden ? app.ticker.stop() : app.ticker.start())
        document.addEventListener('visibilitychange', onVis)
        cleanup = () => {
          document.removeEventListener('visibilitychange', onVis)
          setNightRef.current = null
          app.destroy(true, { children: true })
        }
      } catch {
        if (!destroyed) setFallback(true)
      }
    })()
    return () => {
      destroyed = true
      cleanup()
    }
    // The scene is rebuilt when its size or its people change, not on a theme change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, width, fallback, base, scale, viewW, viewH, offsetX, offsetY, castKey, me?.avatar])

  useEffect(() => { setNightRef.current?.(theme === 'dark') }, [theme])

  // Without the canvas, people stand at their places and the tags follow.
  const meetingKey = meeting.join(',')
  useEffect(() => {
    if (!layout || !(fallback || !actorsRef.current.length)) return
    if (!actorsRef.current.length) actorsRef.current = castActors(layout, cast, me, false)
    for (const a of actorsRef.current) steer(a, layout, true)
    setFrame((n) => n + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, fallback, meetingKey])
  useEffect(() => { placeTags() })

  const actors = layout ? (actorsRef.current.length ? actorsRef.current : castActors(layout, cast, me, false)) : []
  // The bubble on show: an interview or dialogue line first, else the head of the queue.
  const shown: { key: string; text: string } | null = bubble ? { key: bubble.speaker, text: bubble.text } : line
  const shownPerson = shown ? cast.find((c) => c.id === shown.key) : undefined
  const shownIdx = shownPerson ? cast.indexOf(shownPerson) : 0
  const sheetUrls = useMemo(() => new Map(cast.map((c) => [c.id, fallback ? spriteSheet(c.id, looks.get(c.id)!).toDataURL() : ''])), [cast, looks, fallback])
  const band = theme === 'dark' ? bands.night : bands.day
  return (
    <div ref={host} className="room" role="group" aria-label={label} style={{ position: 'relative', width: '100%', height: viewH || undefined, overflow: 'hidden', background: band?.fill ?? 'var(--inset)' }}>
      {band && offsetX > 0 && (['left', 'right'] as const).map((side) => (
        <div key={side} className="px room-band" aria-hidden="true" style={{
          position: 'absolute', top: offsetY, height: rh * scale, ...(side === 'left' ? { left: 0, width: offsetX } : { right: 0, width: viewW - offsetX - rw * scale }),
          backgroundImage: `url(${band.url})`, backgroundSize: '200% 100%', backgroundPosition: side === 'left' ? '0 0' : '100% 0', backgroundRepeat: 'no-repeat', imageRendering: 'pixelated',
        }} />
      ))}
      {fallback || !layout ? (
        layout && (
          <div style={{ position: 'absolute', left: offsetX, top: offsetY, width: rw * scale, height: rh * scale }}>
            <img className="px" src={`${base}room_${theme === 'dark' ? 'night' : 'day'}.png`} alt="" style={{ width: '100%', height: '100%', display: 'block' }}
              onLoad={() => host.current?.setAttribute('data-ready', 'still')} />
            {actors.map((a) => (
              <span key={a.key} className="px" style={{
                position: 'absolute', left: a.x * scale, top: a.y * scale, width: 16 * scale, height: 16 * scale, imageRendering: 'pixelated',
                ...(a.you
                  ? { backgroundImage: 'url(/art/sprites.png)', backgroundSize: `${12 * 16 * scale}px ${VARIANTS * 16 * scale}px`, backgroundPosition: `${-FACE_COL[a.facing] * 3 * 16 * scale}px ${-(me ? avatarIndex(me.avatar) : 0) * 16 * scale}px` }
                  : { backgroundImage: `url(${sheetUrls.get(a.key)})`, backgroundSize: `${12 * 16 * scale}px ${16 * scale}px`, backgroundPosition: `${-FACE_COL[a.facing] * 3 * 16 * scale}px 0` }),
              }} />
            ))}
          </div>
        )
      ) : (
        <div className="room-canvas" style={{ position: 'absolute', inset: 0 }} aria-hidden="true" />
      )}
      <div ref={tagsRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        {actors.map((a) => {
          const [x, y] = screenPos(a)
          if (a.you) return <span key={a.key} data-k={a.key} aria-hidden="true" className="tag you" style={{ position: 'absolute', left: 0, top: 0, transform: `translate(${x}px, ${y}px) translate(-50%, -100%)` }}>You</span>
          const c = cast.find((p) => p.id === a.key)
          if (!c) return null
          const canPick = available.includes(a.key) && !!onPick
          return [
            <button key={`${a.key}-hit`} data-k={a.key} data-role="hit" type="button" className={`person${canPick ? ' pickable' : ''}`}
              aria-label={canPick ? `Interview ${c.name}, ${c.role}` : `${c.name}, ${c.role}`} title={`${c.name}, ${c.role}`}
              onClick={() => clickPerson(c)}
              style={{ position: 'absolute', left: 0, top: 0, width: 16 * scale, height: 17 * scale, pointerEvents: 'auto', transform: `translate(${x - 8 * scale}px, ${y - scale}px)` }} />,
            canPick ? <span key={`${a.key}-mark`} data-k={a.key} aria-hidden="true" className="mark" style={{ position: 'absolute', left: 0, top: 0, transform: `translate(${x}px, ${y}px) translate(-50%, -100%)` }}>!</span> : null,
          ]
        })}
        {shown && (
          <div key={`${shown.key}:${shown.text}`} data-k={shown.key} data-role="say" className="bubble say-bubble" role="status">
            {shownPerson && <Portrait c={shownPerson} cast={cast} index={shownIdx} size={28} />}
            <span>{shownPerson && <b>{firstName(shownPerson.name)} </b>}{shown.text}</span>
          </div>
        )}
      </div>
    </div>
  )
}
