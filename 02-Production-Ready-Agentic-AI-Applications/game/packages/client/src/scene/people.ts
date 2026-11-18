// Pixel characters for the people of a practice (engineering spec, section 11.4). Each person's
// sprite is built in the browser from the `look` of characters.yaml: hair, hair style, skin, top
// and one detail, drawn over one body. The portrait is the same sprite seen from the front.
// Nothing here is random: the same look gives the same character on every screen.
import type { Character, Look } from '@lab02/protocol'
import { BODY } from './body.ts'

export type Facing = 'front' | 'back' | 'left' | 'right'
export const FACINGS: Facing[] = ['front', 'back', 'left', 'right']
type RGB = [number, number, number]

const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
const mix = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map((i) => Math.round(a[i]! + (b[i]! - a[i]!) * t)) as RGB
const darker = (c: RGB, t = 0.28): RGB => mix(c, [40, 26, 40], t)
const lighter = (c: RGB, t = 0.3): RGB => mix(c, [255, 250, 240], t)

export function hash32(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

// ------------------------------------------------------------------------------------------
// Reading a look. The words are free, so each part is found by the words it contains.
// ------------------------------------------------------------------------------------------
const COLORS: [RegExp, string][] = [
  [/navy|midnight/, '#2f3f78'], [/royal|cobalt/, '#3b5bc4'], [/sky|light blue|baby blue/, '#7fb6e6'],
  [/teal|turquoise/, '#2f9e9a'], [/mint|seafoam/, '#7fd3b0'], [/olive|khaki/, '#8a8a4a'],
  [/forest|dark green|hunter/, '#2f6b45'], [/lime/, '#9ccc4a'], [/green|scrubs?\b(?!.*(blue|navy|purple|grey|gray))/, '#42a379'],
  [/maroon|burgundy|wine/, '#7d2e3e'], [/coral|salmon/, '#ef7f6b'], [/pink|rose/, '#e889a8'],
  [/lavender|lilac|light purple/, '#a99ad6'], [/purple|violet|plum/, '#7a4fa0'],
  [/mustard|ochre/, '#d1a23a'], [/yellow|gold/, '#f0c64a'], [/orange|rust/, '#e07a3c'],
  [/cream|ivory|beige/, '#e8dcc0'], [/tan|camel/, '#c59a68'], [/brown|chocolate/, '#7a5236'],
  [/charcoal/, '#45464f'], [/grey|gray|silver/, '#9a9cab'], [/black/, '#2e2e36'], [/white/, '#eef0f4'],
  [/red|crimson|scarlet/, '#c2504d'], [/blue|denim/, '#4f78c4'],
]

function colorOf(text: string | undefined, fallback: string): RGB {
  const t = (text ?? '').toLowerCase()
  let c = hex(fallback)
  for (const [re, h] of COLORS) if (re.test(t)) { c = hex(h); break }
  if (/\b(light|pale|pastel)\b/.test(t) && !/light (blue|purple)/.test(t)) c = lighter(c, 0.35)
  if (/\b(dark|deep)\b/.test(t) && !/dark green/.test(t)) c = darker(c, 0.3)
  return c
}

const HAIR: [RegExp, string][] = [
  [/salt|pepper/, '#8c8c94'], [/white|platinum/, '#e6e6ea'], [/silver|grey|gray/, '#a3a3ad'],
  [/auburn|copper/, '#a5482f'], [/ginger|red/, '#c8582e'], [/strawberry/, '#d98a5a'],
  [/platinum|blond|blonde|golden|fair/, '#e8c36a'], [/light brown|sandy/, '#a87a4a'],
  [/dark brown/, '#4e3424'], [/brown|chestnut|brunette/, '#6e4a30'], [/black|jet|dark/, '#2a2630'],
  [/blue/, '#4f78c4'], [/pink/, '#e889a8'], [/purple/, '#7a4fa0'], [/green/, '#42a379'],
]
const SKIN: [RegExp, [string, string]][] = [
  [/very dark|deep|ebony/, ['#6b4430', '#553424']], [/dark|black/, ['#8a5a3c', '#70452e']],
  [/brown/, ['#b07a52', '#966240']], [/tan|olive/, ['#d39a6a', '#b98052']],
  [/medium|warm/, ['#e8ad7d', '#d09264']], [/very light|pale|porcelain/, ['#ffe2c8', '#f4c8a6']],
  [/light|fair/, ['#ffd2a8', '#f1b089']],
]

type Style = 'short' | 'buzz' | 'long' | 'bob' | 'bun' | 'ponytail' | 'braid' | 'curly' | 'bald' | 'covered'
const STYLES: [RegExp, Style][] = [
  [/scarf|hijab|wrap|turban/, 'covered'], [/bald|shaved head|no hair/, 'bald'], [/buzz|crew|shaved|cropped|very short/, 'buzz'],
  [/braid/, 'braid'], [/pony/, 'ponytail'], [/bun|updo|knot/, 'bun'], [/bob|chin/, 'bob'],
  [/curl|afro|coil|wav|voluminous/, 'curly'], [/long|shoulder/, 'long'], [/short|side|neat|swept|spiky|messy/, 'short'],
]

export type Detail = 'glasses' | 'beard' | 'moustache' | 'stethoscope' | 'lanyard' | 'badge' | 'tie' | 'headphones' | 'earrings' | 'scarf' | 'clipboard'
const DETAILS: [RegExp, Detail][] = [
  [/glass|spectacle/, 'glasses'], [/beard|stubble|goatee/, 'beard'], [/moustache|mustache/, 'moustache'],
  [/stethoscope/, 'stethoscope'], [/lanyard/, 'lanyard'], [/badge|name tag/, 'badge'], [/tie\b|bow tie/, 'tie'],
  [/headphone|headset|earbud/, 'headphones'], [/earring/, 'earrings'], [/scarf/, 'scarf'], [/clipboard|tablet|folder/, 'clipboard'],
]

const TROUSERS = ['#3b3f58', '#56565e', '#8a7a5a', '#2e2e36', '#5d4a3a', '#46526e']

export type Parsed = {
  hair: RGB; style: Style; skin: [RGB, RGB]; top: RGB; trousers: RGB
  coat: boolean; scrubs: boolean; open: boolean; details: Detail[]
}

/** The look in parts. A missing word falls back to a choice made from the person's id. */
export function parseLook(id: string, look: Look): Parsed {
  const h = hash32(id)
  const hairText = (look.hair ?? '').toLowerCase()
  const styleText = (look.hairStyle ?? '').toLowerCase()
  const skinText = (look.skin ?? '').toLowerCase()
  const topText = (look.top ?? '').toLowerCase()
  const detailText = `${look.detail ?? ''} ${look.top ?? ''}`.toLowerCase()
  const hairHex = HAIR.find(([re]) => re.test(hairText))?.[1] ?? ['#2a2630', '#6e4a30', '#e8c36a', '#a5482f', '#4e3424'][h % 5]!
  const style = STYLES.find(([re]) => re.test(styleText))?.[1] ?? (['short', 'long', 'bun', 'curly', 'bob', 'buzz'] as Style[])[(h >>> 3) % 6]!
  const skin = SKIN.find(([re]) => re.test(skinText))?.[1] ?? SKIN[(h >>> 6) % SKIN.length]![1]
  const scrubs = /scrub/.test(topText)
  const coat = /white coat|lab coat|coat/.test(topText) && !/rain|over/.test(topText)
  const top = coat ? hex('#eef0f4') : colorOf(look.top, ['#42a379', '#4f78c4', '#c2504d', '#a99ad6', '#d1a23a'][(h >>> 9) % 5]!)
  const details: Detail[] = []
  for (const [re, d] of DETAILS) if (re.test(detailText) && !details.includes(d)) details.push(d)
  return {
    hair: hex(hairHex), style, skin: [hex(skin[0]), hex(skin[1])], top,
    trousers: scrubs ? darker(top, 0.12) : hex(TROUSERS[(h >>> 12) % TROUSERS.length]!),
    coat, scrubs, open: /blazer|jacket|cardigan|coat|vest/.test(topText), details,
  }
}

/** A key for the parts a viewer can tell apart. */
const signature = (p: Parsed) => [p.hair, p.style, p.skin[0], p.top, p.trousers, p.details.join('+')].join('|')

/**
 * The looks of everyone in a practice, made unlike each other: when two people would look the
 * same, the later one gets other trousers, then a lighter top.
 */
export function practiceLooks(people: Pick<Character, 'id' | 'look'>[]): Map<string, Parsed> {
  const out = new Map<string, Parsed>()
  const seen = new Set<string>()
  for (const c of people) {
    const p = parseLook(c.id, c.look)
    for (let i = 0; seen.has(signature(p)) && i < 12; i++) {
      if (i < TROUSERS.length) p.trousers = hex(TROUSERS[(TROUSERS.findIndex((t) => hex(t).join() === p.trousers.join()) + 1) % TROUSERS.length]!)
      else p.top = lighter(p.top, 0.15)
    }
    seen.add(signature(p))
    out.set(c.id, p)
  }
  return out
}

// ------------------------------------------------------------------------------------------
// Drawing
// ------------------------------------------------------------------------------------------
const OUTLINE: RGB = hex('#8d5243')
const EYE: RGB = hex('#654140')
const SHOE: RGB = hex('#5a3a2c')
const DARK: RGB = hex('#2a2630')
const METAL: RGB = hex('#c8ccd8')

type Px = (RGB | null)[][]

function headTop(grid: string[]): number {
  return grid.findIndex((r) => r.includes('O'))
}

/** One frame of one person. */
export function drawFrame(p: Parsed, facing: Facing, step: 0 | 1 | 2): Px {
  const grid = BODY[facing][step]
  const top = headTop(grid)
  const beard = p.details.includes('beard')
  // A dark skin needs a darker outline to stand out.
  const lum = (c: RGB) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]
  const outline: RGB = lum(p.skin[0]) < 150 ? hex('#3a2630') : OUTLINE
  const px: Px = grid.map((row, y) => [...row].map((ch) => {
    switch (ch) {
      case 'O': return outline
      case 's': case 'h': return p.skin[0]
      case 'S': return p.skin[1]
      case 'e': return EYE
      case 'b': return beard ? (y >= top + 6 && y <= top + 8 ? p.hair : y > top + 8 ? p.top : p.skin[1]) : y >= top + 7 ? p.top : p.skin[1]
      case 't': return p.top
      case 'T': return darker(p.top, 0.22)
      case 'p': return p.trousers
      case 'P': return darker(p.trousers, 0.2)
      case 'f': return SHOE
      case 'c': return darker(SHOE, 0.2)
      default: return null
    }
  }))
  const isSkin = (x: number, y: number) => grid[y]?.[x] === 's' || grid[y]?.[x] === 'S'
  const set = (x: number, y: number, c: RGB) => { if (y >= 0 && y < 16 && x >= 0 && x < 16) px[y]![x] = c }
  const empty = (x: number, y: number) => y >= 0 && y < 16 && x >= 0 && x < 16 && px[y]![x] === null
  const hair = p.hair
  const hairShade = darker(hair, 0.25)
  // Skin pixels of the head, row by row (relative row r from the top outline).
  const headRow = (r: number) => {
    const y = top + r
    const xs: number[] = []
    for (let x = 0; x < 16; x++) if (isSkin(x, y)) xs.push(x)
    return { y, xs }
  }
  const fill = (r: number, which: 'all' | 'edges' | 'back', n = 1) => {
    const { y, xs } = headRow(r)
    if (!xs.length) return
    if (which === 'all') xs.forEach((x) => set(x, y, r === 1 ? hair : hair))
    else if (which === 'edges') { for (let i = 0; i < n; i++) { set(xs[i]!, y, hairShade); set(xs[xs.length - 1 - i]!, y, hairShade) } }
    else {
      // The back of the head: the side away from the facing.
      const side = facing === 'left' ? xs.slice(-n) : facing === 'right' ? xs.slice(0, n) : []
      side.forEach((x) => set(x, y, hairShade))
    }
  }
  const style = p.style
  const back = facing === 'back'
  if (style !== 'bald') {
    if (style === 'covered') {
      // A head covering: all of the head but the face.
      for (let r = 1; r <= 6; r++) {
        const { y, xs } = headRow(r)
        xs.forEach((x, i) => { if (back || r <= 2 || r >= 6 || i === 0 || i === xs.length - 1 || (facing !== 'front' && (facing === 'left' ? i >= xs.length - 2 : i <= 1))) set(x, y, r % 2 ? hair : hairShade) })
      }
    } else if (back) {
      const rows = style === 'buzz' ? 3 : style === 'long' || style === 'bob' || style === 'curly' ? 6 : 5
      for (let r = 1; r <= rows; r++) fill(r, 'all')
    } else {
      fill(1, 'all')
      if (style !== 'buzz') fill(2, 'all')
      else fill(2, 'edges')
      if (style !== 'buzz') fill(3, facing === 'front' ? 'edges' : 'back', facing === 'front' ? 1 : 2)
      if (['long', 'bob', 'curly', 'braid'].includes(style)) {
        for (let r = 4; r <= (style === 'bob' ? 5 : 6); r++) fill(r, facing === 'front' ? 'edges' : 'back', facing === 'front' ? 1 : 2)
      }
    }
    // Long hair falls onto the shoulders.
    if (style === 'long') {
      for (let r = 7; r <= 8; r++) {
        const y = top + r
        const row = grid[y] ?? ''
        const xs = [...row].map((ch, x) => (ch === 't' || ch === 'T' ? x : -1)).filter((x) => x >= 0)
        if (!xs.length) continue
        if (back) xs.slice(1, -1).forEach((x) => set(x, y, r === 8 ? hairShade : hair))
        else if (facing === 'front') { set(xs[0]!, y, hairShade); set(xs[xs.length - 1]!, y, hairShade) }
        else set(facing === 'left' ? xs[xs.length - 1]! : xs[0]!, y, hairShade)
      }
    }
    // Volume above and beside the head.
    if (style === 'curly') {
      const row0 = grid[top] ?? ''
      const xs = [...row0].map((ch, x) => (ch === 'O' ? x : -1)).filter((x) => x >= 0)
      xs.forEach((x) => { set(x, top, hair); if (empty(x, top - 1)) set(x, top - 1, outline) })
      for (let r = 1; r <= 4; r++) {
        const y = top + r
        const row = grid[y] ?? ''
        const first = row.indexOf('O'), last = row.lastIndexOf('O')
        if (first < 0) continue
        set(first, y, hair); set(last, y, hair)
        if (empty(first - 1, y)) set(first - 1, y, outline)
        if (empty(last + 1, y)) set(last + 1, y, outline)
      }
    }
    // A bun on top, a ponytail or a braid at the back.
    const mid = (() => { const r = grid[top] ?? ''; return Math.floor((r.indexOf('O') + r.lastIndexOf('O')) / 2) })()
    if (style === 'bun') {
      set(mid, top - 1, hair); set(mid + 1, top - 1, hair); set(mid - 1, top - 1, outline); set(mid + 2, top - 1, outline)
      set(mid, top - 2, outline); set(mid + 1, top - 2, outline)
    }
    if (style === 'ponytail' || style === 'braid') {
      const len = style === 'braid' ? 6 : 4
      if (back) for (let r = 5; r < 5 + len; r++) { set(mid, top + r, r % 2 ? hair : hairShade); set(mid + 1, top + r, hairShade) }
      else if (facing !== 'front') {
        const row = grid[top + 3] ?? ''
        const x = facing === 'left' ? row.lastIndexOf('O') + 1 : row.indexOf('O') - 1
        for (let r = 2; r < 2 + len; r++) { if (empty(x, top + r)) { set(x, top + r, r % 2 ? hair : hairShade); if (empty(x + (facing === 'left' ? 1 : -1), top + r)) set(x + (facing === 'left' ? 1 : -1), top + r, outline) } }
      }
    }
  } else if (p.hair && !back) {
    // A fringe of hair above the ears, so a bald head still shows its colour.
    fill(3, facing === 'front' ? 'edges' : 'back', 1)
  } else if (back) fill(3, 'all')

  // Clothes and details.
  const bodyRow = (r: number) => {
    const y = top + r
    const xs: number[] = []
    for (let x = 0; x < 16; x++) if (grid[y]?.[x] === 't' || grid[y]?.[x] === 'T') xs.push(x)
    return { y, xs }
  }
  if (!back && (p.open || p.coat)) {
    // An open jacket or coat: a lighter shirt in the middle.
    const shirt: RGB = p.coat ? hex('#7fb6e6') : hex('#f4f1ea')
    for (let r = 7; r <= 9; r++) {
      const { y, xs } = bodyRow(r)
      if (xs.length < 4) continue
      const c = facing === 'front' ? Math.floor((xs[0]! + xs[xs.length - 1]!) / 2) : facing === 'left' ? xs[0]! + 1 : xs[xs.length - 1]! - 1
      set(c, y, shirt)
      if (facing === 'front') set(c + 1, y, shirt)
    }
  }
  for (const d of p.details) {
    if (d === 'glasses' && !back) {
      const r = 4
      const y = top + r
      const row = BODY[facing][step][y] ?? ''
      const eyes = [...row].map((ch, x) => (ch === 'e' ? x : -1)).filter((x) => x >= 0)
      eyes.forEach((x) => set(x, y, DARK))
      if (facing === 'front' && eyes.length >= 2) for (let x = eyes[0]! + 1; x < eyes[eyes.length - 1]!; x++) set(x, y, DARK)
      if (facing === 'left' && eyes.length) set(eyes[0]! + 1, y, DARK)
      if (facing === 'right' && eyes.length) set(eyes[eyes.length - 1]! - 1, y, DARK)
    }
    if (d === 'moustache' && facing !== 'back') {
      const y = top + 6
      const { xs } = headRow(6)
      if (xs.length >= 3) { const c = Math.floor((xs[0]! + xs[xs.length - 1]!) / 2); set(c, y, hair); set(c + (facing === 'front' ? 1 : facing === 'left' ? -1 : 1), y, hair) }
    }
    const chest = bodyRow(8)
    const c = chest.xs.length ? Math.floor((chest.xs[0]! + chest.xs[chest.xs.length - 1]!) / 2) : -1
    if (c < 0 || back) continue
    if (d === 'stethoscope') {
      if (facing === 'front') { set(c - 1, top + 7, METAL); set(c + 2, top + 7, METAL); set(c - 1, top + 8, METAL); set(c + 2, top + 8, METAL); set(c, top + 9, METAL); set(c + 1, top + 9, METAL) }
      else set(c, top + 8, METAL)
    }
    if (d === 'lanyard' || d === 'badge') {
      const band: RGB = hex('#3b5bc4')
      if (d === 'lanyard' && facing === 'front') { set(c - 1, top + 7, band); set(c + 2, top + 7, band) }
      set(facing === 'front' ? c : c, top + 9, hex('#ffffff'))
      if (facing === 'front') set(c + 1, top + 9, hex('#ffffff'))
    }
    if (d === 'tie') { set(c, top + 7, hex('#c2504d')); set(c, top + 8, hex('#a54240')); if (facing === 'front') { set(c + 1, top + 7, hex('#c2504d')); set(c + 1, top + 8, hex('#a54240')) } }
    if (d === 'scarf') { const r = bodyRow(7); r.xs.forEach((x) => set(x, r.y, hex('#e07a3c'))) }
    if (d === 'clipboard') { const x = facing === 'left' ? chest.xs[0]! - 1 : chest.xs[chest.xs.length - 1]!; set(x, top + 8, hex('#c59a68')); set(x, top + 9, hex('#eef0f4')) }
  }
  if (p.details.includes('headphones')) {
    const y = top + 1
    const row = grid[top] ?? ''
    for (let x = row.indexOf('O'); x <= row.lastIndexOf('O'); x++) set(x, top, DARK)
    const r3 = grid[top + 3] ?? ''
    if (facing === 'front' || facing === 'back') { set(r3.indexOf('O'), top + 3, DARK); set(r3.lastIndexOf('O'), top + 3, DARK) }
    else set(Math.floor((r3.indexOf('O') + r3.lastIndexOf('O')) / 2), top + 3, DARK)
    void y
  }
  if (p.details.includes('earrings') && facing !== 'back') {
    const r = grid[top + 5] ?? ''
    if (facing !== 'right') set(r.indexOf('O'), top + 5, hex('#f0c64a'))
    if (facing !== 'left') set(r.lastIndexOf('O'), top + 5, hex('#f0c64a'))
  }
  return px
}

