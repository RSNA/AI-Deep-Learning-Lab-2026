// The two pages for facilitators beside the console (engineering spec, section 10.8), on the demo
// pack and a made-up guide: /host/guide with its menu and its search, and /host/slides with every
// slide of the deck. Both ask for the facilitator passcode, and no ticket stands in an address.
import { expect, test, type Page } from '@playwright/test'

const PASS = 'e2e-passcode-0123'

async function signIn(page: Page, name = 'Page tester') {
  await page.getByLabel('Facilitator passcode').fill(PASS)
  await page.getByLabel('Your name').fill(name)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

/** How far the guide has been scrolled inside its frame. */
const scrolled = (page: Page) => page.locator('iframe.guideframe').evaluate((f) => (f as HTMLIFrameElement).contentWindow!.scrollY)

test('the guide asks for the passcode, then shows the guide with a menu that jumps', async ({ page }, info) => {
  const phone = info.project.name === 'phone'
  // Without a sign-in the page shows the form and reads nothing of the guide.
  const asked: string[] = []
  page.on('request', (r) => { if (r.url().includes('/api/host/')) asked.push(new URL(r.url()).pathname) })
  await page.goto('/host/guide')
  await expect(page.getByText('Sign in with the facilitator passcode to read the guide.')).toBeVisible()
  await expect(page.locator('iframe')).toHaveCount(0)
  expect(asked).toEqual([])
  // A wrong passcode is refused with a sentence.
  await page.getByLabel('Facilitator passcode').fill('not-the-passcode')
  await page.getByLabel('Your name').fill('Page tester')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('alert')).toContainText(/passcode/i)
  await expect(page.locator('iframe')).toHaveCount(0)

  await signIn(page)
  const guide = page.frameLocator('iframe.guideframe')
  await expect(guide.getByRole('heading', { name: 'Demo facilitator guide' })).toBeVisible()
  // The address stays plain: no ticket in it.
  expect(new URL(page.url()).pathname).toBe('/host/guide')
  expect(page.url()).not.toContain('ticket')

  // The menu: the parts of the guide and what stands under each, read from its headings.
  const menu = page.getByRole('navigation', { name: 'Contents' })
  if (phone) {
    await expect(menu).toBeHidden()
    await page.getByRole('button', { name: 'Contents' }).click()
  }
  await expect(menu.locator('.guidepart')).toHaveText(['1. Opening the library', '2. The reading room', '3. Closing time'])
  await expect(menu.locator('.guidesub')).toHaveText(['The front desk', 'The return box', 'Seats and lamps', 'The quiet rule', 'The last round'])
  await expect(menu.getByText('Demo facilitator guide')).toHaveCount(0)
  expect(await scrolled(page)).toBe(0)

  // A press jumps to the part and marks it. On a phone the menu folds away again.
  await menu.getByRole('button', { name: 'The quiet rule' }).click()
  await expect(guide.getByRole('heading', { name: 'The quiet rule' })).toBeInViewport()
  expect(await scrolled(page)).toBeGreaterThan(1000)
  if (phone) {
    await expect(menu).toBeHidden()
    await page.getByRole('button', { name: 'Contents' }).click()
  }
  await expect(menu.locator('.guidesub.at')).toHaveText('The quiet rule')
  await expect(menu.locator('.guidepart.open')).toHaveText('2. The reading room')
  if (phone) await menu.getByRole('button', { name: 'Close' }).click()

  // A link inside the guide scrolls inside the guide, and the page stays where it is.
  await page.locator('iframe.guideframe').evaluate((f) => (f as HTMLIFrameElement).contentWindow!.scrollTo(0, 0))
  await guide.getByRole('link', { name: '3. Closing time' }).click()
  await expect(guide.getByRole('heading', { name: '3. Closing time' })).toBeInViewport()
  expect(new URL(page.url()).pathname).toBe('/host/guide')

  // A reload keeps the sign-in.
  await page.reload()
  await expect(guide.getByRole('heading', { name: 'Demo facilitator guide' })).toBeVisible()
})

