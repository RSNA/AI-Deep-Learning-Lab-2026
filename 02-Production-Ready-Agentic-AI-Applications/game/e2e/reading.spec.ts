// What a model reads and what that costs (engineering spec, section 6.6), on the demo pack:
// the sentence for every agent under the map, the same in the chooser of its model, and the
// whole of it still above the fold in a low laptop window.
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


const SHOTS = process.env.SHOTS_DIR ?? null
const shot = async (page: Page, name: string) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }) }

test('every agent says what it reads and what that costs, under the map and in its model chooser', async ({ page }, info) => {
  test.setTimeout(120_000)
  const phone = info.project.name === 'phone'
  const s = await setup(page, `E2E reading ${info.project.name}`, 2)
  await joinPicked(page, s.code, 'Token Counters', /Riverbend/)
  await toDevelopment(page, s)
  if (phone) await page.locator('.ptabs button', { hasText: 'Toolbox' }).click()
  await tool(page, 'Agent').click()

  await cell(page, 2, 2).click()
  // A tile without a model and a place reads nothing yet, so the line says nothing of it.
  await expect(page.getByTestId('runreads')).toHaveCount(0)
  await page.getByRole('button', { name: '+ Model' }).click()
  await page.locator('.partrow', { hasText: 'Acorn Small' }).click()
  await page.getByRole('button', { name: '+ Runs on' }).click()
  await page.locator('.partrow', { hasText: 'Acorn public API' }).click()
  await join(page, 'Request form', /Join to Agent/)
  const reads = page.getByTestId('runreads')
  await expect(reads).toHaveText(/^Per patient, Agent reads about 500 tokens on Acorn Small \([0-9.< ]+ k\$ a month\)\.$/)
  // Two more sources: the same agent reads three times as much, and pays three times as much.
  await join(page, 'Shared catalog', /Join to Agent/)
  await join(page, 'Courier site', /Join to Agent/)
  await expect(reads).toContainText('Agent reads about 1,500 tokens on Acorn Small')
  // The chooser of its model says the same in three sentences, before the choices.
  await page.getByRole('button', { name: /^Model:/ }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet).toContainText('With the lines it has now, Agent reads about 1,500 tokens per patient.')
  await expect(sheet).toContainText('A model is paid by the token, so a long source costs more than a short one')
  await shot(page, `reading-chooser-${info.project.name}`)
  // The large model reads the same and costs more.
  const before = await reads.innerText()
  await sheet.locator('.partrow', { hasText: 'Acorn Large' }).click()
  await expect(reads).toContainText('on Acorn Large')
  expect(await reads.innerText()).not.toBe(before)
  if (!phone) {
    // A second agent on the small model: one sentence names both, each with its own tokens and price.
    await tool(page, 'Agent').click()
    await cell(page, 2, 4).click()
    await page.getByRole('button', { name: '+ Model' }).click()
    await page.locator('.partrow', { hasText: 'Acorn Small' }).click()
    await page.getByRole('button', { name: '+ Runs on' }).click()
    await page.locator('.partrow', { hasText: 'Acorn public API' }).click()
    await join(page, "Librarians' forum", /Join to Agent 2/)
    await expect(reads).toHaveText(/^Per patient, Agent 1 reads about 1,500 tokens on Acorn Large \([0-9.< ]+ k\$ a month\) and Agent 2 reads about 500 tokens on Acorn Small \([0-9.< ]+ k\$ a month\)\.$/)
  }
  await noOverflow(page)
  await noErrorNames(page)
  await shot(page, `reading-${info.project.name}`)
  if (!phone) {
    // In a low laptop window the map, the line and Validate still fit without a sideways scroll.
    for (const [w, h] of [[1280, 720], [1366, 620]] as const) {
      await page.setViewportSize({ width: w, height: h })
      await noOverflow(page)
      await shot(page, `reading-${w}x${h}`)
    }
    await page.setViewportSize({ width: 1280, height: 720 })
    const fold = await page.evaluate(() => ({ validate: document.querySelector('.p2-map .vbtn')!.getBoundingClientRect().bottom, h: window.innerHeight }))
    expect(fold.validate).toBeLessThanOrEqual(fold.h)
  }
  s.close()
})
