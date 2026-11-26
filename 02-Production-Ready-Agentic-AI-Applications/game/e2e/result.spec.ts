// The end of the game on the demo pack (engineering spec, sections 10.7 and 12.6): the report
// card on the player's screen at the winners, after a reload, after the host has ended the
// session, on the page that brings it back in the same browser, and on another device with the
// session and the rejoin code. The copy for the printer shows the card alone.
import { createRequire } from 'node:module'
import { expect, test, type Page } from '@playwright/test'

const require = createRequire(import.meta.url)
const WebSocket = require('ws') as typeof import('ws')
const PASS = 'e2e-passcode-0123'

async function setup(page: Page, label: string, scale = 1) {
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
    const cid = `e${++n}`
    const on = (raw: unknown) => { const m = JSON.parse(String(raw)) as { t: string; cid?: string; ok: boolean }; if (m.t === 'ack' && m.cid === cid) { ws.off('message', on); resolve(m) } }
    ws.on('message', on)
    ws.send(JSON.stringify({ t: 'hostcmd', cid, type, payload }))
  })
  if (scale !== 1) await host('set_scale', { scale })
  return { code, token, host, close: () => ws.close() }
}

/** Drive the session to a stage: `next` where the host moves it on, `end_now` in a timed stage. */
async function toStage(page: Page, s: Awaited<ReturnType<typeof setup>>, stage: string) {
  for (let i = 0; i < 60; i++) {
    const now = ((await (await page.request.get(`/api/session/${s.code}`)).json()) as { stage: string }).stage
    if (now === stage) return
    if (!(await s.host('next')).ok) await s.host('end_now')
  }
  throw new Error(`the session did not reach ${stage}`)
}

async function noOverflow(page: Page) {
  const w = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth])
  expect(w[0]).toBeLessThanOrEqual(w[1]!)
}
async function noErrorNames(page: Page) {
  const names = await page.evaluate(() => document.body.innerText.match(/\b[a-z]+_[a-z_]+\b/g) ?? [])
  expect(names).toEqual([])
}

test('the report card at the end of the game, and the result a player comes back to', async ({ page, browser }, info) => {
  test.setTimeout(120_000)
  const label = `Card game ${info.project.name}`
  const s = await setup(page, label, 50)
  await page.goto(`/j/${s.code}`)
  await page.getByLabel('Name your practice').fill('Card Branch')
  await page.getByRole('button', { name: /Riverbend/ }).click()
  await page.getByRole('button', { name: 'Join', exact: true }).click()
  await page.getByRole('button', { name: 'Got it' }).click()
  const rejoin = await page.evaluate(() => (JSON.parse(localStorage.getItem('lab02.player')!) as { rejoinCode: string }).rejoinCode)
  expect(rejoin).toMatch(/^[A-Z0-9]{6}$/)

  // Before the end of the game the screen shows no card.
  await toStage(page, s, 'break.planning')
  await expect(page.getByRole('article', { name: /report card|result so far/ })).toHaveCount(0)

  // At the winners: the card, with every phase, the way to save it and the link back.
  await toStage(page, s, 'winners')
  const card = page.getByRole('article', { name: 'Your report card' })
  await expect(card).toBeVisible()
  await expect(card.getByText('Card Branch')).toBeVisible()
  await expect(card.getByText(label)).toBeVisible()
  for (const ph of ['Phase 1 · Planning', 'Phase 2 · Development', 'Phase 3 · Maintaining']) await expect(card.getByRole('heading', { name: ph })).toBeVisible()
  await expect(card.getByText('Problems in their true class')).toBeVisible()
  await expect(card.getByText('Overall rank')).toBeVisible()
  await expect(card.getByRole('listitem').filter({ hasText: /^The Branch Handbook \(invented for the demo\)$/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save as PDF' })).toBeVisible()
  await expect(page.getByRole('link', { name: new RegExp(`/result/${s.code}$`) })).toBeVisible()
  await expect(page.getByText(new RegExp(`your rejoin code, ${rejoin}`))).toBeVisible()
  await noOverflow(page)
  await noErrorNames(page)

  // On paper: the card alone, and nothing of the page around it.
  await page.emulateMedia({ media: 'print' })
  await expect(page.locator('#root')).toBeHidden()
  await expect(page.locator('.printroot .rcard.paper')).toBeVisible()
  await expect(page.locator('.printroot').getByText('Card Branch')).toBeVisible()
  await expect(page.locator('.printroot').getByRole('button')).toHaveCount(0)
  await page.emulateMedia({ media: 'screen' })

  // A reload keeps it. So does the end of the session.
  await page.reload()
  await expect(page.getByRole('article', { name: 'Your report card' })).toBeVisible()
  await s.host('close', { confirm: s.code })
  await expect(page.getByText('This game has ended').first()).toBeVisible()
  await expect(page.getByRole('article', { name: 'Your report card' })).toBeVisible()

  // The link back, in the same browser: the card, with no question.
  await page.goto(`/result/${s.code}`)
  await expect(page.getByRole('heading', { name: 'Your result' })).toBeVisible()
  await expect(page.getByRole('article', { name: 'Your report card' })).toBeVisible()
  await expect(page.getByLabel('Your rejoin code')).toHaveCount(0)
  await noOverflow(page)
  await page.goto('/result')
  await expect(page.getByRole('article', { name: 'Your report card' })).toBeVisible()

  // Another device: the link asks for the rejoin code, and the plain page for the session too.
  const ctx = await browser.newContext({ viewport: page.viewportSize()! })
  const other = await ctx.newPage()
  await other.goto(`/result/${s.code}`)
  await expect(other.getByLabel('Session code or name')).toHaveValue(s.code)
  await expect(other.getByRole('button', { name: 'Show my result' })).toBeDisabled()
  await other.getByLabel('Your rejoin code').fill('zzzzzz')
  await other.getByRole('button', { name: 'Show my result' }).click()
  await expect(other.getByRole('alert')).toContainText('No result was found')
  await noErrorNames(other)
  await other.getByLabel('Your rejoin code').fill(rejoin.toLowerCase())
  await other.getByRole('button', { name: 'Show my result' }).click()
  await expect(other.getByRole('article', { name: 'Your report card' })).toBeVisible()
  await expect(other.getByText('Card Branch').first()).toBeVisible()
  // That device keeps the game from now on.
  await other.goto('/result')
  await expect(other.getByRole('article', { name: 'Your report card' })).toBeVisible()
  // By the name of the session, on a third device.
  const ctx3 = await browser.newContext({ viewport: page.viewportSize()! })
  const third = await ctx3.newPage()
  await third.goto('/result')
  await third.getByLabel('Session code or name').fill(label.toUpperCase())
  await third.getByLabel('Your rejoin code').fill(rejoin)
  await third.getByRole('button', { name: 'Show my result' }).click()
  await expect(third.getByRole('article', { name: 'Your report card' })).toBeVisible()
  await noOverflow(third)
  await ctx.close()
  await ctx3.close()
  s.close()
})
