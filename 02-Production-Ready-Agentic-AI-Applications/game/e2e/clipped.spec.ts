// Nothing is cut at any width (engineering spec, section 10.1), on the demo pack: the lobby, the
// play screens of Phases 1 and 2 and the host console at seven widths from a small phone to a
// wide laptop. A text counts as cut when its own box or a box around it hides part of it, or when
// it stands outside the window. What scrolls is not cut, and a card that says "Show more" is not.
import { createRequire } from 'node:module'
import { expect, test, type Page } from '@playwright/test'

const require = createRequire(import.meta.url)
const WebSocket = require('ws') as typeof import('ws')
const PASS = 'e2e-passcode-0123'
const SIZES: [number, number][] = [[360, 740], [390, 844], [500, 900], [768, 1024], [1024, 768], [1280, 720], [1440, 900]]

async function setup(page: Page, label: string) {
  const token = (await (await page.request.post('/api/host/login', { data: { passcode: PASS } })).json()).token as string
  const code = (await (await page.request.post('/api/host/session', { data: { label, mode: 'rehearsal' }, headers: { authorization: `Bearer ${token}` } })).json()).code as string
  const base = new URL('http://127.0.0.1:3200')
  const ws = new WebSocket(`ws://${base.host}/ws`, { headers: { origin: base.origin } })
  await new Promise<void>((resolve) => {
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', token, build: 'bot', session: code, name: 'Test bot', console: 'bot' })))
    ws.on('message', (raw) => { if ((JSON.parse(String(raw)) as { t: string }).t === 'welcome') resolve() })
  })
  let n = 0
  const host = (type: string, payload: unknown = {}) => new Promise<{ ok: boolean }>((resolve) => {
    const cid = `c${++n}`
    const on = (raw: unknown) => { const m = JSON.parse(String(raw)) as { t: string; cid?: string; ok: boolean }; if (m.t === 'ack' && m.cid === cid) { ws.off('message', on); resolve(m) } }
    ws.on('message', on)
    ws.send(JSON.stringify({ t: 'hostcmd', cid, type, payload }))
  })
  return { code, token, host, close: () => ws.close() }
}

/** The texts of the page that are cut, each with why and where. Runs in the page. */
function cutTexts(): string[] {
  const out = new Map<string, string>()
  const vw = document.documentElement.clientWidth
  const txt = (el: HTMLElement) => (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 44)
  const cls = (a: Element) => a.tagName.toLowerCase() + (typeof a.className === 'string' && a.className.trim() ? '.' + a.className.trim().split(/\s+/).join('.') : '')
  const path = (el: Element) => { const p: string[] = []; let a: Element | null = el; for (let i = 0; i < 3 && a && a !== document.body; i++) { p.unshift(cls(a)); a = a.parentElement } return p.join(' > ') }
  const hid = (v: string) => v === 'hidden' || v === 'clip'
  const scrolls = (v: string) => v === 'auto' || v === 'scroll'
  if (document.documentElement.scrollWidth > vw + 1) out.set('PAGE', `the page scrolls sideways: ${document.documentElement.scrollWidth} > ${vw}`)
  for (const el of document.body.querySelectorAll<HTMLElement>('*')) {
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim())) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) continue
    if (el.closest('.clamp-box:not(.open), [aria-hidden="true"], .sr-only')) continue
    let why: string | null = null
    if (cs.display !== 'inline') {
      if (el.scrollWidth > el.clientWidth + 1 && hid(cs.overflowX)) why = `cut sideways ${el.scrollWidth}>${el.clientWidth}`
      else if (el.scrollHeight > el.clientHeight + 2 && hid(cs.overflowY)) why = `cut below ${el.scrollHeight}>${el.clientHeight}`
    }
    let scrollable = false
    for (let a = el.parentElement; !why && a && a !== document.body; a = a.parentElement) {
      const as = getComputedStyle(a)
      const ar = a.getBoundingClientRect()
      if (hid(as.overflowX) && (r.right > ar.right + 1.5 || r.left < ar.left - 1.5)) why = `cut sideways by ${cls(a)}`
      else if (hid(as.overflowY) && (r.bottom > ar.bottom + 2.5 || r.top < ar.top - 2.5)) why = `cut below by ${cls(a)}`
      else if (scrolls(as.overflowX) || scrolls(as.overflowY) || as.position === 'fixed') { scrollable = true; break }
    }
    if (!why && !scrollable && (r.right > vw + 1 || r.left < -1)) why = `outside the window ${Math.round(r.left)}..${Math.round(r.right)} of ${vw}`
    if (why) out.set(`${path(el)} | ${txt(el)}`, why)
  }
  return [...out].map(([k, v]) => `${v} :: ${k}`)
}

