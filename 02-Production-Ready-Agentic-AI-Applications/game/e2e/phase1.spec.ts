// Phase 1 and the round 8 screens on the demo pack (engineering spec, section 12.6): the three
// columns, the assessment of five sections with the class buttons and a full class, a refresh,
// a card opened large, the reveal; the phone tabs; the lobby and the living scene; the host
// console with two windows, the pin banner, the slides and the manual; refusals in plain words.
import { createRequire } from 'node:module'
import { expect, test, type Page } from '@playwright/test'

const require = createRequire(import.meta.url)
const WebSocket = require('ws') as typeof import('ws')
const PASS = 'e2e-passcode-0123'

async function setup(page: Page, label: string) {
  const token = (await (await page.request.post('/api/host/login', { data: { passcode: PASS } })).json()).token as string
  const code = (await (await page.request.post('/api/host/session', { data: { label, mode: 'rehearsal', replace: {} }, headers: { authorization: `Bearer ${token}` } })).json()).code as string
  const base = new URL(`http://127.0.0.1:${process.env.E2E_PORT ?? 3200}`)   // the e2e server of playwright.config.ts
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

/** No error name with an underscore is on the page. */
async function noErrorNames(page: Page) {
  const names = await page.evaluate(() => document.body.innerText.match(/\b[a-z]+_[a-z_]+\b/g) ?? [])
  expect(names).toEqual([])
}

const unsortedTitles = (page: Page) => page.locator('.asec.unsorted .acard .at').allTextContents()
const classTitles = (page: Page, i: number) => page.locator('.asec[data-class]').nth(i).locator('.acard .at > span:first-child').allTextContents()

test('the laptop screen: three columns, the assessment, a full class, a refresh, a card opened large, the reveal', async ({ page }, info) => {
  test.skip(info.project.name !== 'laptop', 'laptop only')
  const s = await setup(page, 'E2E board laptop')
  await joinPicked(page, s.code, 'Board Laptop', /Lakeshore/)
  await expect(page.locator('.sysbadge')).toContainText('Lakeshore')
  await s.host('next'); await s.host('next')
  // The opening letter pops up once, and stays as the first card.
  await expect(page.getByText('A letter for you')).toBeVisible()
  await page.getByRole('button', { name: 'Start investigating' }).click()
  await page.getByRole('button', { name: 'End tour' }).click()
  await expect(page.locator('.colhead h2')).toHaveText(['Investigations', 'Evidence', 'Your assessment'])
  await expect(page.locator('.cards .card').first()).toHaveAttribute('data-card', 'letter')
  await expect(page.locator('.ask')).toHaveText('Find the 1 problem that needs an agentic system, the 1 that needs one AI model, the 2 that need no AI and the 2 that are not real.')
  await expect(page.locator('.asec.unsorted .acard')).toHaveCount(6)
  await expect(page.locator('.asec[data-class]')).toHaveCount(4)
  await expect(page.locator('.spot, [draggable="true"]')).toHaveCount(0)
  await noOverflow(page)

  // The classes read from the most automation down: Agentic, One model, No AI, Not a problem.
  await expect(page.locator('.asec[data-class] .ahead .an')).toContainText(['Agentic', 'One model', 'No AI', 'Not real'])
  await expect(page.locator('.asec.unsorted .acard').first().locator('.four button:not(.clr)')).toContainText(['Agentic', 'One model', 'No AI', 'Not real'])
  // A press moves the card into its section, at the end. Back to Unsorted keeps pack order.
  const all = await unsortedTitles(page)
  await page.locator('.asec.unsorted .acard').first().locator('.four button').nth(3).click()
  await expect.poll(() => classTitles(page, 3)).toEqual([all[0]])
  await expect(page.locator('.asec[data-class]').nth(3).locator('.ahead')).toContainText('1 of 2')
  await page.locator('.asec.unsorted .acard').first().locator('.four button').nth(3).click()
  await expect.poll(() => classTitles(page, 3)).toEqual([all[0], all[1]])
  // Straight to another class, then back to Unsorted.
  await page.locator('.asec[data-class]').nth(3).locator('.acard').first().locator('.four button').nth(2).click()
  await expect.poll(() => classTitles(page, 2)).toEqual([all[0]])
  await page.locator('.asec[data-class]').nth(2).locator('.acard').first().getByRole('button', { name: 'Back to Unsorted' }).click()
  await expect.poll(() => unsortedTitles(page)).toEqual(all.filter((t) => t !== all[1]))

  // The keys: 1 to 4 pick a class in the order shown, 0 sends back.
  const card = page.locator('.asec.unsorted .acard').first()
  const t1 = (await card.locator('.at').textContent())!
  await card.focus()
  await page.keyboard.press('1')
  await expect.poll(() => classTitles(page, 0)).toEqual([t1])
  // A full class asks which problem goes back to Unsorted.
  const next = page.locator('.asec.unsorted .acard').first()
  const t2 = (await next.locator('.at').textContent())!
  await next.locator('.four button').nth(0).click()
  await expect(page.getByText('Agentic is full. Which problem goes back to Unsorted?')).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: new RegExp(t1.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).click()
  await expect.poll(() => classTitles(page, 0)).toEqual([t2])
  await expect.poll(() => unsortedTitles(page)).toContain(t1)
  // A sorted card is compact and opens on a click.
  const sorted = page.locator('.asec[data-class]').nth(0).locator('.acard').first()
  await expect(sorted.locator('.ad')).toHaveCount(0)
  await sorted.locator('button.at').click()
  await expect(sorted.locator('.ad')).toHaveCount(1)
  for (let i = 0; i < 4; i++) {
    const spots = Number(((await page.locator('.strip > div').nth(i).locator('.n').textContent()) ?? '').split(' of ')[1])
    expect((await classTitles(page, i)).length).toBeLessThanOrEqual(spots)
  }

  // A refresh brings the same assessment back, and the letter does not pop up again.
  await page.waitForTimeout(800)
  await page.reload()
  await expect.poll(() => classTitles(page, 0)).toEqual([t2])
  await expect(page.getByText('A letter for you')).toHaveCount(0)

  // The panel: the practice facts, then collapsed.
  await page.locator('.ebar button', { hasText: 'Practice facts' }).click()
  await expect(page.locator('.eview .facts')).toBeVisible()
  await page.locator('.ebar .hide').click()
  await expect(page.locator('.eview')).toHaveCount(0)
  await page.locator('.ebar button', { hasText: 'Reading room' }).click()
  await expect(page.locator('.eview .room')).toBeVisible()
  await expect(page.locator('.wall .sizable-edge')).toHaveAttribute('role', 'separator')

  // An interview, its lines under its row, its card on the wall, opened large.
  await page.locator('.irow:has(.m-int) .ibtn.start').first().click()
  await expect(page.locator('.irow.run .iline').first()).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.cards .card')).toHaveCount(2, { timeout: 20_000 })
  await page.locator('.cards .card').nth(1).click()
  await expect(page.locator('.overlay')).toBeVisible()
  await expect(page.locator('.ovcount')).toHaveText('Card 2 of 2')
  await page.keyboard.press('ArrowLeft')
  await expect(page.locator('.ovcount')).toHaveText('Card 1 of 2')
  // The assessment stays free beside the overlay.
  await page.locator('.asec.unsorted .acard').first().locator('.four button').nth(1).click()
  await page.locator('.ovbox').focus()
  await page.keyboard.press('Escape')
  await expect(page.locator('.overlay')).toHaveCount(0)
  const small = await page.evaluate(() => [...document.querySelectorAll('.cards .card p, .cards .card .say, .cards .card .lab')].filter((e) => parseFloat(getComputedStyle(e).fontSize) < 14).length)
  expect(small).toBe(0)
  await noOverflow(page)
  await noErrorNames(page)

  // The reveal: the agent project across the row, every problem marked, the score in words.
  await s.host('end_now')
  await expect(page.getByText('The corrected assessment')).toBeVisible()
  await expect(page.locator('.agentrow .costbox')).toBeVisible()
  await expect(page.locator('.rthree .rprob')).toHaveCount(5)
  await expect(page.getByText('Raw score')).toHaveCount(0)
  await expect(page.getByText(/provisional/i)).toHaveCount(0)
  await noErrorNames(page)
  s.close()
})

test('an empty assessment is said once at the top, and the letter has its empty line', async ({ page }, info) => {
  test.skip(info.project.name !== 'laptop', 'laptop only')
  const s = await setup(page, 'E2E empty')
  await joinPicked(page, s.code, 'Empty Laptop', /Riverbend/)
  await s.host('next'); await s.host('next')
  await page.getByRole('button', { name: 'Start investigating' }).click()
  await page.getByRole('button', { name: 'End tour' }).click()
  await s.host('end_now')
  await expect(page.getByText('You sent an empty assessment, so no problem scored.')).toBeVisible()
  await expect(page.locator('.rpick')).toHaveCount(0)
  await expect(page.getByText('You sent me an almost empty board.', { exact: false })).toBeVisible()
  s.close()
})

test('the phone: three tabs, the same assessment, a full class, the evidence and back', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'phone only')
  const s = await setup(page, 'E2E board phone')
  await joinPicked(page, s.code, 'Board Phone', /Riverbend/)
  await s.host('next'); await s.host('next')
  await page.getByRole('button', { name: 'Start investigating' }).tap()
  await page.getByRole('button', { name: 'End tour' }).tap()
  // The assessment comes first, and the screen opens on it.
  await expect(page.locator('.ptabs button .tl')).toHaveText(['Assessment', 'Investigations', 'Evidence'])
  await expect(page.locator('.ptabs button').first()).toHaveAttribute('aria-pressed', 'true')
  await page.locator('.ptabs button', { hasText: 'Investigations' }).tap()
  await expect(page.locator('.bwrow')).toBeVisible()
  await page.locator('.ptabs button', { hasText: 'Assessment' }).tap()
  await expect(page.locator('.asec.unsorted .acard')).toHaveCount(6)
  await page.locator('.asec.unsorted .acard').nth(0).locator('.four button').nth(0).tap()
  await expect(page.locator('.strip > div').nth(0)).toContainText('1 of 1')
  await page.locator('.asec.unsorted .acard').nth(0).locator('.four button').nth(0).tap()
  await expect(page.getByText(/is full/).first()).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).tap()
  // From a problem to the evidence and back. The panel starts collapsed on a phone.
  await page.locator('.asec.unsorted .acard').nth(1).getByRole('button', { name: /Evidence/ }).tap()
  await expect(page.locator('.eview')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Back to:/ })).toBeVisible()
  await page.getByRole('button', { name: /Back to:/ }).tap()
  await expect(page.locator('.asec.unsorted .acard')).toHaveCount(5)
  await noOverflow(page)
  s.close()
})

