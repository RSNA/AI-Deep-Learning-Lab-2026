// Phase 3 on the demo pack (engineering spec, section 12.6): the opening letter, the first report,
// a reference map taken and running, the tour, the timer of the round, a map restored, validated
// and deployed, an action of Phase 3, the next report arriving by itself, the reveal, the phone
// with its five tabs, both themes, and the host's view of a player.
import { createRequire } from 'node:module'
import { expect, test, type Page } from '@playwright/test'

const require = createRequire(import.meta.url)
const WebSocket = require('ws') as typeof import('ws')
const PASS = 'e2e-passcode-0123'

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

async function joinPicked(page: Page, code: string, name: string, system: RegExp) {
  await page.goto(`/j/${code}`)
  await page.getByLabel('Name your practice').fill(name)
  await page.getByRole('button', { name: system }).click()
  await page.getByRole('button', { name: 'Join', exact: true }).click()
  await page.getByRole('button', { name: 'Got it' }).click()
}

/**
 * From the lobby to Phase 3 with no map of Phase 2, the clock stopped at the first moment of
 * the year, so that a test reads the opening at its own pace. `resume` starts the rounds.
 */
async function toMaintaining(page: Page, s: Awaited<ReturnType<typeof setup>>) {
  await s.host('next'); await s.host('next')
  await page.getByRole('button', { name: 'Start investigating' }).click()
  await page.getByRole('button', { name: 'End tour' }).click()
  await s.host('end_now'); await s.host('next'); await s.host('next')
  await page.getByRole('button', { name: 'Start building' }).click()
  await page.getByRole('button', { name: 'End tour' }).click()
  await page.getByRole('button', { name: 'Skip the tutorial' }).click()
  await s.host('end_now'); await s.host('next'); await s.host('next')
  await s.host('pause')
  await expect(page.getByText('Phase 3 has started.')).toBeVisible()
}

async function noOverflow(page: Page) {
  const w = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth])
  expect(w[0]).toBeLessThanOrEqual(w[1]!)
}
async function noErrorNames(page: Page) {
  const names = await page.evaluate(() => document.body.innerText.match(/\b[a-z]+_[a-z_]+\b/g) ?? [])
  expect(names).toEqual([])
}
const mapRow = (page: Page, name: string | RegExp) => page.locator('.p3map', { has: page.locator('.p3map-n', { hasText: name }) })

/** Close every letter and memo that opened in a window of its own. */
async function closeLetters(page: Page): Promise<void> {
  const got = page.getByRole('dialog', { name: /^A (letter|memo) for you$/ }).getByRole('button', { name: 'Got it' })
  for (let i = 0; i < 4; i++) {
    try { await got.click({ timeout: 1500 }) } catch { return }
  }
}

