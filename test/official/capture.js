/* Captures expected screens from ASA's official online CX-3 emulator.
 *
 *   node test/official/capture.js scenarios [seed] [perScreen]   → scenarios.json
 *   node test/official/capture.js examples                       → examples.json "expect"
 *
 * Needs Playwright and network access to the emulator (CX3E_URL overrides
 * https://online.prepware.com/cx3e/index.html, e.g. a local mirror).
 * Only the screens it shows are stored; none of the emulator's code is used here.
 * Scenario steps: {row, text} types a value, {row, clear} presses C,
 * {row, rotate} presses ENTER on a choice row. */
'use strict';
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
global.Units = require('../../js/units.js');
const Md = require('../../js/model.js');

const URL = process.env.CX3E_URL || 'https://online.prepware.com/cx3e/index.html';
const BTN = { ENTER: 'square', DOWN: 'down', UP: 'up', FLT: 'flt', 'W/B': 'wb', PLAN: 'plan', C: 'c', '.': 'decimal',
  '+/-': 'plusminus', CONVUNIT: 'convunit', SETUNIT: 'setunit', ':': 'colon', BACK: 'back' };
const FLT = Md.FLT_LIST;

// the emulator's rows → [label, value, unit, icon] as this simulator shows them
async function rows(p) {
  return p.evaluate(() => [...document.querySelectorAll('#screen .widget')].filter(e => e.offsetParent !== null).map(w => {
    const g = c => ((w.querySelector('.' + c) || {}).innerText || '').trim(), cl = w.className.split(/\s+/);
    const icon = ['check', 'equals', 'global', 'question'].find(c => cl.includes(c)) || '';
    return { name: g('fieldname'), value: g('value'), unit: g('unit'), icon, active: cl.includes('active') };
  }));
}
function norm(r) {
  let { name, value, unit, icon } = r;
  name = name.replace('~', '∆');                       // the emulator's font has no delta
  if (['Turn Dir', 'Type', 'Entry'].includes(name)) { value = icon === 'question' ? '--' : unit; unit = ''; }
  else if (!icon) value = '';                         // headings
  else if (icon === 'question') value = '--';         // the emulator can leave stale text next to "?"
  return [name, value, unit, icon];
}
async function page(b) {
  const p = await (await b.newContext({ viewport: { width: 900, height: 1200 } })).newPage();
  await p.goto(URL); await p.waitForTimeout(1000);
  p.key = async k => { await p.click('#btn-' + (BTN[k] || k)); await p.waitForTimeout(30); };
  return p;
}

function generate(seed, per) {
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const ri = (a, b) => Math.floor(a + rnd() * (b - a + 1)), rf = (a, b, dp) => (a + rnd() * (b - a)).toFixed(dp);
  const sgn = t => (t < 0 ? '-' + -t : String(t));
  const GEN = {
    altitude: () => String(ri(0, 15000)), pressure: v => (v.id === 'sbaro' ? rf(8, 30, 2) : rf(28, 31, 2)),
    temperature: () => sgn(ri(-40, 100)), air_speed: () => rf(60, 300, ri(0, 2)), ground_speed: () => rf(50, 300, ri(0, 2)),
    mach: () => rf(0.1, 0.9, 3), distance: () => rf(5, 500, ri(0, 1)), duration: () => rf(0.2, 5, 2), volume: () => rf(5, 100, 1),
    fuel_rate: () => rf(5, 30, 1), weight: () => rf(30, 600, 0), fuel_wt_rate: () => rf(30, 200, 0), ratio: () => rf(5, 20, 1),
    climb_rate: () => String(ri(300, 2000)), climb_angle: () => String(ri(100, 600)), angle: () => String(ri(1, 359)),
    angle_180: () => sgn(ri(-20, 20)), runway: () => String(ri(1, 36)), length: () => rf(10, 200, 1), percent: () => rf(10, 40, 1),
    time: () => [ri(0, 23), ri(0, 59), ri(0, 59)].map(x => String(x).padStart(2, '0')).join('')
  };
  const out = [];
  for (const id of ['alt', 'cloud', 'stdatm', 'airspd', 'fuel', 'gs', 'glide', 'climb', 'wcomp', 'eta', 'tofrom', 'chdg', 'wcorr', 'hold', 'wshift', 'mac']) {
    const ins = Md.screenRows(id).map((r, i) => [r, i]).filter(([r]) => !r.v.ro);
    for (let n = 0; n < per; n++) {
      const steps = [];
      for (let j = ri(2, Math.min(6, ins.length + 2)); j > 0; j--) {
        const [r, i] = ins[ri(0, ins.length - 1)];
        if (Units.DIMS[r.v.dim].choice) steps.push({ row: i, rotate: true });
        else if (rnd() < 0.1) steps.push({ row: i, clear: true });
        else steps.push({ row: i, text: GEN[r.v.dim](r.v) });
      }
      out.push({ screen: id, steps });
    }
  }
  return out;
}

async function runScenario(p, sc) {
  if (sc.screen === 'wshift' || sc.screen === 'mac') { await p.key('W/B'); await p.key('DOWN'); if (sc.screen === 'mac') await p.key('DOWN'); }
  else { await p.key('FLT'); for (let j = 0; j < FLT.indexOf(sc.screen); j++) await p.key('DOWN'); }
  await p.key('ENTER');
  for (const st of sc.steps) {
    for (let t = 0; t < 30; t++) {
      const a = (await rows(p)).findIndex(x => x.active);
      if (a === st.row) break;
      await p.key(a < st.row ? 'DOWN' : 'UP');
    }
    if (st.rotate) await p.key('ENTER');
    else if (st.clear) await p.key('C');
    else {
      for (const c of st.text.replace('-', '')) await p.key(c);
      if (st.text[0] === '-') await p.key('+/-');
      await p.key('ENTER');
    }
    await p.waitForTimeout(60);
  }
  return (await rows(p)).map(norm);
}

(async () => {
  const mode = process.argv[2], b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  if (mode === 'scenarios') {
    const list = generate(+process.argv[3] || 7, +process.argv[4] || 12);
    for (const sc of list) { const p = await page(b); sc.expect = await runScenario(p, sc); await p.context().close(); }
    fs.writeFileSync(path.join(__dirname, 'scenarios.json'), '[\n' + list.map(x => JSON.stringify(x)).join(',\n') + '\n]\n');
  } else if (mode === 'examples') {
    const file = path.join(__dirname, 'examples.json'), EX = require(file);
    for (const ex of EX) {
      const p = await page(b);
      for (const k of ex.keys.split(' ')) await p.key(k);
      await p.waitForTimeout(150);
      ex.expect = (await rows(p)).map(norm);
      await p.context().close();
    }
    fs.writeFileSync(file, '[\n' + EX.map(x => JSON.stringify(x)).join(',\n') + '\n]\n');
  } else console.log('usage: node test/official/capture.js scenarios|examples');
  await b.close();
})();