test('the lobby: the people in a list, pixel portraits, a click that makes a person speak', async ({ page }, info) => {
  const s = await setup(page, 'E2E lobby')
  await joinPicked(page, s.code, 'Lobby Tester', /Riverbend/)
  await expect(page.getByText('People in your practice')).toBeVisible()
  // The whole cast, extras included, each with their own portrait and no initials.
  await expect(page.locator('.cast-row')).toHaveCount(5)
  await expect(page.locator('.cast-row .portrait img')).toHaveCount(5)
  await expect(page.locator('.initials')).toHaveCount(0)
  // Who the player is, the practice with an edge to drag, its numbers, and a line that invites a click (section 10.2).
  await expect(page.locator('.lobby .panel-head').filter({ hasText: 'Who you are' })).toBeVisible()
  await expect(page.locator('.roompanel .panel-head')).toContainText('Your practice · Riverbend')
  await expect(page.locator('.cast-hint')).toContainText('Click a person to meet them')
  if (info.project.name === 'laptop') {
    // Three columns: who and how, the practice and its numbers, the people.
    await expect(page.locator('.lobby.three > .lobby-col')).toHaveCount(3)
    await expect(page.locator('.lobby-col').nth(1).locator('.panel-head')).toContainText(['Your practice', 'Your health system'])
    // The bottom edge of the room: the arrow keys make it lower, and the browser keeps the height.
    await expect(page.locator('.room[data-ready]')).toBeVisible({ timeout: 15_000 })
    const edge = page.locator('.roompanel .sizable-edge')
    const before = (await page.locator('.roompanel .room').boundingBox())!.height
    await edge.focus()
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    await expect.poll(async () => (await page.locator('.roompanel .room').boundingBox())!.height).toBeLessThan(before)
    expect(await page.evaluate(() => Number(localStorage.getItem('lab02.roomh.laptop')))).toBeGreaterThan(0)
  }
  // Day or night with one press, beside the menu button.
  const themeBefore = await page.evaluate(() => document.documentElement.dataset.theme)
  await page.getByRole('button', { name: /^Switch to the (day|night) theme$/ }).click()
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).not.toBe(themeBefore)
  // A row of the list: that person says one of their click lines in the scene.
  await page.locator('.cast-row').filter({ hasText: 'Ola Berg' }).click()
  await expect(page.locator('.say-bubble')).toContainText('Ola')
  await noOverflow(page)
  s.close()
})

