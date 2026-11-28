// The board when it gets crowded (engineering spec, section 10.5, the last feedback before the
// event): Tidy map, sources in the order the player gives them, a line into any side of the
// result, and a line that shows faintly through a tile it passes behind. On the demo pack.
import { createRequire } from 'node:module'
import { expect, test, type Page } from '@playwright/test'

const require = createRequire(import.meta.url)
const WebSocket = require('ws') as typeof import('ws')
const PASS = 'e2e-passcode-0123'
const SHOTS = process.env.BOARD_SHOTS

async function setup(page: Page, label: string) {
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
  return { code, token, host, close: () => ws.close() }
}

async function toDevelopment(page: Page, s: Awaited<ReturnType<typeof setup>>, name: string) {
  await page.goto(`/j/${s.code}`)
  await page.getByLabel('Name your practice').fill(name)
  await page.getByRole('button', { name: /Riverbend/ }).click()
  await page.getByRole('button', { name: 'Join', exact: true }).click()
  await page.getByRole('button', { name: 'Got it' }).click()
  await s.host('next'); await s.host('next')
  await page.getByRole('button', { name: 'Start investigating' }).click()
  await page.getByRole('button', { name: 'End tour' }).click()
  await s.host('end_now'); await s.host('next'); await s.host('next')
  await page.getByRole('button', { name: 'Start building' }).click()
  await page.getByRole('button', { name: 'End tour' }).click()
  await page.getByRole('button', { name: 'Skip the tutorial' }).click()
}

const tool = (page: Page, label: string) => page.locator('.tbrow', { has: page.locator('.tb-l', { hasText: new RegExp(`^${label}`) }) })
const cell = (page: Page, c: number, r: number) => page.getByRole('button', { name: new RegExp(`^Empty cell, column ${c}, row ${r}\\.`) })
const join = async (page: Page, from: string, to: RegExp) => {
  await page.getByRole('button', { name: `Draw a line from ${from}` }).click()
  await page.getByRole('button', { name: to }).click()
}
const tile = (page: Page, label: string) => page.locator(`.ctile[aria-label^="${label}"]`)
const colOf = (page: Page, label: string) => tile(page, label).evaluate((el) => Number((el as HTMLElement).style.gridColumnStart) - 1)
const sourceNames = (page: Page) => page.locator('.csources .cs-name').allTextContents()
const shot = async (page: Page, name: string) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }) }

