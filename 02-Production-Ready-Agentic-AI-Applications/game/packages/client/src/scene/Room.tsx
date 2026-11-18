// The practice scene (engineering spec, section 10.3): one PixiJS canvas, drawn at 320 x 180 and
// shown at a whole-number scale. The browser animates it; the server sends no positions, and it
// never gates play. Without WebGL a still image with the same people takes its place.
//
// The scene lives: people walk between places on the floor, the worklist on the wall scrolls, the
// monitors change, and now and then two or three people trade lines from the banter of the
// story. A click on a person turns them to face the player, with one of their lines. In Phase 1 a
// person with an interview to give carries a marker, and a click starts the interview; while it
// runs they sit at the table with the player's own character. With reduced motion nobody walks
// and the screens stay still; the bubbles and the clicks still work.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AvatarId, Character, PackArt, SystemPublic } from '@lab02/protocol'
import { looksOf } from '../components/ui.tsx'
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
  /** Optional: monitor screens [x, y, w, h]. Without them the scene finds the screens itself. */
  monitors?: [number, number, number, number][]
}

const VARIANTS = 12
const CELL = 4

function avatarIndex(id: string): number {
  const n = Number(id.replace(/\D/g, ''))
  return Number.isFinite(n) && n >= 1 ? (n - 1) % VARIANTS : 0
}

// Wall time and chance for the animation only. The scene never feeds anything back to the game.
const wallMs = () => performance.now()
const chance = () => Math.random()

function reducedMotion(): boolean {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
}

type Actor = {
  key: string
  x: number
  y: number
  facing: Facing
  home: Point
  you: boolean
  path: [number, number][]
  /** Where the person stands while not at home, or null. */
  away: Point | null
  /** Game of idle life: when the person may next turn or walk, and until when they hold still. */
  nextAt: number
  holdUntil: number
}

// ------------------------------------------------------------------------------------------
// The floor: which 4 x 4 cells a person may stand on, read from the room image itself
// ------------------------------------------------------------------------------------------
type Floor = { w: number; h: number; ok: Uint8Array }

