/* Route helper ↔ CX-3 PLAN, end to end.
 * For many routes (random US airports, 2–7 waypoints, random altitude, TAS,
 * fuel rate, departure; winds that differ from place to place) the helper's
 * "keys" must be exactly PLAN's inputs and its "CX-3 results" exactly what PLAN
 * shows, leg by leg and for the Total Trip. Plus: FB winds, east variation,
 * courses through 360, calm wind, no TAS, re-sending fewer legs, more than 5
 * legs, metric units, and the simulator open in another tab.
 * Open-Meteo and FB are served from test fixtures. Needs data/nav
 * (node tools/build-navdata.js).   Run: node test/e2e/route.e2e.js */
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

let seed = 20261004;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const ri = (a, b) => Math.floor(a + rnd() * (b - a + 1));

(async () => {
  await new Promise(r => server.listen(0, r));
  const base = 'http://127.0.0.1:' + server.address().port + '/';
  const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  let pass = 0, fail = 0;
  const check = (name, ok, got) => { if (ok) pass++; else { fail++; console.log('FAIL', name, '→', JSON.stringify(got)); } };

  async function context() {
    const ctx = await b.newContext({ viewport: { width: 393, height: 852 }, timezoneId: 'UTC' });
    await ctx.route('**/api.open-meteo.com/**', r => {
      const u = new URL(r.request().url()), la = u.searchParams.get('latitude').split(',').map(Number), lo = u.searchParams.get('longitude').split(',').map(Number);
      r.fulfill({ contentType: 'application/json', body: JSON.stringify(openMeteo(la.length, la, lo)), headers: { 'Access-Control-Allow-Origin': '*' } });
    });
    await ctx.route('**/data/winds.json', r => r.fulfill({ contentType: 'application/json', path: path.join(__dirname, '../fixtures/winds-fb.json') }));
    return ctx;
  }
  function watch(p, errs) { p.on('pageerror', e => errs.push(e.message)); }

  async function query(p, f) {
    await p.goto(base + 'route.html');
    await p.fill('#route', f.route); await p.fill('#alt', String(f.alt));
    await p.fill('#tas', f.tas ? String(f.tas) : ''); await p.fill('#frate', f.frate ? String(f.frate) : '');
    await p.selectOption('#src', f.src || 'model'); await p.fill('#dep', f.dep);
    await p.click('form button');
    await p.waitForSelector('#out .leg', { timeout: 15000 }).catch(() => {});
    return p.evaluate(() => {
      const pick = (el, attr) => Object.fromEntries([...el.querySelectorAll('[' + attr + ']')].map(s => [s.getAttribute(attr), s.textContent]));
      return { legs: [...document.querySelectorAll('#out .leg')].map(l => ({ k: pick(l, 'data-k'), c: pick(l, 'data-c') })),
               total: pick(document, 'data-t'), status: document.querySelector('#status').textContent,
               text: document.querySelector('#out').innerText };
    });
  }
  // CX-3 screens, read through the keys
  const press = (p, keys) => p.evaluate(ks => ks.split(' ').forEach(k => window.CX3.press(k)), keys);
  const rows = p => p.evaluate(() => Object.fromEntries([...document.querySelectorAll('#screen .lst .li')].filter(li => li.querySelector('.lab'))
    .map(li => [li.querySelector('.lab').textContent, li.querySelector('.val').textContent])));
  const screenText = p => p.evaluate(() => document.querySelector('#screen').innerText);
  async function planLeg(p, i) { await press(p, 'PLAN ' + 'UP '.repeat(12) + 'DOWN '.repeat(i + 1) + 'ENTER'); return rows(p); }
  async function planTotal(p) { await press(p, 'PLAN ' + 'UP '.repeat(12) + 'ENTER'); return rows(p); }
  async function send(p) {
    await p.click('#send');
    await p.waitForURL(/index\.html/);
    await p.waitForFunction(() => window.CX3 && !window.CX3.ui().booting && document.querySelector('#screen .li'));
  }
  const num = s => parseFloat(String(s).replace(/[^0-9.\-]/g, ''));

  // compare one helper result with what PLAN shows
  async function compare(p, name, H, f) {
    const sent = Math.min(H.legs.length, 5);
    const menu = await screenText(p);
    check(name + ': PLAN lists ' + sent + ' legs', (menu.match(/Review & Edit/g) || []).length === sent, menu);
    let prevEta = null;
    for (let i = 0; i < sent; i++) {
      const R = await planLeg(p, i), k = H.legs[i].k, c = H.legs[i].c, n = name + ' leg ' + (i + 1);
      // the helper shows its keys in PLAN's units and decimals: the same text
      for (const key of ['Dist', 'TCrs', 'WDir', 'WSpd', 'Var', 'Dev']) check(n + ' ' + key, R[key] === k[key], [R[key], k[key]]);
      check(n + ' TAS', f.tas ? R.TAS === k.TAS : R.TAS === '--', [R.TAS, k.TAS]);
      check(n + ' Fuel Rate', f.frate ? R['Fuel Rate'] === k['Fuel Rate'] : R['Fuel Rate'] === '--', [R['Fuel Rate'], k['Fuel Rate']]);
      if (i === 0) check(n + ' Depart', R.Depart === k.Depart, [R.Depart, k.Depart]);
      else check(n + ' departs at the previous ETA', R.Depart === prevEta, [R.Depart, prevEta]);
      if (f.tas) {
        for (const key of ['GS', 'CH', 'MH', 'TH', 'WCA', 'ETE', 'ETA'].concat(f.frate ? ['Fuel'] : [])) check(n + ' ' + key, R[key] === c[key], [R[key], c[key]]);
      } else check(n + ' no TAS: no results', R.GS === '--' && !Object.keys(c).length, [R.GS, c]);
      prevEta = R.ETA;
    }
    if (H.legs.length <= 5) {
      const T = await planTotal(p);
      check(name + ' total Dist', T.Dist === H.total.Dist, [T.Dist, H.total.Dist]);
      if (f.tas) {
        check(name + ' total ETE', T.ETE === H.total.ETE, [T.ETE, H.total.ETE]);
        check(name + ' total ETA', T.ETA === H.total.ETA, [T.ETA, H.total.ETA]);
        if (f.frate) check(name + ' total Fuel', T.Fuel === H.total.Fuel, [T.Fuel, H.total.Fuel]);
      }
    }
  }

  // ---------------------------------------------------------------- random routes
  const K = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/nav/K.json'), 'utf8'));
  const US = Object.keys(K).filter(id => /^K[A-Z]{3}$/.test(id) && K[id].some(e => e[0] === id && e[4] === 'A' && e[6] === 'US'));
  const at = id => K[id].find(e => e[0] === id);
  function route(n) {
    // waypoints within ~150 NM of each other so legs look like real flights
    const pts = [US[ri(0, US.length - 1)]];
    while (pts.length < n) {
      const a = at(pts[pts.length - 1]);
      const near = US.filter(id => { const e = at(id); return id !== pts[pts.length - 1] && Math.abs(e[1] - a[1]) < 2 && Math.abs(e[2] - a[2]) < 2.5; });
      pts.push(near.length ? near[ri(0, near.length - 1)] : US[ri(0, US.length - 1)]);
    }
    return pts.join(' ');
  }
  const N = +(process.env.ROUTES || 24);
  const ctx = await context(), errs = [];
  for (let r = 0; r < N; r++) {
    const p = await ctx.newPage(); watch(p, errs);
    const h = ri(0, 39), f = { route: route(ri(2, 7)), alt: ri(15, 125) * 100, tas: rnd() < 0.85 ? ri(80, 170) : null,
      frate: rnd() < 0.7 ? ri(50, 160) / 10 : null, dep: '2026-10-' + String(4 + Math.floor(h / 24)).padStart(2, '0') + 'T' + String(h % 24).padStart(2, '0') + ':' + String(ri(0, 59)).padStart(2, '0') };
    const H = await query(p, f);
    if (!H.legs.length) { check('route ' + f.route + ' resolved', false, H.status); await p.close(); continue; }
    await send(p);
    await compare(p, 'route ' + (r + 1) + ' (' + f.route + ')', H, f);
    await p.close();
  }

  // ---------------------------------------------------------------- special cases
  async function caseRun(name, f, extra) {
    const p = await ctx.newPage(); watch(p, errs);
    const H = await query(p, f);
    if (extra) await extra(p, H);
    await send(p);
    await compare(p, name, H, f);
    await p.close();
    return H;
  }
  // east variation: Var keyed as a minus number
  let H = await caseRun('east variation', { route: 'KSFO KSAC', alt: 4500, tas: 120, frate: 9, dep: '2026-10-04T15:00' });
  check('east variation: Var −13', H.legs[0].k.Var === '-13', H.legs[0].k);
  check('east variation explained', /13 再按 ±（东偏）/.test(H.text), H.text.slice(0, 600));
  // a course through north: 360 is keyed as 0, as the CX-3 shows it
  H = await caseRun('course near north', { route: '40.0/-93.0 41.0/-93.004', alt: 3500, tas: 100, dep: '2026-10-04T12:00' });
  check('north course keyed 0', H.legs[0].k.TCrs === '0', H.legs[0].k);
  // calm wind (fixture gives 0 kt at this spot): WDir 0, WSpd 0
  H = await caseRun('calm wind', { route: '0.4/-1.0 0.9/-1.0', alt: 3000, tas: 90, dep: '2026-10-04T12:00' });
  check('calm keyed 0 / 0', H.legs[0].k.WSpd === '0.00' && H.legs[0].k.WDir === '0', H.legs[0].k);
  // FB winds: same agreement
  H = await caseRun('FB winds', { route: 'KCOU KMHL', alt: 5500, tas: 110, frate: 8.5, dep: '2026-10-03T22:00', src: 'auto' });
  check('FB used', /官方 FB 预报/.test(H.text), H.text.slice(0, 800));
  // more than 5 legs: only the first 5 reach PLAN
  H = await caseRun('7 legs', { route: 'KCOU KMHL KSZL KCOU KJEF KVIH KCOU KMHL', alt: 4500, tas: 105, frate: 8, dep: '2026-10-04T14:00' });
  check('7 legs listed, warning shown', H.legs.length === 7 && /只有前 5 段会送入 PLAN/.test(H.text), H.legs.length);

  // re-sending a shorter route replaces all legs
  {
    const p = await ctx.newPage(); watch(p, errs);
    await query(p, { route: 'KCOU KMHL KSZL KJEF', alt: 4500, tas: 105, dep: '2026-10-04T14:00' }); await send(p);
    const f = { route: 'KCOU KMHL', alt: 5500, tas: 110, frate: 8.5, dep: '2026-10-04T10:00' };
    const H2 = await query(p, f); await send(p);
    await compare(p, 're-send fewer legs', H2, f);
    await p.close();
  }
  // metric default units: PLAN shows litres, the values are the same
  {
    const p = await ctx.newPage(); watch(p, errs);
    await p.goto(base + 'index.html'); await p.waitForFunction(() => window.CX3 && !window.CX3.ui().booting);
    await press(p, 'SET DOWN DOWN DOWN ENTER DOWN ENTER');           // Default Units: Metric
    const f = { route: 'KCOU KMHL KSZL', alt: 5500, tas: 110, frate: 8.5, dep: '2026-10-04T10:00' };
    const Hm = await query(p, f); await send(p);
    await compare(p, 'metric units', Hm, f);
    const R = await planLeg(p, 0);
    check('metric: fuel rate 8.5 gal/hr = 32.18 LPH', R['Fuel Rate'] === '32.18', R);
    check('metric: distance still NM', R.Dist === '48.80', R);
    // a unit changed on a leg screen (CONV UNIT on Dist → KM) shows in the helper too
    await press(p, 'PLAN ' + 'UP '.repeat(12) + 'DOWN ENTER CONVUNIT');
    const Hk = await query(p, f); await send(p);
    await compare(p, 'unit changed on the leg screen', Hk, f);
    check('helper shows the leg distance in KM', /data-k/.test('data-k') && Hk.legs[0].k.Dist === '90.38', Hk.legs[0].k);
    await press(p, 'SET DOWN DOWN DOWN ENTER UP ENTER');             // back to U.S. (resets units)
    await p.close();
  }
  // the CX-3 open in another tab picks up the new PLAN without a reload
  {
    const a = await ctx.newPage(), c = await ctx.newPage(); watch(a, errs); watch(c, errs);
    await a.goto(base + 'index.html'); await a.waitForFunction(() => window.CX3 && !window.CX3.ui().booting);
    await press(a, 'FLT');
    const f = { route: 'KSZL KCOU KJEF', alt: 6500, tas: 115, frate: 9, dep: '2026-10-04T16:30' };
    const H3 = await query(c, f); await send(c);
    await a.waitForTimeout(300);
    await press(a, 'PLAN');
    await compare(a, 'other tab', H3, f);
    await a.close(); await c.close();
  }
  check('no page errors', !errs.length, errs);

  console.log(`${pass}/${pass + fail} route helper ↔ PLAN checks passed`);
  await b.close(); server.close();
  process.exit(fail ? 1 : 0);
})();
