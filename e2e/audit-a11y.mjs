// Track B accessibility, layout and page-basics audit.
// Usage: RIPPLE_URL=http://localhost:8766 node audit-a11y.mjs <outDir>
//  1. axe-core (WCAG 2.0/2.1 A and AA, incl. colour contrast) on every route in the three themes and in high-contrast
//  2. horizontal overflow and small tap targets at 360, 390 and 768 px
//  3. page titles, meta tags, favicon links resolving, robots and sitemap
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const axeSource = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8')
const BASE = process.env.RIPPLE_URL || 'http://localhost:8000'
const OUT = process.argv[2] || 'audit-out'
fs.mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, bypassCSP: true }) // CSP blocks the injected axe script; the page itself is unchanged
const page = await ctx.newPage()

const PUBLIC = [['login', '/login'], ['privacy', '/privacy'], ['terms', '/terms'], ['notfound', '/nope'], ['setup', '/setup']]
const APP = [['today', '/app/today'], ['engine', '/app/engine'], ['book', '/app/book'], ['book-risk', '/app/book?tab=risk'], ['book-ledger', '/app/book?tab=ledger'],
  ['khata', '/app/khata'], ['orders', '/app/orders'], ['orders-purchase', '/app/orders?tab=purchase'], ['orders-whatif', '/app/orders?tab=new'],
  ['inventory', '/app/inventory'], ['settings', '/app/settings']]
const THEMES = [['night', 'normal'], ['day', 'normal'], ['lamp', 'normal'], ['night', 'high'], ['day', 'high']]
const WIDTHS = [360, 390, 768]
const TITLES = { '/login': 'Sign in · Ripple', '/privacy': 'Privacy · Ripple', '/terms': 'Terms of use · Ripple', '/nope': 'Page not found · Ripple', '/setup': 'Set up your business · Ripple',
  '/app/today': 'Today · Ripple', '/app/engine': 'Engine · Ripple', '/app/book': 'Book · Ripple', '/app/khata': 'Khata · Ripple', '/app/orders': 'Orders · Ripple', '/app/inventory': 'Inventory · Ripple', '/app/settings': 'Settings · Ripple' }

const settle = async () => { await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(600) }
const result = { base: BASE, axe: [], layout: [], basics: [] }

async function login() {
  await page.goto(`${BASE}/login`)
  await page.getByRole('button', { name: /Open demo business/ }).click()
  await page.waitForSelector('text=Do today', { timeout: 20000 })
}

async function scan(name, path, theme, contrast) {
  await page.goto(`${BASE}${path}`)
  await settle()
  await page.evaluate(([t, c]) => { document.documentElement.setAttribute('data-theme', t); document.documentElement.setAttribute('data-contrast', c) }, [theme, contrast])
  await page.waitForTimeout(250)
  await page.evaluate((src) => { if (!window.axe) { const s = document.createElement('script'); s.textContent = src; document.head.appendChild(s) } }, axeSource)
  const r = await page.evaluate(async () => {
    const out = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] })
    return out.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, count: v.nodes.length,
      samples: v.nodes.slice(0, 4).map((n) => ({ target: n.target.join(' '), summary: (n.failureSummary || '').split('\n').slice(1, 3).join(' ').slice(0, 220), html: n.html.slice(0, 120) })) }))
  })
  result.axe.push({ route: name, path, theme, contrast, violations: r })
  return r
}

