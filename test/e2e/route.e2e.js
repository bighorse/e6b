/* Route helper end to end: look up KCOU → KMHL, get winds (Open-Meteo and FB
 * served from test fixtures), send the leg to PLAN and read it on the CX-3.
 * Needs data/nav (node tools/build-navdata.js).
 * Run: node test/e2e/route.e2e.js */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const openMeteo = require('../fixtures/open-meteo.js');
const ROOT = path.resolve(__dirname, '../..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});

(async () => {
  await new Promise(r => server.listen(0, r));
  const base = 'http://127.0.0.1:' + server.address().port + '/';
  const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const ctx = await b.newContext({ viewport: { width: 393, height: 852 }, timezoneId: 'UTC' });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('requestfailed', r => console.log('failed', r.url(), r.failure().errorText));
  await p.route('**/api.open-meteo.com/**', r => {
    const n = new URL(r.request().url()).searchParams.get('latitude').split(',').length;
    r.fulfill({ contentType: 'application/json', body: JSON.stringify(openMeteo(n)), headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  await p.route('**/data/winds.json', r => r.fulfill({ contentType: 'application/json', path: path.join(__dirname, '../fixtures/winds-fb.json') }));

  let pass = 0, fail = 0;
  const check = (name, ok, got) => { if (ok) pass++; else { fail++; console.log('FAIL', name, '→', JSON.stringify(got)); } };

  async function query(route, dep, src) {
    await p.goto(base + 'route.html');
    await p.fill('#route', route); await p.fill('#alt', '5500'); await p.fill('#tas', '110'); await p.fill('#frate', '8.5');
    await p.selectOption('#src', src); await p.fill('#dep', dep);
    await p.click('form button');
    await p.waitForSelector('#out .leg', { timeout: 10000 }).catch(async () => console.log('status:', await p.locator('#status').innerText()));
    return p.locator('#out').innerText().catch(() => '');
  }

  // model winds
  let t = await query('KCOU KMHL', '2026-10-04T10:00', 'model');
  check('waypoints resolved', /KCOU[\s\S]*Columbia Regional[\s\S]*KMHL[\s\S]*Marshall/.test(t), t.slice(0, 200));
  check('true course 290', /TCrs 真航迹\s*290°/.test(t), t);
  check('distance 48.8 NM', /48\.8 NM/.test(t), t);
  // variation at the leg's midpoint (KCOU 0.6°W, KMHL 0.1°E)
  check('variation 0.3°W, CX-3 Var 0.3', /0\.3°W[\s\S]*CX-3 Var 输入 0\.3/.test(t), t);
  check('model wind 270/20', /270° \/ 20 kt/.test(t), t);
  check('ground speed 91 kt', /地速 GS\s*91 kt/.test(t), t);

  // send to PLAN and read the leg on the CX-3
  await p.click('#send');
  await p.waitForURL(/index\.html/);
  await p.waitForFunction(() => window.CX3 && !window.CX3.ui().booting && document.querySelector('#screen .li'));
  const menu = await p.locator('#screen').innerText();
  check('PLAN opens with leg 1', /TRIP[\s\S]*Leg 1[\s\S]*Review & Edit/.test(menu), menu);
  await p.evaluate(() => { window.CX3.press('DOWN'); window.CX3.press('ENTER'); });
  const rows = await p.evaluate(() => [...document.querySelectorAll('#screen .lst .li')].map(li => [li.querySelector('.lab') ? li.querySelector('.lab').textContent : li.textContent, (li.querySelector('.val') || {}).textContent].join(' ')));
  const want = ['Dist 48.80', 'TCrs 290', 'TAS 110.00', 'WDir 270', 'WSpd 20.00', 'Var 0', 'Dev 0', 'Fuel Rate 8.50', 'Depart 10:00:00', 'GS 90.99', 'TH 286', 'MH 287', 'ETE 0:32:10'];
  want.forEach(w => check('PLAN row ' + w, rows.includes(w), rows));

  // official FB winds (auto, inside the forecast window)
  t = await query('KCOU KMHL', '2026-10-03T22:00', 'auto');
  check('FB used in the US', /官方 FB 预报/.test(t), t);
  await p.locator('#out details summary').first().click();
  t = await p.locator('#out').innerText();
  check('FB raw line shown', /COU 1307 2107\+15/.test(t), t);

  // unknown code and coordinates
  t = await query('KCOU QQQQQ', '2026-10-04T10:00', 'model');
  check('unknown code reported', /QQQQQ: not found/.test(await p.locator('#status').innerText()), await p.locator('#status').innerText());
  t = await query('38.82/-92.22 N3905.7W09312.2', '2026-10-04T10:00', 'model');
  check('coordinates as waypoints', /TCrs 真航迹\s*290°/.test(t), t);

  check('no page errors', !errs.length, errs);
  console.log(`${pass}/${pass + fail} route helper checks passed`);
  await b.close(); server.close();
  process.exit(fail ? 1 : 0);
})();
