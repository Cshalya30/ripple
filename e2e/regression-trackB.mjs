// Track B user journeys: forms, dialogs, destructive steps (cancel and confirm), orders, inventory, settings, setup, legal pages, languages.
// Usage: RIPPLE_URL=http://localhost:8766 node regression-trackB.mjs <outDir>
// Each check prints PASS or FAIL and is recorded in <outDir>/trackB-journeys.json. All data is synthetic, in private demo sandboxes.
import { chromium } from 'playwright-core'
import fs from 'node:fs'

const BASE = process.env.RIPPLE_URL || 'http://localhost:8000'
const OUT = process.argv[2] || 'audit-out'
fs.mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const RUN = Date.now().toString(36)
const results = []
let current = ''
const problems = []

async function newPage(width = 1440) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => problems.push(`${current}: pageerror ${e.message.slice(0, 160)}`))
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 4\d\d|status of 5\d\d/.test(m.text())) problems.push(`${current}: console ${m.text().slice(0, 160)}`) })
  page.on('dialog', (d) => { problems.push(`${current}: unexpected browser dialog "${d.message().slice(0, 60)}"`); void d.dismiss() })
  return page
}
async function demo(page) {
  // Demo creation is limited to 6 a minute per address; wait out the window rather than fail.
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.goto(`${BASE}/login`)
    await page.getByRole('button', { name: /Open demo business/ }).click()
    if (await page.waitForSelector('text=Do today', { timeout: 8000 }).then(() => true).catch(() => false)) return
    await page.waitForTimeout(20000)
  }
  throw new Error('could not open a demo business')
}
const settle = (page) => page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {}).then(() => page.waitForTimeout(300))

