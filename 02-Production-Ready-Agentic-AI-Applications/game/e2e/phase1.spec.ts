// The board of Phase 1 on the demo pack (engineering spec, section 12.6): the spots and the line
// that names the split, dragging, the class control and the keys, a swap, a full class that asks
// who leaves, a refresh, an insight card opened large, and the pick of a health system.
import { createRequire } from 'node:module'
import { expect, test, type Page } from '@playwright/test'

const require = createRequire(import.meta.url)
const WebSocket = require('ws') as typeof import('ws')
const PASS = 'e2e-passcode-0123'

async function setup(page: Page, label: string) {
  const token = (await (await page.request.post('/api/host/login', { data: { passcode: PASS } })).json()).token as string
  const code = (await (await page.request.post('/api/host/session', { data: { label, mode: 'rehearsal' }, headers: { authorization: `Bearer ${token}` } })).json()).code as string
  const base = new URL('http://127.0.0.1:3200')   // the e2e server of playwright.config.ts
  const ws = new WebSocket(`ws://${base.host}/ws`, { headers: { origin: base.origin } })
  await new Promise<void>((resolve) => {
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', token, build: 'bot', session: code })))
    ws.on('message', (raw) => { if ((JSON.parse(String(raw)) as { t: string }).t === 'welcome') resolve() })
  })
  let n = 0
  const host = (type: string, payload: unknown = {}) => new Promise<{ ok: boolean }>((resolve) => {
    const cid = `e${++n}`
    const on = (raw: unknown) => { const m = JSON.parse(String(raw)) as { t: string; cid?: string; ok: boolean }; if (m.t === 'ack' && m.cid === cid) { ws.off('message', on); resolve(m) } }
    ws.on('message', on)
    ws.send(JSON.stringify({ t: 'hostcmd', cid, type, payload }))
  })
  return { code, host, close: () => ws.close() }
}

async function joinPicked(page: Page, code: string, name: string, system: RegExp) {
  await page.goto(`/j/${code}`)
  await expect(page.getByText('Health system', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /Assign me/ })).toHaveAttribute('aria-pressed', 'true')
  await page.getByLabel('Name your practice').fill(name)
  await page.getByRole('button', { name: system }).click()
  await page.getByRole('button', { name: 'Join', exact: true }).click()
  await page.getByRole('button', { name: 'Got it' }).click()
}

async function noOverflow(page: Page) {
  const w = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth])
  expect(w[0]).toBeLessThanOrEqual(w[1]!)
}

const trayTitles = (page: Page) => page.locator('.tray .pcard .pt').allTextContents()
const binTitles = (page: Page, i: number) => page.locator('.bin').nth(i).locator('.schip .ct').allTextContents()

async function drag(page: Page, from: ReturnType<Page['locator']>, to: ReturnType<Page['locator']>) {
  const a = (await from.boundingBox())!
  const b = (await to.boundingBox())!
  await page.mouse.move(a.x + 30, a.y + 10)
  await page.mouse.down()
  for (let s = 1; s <= 10; s++) await page.mouse.move(a.x + 30 + ((b.x + b.width / 2 - a.x - 30) * s) / 10, a.y + 10 + ((b.y + b.height / 2 - a.y - 10) * s) / 10)
  await page.mouse.up()
}