async function layout(name, path, width) {
  await page.setViewportSize({ width, height: 800 })
  await page.goto(`${BASE}${path}`)
  await settle()
  const r = await page.evaluate(() => {
    const doc = document.documentElement
    const overflow = doc.scrollWidth - doc.clientWidth
    const wide = [...document.querySelectorAll('body *')].filter((el) => {
      const b = el.getBoundingClientRect()
      return b.width > 0 && b.right > doc.clientWidth + 1 && !el.closest('.table-wrap, [style*="overflow"], .scroll-x, svg, .tabs')
    }).slice(0, 5).map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 30)}`)
    const small = [...document.querySelectorAll('button, a[href], [role="tab"], input:not([type="hidden"]), select')].filter((el) => {
      const b = el.getBoundingClientRect(); const cs = getComputedStyle(el)
      return b.width > 0 && b.height > 0 && cs.visibility !== 'hidden' && (b.height < 44 || b.width < 44) && !(el.tagName === 'A' && el.closest('p, li, td, .small, .micro'))
    })
    return { overflow, wide, small_targets: small.length, small_sample: small.slice(0, 5).map((el) => `${el.tagName.toLowerCase()}:${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 24)}:${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`) }
  })
  result.layout.push({ route: name, path, width, ...r })
}

// ---- public pages (not signed in)
for (const [name, path] of PUBLIC) {
  for (const [theme, contrast] of THEMES) await scan(name, path, theme, contrast)
  for (const w of WIDTHS) await layout(name, path, w)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`${BASE}${path}`); await settle()
  result.basics.push({ check: 'title', path, expected: TITLES[path], actual: await page.title(), pass: (await page.title()) === TITLES[path] })
}
// ---- signed in
await login()
for (const [name, path] of APP) {
  await page.setViewportSize({ width: 1440, height: 900 })
  for (const [theme, contrast] of THEMES) await scan(name, path, theme, contrast)
  for (const w of WIDTHS) await layout(name, path, w)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`${BASE}${path}`); await settle()
  const base = path.split('?')[0]
  result.basics.push({ check: 'title', path, expected: TITLES[base], actual: await page.title(), pass: (await page.title()) === TITLES[base] })
}
// ---- an unknown page inside the app
await page.goto(`${BASE}/app/zzz`); await settle()
result.basics.push({ check: 'in-app 404 shows the page and keeps the sidebar', pass: (await page.locator('text=This page does not exist').count()) === 1 && (await page.locator('nav, aside').count()) > 0 })

// ---- head tags, icons, robots, sitemap
await page.goto(`${BASE}/app/today`); await settle()
const head = await page.evaluate(() => ({
  description: document.querySelector('meta[name="description"]')?.content, ogTitle: document.querySelector('meta[property="og:title"]')?.content,
  ogImage: document.querySelector('meta[property="og:image"]')?.content, twitter: document.querySelector('meta[name="twitter:card"]')?.content,
  icons: [...document.querySelectorAll('link[rel*="icon"]')].map((l) => l.getAttribute('href')), lang: document.documentElement.lang,
  imgs: [...document.querySelectorAll('img')].map((i) => ({ src: i.src, alt: i.getAttribute('alt') })),
}))
result.basics.push({ check: 'head tags', ...head, pass: !!(head.description && head.ogTitle && head.ogImage && head.twitter && head.icons.every((h) => h.startsWith('/'))) })
for (const href of [...head.icons, '/og-image.png', '/robots.txt', '/sitemap.xml']) {
  const r = await page.request.get(`${BASE}${href}`)
  const type = r.headers()['content-type']
  result.basics.push({ check: `GET ${href}`, status: r.status(), type, bytes: (await r.body()).length, pass: r.status() === 200 && !/html/.test(type || '') })
}
const robots = await (await page.request.get(`${BASE}/robots.txt`)).text()
const sitemap = await (await page.request.get(`${BASE}/sitemap.xml`)).text()
result.basics.push({ check: 'robots disallows /app/ and /api/', pass: /Disallow: \/app\//.test(robots) && /Disallow: \/api\//.test(robots) })
result.basics.push({ check: 'sitemap lists only public pages', pass: /\/login/.test(sitemap) && /\/privacy/.test(sitemap) && /\/terms/.test(sitemap) && !/\/app\//.test(sitemap) })
for (const [path, want] of [['/nope', 404], ['/app/zzz', 404], ['/.env', 404], ['/assets/missing.js', 404], ['/login', 200], ['/app/today', 200], ['/api/nope', 404]]) {
  const r = await page.request.get(`${BASE}${path}`)
  result.basics.push({ check: `status of ${path}`, status: r.status(), pass: r.status() === want })
}

const axeBad = result.axe.flatMap((a) => a.violations.map((v) => ({ route: a.route, theme: `${a.theme}/${a.contrast}`, ...v })))
const summary = {
  axe_scans: result.axe.length,
  axe_violation_groups: axeBad.length,
  axe_by_rule: axeBad.reduce((m, v) => { m[v.id] = (m[v.id] || 0) + 1; return m }, {}),
  layout_checks: result.layout.length,
  horizontal_overflow: result.layout.filter((l) => l.overflow > 0).map((l) => `${l.route}@${l.width}: +${l.overflow}px`),
  basics_failed: result.basics.filter((b) => !b.pass).map((b) => b.check + (b.path ? ` ${b.path}` : '')),
}
fs.writeFileSync(`${OUT}/a11y-layout-basics.json`, JSON.stringify({ summary, ...result }, null, 1))
console.log(JSON.stringify(summary, null, 1))
await browser.close()
