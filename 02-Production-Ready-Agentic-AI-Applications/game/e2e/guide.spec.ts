// The screen guides the player (engineering spec, sections 10.1, 10.4 and 10.5), on the demo pack:
// a tour at the start of each phase and again from the menu, a help panel, Validate that always
// says why, a sentence for every refused placement or line, the words of a line rule, advice on a
// line, and an interview whose words stay until the player acts. Laptop and phone.
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
    const cid = `g${++n}`
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

const tool = (page: Page, label: string) => page.locator('.tbrow', { has: page.locator('.tb-l', { hasText: new RegExp(`^${label}`) }) })
const cell = (page: Page, c: number, r: number) => page.getByRole('button', { name: new RegExp(`^Empty cell, column ${c}, row ${r}\\.`) })
const port = (page: Page, from: string) => page.getByRole('button', { name: `Draw a line from ${from}`, exact: true })
const join = async (page: Page, from: string, to: RegExp) => {
  await port(page, from).click()
  await page.getByRole('button', { name: to }).click()
}
async function noErrorNames(page: Page) {
  const names = await page.evaluate(() => document.body.innerText.match(/\b[a-z]+_[a-z_]+\b/g) ?? [])
  expect(names).toEqual([])
}

test('the tour of each phase: it starts after the letter, steps back and forth, ends, and comes back only from the menu', async ({ page }, info) => {
  test.skip(info.project.name !== 'laptop', 'laptop only')
  const s = await setup(page, 'E2E tour')
  await joinPicked(page, s.code, 'Tour Laptop', /Riverbend/)
  await s.host('next'); await s.host('next')
  await expect(page.locator('.tour-card')).toHaveCount(0)            // not over the letter
  await page.getByRole('button', { name: 'Start investigating' }).click()
  const card = page.locator('.tour-card')
  await expect(card).toContainText('1 of 4')
  await expect(card).toContainText('The clock keeps running')
  await expect(card.getByRole('button', { name: 'Back' })).toHaveCount(0)
  await expect(page.locator('.tour-light')).toBeVisible()
  await card.getByRole('button', { name: 'Next' }).click()
  await expect(card).toContainText('2 of 4')
  await expect(card).not.toContainText('The clock keeps running')
  await page.keyboard.press('ArrowLeft')
  await expect(card).toContainText('1 of 4')
  await page.keyboard.press('Escape')
  await expect(card).toHaveCount(0)
  // Once ended, a refresh does not bring it back.
  await page.reload()
  await expect(page.locator('.colhead h2').first()).toBeVisible()
  await expect(page.locator('.tour-card')).toHaveCount(0)
  // The menu: Take the tour, and Help with the same words and the marks.
  await page.getByRole('button', { name: 'Menu' }).click()
  await page.getByRole('button', { name: /Take the tour/ }).click()
  await expect(card).toContainText('1 of 4')
  for (let i = 0; i < 3; i++) await card.getByRole('button', { name: 'Next' }).click()
  await card.getByRole('button', { name: 'Done' }).click()
  await expect(card).toHaveCount(0)
  await page.getByRole('button', { name: 'Menu' }).click()
  await page.getByRole('button', { name: /^Help/ }).click()
  const help = page.getByRole('dialog')
  await expect(help.locator('.help-list li')).toHaveCount(4)
  await expect(help).toContainText('Interview')
  await help.getByRole('button', { name: 'Close' }).click()

  // Phase 2 has its own tour, after its own letter.
  await s.host('end_now'); await s.host('next'); await s.host('next')
  await page.getByRole('button', { name: 'Start building' }).click()
  await expect(card).toContainText('1 of 7')
  for (let i = 0; i < 6; i++) await card.getByRole('button', { name: 'Next' }).click()
  await expect(card).toContainText('7 of 7')
  await card.getByRole('button', { name: 'End tour' }).click()
  await page.getByRole('button', { name: 'Menu' }).click()
  await page.getByRole('button', { name: /^Help/ }).click()
  await expect(page.getByRole('dialog').locator('.help-list li')).toHaveCount(7)
  await expect(page.getByRole('dialog')).toContainText('An i on a line')
  s.close()
})

