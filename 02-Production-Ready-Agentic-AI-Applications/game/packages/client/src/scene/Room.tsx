// The reading room (engineering spec, section 10.3): one PixiJS canvas, drawn at 320 x 180 with
// 16 px tiles and shown at a whole-number scale. The browser animates it; the server sends no
// positions. It never gates play. Without WebGL a still image with HTML characters takes its place.
import { useEffect, useRef, useState } from 'react'
import type { AvatarId, Character, PackArt } from '@lab02/protocol'
import { initials } from '../components/ui.tsx'

type Facing = 'front' | 'back' | 'left' | 'right'
type Point = [number, number, Facing]
export type SceneLayout = {
  size: [number, number]
  posts: Point[]
  table: { seats: Point[]; you: Point }
  you: Point
  door: [number, number]
  ambient: Point[]
  board: [number, number, number, number] | null
}

const FACE_COL: Record<Facing, number> = { front: 0, back: 1, left: 2, right: 3 }
const VARIANTS = 12

function hash32(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

function avatarIndex(id: string): number {
  const n = Number(id.replace(/\D/g, ''))
  return Number.isFinite(n) && n >= 1 ? (n - 1) % VARIANTS : 0
}

type Actor = {
  key: string
  variant: number
  x: number
  y: number
  facing: Facing
  tag: string | null
  you: boolean
  path: [number, number][]
}

function reducedMotion(): boolean {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
}

/** Places the cast, the ambient people and the player's own character on the layout. */
function castActors(layout: SceneLayout, cast: Character[], me: { avatar: AvatarId } | null, walkIn: boolean): Actor[] {
  const meVariant = me ? avatarIndex(me.avatar) : -1
  const actors: Actor[] = []
  cast.slice(0, layout.posts.length).forEach((c, i) => {
    const [x, y, f] = layout.posts[i]!
    let v = hash32(c.id) % VARIANTS
    if (v === meVariant) v = (v + 1) % VARIANTS
    actors.push({ key: c.id, variant: v, x, y, facing: f, tag: initials(c.name), you: false, path: [] })
  })
  layout.ambient.forEach(([x, y, f], i) => {
    actors.push({ key: `amb${i}`, variant: (i * 5 + 3) % VARIANTS, x, y, facing: f, tag: null, you: false, path: [] })
  })
  if (me) {
    const [tx, ty, tf] = layout.you
    const start = walkIn && !reducedMotion() ? [layout.door[0] - 8, layout.door[1] - 16] as [number, number] : [tx, ty] as [number, number]
    const a: Actor = { key: 'you', variant: meVariant, x: start[0], y: start[1], facing: tf, tag: 'You', you: true, path: [] }
    if (start[0] !== tx || start[1] !== ty) a.path = [[start[0], ty], [tx, ty]]
    actors.push(a)
  }
  return actors
}

export type RoomProps = {
  art: PackArt | null
  cast: Character[]
  me: { avatar: AvatarId } | null
  theme: 'light' | 'dark'
  maxHeight?: number
  focusX?: number
  label?: string
}

export function Room({ art, cast, me, theme, maxHeight = 540, focusX = 160, label = 'The reading room' }: RoomProps) {
  const host = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [layout, setLayout] = useState<SceneLayout | null>(null)
  const [fallback, setFallback] = useState(false)
  const base = art?.room ? `${art.base}room/` : '/art/room/'
  const tagsRef = useRef<HTMLDivElement>(null)
  const actorsRef = useRef<Actor[]>([])
  const setNightRef = useRef<((night: boolean) => void) | null>(null)

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
  const viewH = rh * scale
  const offsetX = rw * scale > viewW ? Math.round(Math.max(viewW - rw * scale, Math.min(0, viewW / 2 - focusX * scale))) : 0

  // Positions the HTML tags over the characters.
  const placeTags = () => {
    const box = tagsRef.current
    if (!box) return
    for (const a of actorsRef.current) {
      const el = box.querySelector<HTMLElement>(`[data-k="${a.key}"]`)
      if (!el) continue
      el.style.transform = `translate(${Math.round(offsetX + (a.x + 8) * scale)}px, ${Math.round((a.y - 2) * scale)}px) translate(-50%, -100%)`
    }
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
        host.current?.setAttribute('data-ready', 'scene')
        const world = new PIXI.Container()
        world.scale.set(scale)
        world.x = offsetX
        app.stage.addChild(world)
        const bg = new PIXI.Sprite(theme === 'dark' ? nightTex : dayTex)
        world.addChild(bg)
        setNightRef.current = (night) => { bg.texture = night ? nightTex : dayTex }
        const people = new PIXI.Container()
        people.sortableChildren = true
        world.addChild(people)
        const frames = new Map<string, InstanceType<typeof PIXI.Texture>>()
        const frame = (variant: number, facing: Facing, step: number) => {
          const k = `${variant}:${facing}:${step}`
          let t = frames.get(k)
          if (!t) {
            t = new PIXI.Texture({ source: sheet.source, frame: new PIXI.Rectangle((FACE_COL[facing] * 3 + step) * 16, variant * 16, 16, 16) })
            frames.set(k, t)
          }
          return t
        }
        const sprites = actorsRef.current.map((a) => {
          const shadow = new PIXI.Graphics().ellipse(8, 15, 5, 1.5).fill({ color: 0x281e3c, alpha: 0.28 })
          const sp = new PIXI.Sprite(frame(a.variant, a.facing, 0))
          const c = new PIXI.Container()
          c.addChild(shadow, sp)
          c.x = a.x
          c.y = a.y
          c.zIndex = a.y
          people.addChild(c)
          return { a, c, sp }
        })
        placeTags()
        const still = reducedMotion()
        let t = 0
        let nextTurn = 2500
        app.ticker.add((tk) => {
          const dt = tk.deltaMS
          t += dt
          let moved = false
          for (const s of sprites) {
            const a = s.a
            if (a.path.length) {
              const [tx, ty] = a.path[0]!
              const sp = 0.03 * dt // 30 px per second
              const dx = tx - a.x, dy = ty - a.y
              if (Math.abs(dx) > 0.01) { a.facing = dx > 0 ? 'right' : 'left'; a.x += Math.sign(dx) * Math.min(Math.abs(dx), sp) }
              else if (Math.abs(dy) > 0.01) { a.facing = dy > 0 ? 'front' : 'back'; a.y += Math.sign(dy) * Math.min(Math.abs(dy), sp) }
              if (Math.abs(tx - a.x) < 0.01 && Math.abs(ty - a.y) < 0.01) {
                a.path.shift()
                if (!a.path.length && a.you) a.facing = 'front'
              }
              s.sp.texture = frame(a.variant, a.facing, a.path.length ? 1 + (Math.floor(t / 160) % 2) : 0)
              s.c.x = Math.round(a.x)
              s.c.y = Math.round(a.y)
              s.c.zIndex = s.c.y
              moved = true
            }
          }
          if (!still && t > nextTurn) {
            // Idle life: someone looks around now and then.
            nextTurn = t + 1800 + ((t * 7919) % 2400)
            const idle = sprites.filter((s) => !s.a.path.length && !s.a.you)
            if (idle.length) {
              const s = idle[Math.floor(t / 7) % idle.length]!
              const order: Facing[] = ['front', 'left', 'right', 'front', 'back']
              s.a.facing = order[Math.floor(t / 13) % order.length]!
              s.sp.texture = frame(s.a.variant, s.a.facing, 0)
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
  }, [layout, width, fallback, base, scale, viewW, viewH, offsetX, cast.map((c) => c.id).join(','), me?.avatar])

  useEffect(() => { setNightRef.current?.(theme === 'dark') }, [theme])

  const actors = layout ? (actorsRef.current.length ? actorsRef.current : castActors(layout, cast, me, false)) : []
  return (
    <div ref={host} className="room" role="img" aria-label={label} style={{ position: 'relative', width: '100%', height: viewH || undefined, overflow: 'hidden', background: 'var(--inset)' }}>
      {fallback || !layout ? (
        layout && (
          <div style={{ position: 'absolute', left: offsetX, top: 0, width: rw * scale, height: rh * scale }}>
            <img className="px" src={`${base}room_${theme === 'dark' ? 'night' : 'day'}.png`} alt="" style={{ width: '100%', height: '100%', display: 'block' }}
              onLoad={() => host.current?.setAttribute('data-ready', 'still')} />
            {actors.map((a) => (
              <span key={a.key} className="px" style={{
                position: 'absolute', left: a.x * scale, top: a.y * scale, width: 16 * scale, height: 16 * scale,
                backgroundImage: 'url(/art/sprites.png)', backgroundSize: `${12 * 16 * scale}px ${VARIANTS * 16 * scale}px`,
                backgroundPosition: `${-FACE_COL[a.facing] * 3 * 16 * scale}px ${-a.variant * 16 * scale}px`, imageRendering: 'pixelated',
              }} />
            ))}
          </div>
        )
      ) : (
        <div className="room-canvas" style={{ position: 'absolute', inset: 0 }} />
      )}
      <div ref={tagsRef} aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        {actors.filter((a) => a.tag).map((a) => (
          <span key={a.key} data-k={a.key} className={`tag${a.you ? ' you' : ''}`} style={{
            position: 'absolute', left: 0, top: 0,
            transform: `translate(${Math.round(offsetX + (a.x + 8) * scale)}px, ${Math.round((a.y - 2) * scale)}px) translate(-50%, -100%)`,
          }}>{a.tag}</span>
        ))}
      </div>
    </div>
  )
}
