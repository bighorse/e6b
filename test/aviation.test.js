'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../js/aviation.js');
const U = require('../js/units.js');
const { FNS, MENUS } = require('../js/functions.js');

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} !≈ ${b} (±${tol})`);

test('pressure altitude', () => {
  near(A.pressureAltitude(5000, 29.92), 5000, 2);
  near(A.pressureAltitude(5000, 30.12), 4817, 5);
  near(A.pressureAltitude(0, 28.92), 940, 15);
});

test('density altitude', () => {
  near(A.densityAltitude(0, 15), 0, 1);
  near(A.densityAltitude(5000, 5.1), 5000, 15);
  near(A.densityAltitude(5000, 25), 7262, 20);
});

test('standard atmosphere', () => {
  const s = A.stdAtmosphere(10000);
  near(s.temp, -4.81, 0.01); near(s.press, 20.58, 0.01);
  const t = A.stdAtmosphere(40000);
  near(t.temp, -56.5, 0.01); near(t.press, 5.54, 0.01);
});

test('true airspeed', () => {
  near(A.plannedTas(0, 15, 150).tas, 150, 0.2);
  near(A.plannedTas(8000, 0, 150).tas, 169, 1);
  const at = A.actualTas(35000, -30, 250);
  near(at.mach, 0.741, 0.002); near(at.oat, -54.1, 0.3);
});

test('wind triangle round trip', () => {
  const w = A.windTriangle(90, 120, 45, 20);
  near(w.wca, -6.77, 0.01); near(w.thdg, 83.2, 0.1); near(w.gs, 105.0, 0.1);
  const u = A.unknownWind(w.gs, 120, 90, w.thdg);
  near(u.wspd, 20, 1e-6); near(u.wdir, 45, 1e-6);
  assert.equal(A.windTriangle(90, 50, 0, 80), null);
});

test('wind components', () => {
  const c = A.windComponents(360, 30, 20);
  near(c.head, 17.32, 0.01); near(c.cross, 10, 0.01);
  near(A.windComponents(90, 270, 10).head, -10, 1e-9);
});

test('rhumb line', () => {
  const r = A.rhumbLine(0, 0, 0, 1);
  near(r.dist, 60.04, 0.05); near(r.tcrs, 90, 1e-6);
  const n = A.rhumbLine(10, 20, 11, 20);
  near(n.dist, 60.04, 0.05); assert.equal(Math.round(n.tcrs), 360);
});

test('holding entries (AIM 5-3-8)', () => {
  const e = (h, r = true) => A.holdingEntry(360, h, r);
  assert.equal(e(90), 'Direct'); assert.equal(e(0), 'Direct'); assert.equal(e(300), 'Direct');
  assert.equal(e(150), 'Teardrop'); assert.equal(e(250), 'Parallel');
  assert.equal(e(210, false), 'Teardrop'); assert.equal(e(110, false), 'Parallel'); assert.equal(e(270, false), 'Direct');
  const h = A.holding(360, 90, true);
  assert.equal(h.outHdg, 180); assert.equal(h.tearHdg, 150);
});

test('unit conversions are reversible', () => {
  for (const [type, list] of Object.entries(U.TYPES)) {
    for (const u of list) near(u.toBase(u.fromBase(123.456)), 123.456, 1e-9, `${type}/${u.name}`);
  }
  near(U.TYPES.temp[1].fromBase(100), 212, 1e-9);
  near(U.TYPES.press[1].fromBase(29.92), 1013.2, 0.1);
  near(U.TYPES.dist[1].fromBase(100), 115.08, 0.01);
});

test('every menu item points at a real function or menu', () => {
  for (const m of Object.values(MENUS)) {
    for (const it of m.items) {
      if (it.fn) assert.ok(FNS[it.fn], it.fn);
      if (it.menu) assert.ok(MENUS[it.menu], it.menu);
    }
  }
});

test('function calcs', () => {
  assert.equal(FNS.fburn.calc({ rate: 10, time: 1.5 }).fuel, 15);
  assert.equal(FNS.gs.calc({ dist: 150, time: 1.25 }).gs, 120);
  near(FNS.eta.calc({ dist: 100, gs: 120, dep: 14.5 }).eta, 14.5 + 100 / 120, 1e-9);
  const ch = FNS.cmphdg.calc({ tcrs: 90, tas: 120, wdir: 45, wspd: 20, var: 10, dev: -2 });
  near(ch.mhdg, 93.2, 0.1); near(ch.chdg, 91.2, 0.1);
  const wc = FNS.windcomp.calc({ rwy: 270, wdir: 90, wspd: 10 });
  assert.equal(wc._labels.head, 'Tailwind');
  near(FNS.glide.calc({ hgt: 6076.11549, ratio: 10 }).dist, 10, 1e-6);
  near(FNS.mac.calc({ cg: 30, lemac: 20, mac: 50 }).pct, 20, 1e-9);
  near(FNS.wshift.calc({ tw: 2000, sw: 100, d: 40 }).cg, 2, 1e-9);
  near(FNS.wshift.calc({ tw: 2000, d: 40, cg: 2 }).sw, 100, 1e-9);
  near(FNS.climb.calc({ alt: 3000, gs: 120, dist: 10 }).rate, 600, 1e-9);
  // W/B totals
  const st = { wt: [null, 1500, 170], arm: [null, 85, 90] };
  const wb = FNS.wb.calc({ rf: 1 }, { n: 2, get: (id, i) => (st[id] || [])[i] ?? null });
  assert.equal(wb.twt, 1670); assert.equal(wb.tmom, 142800); near(wb.cg, 85.509, 0.001);
  assert.equal(wb['mom@1'], 127500); assert.equal(wb['mom@2'], 15300);
  const st2 = { wt: [null, 1500, 170], arm: [null, 85, null] };
  const wb2 = FNS.wb.calc({}, { n: 2, get: (id, i) => (st2[id] || [])[i] ?? null });
  assert.equal(wb2.twt, 1670); assert.equal(wb2.cg, undefined); assert.equal(wb2.tmom, undefined);
  // Flight plan per-leg outputs and totals
  const legs = { tcrs: [null, 90, 180], dist: [null, 120, 60], tas: [null, 120, 120], frate: [null, 10, 10] };
  const pl = FNS.plan.calc({}, { n: 2, get: (id, i) => (legs[id] || [])[i] ?? null });
  near(pl.tdist, 180, 1e-9); near(pl.tete, 1.5, 1e-9); near(pl.tfuel, 15, 1e-9);
  near(pl['gs@1'], 120, 1e-9); near(pl['fuel@2'], 5, 1e-9);
  // Aircraft profile
  const pr = FNS.profile.calc({ tas: 120, frate: 10, fcap: 50 });
  near(pr.endur, 5, 1e-9); near(pr.range, 600, 1e-9);
});
