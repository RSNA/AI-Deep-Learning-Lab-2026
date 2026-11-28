// The look through the deck in the host console (engineering spec, section 10.8): the host looks
// ahead with the notes while the projector and the players' screens keep the shown slide, and
// "Show this slide" sends the slide looked at to the room.
import { expect, test, type Page } from '@playwright/test'

const PASS = 'e2e-passcode-0123'

/** The slide number in the box at the top right of the projector. */
const projectorSlide = (screen: Page) => screen.locator('.headbox .face')
/** The slide number under the mirrored slide on a player's screen. */
const playerSlide = (pp: Page) => pp.locator('.pslide')

test('the host looks through the deck without showing it, then shows one slide', async ({ page, browser }, info) => {
  test.skip(info.project.name !== 'laptop', 'laptop only')
  const token = (await (await page.request.post('/api/host/login', { data: { passcode: PASS } })).json()).token as string
  const auth = { authorization: `Bearer ${token}` }
  const code = (await (await page.request.post('/api/host/session', { data: { label: 'E2E look', mode: 'rehearsal', replace: {} }, headers: auth })).json()).code as string

  // A player and a projector window.
  const player = await browser.newContext()
  const pp = await player.newPage()
  await pp.goto(`/j/${code}`)
  await pp.getByLabel('Name your practice').fill('Look Tester')
  await pp.getByRole('button', { name: 'Join', exact: true }).click()
  await pp.getByRole('button', { name: 'Got it' }).click()
  const screenCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } })
  const screen = await screenCtx.newPage()
  const path = (await (await page.request.post('/api/host/screen-link', { data: { code }, headers: auth })).json()).path as string
  await screen.goto(path)

  // The console moves to the intro: the deck is on the projector and on every player's screen.
  await page.goto('/host')
  await page.evaluate((t) => localStorage.setItem('lab02.host', JSON.stringify({ token: t, name: 'Look laptop' })), token)
  await page.goto(`/host?s=${code}`)
  await expect(page.locator('.sessbar .chip.good')).toHaveText('You are in charge')
  await page.getByRole('button', { name: /^Next:/ }).click()
  await expect(projectorSlide(screen)).toHaveText('1')
  await expect(playerSlide(pp)).toContainText('Slide 1 of 10')

  // The look follows the shown slide, with its notes.
  const look = page.locator('.looker')
  await expect(look.locator('.looknav .slidecount')).toHaveText('Slide 1 of 10')
  await expect(look.locator('.notes')).toContainText('Wait until most people have joined')
  await expect(look.getByRole('button', { name: 'Show this slide' })).toBeDisabled()

  // Looking ahead changes nothing for the room.
  await look.getByRole('button', { name: 'Look ahead →' }).click()
  await expect(look.locator('.looknav .slidecount')).toHaveText('Looking at 2 · Shown 1')
  await expect(look.locator('.notes')).toContainText('Keep this short')
  await page.locator('body').press('Shift+ArrowRight')
  await expect(look.locator('.looknav .slidecount')).toHaveText('Looking at 3 · Shown 1')
  await expect(look.getByText('The room still sees slide 1.')).toBeVisible()
  await expect(page.locator('.slidenav .slidecount')).toHaveText('Slide 1 of 10')
  await expect(projectorSlide(screen)).toHaveText('1')
  await expect(playerSlide(pp)).toContainText('Slide 1 of 10')
  // The shown slide carries its tag in the strip of the deck.
  await expect(look.locator('.stripbtn.shown')).toHaveCount(1)
  await expect(look.locator('.stripbtn.shown .stripnum')).toContainText('1')
  await expect(look.locator('.stripbtn.at .stripnum')).toContainText('3')

  // Back to the shown slide, and out again from the strip.
  await look.getByRole('button', { name: 'Back to the shown slide' }).click()
  await expect(look.locator('.looknav .slidecount')).toHaveText('Slide 1 of 10')
  await look.getByRole('button', { name: 'Look at slide 3' }).click()
  await expect(look.locator('.looknav .slidecount')).toHaveText('Looking at 3 · Shown 1')

  // Show this slide: the projector and the players' screens move, and the look follows again.
  await look.getByRole('button', { name: 'Show this slide' }).click()
  await expect(projectorSlide(screen)).toHaveText('3')
  await expect(playerSlide(pp)).toContainText('Slide 3 of 10')
  await expect(page.locator('.slidenav .slidecount')).toHaveText('Slide 3 of 10')
  await expect(look.locator('.looknav .slidecount')).toHaveText('Slide 3 of 10')

  // A slide of a later part: Show this slide asks first, and Cancel keeps the room where it is.
  await look.getByLabel('Look at a section').selectOption({ label: 'After Phase 1' })
  await expect(look.locator('.looknav .slidecount')).toHaveText('Looking at 4 · Shown 3')
  await look.getByRole('button', { name: 'Show this slide' }).click()
  await expect(page.getByRole('dialog')).toContainText('These slides come later')
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()
  await expect(projectorSlide(screen)).toHaveText('3')
  await expect(look.locator('.looknav .slidecount')).toHaveText('Looking at 4 · Shown 3')

  // Stepping the shown slide back leaves a look that is elsewhere where it is.
  await page.locator('.slidenav').getByRole('button', { name: '← Back' }).click()
  await expect(projectorSlide(screen)).toHaveText('2')
  await expect(look.locator('.looknav .slidecount')).toHaveText('Looking at 4 · Shown 2')

  // The arrow keys move the shown slide for the host in charge, also while a button of the
  // console has the focus (the one that was just pressed).
  await look.getByRole('button', { name: 'Back to the shown slide' }).click()
  await page.keyboard.press('ArrowRight')
  await expect(projectorSlide(screen)).toHaveText('3')
  await expect(playerSlide(pp)).toContainText('Slide 3 of 10')
  // Quick presses count from the slide that was asked for, before the console has heard of it.
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')
  await expect(projectorSlide(screen)).toHaveText('1')
  await page.keyboard.press('ArrowRight')
  await expect(projectorSlide(screen)).toHaveText('2')
  await page.locator('.slidenav').getByRole('button', { name: 'Next →' }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(projectorSlide(screen)).toHaveText('3')
  // A step into a later part asks first, and while that window is open the keys move nothing.
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('dialog')).toContainText('These slides come later')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowLeft')
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()
  await expect(projectorSlide(screen)).toHaveText('3')
  await expect(playerSlide(pp)).toContainText('Slide 3 of 10')

  const w = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth])
  expect(w[0]).toBeLessThanOrEqual(w[1]!)
  await player.close()
  await screenCtx.close()
})
