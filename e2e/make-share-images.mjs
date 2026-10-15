// Renders the social preview (1200x630) and the PNG icons from inline SVG using the installed Chrome.
// Usage (from e2e/, where playwright-core is installed): node make-share-images.mjs ../frontend/public
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'

const out = path.resolve(process.argv[2] || '../frontend/public')
const mark = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#0D0C0A"/><circle cx="11" cy="16" r="3.2" fill="#E4A43A"/><path d="M17 9.5a9 9 0 0 1 0 13" fill="none" stroke="#E4A43A" stroke-width="2.2" stroke-linecap="round"/><path d="M22 6a13.5 13.5 0 0 1 0 20" fill="none" stroke="#E4A43A" stroke-width="2.2" stroke-linecap="round" opacity=".6"/></svg>`

const og = `<html><body style="margin:0;width:1200px;height:630px;background:#0D0C0A;color:#F3EEE3;font-family:Segoe UI,Arial,sans-serif;position:relative;overflow:hidden">
<div style="position:absolute;left:72px;top:64px;display:flex;align-items:center;gap:16px">${mark(56)}<span style="font-size:44px;font-weight:700;letter-spacing:-1px">ripple</span></div>
<div style="position:absolute;left:72px;top:190px;width:560px;font-size:58px;line-height:1.1;font-weight:700;letter-spacing:-1.5px">See where the cash goes short, before it does.</div>
<div style="position:absolute;left:72px;top:440px;width:520px;font-size:26px;line-height:1.4;color:#B9B2A3">One late payment, followed through orders, stock and suppliers.</div>
<svg style="position:absolute;left:660px;top:120px" width="470" height="400" viewBox="0 0 470 400">
 <rect x="0" y="0" width="470" height="400" rx="16" fill="#171512" stroke="#2C2924"/>
 <line x1="30" y1="270" x2="440" y2="270" stroke="#4A453C" stroke-dasharray="6 6"/>
 <text x="34" y="262" fill="#8F887A" font-size="15">safety buffer</text>
 <path d="M30 120 L110 130 L170 150 L230 330 L300 190 L370 150 L440 110" fill="none" stroke="#E4A43A" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>
 <circle cx="230" cy="330" r="9" fill="#D9604C"/>
 <text x="250" y="352" fill="#F3EEE3" font-size="19" font-weight="600">Short on day 14</text>
 <text x="30" y="52" fill="#B9B2A3" font-size="18">Cash over the next 90 days</text>
 <path d="M60 372 q10 -14 20 0 M96 372 q14 -20 28 0" fill="none" stroke="#E4A43A" stroke-width="3" opacity=".6"/>
</svg></body></html>`

const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const shot = async (html, w, h, file) => {
  const page = await browser.newPage({ viewport: { width: w, height: h } })
  await page.setContent(html)
  await page.screenshot({ path: path.join(out, file), clip: { x: 0, y: 0, width: w, height: h } })
  await page.close()
}
await shot(og, 1200, 630, 'og-image.png')
await shot(`<html><body style="margin:0">${mark(180)}</body></html>`, 180, 180, 'apple-touch-icon.png')
await shot(`<html><body style="margin:0">${mark(32)}</body></html>`, 32, 32, 'favicon-32.png')
await browser.close()
for (const f of ['og-image.png', 'apple-touch-icon.png', 'favicon-32.png']) console.log(f, fs.statSync(path.join(out, f)).size, 'bytes')