test('Validate always says why, and every refused placement or line says why at its place', async ({ page }, info) => {
  test.skip(info.project.name !== 'laptop', 'laptop only')
  test.setTimeout(90_000)
  const s = await setup(page, 'E2E guide', 4)
  await joinPicked(page, s.code, 'Guide Laptop', /Riverbend/)
  await s.host('next'); await s.host('next')
  await page.getByRole('button', { name: 'Start investigating' }).click()
  await page.getByRole('button', { name: 'End tour' }).click()
  await s.host('end_now'); await s.host('next'); await s.host('next')
  await page.getByRole('button', { name: 'Start building' }).click()
  await page.getByRole('button', { name: 'End tour' }).click()
  const why = page.locator('.vwhy')
  const vbtn = page.locator('.vbtn')
  const note = page.locator('.cnote')

  // The first map, step by step. The button is never a dead control: a press says why again.
  await expect(why).toContainText('Place a worker first')
  await expect(why).toContainText('1 more thing after this')
  await vbtn.click({ force: true })
  await expect(why).toHaveClass(/flash/)
  await tool(page, 'Agent').click()
  await cell(page, 2, 2).click()
  await expect(why).toContainText('No source is joined to a worker')
  await expect(page.locator('.csource.guided')).not.toHaveCount(0)
  await join(page, 'Request form', /Join to Agent/)
  await expect(why).toContainText('Nothing reaches the result yet')
  await expect(page.locator('.cresult.guided')).toHaveCount(1)
  await join(page, 'Agent', /Join to Loan arranged/)
  await expect(why).toContainText('Agent has no model and no place to run')
  await expect(page.locator('.ctile.guided .ct-part.guided')).toHaveCount(1)
  await page.getByRole('button', { name: '+ Model' }).click()
  await page.locator('.partrow', { hasText: 'Acorn Small' }).click()
  await expect(why).toContainText('Agent has no place to run. Choose one in its box.')
  await page.getByRole('button', { name: '+ Runs on' }).click()
  await page.locator('.partrow', { hasText: 'Acorn public API' }).click()
  await expect(why).toContainText('A reference librarian signs every answer')

  // Refusals, each at its place, each until the next action.
  await port(page, 'Shared catalog').click()
  await page.locator('.cresult').click()
  await expect(note).toContainText('Shared catalog cannot reach the result by itself')
  await page.keyboard.press('Escape')
  await expect(note).toHaveCount(0)
  await tool(page, 'Rule').click()
  await page.locator('.ctile').first().click()
  await expect(note).toContainText('This cell is taken')
  await cell(page, 1, 2).click()
  await expect(note).toHaveCount(0)
  await port(page, 'Agent').click()
  await page.locator('.ctile', { hasText: 'Rule' }).click()
  await expect(note).toContainText('Rule stands left of Agent')
  await page.locator('.ctile', { hasText: 'Rule' }).click()
  await expect(note).toContainText('Rule stands left of Agent')       // still in join mode, still said
  await page.keyboard.press('Escape')
  await port(page, 'Request form').click()
  await page.locator('.ctile', { hasText: 'Agent' }).click()
  await expect(note).toContainText('Request form is already joined to Agent')
  await page.locator('.csource', { hasText: 'Shared catalog' }).click()
  await expect(note).toContainText('A line cannot end at Shared catalog')
  await page.keyboard.press('Escape')
  await page.locator('.csource', { hasText: 'Partner mailbox' }).click()
  await expect(note).toContainText('Partner mailbox is locked. Do “Connect the partner mailbox” in Actions to open it.')
  await tool(page, 'Card reader').click({ force: true })
  await expect(page.locator('.tb-told')).toContainText('Do “Scan the old card files” in Actions')

  // A line that a rule of the pack refuses: the server's words, at the place of the line.
  await page.locator('.arow[data-action="rb-a-cards"]').getByRole('button', { name: 'Start' }).click()
  await expect(page.getByRole('button', { name: 'Draw a line from Old card files' })).toBeVisible({ timeout: 20_000 })
  await join(page, 'Old card files', /Join to Agent/)
  await expect(note).toContainText('An agent cannot read them as they are')
  await expect(page.locator('.cline')).toHaveCount(2)                   // the line is not drawn
  // Advice on a line: said once beside it, and again from its mark.
  await join(page, "Librarians' forum", /Join to Agent/)
  await expect(note).toContainText('The forum is full of opinions')
  await expect(page.locator('.cnote.advice')).toHaveCount(1)
  await page.locator('.cnote-x').click()
  await expect(note).toHaveCount(0)
  await page.locator('.cadvice-hit').click({ force: true })
  await expect(page.locator('.cnote.advice')).toContainText('The forum is full of opinions')

  // Too many minutes names the person and the numbers.
  await tool(page, 'Reference librarian').click()
  await cell(page, 3, 2).click()
  await join(page, 'Agent', /Join to Reference librarian/)
  await join(page, 'Reference librarian', /Join to Loan arranged/)
  await join(page, 'Request form', /Join to Reference librarian/)
  await join(page, 'Shared catalog', /Join to Reference librarian/)
  await join(page, 'Courier site', /Join to Reference librarian/)
  await expect(why).toContainText(/Reference librarian would need \d+ minutes a case and has 4/)
  await expect(page.locator('.ctile.k-person .ct-body.over')).toHaveCount(1)
  await page.locator('.cline .hit[aria-label^="Line from Courier site to Reference librarian"]').click({ force: true })
  await page.keyboard.press('Delete')
  await page.locator('.cline .hit[aria-label^="Line from Shared catalog to Reference librarian"]').click({ force: true })
  await page.keyboard.press('Delete')
  await page.locator('.cline .hit[aria-label^="Line from Request form to Reference librarian"]').click({ force: true })
  await page.keyboard.press('Delete')
  await expect(page.locator('.ctile.k-person .ct-body')).toHaveText(/of 4 min a case/)
  await expect(why).toContainText('Ready. Press Validate')
  await expect(vbtn).not.toHaveAttribute('aria-disabled', 'true')
  await noErrorNames(page)
  s.close()
})

