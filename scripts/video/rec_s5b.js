// Scene 5: verify page (signature, agent 302, track record on Avalanche), then an official record's proof card.
const { chromium } = require('playwright');
const [,, outDir, msgId] = process.argv;
const APP = 'https://screenshot-to-spark-3870.lovable.app';
(async () => {
  const browser = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY } });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, timezoneId: 'Europe/Rome', locale: 'en-GB', recordVideo: { dir: outDir, size: { width: 1280, height: 720 } } });
  const page = await ctx.newPage();
  const glide = async (re, offset = 140) => {
    const el = page.getByText(re).first();
    const y = await el.evaluate((n, o) => n.getBoundingClientRect().top + window.scrollY - o, offset);
    const from = await page.evaluate(() => window.scrollY);
    for (let k = 1; k <= 45; k++) { await page.evaluate((v) => window.scrollTo(0, v), from + (y - from) * (k / 45)); await page.waitForTimeout(18); }
  };
  try {
    await page.goto(APP + '/verify/' + msgId, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(4000);
    await page.evaluate(() => { const d = document.createElement('div'); d.id = 'sync'; d.style.cssText = 'position:fixed;inset:0;background:#000;z-index:99999'; document.body.appendChild(d); });
    await page.waitForTimeout(400);
    await page.evaluate(() => document.getElementById('sync').remove());
    const t0 = Date.now();
    const at = async (s) => { const d = t0 + s * 1000 - Date.now(); if (d > 0) await page.waitForTimeout(d); };
    await at(3.0); await glide(/Signing agent/i, 120);
    await at(8.6); await glide(/Track record on Avalanche/i, 110);
    await at(12.5); await page.getByText(/Recent records/i).first().click().catch(() => {});
    await at(16.8);
    await page.evaluate(() => { history.pushState({}, '', '/item/2025-255'); dispatchEvent(new PopStateEvent('popstate')); window.scrollTo(0, 0); });
    await page.getByText(/In the city's official list/i).first().waitFor({ timeout: 15000 });
    console.log('PROOF', ((Date.now() - t0) / 1000).toFixed(1));
    await glide(/Objects in this record/i, 90);
    await page.waitForTimeout(500);
    await glide(/In the city's official list/i, 260);
    await at(24);
  } catch (e) { console.error('ERR', e.message); }
  await ctx.close(); await browser.close();
})();
