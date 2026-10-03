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
  const check = (name, ok, got) => { ok ? pass++ : fail++; if (!ok) console.log('FAIL', name, '→', JSON.stringify(got)); };

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
  check('fresh line shows 0', (await input()).trim() === '0', await input());

  await taps('2 + 3 × 4 =');
  check('precedence 2+3×4 = 14', (await tape()).at(-1) === '2+3×4 = 14', await tape());

  await taps('× 2 =');
  check('continue from result shows Ans', (await tape()).at(-1) === 'Ans×2 = 28', await tape());

  await taps('1 ÷ 3 = × 3 =');
  check('1÷3×3 is exactly 1', (await tape()).at(-1) === 'Ans×3 = 1', await tape());

  await taps('1 : 3 0 + 0 : 4 5 =');
  check('time sum', (await tape()).at(-1) === '1:30+0:45 = 2:15:00', await tape());
  await taps('1 : 3 0 ÷ 0 : 3 0 =');
  check('time ÷ time is a number', (await tape()).at(-1) === '1:30÷0:30 = 3', await tape());

  await taps('7 ÷ 0 =');
  check('div by zero toast', (await toast()) === 'Div by Zero', await toast());
  check('line kept for correction', (await input()).includes('7÷0'), await input());
  await taps('C');

  await taps('1 6 SQRT');
  check('√ toggles before the number', (await input()).includes('√16'), await input());
  await taps('=');
  check('√16 = 4', (await tape()).at(-1) === '√16 = 4', await tape());

  await taps('5 × +/- 3 =');
  check('± makes a negative operand', (await tape()).at(-1) === '5×-3 = -15', await tape());

  // history: scroll back past the 5 visible lines and recall
  for (let i = 0; i < 8; i++) await tap('UP');
  const sel = await p.locator('#screen .tl.sel').innerText().catch(() => '');
  check('selected old line is visible', sel.replace(/\n/g, ' ') === '2+3×4 = 14', sel);
  await tap('ENTER');
  check('recall inserts the value', (await input()).trim().startsWith('14'), await input());
  await taps('C');

  // memory: store the last result, recall it in place of a number being typed
  await taps('2 5 0 = M 3 M');
  check('stored toast', (await toast()) === 'Stored M3', await toast());
  await taps('1 2 M 3 ENTER');
  check('recall replaces the number being typed', (await input()).trim().startsWith('250'), await input());
  await taps('C');

  // long line: the end stays visible
  await taps('1 2 3 4 5 6 7 8 9 + 9 8 7 6 5 4 3 2 1 + 1 1 1 1 1');
  const clip = await p.$eval('#screen .cin', el => {
    const r = el.getBoundingClientRect(), c = el.querySelector('.cur').getBoundingClientRect();
    return { cursorInside: c.right <= r.right + 1 && c.left >= r.left - 1 };
  });
  check('cursor at the end stays visible on a long line', clip.cursorInside, clip);
  await taps('C');

  // line limit
  for (let i = 0; i < 41; i++) await tap('9');
  check('Line Full toast', (await toast()) === 'Line Full', await toast());
  await taps('C');

  // computer keyboard
  await p.keyboard.type('12*3');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(100);
  check('keyboard 12*3 = 36', (await tape()).at(-1) === '12×3 = 36', await tape());
  await p.keyboard.type('7/2=');
  check('keyboard 7/2 = 3.5', (await tape()).at(-1) === '7÷2 = 3.5', await tape());

  // CONV UNIT opens conversions, BACK returns with the tape intact
  await tap('CONVUNIT');
  const conv = await p.locator('#screen').innerText();
  check('CONV UNIT opens Unit Conversions', conv.includes('Temperature'), conv.slice(0, 60));
  await tap('CALC');
  check('tape survives leaving CALC', (await tape()).at(-1) === '7÷2 = 3.5', await tape());

  // persistence: Ans survives a reload
  await p.waitForTimeout(300);
  await p.reload(); await p.waitForTimeout(1600);
  await tap('CALC'); await taps('+ 1 =');
  check('Ans survives a reload', (await tape()).at(-1) === 'Ans+1 = 4.5', await tape());

  // C then C clears everything
  await taps('C');
  check('C on a fresh line clears the tape', (await tape()).length === 0, await tape());

  console.log(`${pass}/${pass + fail} CALC screen checks passed`, errs);
  await b.close();
  process.exit(fail || errs.length ? 1 : 0);
})();