test('the phone: the assessment first, a tour that switches tabs, and an interview that keeps its words', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'phone only')
  const s = await setup(page, 'E2E guide phone', 5)
  await joinPicked(page, s.code, 'Guide Phone', /Riverbend/)
  await s.host('next'); await s.host('next')
  await page.getByRole('button', { name: 'Start investigating' }).tap()
  await expect(page.locator('.ptabs button .tl')).toHaveText(['Assessment', 'Investigations', 'Evidence'])
  await expect(page.locator('.ptabs button').first()).toHaveAttribute('aria-pressed', 'true')
  const card = page.locator('.tour-card')
  await expect(card).toContainText('1 of 4')
  await card.getByRole('button', { name: 'Next' }).tap()
  await expect(page.locator('.ptabs button', { hasText: 'Investigations' })).toHaveAttribute('aria-pressed', 'true')
  await card.getByRole('button', { name: 'End tour' }).tap()
  await expect(page.locator('.ptabs button', { hasText: 'Assessment' })).toHaveAttribute('aria-pressed', 'true')
  // An interview that ends keeps its words until the player acts.
  await page.locator('.ptabs button', { hasText: 'Investigations' }).tap()
  await page.locator('.irow', { hasText: 'Ask Mara about the desk' }).getByRole('button', { name: 'Start' }).tap()
  const ended = page.locator('.ilines.ended')
  await expect(ended).toBeVisible({ timeout: 20_000 })
  await expect(ended.locator('.iline').first()).toBeVisible()
  await page.waitForTimeout(1500)
  await expect(ended).toBeVisible()
  await ended.getByRole('button', { name: 'Read it again' }).tap()
  await expect(page.locator('.ptabs button', { hasText: 'Evidence' })).toHaveAttribute('aria-pressed', 'true')
  await page.locator('.ptabs button', { hasText: 'Investigations' }).tap()
  await expect(page.locator('.ilines.ended')).toHaveCount(0)
  const w = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth])
  expect(w[0]).toBeLessThanOrEqual(w[1]!)
  s.close()
})
