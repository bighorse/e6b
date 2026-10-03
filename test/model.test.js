/* Solver engine and model: unit tests, plus 512 random key scenarios whose
 * expected screens were captured from ASA's official online CX-3 emulator
 * (test/official/capture.js). */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { replay, Md, U } = require('./replay.js');
const SCENARIOS = require('./official/scenarios.json');

const V = Md.vars;
function enter(id, unit, x) {
  const v = V[id], u = U.DIMS[v.dim].units[U.unitIndex(v.dim, unit)];
  v.clear(); v.set(U.toBase(u, x), false);
}
function shown(id, unit) {
  const v = V[id], u = U.DIMS[v.dim].units[U.unitIndex(v.dim, unit)];
  return U.format(v.dim, u, v.has ? v.v : null);
}

test('a result is computed once its inputs are known, and the inputs are locked', () => {
  Md.reset();
  enter('dist', 'NM', 100); enter('dur', 'HR', 2);
  assert.strictEqual(shown('gs', 'KTS'), '50.00');
  assert.ok(V.gs.computed);
  assert.ok(V.dist.locked && V.dur.locked);
});

test('typing over a computed value clears the values it came from (as on the CX-3)', () => {
  Md.reset();
  enter('dist', 'NM', 100); enter('dur', 'HR', 2);
  enter('gs', 'KTS', 60);
  assert.strictEqual(shown('gs', 'KTS'), '60.00');
  assert.ok(!V.gs.computed);
  assert.strictEqual(shown('dist', 'NM'), '--');
  assert.strictEqual(shown('dur', 'HR'), '--');
  enter('dist', 'NM', 120);
  assert.strictEqual(shown('dur', 'HR'), '2.00');
});

test('variables are shared between screens', () => {
  Md.reset();
  enter('dist', 'NM', 100); enter('dur', 'HR', 2);         // Ground Speed
  const climb = Md.screenRows('climb').map(r => r.v.id);
  assert.ok(climb.includes('dist') && climb.includes('gs'));
  enter('desc', 'FT', 6076.12);                              // Climb & Descent
  assert.strictEqual(shown('aoc', 'FT/NM'), '60.76');
  assert.strictEqual(shown('roc', 'FPM'), '50.63');          // 50 kt × 60.76 ft/NM ÷ 60
});

test('clearing an input clears what was computed from it', () => {
  Md.reset();
  enter('ialt', 'FT', 5000); enter('baro', 'IN HG', 30.12); enter('oat', '°F', 77);
  assert.strictEqual(shown('dalt', 'FT'), '7039');
  V.baro.clear();
  assert.strictEqual(shown('palt', 'FT'), '--');
  assert.strictEqual(shown('dalt', 'FT'), '--');
  assert.ok(!V.ialt.locked);
});

test('display format follows the CX-3: fixed decimals per dimension, H:MM:SS truncated', () => {
  const d = U.DIMS;
  assert.strictEqual(U.format('ground_speed', d.ground_speed.units[0], 1852 / 3600 * 134.835), '134.84');
  assert.strictEqual(U.format('altitude', d.altitude.units[1], 0.3048 * 4816.6), '4817');
  assert.strictEqual(U.format('duration', d.duration.units[3], 2571.99), '0:42:51');
  assert.strictEqual(U.format('time', d.time.units[0], 86400 + 3600), '01:00:00');
  assert.strictEqual(U.format('angle', d.angle.units[0], 359.6), '360');
  assert.strictEqual(U.format('angle', d.angle.units[0], 0), '0');
  assert.strictEqual(U.format('mach', d.mach.units[0], 0.2361), '0.236');
  assert.strictEqual(U.format('ratio', d.ratio.units[0], 30.38), '30.4');
  assert.strictEqual(U.format('distance', d.distance.units[0], 1852 * 123456789), '123456789');
});

test('H:M:S entry fills in its colons', () => {
  let b = '';
  for (const c of '143000') b = U.hmsType(b, c);
  assert.strictEqual(b, '14:30:00');
  b = '';
  for (const c of '1:5') b = U.hmsType(b, c);
  assert.strictEqual(b, '01:5');
});

test('weight and balance: removed item slots stay in place and the totals skip them', () => {
  Md.reset();
  enter('rf', '', 1);
  enter('wbw0', 'LBS', 1500); enter('wba0', 'IN', 40);
  Md.wbAdd(1); enter('wbw1', 'LBS', 170); enter('wba1', 'IN', 37);
  assert.strictEqual(shown('wbcg', 'IN'), '39.69');          // (60000 + 6290) ÷ 1670
  Md.wbRemove(1);
  assert.strictEqual(shown('wbtw', 'LBS'), '1500.00');
  const heads = Md.screenRows('wb').filter(r => r.h).map(r => r.h + ':' + r.act);
  assert.deepStrictEqual(heads, ['ITEM 1:Remove', 'ITEM 2:Add', 'TOTALS:undefined']);
});

test('trip planner: a new leg copies the previous inputs and departs at its ETA', () => {
  Md.reset();
  Md.legAdd();
  enter('l0dist', 'NM', 100); enter('l0tc', '°', 90); enter('l0tas', 'KTS', 120);
  enter('l0wdir', '°', 270); enter('l0wspd', 'KTS', 20); enter('l0var', '°', 5); enter('l0dev', '°', 2);
  enter('l0frate', 'US GPH', 9); enter('l0dep', 'UTC', 12 * 3600);
  Md.legAdd();
  assert.ok(V.l1dist.copied && !V.l1dist.computed);
  assert.ok(V.l1dep.computed);
  assert.strictEqual(shown('l1dep', 'UTC'), '12:42:51');
  assert.strictEqual(shown('tete', 'HMS'), '1:25:42');
  assert.strictEqual(shown('tfuel', 'US GAL'), '12.86');
});

test(`${SCENARIOS.length} random key scenarios match ASA's CX-3 emulator`, () => {
  let checked = 0;
  SCENARIOS.forEach((sc, i) => {
    if (sc.quirk) return;
    assert.deepStrictEqual(replay(sc), sc.expect, `scenario ${i} (${sc.screen}): ${JSON.stringify(sc.steps)}`);
    checked++;
  });
  assert.ok(checked > 500);
});
