import { chromium } from 'playwright-core'

const BASE = process.env.RIPPLE_URL || 'http://localhost:8000'
const OUT = process.argv[2] || '.'
const only = process.argv[3]
const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true })
const errors = []

async function page(viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport })
  const p = await ctx.newPage()
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text().slice(0, 300)}`) })
  p.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))
  p.on('response', (r) => { if (r.status() >= 400 && r.url().includes('/api/')) errors.push(`[http ${r.status()}] ${r.request().method()} ${r.url()}`) })
  return p
}

const shot = (p, name) => p.screenshot({ path: `${OUT}/${name}.png`, fullPage: false })
const step = async (name, fn) => { try { await fn() } catch (e) { errors.push(`[step ${name}] ${e.message.split('\n')[0]}`) } }

const p = await page()
await p.goto(`${BASE}/login`)
await shot(p, '01-login')
await p.getByRole('button', { name: /Open demo business/ }).click()
await p.waitForURL('**/app/today')
await p.waitForSelector('text=Do today', { timeout: 15000 })
await p.waitForTimeout(800)
await shot(p, '02-today')

if (!only || only === 'engine') {
  await step('engine', async () => {
    await p.getByRole('link', { name: 'Engine' }).click({ timeout: 10000 }).catch(() => p.goto(`${BASE}/app/engine`))
    await p.waitForSelector('.pnode', { timeout: 15000 })
    await p.waitForTimeout(800)
    await shot(p, '03-engine-network')
    await p.getByRole('tab', { name: 'flow' }).click()
    await p.waitForSelector('.enode', { timeout: 15000 })
    await p.waitForTimeout(800)
    await shot(p, '04-engine-flow')
    await p.locator('.palette-item', { hasText: 'Supplier payments' }).click()
    await p.locator('.palette-item', { hasText: 'Pay Sharma Yarn Mills' }).first().click()
    await p.waitForTimeout(800)
    await shot(p, '05-engine-flow-selected')
    await p.getByRole('tab', { name: 'decisions' }).click()
    await p.waitForTimeout(1000)
    await shot(p, '06-engine-decisions')
  })
}
await step('book', async () => {
  await p.getByRole('link', { name: 'Book' }).click()
  await p.waitForSelector('text=Ways to fix it', { timeout: 15000 })
  await p.waitForTimeout(6000)
  await shot(p, '07-book')
  await p.locator('#fixes').scrollIntoViewIfNeeded()
  await p.waitForTimeout(500)
  await shot(p, '08-book-fixes')
})
await step('scenario', async () => {
  await p.locator('tr', { hasText: 'Pay Sharma Yarn Mills in two parts' }).getByRole('button', { name: 'Try in engine' }).click()
  await p.waitForURL('**/app/engine')
  await p.waitForSelector('.enode', { timeout: 15000 })
  await p.waitForTimeout(2000)
  await shot(p, '09-scenario-diff')
})
await step('khata', async () => {
  await p.getByRole('link', { name: 'Khata' }).click()
  await p.waitForSelector('text=Kaveri Boutique', { timeout: 15000 })
  await shot(p, '10-khata')
  await p.locator('tr', { hasText: 'Kaveri Boutique' }).first().click()
  await p.waitForSelector('.drawer', { timeout: 10000 })
  await p.waitForTimeout(600)
  await shot(p, '11-party-drawer')
  await p.locator('.drawer').getByRole('button', { name: 'Remind' }).first().click()
  await p.waitForSelector('text=Open in WhatsApp', { timeout: 10000 })
  await p.getByRole('button', { name: 'தமிழ்' }).click()
  await p.waitForTimeout(800)
  await shot(p, '12-composer-tamil')
  await p.keyboard.press('Escape')
  await p.keyboard.press('Escape')
})
await step('munim', async () => {
  if (!(await p.getByRole('textbox', { name: 'Message to Munim' }).count())) await p.keyboard.press('m')
  await p.getByRole('textbox', { name: 'Message to Munim' }).fill('Why is there a dip?')
  await p.keyboard.press('Enter')
  await p.waitForSelector('text=From engine run', { timeout: 20000 })
  await shot(p, '13-munim')
})
await step('orders', async () => {
  await p.getByRole('link', { name: 'Orders' }).click()
  await p.waitForSelector('text=SO-0109', { timeout: 15000 })
  await shot(p, '14-orders')
  await p.getByRole('tab', { name: 'Can I take this order?' }).click()
  await p.waitForTimeout(500)
  await shot(p, '15-whatif')
})
await step('inventory', async () => {
  await p.getByRole('link', { name: 'Inventory' }).click()
  await p.waitForSelector('text=RM-YRN-C40', { timeout: 15000 })
  await shot(p, '16-inventory')
})
await step('settings', async () => {
  await p.getByRole('link', { name: 'Settings' }).first().click()
  await p.waitForSelector('text=Money rules', { timeout: 15000 })
  await shot(p, '17-settings')
})
await step('payment', async () => {
  await p.getByRole('link', { name: 'Today' }).click()
  await p.waitForSelector('text=Do today')
  await p.locator('li', { hasText: 'Kaveri' }).getByRole('button').first().click()
  await p.keyboard.press('Escape')
  await p.keyboard.press('/')
  await p.waitForTimeout(300)
  await p.keyboard.type('pay kaveri')
  await p.waitForTimeout(500)
  await shot(p, '18-command')
  await p.keyboard.press('Enter')
  await p.waitForSelector('text=Save and recalculate', { timeout: 10000 })
  await p.waitForTimeout(1200)
  await shot(p, '19-payment')
  await p.getByRole('button', { name: 'Save and recalculate' }).click()
  await p.waitForTimeout(2500)
  await shot(p, '20-after-payment')
})

const m = await page({ width: 390, height: 844 })
await step('mobile', async () => {
  await m.goto(`${BASE}/login`)
  await m.getByRole('button', { name: /Open demo business/ }).click()
  await m.waitForSelector('text=Do today', { timeout: 15000 })
  await m.evaluate(() => fetch('/api/me/prefs', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Ripple': '1' }, body: JSON.stringify({ language_ui: 'ta' }) }))
  await m.reload()
  await m.waitForTimeout(2000)
  await shot(m, '21-mobile-today-tamil')
  await m.screenshot({ path: `${OUT}/22-mobile-today-tamil-full.png`, fullPage: true })
  const overflow = await m.evaluate(() => document.querySelector('.main').scrollWidth - document.querySelector('.main').clientWidth)
  errors.push(`[info] mobile horizontal overflow px: ${overflow}`)
})

console.log(errors.join('\n') || 'no errors')
await browser.close()