test('a crowded map: Tidy map, sources in the order of the player, a line into any side of the result, a line seen through a tile', async ({ page }, info) => {
  test.skip(info.project.name !== 'laptop', 'laptop only')
  const s = await setup(page, 'E2E board tidy')
  await toDevelopment(page, s, 'Board Tidy')
  const tidy = page.getByRole('button', { name: 'Tidy map' })
  const hint = page.locator('.mhint')

  // An empty map has nothing to tidy. The button looks off and says why, in its title and on a press.
  await expect(tidy).toHaveAttribute('aria-disabled', 'true')
  await expect(tidy).toHaveAttribute('title', 'There is nothing to tidy yet, because the map is empty.')
  await tidy.click({ force: true })
  await expect(hint).toContainText('There is nothing to tidy yet')
  // The buttons of the bar are one row of one height.
  const heights = await page.locator('.mapbar .btn').evaluateAll((els) => els.map((e) => (e as HTMLElement).offsetHeight))
  expect(new Set(heights).size).toBe(1)

  // A map that reads from right to left: the agent stands last and hands its work back to the first column.
  await tool(page, 'Agent').click()
  await cell(page, 4, 4).click()
  await tool(page, 'Reference librarian').click()
  await cell(page, 1, 1).click()
  await join(page, 'Courier site', /Join to Agent/)
  await join(page, 'Agent', /Join to Reference librarian/)
  await join(page, 'Reference librarian', /Join to Loan arranged/)
  expect(await colOf(page, 'Agent')).toBe(4)
  expect(await colOf(page, 'Reference librarian')).toBe(1)
  // The line from the source to the agent runs behind the librarian's column: over a tile it is drawn again, faintly.
  await expect(page.locator('.cover .cover-ink')).toHaveCount(3)
  await expect(page.locator('.cover clipPath rect')).toHaveCount(2)
  expect(Number(await page.locator('.cover-ink').first().evaluate((el) => getComputedStyle(el).opacity))).toBeLessThan(0.3)
  await shot(page, 'board-1-before-tidy')

  // One press: the map reads from left to right, with the same tiles and the same three lines.
  await expect(tidy).not.toHaveAttribute('aria-disabled', 'true')
  await tidy.click()
  await expect(hint).toContainText('The map is tidy now')
  expect(await colOf(page, 'Agent')).toBe(1)
  expect(await colOf(page, 'Reference librarian')).toBe(2)
  await expect(page.locator('.cline')).toHaveCount(3)
  for (const [from, to] of [['Courier site', 'Agent'], ['Agent', 'Reference librarian'], ['Reference librarian', 'Loan arranged']]) {
    await expect(page.locator(`.cline .hit[aria-label^="Line from ${from} to ${to}."]`)).toHaveCount(1)
  }
  // The source that the agent reads stands level with it now: the agent is in a row of its own, and the source in the same band.
  const agentBox = (await tile(page, 'Agent').boundingBox())!, srcBox = (await page.locator('.csource', { hasText: 'Courier site' }).boundingBox())!
  expect(Math.abs(agentBox.y + agentBox.height / 2 - (srcBox.y + srcBox.height / 2))).toBeLessThan(agentBox.height)
  await shot(page, 'board-2-after-tidy')
  // A tidy map has nothing to tidy.
  await expect(tidy).toHaveAttribute('aria-disabled', 'true')
  await expect(tidy).toHaveAttribute('title', 'The map is already as tidy as this button can make it.')
  // Undo puts the tiles back, and Redo tidies again.
  await page.getByRole('button', { name: 'Undo' }).click()
  expect(await colOf(page, 'Agent')).toBe(4)
  await page.getByRole('button', { name: 'Redo' }).click()
  expect(await colOf(page, 'Agent')).toBe(1)

  // A source is dragged down two places. While it moves the column shows the new order.
  const before = await sourceNames(page)
  const first = page.locator('.csource').nth(0), third = page.locator('.csource').nth(2)
  const a = (await first.locator('.cs-name').boundingBox())!, b = (await third.boundingBox())!
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2 + 12, { steps: 3 })
  await page.mouse.move(a.x + a.width / 2, b.y + b.height / 2, { steps: 8 })
  await expect(page.locator('.csource.sorting')).toHaveCount(1)
  await shot(page, 'board-3-source-dragged')
  await page.mouse.up()
  await expect(page.locator('.csource.sorting')).toHaveCount(0)
  const moved = [before[1]!, before[2]!, before[0]!, ...before.slice(3)]
  expect(await sourceNames(page)).toEqual(moved)
  // The click that ends the drag opens nothing, and every line is still there.
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.cline')).toHaveCount(3)
  // With the keyboard: Alt and the up arrow move the source in focus one place, and it keeps the focus.
  await page.locator('.csource').nth(2).focus()
  await page.keyboard.press('Alt+ArrowUp')
  const keyed = [before[1]!, before[0]!, before[2]!, ...before.slice(3)]
  await expect.poll(() => sourceNames(page)).toEqual(keyed)
  expect(await page.evaluate(() => document.activeElement?.textContent)).toContain(before[0]!)
  // The order is part of the map: a refresh shows it again.
  await page.waitForTimeout(500)
  await page.reload()
  await expect(page.locator('.csource').first()).toBeVisible()
  expect(await sourceNames(page)).toEqual(keyed)

  // The result takes its line on any of its four sides. The end of the line is picked up, and the dots of the result show.
  const line = page.locator('.cline .hit[aria-label^="Line from Reference librarian to Loan arranged."]')
  const endOf = () => line.evaluate((el) => { const p = (el.getAttribute('d') ?? '').trim().split(/[ ,]/); return { x: Number(p.at(-2)), y: Number(p.at(-1)) } })
  const resultBox = () => page.locator('.cresult').evaluate((el) => {
    const root = el.closest('.cgrid')
    let x = 0, y = 0
    for (let at: HTMLElement | null = el as HTMLElement; at && at !== root; at = at.offsetParent as HTMLElement | null) { x += at.offsetLeft; y += at.offsetTop }
    return { x, y, w: (el as HTMLElement).offsetWidth, h: (el as HTMLElement).offsetHeight }
  })
  const r = await resultBox()
  expect(Math.abs((await endOf()).x - (r.x - 1))).toBeLessThan(1.5)          // on the left, as before
  await line.focus()
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Move the arrow end of the line from Reference librarian to Loan arranged' }).click()
  await expect(page.locator('.cresult.ends .cport.rs')).toHaveCount(4)
  await expect(page.locator('.cresult .cport.rs.s-t')).toHaveCSS('opacity', '1')
  await shot(page, 'board-4-result-dots')
  await page.getByRole('button', { name: 'End the line on the top side of the result' }).click()
  await expect.poll(async () => Math.abs((await endOf()).y - (r.y - 1))).toBeLessThan(1.5)
  await expect(page.locator('.cline')).toHaveCount(3)
  await page.keyboard.press('Escape')
  // The same line drawn again, and ended on another dot of the result, moves to that side.
  await page.getByRole('button', { name: 'Draw a line from Reference librarian' }).click()
  await page.getByRole('button', { name: 'End the line on the bottom side of the result' }).click()
  await expect.poll(async () => Math.abs((await endOf()).y - (r.y + r.h))).toBeLessThan(1.5)
  await expect(page.locator('.cline')).toHaveCount(3)
  // The dots go again once the line has its end.
  await page.mouse.move(600, 300)
  await expect(page.locator('.cresult .cport.rs.s-t')).toHaveCSS('opacity', '0')
  await shot(page, 'board-5-result-bottom')
  // Tidy map puts the line back on the side that faces its tile.
  await tidy.click()
  await expect.poll(async () => Math.abs((await endOf()).x - (r.x - 1))).toBeLessThan(1.5)

  // No name of a refusal or of a field reaches the screen.
  const names = await page.evaluate(() => document.body.innerText.match(/\b[a-z]+_[a-z_]+\b/g) ?? [])
  expect(names).toEqual([])
  s.close()
})