test('the search of the guide finds a word, counts the places and steps through them', async ({ page }, info) => {
  const phone = info.project.name === 'phone'
  await page.goto('/host/guide')
  await signIn(page)
  const guide = page.frameLocator('iframe.guideframe')
  await expect(guide.getByRole('heading', { name: 'Demo facilitator guide' })).toBeVisible()
  const q = page.getByRole('searchbox', { name: 'Search the guide' })
  const status = page.locator('#guide-q-status')

  // One letter is too short to search for, and the page says so.
  await q.fill('l')
  await expect(status).toHaveText('Type two letters or more.')
  await expect(guide.locator('mark.lab02-hit')).toHaveCount(0)

  // A word that stands in two parts: both places are marked, the first is the one in view.
  await q.fill('Lighthouse')
  await expect(status).toHaveText('This is place 1 of 2.')
  await expect(guide.locator('mark.lab02-hit')).toHaveCount(2)
  await expect(guide.locator('mark.lab02-hit.at')).toHaveText('lighthouse')
  await expect(guide.locator('mark.lab02-hit.at')).toBeInViewport()
  // The menu says in which parts the places are.
  if (phone) await page.getByRole('button', { name: 'Contents' }).click()
  const menu = page.getByRole('navigation', { name: 'Contents' })
  await expect(menu.locator('.guidepart').nth(0).locator('.guidehits')).toHaveText('1')
  await expect(menu.locator('.guidepart').nth(1).locator('.guidehits')).toHaveText('1')
  await expect(menu.locator('.guidepart').nth(2).locator('.guidehits')).toHaveCount(0)
  if (phone) await menu.getByRole('button', { name: 'Close' }).click()

  // Next and Enter step forward and go round, Previous and Shift+Enter step back.
  const first = await scrolled(page)
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(status).toHaveText('This is place 2 of 2.')
  await expect(guide.locator('mark.lab02-hit.at')).toBeInViewport()
  expect(await scrolled(page)).toBeGreaterThan(first + 500)
  await q.press('Enter')
  await expect(status).toHaveText('This is place 1 of 2.')
  await q.press('Shift+Enter')
  await expect(status).toHaveText('This is place 2 of 2.')
  await page.getByRole('button', { name: 'Previous', exact: true }).click()
  await expect(status).toHaveText('This is place 1 of 2.')

  // A phrase with a bold word in it is one place, although it runs over three pieces of text.
  await q.fill('the lighthouse keeper')
  await expect(status).toHaveText('The guide has this in one place.')
  await expect(guide.locator('mark.lab02-hit')).toHaveText(['the ', 'lighthouse', ' keeper'])
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled()

  // Nothing found: one full sentence, and no mark is left from before.
  await q.fill('submarine')
  await expect(status).toHaveText('The guide does not have "submarine" anywhere.')
  await expect(guide.locator('mark')).toHaveCount(0)

  // Clear empties the field and takes the marks away. The text of the guide is as it was.
  await q.fill('sea charts')
  await expect(status).toHaveText('This is place 1 of 2.')
  await page.getByRole('button', { name: 'Clear' }).click()
  await expect(q).toHaveValue('')
  await expect(status).toHaveText('')
  await expect(guide.locator('mark')).toHaveCount(0)
  await expect(guide.getByText('The first visitor of the day is usually the lighthouse keeper, who returns the same atlas every week.')).toBeVisible()
})

test('all slides: behind the same sign-in, every slide from the first to the last', async ({ page }, info) => {
  await page.goto('/host/slides')
  await expect(page.getByText('Sign in with the facilitator passcode to see the slides.')).toBeVisible()
  await expect(page.locator('.slidecard')).toHaveCount(0)
  await signIn(page)

  // Every slide of the demo deck, in order, each with its number and its title.
  const cards = page.locator('.slidecard')
  await expect(cards).toHaveCount(10)
  await expect(page.getByText('These are the 10 slides of the session, from the first to the last.')).toBeVisible()
  const numbers = await cards.locator('.slidehead-n').allTextContents()
  expect(numbers).toEqual(Array.from({ length: 10 }, (_x, i) => `Slide ${i + 1} of 10`))
  // The slide is the one the projector draws: same shape, scaled to the page, and never wider than the page.
  const shape = await cards.first().locator('.sl-thumb').evaluate((el) => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height, vw: window.innerWidth } })
  expect(shape.w / shape.h).toBeCloseTo(1920 / 820, 1)
  expect(shape.w).toBeLessThanOrEqual(shape.vw)
  expect(shape.w).toBeGreaterThan(info.project.name === 'phone' ? 300 : 900)
  await expect(cards.first().locator('.sl-title')).toBeVisible()
  // The notes of a slide stand under it.
  await expect(cards.first().locator('.notes')).toContainText('Wait until most people have joined')
  // The slide that tells the room the passcode for playing alone carries it, as on the projector.
  await expect(page.locator('.slidecard .sl-pass')).toContainText(PASS)

  // The list of parts jumps to the first slide of a part.
  const jump = page.getByLabel('Go to a part of the deck')
  const last = await jump.locator('option').last().getAttribute('value')
  await jump.selectOption(last!)
  await expect(cards.last()).toBeInViewport()

  // Both themes of the projector.
  await page.getByRole('button', { name: 'Dark', exact: true }).click()
  await expect(cards.first().locator('.sl-thumb')).toHaveClass(/theme-dark/)
  await page.getByRole('button', { name: 'Light', exact: true }).click()
  await expect(cards.first().locator('.sl-thumb')).toHaveClass(/theme-light/)

  // The bar at the top leads to the guide and back, in the same window and with the same sign-in.
  const bar = page.getByRole('navigation', { name: 'Pages for facilitators' })
  await expect(bar.getByRole('link', { name: 'All slides' })).toHaveAttribute('aria-current', 'page')
  await bar.getByRole('link', { name: 'Facilitator guide' }).click()
  await expect(page).toHaveURL(/\/host\/guide$/)
  await expect(page.frameLocator('iframe.guideframe').getByRole('heading', { name: 'Demo facilitator guide' })).toBeVisible()
  await page.getByRole('navigation', { name: 'Pages for facilitators' }).getByRole('link', { name: 'All slides' }).click()
  await expect(page).toHaveURL(/\/host\/slides$/)
  await expect(cards).toHaveCount(10)
  await page.getByRole('navigation', { name: 'Pages for facilitators' }).getByRole('link', { name: 'Console', exact: true }).click()
  await expect(page).toHaveURL(/\/host$/)
  await expect(page.getByRole('heading', { name: 'Facilitator console' })).toBeVisible()
})