test('the laptop: the first report, a reference map, the tour, validate and deploy, an action, the next report, the reveal', async ({ page }, info) => {
  test.skip(info.project.name !== 'laptop', 'laptop only')
  test.setTimeout(150_000)
  const s = await setup(page, 'E2E year laptop')
  await joinPicked(page, s.code, 'Year Laptop', /Riverbend/)
  await toMaintaining(page, s)

  // The opening, in order: the letter, the report on the first two months, the reference maps, the tour.
  await page.getByRole('button', { name: 'Start the year' }).click()
  const first = page.getByRole('dialog', { name: 'Report on January and February' })
  await expect(first).toBeVisible()
  await expect(first.locator('.p3n-l')).toHaveText(['Validity', 'Reliability', 'Score of these two months'])
  // No map came out of Phase 2, so nothing ran: the report says so.
  await expect(first).toContainText('No system ran')
  // The bill: nothing ran, so nothing was paid, and the report says what the account holds.
  await expect(first.locator('.p3money')).toContainText('There is nothing to pay, because no system ran.')
  await expect(first.locator('.p3money')).toContainText('Left in your account')
  await first.getByRole('button', { name: 'Back to the board' }).click()
  // A memo of the first round opens in a window of its own, after the report.
  const memo = page.getByRole('dialog', { name: /^A (letter|memo) for you$/ })
  await expect(memo).toBeVisible()
  await expect(memo).toContainText('You can read it again under Letters and insights.')
  await memo.getByRole('button', { name: 'Got it' }).click()
  const refs = page.getByRole('dialog', { name: 'Proposed systems' })
  await expect(refs).toBeVisible()
  await expect(refs).toContainText('You can switch back to one of your own at any point')
  await expect(refs.getByRole('tab')).toHaveCount(3)
  await refs.getByRole('tab', { name: /Map B/ }).click()
  await expect(refs.locator('.ctile').first()).toBeVisible()
  await refs.getByRole('button', { name: 'Take this system' }).click()
  await expect(refs).toBeHidden()
  await expect(page.locator('.tour-card')).toContainText('Two months at a time')
  for (let i = 0; i < 6; i++) await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.locator('.tour-card')).toContainText('Validate, then deploy')
  await page.getByRole('button', { name: 'Done', exact: true }).click()

  // The board of Phase 2 with the year on it: the timer of the round, the map that runs, the groups of actions.
  await expect(page.locator('.colhead h2')).toHaveText(['Actions', 'Your map', 'Toolbox'])
  await expect(page.locator('.topbar .p3timer')).toContainText('Phase 3 · Round 1 of 5')
  await expect(page.locator('.topbar .p3timer')).toContainText('until the report on March and April')
  await expect(page.locator('.agroup-t')).toContainText(['Watch', 'Maintain'])
  await expect(page.locator('.p3now')).toContainText('System 1')
  const fold = await page.evaluate(() => {
    const g = document.querySelector('.p2-map .cgrid')!.getBoundingClientRect()
    const v = document.querySelector('.p2-map .vbtn')!.getBoundingClientRect()
    return { grid: g.bottom, validate: v.bottom, h: window.innerHeight }
  })
  expect(fold.grid).toBeLessThanOrEqual(fold.h)
  expect(fold.validate).toBeLessThanOrEqual(fold.h)
  await noOverflow(page)

  // The list of maps: the reference map runs. Its map goes back on the canvas and is validated.
  const ref = mapRow(page, /^System 1$/)
  await expect(ref).toContainText('Proposed system · Map B')
  await expect(ref).toContainText('Running now')
  await expect(page.locator('.p3deployline')).toContainText('runs for the next two months')
  // The canvas was empty, so the map that was taken is on it already (spec 6.7, `maintaining.adopt`).
  await expect(ref).toContainText('On your canvas now')
  await expect(page.locator('.p2-map .ctile').first()).toBeVisible()
  await s.host('resume')
  await page.getByRole('button', { name: /^Validate/ }).click()
  // The same map was scored when it was taken, so the screen asks first.
  await expect(page.getByRole('dialog', { name: 'Validate the same map again?' })).toContainText('the map of System 1')
  await page.getByRole('button', { name: 'Validate again' }).click()
  // An action of Phase 3 runs meanwhile.
  // What waits for a round or for a finding is not on the list, and nothing says that it will come.
  await expect(page.locator('.arow[data-action="rb-a-look"]')).toHaveCount(1)
  await expect(page.locator('.arow[data-action="rb-a-rules"]')).toHaveCount(0)
  await expect(page.locator('.arow[data-action="rb-a-compare"]')).toHaveCount(0)
  await expect(page.locator('.agroup', { hasText: 'Maintain' }).locator('.more-line')).toHaveCount(0)
  await expect(page.locator('.schip', { hasText: 'Pine 2' })).toHaveCount(0)
  const tracing = page.locator('.arow', { hasText: 'Turn on tracing' })
  await tracing.getByRole('button', { name: 'Start' }).click()
  await expect(tracing.locator('.ibtn.run')).toBeVisible()
  const mine = mapRow(page, /^System 2$/)
  await expect(mine).toBeVisible({ timeout: 20_000 })
  await mine.getByRole('button', { name: 'Deploy' }).click()
  await expect(mine).toContainText('Running now')
  await expect(ref.getByRole('button', { name: 'Deploy' })).toBeVisible()
  await expect(page.locator('.p3now')).toContainText('System 2')
  await expect(tracing.locator('.ibtn.done')).toBeVisible({ timeout: 20_000 })

  // The next report arrives by itself when the round ends, with what the tracing adds.
  const second = page.getByRole('dialog', { name: 'Report on March and April' })
  await expect(second).toBeVisible({ timeout: 45_000 })
  await expect(second).toContainText('New report')
  await expect(second).toContainText('Ran: System 2')
  await expect(second).toContainText('On the test set this system scored')
  // The sheet holds the numbers and the bill, and nothing else.
  await expect(second.locator('.p3block')).toHaveCount(0)
  await expect(second).not.toContainText('Every part that failed')
  // A map ran these two months: its bill is listed line by line and paid from the account.
  await expect(second.locator('.p3money .kv.part').first()).toBeVisible()
  await expect(second.locator('.p3money')).toContainText('Paid from your account')
  // Under the model calls of a place, every model that ran there says how much it read.
  await expect(second.locator('.p3money .kv.part.sub').first()).toContainText(/ on .+ read about [0-9,]+ tokens per patient/)
  if (process.env.SHOTS_DIR) await second.screenshot({ path: `${process.env.SHOTS_DIR}/report-bill-${test.info().project.name}.png` })
  await noErrorNames(page)
  await second.getByRole('button', { name: 'Back to the board' }).click()
  await closeLetters(page)
  await expect(page.locator('.topbar .p3timer')).toContainText('Round 2 of 5')
  // What the tracing adds is one press away, in the panel of the year.
  await page.locator('#p3-year').getByRole('button', { name: 'More about these two months' }).click()
  await expect(page.locator('#p3-year')).toContainText('Every part that failed')
  // The year: two reports in the chart, and a step back to the first.
  await expect(page.locator('#p3-year .panel-head')).toContainText('2 of 6 reports')
  await expect(page.locator('#p3-year .ydot.score')).toHaveCount(2)
  await page.locator('#p3-year').getByRole('button', { name: 'Earlier report' }).click()
  await expect(page.locator('#p3-year h3')).toHaveText('Report on January and February')
  // News of the round lies among the letters.
  await expect(page.locator('#p2-insights .card.letter').first()).toBeVisible()

  // The reveal.
  await s.host('end_now')
  await expect(page.locator('.reveal-notice')).toContainText('The year is over')
  await expect(page.locator('.p3rev .panel.score')).toContainText('Score of the year')
  await expect(page.locator('.p3rev .bigpts')).toContainText('Phase 3 points')
  await expect(page.locator('#p3-year .panel-head')).toContainText('6 of 6 reports')
  await expect(page.locator('.p3cmp tbody tr')).toHaveCount(5)        // the player, three reference maps, no system
  await expect(page.locator('.p3cmp tbody tr').first()).toContainText('Your year')
  await expect(page.locator('.p3ev').first()).toBeVisible()
  await noOverflow(page)
  await noErrorNames(page)
  // In the dark theme the same page holds.
  await page.getByRole('button', { name: 'Switch to the night theme' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('.p3cmp')).toBeVisible()
  s.close()
})

