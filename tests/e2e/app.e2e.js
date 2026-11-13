// End-to-end browser test of the published app (citizen search, voice client tools, operator intake).
// Usage: node tests/e2e/app.e2e.js "$OPERATOR_TOKEN" <screenshot_dir>   (needs Playwright + Chromium)
const { chromium } = require('playwright');
const [,, token, out] = process.argv;
const APP = 'https://screenshot-to-spark-3870.lovable.app';
const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' – ' + extra : ''}`);
(async () => {
  const browser = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY } });
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // 1. Enter runs the prefix search
  await page.goto(APP + '/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.getByLabel(/First characters of the document number/i).fill('EL655');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(6000);
  check('Enter runs prefix search', /1 possible match/i.test(await page.locator('main').innerText()));

  // 2. Enter runs the describe search
  await page.getByRole('tab', { name: /Describe it/i }).click();
  const what = page.getByPlaceholder(/black wallet/i);
  await what.fill('passport wallet');
  await what.press('Enter');
  await page.waitForTimeout(6000);
  const txt = await page.locator('main').innerText();
  check('Enter runs describe search', /possible match/i.test(txt), (txt.match(/(\d[\d,]*) possible match/) || [])[0]);
  await page.screenshot({ path: `${out}/1_describe.png` });

  // 3. Voice client tools registered on the widget (simulate the agent)
  const tools = await page.evaluate(() => {
    const w = document.querySelector('elevenlabs-convai');
    if (!w) return { widget: false };
    const detail = { config: {} };
    w.dispatchEvent(new CustomEvent('elevenlabs-convai:call', { detail }));
    window.__ritrovoTools = detail.config.clientTools || {};
    return { widget: true, names: Object.keys(window.__ritrovoTools) };
  });
  check('widget present', tools.widget);
  check('4 client tools registered', (tools.names || []).length === 4, JSON.stringify(tools.names));
  await page.evaluate(() => window.__ritrovoTools.show_search_results({ query: 'zaino', prefix: '', lost_from: '2026-11-01', lost_to: '2026-11-12', category: '' }));
  await page.waitForTimeout(6000);
  check('show_search_results navigates + searches', /possible match/i.test(await page.locator('main').innerText()), page.url().replace(APP, ''));
  await page.evaluate(() => window.__ritrovoTools.show_item({ item_id: '2025-255' }));
  await page.waitForTimeout(5000);
  check('show_item opens the item', page.url().endsWith('/item/2025-255') && /RECORD 255 OF 2025/i.test(await page.locator('main').innerText()));
  await page.evaluate(() => window.__ritrovoTools.fill_alert_form({ what: 'red umbrella', category: 'abbigliamento', lost_on: '2026-11-12', lost_where: 'Bus 64', prefix: '', language: 'en', phone: '', email: 'x@example.org', saved_alert_id: '' }));
  await page.waitForTimeout(5000);
  check('fill_alert_form prefills', (await page.locator('textarea').first().inputValue()) === 'red umbrella', page.url().replace(APP, ''));
  await page.screenshot({ path: `${out}/2_alert_voice.png` });

  // 4. Operator: confirm clears the note; trace shows "Confirmed by operator"
  await ctx.addInitScript((t) => { try { sessionStorage.setItem('ritrovo_operator_token', t); } catch {} }, token);
  const op = await ctx.newPage();
  op.on('pageerror', (e) => errors.push(e.message));
  await op.goto(APP + '/operator', { waitUntil: 'networkidle', timeout: 60000 });
  const note = op.locator('textarea').first();
  await note.fill('Zaino blu Invicta con un libro e un caricatore, consegnato da un cittadino a Termini');
  await op.waitForTimeout(9000);
  await op.getByRole('button', { name: /confirm/i }).first().click();
  await op.waitForTimeout(35000);
  check('note cleared after save', (await op.locator('textarea').first().inputValue()) === '');
  check('result panel visible', /Routed/i.test(await op.locator('main').innerText()));
  await op.getByText(/agent trace/i).first().click();
  await op.getByText(/operator_confirmed_fields/).first().waitFor({ timeout: 30000 }).catch(() => {});
  const drawer = await op.locator('body').innerText();
  check('trace shows Confirmed by operator', /Confirmed by operator/i.test(drawer.slice(drawer.indexOf('Agent trace'))));
  await op.screenshot({ path: `${out}/3_trace.png` });
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(results.join('\n'));
  await browser.close();
})().catch((e) => { console.log(results.join('\n')); console.error('FAILED', e.message); process.exit(1); });