test('the phone: Tidy map in the bar, and a source moved from its card', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'phone only')
  const s = await setup(page, 'E2E board phone')
  await toDevelopment(page, s, 'Board Phone')
  await page.locator('.ptabs button', { hasText: 'Map' }).tap()
  await expect(page.getByRole('button', { name: 'Tidy map' })).toBeVisible()
  const before = await sourceNames(page)
  // A tap on a source opens its card, which says where the source stands and moves it one place.
  await page.locator('.csource').nth(0).tap()
  const sheet = page.getByRole('dialog')
  await expect(sheet).toContainText(`This source is number 1 of ${before.length} in its column.`)
  await expect(sheet).toContainText('It is at the top already, so it can only move down.')
  await expect(sheet.getByRole('button', { name: 'Move up' })).toBeDisabled()
  await sheet.getByRole('button', { name: 'Move down' }).tap()
  await expect(sheet).toContainText(`This source is number 2 of ${before.length} in its column.`)
  await expect(sheet.getByRole('button', { name: 'Move up' })).toBeEnabled()
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/board-phone-source-card.png` })
  await sheet.locator('.sheet-actions').last().getByRole('button', { name: 'Close' }).tap()
  expect(await sourceNames(page)).toEqual([before[1]!, before[0]!, ...before.slice(2)])
  // The page never scrolls sideways.
  const w = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth])
  expect(w[0]).toBeLessThanOrEqual(w[1]!)
  // A map by taps, tidied by a tap.
  await page.locator('.ptabs button', { hasText: 'Toolbox' }).click()
  await tool(page, 'Rule').click()
  await cell(page, 3, 3).click()
  await page.locator('.gridscroll').evaluate((el) => { el.scrollLeft = 300 })
  await page.getByRole('button', { name: 'Tidy map' }).tap()
  await expect(page.locator('.mhint')).toContainText('The map is tidy now')
  expect(await colOf(page, 'Rule')).toBe(1)
  // The grid of a phone goes back to its left edge, where the tidy map starts.
  await expect.poll(() => page.locator('.gridscroll').evaluate((el) => el.scrollLeft)).toBe(0)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/board-phone-tidied.png` })
  s.close()
})
