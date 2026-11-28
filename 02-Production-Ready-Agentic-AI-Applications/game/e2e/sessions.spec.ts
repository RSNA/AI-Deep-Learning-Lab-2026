// Sessions in the browser, on the demo pack (engineering spec, sections 6.4, 6.14, 7.2, 10.2,
// 10.7 and 10.8): a single-player game from the start page to its report card, the games a
// browser kept and a phase looked at again, one session with a facilitator at a time with the
// warning before it is replaced, a name changed, and a late joiner who waits for the next phase.
import { createRequire } from 'node:module'
import { expect, test, type Page } from '@playwright/test'

const require = createRequire(import.meta.url)
const WebSocket = require('ws') as typeof import('ws')
const PASS = 'e2e-passcode-0123'
const BASE = new URL(`http://127.0.0.1:${process.env.E2E_PORT ?? 3200}`)

async function hostToken(page: Page): Promise<string> {
  return (await (await page.request.post('/api/host/login', { data: { passcode: PASS } })).json()).token as string
}

/** A session with a facilitator, opened in place of whatever runs, with a socket that drives it. */
async function setup(page: Page, label: string) {
  const token = await hostToken(page)
  const code = (await (await page.request.post('/api/host/session', { data: { label, mode: 'rehearsal', by: 'Test bot', replace: {} }, headers: { authorization: `Bearer ${token}` } })).json()).code as string
  const ws = new WebSocket(`ws://${BASE.host}/ws`, { headers: { origin: BASE.origin } })
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

/** No session with a facilitator is open, and single-player games are switched on. */
async function quiet(page: Page): Promise<string> {
  const s = await setup(page, 'To be ended')
  expect((await s.host('close', { confirm: s.code })).ok).toBe(true)
  s.close()
  await page.request.post('/api/host/solo', { data: { enabled: true }, headers: { authorization: `Bearer ${s.token}` } })
  return s.token
}

async function stageOf(page: Page, code: string): Promise<string> {
  return ((await (await page.request.get(`/api/session/${code}`)).json()) as { stage: string }).stage
}
async function toStage(page: Page, s: Awaited<ReturnType<typeof setup>>, stage: string) {
  for (let i = 0; i < 60; i++) {
    if ((await stageOf(page, s.code)) === stage) return
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

/** The player of a single-player game moves it on, through letters, tours and slides, until `done`. */
async function soloUntil(page: Page, done: () => Promise<boolean>) {
  const bar = page.locator('.solobar')
  for (let i = 0; i < 120; i++) {
    if (await done()) return
    // A phase opens with its letter, then a tour, and Phase 3 with its first report and the
    // reference maps: each is closed as a player would. While one of them covers the page nothing else is pressed.
    if (await page.locator('.scrim, [role="dialog"]').first().isVisible().catch(() => false)) {
      const close = page.getByRole('button', { name: /^(Start investigating|Start building|Start the year|End tour|Close)$|Back to the board/ }).first()
      if (await close.isVisible().catch(() => false)) await close.click()
      await page.waitForTimeout(200)
      continue
    }
    // The guided first build of Phase 2 is not what this player came for.
    const skip = page.getByRole('button', { name: 'Skip the tutorial' })
    if (await skip.isVisible().catch(() => false)) { await skip.click(); continue }
    const end = bar.getByRole('button', { name: 'End this phase now' })
    if (await end.isVisible().catch(() => false)) {
      await end.click()
      await page.getByRole('dialog').getByRole('button', { name: 'End the phase' }).click()
      await expect(end).toHaveCount(0)
      continue
    }
    const go = bar.locator('.acts .btn.go')
    if (await go.isVisible().catch(() => false)) {
      // What the press changes: the strip, or the slide under it.
      const now = () => page.evaluate(() => `${document.querySelector('.solobar')?.textContent ?? ''}|${document.querySelector('.pslide')?.textContent ?? ''}`)
      const before = await now()
      await go.click()
      await expect.poll(async () => (await done()) || (await now()) !== before, { timeout: 8000 }).toBe(true)
      continue
    }
    await page.waitForTimeout(150)
  }
  throw new Error('the single-player game did not get there')
}

test('a single-player game from the start page to its report card, and the games of the browser afterwards', async ({ page }, info) => {
  test.setTimeout(180_000)
  await quiet(page)
  await page.goto('/')
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByText('No session with a facilitator is open right now.')).toBeVisible()
  await expect(page.locator('.panel-head', { hasText: 'Play on your own' })).toBeVisible()
  await expect(page.getByText('Your games in this browser')).toHaveCount(0)
  // A name that is too short keeps the button off.
  const start = page.getByRole('button', { name: 'Start a single-player game' })
  await page.getByLabel('Name your practice').fill('ab')
  await expect(start).toBeDisabled()
  await page.getByRole('button', { name: /Character 4/ }).click()
  await page.getByLabel('Name your practice').fill(`Solo ${info.project.name}`)
  // A single-player game asks for a passcode: the button waits for it, and a wrong one says so.
  await expect(start).toBeDisabled()
  await page.getByLabel('Passcode').fill('not the passcode')
  await start.click()
  await expect(page.locator('#solo-pass-err')).toContainText('That passcode is not right.')
  await page.getByLabel('Passcode').fill(PASS)
  await noOverflow(page)
  await start.click()
  await expect(page).toHaveURL(/\/play$/)
  await page.getByRole('button', { name: 'Got it' }).click()

  // The lobby waits for the player, who has no rank to look at and nobody to wait for.
  const bar = page.locator('.solobar')
  await expect(bar).toContainText('Single player')
  if (info.project.name === 'laptop') await expect(bar).toContainText('You set the pace.')
  await expect(page.locator('.rankbtn')).toHaveCount(0)
  await expect(page.getByText('I am in. Ready when you are.')).toBeVisible()
  await noOverflow(page)
  await noErrorNames(page)
  await bar.getByRole('button', { name: /^Start/ }).click()

  // The slides of the intro are the player's to step through, forward and back.
  await expect(page.locator('.pslide')).toBeVisible()
  if (info.project.name === 'laptop') await expect(bar).toContainText('Read the slide, then go on.')
  await expect(bar.getByRole('button', { name: /Back/ })).toBeDisabled()
  const count = () => page.evaluate(() => document.querySelector('.pslide')?.textContent ?? '')
  const first = await count()
  await bar.getByRole('button', { name: /Next slide/ }).click()
  await expect.poll(count).not.toBe(first)
  await bar.getByRole('button', { name: /Back/ }).click()
  await expect.poll(count).toBe(first)
  // Buttons of one row share their height.
  const heights = await bar.locator('.btn').evaluateAll((els) => [...new Set(els.map((el) => Math.round(el.getBoundingClientRect().height)))])
  expect(heights).toHaveLength(1)
  await noOverflow(page)

  // On to Phase 1, where the phase can be ended early after a question.
  await soloUntil(page, async () => (await bar.getByRole('button', { name: 'End this phase now' }).isVisible().catch(() => false)) && !(await page.locator('.scrim, [role="dialog"]').first().isVisible().catch(() => false)))
  if (info.project.name === 'laptop') await expect(bar).toContainText('The phase stays open until you end it.')
  await bar.getByRole('button', { name: 'End this phase now' }).click()
  await expect(page.getByRole('dialog')).toContainText('The phase is scored as it stands')
  await page.getByRole('dialog').getByRole('button', { name: 'Stay' }).click()
  await expect(bar.getByRole('button', { name: 'End this phase now' })).toBeVisible()
  await noOverflow(page)

  // A reload in the middle of the game brings it back as it was.
  await page.reload()
  await expect(bar.getByRole('button', { name: 'End this phase now' })).toBeVisible()

  // Through the three phases to the end: the report card, then the result page of the game.
  await soloUntil(page, async () => /\/result\//.test(page.url()))
  await expect(page.getByRole('heading', { name: 'Your result' })).toBeVisible()
  await expect(page.getByRole('article', { name: 'Your report card' })).toBeVisible()
  await expect(page.getByRole('article', { name: 'Your report card' })).not.toContainText('Overall rank')
  await expect(page.getByText('Look at each phase again')).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('lab02.player'))).toBeNull()
  await noOverflow(page)
  await noErrorNames(page)

  // Each phase opens again as it was shown at its reveal, and the way leads back.
  for (const phase of ['Phase 1', 'Phase 2', 'Phase 3']) {
    await page.locator('.menulist .btn', { hasText: phase }).click()
    await expect(page.getByRole('button', { name: /Back to your result/ })).toBeVisible()
    await expect(page.locator('main').first()).toBeVisible()
    await noErrorNames(page)
    await page.getByRole('button', { name: /Back to your result/ }).click()
    await expect(page.getByText('Look at each phase again')).toBeVisible()
  }

  // The start page lists the game with its points, and a second game can be started.
  await page.getByRole('button', { name: 'Back to the start page' }).click()
  await expect(page).toHaveURL(/\/home$/)
  const games = page.locator('.gamerow')
  await expect(games).toHaveCount(1)
  await expect(games.first()).toContainText('Single player')
  await expect(games.first()).toContainText(/\d+ of 3000 points/)
  await expect(games.first().getByRole('button', { name: 'Continue' })).toHaveCount(0)
  await page.getByLabel('Name your practice').fill(`Again ${info.project.name}`)
  await page.getByLabel('Passcode').fill(PASS)
  await page.getByRole('button', { name: 'Start a single-player game' }).click()
  await expect(page).toHaveURL(/\/play$/)
  await page.getByRole('button', { name: 'Got it' }).click()
  // Leaving it from the menu keeps it: it waits in the list, and Continue goes back in.
  await page.getByRole('button', { name: 'Menu' }).click()
  await page.getByRole('button', { name: /Leave this game/ }).click()
  await expect(page).toHaveURL(/\/home$/)
  await expect(games).toHaveCount(2)
  await expect(games.first()).toContainText('In progress')
  await noOverflow(page)
  await games.first().getByRole('button', { name: 'Continue' }).click()
  await expect(page).toHaveURL(/\/play$/)
  await expect(page.locator('.solobar').getByRole('button', { name: /^Start/ })).toBeVisible()
  // The first game still shows its result from the list.
  await page.goto('/home')
  await games.nth(1).getByRole('button', { name: 'See the result' }).click()
  await expect(page).toHaveURL(/\/result\//)
  await expect(page.getByRole('article', { name: /report card|result so far/ })).toBeVisible()
})

test('single-player games in the console: the switch, the list and the cleanup', async ({ page, browser }, info) => {
  test.skip(info.project.name !== 'laptop', 'the console is for a laptop')
  const token = await quiet(page)
  const visitor = await browser.newContext()
  const vp = await visitor.newPage()
  await vp.goto('/')
  await vp.getByLabel('Name your practice').fill('Console Branch')
  await vp.getByLabel('Passcode').fill(PASS)
  await vp.getByRole('button', { name: 'Start a single-player game' }).click()
  await expect(vp).toHaveURL(/\/play$/)

  await page.goto('/host')
  await page.evaluate((t) => localStorage.setItem('lab02.host', JSON.stringify({ token: t, name: 'Maya' })), token)
  await page.goto('/host')
  const panel = page.locator('section.panel', { has: page.locator('.panel-head', { hasText: 'Single player' }) })
  await expect(panel.getByRole('radio', { name: 'On' })).toHaveAttribute('aria-checked', 'true')
  await expect(panel).toContainText(/in play right now/)
  await panel.getByRole('button', { name: /Show the newest/ }).click()
  await expect(panel.locator('.srow', { hasText: 'Console Branch' })).toContainText('In play now')
  // The solo game has no console of its own: no Open button anywhere in its row.
  await expect(panel.locator('.srow', { hasText: 'Console Branch' }).getByRole('button')).toHaveText(['Delete'])

  // Off: the start page says so, and offers nothing to start.
  await panel.getByRole('radio', { name: 'Off' }).click()
  await expect(panel.getByRole('radio', { name: 'Off' })).toHaveAttribute('aria-checked', 'true')
  const other = await browser.newContext()
  const op = await other.newPage()
  await op.goto('/')
  await expect(op.getByText('Single-player games are switched off right now.')).toBeVisible()
  await expect(op.getByRole('button', { name: 'Start a single-player game' })).toHaveCount(0)
  await other.close()
  await panel.getByRole('radio', { name: 'On' }).click()
  await expect(panel.getByRole('radio', { name: 'On' })).toHaveAttribute('aria-checked', 'true')

  // Everything at once, after typing the word. The player of a game in play is told that it is gone.
  await panel.getByRole('button', { name: 'Delete all single-player games' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('Sessions with a facilitator are not touched.')
  await expect(dialog.getByRole('button', { name: 'Delete for good' })).toBeDisabled()
  await dialog.getByLabel('Type DELETE to confirm').fill('DELETE')
  await dialog.getByRole('button', { name: 'Delete for good' }).click()
  await expect(panel).toContainText('No single-player game has been started.')
  await expect(vp.getByText('This game has ended')).toBeVisible({ timeout: 15_000 })
  await noErrorNames(page)
  await noOverflow(page)
  await visitor.close()
})

test('one session with a facilitator at a time: the warning, the new session, and a name that changes', async ({ page }, info) => {
  test.skip(info.project.name !== 'laptop', 'the console is for a laptop')
  const s = await setup(page, 'The morning session')
  s.close()
  await page.goto('/host')
  await page.evaluate((t) => localStorage.setItem('lab02.host', JSON.stringify({ token: t, name: 'Grace' })), s.token)
  await page.goto('/host')
  const row = page.locator('.srow', { hasText: s.code })
  await expect(row).toContainText('Opened by Test bot')

  // The name of a new session starts as the date and the time.
  await expect(page.getByLabel('Label')).not.toHaveValue('')
  await page.getByLabel('Label').fill('The noon session')
  await page.getByRole('button', { name: 'Create' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('Another session is running')
  await expect(dialog).toContainText(`"The morning session" (${s.code}) is open, started by Test bot`)
  await expect(dialog).toContainText('that session ends for everyone in it')
  await noErrorNames(page)
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  expect(await stageOf(page, s.code)).toBe('lobby')

  // Renamed while it waits in the lobby.
  await row.getByRole('button', { name: 'Rename' }).click()
  await page.getByRole('dialog').getByLabel('Label').fill('The morning session, room B')
  await page.getByRole('dialog').getByRole('button', { name: 'Save the name' }).click()
  await expect(row).toContainText('The morning session, room B')

  await page.getByRole('button', { name: 'Create' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'End it and start the new session' }).click()
  await expect(page).toHaveURL(/\/host\?s=/)
  expect(await stageOf(page, s.code)).toBe('closed')
  const code2 = new URL(page.url()).searchParams.get('s')!
  expect(code2).not.toBe(s.code)
  expect(await stageOf(page, code2)).toBe('lobby')

  // Once it runs, the name stays: the button says why. After it has ended it can change again.
  await page.goto('/host')
  const row2 = page.locator('.srow', { hasText: code2 })
  await expect(row2).toContainText('Opened by Grace')
  await expect(row2.getByRole('button', { name: 'Rename' })).toBeEnabled()
  const token = s.token
  const ended = await page.request.post(`/api/host/session/${code2}/end`, { data: { name: 'Grace' }, headers: { authorization: `Bearer ${token}` } })
  expect(ended.ok()).toBe(true)
  await page.reload()
  await page.getByRole('button', { name: /Show closed sessions/ }).click()
  await page.locator('.srow', { hasText: code2 }).getByRole('button', { name: 'Rename' }).click()
  await page.getByRole('dialog').getByLabel('Label').fill('The noon session, kept')
  await page.getByRole('dialog').getByRole('button', { name: 'Save the name' }).click()
  await expect(page.locator('.srow', { hasText: code2 })).toContainText('The noon session, kept')
  await noOverflow(page)
})

test('a late joiner waits with the leaderboard and the slides, and starts with the next phase', async ({ page, browser }, info) => {
  const s = await setup(page, `Late ${info.project.name}`)
  const early = await browser.newContext()
  const ep = await early.newPage()
  await ep.goto(`/j/${s.code}`)
  await ep.getByLabel('Name your practice').fill('On Time Branch')
  await ep.getByRole('button', { name: 'Join', exact: true }).click()
  await ep.getByRole('button', { name: 'Got it' }).click()
  await s.host('next')
  await s.host('slide', { delta: 1 })
  await s.host('next')
  expect(await stageOf(page, s.code)).toBe('planning.play')

  // The join page says what joining now means.
  await page.goto(`/j/${s.code}`)
  await expect(page.locator('.snote')).toContainText('Phase 1 is in play. Join now and you wait')
  await page.getByLabel('Name your practice').fill('Late Branch')
  await noOverflow(page)
  await page.getByRole('button', { name: 'Join', exact: true }).click()
  await page.getByRole('button', { name: 'Got it' }).click()
  const room = page.locator('.waitroom')
  await expect(room).toContainText('Phase 1 is in play')
  await expect(room).toContainText('You start with Phase 2')
  await expect(room.locator('.lb-row', { hasText: 'On Time Branch' }).first()).toBeVisible()
  await expect(room.locator('.waitslides button')).toHaveCount(2)
  // A slide opens large and can be stepped through.
  await room.locator('.waitslides button').first().click()
  await expect(room.locator('.waitbig')).toContainText('Slide 1 of 2')
  await room.getByRole('button', { name: 'Next slide' }).click()
  await expect(room.locator('.waitbig')).toContainText('Slide 2 of 2')
  await noOverflow(page)
  await room.getByRole('button', { name: 'Close' }).click()
  await expect(room.locator('.waitslides button')).toHaveCount(2)
  await noErrorNames(page)

  // Phase 1 ends: still waiting. Phase 2 starts: in the game, with the letter of the phase.
  await s.host('end_now')
  await expect(room).toContainText('Phase 1 has ended')
  await toStage(page, s, 'development.play')
  await expect(page.getByRole('button', { name: 'Start building' })).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.waitroom')).toHaveCount(0)

  // The last phase runs: nobody joins, and the page shows the leaderboard and the way to a game alone.
  await toStage(page, s, 'maintaining.year')
  await page.request.post('/api/host/solo', { data: { enabled: true }, headers: { authorization: `Bearer ${s.token}` } })
  const outside = await browser.newContext()
  const xp = await outside.newPage()
  await xp.goto(`/j/${s.code}`)
  await expect(xp.getByText('The last phase is in play, so nobody can join this game any more.')).toBeVisible()
  await expect(xp.getByLabel('Name your practice')).toHaveCount(0)
  await expect(xp.locator('.lb-row', { hasText: 'On Time Branch' }).first()).toBeVisible()
  await expect(xp.getByRole('button', { name: 'Play on your own' })).toBeVisible()
  await noOverflow(xp)
  await noErrorNames(xp)
  await xp.getByRole('button', { name: 'Play on your own' }).click()
  await expect(xp).toHaveURL(/\/home$/)
  await expect(xp.locator('.panel-head', { hasText: 'A session is open' })).toBeVisible()
  await outside.close()
  await early.close()
  s.close()
})