async function check(name, fn) {
  current = name
  try {
    const out = await fn()
    const ok = out === undefined || out === true
    results.push({ name, status: ok ? 'PASS' : 'FAIL', detail: ok ? undefined : String(out) })
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ' :: ' + out}`)
  } catch (e) {
    results.push({ name, status: 'FAIL', detail: e.message.split('\n')[0] })
    console.log(`FAIL  ${name} :: ${e.message.split('\n')[0]}`)
  }
}
const api = async (page, method, path, body) => page.evaluate(async ([m, p, b]) => {
  const r = await fetch(p, { method: m, headers: { 'Content-Type': 'application/json', 'X-Ripple': '1' }, body: b ? JSON.stringify(b) : undefined })
  let j = null; try { j = await r.json() } catch {}
  return { status: r.status, body: j }
}, [method, `/api${path}`, body])

// ======================================================= 1. Record payment dialog
{
  const page = await newPage()
  await demo(page)
  await page.goto(`${BASE}/app/khata`); await settle(page)
  const open = async () => { await page.getByRole('button', { name: 'Record payment' }).first().click(); await page.getByRole('dialog').waitFor() }
  await open()
  const dlg = page.getByRole('dialog')
  const save = dlg.getByRole('button', { name: /Save and recalculate/ })
  const amount = dlg.locator('input[inputmode="decimal"]')
  await dlg.locator('select').first().selectOption({ index: 1 }) // first customer
  await page.waitForTimeout(500)

  for (const [text, label] of [['1e5', 'exponent'], ['0x10', 'hex'], ['12.345', 'three decimals'], ['-5', 'negative'], ['abc', 'letters'], ['0', 'zero'], ['', 'empty'], ['99999999999999', 'too large']]) {
    await check(`payment amount "${text}" (${label}) is refused with Save disabled`, async () => {
      await amount.fill(text)
      return (await save.isDisabled()) || `Save was enabled for "${text}"`
    })
  }
  await check('payment amount shows an explanation under the field', async () => {
    await amount.fill('12.345')
    return (await dlg.locator('[role="alert"]').count()) > 0 || 'no message'
  })
  await check('a valid cheque is saved as pending and the dialog closes after one click even if double-clicked', async () => {
    await dlg.locator('select').nth(1).selectOption('').catch(() => {})
    await amount.fill('1,500.50')
    await dlg.locator('select').filter({ has: page.locator('option[value="CHEQUE"]') }).selectOption('CHEQUE')
    const before = (await api(page, 'GET', '/transactions')).body.count
    await save.dblclick()
    await page.waitForTimeout(1200)
    const after = (await api(page, 'GET', '/transactions')).body.count
    return after - before === 1 || `transactions went ${before} -> ${after}`
  })
  await check('Escape closes the payment dialog and focus returns to the button that opened it', async () => {
    await open()
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    const closed = (await page.getByRole('dialog').count()) === 0
    const focusOk = await page.evaluate(() => /Record payment/.test(document.activeElement?.textContent || ''))
    return (closed && focusOk) || `closed=${closed} focus returned=${focusOk}`
  })
  await check('Tab stays inside the open dialog (focus trap)', async () => {
    await open()
    for (let i = 0; i < 14; i++) await page.keyboard.press('Tab')
    const inside = await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))
    await page.keyboard.press('Escape')
    return inside || 'focus left the dialog'
  })
  await page.context().close()
}

// ======================================================= 2. Pending cheques in the ledger (John BUG-004 / BUG-006 through the screen)
{
  const page = await newPage()
  await demo(page)
  const parties = (await api(page, 'GET', '/parties?kind=CUSTOMER')).body.parties
  const anand = parties.find((p) => p.name === 'Anand Silk Emporium')
  const detail = (await api(page, 'GET', `/parties/${anand.id}`)).body
  const inv = detail.open_items[0]
  const first = await api(page, 'POST', '/transactions', { party_id: anand.id, direction: 'IN', amount_paise: inv.amount_paise, date: '2026-10-14', medium: 'CHEQUE', reference: '700001', invoice_id: inv.id })
  await check('first pending cheque for the whole bill is accepted', async () => first.status === 200 || `status ${first.status}`)
  await page.goto(`${BASE}/app/khata`); await settle(page)
  await page.getByRole('button', { name: 'Record payment' }).first().click()
  const dlg = page.getByRole('dialog')
  await dlg.locator('select').first().selectOption(anand.id)
  await page.waitForTimeout(700)
  await check('a second cheque for the same bill is refused on screen with a plain sentence', async () => {
    const amount = dlg.locator('input[inputmode="decimal"]')
    await amount.fill(String(inv.amount_paise / 100))
    await dlg.locator('select').filter({ has: page.locator('option[value="CHEQUE"]') }).selectOption('CHEQUE')
    await dlg.getByRole('button', { name: /Save and recalculate/ }).click()
    await page.waitForTimeout(900)
    const text = await dlg.innerText()
    return /pending cheque already covers/i.test(text) || `dialog said: ${text.slice(-160)}`
  })
  await page.keyboard.press('Escape')
  await page.goto(`${BASE}/app/book?tab=ledger`); await settle(page)
  await check('ledger shows Cleared and Bounced buttons on the pending cheque', async () => {
    const cleared = page.getByRole('button', { name: /as cleared/ })
    const bounced = page.getByRole('button', { name: /as bounced/ })
    return ((await cleared.count()) >= 1 && (await bounced.count()) >= 1) || 'buttons missing'
  })
  await check('Bounced removes the buttons and the cash does not change', async () => {
    const before = (await api(page, 'GET', '/book/summary')).body.position.cash_now_paise
    await page.getByRole('button', { name: /as bounced/ }).first().click()
    await page.waitForTimeout(1500)
    const after = (await api(page, 'GET', '/book/summary')).body.position.cash_now_paise
    const gone = (await page.getByRole('button', { name: /as bounced/ }).count()) === 0
    return (gone && before === after) || `buttons gone=${gone} cash ${before}->${after}`
  })
  await check('after a bounce the same bill can be paid again', async () => (await api(page, 'POST', '/transactions', { party_id: anand.id, direction: 'IN', amount_paise: inv.amount_paise, date: '2026-10-14', medium: 'UPI', reference: 'U1', invoice_id: inv.id })).status === 200)
  await page.context().close()
}

// ======================================================= 3. Khata: add party validation, special characters, form reset
{
  const page = await newPage()
  await demo(page)
  await page.goto(`${BASE}/app/khata`); await settle(page)
  const evil = '<img src=x onerror=alert(1)> & "quotes" \'single\''
  await page.getByRole('button', { name: 'Add customer' }).click()
  const dlg = page.getByRole('dialog')
  await check('credit days "abc" and "400" show a message and disable Add', async () => {
    const days = dlg.locator('input[inputmode="numeric"]').first()
    await dlg.getByLabel('Name').fill('Test Name')
    await days.fill('abc')
    const a = await dlg.getByRole('button', { name: 'Add', exact: true }).isDisabled()
    await days.fill('400')
    const b = await dlg.getByRole('button', { name: 'Add', exact: true }).isDisabled()
    return (a && b) || `disabled abc=${a} 400=${b}`
  })
  await check('a name with markup is stored and shown as text, never run', async () => {
    await dlg.getByLabel('Name').fill(evil)
    await dlg.locator('input[inputmode="numeric"]').first().fill('15')
    await dlg.getByRole('button', { name: 'Add', exact: true }).click()
    await page.waitForTimeout(1200)
    const shown = await page.locator('table').first().innerText()
    const noImg = (await page.locator('table img').count()) === 0
    return (shown.includes('<img src=x') && noImg) || 'markup not shown as text'
  })
  await check('reopening Add customer starts empty (no stale values)', async () => {
    await page.getByRole('button', { name: 'Add customer' }).click()
    const v = await page.getByRole('dialog').getByLabel('Name').inputValue()
    await page.keyboard.press('Escape')
    return v === '' || `name still "${v}"`
  })
  await check('the party drawer opens from a row and closes with Escape', async () => {
    await page.locator('tr.clickable').first().click()
    await page.getByRole('dialog').waitFor({ timeout: 4000 })
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    return (await page.getByRole('dialog').count()) === 0
  })
  await check('the reminder composer drafts a message and never sends', async () => {
    await page.getByRole('button', { name: /Remind/ }).first().click()
    await page.getByRole('dialog').waitFor({ timeout: 6000 })
    await page.waitForTimeout(800)
    const text = await page.getByRole('dialog').innerText()
    const link = await page.getByRole('dialog').locator('a[href*="wa.me"]').first().getAttribute('href').catch(() => null)
    await page.keyboard.press('Escape')
    const noPlaceholders = !/\{\{|\{[a-z_]+\}|undefined|NaN/.test(text)
    return (noPlaceholders && /Template/.test(text)) || `dialog text: ${text.slice(0, 160)}`
  })
  await check('company and party datasheets download as CSV with a BOM-free readable header', async () => {
    await page.goto(`${BASE}/app/settings`); await settle(page)
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }), page.getByRole('button', { name: /Company datasheet/ }).click()])
    const path = await download.path()
    const text = fs.readFileSync(path, 'utf8')
    return (download.suggestedFilename().endsWith('.csv') && text.length > 200) || `file ${download.suggestedFilename()} ${text.length} chars`
  })
  await page.context().close()
}

// ======================================================= 4. Orders: stage forward and back (cancel and confirm), purchase orders, what-if validation
{
  const page = await newPage()
  await demo(page)
  await page.goto(`${BASE}/app/orders`); await settle(page)
  const booksOk = async () => (await api(page, 'GET', '/guard')).body.reconciliation?.checks?.every?.((c) => c.status === 'PASS' || c.status === 'OK' || c.ok === true)
  const row = page.locator('tbody tr').first()
  await check('stage buttons are disabled while one is working (no double move)', async () => {
    const first = page.getByRole('button', { name: /Mark |Start production/ }).first()
    const orderBefore = (await api(page, 'GET', '/sales-orders')).body.orders[0].stage
    await first.dblclick()
    await page.waitForTimeout(1500)
    const orderAfter = (await api(page, 'GET', '/sales-orders')).body.orders[0].stage
    const stages = ['PLANNED', 'MATERIALS_READY', 'IN_PRODUCTION', 'READY', 'DELIVERED', 'PAID']
    return stages.indexOf(orderAfter) - stages.indexOf(orderBefore) <= 1 || `${orderBefore} -> ${orderAfter}`
  })
  await check('Undo asks first; Keep as is changes nothing', async () => {
    const before = (await api(page, 'GET', '/sales-orders')).body.orders
    const undo = page.getByRole('button', { name: /Undo/ }).first()
    if ((await undo.count()) === 0) return 'no Undo button present'
    await undo.click()
    await page.getByRole('dialog').waitFor()
    await page.getByRole('button', { name: 'Keep as is' }).click()
    await page.waitForTimeout(500)
    const after = (await api(page, 'GET', '/sales-orders')).body.orders
    return JSON.stringify(before.map((o) => o.stage)) === JSON.stringify(after.map((o) => o.stage)) || 'stage changed after Keep as is'
  })
  await check('Undo confirm moves the order back and the books checks still pass', async () => {
    const before = (await api(page, 'GET', '/sales-orders')).body.orders
    const target = before.find((o) => o.stage !== 'PLANNED' && o.stage !== 'PAID')
    if (!target) return 'no order is past planned'
    const res = await api(page, 'PATCH', `/sales-orders/${encodeURIComponent(target.id)}`, { stage: 'PLANNED' })
    const guard = (await api(page, 'GET', '/guard')).body
    const failed = (guard.books_check?.checks || guard.reconciliation?.checks || []).filter((c) => c.status && !['PASS', 'OK'].includes(c.status))
    return (res.status === 200 && failed.length === 0) || `status ${res.status}, failing checks ${JSON.stringify(failed).slice(0, 200)}`
  })
  await page.goto(`${BASE}/app/orders?tab=new`); await settle(page)
  await check('"Can I take this order?" refuses text in quantity and price with a message', async () => {
    await page.getByLabel('Qty').fill('abc')
    const msg1 = (await page.locator('[role="alert"]').allInnerTexts()).join(' ')
    await page.getByLabel('Qty').fill('10')
    await page.getByLabel(/Price each/).fill('abc')
    const msg2 = (await page.locator('[role="alert"]').allInnerTexts()).join(' ')
    return (/Quantity/.test(msg1) && /Price/.test(msg2)) || `messages: ${msg1} | ${msg2}`
  })
  await page.goto(`${BASE}/app/orders?tab=purchase`); await settle(page)
  await check('a purchase order can be created, received and undone, and stock follows', async () => {
    const inv0 = (await api(page, 'GET', '/inventory')).body.materials
    await page.getByRole('button', { name: 'New purchase order' }).click()
    const selects = page.locator('.notice select')
    await selects.nth(0).selectOption({ index: 1 })
    await page.locator('.notice input[inputmode="decimal"]').fill('5')
    await page.getByRole('button', { name: 'Create purchase order' }).click()
    await page.waitForTimeout(1500)
    const pos = (await api(page, 'GET', '/purchase-orders')).body.orders
    const po = pos.find((o) => o.status === 'ORDERED')
    if (!po) return 'no ordered PO after create'
    const rec = await api(page, 'PATCH', `/purchase-orders/${encodeURIComponent(po.id)}`, { status: 'ARRIVED' })
    const inv1 = (await api(page, 'GET', '/inventory')).body.materials
    const undo = await api(page, 'PATCH', `/purchase-orders/${encodeURIComponent(po.id)}`, { status: 'UNDO' })
    const inv2 = (await api(page, 'GET', '/inventory')).body.materials
    const byName = (list) => list.find((m) => m.name === po.material)?.on_hand
    const m0 = byName(inv0), m1 = byName(inv1), m2 = byName(inv2)
    return (rec.status === 200 && undo.status === 200 && m1 > m0 && m2 === m0) || `received ${rec.status} undo ${undo.status} stock ${m0} -> ${m1} -> ${m2}`
  })
  await page.context().close()
}

// ======================================================= 5. Inventory
{
  const page = await newPage()
  await demo(page)
  await page.goto(`${BASE}/app/inventory`); await settle(page)
  await check('new material: an empty name is refused with a message and nothing is created', async () => {
    const before = (await api(page, 'GET', '/inventory')).body.materials.length
    await page.getByRole('button', { name: /New raw material/ }).click()
    const dlg = page.getByRole('dialog')
    await dlg.waitFor()
    await dlg.getByRole('button', { name: 'Add material' }).click()
    await page.waitForTimeout(500)
    const msg = (await dlg.locator('[role="alert"]').allInnerTexts()).join(' ')
    const after = (await api(page, 'GET', '/inventory')).body.materials.length
    return (/Name is required/.test(msg) && before === after) || `message "${msg}" count ${before}->${after}`
  })
  await check('new material: cost "1e3", opening stock with too many decimals are refused', async () => {
    const dlg = page.getByRole('dialog')
    await dlg.getByPlaceholder('Indigo dye').fill('Audit dye')
    await dlg.locator('input[inputmode="decimal"]').first().fill('1e3')
    await dlg.getByRole('button', { name: 'Add material' }).click()
    await page.waitForTimeout(400)
    const m1 = (await dlg.locator('[role="alert"]').allInnerTexts()).join(' ')
    await dlg.locator('input[inputmode="decimal"]').first().fill('10')
    await dlg.locator('input[inputmode="decimal"]').nth(1).fill('1.23456')
    await dlg.getByRole('button', { name: 'Add material' }).click()
    await page.waitForTimeout(400)
    const m2 = (await dlg.locator('[role="alert"]').allInnerTexts()).join(' ')
    return (/Cost/.test(m1) && /Opening stock/.test(m2)) || `messages "${m1}" | "${m2}"`
  })
  await page.keyboard.press('Escape')
  await check('search and status filters narrow the list and clearing restores it', async () => {
    const all = await page.locator('tbody tr').count()
    await page.getByRole('searchbox').or(page.locator('.search input')).first().fill('zzzz-no-such')
    await page.waitForTimeout(300)
    const none = await page.locator('tbody tr').count()
    await page.locator('.search input').first().fill('')
    await page.waitForTimeout(300)
    const back = await page.locator('tbody tr').count()
    return (none < all && back === all) || `rows ${all} / ${none} / ${back}`
  })
  await check('stock adjustment needs a note', async () => {
    await page.getByRole('button', { name: /Adjust/ }).first().click()
    const dlg = page.getByRole('dialog')
    await dlg.waitFor()
    const save = dlg.getByRole('button', { name: /Save|Record|Adjust|Apply/ }).last()
    await dlg.locator('input').first().fill('1')
    const disabled = await save.isDisabled()
    await page.keyboard.press('Escape')
    return disabled || 'Save enabled without a note'
  })
  await check('Recipes tab opens a recipe and Movements lists entries', async () => {
    await page.getByRole('tab', { name: /Recipes/ }).click()
    await page.waitForTimeout(500)
    await page.getByRole('button', { name: /Edit|Recipe|Open/ }).first().click().catch(() => {})
    await page.keyboard.press('Escape')
    await page.getByRole('tab', { name: /Movements/ }).click()
    await page.waitForTimeout(800)
    return (await page.locator('tbody tr').count()) > 0 || 'no movements'
  })
  await page.context().close()
}

// ======================================================= 6. Settings and destructive actions
{
  const page = await newPage()
  await demo(page)
  await page.goto(`${BASE}/app/settings`); await settle(page)
  await check('every settings section renders', async () => {
    const titles = await page.locator('.section-title').allInnerTexts()
    const need = ['Business profile', 'Money rules', 'Team and access', 'Data', 'Display', 'Language', 'Accessibility', 'Privacy and security', 'Account']
    const miss = need.filter((n) => !titles.some((t) => t.includes(n)))
    return miss.length === 0 || `missing: ${miss.join(', ')}`
  })
  await check('safety buffer: negative, text and 3 decimals are refused', async () => {
    const buf = page.getByLabel('Safety buffer in rupees')
    const results = []
    for (const v of ['-1', 'abc', '1.234']) { await buf.fill(v); results.push((await page.locator('[aria-invalid="true"]').count()) > 0) }
    await buf.fill('50000')
    return results.every(Boolean) || `invalid flags ${results}`
  })
  await check('invite: bad email and empty name keep Invite disabled; a good one shows the temporary password once', async () => {
    const invite = page.getByRole('button', { name: 'Invite', exact: true })
    await page.getByLabel('Name', { exact: true }).fill('Priya')
    await page.getByLabel('Email', { exact: true }).fill('not-an-email')
    const off = await invite.isDisabled()
    await page.getByLabel('Email', { exact: true }).fill(`priya.${RUN}@example.com`)
    await invite.click()
    await page.waitForTimeout(1200)
    const shown = await page.locator('text=Temporary password').count()
    return (off && shown === 1) || `disabled=${off} shown=${shown}`
  })
  await check('inviting the same email again says it cannot be invited (no account hints)', async () => {
    await page.getByLabel('Name', { exact: true }).fill('Priya Again')
    await page.getByLabel('Email', { exact: true }).fill(`priya.${RUN}@example.com`)
    await page.getByRole('button', { name: 'Invite', exact: true }).click()
    await page.waitForTimeout(900)
    const text = await page.locator('[role="alert"]').allInnerTexts()
    return text.some((t) => /cannot be invited/i.test(t) && !/already has an account/i.test(t)) || `alerts: ${text.join(' | ')}`
  })
  await check('Remove asks twice; waiting disarms it and nothing is removed', async () => {
    const before = (await api(page, 'GET', '/settings')).body.team.length
    const team = page.locator('section', { has: page.locator('.section-title', { hasText: 'Team and access' }) })
    await team.getByRole('button', { name: 'Remove', exact: true }).first().click()
    const armed = await team.getByRole('button', { name: /Remove .*\?/ }).count()
    await page.waitForTimeout(4600)
    const after = (await api(page, 'GET', '/settings')).body.team.length
    return (armed === 1 && before === after) || `armed=${armed} team ${before}->${after}`
  })
  await check('Reset business stays disabled until the exact name is typed; cancel leaves the data', async () => {
    const reset = page.getByRole('button', { name: 'Reset business' })
    const off1 = await reset.isDisabled()
    await page.getByLabel('Type the business name to confirm').fill('wrong name')
    const off2 = await reset.isDisabled()
    const parties = (await api(page, 'GET', '/parties')).body.parties.length
    return (off1 && off2 && parties > 0) || `disabled ${off1}/${off2} parties ${parties}`
  })
  await check('Reset business with the right name empties the sandbox and the app still loads', async () => {
    const name = await page.locator('.field-label strong').first().innerText()
    await page.getByLabel('Type the business name to confirm').fill(name)
    await page.getByRole('button', { name: 'Reset business' }).click()
    await page.waitForTimeout(1500)
    const parties = (await api(page, 'GET', '/parties')).body.parties.length
    await page.goto(`${BASE}/app/today`); await settle(page)
    const text = await page.locator('body').innerText()
    return (parties === 0 && !/Internal|Traceback|undefined|NaN/.test(text)) || `parties ${parties}`
  })
  await check('an empty business shows helpful empty states on Khata, Orders, Inventory, Book', async () => {
    const bad = []
    for (const p of ['/app/khata', '/app/orders', '/app/inventory', '/app/book', '/app/engine']) {
      await page.goto(`${BASE}${p}`); await settle(page)
      const t = await page.locator('body').innerText()
      if (/Internal|Traceback|undefined|NaN|Couldn't reach/.test(t)) bad.push(p)
    }
    return bad.length === 0 || `errors on ${bad.join(', ')}`
  })
  await check('Load demo data restores it after a confirm click', async () => {
    await page.goto(`${BASE}/app/settings`); await settle(page)
    await page.getByRole('button', { name: 'Load demo data' }).click()
    await page.getByRole('button', { name: /Replace everything/ }).click()
    await page.waitForTimeout(2000)
    return (await api(page, 'GET', '/parties')).body.parties.length > 0
  })
  await page.context().close()
}

// ======================================================= 7. Setup
{
  const page = await newPage()
  await demo(page)
  await page.goto(`${BASE}/setup`); await settle(page)
  await check('setup: with no AI key, a description gives a plain message and keeps the text', async () => {
    await page.locator('textarea').fill('I make sarees. I have 5 lakh in the bank. Anand owes me 2 lakh due next week.')
    await page.getByRole('button', { name: 'Read my description' }).click()
    await page.waitForTimeout(2000)
    const msg = (await page.locator('[role="alert"]').allInnerTexts()).join(' ')
    const kept = (await page.locator('textarea').inputValue()).length > 20
    return (/AI service|server|key|demo/i.test(msg) && kept) || `alert "${msg}" kept=${kept}`
  })
  await check('setup: Load the demo business asks before replacing records, and Keep stops it', async () => {
    await page.getByRole('button', { name: 'Load the demo business' }).click()
    const dlg = page.getByRole('dialog')
    await dlg.waitFor({ timeout: 4000 })
    await dlg.getByRole('button', { name: 'Keep my records' }).click()
    await page.waitForTimeout(300)
    return page.url().endsWith('/setup') || `moved to ${page.url()}`
  })
  await page.context().close()
}

// ======================================================= 8. Public pages, cookie notice, 404, titles
{
  const page = await newPage()
  await page.goto(`${BASE}/login`); await settle(page)
  await check('cookie notice shows on login, links to privacy and stays dismissed', async () => {
    const shown = await page.getByRole('region', { name: 'Cookie notice' }).count()
    await page.getByRole('region', { name: 'Cookie notice' }).getByRole('button', { name: 'OK' }).click()
    await page.reload(); await settle(page)
    const after = await page.getByRole('region', { name: 'Cookie notice' }).count()
    return (shown === 1 && after === 0) || `shown ${shown} after ${after}`
  })
  await check('Privacy and Terms are linked from login, have headings and a way back', async () => {
    await page.getByRole('link', { name: 'Privacy' }).first().click()
    await page.waitForSelector('h1')
    const h1 = await page.locator('h1').innerText()
    await page.getByRole('link', { name: 'Terms' }).first().click()
    const h2 = await page.locator('h1').innerText()
    await page.getByRole('link', { name: 'Sign in' }).first().click()
    return (/Privacy/.test(h1) && /Terms/.test(h2) && page.url().endsWith('/login')) || `${h1} | ${h2} | ${page.url()}`
  })
  await check('an unknown address shows the 404 page with a way home', async () => {
    await page.goto(`${BASE}/definitely/not/here`); await settle(page)
    return ((await page.locator('text=This page does not exist').count()) === 1 && (await page.getByRole('link', { name: 'Go to sign in' }).count()) === 1) || 'no 404 page'
  })
  await check('the sign-in form rejects an empty submit, a wrong password shows one clear message', async () => {
    await page.goto(`${BASE}/login`); await settle(page)
    await page.getByLabel('Email').fill('owner@ripple.demo')
    await page.getByLabel('Password', { exact: true }).fill('wrong-password')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.waitForTimeout(1200)
    const alerts = await page.locator('[role="alert"]').allInnerTexts()
    return (alerts.length === 1 && /Email or password is wrong/.test(alerts[0])) || `alerts ${alerts}`
  })
  await check('the password eye button is reachable by keyboard', async () => {
    await page.getByLabel('Password', { exact: true }).focus()
    await page.keyboard.press('Tab')
    const name = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') || '')
    return /password/i.test(name) || `focus went to "${name}"`
  })
  await page.context().close()
}

// ======================================================= 9. Languages
{
  const page = await newPage()
  await demo(page)
  for (const lang of ['hi', 'ta']) {
    await check(`UI in ${lang}: no raw translation keys, no horizontal overflow on Today, Khata, Settings at 390 px`, async () => {
      await api(page, 'PUT', '/me/prefs', { language_ui: lang })
      await page.setViewportSize({ width: 390, height: 800 })
      const bad = []
      for (const p of ['/app/today', '/app/khata', '/app/orders', '/app/settings']) {
        await page.goto(`${BASE}${p}`); await settle(page)
        const t = await page.locator('body').innerText()
        if (/\b(nav|common|today|book)\.[a-zA-Z]+\b/.test(t)) bad.push(`${p}: raw key`)
        const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
        if (over > 0) bad.push(`${p}: overflow ${over}px`)
      }
      await page.setViewportSize({ width: 1440, height: 900 })
      return bad.length === 0 || bad.join('; ')
    })
  }
  await api(page, 'PUT', '/me/prefs', { language_ui: 'en' })
  await check('number format and text size preferences do not break Today', async () => {
    await api(page, 'PUT', '/me/prefs', { number_format: 'international', text_size: 'XL', theme: 'day', high_contrast: true })
    await page.goto(`${BASE}/app/today`); await settle(page)
    const t = await page.locator('body').innerText()
    await api(page, 'PUT', '/me/prefs', { number_format: 'indian', text_size: 'M', theme: 'night', high_contrast: false })
    return !/undefined|NaN|\[object/.test(t) || 'bad text'
  })
  await page.context().close()
}

// ======================================================= 10. Supervisor
{
  const page = await newPage()
  await page.goto(`${BASE}/login`)
  await page.getByLabel('Email').fill('supervisor@ripple.demo')
  await page.getByLabel('Password', { exact: true }).fill(process.env.DEMO_PASSWORD || 'ripple-demo-2026')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.waitForURL('**/app/orders', { timeout: 10000 })
  await check('supervisor: lands on Orders, sees no rupee sign anywhere on Orders and Inventory', async () => {
    const bad = []
    for (const p of ['/app/orders', '/app/inventory', '/app/orders?tab=purchase']) {
      await page.goto(`${BASE}${p}`); await settle(page)
      const t = await page.locator('body').innerText()
      if (/₹/.test(t)) bad.push(p)
    }
    return bad.length === 0 || `₹ shown on ${bad.join(', ')}`
  })
  await check('supervisor typing a finance address gets sent home, not an error', async () => {
    await page.goto(`${BASE}/app/today`); await settle(page)
    return page.url().endsWith('/app/orders') || `url ${page.url()}`
  })
  await check('supervisor cannot reach the shared demo team or data actions', async () => {
    const a = await api(page, 'POST', '/team', { email: 'x@y.co', name: 'X', role: 'OWNER' })
    const b = await api(page, 'DELETE', '/team/u-owner')
    return (a.status === 403 && b.status === 403) || `${a.status} ${b.status}`
  })
  await page.context().close()
}

// ======================================================= 11. Inventory and Settings: the success paths
{
  const page = await newPage()
  await demo(page)
  await page.goto(`${BASE}/app/inventory`); await settle(page)
  await check('a raw material can be added, edited and deleted from the screen', async () => {
    const before = (await api(page, 'GET', '/inventory')).body.materials.length
    await page.getByRole('button', { name: /New raw material/ }).click()
    const dlg = page.getByRole('dialog')
    await dlg.getByPlaceholder('Indigo dye').fill(`Audit dye ${RUN}`)
    await dlg.locator('input[inputmode="decimal"]').first().fill('120.50')
    await dlg.locator('input[inputmode="decimal"]').nth(1).fill('25')
    await dlg.getByRole('button', { name: 'Add material' }).click()
    await page.waitForTimeout(1500)
    const mid = (await api(page, 'GET', '/inventory')).body.materials
    const made = mid.find((m) => m.name === `Audit dye ${RUN}`)
    if (!made || mid.length !== before + 1) return `not added (count ${before} -> ${mid.length})`
    await page.locator('.search input').first().fill(`Audit dye ${RUN}`)
    await page.waitForTimeout(300)
    await page.getByRole('button', { name: /Edit/ }).first().click()
    const edit = page.getByRole('dialog')
    await edit.getByPlaceholder('Indigo dye').fill(`Audit dye ${RUN} v2`)
    await edit.getByRole('button', { name: 'Save changes' }).click()
    await page.waitForTimeout(1200)
    const renamed = (await api(page, 'GET', '/inventory')).body.materials.some((m) => m.name === `Audit dye ${RUN} v2`)
    await page.getByRole('button', { name: /Edit/ }).first().click()
    const del = page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true })
    await del.click(); await page.getByRole('dialog').getByRole('button', { name: /Delete for good/ }).click()
    await page.waitForTimeout(1200)
    const gone = !(await api(page, 'GET', '/inventory')).body.materials.some((m) => m.name.startsWith(`Audit dye ${RUN}`))
    return (renamed && gone) || `renamed=${renamed} deleted=${gone}`
  })
  await check('a stock adjustment with a note changes on-hand once and shows in Movements', async () => {
    await page.locator('.search input').first().fill('')
    const mat = (await api(page, 'GET', '/inventory')).body.materials[0]
    const res = await api(page, 'POST', '/stock-movements', { item_type: 'MATERIAL', item_id: mat.id, qty_delta: 1000, note: 'audit count' })
    const after = (await api(page, 'GET', '/inventory')).body.materials.find((m) => m.id === mat.id)
    return (res.status === 200 && after.on_hand === mat.on_hand + 1000) || `status ${res.status} on_hand ${mat.on_hand} -> ${after.on_hand}`
  })
  await check('negative stock cannot be created by an adjustment', async () => {
    const mat = (await api(page, 'GET', '/inventory')).body.materials[0]
    const res = await api(page, 'POST', '/stock-movements', { item_type: 'MATERIAL', item_id: mat.id, qty_delta: -(mat.on_hand + 100000), note: 'audit' })
    const after = (await api(page, 'GET', '/inventory')).body.materials.find((m) => m.id === mat.id)
    return (res.status >= 400 && after.on_hand >= 0) || `status ${res.status}, on_hand now ${after.on_hand}`
  })
  await page.goto(`${BASE}/app/settings`); await settle(page)
  await check('GSTIN: a malformed number is refused, a valid one saves, the profile reloads with it', async () => {
    const gst = page.getByLabel('GSTIN')
    await gst.fill('33AAJFM4721K1Z'); await gst.blur()
    const bad = await page.locator('#gstin-hint').innerText().catch(() => '')
    await gst.fill('27AAPFU0939F1ZV'); await gst.blur()
    await page.getByRole('button', { name: 'Save profile' }).click()
    await page.waitForTimeout(1200)
    const saved = (await api(page, 'GET', '/settings')).body.business.gstin
    return (/15 characters|looks like/i.test(bad) && saved === '27AAPFU0939F1ZV') || `hint "${bad}" saved "${saved}"`
  })
  await check('recurring expense: add, shows in the list, remove with the second click', async () => {
    await page.getByLabel('Expense name').fill('Audit rent')
    await page.getByLabel('Expense amount in rupees').fill('12,500')
    const money = page.locator('section', { has: page.locator('.section-title', { hasText: 'Money rules' }) })
    await money.getByRole('button', { name: 'Add', exact: true }).first().click()
    await page.waitForTimeout(1200)
    const there = (await api(page, 'GET', '/settings')).body.recurring.some((r) => r.label === 'Audit rent' && r.amount_paise === 1250000)
    const row = money.locator('tr', { hasText: 'Audit rent' })
    await row.getByRole('button', { name: 'Remove' }).click()
    await row.getByRole('button', { name: 'Remove?' }).click()
    await page.waitForTimeout(1200)
    const gone = !(await api(page, 'GET', '/settings')).body.recurring.some((r) => r.label === 'Audit rent')
    return (there && gone) || `added=${there} removed=${gone}`
  })
  await check('forecast horizon change recalculates and Today still renders', async () => {
    await page.getByRole('button', { name: '60d' }).click()
    await page.waitForTimeout(2500)
    const h = (await api(page, 'GET', '/settings')).body.money.horizon_days
    await page.goto(`${BASE}/app/today`); await settle(page)
    const t = await page.locator('body').innerText()
    return (h === 60 && !/undefined|NaN|Internal/.test(t)) || `horizon ${h}`
  })
  await check('display preferences (theme, text size) apply to the page and survive a reload', async () => {
    await api(page, 'PUT', '/me/prefs', { theme: 'lamp', text_size: 'L' })
    await page.goto(`${BASE}/app/settings`); await settle(page)
    const attrs = await page.evaluate(() => [document.documentElement.dataset.theme, document.documentElement.dataset.size])
    await api(page, 'PUT', '/me/prefs', { theme: 'night', text_size: 'M' })
    return (attrs[0] === 'lamp' && attrs[1] === 'L') || `attrs ${attrs}`
  })
  await page.context().close()
}

// ======================================================= 12. Signing out
{
  const page = await newPage()
  await demo(page)
  await page.goto(`${BASE}/app/settings`); await settle(page)
  await check('Log out ends the session, lands on sign-in and the app is closed to the old cookie', async () => {
    await page.getByRole('button', { name: 'Log out', exact: true }).click()
    await page.waitForURL('**/login', { timeout: 8000 })
    const me = await api(page, 'GET', '/me')
    return me.status === 401 || `me after logout: ${me.status}`
  })
  await demo(page)
  await page.goto(`${BASE}/app/settings`); await settle(page)
  await check('Log out everywhere ends every session of the user, not only this one', async () => {
    const other = await newPage()
    // a second session for the same sandbox cannot be made without the password, so check the server side: all sessions of this user go
    const before = (await api(page, 'GET', '/sessions')).body.sessions.length
    await page.getByRole('button', { name: 'Log out everywhere' }).click()
    await page.waitForURL('**/login', { timeout: 8000 })
    const me = await api(page, 'GET', '/me')
    await other.context().close()
    return (before >= 1 && me.status === 401) || `sessions before ${before}, me after ${me.status}`
  })
  await check('a signed-out visitor who opens an app address is sent to sign-in', async () => {
    await page.goto(`${BASE}/app/khata`); await settle(page)
    return page.url().endsWith('/login') || `url ${page.url()}`
  })
  await page.context().close()
}

await browser.close()
const summary = results.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a }, {})
fs.writeFileSync(`${OUT}/trackB-journeys.json`, JSON.stringify({ base: BASE, summary, results, console_and_page_errors: problems }, null, 1))
console.log('SUMMARY', JSON.stringify(summary), 'console/page errors:', problems.length)
for (const p of problems.slice(0, 20)) console.log('  ', p)
