// Scenes 2 and 6: home (stats, slow scroll) and the alert page. One sync marker per recording.
const { chromium } = require('playwright');
const [,, outDir, path, dur, scrollAt, scrollBy] = process.argv;
const APP = 'https://screenshot-to-spark-3870.lovable.app';
(async () => {
  const browser = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY } });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, timezoneId: 'Europe/Rome', locale: 'en-GB', recordVideo: { dir: outDir, size: { width: 1280, height: 720 } } });
  const page = await ctx.newPage();
  try {
    await page.goto(APP + path, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(2000);
    await page.evaluate(() => { const d = document.createElement('div'); d.id = 'sync'; d.style.cssText = 'position:fixed;inset:0;background:#000;z-index:99999'; document.body.appendChild(d); });
    await page.waitForTimeout(400);
    await page.evaluate(() => document.getElementById('sync').remove());
    const t0 = Date.now();
    const at = async (s) => { const d = t0 + s * 1000 - Date.now(); if (d > 0) await page.waitForTimeout(d); };
    await at(Number(scrollAt));
    for (let y = 0; y <= Number(scrollBy); y += 3) { await page.evaluate((yy) => window.scrollTo(0, yy), y); await page.waitForTimeout(16); }
    await at(Number(dur));
  } catch (e) { console.error('ERR', e.message); }
  await ctx.close(); await browser.close();
})();
