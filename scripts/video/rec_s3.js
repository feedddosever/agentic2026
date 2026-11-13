const { chromium } = require('playwright');
const [,, token, outDir] = process.argv;
const APP = 'https://screenshot-to-spark-3870.lovable.app';
(async () => {
  const browser = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY } });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: outDir, size: { width: 1280, height: 720 } } });
  await ctx.addInitScript((t) => { try { sessionStorage.setItem('ritrovo_operator_token', t); } catch {} }, token);
  const page = await ctx.newPage();
  const t0 = Date.now(); const mark = (m) => console.log('MARK', ((Date.now() - t0) / 1000).toFixed(1), m);
  try {
    await page.goto(APP + '/operator', { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(1000); mark('console');
    const note = page.locator('textarea').first();
    await note.click();
    const preview = page.waitForResponse((r) => r.url().endsWith('/intake/preview') && r.request().method() === 'POST', { timeout: 60000 });
    await page.keyboard.type('Portafoglio nero in pelle con passaporto americano ZR4827316 e 40 euro. Consegnato da ATAC, metro A Termini.', { delay: 28 });
    mark('typed');
    await preview; await page.waitForTimeout(700); mark('preview');
    await page.getByText(/Check and edit/i).first().scrollIntoViewIfNeeded();
    await page.mouse.wheel(0, 220);
    await page.waitForTimeout(3500);
    const btn = page.getByRole('button', { name: /confirm/i }).first();
    await btn.scrollIntoViewIfNeeded(); await page.waitForTimeout(700);
    const saved = page.waitForResponse((r) => /\/intake$/.test(r.url()) && r.request().method() === 'POST', { timeout: 120000 });
    await btn.click(); mark('confirm');
    await saved; mark('saved');
    await page.waitForTimeout(1200);
    await page.screenshot({ path: process.argv[4], fullPage: true });
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    await page.waitForTimeout(2500); mark('top');
    const H = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
    for (let y = 0; y <= H; y += 6) { await page.evaluate((yy) => window.scrollTo(0, yy), y); await page.waitForTimeout(16); }
    mark('bottom'); await page.waitForTimeout(3000); mark('end');
  } catch (e) { console.error('ERR', e.message); }
  const path = await page.video().path();
  await ctx.close(); await browser.close();
  console.log('VIDEO', path);
})();
