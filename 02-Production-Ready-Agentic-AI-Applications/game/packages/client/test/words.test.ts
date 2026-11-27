// No internal error name ever reaches a screen (engineering spec, section 10.1), and no two people
// of a practice look alike (section 11.4).
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ERROR_CODES } from '@lab02/protocol'
import { ERROR_TEXT, plainError } from '../src/lib/errors.ts'
import { FACINGS, drawFrame, parseLook, practiceLooks } from '../src/scene/people.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))
const plain = (t: string) => /^[A-Z].*[.!?]$/.test(t) && !/[a-z]+_[a-z]+/.test(t)

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(n) ? [p] : []
  })
}

describe('errors in plain words', () => {
  it('has one plain sentence for every error name of the protocol', () => {
    for (const code of ERROR_CODES) {
      const t = plainError(code)
      expect(ERROR_TEXT[code], code).toBeDefined()
      expect(plain(t), `${code}: ${t}`).toBe(true)
    }
  })

  it('has one for every error name the server can send over HTTP', () => {
    const src = ['server/src/app.ts', 'server/src/manager.ts'].map((f) => readFileSync(join(root, f), 'utf8')).join('\n')
    const names = new Set([...src.matchAll(/bad\(reply, \d+, '([a-z_]+)'/g)].map((m) => m[1]!))
    for (const m of src.matchAll(/error: '([a-z_]+)'/g)) names.add(m[1]!)
    expect(names.size).toBeGreaterThan(8)
    for (const n of names) expect(ERROR_TEXT[n], n).toBeDefined()
  })

  it('never shows an unknown name, a number or an http status', () => {
    for (const x of ['zz_top', 'http_502', '', undefined]) {
      const t = plainError(x)
      expect(plain(t)).toBe(true)
      expect(t).not.toContain('zz_top')
      expect(t).not.toContain('502')
    }
  })

  it('no screen prints an error field as it came', () => {
    const offenders: string[] = []
    for (const f of files(join(root, 'client/src')).filter((x) => x.endsWith('.tsx'))) {
      const src = readFileSync(f, 'utf8')
      for (const m of src.matchAll(/\{[^{}]*\b(r|res|result)\??\.(error|message)\b[^{}]*\}/g)) {
        if (!/plainError\(|errorText\(|setErr\(|setDelErr|setKeyErr|setConfirmErr|ref\.set|onRefused|setError\(/.test(m[0])) offenders.push(`${f.slice(root.length)}: ${m[0]}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('the people of a practice', () => {
  it('gives everyone their own look, and reads the free words of a look', () => {
    // The looks of a real practice: five people, some alike in words.
    const cast = [
      { id: 'a', look: { hair: 'auburn', hairStyle: 'long', skin: 'light', top: 'teal cardigan', detail: 'glasses' } },
      { id: 'b', look: { hair: 'black', hairStyle: 'short', skin: 'brown', top: 'mustard sweater', detail: 'lanyard' } },
      { id: 'c', look: { hair: 'black', hairStyle: 'bun', skin: 'medium', top: 'navy blazer' } },
      { id: 'd', look: { hair: 'grey', hairStyle: 'buzz', skin: 'dark', top: 'green polo', detail: 'beard' } },
      { id: 'e', look: {} },
    ]
    const looks = practiceLooks(cast)
    const sig = [...looks.values()].map((p) => JSON.stringify(p))
    expect(new Set(sig).size).toBe(cast.length)
    const p = parseLook('x', { hair: 'grey', hairStyle: 'long braid', skin: 'dark', top: 'navy blazer', detail: 'round glasses and a stethoscope' })
    expect(p.style).toBe('braid')
    expect(p.details).toEqual(expect.arrayContaining(['glasses', 'stethoscope']))
    expect(p.open).toBe(true)
  })

  it('makes two people with the same words look different', () => {
    const same = { hair: 'black', hairStyle: 'short', skin: 'medium', top: 'blue shirt' }
    const looks = practiceLooks([{ id: 'a', look: same }, { id: 'b', look: same }, { id: 'c', look: same }])
    const [a, b, c] = ['a', 'b', 'c'].map((k) => JSON.stringify(looks.get(k)))
    expect(new Set([a, b, c]).size).toBe(3)
  })

  it('draws 16 x 16 frames in every facing, with the hair on the head', () => {
    const p = parseLook('x', { hair: 'red', hairStyle: 'bun', skin: 'light', top: 'green' })
    for (const f of FACINGS) for (const st of [0, 1, 2] as const) {
      const px = drawFrame(p, f, st)
      expect(px.length).toBe(16)
      expect(px.every((r) => r.length === 16)).toBe(true)
      expect(px.flat().some((c) => c && c.join() === p.hair.join())).toBe(true)
    }
  })
})
