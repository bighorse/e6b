/* The manual's worked examples, keyed into the simulator exactly as written
 * (test/official/examples.json), compared screen by screen with what ASA's
 * official CX-3 emulator showed for the same keys.
 * Run: npm i playwright && npx playwright install chromium && node test/e2e/examples.e2e.js */
const { chromium } = require('playwright');
const path = require('path');
const EX = require('../official/examples.json');
const ICON = { ok: 'check', eq: 'equals', gl: 'global', no: 'question', none: '' };

(async () => {
  const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  let pass = 0, fail = 0;
  for (const ex of EX) {
    const ctx = await b.newContext({ viewport: { width: 420, height: 912 } }), p = await ctx.newPage();
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto('file://' + path.resolve(__dirname, '../../index.html'));
    await p.waitForFunction(() => window.CX3 && !window.CX3.ui().booting, null, { timeout: 5000 });
    for (const k of ex.keys.split(' ')) await p.evaluate(k => window.CX3.press(k), k);
    const got = await p.evaluate(() => [...document.querySelectorAll('#screen .lst .li')].map(li => {
      const g = c => (li.querySelector('.' + c) || {}).textContent || '';
      if (li.classList.contains('hd')) return [li.childNodes[0].textContent, '', (li.querySelector('.lr') || {}).textContent || '', ''];
      const q = li.querySelector('.q');
      return [g('lab'), g('val'), g('unit'), q ? q.className.split(' ')[1] : ''];
    }));
    got.forEach(r => { if (r[3] in ICON) r[3] = ICON[r[3]]; });
    const exp = JSON.parse(JSON.stringify(ex.expect));
    (ex.allow || []).forEach(a => { exp[a.row][1] = a.value; });
    const bad = [];
    if (got.length !== exp.length) bad.push(`${got.length} rows shown, ${exp.length} expected`);
    exp.forEach((e, i) => { if (JSON.stringify(e) !== JSON.stringify(got[i])) bad.push(`${e.join(' ')}  ≠  ${(got[i] || []).join(' ')}`); });
    if (errs.length) bad.push('page errors: ' + errs.join('; '));
    if (bad.length) { fail++; console.log('FAIL', ex.id, ex.title, '\n   ' + bad.join('\n   ')); } else pass++;
    await ctx.close();
  }
  console.log(`${pass}/${pass + fail} manual examples match the official emulator's screens`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
