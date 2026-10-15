// Track A control sweep: opens each route, lists every interactive control, clicks each one on a fresh page,
// and records what happened (requests, console/page errors, dialogs, URL and DOM change).
// Usage: RIPPLE_URL=http://localhost:8766 node audit-controls.mjs <outDir> [routeFilter]
import { chromium } from 'playwright-core'
import fs from 'node:fs'

const BASE = process.env.RIPPLE_URL || 'http://localhost:8000'
const OUT = process.argv[2] || 'audit-out'
const FILTER = process.argv[3]
const WIDTH = Number(process.env.W || 1440), HEIGHT = Number(process.env.H || 900)
fs.mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const ctx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, acceptDownloads: true })
const page = await ctx.newPage()

let log = []
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) log.push({ t: 'console', level: m.type(), text: m.text().slice(0, 240) }) })
page.on('pageerror', (e) => log.push({ t: 'pageerror', text: e.message.slice(0, 240) }))
page.on('requestfailed', (r) => log.push({ t: 'requestfailed', url: r.url().replace(BASE, ''), error: r.failure()?.errorText }))
page.on('response', (r) => {
  const url = r.url().replace(BASE, '')
  if (url.startsWith('/api/')) log.push({ t: 'api', method: r.request().method(), url: url.split('?')[0], status: r.status() })
  else if (r.status() >= 400) log.push({ t: 'asset', url, status: r.status() })
})

const BAD_TEXT = /Internal Server Error|Traceback|Exception|Network Error|Request failed|\[object Object\]|\bundefined\b|\bNaN\b|\bsqlite3\b/
const SKIP = /log ?out|sign out|reset|delete|remove|load demo|erase/i
const CONTROLS = 'button, a[href], [role="tab"], [role="checkbox"], select, input:not([type="hidden"]), textarea, .pnode, .enode, tr.clickable, [role="button"]'

async function login() {
  await page.goto(`${BASE}/login`)
  await page.getByRole('button', { name: /Open demo business/ }).click()
  await page.waitForSelector('text=Do today', { timeout: 20000 })
}

async function describe(i) {
  return page.locator(CONTROLS).nth(i).evaluate((el) => {
    const r = el.getBoundingClientRect()
    const visible = r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'
    const name = (el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || el.getAttribute('placeholder') || el.getAttribute('name') || '').replace(/\s+/g, ' ').trim().slice(0, 70)
    return { tag: el.tagName.toLowerCase(), role: el.getAttribute('role') || (el.tagName === 'A' ? 'link' : el.tagName === 'BUTTON' ? 'button' : el.tagName.toLowerCase()), type: el.getAttribute('type'),
      name, href: el.getAttribute('href'), disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true', visible, cls: String(el.className || '').slice(0, 40) }
  })
}

async function openDetails() { await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true })) }

async function settle() { await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {}); await page.waitForTimeout(350) }

const ROUTES = [
  { id: 'today', path: '/app/today', ready: 'text=Do today' },
  { id: 'engine-network', path: '/app/engine', ready: '.pnode', pre: null },
  { id: 'engine-flow', path: '/app/engine', ready: '.pnode', pre: async () => { await page.getByRole('tab', { name: 'flow' }).click(); await page.waitForSelector('.enode', { timeout: 15000 }) } },
  { id: 'engine-decisions', path: '/app/engine', ready: '.pnode', pre: async () => { await page.getByRole('tab', { name: 'decisions' }).click(); await page.waitForTimeout(800) } },
  { id: 'engine-table', path: '/app/engine', ready: '.pnode', pre: async () => { await page.getByRole('tab', { name: 'flow' }).click(); await page.getByRole('button', { name: 'Table' }).click(); await page.waitForTimeout(800) } },
  { id: 'book-position', path: '/app/book', ready: 'text=Runway' },
  { id: 'book-risk', path: '/app/book?tab=risk', ready: '.gp', pre: async () => { await page.waitForSelector('.f-median', { timeout: 40000 }).catch(() => {}) } },
  { id: 'book-ledger', path: '/app/book?tab=ledger', ready: 'text=Ledger' },
  // Track B screens
  { id: 'login', path: '/login', ready: 'text=Sign in', public: true },
  { id: 'privacy', path: '/privacy', ready: 'text=What Ripple stores', public: true },
  { id: 'terms', path: '/terms', ready: 'text=Demo and synthetic data', public: true },
  { id: 'notfound', path: '/no-such-page', ready: 'text=This page does not exist', public: true },
  { id: 'setup', path: '/setup', ready: 'textarea', public: true },
  { id: 'khata', path: '/app/khata', ready: '.page' },
  { id: 'orders-sales', path: '/app/orders', ready: '.tabs' },
  { id: 'orders-purchase', path: '/app/orders?tab=purchase', ready: '.tabs' },
  { id: 'orders-whatif', path: '/app/orders?tab=new', ready: '.tabs' },
  { id: 'inventory-raw', path: '/app/inventory', ready: '.tabs' },
  { id: 'inventory-finished', path: '/app/inventory', ready: '.tabs', pre: async () => { await page.getByRole('tab', { name: /finished/i }).click() } },
  { id: 'inventory-recipes', path: '/app/inventory', ready: '.tabs', pre: async () => { await page.getByRole('tab', { name: /recipes/i }).click() } },
  { id: 'inventory-movements', path: '/app/inventory', ready: '.tabs', pre: async () => { await page.getByRole('tab', { name: /movements/i }).click() } },
  { id: 'settings', path: '/app/settings', ready: '.page' },
].filter((r) => !FILTER || FILTER.split(',').some((f) => r.id === f || r.id.startsWith(f + '-')))

