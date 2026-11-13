// Scene 4 screen: the public site, driven at the call's timeline by the agent's client-tool calls (SPA navigation).
const { chromium } = require('playwright');
const [,, outDir, item] = process.argv;
const APP = 'https://screenshot-to-spark-3870.lovable.app';
const SCHEDULE = [
  [30.4, `/?prefix=ZR482&lost_from=2026-11-13&lost_to=2026-11-14`],
  [34.3, `/item/${item}`],
  [48.2, `/pickup/${item}`],
];
(async () => {
  const browser = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY } });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, timezoneId: 'Europe/Rome', locale: 'en-GB', recordVideo: { dir: outDir, size: { width: 1280, height: 720 } } });
  const tStart = Date.now();
  const page = await ctx.newPage();
  try {
    await page.goto(APP + '/', { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(1500);
    // Sync marker: a black frame for 400 ms, removed exactly at t0 (found later with ffmpeg blackdetect).
    await page.evaluate(() => { const d = document.createElement('div'); d.id = 'sync'; d.style.cssText = 'position:fixed;inset:0;background:#000;z-index:99999'; document.body.appendChild(d); });
    await page.waitForTimeout(400);
    await page.evaluate(() => document.getElementById('sync').remove());
    const t0 = Date.now(); console.log('OFFSET', ((t0 - tStart) / 1000).toFixed(2));
    const at = async (s) => { const d = t0 + s * 1000 - Date.now(); if (d > 0) await page.waitForTimeout(d); };
    for (const [s, url] of SCHEDULE) {
      await at(s);
      await page.evaluate((u) => { history.pushState({}, '', u); dispatchEvent(new PopStateEvent('popstate')); }, url);
      console.log('NAV', s, url);
    }
    await at(59.5);
    for (let y = 0; y <= 660; y += 4) { await page.evaluate((yy) => window.scrollTo(0, yy), y); await page.waitForTimeout(16); }
    await at(66);
    await page.screenshot({ path: outDir + '/../frames/s4_end.png', fullPage: true });
  } catch (e) { console.error('ERR', e.message); }
  await ctx.close(); await browser.close();
})();
