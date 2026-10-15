// Track B keyboard and reflow audit.
// Usage: RIPPLE_URL=http://localhost:8769 node audit-keyboard.mjs <outDir>
//  1. Tab through each route: every stop must be visible, have a name, and show a focus indicator
//  2. Reflow: no horizontal scroll at 320 px (WCAG 1.4.10) and at 720 x 450 (what 200% zoom leaves on a 1440 px screen)
import { chromium } from 'playwright-core'
import fs from 'node:fs'

const BASE = process.env.RIPPLE_URL || 'http://localhost:8000'
const OUT = process.argv[2] || 'audit-out'
fs.mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
const settle = async () => { await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(500) }

const PUBLIC = ['/login', '/privacy', '/terms', '/no-such-page']
const APP = ['/app/today', '/app/engine', '/app/book', '/app/book?tab=ledger', '/app/khata', '/app/orders', '/app/orders?tab=purchase', '/app/orders?tab=new', '/app/inventory', '/app/settings']
const out = { focus: [], reflow: [] }

async function tabThrough(path) {
  await page.goto(`${BASE}${path}`); await settle()
  await page.evaluate(() => { document.activeElement?.blur?.(); window.scrollTo(0, 0) })
  const stops = []
  for (let i = 0; i < 45; i++) {
    await page.keyboard.press('Tab')
    const info = await page.evaluate(() => {
      const el = document.activeElement
      if (!el || el === document.body) return null
      const cs = getComputedStyle(el), r = el.getBoundingClientRect()
      const name = (el.getAttribute('aria-label') || el.labels?.[0]?.innerText || el.innerText || el.getAttribute('title') || el.getAttribute('placeholder') || el.getAttribute('name') || el.id || '').replace(/\s+/g, ' ').trim().slice(0, 40)
      const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0
      const shadow = cs.boxShadow && cs.boxShadow !== 'none'
      return { tag: el.tagName.toLowerCase(), name, visible: r.width > 0 && r.height > 0, indicator: outline || !!shadow, inDialog: !!el.closest('[role="dialog"]') }
    })
    if (!info) break
    stops.push(info)
  }
  const problems = stops.filter((s) => !s.visible || !s.name || !s.indicator)
  out.focus.push({ path, stops: stops.length, problems: problems.map((p) => `${p.tag}:"${p.name}" visible=${p.visible} indicator=${p.indicator}`) })
}

async function reflow(path, w, h) {
  await page.setViewportSize({ width: w, height: h })
  await page.goto(`${BASE}${path}`); await settle()
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  out.reflow.push({ path, width: w, overflow_px: over })
}

for (const p of PUBLIC) { await tabThrough(p) }
await page.goto(`${BASE}/login`)
await page.getByRole('button', { name: /Open demo business/ }).click()
await page.waitForSelector('text=Do today', { timeout: 20000 })
for (const p of APP) { await tabThrough(p) }
for (const p of [...PUBLIC, ...APP]) { await reflow(p, 320, 640); await reflow(p, 720, 450) }

const summary = {
  routes_tabbed: out.focus.length,
  tab_stops: out.focus.reduce((n, f) => n + f.stops, 0),
  routes_with_focus_problems: out.focus.filter((f) => f.problems.length).map((f) => ({ path: f.path, problems: f.problems.slice(0, 6) })),
  reflow_overflows: out.reflow.filter((r) => r.overflow_px > 0),
}
fs.writeFileSync(`${OUT}/keyboard-reflow.json`, JSON.stringify({ summary, ...out }, null, 1))
console.log(JSON.stringify(summary, null, 1))
await browser.close()
