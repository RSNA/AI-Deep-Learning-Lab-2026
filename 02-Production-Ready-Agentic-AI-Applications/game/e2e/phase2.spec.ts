// Phase 2 on the demo pack (engineering spec, section 12.6): a map built by clicks only and
// validated, the same by drag, an action that unlocks an item, the warning mark, the prompt
// chooser, undo, a refresh, an earlier map loaded back, the reveal with both maps, the phone
// tabs, both themes, and the host's view of a player.
import { createRequire } from 'node:module'
import { expect, test, type Page } from '@playwright/test'

const require = createRequire(import.meta.url)
const WebSocket = require('ws') as typeof import('ws')
const PASS = 'e2e-passcode-0123'

async function setup(page: Page, label: string, scale = 1) {
  const token = (await (await page.request.post('/api/host/login', { data: { passcode: PASS } })).json()).token as string
  const code = (await (await page.request.post('/api/host/session', { data: { label, mode: 'rehearsal' }, headers: { authorization: `Bearer ${token}` } })).json()).code as string
  const base = new URL('http://127.0.0.1:3200')
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

/** From the lobby to Phase 2, the opening letter closed. */
async function toDevelopment(page: Page, s: Awaited<ReturnType<typeof setup>>) {
  await s.host('next'); await s.host('next')
  await page.getByRole('button', { name: 'Start investigating' }).click()
  await page.getByRole('button', { name: 'End tour' }).click()
  await s.host('end_now'); await s.host('next'); await s.host('next')
  await expect(page.getByText('A letter for you')).toBeVisible()
  await page.getByRole('button', { name: 'Start building' }).click()
  await page.getByRole('button', { name: 'End tour' }).click()
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

test('the laptop screen: a map by clicks only, a validation, actions, the prompt chooser, undo, a refresh, the reveal', async ({ page }, info) => {
  test.skip(info.project.name !== 'laptop', 'laptop only')
  test.setTimeout(120_000)
  const s = await setup(page, 'E2E canvas laptop', 2)
  await joinPicked(page, s.code, 'Canvas Laptop', /Riverbend/)
  await toDevelopment(page, s)
  await expect(page.locator('.colhead h2')).toHaveText(['Actions', 'Your map', 'Toolbox'])
  // The whole grid, the shelves and Validate are in view at 1280 by 720, and nothing scrolls sideways.
  const fold = await page.evaluate(() => {
    const g = document.querySelector('.p2-map .cgrid')!.getBoundingClientRect()
    const v = document.querySelector('.p2-map .vbtn')!.getBoundingClientRect()
    return { grid: g.bottom, validate: v.bottom, h: window.innerHeight }
  })
  expect(fold.grid).toBeLessThanOrEqual(fold.h)
  expect(fold.validate).toBeLessThanOrEqual(fold.h)
  await noOverflow(page)
  await expect(page.locator('.purse')).toContainText('Money')
  // Validate cannot act, and the line beside it guides through the first map.
  await expect(page.locator('.vbtn')).toHaveAttribute('aria-disabled', 'true')
  await expect(page.locator('.vwhy')).toContainText('Place a tile first')

  // Place an agent by two clicks, give it a model and a place to run, join it.
  await tool(page, 'Agent').click()
  await cell(page, 2, 2).click()
  await expect(page.locator('.ctile')).toHaveCount(1)
  await page.getByRole('button', { name: '+ Model' }).click()
  await page.locator('.partrow', { hasText: 'Acorn Small' }).click()
  await page.getByRole('button', { name: '+ Runs on' }).click()
  await expect(page.locator('.partrow', { hasText: 'Rented cloud GPUs' })).toBeDisabled()     // Small cannot run there
  await expect(page.locator('.partrow', { hasText: 'Acorn private link' })).toBeDisabled()    // locked
  await page.locator('.partrow', { hasText: 'Acorn public API' }).click()
  await join(page, 'Request form', /Join to Agent/)
  await join(page, 'Shared catalog', /Join to Agent/)
  await join(page, 'Courier site', /Join to Agent/)
  await join(page, 'Agent', /Join to Loan arranged/)
  await expect(page.locator('.cline')).toHaveCount(4)
  // The pack requires a librarian on the way to the result, and the line beside Validate says so.
  await expect(page.locator('.vwhy')).toContainText('A reference librarian signs every answer')
  await expect(page.locator('.vbtn')).toHaveAttribute('aria-disabled', 'true')
  await tool(page, 'Reference librarian').click()
  await cell(page, 3, 2).click()
  await join(page, 'Agent', /Join to Reference librarian/)
  await join(page, 'Reference librarian', /Join to Loan arranged/)
  await expect(page.locator('.cline')).toHaveCount(5)   // the second line into the result replaced the first
  // A locked source takes no line: it has no port.
  await expect(page.getByRole('button', { name: 'Draw a line from Partner mailbox' })).toHaveCount(0)
  // The warning mark: patron data through a service that does not protect it.
  await expect(page.locator('.ctile .cmark.warn')).toHaveCount(1)
  await expect(page.locator('.mapfoot')).toContainText('Private data goes through a service that does not protect it.')

  // The prompt chooser: one card per format, with its sample. Two are locked.
  await page.getByRole('button', { name: /^Prompt:/ }).click()
  const chooser = page.getByRole('dialog')
  await expect(chooser.locator('.pcard')).toHaveCount(4)
  await expect(chooser.locator('.pc-sample').first()).toContainText('Find the book')
  await expect(chooser.locator('.pcard.is-locked')).toHaveCount(2)
  await chooser.locator('.pcard', { hasText: 'Says everything' }).getByRole('button', { name: 'Use this prompt' }).click()
  await expect(page.locator('.ct-part', { hasText: 'Says everything' })).toBeVisible()

  // Validate. The map stays usable while it runs: a rule goes on the map meanwhile.
  await page.getByRole('button', { name: /Validate · 6 left/ }).click()
  await expect(page.locator('.vbtn.running')).toBeVisible()
  await tool(page, 'Rule').click()
  await cell(page, 1, 4).click()
  await expect(page.locator('.ctile.stray')).toHaveCount(1)
  await expect(page.locator('#p2-results .vacc .num')).toHaveText(/^\d+\.\d%$/, { timeout: 15_000 })
  await expect(page.locator('#p2-results')).toContainText('One patient it got wrong, as an example')
  await expect(page.locator('#p2-results')).toContainText('Your chosen map so far')

  // Undo takes the rule away, redo brings it back, Delete removes the selection.
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.locator('.ctile')).toHaveCount(2)
  await page.getByRole('button', { name: 'Redo' }).click()
  await expect(page.locator('.ctile')).toHaveCount(3)
  await page.locator('.ctile.stray').click()
  await page.keyboard.press('Delete')
  await expect(page.locator('.ctile')).toHaveCount(2)

  // An action that unlocks an item: the free model leaves its lock once the action ends.
  await expect(page.locator('.schip', { hasText: 'Pine' })).toHaveClass(/is-locked/)
  await page.locator('.arow[data-action="rb-a-download"]').getByRole('button', { name: 'Start' }).click()
  await expect(page.locator('.arow[data-action="rb-a-download"]')).toHaveClass(/running/)
  await expect(page.locator('.schip', { hasText: 'Pine' })).not.toHaveClass(/is-locked/, { timeout: 15_000 })
  // An action with an insight lands a card under the map.
  await page.locator('.arow[data-action="rb-a-shadow"]').getByRole('button', { name: 'Start' }).click()
  await expect(page.locator('.p2insights .card[data-insight]')).toHaveCount(1, { timeout: 15_000 })

  // Load an earlier map: remove a line, then load the validated map back.
  await page.locator('.cline .hit').first().click({ force: true })
  await page.keyboard.press('Delete')
  await expect(page.locator('.cline')).toHaveCount(4)
  await expect(page.locator('#p2-results')).toContainText('Validation 1 of 6')
  await page.getByRole('button', { name: 'Restore this map' }).click()
  await expect(page.locator('.cline')).toHaveCount(5)
  await expect(page.locator('#p2-results .vrun')).toContainText('On your canvas now')

  // A refresh brings the same draft back, and the tour does not start again.
  await page.reload()
  await expect(page.locator('.ctile')).toHaveCount(2)
  await expect(page.locator('.cline')).toHaveCount(5)
  await expect(page.locator('.tour-card')).toHaveCount(0)
  await noErrorNames(page)

  // The reveal: the letter, the score, both maps, every case.
  await s.host('end_now')
  await expect(page.getByText('The reference map')).toBeVisible()
  await expect(page.locator('.p2maps .cgrid')).toHaveCount(2)
  await expect(page.locator('.rcase')).toHaveCount(5)
  await expect(page.locator('.score')).toContainText('Phase 2 points')
  const text = await page.locator('main').innerText()
  expect(text).not.toMatch(/\braw\b|provisional/i)
  await noOverflow(page)
  s.close()
})

test('stages, groups and numbered tiles: a cell under a line takes the click, the prompt chooser says what a tile reads', async ({ page }, info) => {
  test.skip(info.project.name !== 'laptop', 'laptop only')
  const s = await setup(page, 'E2E canvas stages')
  await joinPicked(page, s.code, 'Canvas Stages', /Riverbend/)
  await toDevelopment(page, s)
  // The letter opens with the paragraph for a board that did not put the flagship with the agents.
  await expect(page.locator('.p2insights .letter')).toContainText('In the spring you filed partner requests under something simpler.')
  // The columns carry the names of the stages, and a tap says the sentence of one.
  await expect(page.locator('.p2-map .chdr.stage')).toHaveText(['Read the request', 'Find the copies', 'Weigh the options', 'Check and send'])
  await page.getByRole('button', { name: /^Find the copies\./ }).click()
  await expect(page.locator('.chint')).toHaveText('Which partner holds a copy and what it asks before it lends.')
  // The toolbox under its two headings, each row with its task.
  await expect(page.locator('.tbgroup-t')).toHaveText(['Operators', 'Tools'])
  await expect(tool(page, 'Card reader')).toContainText('Reads the scanned card files')
  await expect(tool(page, 'Card reader')).toHaveAttribute('aria-disabled', 'true')
  // A legend says what the two kinds of line are.
  await expect(page.locator('.lglegend')).toContainText('hands its work on')

  await tool(page, 'Agent').click()
  await cell(page, 2, 2).click()
  await join(page, 'Request form', /Join to Agent/)
  await join(page, 'Agent', /Join to Loan arranged/)
  await expect(page.locator('.cline.handoff')).toHaveCount(1)
  // The line to the result runs across cell (4, 2): placing there still works by clicks.
  await tool(page, 'Rule').click()
  await cell(page, 4, 2).click()
  await expect(page.locator('.ctile')).toHaveCount(2)
  // A second agent: both carry a number, on the tile and in the prompt chooser.
  await tool(page, 'Agent').click()
  await cell(page, 1, 4).click()
  await expect(page.locator('.ctile .ct-name')).toHaveText(['Agent 1', 'Rule', 'Agent 2'])
  await page.getByRole('button', { name: /^Prompt:/ }).first().click()
  const chooser = page.getByRole('dialog')
  await expect(chooser).toContainText('Prompt for Agent 1')
  await expect(chooser.locator('.pc-about')).toHaveText('Agent 1 reads Request form, and no tile hands it work.')
  await expect(chooser.locator('.pc-s')).toHaveCount(4)
  await expect(chooser.locator('.pc-sl').first()).toHaveText('When the worker digs')
  s.close()
})

test('the same map by drag, on a laptop, in the dark theme', async ({ page }, info) => {
  test.skip(info.project.name !== 'laptop', 'laptop only')
  const s = await setup(page, 'E2E canvas drag')
  await page.emulateMedia({ colorScheme: 'dark' })
  await joinPicked(page, s.code, 'Canvas Drag', /Lakeshore/)
  await toDevelopment(page, s)
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).not.toBe('rgb(230, 233, 251)')
  // From the toolbox to a cell.
  await tool(page, 'Rule').dragTo(page.locator('.ccell').nth(6))
  await expect(page.locator('.ctile')).toHaveCount(1)
  // A tile to another cell.
  await page.locator('.ctile').dragTo(page.locator('.ccell').nth(1))
  await expect(page.locator('.ctile')).toHaveCount(1)
  // From a port to a tile, and from the tile to the result.
  const drag = async (from: string, to: string) => {
    const a = await page.getByRole('button', { name: `Draw a line from ${from}` }).boundingBox()
    const b = await page.locator(to).boundingBox()
    await page.mouse.move(a!.x + a!.width / 2, a!.y + a!.height / 2)
    await page.mouse.down()
    await page.mouse.move(a!.x + 40, a!.y + 10, { steps: 4 })
    await page.mouse.move(b!.x + b!.width / 2, b!.y + b!.height / 2, { steps: 8 })
    await page.mouse.up()
  }
  await drag('Circulation system', '.ctile')
  await drag('Door counters', '.ctile')
  await drag('Rule', '.cresult')
  await expect(page.locator('.cline')).toHaveCount(3)
  await expect(page.locator('.vbtn')).not.toHaveAttribute('aria-disabled', 'true')
  // A pack without names for its columns shows nothing above them.
  await expect(page.locator('.p2-map .chdr')).toHaveText(['Sources', '', '', '', '', 'Result'])
  s.close()
})

