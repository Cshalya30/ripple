// Page speed on a throttled phone profile (4x CPU slowdown, 1.6 Mbps down, 150 ms latency): FCP, LCP, CLS, transferred bytes.
// Usage: RIPPLE_URL=http://localhost:8769 node audit-speed.mjs <outDir>.  Lighthouse itself was not available, so these are the same metrics read from the browser.
import { chromium } from 'playwright-core'
import fs from 'node:fs'
const BASE = process.env.RIPPLE_URL || 'http://localhost:8000'
const OUT = process.argv[2] || 'audit-out'
fs.mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
const cdp = await ctx.newCDPSession(page)
await page.addInitScript(() => {
  window.__m = { lcp: 0, cls: 0 }
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__m.lcp = e.startTime }).observe({ type: 'largest-contentful-paint', buffered: true })
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__m.cls += e.value }).observe({ type: 'layout-shift', buffered: true })
})
const measure = async (path, label) => {
  await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 })
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  await cdp.send('Network.clearBrowserCache')
  let bytes = 0
  page.removeAllListeners('requestfinished')
  page.on('requestfinished', async (rq) => { try { const z = await rq.sizes(); bytes += z.responseBodySize + z.responseHeadersSize } catch {} })
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  const m = await page.evaluate(() => ({ ...window.__m, fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime || 0 }))
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  return { page: label, path, fcp_ms: Math.round(m.fcp), lcp_ms: Math.round(m.lcp), cls: Number(m.cls.toFixed(4)), transferred_kb_on_the_wire: Math.round(bytes / 1024) }
}
const rows = [await measure('/login', 'Login (not signed in)')]
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }); await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
await page.goto(`${BASE}/login`); await page.getByRole('button', { name: /Open demo business/ }).click(); await page.waitForSelector('text=Do today', { timeout: 20000 })
rows.push(await measure('/app/today', 'Today (signed in, cold cache)'))
rows.push(await measure('/app/khata', 'Khata (signed in, cold cache)'))
rows.push(await measure('/app/settings', 'Settings (signed in, cold cache)'))
rows.push(await measure('/app/orders', 'Orders (signed in, cold cache)'))
fs.writeFileSync(`${OUT}/page-speed.json`, JSON.stringify({ profile: '390x844 phone, 4x CPU slowdown, 1.6 Mbps, 150 ms latency, cold cache, localhost server', targets: { lcp_ms: 2500, cls: 0.1 }, rows }, null, 1))
console.log(JSON.stringify(rows, null, 1))
await browser.close()