test('the host console: two windows, one in control, the pin banner, the slides, the manual, plain refusals', async ({ page, browser }, info) => {
  test.skip(info.project.name !== 'laptop', 'laptop only')
  const token = (await (await page.request.post('/api/host/login', { data: { passcode: PASS } })).json()).token as string
  // The first page: a join code that breaks the rule is said at the field, in words.
  await page.goto('/host')
  await page.evaluate((t) => localStorage.setItem('lab02.host', JSON.stringify({ token: t, name: "Maya's laptop" })), token)
  await page.goto('/host')
  await page.getByLabel('Label').fill('E2E two hosts')
  await page.getByLabel('Link name (optional)').fill('AB')
  await expect(page.getByText('A link name needs 4 to 8 letters or digits.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Create' })).toBeDisabled()
  await noErrorNames(page)
  await page.getByLabel('Link name (optional)').fill('')
  await page.getByRole('button', { name: 'Create' }).click()
  // The test before this one left its session open, and one session is open at a time: the console asks first.
  const replace = page.getByRole('dialog').getByRole('button', { name: 'End it and start the new session' })
  if (await replace.waitFor({ state: 'visible', timeout: 2000 }).then(() => true, () => false)) await replace.click()
  await expect(page.getByText('Now on stage')).toBeVisible()
  await expect(page.getByText('You are in charge').first()).toBeVisible()

  // A second host watches, and takes charge with the passcode, after a confirmation that names who loses it.
  const ctx2 = await browser.newContext()
  const p2 = await ctx2.newPage()
  await p2.goto('/host')
  await p2.evaluate((t) => localStorage.setItem('lab02.host', JSON.stringify({ token: t, name: "Sam's laptop" })), token)
  await p2.goto(page.url())
  await expect(p2.locator('.sessbar .chip.watch')).toHaveText("Maya's laptop is in charge")
  await expect(p2.getByRole('button', { name: /^Next:/ })).toBeDisabled()
  // A watching host still looks through the deck, with the notes, and changes nothing for the room.
  const look2 = p2.locator('.looker')
  await expect(look2.locator('.notes')).toContainText('Wait until most people have joined')
  await expect(look2.getByRole('button', { name: 'Show this slide' })).toBeDisabled()
  await look2.getByRole('button', { name: 'Look ahead →' }).click()
  await expect(look2.locator('.notes')).toContainText('Keep this short')
  await expect(look2.locator('.looknav .slidecount')).toHaveText('Looking at 2 · Shown 1')
  await expect(page.locator('.slidenav .slidecount')).toHaveText('Slide 1 of 10')
  await look2.getByRole('button', { name: 'Back to the shown slide' }).click()
  await p2.getByRole('button', { name: 'Take charge' }).click()
  await expect(p2.getByRole('dialog')).toContainText("Take charge from Maya's laptop?")
  await expect(p2.getByRole('dialog').getByRole('button', { name: 'Take charge' })).toBeDisabled()
  await p2.getByLabel('Facilitator passcode, to confirm').fill('not the passcode')
  await p2.getByRole('dialog').getByRole('button', { name: 'Take charge' }).click()
  await expect(p2.getByRole('dialog')).toContainText('That passcode is not right.')
  await expect(page.getByText('You are in charge').first()).toBeVisible()
  await p2.getByLabel('Facilitator passcode, to confirm').fill(PASS)
  await p2.getByRole('dialog').getByRole('button', { name: 'Take charge' }).click()
  await expect(p2.getByText('You are in charge').first()).toBeVisible()
  await expect(page.getByText("Sam's laptop took charge. You are watching now.")).toBeVisible()
  await expect(page.getByRole('button', { name: /^Next:/ })).toBeDisabled()
  // A watching console says who is in charge in its top bar, beside the button that takes it.
  await expect(page.locator('.sessbar .chip.watch')).toHaveText("Sam's laptop is in charge")
  await expect(page.locator('.sessbar').getByRole('button', { name: 'Take charge' })).toBeVisible()

  // The pin banner and the slides, outside a phase: the console asks about players' screens.
  await p2.getByRole('button', { name: 'Lobby', exact: true }).click()
  await expect(p2.getByText('Pinned to Lobby. The projector will not follow the game.')).toBeVisible()
  await p2.getByRole('button', { name: 'Slides', exact: true }).click()
  await expect(p2.getByText("Show the slides on every player's screen too?")).toBeVisible()
  // The actions of a dialog are one row of buttons of one size, Cancel last.
  const actions = await p2.locator('.sheet-actions .btn').evaluateAll((els) => els.map((el) => { const b = el.getBoundingClientRect(); return { h: Math.round(b.height), w: Math.round(b.width), y: Math.round(b.top), t: el.textContent } }))
  expect(actions.map((a) => a.t)).toEqual(['Yes, every screen', 'No, projector only', 'Cancel'])
  expect(new Set(actions.map((a) => a.h)).size).toBe(1)
  expect(new Set(actions.map((a) => a.w)).size).toBe(1)
  expect(new Set(actions.map((a) => a.y)).size).toBe(1)
  await p2.getByRole('button', { name: 'Yes, every screen' }).click()
  await expect(p2.getByText("The slides are on every player's screen too.")).toBeVisible()
  await expect(p2.locator('.slidenav .slidecount')).toHaveText('Slide 1 of 10')
  // The slide looked at is drawn as a slide, and the shown one is marked in the strip of the deck.
  await expect(p2.locator('.looker .lookbox .sl-thumb .sl-person')).toHaveCount(2)
  await expect(p2.locator('.looker .stripbtn.shown')).toHaveCount(1)
  await p2.locator('body').press('ArrowRight')
  await expect(p2.locator('.slidenav .slidecount')).toHaveText('Slide 2 of 10')
  await expect(p2.locator('.bigscreen > .group > .notes')).toContainText('Keep this short')
  await p2.locator('.slidenav').getByRole('button', { name: '← Back' }).click()
  await expect(p2.locator('.bigscreen > .group > .notes')).toContainText('Wait until most people have joined')
  // Slides of a later part: the room can see them, so the host in charge is asked first.
  await p2.getByLabel('Go to section').selectOption({ label: 'After Phase 1' })
  await expect(p2.getByRole('dialog')).toContainText('These slides come later')
  await p2.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()
  await expect(p2.locator('.slidenav .slidecount')).toHaveText('Slide 1 of 10')
  await p2.getByLabel('Go to section').selectOption({ label: 'After Phase 1' })
  await p2.getByRole('dialog').getByRole('button', { name: 'Show it anyway' }).click()
  await expect(p2.locator('.slidenav .slidecount')).toHaveText('Slide 4 of 10')
  await p2.getByLabel('Go to section').selectOption({ label: 'Welcome' })
  await expect(p2.locator('.slidenav .slidecount')).toHaveText('Slide 1 of 10')
  // Leaderboard and Winners are unavailable before any score, and say why.
  await expect(p2.getByText('No scores yet. The leaderboard opens with Phase 1.')).toBeVisible()
  await expect(p2.getByText('No phase has been scored yet.')).toBeVisible()
  await p2.getByRole('button', { name: 'Follow the game' }).first().click()
  await expect(p2.getByText(/^Pinned to/)).toHaveCount(0)
  // The manual opens beside the console.
  await p2.getByRole('button', { name: 'Console manual' }).first().click()
  await expect(p2.locator('.manual-side h1')).toHaveText('Console manual')
  await noErrorNames(p2)
  await noOverflow(p2)
  // Maya takes charge back: the notice that Sam took it goes away by itself.
  await page.locator('.sessbar').getByRole('button', { name: 'Take charge' }).click()
  await page.getByLabel('Facilitator passcode, to confirm').fill(PASS)
  await page.getByRole('dialog').getByRole('button', { name: 'Take charge' }).click()
  await expect(page.locator('.sessbar .chip.good')).toHaveText('You are in charge')
  await expect(page.getByText("Sam's laptop took charge. You are watching now.")).toHaveCount(0)
  await expect(p2.getByText("Maya's laptop took charge. You are watching now.")).toBeVisible()
  await ctx2.close()
})