test('the laptop board: spots, dragging, keys, a swap, a full class, a refresh and a card opened large', async ({ page }, info) => {
  test.skip(info.project.name !== 'laptop', 'laptop only')
  const s = await setup(page, 'E2E board laptop')
  await joinPicked(page, s.code, 'Board Laptop', /Lakeshore/)
  await expect(page.locator('.sysbadge')).toContainText('Lakeshore')
  await s.host('next'); await s.host('next')
  await page.getByRole('button', { name: 'Start investigating' }).click()

  // One spot for every problem, in the split of the classes, and the line that names it.
  await expect(page.locator('.spot')).toHaveCount(6)
  await expect(page.locator('.ask')).toHaveText('Find the 2 problems that are not real, the 2 that need no AI, the 1 that needs one AI model and the 1 that needs an agentic system.')
  await expect(page.locator('.tray .pcard')).toHaveCount(6)
  await noOverflow(page)

  // Drag into an empty spot, to another bin, and back to Unsorted.
  const first = (await trayTitles(page))[0]!
  await drag(page, page.locator('.tray .pcard').first(), page.locator('[data-spot="not_real:0"]'))
  await expect.poll(() => binTitles(page, 0)).toEqual([first])
  await drag(page, page.locator('.bin').nth(0).locator('.schip').first(), page.locator('[data-spot="no_ai:1"]'))
  await expect.poll(() => binTitles(page, 1)).toEqual([first])
  await drag(page, page.locator('.bin').nth(1).locator('.schip').first(), page.locator('.tray .tlist'))
  await expect.poll(() => trayTitles(page)).toContain(first)

  // The keys: 1 to 4 pick a class, 0 clears.
  const card = page.locator('.tray .pcard').first()
  const t1 = (await card.locator('.pt').textContent())!
  await card.focus()
  await page.keyboard.press('4')
  await expect.poll(() => binTitles(page, 3)).toEqual([t1])
  await page.locator('.bin').nth(3).locator('.schip').first().focus()
  await page.keyboard.press('0')
  await expect.poll(() => trayTitles(page)).toContain(t1)

  // The class control, then a full class that asks who leaves.
  const a = page.locator('.tray .pcard').nth(0)
  const ta = (await a.locator('.pt').textContent())!
  await a.locator('.four button').nth(3).click()
  const b = page.locator('.tray .pcard').nth(0)
  const tb = (await b.locator('.pt').textContent())!
  await expect(b.locator('.four button').nth(3)).toHaveClass(/full/)
  await b.locator('.four button').nth(3).click()
  await expect(page.getByText(/is full/)).toBeVisible()
  await page.getByRole('button', { name: new RegExp(ta.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).click()
  await expect.poll(() => binTitles(page, 3)).toEqual([tb])
  await expect.poll(() => trayTitles(page)).toContain(ta)

  // A drop on a filled spot swaps the two problems.
  const c = page.locator('.tray .pcard').nth(0)
  const tc = (await c.locator('.pt').textContent())!
  await c.locator('.four button').nth(0).click()
  await expect.poll(() => binTitles(page, 0)).toEqual([tc])
  await drag(page, page.locator('.bin').nth(3).locator('.schip').first(), page.locator('.bin').nth(0).locator('.schip').first())
  await expect.poll(() => binTitles(page, 0)).toEqual([tb])
  await expect.poll(() => binTitles(page, 3)).toEqual([tc])
  // No path leaves a class with more problems than spots.
  for (let i = 0; i < 4; i++) {
    const spots = await page.locator('.bin').nth(i).locator('.spot').count()
    expect((await binTitles(page, i)).length).toBeLessThanOrEqual(spots)
  }

  // A refresh brings the same board back.
  await page.waitForTimeout(800)
  await page.reload()
  await expect.poll(() => binTitles(page, 0)).toEqual([tb])
  await expect.poll(() => binTitles(page, 3)).toEqual([tc])

  // An interview, its card on the wall, opened large; the board still sorts beside it.
  await page.locator('.irow:has(.m-int) .ibtn.start').first().click()
  await expect(page.locator('.cards .card')).toHaveCount(2, { timeout: 20_000 })
  const tile = page.locator('.cards .card').nth(1)
  await tile.click()
  await expect(page.locator('.overlay')).toBeVisible()
  await expect(page.locator('.ovcount')).toHaveText('Card 2 of 2')
  await page.keyboard.press('ArrowLeft')
  await expect(page.locator('.ovcount')).toHaveText('Card 1 of 2')
  await page.locator('.tray .pcard').first().locator('.four button').nth(1).click()
  await expect.poll(async () => (await binTitles(page, 1)).length).toBe(1)
  await page.locator('.ovbox').focus()
  await page.keyboard.press('Escape')
  await expect(page.locator('.overlay')).toHaveCount(0)
  await expect(page.locator('.cards .card').first()).toBeFocused()
  await page.locator('.cards .card').nth(1).focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('.overlay')).toBeVisible()
  await page.keyboard.press('Escape')
  // No text on a card is smaller than 14 px.
  const small = await page.evaluate(() => [...document.querySelectorAll('.cards .card p, .cards .card .say, .cards .card .lab')].filter((e) => parseFloat(getComputedStyle(e).fontSize) < 14).length)
  expect(small).toBe(0)
  await noOverflow(page)

  // The reveal: the corrected board with a mark on every problem.
  await s.host('end_now')
  await expect(page.getByText('The corrected board')).toBeVisible()
  await expect(page.locator('.rprob')).toHaveCount(6)
  await expect(page.locator('.rprob.flag .rprob-body')).toBeVisible()
  s.close()
})

test('the phone board: the class control alone, a full class, and the tabs', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'phone only')
  const s = await setup(page, 'E2E board phone')
  await joinPicked(page, s.code, 'Board Phone', /Riverbend/)
  await s.host('next'); await s.host('next')
  await page.getByRole('button', { name: 'Start investigating' }).tap()
  await page.locator('.ptabs button', { hasText: 'Sort' }).tap()
  await expect(page.locator('.phcard')).toHaveCount(6)
  await expect(page.locator('.pstrip > div')).toHaveCount(4)
  await page.locator('.phcard').nth(0).locator('.four button').nth(3).tap()
  await expect(page.locator('.pstrip > div').nth(3)).toContainText('1 of 1')
  await page.locator('.phcard').nth(1).locator('.four button').nth(3).tap()
  await expect(page.getByText(/is full/)).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).tap()
  await page.locator('.phcard').nth(0).locator('.four .clr').tap()
  await expect(page.locator('.pstrip > div').nth(3)).toContainText('0 of 1')
  // From a problem to the evidence and back.
  await page.locator('.phcard').nth(2).getByRole('button', { name: /Evidence/ }).tap()
  await expect(page.getByRole('button', { name: /Back to:/ })).toBeVisible()
  await page.getByRole('button', { name: /Back to:/ }).tap()
  await expect(page.locator('.phcard')).toHaveCount(6)
  await noOverflow(page)
  s.close()
})
