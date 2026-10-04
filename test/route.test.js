/* Route helper: magnetic variation (WMM2025), FB decoding and interpolation,
 * Open-Meteo interpolation, route geometry and leg planning. */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const WMM = require('../js/wmm.js');
const Winds = require('../js/winds.js');
const Nav = require('../js/nav.js');
const Route = require('../js/route.js');
const openMeteo = require('./fixtures/open-meteo.js');
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test('WMM2025 declination matches an independent implementation (geomagnetism 0.2.0)', () => {
  const d = new Date('2026-10-04T00:00:00Z');
  for (const [la, lo, want] of [[38.8181, -92.2196, -0.5988], [37.619, -122.375, 12.7947], [40.0801, 116.5846, -7.6534],
                                [51.4706, -0.4619, 1.0996], [-33.9461, 151.1772, 12.8468], [85, 130, 26.5934]]) {
    near(WMM.declination(la, lo, 0, d), want, 0.001, `declination at ${la},${lo}`);
  }
});

test('FB codes decode as published', () => {
  assert.deepStrictEqual(Winds.decodeFB('2715-07'), { dir: 270, spd: 15, temp: -7 });
  assert.deepStrictEqual(Winds.decodeFB('2107+15'), { dir: 210, spd: 7, temp: 15 });
  assert.deepStrictEqual(Winds.decodeFB('1307'), { dir: 130, spd: 7, temp: null });
  assert.deepStrictEqual(Winds.decodeFB('9900+11'), { dir: null, spd: 0, temp: 11 });   // light and variable
  assert.deepStrictEqual(Winds.decodeFB('7325'), { dir: 230, spd: 125, temp: null });    // 100 kt or more
  assert.deepStrictEqual(Winds.decodeFB('264136'), { dir: 260, spd: 41, temp: -36 });   // ≥ 30,000 ft: minus implied
  assert.strictEqual(Winds.decodeFB(''), null);
});

const FB = Winds.parseFB(fs.readFileSync(path.join(__dirname, 'fixtures/fb06.txt'), 'utf8'), Date.UTC(2026, 9, 3, 20));

test('FB product: header times, levels and fixed-width columns', () => {
  assert.strictEqual(new Date(FB.valid).toISOString(), '2026-10-04T00:00:00.000Z');
  assert.strictEqual(new Date(FB.useFrom).toISOString(), '2026-10-03T20:00:00.000Z');
  assert.strictEqual(new Date(FB.useTo).toISOString(), '2026-10-04T03:00:00.000Z');
  assert.deepStrictEqual(FB.levels, [3000, 6000, 9000, 12000, 18000, 24000, 30000, 34000, 39000]);
  // ABQ reports nothing at 3000 and 6000 (station elevation)
  assert.deepStrictEqual(FB.stations.ABQ.v.slice(0, 3), [null, null, { dir: 60, spd: 9, temp: 14 }]);
});

test('FB station value between levels: wind vectors and temperature interpolated', () => {
  // COU 6000: 2107+15, 9000: 2206+10 → 7500 ft halfway
  const w = Winds.stationAt(FB.stations.COU, FB.levels, 7500);
  near(w.temp, 12.5, 1e-9, 'temperature');
  near(w.dir, 215, 1, 'direction');
  near(w.spd, 6.5, 0.1, 'speed');
  // below the lowest temperature level: standard lapse from 6000 ft
  near(Winds.stationAt(FB.stations.COU, FB.levels, 5500).temp, 16, 1e-9, 'temperature at 5500');
});

test('FB at a point uses the nearest stations, the right period, and gives the raw lines', () => {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/winds-fb.json'), 'utf8'));
  const w = Winds.fbAt(data, 38.8108, -92.2183, 6000, Date.UTC(2026, 9, 3, 22));   // on top of COU
  assert.strictEqual(w.source, 'FB');
  assert.deepStrictEqual(w.stations.map(s => s.id), ['COU']);
  near(w.dir, 210, 1e-9, 'direction'); near(w.spd, 7, 1e-9, 'speed'); assert.strictEqual(w.temp, 15);
  assert.ok(w.stations[0].raw.startsWith('COU 1307 2107+15'));
  assert.strictEqual(Route.fbCovers(data, Date.UTC(2026, 9, 4, 12)), false);
});

