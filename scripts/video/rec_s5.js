// Scene 5: verify page of the embassy message, then the custody timeline in the operator queue.
const { chromium } = require('playwright');
const [,, token, outDir, msgId, item] = process.argv;
const APP = 'https://screenshot-to-spark-3870.lovable.app';
(async () => {
  const browser = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY } });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, timezoneId: 'Europe/Rome', locale: 'en-GB', recordVideo: { dir: outDir, size: { width: 1280, height: 720 } } });
  await ctx.addInitScript((t) => { try { sessionStorage.setItem('ritrovo_operator_token', t); } catch {} }, token);
  const page = await ctx.newPage();
  try {
    await page.goto(APP + '/verify/' + msgId, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(1500);
    await page.evaluate(() => { const d = document.createElement('div'); d.id = 'sync'; d.style.cssText = 'position:fixed;inset:0;background:#000;z-index:99999'; document.body.appendChild(d); });
    await page.waitForTimeout(400);
    await page.evaluate(() => document.getElementById('sync').remove());
    const t0 = Date.now();
    const at = async (s) => { const d = t0 + s * 1000 - Date.now(); if (d > 0) await page.waitForTimeout(d); };
    await at(3.5);
    for (let y = 0; y <= 330; y += 3) { await page.evaluate((yy) => window.scrollTo(0, yy), y); await page.waitForTimeout(16); }
    await at(8);
    await page.getByText(/Technical details/i).first().click().catch(() => {});
    await page.waitForTimeout(300);
    for (let y = 330; y <= 560; y += 3) { await page.evaluate((yy) => window.scrollTo(0, yy), y); await page.waitForTimeout(16); }
    await at(11.8);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByRole('link', { name: /^Operator$/ }).first().click();
    await page.getByRole('tab', { name: /queue/i }).click({ timeout: 15000 });
    await page.getByText(item).first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(600);
    await page.getByText(item).first().click();
    console.log('SHEET', ((Date.now() - t0) / 1000).toFixed(1));
    await at(24);
  } catch (e) { console.error('ERR', e.message); }
  await ctx.close(); await browser.close();
})();