const tool = (page: Page, label: string) => page.locator('.tbrow', { has: page.locator('.tb-ln', { hasText: new RegExp(`^${label}`) }) })
const cell = (page: Page, c: number, r: number) => page.getByRole('button', { name: new RegExp(`^Empty cell, column ${c}, row ${r}\\.`) })
const join = async (page: Page, from: string, to: RegExp) => {
  await page.getByRole('button', { name: `Draw a line from ${from}`, exact: true }).click()
  await page.getByRole('button', { name: to }).click()
}

test('nothing is cut on the screens of a player or of the host, from 360 to 1440 wide', async ({ page, browser }, info) => {
  test.skip(info.project.name !== 'laptop', 'one run covers every width')
  test.setTimeout(240_000)
  const s = await setup(page, 'E2E widths')
  await s.host('set_scale', { scale: 3 })
  const found: string[] = []
  const hostPage = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage()
  await hostPage.goto('/host')
  await hostPage.evaluate((t) => localStorage.setItem('lab02.host', JSON.stringify({ token: t, name: 'Widths' })), s.token)
  await hostPage.goto(`/host?s=${s.code}`)
  await expect(hostPage.getByText('Now on stage')).toBeVisible()

  /** Scan the player's page and the host console at every width. `tabs` are the phone tabs to open in turn. */
  const scan = async (where: string, tabs: string[] = []) => {
    for (const [w, h] of SIZES) {
      for (const [p, who] of [[page, 'player'], [hostPage, 'host']] as const) {
        await p.setViewportSize({ width: w, height: h })
        await p.waitForTimeout(150)
        const narrow = await p.locator('.ptabs').count()
        for (const tab of who === 'player' && narrow && tabs.length ? tabs : [null]) {
          if (tab) { await p.locator('.ptabs button', { hasText: tab }).click(); await p.waitForTimeout(100) }
          for (const x of await p.evaluate(cutTexts)) found.push(`${w} wide, ${who}, ${where}${tab ? `, ${tab}` : ''}: ${x}`)
        }
      }
    }
    await page.setViewportSize({ width: 1280, height: 720 })
  }

  await page.goto(`/j/${s.code}`)
  await page.getByLabel('Name your practice').fill('Widths')
  await page.getByRole('button', { name: /Riverbend/ }).click()
  await page.getByRole('button', { name: 'Join', exact: true }).click()
  await page.getByRole('button', { name: 'Got it' }).click()
  await scan('the lobby')

  await s.host('next'); await s.host('next')
  await page.getByRole('button', { name: 'Start investigating' }).click()
  await page.getByRole('button', { name: 'End tour' }).click()
  await scan('Phase 1', ['Assessment', 'Investigations', 'Insights'])

  await s.host('end_now'); await s.host('next'); await s.host('next')
  await page.getByRole('button', { name: 'Start building' }).click()
  await page.getByRole('button', { name: 'End tour' }).click()
  // A first map at laptop width: an agent with its parts and a person who signs, then a validation.
  await tool(page, 'Agent').click(); await cell(page, 2, 2).click()
  await tool(page, 'Reference librarian').click(); await cell(page, 3, 2).click()
  await tool(page, 'Rule').click(); await cell(page, 1, 4).click()
  await join(page, 'Request form', /Join to Agent/)
  await join(page, 'Agent', /Join to Reference librarian/)
  await join(page, 'Reference librarian', /Join to Loan arranged/)
  await page.getByRole('button', { name: '+ Model' }).click()
  await page.locator('.partrow', { hasText: 'Acorn Small' }).click()
  await page.getByRole('button', { name: '+ Runs on' }).click()
  await page.locator('.partrow', { hasText: 'Acorn public API' }).click()
  await expect(page.locator('.vbtn')).not.toHaveAttribute('aria-disabled', 'true')
  await page.locator('.vbtn').click()
  await expect(page.locator('#p2-results .vrun')).toHaveCount(1, { timeout: 20_000 })
  await page.locator('.p2toast').waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {})
  await scan('Phase 2', ['Map', 'Actions', 'Toolbox', 'Results'])

  expect(found, found.join('\n')).toEqual([])
  await hostPage.context().close()
  s.close()
})
