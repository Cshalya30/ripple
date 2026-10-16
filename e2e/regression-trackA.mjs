// Track A regression checks (Playwright). Each check records PASS or FAIL with the reason; the script exits 1 if any FAIL.
// One private sandbox business is created and its sign-in reused, so the demo-creation rate limit (6 a minute) is never hit.
// Usage: RIPPLE_URL=http://localhost:8766 node regression-trackA.mjs [outDir]
import { chromium } from 'playwright-core'
import fs from 'node:fs'

const BASE = process.env.RIPPLE_URL || 'http://localhost:8000'
const OUT = process.argv[2] || 'audit-out'
fs.mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const results = []
const NL = String.fromCharCode(10)
const check = (id, name, ok, detail = '') => { results.push({ id, name, status: ok ? 'PASS' : 'FAIL', detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${name}${ok ? '' : '  -> ' + detail}`) }
const firstLine = (e) => String(e.message).split(NL)[0]
async function block(id, fn) { try { await fn() } catch (e) { check(id, 'the check could not complete', false, firstLine(e)) } }

// sign in once
const boot = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const bootPage = await boot.newPage()
await bootPage.goto(`${BASE}/login`)
await bootPage.getByRole('button', { name: /Open demo business/ }).click()
await bootPage.waitForSelector('text=Do today', { timeout: 20000 })
const state = await boot.storageState()
await boot.close()

async function fresh(path = '/app/today', ready = 'text=Do today') {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: state, acceptDownloads: true })
  const page = await ctx.newPage()
  await page.goto(`${BASE}${path}`)
  if (ready) await page.waitForSelector(ready, { timeout: 20000 })
  return { ctx, page }
}
const api = async (page, method, path, body) => {
  const response = await page.request.fetch(`${BASE}/api${path}`, { method, headers: { 'X-Ripple': '1', 'Content-Type': 'application/json' }, data: body ? JSON.stringify(body) : undefined })
  return { status: response.status(), json: await response.json().catch(() => null) }
}
const ERR = /went wrong|try again|could not|couldn.t|unavailable/i

await block('R1', async () => {
  const { ctx, page } = await fresh()
  await page.route('**/api/today', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"unexpected":"shape"}' }))
  await page.goto(`${BASE}/app/today`)
  const msg = page.getByText('This screen hit a problem')
  await msg.waitFor({ timeout: 8000 }).catch(() => {})
  check('R1a', 'a screen crash shows the recovery message instead of a blank app', await msg.isVisible())
  check('R1b', 'the navigation is still on screen after the crash', await page.getByRole('link', { name: 'Book' }).isVisible().catch(() => false))
  await page.unroute('**/api/today')
  await page.getByRole('link', { name: 'Book' }).click({ timeout: 5000 })
  await page.waitForSelector('text=Runway', { timeout: 10000 }).catch(() => {})
  check('R1c', 'moving to another screen clears the crash message', !(await msg.isVisible()))
  await ctx.close()
})

await block('R2', async () => {
  const { ctx, page } = await fresh()
  await page.getByRole('button', { name: 'Munim' }).click()
  const box = page.getByRole('textbox', { name: 'Message to Munim' })
  await box.fill('Who owes me the most?')
  const request = page.waitForRequest((r) => r.url().includes('/api/assistant/chat'))
  await box.press('Enter')
  const sent = await request.then((r) => r.postDataJSON()).catch(() => null)
  check('R2a', 'the question is sent to the backend', !!sent && sent.message === 'Who owes me the most?', JSON.stringify(sent))
  const reply = page.getByText(/Customers owe/)
  await reply.waitFor({ timeout: 15000 }).catch(() => {})
  check('R2b', 'the answer is rendered, and it is about who owes money', await reply.isVisible())
  await ctx.close()
})

await block('R3', async () => {
  const { ctx, page } = await fresh()
  await page.getByRole('button', { name: 'Munim' }).click()
  const box = page.getByRole('textbox', { name: 'Message to Munim' })
  let calls = 0
  page.on('request', (r) => { if (r.url().includes('/api/assistant/chat')) calls++ })
  await box.fill('    ')
  await box.press('Enter')
  await page.waitForTimeout(700)
  check('R3a', 'a blank question sends nothing', calls === 0, `calls=${calls}`)
  const runway = async () => (await page.locator('body').innerText()).split('Cash runs short on').length - 1
  const runwayBefore = await runway()
  await page.route('**/api/assistant/chat', (route) => route.abort('failed'))
  await box.fill('Why is there a dip?')
  await box.press('Enter')
  await page.getByText(ERR).first().waitFor({ timeout: 6000 }).catch(() => {})
  const body = await page.locator('body').innerText()
  check('R3b', 'a failed request shows an error message, not a fake answer', ERR.test(body) && (await runway()) === runwayBefore)
  await page.unroute('**/api/assistant/chat')
  await box.fill('Why is there a dip?')
  await box.press('Enter')
  await page.waitForFunction((n) => document.body.innerText.split('Cash runs short on').length - 1 > n, runwayBefore, { timeout: 15000 }).catch(() => {})
  check('R3c', 'retrying after the failure works', (await runway()) > runwayBefore)
  await ctx.close()
})

await block('R4', async () => {
  const { ctx, page } = await fresh()
  await page.route('**/api/book/summary', (route) => route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":{"code":"UNAUTHENTICATED","details":null}}' }))
  await page.getByRole('link', { name: 'Book' }).click()
  await page.waitForURL(/\/login/, { timeout: 8000 }).catch(() => {})
  check('R4a', 'a 401 mid-session returns to the sign-in page', page.url().includes('/login'), page.url())
  await page.unroute('**/api/book/summary')
  await page.getByRole('button', { name: /Open demo business/ }).click()
  await page.waitForURL(/\/app\/book/, { timeout: 15000 }).catch(() => {})
  check('R4b', 'after signing in again the person lands back on the page they were on', page.url().includes('/app/book'), page.url())
  await ctx.close()
})

await block('R5', async () => {
  const { ctx, page } = await fresh('/app/book?tab=risk', '.gp')
  await page.getByRole('button', { name: 'Check it' }).click()
  await page.getByText('Best').first().waitFor({ timeout: 15000 }).catch(() => {})
  check('R5a', 'a recommended option is marked', await page.getByText('Best').first().isVisible())
  await page.getByRole('button', { name: 'Show in Engine' }).first().click()
  await page.waitForURL(/\/app\/engine/, { timeout: 10000 }).catch(() => {})
  await page.getByText('Back to baseline').first().waitFor({ timeout: 10000 }).catch(() => {})
  check('R5b', 'the option opens as a what-if in the Engine', page.url().includes('/app/engine') && (await page.getByText('Back to baseline').count()) > 0)
  await ctx.close()
})

await block('R6', async () => {
  const { ctx, page } = await fresh()
  await page.evaluate(() => document.activeElement && document.activeElement.blur())
  await page.keyboard.press('/')
  const palette = page.getByRole('combobox').first()
  await palette.waitFor({ timeout: 5000 })
  await page.waitForTimeout(400)
  await palette.fill('RISK')
  await page.waitForTimeout(300)
  await page.keyboard.press('Enter')
  await page.waitForURL(/tab=risk/, { timeout: 8000 }).catch(() => {})
  check('R6a', 'the RISK command opens Book, Risk & Finance', page.url().includes('tab=risk'), page.url())
  await page.evaluate(() => document.activeElement && document.activeElement.blur())
  const open = async () => (await page.getByRole('textbox', { name: 'Message to Munim' }).count()) > 0
  const before = await open()
  await page.keyboard.press('m')
  await page.waitForTimeout(500)
  check('R6b', 'the M key toggles Munim', (await open()) !== before)
  await ctx.close()
})

await block('R7', async () => {
  const { ctx, page } = await fresh()
  const bell = page.getByRole('button', { name: /\d+ alerts/ })
  await bell.click()
  const items = page.locator('.popover button.list-row')
  const total = await items.count()
  const bad = []
  for (let i = 0; i < total; i++) {
    await page.goto(`${BASE}/app/today`)
    await page.waitForSelector('text=Do today')
    await bell.click()
    const item = page.locator('.popover button.list-row').nth(i)
    const label = (await item.innerText()).split(NL).join(' ').slice(0, 60)
    const beforeUrl = page.url()
    await item.click()
    await page.waitForTimeout(900)
    const text = await page.locator('body').innerText()
    const drawer = (await page.locator('.drawer, [role="dialog"]').count()) > 0
    if (/This screen hit a problem/i.test(text) || page.url().includes('/login') || (page.url() === beforeUrl && !drawer)) bad.push(label)
  }
  check('R7', `each of the ${total} alerts in the bell leads somewhere (a screen or the party drawer)`, total > 0 && bad.length === 0, JSON.stringify(bad))
  await ctx.close()
})

await block('R8', async () => {
  const { ctx, page } = await fresh('/app/book?tab=risk', '.gp')
  await page.getByText('How good are these checks?').click()
  await page.getByLabel('Which check should have caught it').selectOption('DUPLICATE')
  await page.getByLabel('What it missed').fill('Paid the same bill twice in cash')
  await page.getByRole('button', { name: 'Log a miss' }).click()
  await page.getByText(/Logged/).first().waitFor({ timeout: 6000 }).catch(() => {})
  check('R8a', 'logging a missed entry confirms it', await page.getByText(/Logged/).first().isVisible())
  await page.waitForTimeout(1000)
  const cells = await page.locator('tr', { hasText: 'Possible duplicate payment' }).first().locator('td').allInnerTexts()
  check('R8b', 'the miss shows in the per-check tally after the data refreshes', cells[3]?.trim() === '1', JSON.stringify(cells))
  await ctx.close()
})

await block('R9', async () => {
  const { ctx, page } = await fresh('/app/book?tab=ledger', 'text=Ledger')
  const download = page.waitForEvent('download', { timeout: 8000 })
  await page.getByRole('link', { name: 'Export CSV' }).click()
  const file = await download
  const text = fs.readFileSync(await file.path(), 'utf8')
  const lines = text.split(NL).length
  check('R9', 'Export CSV downloads a real CSV with the ledger data', /\.csv$/i.test(file.suggestedFilename()) && lines > 10, `${file.suggestedFilename()} lines=${lines}`)
  await ctx.close()
})

await block('R10', async () => {
  const { ctx, page } = await fresh('/app/engine', '.pnode')
  await page.getByRole('tab', { name: 'flow' }).click()
  await page.waitForSelector('.enode')
  await page.locator('body').click({ position: { x: 800, y: 300 } })
  const play = page.getByRole('button', { name: /^(Play|Pause)/ })
  const label = async () => (await play.first().getAttribute('aria-label')) ?? ''
  const day = async () => Number(await page.locator('[role="slider"][aria-label="Simulated day"]').getAttribute('aria-valuenow'))
  const d0 = await day()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(300)
  check('R10a', 'the arrow keys move the timeline one day at a time', (await day()) === d0 + 2, `${d0} -> ${await day()}`)
  await page.keyboard.press(' ')
  await page.waitForTimeout(300)
  check('R10b', 'Space starts playback and the button says Pause', (await label()) === 'Pause', await label())
  await page.waitForTimeout(1500)
  const moved = await day()
  await page.keyboard.press(' ')
  await page.waitForTimeout(300)
  const stopped = await day()
  await page.waitForTimeout(1200)
  check('R10c', 'playback advanced while playing and stays put after Pause', moved > d0 + 2 && (await day()) === stopped, `${d0 + 2} -> ${moved}, paused at ${stopped}, later ${await day()}`)
  await page.keyboard.press('Home')
  await page.waitForTimeout(300)
  check('R10d', 'Home returns to day 0', (await day()) === 0)
  await page.keyboard.press('n')
  await page.waitForTimeout(400)
  check('R10e', 'N jumps to the next issue', (await day()) > 0, String(await day()))
  await ctx.close()
})

await block('R11', async () => {
  const { ctx, page } = await fresh('/app/today')
  const before = (await api(page, 'GET', '/transactions')).json
  const row = page.locator('li.list-row', { hasText: 'Rajdhani Roadlines' }).first()
  await row.getByRole('button', { name: 'Mark paid' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor({ timeout: 8000 })
  await dialog.getByRole('button', { name: /Save and recalculate/ }).dblclick()
  await page.waitForTimeout(1500)
  const after = (await api(page, 'GET', '/transactions')).json
  const added = after.rows.filter((r) => !before.rows.some((b) => b.id === r.id))
  check('R11a', 'recording a payment from Today stores exactly one transaction, even on a double click', added.length === 1 && added[0].amount_paise === 3800000 && added[0].direction === 'OUT', JSON.stringify(added.map((a) => [a.amount_paise, a.direction])))
  await page.goto(`${BASE}/app/today`)
  await page.waitForSelector('text=Do today')
  check('R11b', 'the paid bill leaves "Do today"', (await page.locator('li.list-row', { hasText: 'Pay Rajdhani Roadlines' }).count()) === 0)
  await ctx.close()
})

await block('R12', async () => {
  const { ctx, page } = await fresh()
  const parties = (await api(page, 'GET', '/parties?kind=SUPPLIER')).json.parties
  const supplier = parties.find((p) => p.name.startsWith('Gopal'))
  for (const [amount, ref] of [[2345000, 'AUD-A'], [2345000, 'AUD-A'], [3111000, 'AUD-B'], [3111000, 'AUD-B']]) {
    await api(page, 'POST', '/transactions', { party_id: supplier.id, direction: 'OUT', amount_paise: amount, date: '2026-10-13', medium: 'NEFT', reference: ref })
  }
  await page.goto(`${BASE}/app/book?tab=risk`)
  await page.waitForSelector('#guard-flags')
  const cards = page.locator('li.flag')
  await cards.first().waitFor({ timeout: 10000 })
  check('R12a', 'repeated payments show up as two flagged entries', (await cards.count()) === 2, String(await cards.count()))
  await cards.first().getByRole('button', { name: 'Looks fine' }).click()
  await page.waitForTimeout(1200)
  check('R12b', '"Looks fine" removes the flag from the list', (await page.locator('li.flag').count()) === 1)
  await page.locator('li.flag').first().getByRole('button', { name: "It's real" }).click()
  await page.waitForTimeout(1200)
  check('R12c', '"It is real" keeps it, under confirmed issues', (await page.getByText(/1 confirmed issue/).count()) === 1)
  await page.getByText('How good are these checks?').click()
  const cells = await page.locator('tr', { hasText: 'Possible duplicate payment' }).first().locator('td').allInnerTexts()
  check('R12d', 'the check tally counts one real, one fine', cells[1].trim() === '1' && cells[2].trim() === '1', JSON.stringify(cells))
  await ctx.close()
})

await block('R13', async () => {
  const { ctx, page } = await fresh()
  await page.getByRole('button', { name: 'Munim' }).click()
  const before = (await page.locator('body').innerText()).split(NL)
  await page.getByRole('button', { name: /^Speak in/ }).click()
  await page.waitForTimeout(2500)
  const added = (await page.locator('body').innerText()).split(NL).filter((l) => !before.includes(l))
  check('R13', 'a denied microphone gives a clear message and a way to dismiss it', added.some((l) => /Microphone access is blocked/.test(l)), JSON.stringify(added))
  await ctx.close()
})

await block('R14', async () => {
  const { ctx, page } = await fresh('/app/engine', '.pnode')
  await page.getByRole('button', { name: 'Try a what-if' }).click()
  await page.getByLabel('What if').selectOption('EXTENSION')
  let posts = 0
  page.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith('/api/engine/scenario')) posts++ })
  for (const bad of ['0', 'abc', '-3', '999999']) {
    await page.getByLabel('Extra days').fill(bad)
    await page.getByRole('button', { name: 'Run scenario' }).click()
    await page.waitForTimeout(250)
  }
  check('R14a', 'invalid day counts are refused on screen without calling the engine', posts === 0, `posts=${posts}`)
  const message = await page.locator('.scenario-form').innerText()
  check('R14b', 'the form says what is wrong in words', /whole number|between|at least|must/i.test(message), message.split(NL).join(' ').slice(0, 160))
  await page.getByLabel('Extra days').fill('10')
  await page.getByRole('button', { name: 'Run scenario' }).click()
  await page.getByText('Back to baseline').first().waitFor({ timeout: 15000 }).catch(() => {})
  check('R14c', 'a valid what-if runs the engine once and shows the scenario banner', posts === 1 && (await page.getByText('Back to baseline').count()) > 0, `posts=${posts}`)
  await page.getByRole('button', { name: 'Back to baseline' }).first().click()
  await page.waitForTimeout(600)
  check('R14d', 'Back to baseline clears the scenario', (await page.getByText('Back to baseline').count()) === 0)
  await ctx.close()
})

fs.writeFileSync(`${OUT}/regression-trackA.json`, JSON.stringify(results, null, 1))
await browser.close()
const failed = results.filter((r) => r.status === 'FAIL').length
console.log(`${NL}${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
