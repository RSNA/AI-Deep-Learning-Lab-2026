// Join, lobby, refresh, a closed browser that returns with the rejoin code, the host console
// driving the stages and the big screen following. Nothing overflows; every action is a tap.
import { expect, test, type Page } from '@playwright/test'

const PASS = 'e2e-passcode-0123'

async function hostApi(page: Page) {
  const token = (await (await page.request.post('/api/host/login', { data: { passcode: PASS } })).json()).token as string
  const auth = { authorization: `Bearer ${token}` }
  return {
    token,
    async session(label: string) {
      const r = await page.request.post('/api/host/session', { data: { label, mode: 'test' }, headers: auth })
      return (await r.json()).code as string
    },
    async screenPath(code: string) {
      return (await (await page.request.post('/api/host/screen-link', { data: { code }, headers: auth })).json()).path as string
    },
  }
}

async function noOverflow(page: Page) {
  const w = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth])
  expect(w[0]).toBeLessThanOrEqual(w[1]!)
}

test('join, lobby, refresh and rejoin with the code', async ({ page, browser }, info) => {
  const api = await hostApi(page)
  const code = await api.session(`E2E ${info.project.name}`)
  await page.goto('/')
  await expect(page).toHaveURL(new RegExp(`/j/${code}`))
  await page.getByRole('button', { name: /Character 3/ }).click()
  await page.getByLabel('Name your practice').fill(`Tester ${info.project.name}`)
  await noOverflow(page)
  await page.getByRole('button', { name: 'Join', exact: true }).click()
  await expect(page).toHaveURL(/\/play$/)
  const codeBox = page.getByLabel(/Rejoin code/)
  await expect(codeBox).toBeVisible()
  const rejoin = ((await codeBox.textContent()) ?? '').trim()
  expect(rejoin).toMatch(/^[A-Z2-9]{6}$/)
  await page.getByRole('button', { name: 'Got it' }).click()
  await expect(page.getByText('How to play').first()).toBeVisible()
  await expect(page.locator('.room')).toBeVisible()
  // The art arrived under the content security policy, as a scene or as the still image.
  await expect(page.locator('.room[data-ready]')).toHaveCount(1, { timeout: 10_000 })
  await noOverflow(page)

  // A refresh returns to the practice without a question.
  await page.reload()
  await expect(page.getByText('How to play').first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Got it' })).toHaveCount(0)

  // The same name again is refused and offers the rejoin field.
  const other = await browser.newContext()
  const p2 = await other.newPage()
  await p2.goto(`/j/${code}`)
  await p2.getByLabel('Name your practice').fill(`tester ${info.project.name}`)
  await p2.getByRole('button', { name: 'Join', exact: true }).click()
  await expect(p2.getByText(/already in the game/)).toBeVisible()
  await p2.getByRole('button', { name: 'Rejoin with a code' }).first().click()
  await p2.getByLabel('Rejoin code').fill(rejoin.toLowerCase())
  await p2.getByRole('button', { name: 'Rejoin', exact: true }).click()
  await expect(p2).toHaveURL(/\/play$/)
  await expect(p2.getByText('How to play').first()).toBeVisible()
  // The first browser is told the practice moved.
  await expect(page.getByText(/open on another device|no longer holds/)).toBeVisible()
  await other.close()
})

test('the host drives every stage and the big screen follows', async ({ page, browser }, info) => {
  test.skip(info.project.name === 'phone', 'The host console and the big screen are laptop views.')
  const api = await hostApi(page)
  const code = await api.session('E2E host')
  const player = await browser.newContext()
  const pp = await player.newPage()
  await pp.goto(`/j/${code}`)
  await pp.getByLabel('Name your practice').fill('Screen Tester')
  await pp.getByRole('button', { name: 'Join', exact: true }).click()
  await pp.getByRole('button', { name: 'Got it' }).click()

  const screenCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } })
  const screen = await screenCtx.newPage()
  await screen.goto(await api.screenPath(code))
  await expect(screen.getByText('Just arrived')).toBeVisible()
  await expect(screen.getByText('Screen Tester')).toBeVisible()

  await page.goto('/host')
  await page.evaluate((t) => localStorage.setItem('lab02.host', JSON.stringify({ token: t })), api.token)
  await page.goto(`/host?s=${code}`)
  await expect(page.getByText('Now on stage')).toBeVisible()
  await expect(page.getByText('Screen Tester')).toBeVisible()
  await noOverflow(page)

  const next = page.getByRole('button', { name: /^Next:/ })
  await next.click()
  await expect(screen.getByText('The game starts in a moment.')).toBeVisible()
  await next.click()
  await expect(screen.getByText('Phase 1 of 3 · Planning')).toBeVisible()
  await expect(pp.getByRole('button', { name: 'Start investigating' })).toBeVisible()
  await pp.getByRole('button', { name: 'Start investigating' }).click()
  await page.getByRole('button', { name: '+30 s' }).click()
  await page.getByRole('button', { name: 'Pause' }).click()
  await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible()
  await page.getByRole('button', { name: 'Resume' }).click()
  await page.getByRole('button', { name: 'End now' }).click()
  await expect(pp.getByText('The corrected board')).toBeVisible()
  const stageTitle = page.getByText('Now on stage').locator('xpath=following-sibling::*[1]')
  for (let i = 0; i < 14; i++) {
    const before = await stageTitle.textContent()
    if (before === 'Winners') break
    const end = page.getByRole('button', { name: 'End now', exact: true })
    const usable = async (l: typeof end) => { try { return (await l.count()) === 1 && (await l.isEnabled()) } catch { return false } }
    await expect.poll(async () => (await usable(end)) || (await usable(next)), { timeout: 10_000 }).toBe(true)
    const btn = (await usable(end)) ? end : next
    // The pressed state moves the button 2 px, which Playwright reads as unstable. One click is enough.
    await btn.click({ force: true })
    await expect(stageTitle).not.toHaveText(before ?? '')
  }
  await expect(screen.getByText('Top practices')).toBeVisible()
  await expect(pp.getByText('Thank you for playing')).toBeVisible()
  await screenCtx.close()
  await player.close()
})