test('a game that starts again and ends: a dialog keeps its field, the players follow, and the way leads to the next game', async ({ page, browser }, info) => {
  test.skip(info.project.name !== 'laptop', 'laptop only')
  const token = (await (await page.request.post('/api/host/login', { data: { passcode: PASS } })).json()).token as string
  const auth = { authorization: `Bearer ${token}` }
  const code = (await (await page.request.post('/api/host/session', { data: { label: 'E2E again', mode: 'rehearsal', replace: {} }, headers: auth })).json()).code as string
  await page.goto('/host')
  await page.evaluate((t) => localStorage.setItem('lab02.host', JSON.stringify({ token: t, name: 'E2E laptop' })), token)
  await page.goto(`/host?s=${code}`)
  await expect(page.locator('.sessbar .chip.good')).toHaveText('You are in charge')
  const player = await browser.newContext()
  const pp = await player.newPage()
  await joinPicked(pp, code, 'Again Tester', /Riverbend/)

  // The console in three columns: the players, the projector, the tools that are seldom needed.
  const cols = page.locator('.console-grid > .ccol')
  await expect(cols).toHaveCount(3)
  await expect(cols.nth(0).locator('.prow')).toContainText('Again Tester')
  await expect(cols.nth(1).locator('.panel-head').first()).toHaveText('Projector')
  await expect(cols.nth(2).locator('.panel-head')).toHaveText(['Rehearsal tools', 'End the session', 'Answer key', 'Downloads'])
  await noOverflow(page)

  // A dialog with a field keeps the caret while it is typed in, letter by letter.
  await page.getByRole('button', { name: 'Actions for Again Tester' }).click()
  await page.getByRole('menuitem', { name: 'Rename' }).click()
  const field = page.getByLabel('New name')
  await expect(field).toBeFocused()
  await field.fill('')
  await field.pressSequentially('Second Tester', { delay: 40 })
  await expect(field).toHaveValue('Second Tester')
  await expect(field).toBeFocused()
  await page.getByRole('dialog').getByRole('button', { name: 'Rename' }).click()
  await expect(cols.nth(0).locator('.prow')).toContainText('Second Tester')

  // Phase 1 opens with its letter. The player picks one card per row, and the menu has no ladder.
  const next = page.getByRole('button', { name: /^Next:/ })
  await next.click()
  await next.click()
  await pp.getByRole('button', { name: 'Start investigating' }).click()
  await pp.getByRole('button', { name: 'End tour' }).click()
  const perRow = () => pp.locator('.cards').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length)
  await expect(pp.getByRole('button', { name: 'Two cards per row' })).toHaveAttribute('aria-pressed', 'true')
  await pp.getByRole('button', { name: 'One card per row' }).click()
  expect(await perRow()).toBe(1)
  await pp.getByRole('button', { name: 'Two cards per row' }).click()
  expect(await perRow()).toBe(2)
  await pp.getByRole('button', { name: 'Menu' }).click()
  await expect(pp.getByText('Rejoin code')).toBeVisible()
  await expect(pp.getByText('The automation ladder')).toHaveCount(0)
  await pp.getByRole('dialog').getByRole('button', { name: 'Close' }).click()
  const picked = (await pp.locator('.asec.unsorted .acard').first().locator('.at').textContent())!
  await pp.locator('.asec.unsorted .acard').first().locator('.four button').nth(0).click()
  await expect(pp.locator('.asec[data-class]').first().locator('.acard')).toHaveCount(1)
  // The host looks at the player: every problem under its true class, the pick with its mark, the reason behind a button.
  await page.locator('.plook').first().click()
  const look = page.getByRole('dialog')
  await expect(look).toContainText('Only facilitators see this page')
  await expect(look.locator('.inspect-grid .rbin')).toHaveCount(4)
  await expect(look.locator('.rprob')).toHaveCount(6)
  await expect(look.locator('.rprob').filter({ hasText: picked }).locator('.pchip')).toHaveText('Agentic')
  await expect(look.locator('.rprob-body')).toHaveCount(0)
  await look.getByRole('button', { name: /^Why/ }).first().click()
  await expect(look.locator('.rprob-body')).toHaveCount(1)
  await noErrorNames(page)
  await look.getByRole('button', { name: 'Close' }).last().click()

  // The phase starts again: a rehearsal confirms with one click, the player is told, the letter
  // opens again and the assessment is empty.
  await page.getByRole('button', { name: 'Reset Phase 1' }).click()
  await expect(page.getByRole('dialog').locator('input')).toHaveCount(0)
  await page.getByRole('dialog').getByRole('button', { name: 'Reset the phase' }).click()
  await expect(pp.locator('.restartbar')).toContainText('The facilitator started Phase 1 again.')
  await pp.getByRole('button', { name: 'Start investigating' }).click()
  await pp.getByRole('button', { name: 'End tour' }).click()
  await expect(pp.locator('.asec[data-class]').first().locator('.acard')).toHaveCount(0)

  // The whole game starts again: the same player is back in the lobby with no points.
  await page.getByRole('button', { name: 'Restart the game' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Restart the game' }).click()
  await expect(pp.locator('.restartbar')).toContainText('The facilitator started the game again.')
  await expect(pp.getByText('I am in, and I am waiting for the facilitator to start.')).toBeVisible()
  await expect(cols.nth(0).locator('.prow')).toContainText('Second Tester')
  await expect(page.getByText('Now on stage').locator('xpath=following-sibling::*[1]')).toHaveText('Lobby')

  // The session ends: the console says so, the player keeps a result page, and when the host
  // opens a new session the page leads to it with the practice's name filled in.
  await page.getByRole('button', { name: 'End the session' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'End the session' }).click()
  await expect(page.locator('.endedbar')).toContainText('This session has ended.')
  await expect(pp.getByText('This game has ended')).toBeVisible()
  await expect(pp.getByText('When the facilitator opens a new game, a button to join it appears here.')).toBeVisible()
  await expect(pp.getByRole('button', { name: 'Leave this game and join as a new player' })).toBeVisible()
  const code2 = (await (await page.request.post('/api/host/session', { data: { label: 'E2E the next game', mode: 'rehearsal', replace: {} }, headers: auth })).json()).code as string
  await expect(pp.getByText('A new game is open')).toBeVisible({ timeout: 15_000 })
  await expect(pp.locator('.newgame')).toContainText('E2E the next game')
  await pp.getByRole('button', { name: 'Join the new game' }).click()
  await expect(pp).toHaveURL(new RegExp(`/j/${code2}$`))
  await expect(pp.getByLabel('Name your practice')).toHaveValue('Second Tester')
  // The ended game says so to anyone who opens its link.
  const late = await browser.newContext()
  const lp = await late.newPage()
  await lp.goto(`/j/${code}`)
  await expect(lp.getByText('This game has ended. Nobody can join it any more.')).toBeVisible()
  await expect(lp.getByRole('button', { name: 'Join the new game' })).toBeVisible()
  await noErrorNames(pp)
  await late.close()
  // In the new game, the menu lets a player start fresh: the browser lets go of the practice and
  // the join form opens empty, because that name is taken there.
  await pp.getByRole('button', { name: 'Join', exact: true }).click()
  await pp.getByRole('button', { name: 'Got it' }).click()
  await pp.getByRole('button', { name: 'Menu' }).click()
  await pp.getByRole('button', { name: /Join as a new player/ }).click()
  await expect(pp.getByRole('dialog')).toContainText('This browser lets go of "Second Tester"')
  await pp.getByRole('dialog').getByRole('button', { name: 'Leave and join again' }).click()
  await expect(pp).toHaveURL(new RegExp(`/j/${code2}$`))
  await expect(pp.getByLabel('Name your practice')).toHaveValue('')
  expect(await pp.evaluate(() => localStorage.getItem('lab02.player'))).toBeNull()
  await player.close()
})

test('the projector during a phase: the activity of the room, a phase by health system, and rows of controls of one size', async ({ page, browser }, info) => {
  test.skip(info.project.name !== 'laptop', 'laptop only')
  const s = await setup(page, 'E2E projector')
  await joinPicked(page, s.code, 'Elm Street', /Riverbend/)
  await s.host('next')
  await s.host('next')
  await page.getByRole('button', { name: 'Start investigating' }).click()
  await page.getByRole('button', { name: 'End tour' }).click()

  // The big screen, opened the way the console opens it.
  const link = (await (await page.request.post('/api/host/screen-link', { data: { code: s.code }, headers: { authorization: `Bearer ${s.token}` } })).json()).path as string
  const sctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } })
  const screen = await sctx.newPage()
  await screen.goto(link)
  // Following a phase, the projector shows one view of its programme.
  await expect(screen.getByText(/The room at work|ONE PRACTICE AT WORK|Phase 1 · Planning/).first()).toBeVisible()

  // Pinned to the activity list: a started investigation shows with its public title only.
  expect((await s.host('screen_scene', { scene: 'feed' })).ok).toBe(true)
  await expect(screen.getByText('The room at work')).toBeVisible()
  const first = page.locator('.irow').first()
  const title = (await first.locator('.ttl .t').first().textContent())!.trim()
  await first.locator('.ibtn.start').click()
  const line = screen.locator('.panel', { hasText: 'The room at work' })
  await expect(line.getByText('Elm Street')).toBeVisible()
  await expect(line.getByText('started', { exact: true })).toBeVisible()
  await expect(line.getByText(title, { exact: true })).toBeVisible()

  // One phase, the health systems side by side.
  expect((await s.host('screen_scene', { scene: 'play' })).ok).toBe(true)
  expect((await s.host('screen_filter', { system: null, phase: 'planning' })).ok).toBe(true)
  await expect(screen.getByText('Phase 1 · Planning').last()).toBeVisible()
  await expect(screen.locator('.panel-head.lav')).toHaveCount(2)
  await expect(screen.locator('.panel-head.lav').first()).toContainText('Riverbend')
  await sctx.close()

  // The console: every row of controls has one height, and the scene buttons one width.
  await page.goto('/host')
  await page.evaluate((t) => localStorage.setItem('lab02.host', JSON.stringify({ token: t, name: "Maya's laptop" })), s.token)
  await page.goto(`/host?s=${s.code}`)
  await expect(page.getByText('Now on stage')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Activity', exact: true })).toBeVisible()
  await expect(page.getByLabel('Leaderboard shows')).toHaveValue('phase:planning')
  const sizes = (sel: string, side: 'height' | 'width') => page.evaluate(([q, k]) => [...new Set([...document.querySelectorAll(q!)].map((el) => Math.round(el.getBoundingClientRect()[k as 'height' | 'width'])))], [sel, side])
  expect(await sizes('.stagectl .btn', 'height')).toEqual([44])
  expect(await sizes('.sessbar .codebox, .sessbar .chip, .sessbar .countdown, .sessbar .btn, .sessbar .iconbtn', 'height')).toEqual([36])
  expect((await sizes('.scene > .btn', 'height')).length).toBe(1)
  expect((await sizes('.scene > .btn', 'width')).length).toBe(1)
  await noErrorNames(page)
  await noOverflow(page)
  s.close()
})