test('the phone: four tabs, a worker placed by taps, and the host looks at the player beside the key', async ({ page, browser }, info) => {
  test.skip(info.project.name !== 'phone', 'phone only')
  const s = await setup(page, 'E2E canvas phone')
  await joinPicked(page, s.code, 'Canvas Phone', /Lakeshore/)
  await toDevelopment(page, s)
  await expect(page.locator('.ptabs.four button')).toHaveCount(4)
  await expect(page.locator('.ptabs .tl')).toHaveText(['Map', 'Actions', 'Toolbox', 'Results'])
  await page.locator('.ptabs button', { hasText: 'Toolbox' }).click()
  await tool(page, 'Rule').click()
  // The pick takes the player back to the map, where an empty cell takes it.
  await expect(page.locator('.cgrid.placing')).toBeVisible()
  await cell(page, 1, 1).click()
  await expect(page.locator('.ctile')).toHaveCount(1)
  await join(page, 'Circulation system', /Join to Rule/)
  await join(page, 'Rule', /Join to Report sent/)
  await expect(page.locator('.vbtn')).toBeEnabled()
  // The page never scrolls sideways; the grid scrolls inside itself.
  await noOverflow(page)
  await page.locator('.ptabs button', { hasText: 'Actions' }).click()
  await expect(page.locator('.agroup-t')).toHaveText(['Learn', 'Build', 'Buy', 'Negotiate'])
  await page.locator('.ptabs button', { hasText: 'Results' }).click()
  await expect(page.locator('#p2-results')).toContainText('No validation yet')

  // The host's view of this player: a Phase 2 tab with the draft and the key.
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const hp = await ctx.newPage()
  await hp.goto('/host')
  await hp.evaluate((t) => localStorage.setItem('lab02.host', JSON.stringify({ token: t, name: 'E2E host' })), s.token)
  await hp.goto(`/host?s=${s.code}`)
  await hp.locator('.plook').first().click()
  const look = hp.getByRole('dialog')
  await expect(look).toContainText('Only hosts see this page')
  // The coaching block comes first: three short lists, and the guide of a kind on a press.
  const coach = look.locator('.coach')
  await expect(coach).toContainText('To help this player')
  await expect(coach.locator('.eyebrow')).toHaveText(['What holds this map back', 'Worth saying', 'Good on this map'])
  await expect(coach.locator('.coach-cols li').first()).toBeVisible()
  await coach.locator('.coach-name').first().click()
  await expect(coach.locator('.coach-guide')).toContainText('Best use')
  await expect(coach.locator('.coach-guide')).toContainText('Wrong choices')
  // The map now, and the chosen map once there is one. The two buttons have one height.
  await expect(look.locator('.insp-map').first().locator('.ctile')).toHaveCount(1)
  const tabs = look.locator('.coach-maps button')
  await expect(tabs.nth(1)).toBeDisabled()
  const hs = await tabs.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)))
  expect(hs[0]).toBe(hs[1])
  // Everything else is folded.
  await look.locator('summary', { hasText: 'Every validation, the actions and the key' }).click()
  await expect(look).toContainText('Share solved of each case')
  await expect(look.locator('.insp-cases .kv')).toHaveCount(5)
  await look.locator('summary', { hasText: 'The reference map' }).click()
  await expect(look.locator('.inspect-done .cgrid')).toBeVisible()
  expect(await hp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await ctx.close()
  s.close()
})