test('model wind interpolated to the altitude by geopotential height', () => {
  const loc = openMeteo(1);
  const w = Winds.modelAt(loc, 5500, Date.UTC(2026, 9, 4, 10, 20));
  assert.strictEqual(w.source, 'Model');
  near(w.dir, 270, 1e-9, 'direction'); near(w.spd, 20, 1e-9, 'speed');
  near(w.temp, 15 - 0.0065 * 5500 * 0.3048, 0.01, 'temperature');
  assert.strictEqual(new Date(w.time).toISOString(), '2026-10-04T10:00:00.000Z');
  // 12,000 ft (3658 m) lies between 700 hPa (3010 m, 20 kt) and 600 hPa (4210 m, 30 kt)
  near(Winds.modelAt(loc, 12000, Date.UTC(2026, 9, 4, 10)).spd, 20 + 10 * (3657.6 - 3010) / 1200, 0.01, 'speed at 12000');
  assert.strictEqual(Winds.modelAt(loc, 5500, Date.UTC(2026, 9, 9)), null);          // outside the forecast
  assert.ok(Winds.modelURL([[38.9, -92.7]]).includes('wind_speed_850hPa'));
});

test('coordinates in the common formats', () => {
  assert.deepStrictEqual(Nav.parseCoord('38.82/-92.22'), [38.82, -92.22]);
  const a = Nav.parseCoord('N3849.1W09213.1'), b = Nav.parseCoord('3849N09213W');
  near(a[0], 38.8183, 1e-4, 'lat'); near(a[1], -92.2183, 1e-4, 'lon');
  near(b[0], 38.8167, 1e-4, 'lat'); near(b[1], -92.2167, 1e-4, 'lon');
  assert.strictEqual(Nav.parseCoord('KCOU'), null);
});

test('KCOU → KMHL: true course, distance, variation; leg plan with a known wind', () => {
  const pts = [{ id: 'KCOU', lat: 38.8181, lon: -92.2196 }, { id: 'KMHL', lat: 39.0958, lon: -93.2029 }];
  const r = Nav.rhumb([pts[0].lat, pts[0].lon], [pts[1].lat, pts[1].lon]);
  near(r.tc, 289.9, 0.1, 'true course'); near(r.dist, 48.9, 0.1, 'distance');
  const p = Route.plan(pts, { alt: 5500, dep: Date.UTC(2026, 9, 4, 10), tas: 110, frate: 8.5, source: 'model' },
                       { fb: null, model: [openMeteo(1)] });
  const g = p.legs[0];
  near(g.decl, WMM.declination(g.mid[0], g.mid[1], 5500, new Date(Date.UTC(2026, 9, 4, 10))), 1e-9, 'variation at the midpoint');
  assert.ok(g.decl < 0 && g.decl > -1, 'a little west in central Missouri');
  near(g.mc, r.tc - g.decl, 1e-9, 'magnetic course');
  // what goes into PLAN: whole degrees and knots, tenths of a mile, Var west +
  assert.deepStrictEqual(g.k, { dist: Math.round(r.dist * 10) / 10, tc: 290, wdir: 270, wspd: 20, varW: 0, dev: 0 });
  // the CX-3 result for those keyed values: 270° at 20 kt on a 290° course, TAS 110
  const wca = Math.asin(20 * Math.sin(-20 * Math.PI / 180) / 110) * 180 / Math.PI;
  const th = 290 + wca, gsx = 110 * Math.sin(th * Math.PI / 180) + 20 * Math.sin(90 * Math.PI / 180), gsy = 110 * Math.cos(th * Math.PI / 180);
  const gs = Math.hypot(gsx, gsy) / 3600 * 1852;                                // m/s
  near(g.cx.wca, wca, 1e-6, 'WCA'); near(g.cx.th, th, 1e-6, 'TH'); near(g.cx.mh, th, 1e-6, 'MH (Var 0)');
  near(g.cx.gs, gs, 1e-6, 'GS');
  near(g.cx.ete, g.k.dist * 1852 / gs, 1e-6, 'ETE (s)');
  near(g.cx.eta, 10 * 3600 + g.k.dist * 1852 / gs, 1e-6, 'ETA (s of day)');
  near(g.cx.fuel, 8.5 * 3.7854118 * g.k.dist * 1852 / gs / 3600, 1e-6, 'fuel (L)');
  assert.strictEqual(p.total.timed, true);
});

test('keyed values round half away from zero and wrap 360 to 0', () => {
  const k = Route.keyed({ dist: 12.345, tc: 359.6 }, { dir: 0.4, spd: 7.5 }, 0.5);
  assert.deepStrictEqual(k, { dist: 12.3, tc: 0, wdir: 0, wspd: 8, varW: -1, dev: 0 });
  assert.strictEqual(Route.keyed({ dist: 1, tc: 10 }, { dir: null, spd: 0 }, -0.4).varW, 0);   // never −0
  assert.strictEqual(Route.keyed({ dist: 1, tc: 10 }, null, 13.1).varW, -13);                 // east: minus
});

test('a wind stronger than the TAS has no heading', () => {
  assert.strictEqual(Route.triangle(90, 50, { dir: 180, spd: 60 }), null);
});
