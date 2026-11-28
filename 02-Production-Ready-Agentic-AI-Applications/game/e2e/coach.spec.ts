// What a host is told about the shape of a player's map (engineering spec, section 10.8), on the
// demo pack: the hints stand first in the coaching block of the host's view of a player, each
// with a question to ask, and none of it is on the player's own page.
import { createRequire } from 'node:module'
import { expect, test, type Page } from '@playwright/test'

const require = createRequire(import.meta.url)
const WebSocket = require('ws') as typeof import('ws')
const PASS = 'e2e-passcode-0123'

async function setup(page: Page, label: string, scale = 1) {
  const token = (await (await page.request.post('/api/host/login', { data: { passcode: PASS } })).json()).token as string
  const code = (await (await page.request.post('/api/host/session', { data: { label, mode: 'rehearsal', replace: {} }, headers: { authorization: `Bearer ${token}` } })).json()).code as string
  const base = new URL(`http://127.0.0.1:${process.env.E2E_PORT ?? 3200}`)
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

async function joinPicked(page: Page, code: string, name: string, system: RegExp) {
  await page.goto(`/j/${code}`)
  await page.getByLabel('Name your practice').fill(name)
  await page.getByRole('button', { name: system }).click()
  await page.getByRole('button', { name: 'Join', exact: true }).click()
  await page.getByRole('button', { name: 'Got it' }).click()
}

/** From the lobby to Phase 2, the opening letter and the tour closed. `tutorial`: what to do with the guided first build that follows. */
async function toDevelopment(page: Page, s: Awaited<ReturnType<typeof setup>>, tutorial: 'skip' | 'keep' = 'skip') {
  await s.host('next'); await s.host('next')
  await page.getByRole('button', { name: 'Start investigating' }).click()
  await page.getByRole('button', { name: 'End tour' }).click()
  await s.host('end_now'); await s.host('next'); await s.host('next')
  await expect(page.getByText('A letter for you')).toBeVisible()
  await page.getByRole('button', { name: 'Start building' }).click()
  await page.getByRole('button', { name: 'End tour' }).click()
  await expect(page.locator('.fb-card')).toBeVisible()
  if (tutorial === 'skip') await page.getByRole('button', { name: 'Skip the tutorial' }).click()
}

async function noOverflow(page: Page) {
  const w = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth])
  expect(w[0]).toBeLessThanOrEqual(w[1]!)
}
async function noErrorNames(page: Page) {
  const names = await page.evaluate(() => document.body.innerText.match(/\b[a-z]+_[a-z_]+\b/g) ?? [])
  expect(names).toEqual([])
}

const tool = (page: Page, label: string) => page.locator('.tbrow', { has: page.locator('.tb-l', { hasText: new RegExp(`^${label}`) }) })
const cell = (page: Page, c: number, r: number) => page.getByRole('button', { name: new RegExp(`^Empty cell, column ${c}, row ${r}\\.`) })
const join = async (page: Page, from: string, to: RegExp) => {
  await page.getByRole('button', { name: `Draw a line from ${from}` }).click()
  await page.getByRole('button', { name: to }).click()
}


test('the host is told what the shape of a map says, with a question to ask', async ({ page, browser }, info) => {
  test.skip(info.project.name !== 'laptop', 'laptop only')
  test.setTimeout(120_000)
  const s = await setup(page, 'E2E coach hints')
  await joinPicked(page, s.code, 'Hinted Branch', /Riverbend/)
  await toDevelopment(page, s)
  // One agent on the large model that reads two short sources, and nothing reaches the result yet.
  await tool(page, 'Agent').click()
  await cell(page, 2, 2).click()
  await page.getByRole('button', { name: '+ Model' }).click()
  await page.locator('.partrow', { hasText: 'Acorn Large' }).click()
  await page.getByRole('button', { name: '+ Runs on' }).click()
  await page.locator('.partrow', { hasText: 'Acorn public API' }).click()
  await join(page, 'Request form', /Join to Agent/)
  await join(page, 'Shared catalog', /Join to Agent/)

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } })
  const hp = await ctx.newPage()
  await hp.goto('/host')
  await hp.evaluate((t) => localStorage.setItem('lab02.host', JSON.stringify({ token: t, name: 'E2E host' })), s.token)
  await hp.goto(`/host?s=${s.code}`)
  await hp.locator('.plook').first().click()
  const look = hp.getByRole('dialog')
  const coach = look.locator('.coach')
  await expect(coach.locator('.eyebrow')).toHaveText(['What holds this map back', 'Worth saying', 'Good on this map'])
  // The proposed system reads a source that this player has not opened: the hint names it and
  // the action that opens it, and the question beside it leaves the answer to the player.
  const hint = coach.getByTestId('coach-hint').first()
  await expect(hint).toContainText('is still locked on their board, so nothing on their map can read it.')
  await expect(hint).toContainText(/The action ".+" opens it\./)
  await expect(coach.getByTestId('coach-ask').first()).toHaveText(/^Ask which patients need .+, and which action on their list would open it\.$/)
  // Four lines a column at most, and no internal name anywhere.
  for (const col of await coach.locator('.coach-cols > div').all()) expect(await col.locator('li').count()).toBeLessThanOrEqual(4)
  await noErrorNames(hp)
  await noOverflow(hp)
  if (process.env.SHOTS_DIR) await hp.screenshot({ path: `${process.env.SHOTS_DIR}/coach-hints.png` })
  // The player's own page holds none of it.
  await expect(page.locator('body')).not.toContainText('is still locked on their board')
  await ctx.close()
  s.close()
})