test('the reveal of Phase 2 steps through the reference maps', async ({ page }, info) => {
  test.skip(info.project.name !== 'laptop', 'laptop only')
  const s = await setup(page, 'E2E reference maps')
  await joinPicked(page, s.code, 'Three Maps', /Riverbend/)
  await s.host('next'); await s.host('next')
  await page.getByRole('button', { name: 'Start investigating' }).click()
  await page.getByRole('button', { name: 'End tour' }).click()
  await s.host('end_now'); await s.host('next'); await s.host('next')
  await page.getByRole('button', { name: 'Start building' }).click()
  await page.getByRole('button', { name: 'End tour' }).click()
  await page.getByRole('button', { name: 'Skip the tutorial' }).click()
  await s.host('end_now')
  const tabs = page.locator('.refseg button')
  await expect(tabs).toHaveCount(3)
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true')
  const before = await page.locator('.p2maps .panel').nth(1).locator('.refsum').innerText()
  await tabs.nth(2).click()
  await expect(page.locator('.p2maps .panel').nth(1).locator('.refsum')).not.toHaveText(before)
  await expect(page.locator('.p2maps .panel').nth(1).locator('.ctile').first()).toBeVisible()
  await noOverflow(page)
  s.close()
})

test('the phone: five tabs that stay on screen, the timer above them, the year and the maps, and the host looks at the player', async ({ page, browser }, info) => {
  test.skip(info.project.name !== 'phone', 'phone only')
  test.setTimeout(90_000)
  const s = await setup(page, 'E2E year phone')
  await joinPicked(page, s.code, 'Year Phone', /Lakeshore/)
  await toMaintaining(page, s)
  await page.getByRole('button', { name: 'Start the year' }).click()
  await page.getByRole('dialog', { name: 'Report on January and February' }).getByRole('button', { name: 'Back to the board' }).click()
  await page.getByRole('dialog', { name: /^A (letter|memo) for you$/ }).getByRole('button', { name: 'Got it' }).click()
  const refs = page.getByRole('dialog', { name: 'Proposed systems' })
  await refs.getByRole('button', { name: 'Take this system' }).click()
  await page.getByRole('button', { name: 'End tour' }).click()
  await expect(page.locator('.ptabs.five .tl')).toHaveText(['Map', 'Actions', 'Toolbox', 'Year', 'Systems'])
  // The tabs end at the bottom of the screen, whatever the tab holds.
  const tabs = await page.evaluate(() => { const b = document.querySelector('.ptabs')!.getBoundingClientRect(); return { bottom: Math.round(b.bottom), h: window.innerHeight, doc: document.documentElement.scrollHeight } })
  expect(tabs.bottom).toBeLessThanOrEqual(tabs.h)
  expect(tabs.doc).toBeLessThanOrEqual(tabs.h)
  await expect(page.locator('.p3timer.strip')).toContainText('until the report on March and April')
  await page.locator('.ptabs button', { hasText: 'Year' }).click()
  await expect(page.locator('#p3-year h3')).toHaveText('Report on January and February')
  await expect(page.locator('#p3-year .p3n-l').first()).toHaveText('Validity')
  await noOverflow(page)
  await page.locator('.ptabs button', { hasText: 'Systems' }).click()
  await expect(page.locator('.p3map').first()).toContainText('Running now')
  await page.getByRole('button', { name: 'Proposed systems' }).click()
  await expect(page.getByRole('dialog', { name: 'Proposed systems' })).toContainText('In your systems')
  await page.getByRole('dialog', { name: 'Proposed systems' }).getByRole('button', { name: 'Close', exact: true }).last().click()
  await page.locator('.ptabs button', { hasText: 'Actions' }).click()
  await expect(page.locator('.agroup-t')).toContainText(['Watch', 'Maintain'])
  await noOverflow(page)
  await noErrorNames(page)

  // The host's view of this player: a Phase 3 tab that opens with the glimpse.
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const hp = await ctx.newPage()
  await hp.goto('/host')
  await hp.evaluate((t) => localStorage.setItem('lab02.host', JSON.stringify({ token: t, name: 'E2E host' })), s.token)
  await hp.goto(`/host?s=${s.code}`)
  await hp.locator('.plook').first().click()
  const look = hp.getByRole('dialog')
  await expect(look).toContainText('Only facilitators see this page')
  await expect(look.getByRole('tab', { name: 'Phase 3' })).toHaveAttribute('aria-selected', 'true')
  const coach = look.locator('.coach')
  await expect(coach.locator('.eyebrow').first()).toHaveText('What holds them back')
  await expect(coach).toContainText('Worth saying')
  await expect(coach).toContainText('What is good')
  await expect(look.locator('.inspect-top')).toContainText('Round 1 of 5')
  await expect(look.locator('.insp-year tbody tr')).toHaveCount(1)
  await expect(look.locator('.insp-map .ctile').first()).toBeVisible()
  const folded = look.locator('details', { hasText: 'The proposed system' })
  await folded.locator('summary').click()
  await expect(folded.locator('.hchip')).toHaveCount(3)
  await folded.locator('.hchip').first().click()
  await expect(folded.locator('.cgrid')).toBeVisible()
  expect(await hp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await ctx.close()
  s.close()
})