// ------------------------------------------------------------------------------------------
// Canvases: a sheet for the scene, a portrait for everywhere else
// ------------------------------------------------------------------------------------------
function paint(ctx: CanvasRenderingContext2D, px: Px, ox: number, oy: number, scale = 1) {
  for (let y = 0; y < px.length; y++) {
    for (let x = 0; x < px[y]!.length; x++) {
      const c = px[y]![x]
      if (!c) continue
      ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`
      ctx.fillRect(ox + x * scale, oy + y * scale, scale, scale)
    }
  }
}

/** The order of the frames on a sheet, the same as /art/sprites.png: facing x 3 steps. */
export const FACE_COL: Record<Facing, number> = { front: 0, back: 1, left: 2, right: 3 }

const sheets = new Map<string, HTMLCanvasElement>()

/** A sheet of 12 frames, 16 x 16 each, in one row: front, back, left, right, 3 steps each. */
export function spriteSheet(id: string, p: Parsed): HTMLCanvasElement {
  const key = `${id}:${signature(p)}`
  let c = sheets.get(key)
  if (c) return c
  c = document.createElement('canvas')
  c.width = 12 * 16
  c.height = 16
  const ctx = c.getContext('2d')!
  for (const f of FACINGS) for (const st of [0, 1, 2] as const) paint(ctx, drawFrame(p, f, st), (FACE_COL[f] * 3 + st) * 16, 0)
  sheets.set(key, c)
  return c
}

const portraits = new Map<string, string>()

/** The person seen from the front, head and shoulders, at a whole-number scale, as an image URL. */
export function portraitUrl(id: string, p: Parsed, size: number): string {
  const scale = Math.max(1, Math.floor(size / 12))
  const key = `${id}:${signature(p)}:${scale}`
  const hit = portraits.get(key)
  if (hit) return hit
  const px = drawFrame(p, 'front', 0)
  const top = headTop(BODY.front[0])
  const c = document.createElement('canvas')
  c.width = 12 * scale
  c.height = 12 * scale
  const ctx = c.getContext('2d')!
  // Head and shoulders: 12 x 12 pixels from two above the head.
  paint(ctx, px.slice(top - 2, top + 10).map((r) => r.slice(2, 14)), 0, 0, scale)
  const url = c.toDataURL('image/png')
  portraits.set(key, url)
  return url
}