function readFloor(img: HTMLImageElement, layout: SceneLayout): { floor: Floor; screens: [number, number, number, number][]; boardBg: number | null } | null {
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
  // Step from the spot onto the floor along one axis, then follow the cells, keeping the turns.
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

/** Places the people of the practice and the player's own character on the layout. */
function castActors(layout: SceneLayout, cast: Character[], me: { avatar: AvatarId } | null, walkIn: boolean): Actor[] {
  const spots = [...layout.posts, ...layout.ambient]
  const actors: Actor[] = cast.slice(0, spots.length).map((c, i) => {
    const home = spots[i]!
    return { key: c.id, x: home[0], y: home[1], facing: home[2], home, you: false, path: [], away: null, nextAt: 4000 + i * 2300, holdUntil: 0 }
  })
  if (me) {
    const home = layout.you
    const start = walkIn && !reducedMotion() ? [layout.door[0] - 8, layout.door[1] - 16] as [number, number] : [home[0], home[1]] as [number, number]
    const a: Actor = { key: 'you', x: start[0], y: start[1], facing: home[2], home, you: true, path: [], away: null, nextAt: Infinity, holdUntil: 0 }
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

type Said = { key: string; text: string; until: number }

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
  /** The interview line being said now, shown at the top of the scene with its speaker's name. */
  bubble?: { speaker: string; text: string } | null
  /** Characters who have an interview to give: they carry a marker and a click starts it. */
  available?: string[]
  onPick?: (characterId: string) => void
}

const LINE_MS = 3400
const BANTER_GAP: [number, number] = [14_000, 26_000]

export function Room({
  art, cast, banter = [], me, theme, maxHeight = 540, cropHeight, focusX = 160, focusY = 100, label = 'Your practice',
  meeting = [], bubble = null, available = [], onPick,
}: RoomProps) {
  const host = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [layout, setLayout] = useState<SceneLayout | null>(null)
  const [fallback, setFallback] = useState(false)
  const base = art?.room ? `${art.base}room/` : '/art/room/'
  const tagsRef = useRef<HTMLDivElement>(null)
  const actorsRef = useRef<Actor[]>([])
  const meetingRef = useRef<string[]>(meeting)
  const busyRef = useRef(false)
  const setNightRef = useRef<((night: boolean) => void) | null>(null)
  const [said, setSaid] = useState<Said[]>([])
  const saidRef = useRef<Said[]>([])
  const clickN = useRef(new Map<string, number>())
  const [, setFrame] = useState(0)
  meetingRef.current = meeting
  busyRef.current = meeting.length > 0 || !!bubble
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

  useEffect(() => {
    let live = true
    fetch(`${base}scene.json`).then((r) => r.json()).then((j: SceneLayout) => { if (live) setLayout(j) }).catch(() => setFallback(true))
    return () => { live = false }
  }, [base])

  const [rw, rh] = layout?.size ?? [320, 180]
  const fitW = Math.floor(width / rw)
  let scale = Math.max(width < 640 ? 2 : 1, fitW)
  scale = Math.max(1, Math.min(scale, Math.floor(maxHeight / rh)))
  const viewW = Math.min(width, rw * scale)
  const viewH = Math.min(rh * scale, cropHeight ?? rh * scale)
  const offsetX = rw * scale > viewW ? Math.round(Math.max(viewW - rw * scale, Math.min(0, viewW / 2 - focusX * scale))) : Math.floor((width - rw * scale) / 2)
  const offsetY = rh * scale > viewH ? Math.round(Math.max(viewH - rh * scale, Math.min(0, viewH / 2 - focusY * scale))) : 0

  const screenPos = (a: { x: number; y: number }) => [Math.round(offsetX + (a.x + 8) * scale), Math.round(offsetY + (a.y + 1) * scale)] as const

  // Positions the hit areas, the markers and the bubbles over the people.
  const placeTags = () => {
    const box = tagsRef.current
    if (!box) return
    for (const a of actorsRef.current) {
      const [x, y] = screenPos(a)
      for (const el of box.querySelectorAll<HTMLElement>(`[data-k="${a.key}"]`)) {
        if (el.dataset.role === 'say') {
          // A bubble stays inside the scene.
          const half = el.offsetWidth / 2
          const left = Math.max(half + 4, Math.min(viewW - half - 4, x))
          el.style.transform = `translate(${left}px, ${y}px) translate(-50%, -100%)`
          el.style.setProperty('--tail', `${Math.round(x - left + half)}px`)
        } else if (el.dataset.role === 'hit') el.style.transform = `translate(${x - 8 * scale}px, ${y - scale}px)`
        else el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`
      }
    }
  }

  const say = (key: string, text: string, ms = LINE_MS) => {
    const until = wallMs() + ms
    saidRef.current = [...saidRef.current.filter((s) => s.key !== key && s.until > wallMs()), { key, text, until }]
    setSaid(saidRef.current)
    setTimeout(() => { saidRef.current = saidRef.current.filter((s) => s.until > wallMs()); setSaid(saidRef.current) }, ms + 30)
  }

  // A click on a person: they turn to the player and say one of their lines.
  const clickPerson = (c: Character) => {
    if (available.includes(c.id) && onPick) { onPick(c.id); return }
    const a = actorsRef.current.find((x) => x.key === c.id)
    if (a) { a.facing = 'front'; a.holdUntil = wallMs() + LINE_MS + 600 }
    const lines = c.clickLines
    if (!lines.length) return
    const n = clickN.current.get(c.id) ?? 0
    clickN.current.set(c.id, n + 1)
    say(c.id, lines[n % lines.length]!)
    setFrame((f) => f + 1)
  }

  // Banter: one exchange at a time, among people who are in the room and not in an interview.
  const banterKey = banter.map((b) => b.id).join(',')
  useEffect(() => {
    if (!banter.length) return
    let stop = false
    let timer: ReturnType<typeof setTimeout>
    let order = [...banter].sort(() => chance() - 0.5)
    let k = 0
    const schedule = (ms: number) => { timer = setTimeout(run, ms) }
    const run = () => {
      if (stop) return
      if (busyRef.current || document.hidden) return schedule(5000)
      if (k >= order.length) { order = [...banter].sort(() => chance() - 0.5); k = 0 }
      const ex = order[k++]!
      const here = new Set(actorsRef.current.map((a) => a.key))
      if (!ex.lines.every((l) => here.has(l.speaker) && !meetingRef.current.includes(l.speaker))) return schedule(2000)
      // The speakers turn to each other.
      const speakers = [...new Set(ex.lines.map((l) => l.speaker))].map((id) => actorsRef.current.find((a) => a.key === id)!)
      const cx = speakers.reduce((n, a) => n + a.x, 0) / speakers.length
      for (const a of speakers) { if (!a.path.length) a.facing = a.x < cx - 2 ? 'right' : a.x > cx + 2 ? 'left' : 'front'; a.holdUntil = wallMs() + ex.lines.length * (LINE_MS + 500) }
      ex.lines.forEach((l, i) => setTimeout(() => { if (!stop) say(l.speaker, l.text) }, i * (LINE_MS + 500)))
      schedule(ex.lines.length * (LINE_MS + 500) + BANTER_GAP[0] + chance() * (BANTER_GAP[1] - BANTER_GAP[0]))
    }
    schedule(6000 + chance() * 4000)
    return () => { stop = true; clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [banterKey])

  // Walks a person to where they should be.
  const floorRef = useRef<Floor | null>(null)
  const steer = (a: Actor, lay: SceneLayout, still: boolean) => {
    const [tx, ty, tf] = targetOf(a, lay, meetingRef.current)
    const end = a.path.at(-1)
    if (end ? end[0] === tx && end[1] === ty : a.x === tx && a.y === ty) {
      if (!a.path.length && wallMs() > a.holdUntil && !a.away) a.facing = tf
      return
    }
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
        const read = img.complete ? readFloor(img, layout) : null
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

        // The worklist on the wall scrolls; the monitors change.
        const deco = new PIXI.Container()
        world.addChild(deco)
        const board = layout.board
        let worklist: { g: InstanceType<typeof PIXI.Graphics>; off: number; rows: { w: number; c: number; flag: boolean }[] } | null = null
        const ROWC = [0xff7171, 0xffb83f, 0x3fc8a1, 0x4fb6e6, 0x3fc8a1, 0xa99ad6]
        if (board && read) {
          const [bx, by, bw, bh] = board
          const g = new PIXI.Graphics()
          const mask = new PIXI.Graphics().rect(bx + 3, by + 3, bw - 6, bh - 6).fill(0xffffff)
          g.mask = mask
          deco.addChild(mask, g)
          worklist = { g, off: 0, rows: Array.from({ length: 12 }, (_, i) => ({ w: 0.3 + ((i * 37) % 60) / 100, c: ROWC[i % ROWC.length]!, flag: i % 3 === 0 })) }
        }
        const drawWorklist = () => {
          if (!worklist || !board) return
          const [bx, by, bw, bh] = board
          const g = worklist.g
          g.clear()
          g.rect(bx + 3, by + 3, bw - 6, bh - 6).fill(read?.boardBg ?? 0x25283d)
          const rowH = 4
          const inner = bw - 18
          worklist.rows.forEach((r, i) => {
            const y = by + 4 + i * rowH - (worklist!.off % (rowH * worklist!.rows.length))
            for (const yy of [y, y + rowH * worklist!.rows.length]) {
              if (yy < by + 1 || yy > by + bh - 3) continue
              g.rect(bx + 5, yy, Math.round(inner * r.w), 2).fill(r.c)
              g.rect(bx + bw - 12, yy, 7, 2).fill(r.flag ? 0xffffff : 0x8a8fb0)
            }
          })
        }
        drawWorklist()
        const screens = (read?.screens ?? []).map(([x, y, w, h], i) => {
          const g = new PIXI.Graphics()
          deco.addChild(g)
          return { x, y, w, h, g, mode: i % 3, nextAt: 800 + i * 450 }
        })
        const drawScreen = (s: (typeof screens)[number], t: number) => {
          const g = s.g
          g.clear()
          const ix = s.x + 1, iy = s.y + 1, iw = s.w - 2, ih = s.h - 2
          if (iw < 3 || ih < 3) return
          g.rect(ix, iy, iw, ih).fill(0x1d2038)
          const phase = Math.floor(t / 400)
          if (s.mode === 0) {
            // An image of a scan: a grey round shape.
            g.ellipse(ix + iw / 2, iy + ih / 2, Math.max(1, iw / 2 - 1), Math.max(1, ih / 2 - 1)).fill(0xc8ccd8)
            g.ellipse(ix + iw / 2 + ((phase % 3) - 1), iy + ih / 2, Math.max(1, iw / 5), Math.max(1, ih / 5)).fill(0x7a7f99)
          } else if (s.mode === 1) {
            // A list of studies.
            for (let r = 0; r < ih - 1; r += 2) g.rect(ix + 1, iy + r + 1, Math.max(1, Math.round((iw - 2) * (0.4 + (((r + phase) * 29) % 50) / 100))), 1).fill(r % 4 ? 0x64c0e1 : 0xe6eef8)
          } else {
            // A report being typed.
            const lines = 1 + (phase % Math.max(1, Math.floor(ih / 2)))
            for (let r = 0; r < lines; r++) g.rect(ix + 1, iy + 1 + r * 2, r === lines - 1 ? Math.max(1, (phase * 2) % (iw - 1)) : iw - 2, 1).fill(0xe6eef8)
          }
        }
        screens.forEach((s) => drawScreen(s, 0))
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
              let base = sheets.get(key)
              if (!base) { base = PIXI.Texture.from(spriteSheet(key, looks.get(key)!)); sheets.set(key, base) }
              t = new PIXI.Texture({ source: base.source, frame: new PIXI.Rectangle((FACE_COL[facing] * 3 + step) * 16, 0, 16, 16) })
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
        let lastScroll = 0
        const places = [...layout.posts, ...layout.ambient]
        app.ticker.add((tk) => {
          const dt = tk.deltaMS
          t += dt
          const now = wallMs()
          let moved = false
          // Idle life: now and then someone turns, or walks to another place and back.
          if (!still) {
            for (const s of sprites) {
              const a = s.a
              if (a.you || a.path.length || meetingRef.current.includes(a.key) || now < a.holdUntil || t < a.nextAt) continue
              a.nextAt = t + 7000 + chance() * 12_000
              const walkers = sprites.filter((x) => x.a.path.length).length
              if (a.away) { a.away = null; continue }
              if (walkers < 2 && chance() < 0.45) {
                const taken = new Set(sprites.map((x) => { const p = targetOf(x.a, layout, meetingRef.current); return `${p[0]},${p[1]}` }))
                const free = places.filter((p) => !taken.has(`${p[0]},${p[1]}`))
                if (free.length) { a.away = free[Math.floor(chance() * free.length)]!; a.nextAt = t + 9000 + chance() * 9000; continue }
              }
              const order: Facing[] = ['front', 'left', 'right', 'back']
              a.facing = order[Math.floor(chance() * order.length)]!
              a.holdUntil = now + 1500
            }
          }
          for (const s of sprites) {
            const a = s.a
            steer(a, layout, still)
            if (still) { s.c.x = a.x; s.c.y = a.y; s.c.zIndex = a.y; s.sp.texture = frame(a.key, a.facing, 0); moved = true; continue }
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
          }
          if (!still) {
            if (worklist && t - lastScroll > 140) { worklist.off++; lastScroll = t; drawWorklist() }
            for (const s of screens) if (t > s.nextAt) { s.nextAt = t + 1400 + chance() * 2600; if (chance() < 0.25) s.mode = (s.mode + 1) % 3; drawScreen(s, t) }
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
  const speaker = bubble ? cast.find((c) => c.id === bubble.speaker) : undefined
  const sheetUrls = useMemo(() => new Map(cast.map((c) => [c.id, fallback ? spriteSheet(c.id, looks.get(c.id)!).toDataURL() : ''])), [cast, looks, fallback])
  return (
    <div ref={host} className="room" role="group" aria-label={label} style={{ position: 'relative', width: '100%', height: viewH || undefined, overflow: 'hidden', background: 'var(--inset)' }}>
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
          const c = cast.find((x) => x.id === a.key)
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
        {said.map((s) => {
          const c = cast.find((x) => x.id === s.key)
          return (
            <div key={`${s.key}:${s.text}`} data-k={s.key} data-role="say" className="bubble say-bubble" role="status">
              {c && <b>{c.name.split(',')[0]}</b>}{s.text}
            </div>
          )
        })}
        {bubble && (
          <div key={bubble.text} className="bubble scene-bubble" aria-hidden="true">
            <b>{speaker ? speaker.name.split(',')[0] : ''}:</b> {bubble.text}
          </div>
        )}
      </div>
    </div>
  )
}
