/* CALC screen end-to-end: taps the on-screen keys (pointer events) and uses the
 * computer keyboard, then checks what the display shows.
 * Run: npm i playwright && npx playwright install chromium && node test/e2e/calc.e2e.js */
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const p = await b.newPage({ viewport: { width: 420, height: 912 }, hasTouch: true, isMobile: true });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('file://' + path.resolve(__dirname, '../../index.html'));
  await p.waitForTimeout(1600);

  let pass = 0, fail = 0;
  // retry a read until it matches (up to 1.5 s): screen updates are not instant on slow CI machines
  const expect = async (name, read, ok) => {
    let got;
    for (let i = 0; i < 30; i++) { got = await read(); if (ok(got)) { pass++; return; } await p.waitForTimeout(50); }
    fail++; console.log('FAIL', name, '→', JSON.stringify(got));
  };

  // tap a key on the device the way a finger does
  const tap = async (k) => {
    const el = p.locator(`[data-k="${k}"]`);
    await el.dispatchEvent('pointerdown'); await el.dispatchEvent('pointerup');
  };
  const taps = async (seq) => { for (const k of seq.split(' ').filter(Boolean)) await tap(k); };
  const input = () => p.locator('#screen .cin').innerText();
  const tape = () => p.$$eval('#screen .tl', els => els.map(e => e.innerText.replace(/\n/g, ' ')));
  const toast = () => p.locator('#screen .toast').count().then(n => n ? p.locator('#screen .toast').innerText() : '');

  await tap('CALC');
  await expect('fresh line shows 0', async () => await input(), v => (v).trim() === '0');

  await taps('2 + 3 × 4 =');
  await expect('precedence 2+3×4 = 14', async () => await tape(), v => (v).at(-1) === '2+3×4 = 14');

  await taps('× 2 =');
  await expect('continue from result shows Ans', async () => await tape(), v => (v).at(-1) === 'Ans×2 = 28');

  await taps('1 ÷ 3 = × 3 =');
  await expect('1÷3×3 is exactly 1', async () => await tape(), v => (v).at(-1) === 'Ans×3 = 1');

  await taps('1 : 3 0 + 0 : 4 5 =');
  await expect('time sum', async () => await tape(), v => (v).at(-1) === '1:30+0:45 = 2:15:00');
  await taps('1 : 3 0 ÷ 0 : 3 0 =');
  await expect('time ÷ time is a number', async () => await tape(), v => (v).at(-1) === '1:30÷0:30 = 3');

  await taps('7 ÷ 0 =');
  await expect('div by zero toast', async () => await toast(), v => (v) === 'Div by Zero');
  await expect('line kept for correction', async () => await input(), v => (v).includes('7÷0'));
  await taps('C');

  await taps('1 6 SQRT');
  await expect('√ toggles before the number', async () => await input(), v => (v).includes('√16'));
  await taps('=');
  await expect('√16 = 4', async () => await tape(), v => (v).at(-1) === '√16 = 4');

  await taps('5 × +/- 3 =');
  await expect('± makes a negative operand', async () => await tape(), v => (v).at(-1) === '5×-3 = -15');

  // history: scroll back past the 5 visible lines and recall
  for (let i = 0; i < 8; i++) await tap('UP');
  await expect('selected old line is visible', async () => (await p.locator('#screen .tl.sel').innerText().catch(() => '')).replace(/\n/g, ' '),
    v => v === '2+3×4 = 14');
  await tap('ENTER');
  await expect('recall inserts the value', async () => await input(), v => (v).trim().startsWith('14'));
  await taps('C');

  // memory (one memory, as on the CX-3): M opens Recall / Store / Clear
  await taps('2 5 0 = M');
  await expect('memory screen offers to store the result', () => p.locator('#screen').innerText(),
    v => /MEMORY/.test(v) && /Store\s+250/.test(v));
  await taps('ENTER');
  await expect('stored toast', async () => await toast(), v => (v) === 'Stored');
  await taps('1 2 M ENTER');
  await expect('recall replaces the number being typed', async () => await input(), v => (v).trim().startsWith('250'));
  await taps('C');

  // long line: the end stays visible
  await taps('1 2 3 4 5 6 7 8 9 + 9 8 7 6 5 4 3 2 1 + 1 1 1 1 1');
  await expect('cursor at the end stays visible on a long line', () => p.$eval('#screen .cin', el => {
    const r = el.getBoundingClientRect(), c = el.querySelector('.cur').getBoundingClientRect();
    return { cursorInside: c.right <= r.right + 1 && c.left >= r.left - 1, long: el.textContent.length > 20 };
  }), v => v.cursorInside && v.long);
  await taps('C');

  // line limit
  for (let i = 0; i < 41; i++) await tap('9');
  await expect('Line Full toast', async () => await toast(), v => (v) === 'Line Full');
  await taps('C');

  // computer keyboard
  await p.keyboard.type('12*3');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(100);
  await expect('keyboard 12*3 = 36', async () => await tape(), v => (v).at(-1) === '12×3 = 36');
  await p.keyboard.type('7/2=');
  await expect('keyboard 7/2 = 3.5', async () => await tape(), v => (v).at(-1) === '7÷2 = 3.5');

  // CONV UNIT opens conversions, BACK returns with the tape intact
  await tap('CONVUNIT');
  await expect('CONV UNIT opens Unit Conversions', () => p.locator('#screen').innerText(), v => v.includes('Unit Conversions') && v.includes('Temp'));
  await tap('CALC');
  await expect('tape survives leaving CALC', async () => await tape(), v => (v).at(-1) === '7÷2 = 3.5');

  // persistence: Ans survives a reload
  await p.waitForTimeout(300);
  await p.reload(); await p.waitForTimeout(1600);
  await tap('CALC'); await taps('+ 1 =');
  await expect('Ans survives a reload', async () => await tape(), v => (v).at(-1) === 'Ans+1 = 4.5');

  // C then C clears everything
  await taps('C');
  await expect('C on a fresh line clears the tape', async () => await tape(), v => (v).length === 0);

  console.log(`${pass}/${pass + fail} CALC screen checks passed`, errs);
  await b.close();
  process.exit(fail || errs.length ? 1 : 0);
})();