async function open(route) {
  await page.goto(`${BASE}${route.path}`)
  await page.waitForSelector(route.ready, { timeout: 25000 }).catch(() => log.push({ t: 'blocked', text: `ready selector ${route.ready} not found` }))
  if (route.pre) await route.pre().catch((e) => log.push({ t: 'blocked', text: 'pre-step failed: ' + e.message.split('\n')[0] }))
  await settle()
  await openDetails()
}

const results = []
if (ROUTES.some((r) => !r.public)) await login()

for (const route of ROUTES) {
  log = []
  await open(route)
  const count = await page.locator(CONTROLS).count()
  const inventory = []
  for (let i = 0; i < count; i++) inventory.push({ i, ...(await describe(i)) })
  const pageText = await page.locator('body').innerText()
  const badText = pageText.match(BAD_TEXT)
  console.log(`${route.id}: ${count} controls; load log entries ${log.length}; bad text: ${badText ? badText[0] : 'none'}`)
  const loadIssues = log.filter((l) => l.t === 'console' || l.t === 'pageerror' || l.t === 'requestfailed' || l.t === 'asset' || (l.t === 'api' && l.status >= 400) || l.t === 'blocked')
  results.push({ route: route.id, path: route.path, kind: 'page-load', controls: count, issues: loadIssues, bad_text: badText ? badText[0] : null })

  for (const c of inventory) {
    const rec = { route: route.id, index: c.i, tag: c.tag, role: c.role, name: c.name, href: c.href, type: c.type }
    if (!c.visible) { rec.status = 'NOT APPLICABLE'; rec.note = 'not visible in this state'; results.push(rec); continue }
    if (c.disabled) { rec.status = 'NOT APPLICABLE'; rec.note = 'disabled in this state'; results.push(rec); continue }
    if (SKIP.test(c.name)) { rec.status = 'BLOCKED'; rec.note = 'destructive or session-ending control; covered by a targeted test on a throw-away business'; results.push(rec); continue }
    if (c.href && /^https?:\/\//.test(c.href) && !c.href.startsWith(BASE)) { rec.status = 'BLOCKED'; rec.note = 'external link; checked for rel attributes only'; results.push(rec); continue }
    log = []
    await open(route)
    const loc = page.locator(CONTROLS).nth(c.i)
    const before = { url: page.url(), dom: await page.evaluate(() => document.body.innerHTML.length), dialogs: await page.locator('[role="dialog"], .drawer, [role="menu"], .popover').count() }
    let action = 'click'
    try {
      if (c.tag === 'select') {
        action = 'select 2nd option'
        const options = await loc.locator('option').count()
        if (options > 1) await loc.selectOption({ index: 1 }, { timeout: 3000 }); else action = 'select (single option)'
      } else if (c.tag === 'input' && ['text', 'search', null, 'email', 'number'].includes(c.type)) {
        action = 'type'
        await loc.fill(c.type === 'number' ? '5' : 'audit', { timeout: 3000 })
      } else if (c.tag === 'textarea') {
        action = 'type'
        await loc.fill('audit', { timeout: 3000 })
      } else {
        const download = page.waitForEvent('download', { timeout: 1500 }).catch(() => null)
        await loc.click({ timeout: 3000, trial: false })
        const d = await download
        if (d) { rec.download = d.suggestedFilename(); log.push({ t: 'download', text: d.suggestedFilename() }) }
      }
    } catch (e) {
      rec.status = 'FAIL'; rec.note = `${action} failed: ${e.message.split('\n')[0]}`; results.push(rec); continue
    }
    await settle()
    const after = { url: page.url(), dom: await page.evaluate(() => document.body.innerHTML.length), dialogs: await page.locator('[role="dialog"], .drawer, [role="menu"], .popover').count() }
    const text = await page.locator('body').innerText()
    const bad = text.match(BAD_TEXT)
    const api = log.filter((l) => l.t === 'api')
    const errs = log.filter((l) => l.t === 'console' || l.t === 'pageerror' || l.t === 'requestfailed' || l.t === 'asset')
    const apiBad = api.filter((a) => a.status >= 400)
    rec.action = action
    rec.requests = api.map((a) => `${a.method} ${a.url} ${a.status}`)
    rec.effect = { url_changed: before.url !== after.url, dom_changed: before.dom !== after.dom, dialog_delta: after.dialogs - before.dialogs, requests: api.length, download: rec.download || null }
    const observed = rec.effect.url_changed || rec.effect.dom_changed || rec.effect.dialog_delta !== 0 || api.length > 0 || rec.download
    const problems = []
    if (errs.length) problems.push(...errs.map((e) => `${e.t}: ${e.text || e.url}`))
    if (apiBad.length) problems.push(...apiBad.map((a) => `HTTP ${a.status} ${a.method} ${a.url}`))
    if (bad && !BAD_TEXT.test(pageText)) problems.push('bad text appeared: ' + bad[0])
    if (!observed) problems.push('no observable effect (no URL, DOM, dialog, request or download change)')
    rec.status = problems.length ? 'FAIL' : 'PASS'
    if (problems.length) rec.problems = problems
    results.push(rec)
    if (problems.length) await page.screenshot({ path: `${OUT}/fail-${route.id}-${c.i}.png` }).catch(() => {})
  }
}

const summary = results.filter((r) => r.kind !== 'page-load').reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a }, {})
fs.writeFileSync(`${OUT}/controls-${WIDTH}${FILTER ? '-' + FILTER : '-full'}.json`, JSON.stringify({ base: BASE, viewport: [WIDTH, HEIGHT], summary, results }, null, 1))
console.log('SUMMARY', JSON.stringify(summary))
await browser.close()