test('a sign-in that has ended is asked for again, with the reason', async ({ page }) => {
  await page.goto('/host/slides')
  await page.evaluate(() => localStorage.setItem('lab02.host', JSON.stringify({ token: 'a-token-that-ended', name: 'Old tab' })))
  await page.goto('/host/slides')
  await expect(page.getByText('Your sign-in has ended. Sign in again.')).toBeVisible()
  await expect(page.locator('.slidecard')).toHaveCount(0)
  await page.goto('/host/guide')
  await page.evaluate(() => localStorage.setItem('lab02.host', JSON.stringify({ token: 'a-token-that-ended', name: 'Old tab' })))
  await page.goto('/host/guide')
  await expect(page.getByText('Your sign-in has ended. Sign in again.')).toBeVisible()
  await expect(page.locator('iframe')).toHaveCount(0)
})

test('the console links the guide and all slides, each in a window of its own', async ({ page, context }, info) => {
  test.skip(info.project.name !== 'laptop', 'the console is for a laptop')
  await page.goto('/host')
  await signIn(page, 'Console tester')
  // The first page of the console: three links of one height in a row.
  const row = page.locator('.host-first').getByRole('button', { name: /^(Facilitator guide|All slides|Console manual)$/ })
  await expect(row).toHaveCount(3)
  const heights = await row.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height)))
  expect(new Set(heights).size).toBe(1)

  const [guide] = await Promise.all([context.waitForEvent('page'), page.getByRole('button', { name: 'Facilitator guide' }).click()])
  await expect(guide).toHaveURL(/\/host\/guide$/)
  await expect(guide.frameLocator('iframe.guideframe').getByRole('heading', { name: 'Demo facilitator guide' })).toBeVisible()
  const [slides] = await Promise.all([context.waitForEvent('page'), page.getByRole('button', { name: 'All slides' }).click()])
  await expect(slides).toHaveURL(/\/host\/slides$/)
  await expect(slides.locator('.slidecard')).toHaveCount(10)

  // Inside a session the same two links stand in the bar of the console.
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem('lab02.host')!).token as string)
  const code = (await (await page.request.post('/api/host/session', { data: { label: 'E2E pages', mode: 'rehearsal', replace: {} }, headers: { authorization: `Bearer ${token}` } })).json()).code as string
  await page.goto(`/host?s=${code}`)
  const bar = page.locator('.sessbar')
  await expect(bar.getByRole('button', { name: 'Facilitator guide' })).toBeVisible()
  await expect(bar.getByRole('button', { name: 'All slides' })).toBeVisible()
  // A second press brings the window of the slides back and opens no other one.
  const before = context.pages().length
  await slides.goto('about:blank')
  await bar.getByRole('button', { name: 'All slides' }).click()
  await expect(slides).toHaveURL(/\/host\/slides$/)
  await expect(slides.locator('.slidecard')).toHaveCount(10)
  expect(context.pages().length).toBe(before)
  // The session is ended, so that the tests after this one find no session open.
  await page.request.post(`/api/host/session/${code}/end`, { data: { name: 'Console tester' }, headers: { authorization: `Bearer ${token}` } })
})
