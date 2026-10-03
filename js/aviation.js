/* CX-3 aviation math. All inputs/outputs use base units:
 * ft, nm, kts, ft/min, °C, inHg, gal, gal/hr, lbs, inches, hours, degrees. */
(function (root) {
  'use strict';

  var D2R = Math.PI / 180;
  var R2D = 180 / Math.PI;
  var FT_PER_NM = 6076.11549;
  var EARTH_NM = 3440.065;          // mean earth radius, nautical miles
  var P0_INHG = 29.9213;            // ISA sea level pressure
  var T0_K = 288.15;                // ISA sea level temperature
  var A0_KT = 661.4786;             // ISA sea level speed of sound
  var TROPO_FT = 36089.24;

  function norm360(a) { a = a % 360; if (a < 0) a += 360; return a; }
  function norm180(a) { a = norm360(a); return a > 180 ? a - 360 : a; }
  function dir360(a) { a = norm360(a); return a < 0.5 ? 360 : a; }  // headings show 360, not 000

  // ---------- Standard atmosphere ----------
  // Pressure ratio (delta) for a pressure altitude in feet
  function deltaAt(pa) {
    if (pa <= TROPO_FT) return Math.pow(1 - 6.8755856e-6 * pa, 5.2558797);
    return 0.2233609 * Math.exp(-4.806346e-5 * (pa - TROPO_FT));
  }
  function isaTempC(alt) { return alt <= TROPO_FT ? 15 - 0.0019812 * alt : -56.5; }
  function altFromDelta(d) {
    if (d >= 0.2233609) return (1 - Math.pow(d, 1 / 5.2558797)) / 6.8755856e-6;
    return TROPO_FT - Math.log(d / 0.2233609) / 4.806346e-5;
  }
  function altFromSigma(s) {
    if (s >= 0.2970756) return (1 - Math.pow(s, 1 / 4.2558797)) / 6.8755856e-6;
    return TROPO_FT - Math.log(s / 0.2970756) / 4.806346e-5;
  }
  function speedOfSound(tC) { return A0_KT * Math.sqrt((tC + 273.15) / T0_K); }

  function stdAtmosphere(alt) {
    var t = isaTempC(alt), d = deltaAt(alt);
    var sigma = d * T0_K / (t + 273.15);
    return { temp: t, press: d * P0_INHG, delta: d, sigma: sigma, a: speedOfSound(t) };
  }

  // ---------- Altitude ----------
  function pressureAltitude(indAlt, baro) {
    // altitude of the setting's pressure level above the 29.92 level
    return indAlt + altFromDelta(baro / P0_INHG);
  }
  function densityAltitude(pa, oat) {
    var sigma = deltaAt(pa) * T0_K / (oat + 273.15);
    return altFromSigma(sigma);
  }
  function cloudBase(temp, dewpt) {
    // convective cloud base: ~ 400 ft per °C of spread (2.5 °C / 1000 ft)
    return (temp - dewpt) / 2.5 * 1000;
  }

  // ---------- Airspeed ----------
  // Mach from calibrated airspeed and pressure altitude (subsonic, compressible)
  function machFromCas(cas, pa) {
    var qcP0 = Math.pow(1 + 0.2 * Math.pow(cas / A0_KT, 2), 3.5) - 1;
    var qcP = qcP0 / deltaAt(pa);
    return Math.sqrt(5 * (Math.pow(qcP + 1, 2 / 7) - 1));
  }
  function casFromMach(m, pa) {
    var qcP = Math.pow(1 + 0.2 * m * m, 3.5) - 1;
    var qcP0 = qcP * deltaAt(pa);
    return A0_KT * Math.sqrt(5 * (Math.pow(qcP0 + 1, 2 / 7) - 1));
  }
  // Planned TAS: from OAT (static temperature)
  function plannedTas(pa, oat, cas) {
    var m = machFromCas(cas, pa);
    return { tas: m * speedOfSound(oat), mach: m, dalt: densityAltitude(pa, oat) };
  }
  // Actual TAS: from TAT (total / indicated temperature, recovery factor kr)
  function actualTas(pa, tat, cas, kr) {
    if (kr == null) kr = 1;
    var m = machFromCas(cas, pa);
    var tK = (tat + 273.15) / (1 + 0.2 * kr * m * m);
    var oat = tK - 273.15;
    return { tas: m * speedOfSound(oat), mach: m, oat: oat, dalt: densityAltitude(pa, oat) };
  }

  // ---------- Wind ----------
  // Wind triangle: course + wind → heading and ground speed
  function windTriangle(tcrs, tas, wdir, wspd) {
    var rel = (wdir - tcrs) * D2R;
    var s = wspd * Math.sin(rel) / tas;
    if (Math.abs(s) > 1) return null;                    // wind exceeds TAS
    var wca = Math.asin(s) * R2D;
    var gs = tas * Math.cos(wca * D2R) - wspd * Math.cos(rel);
    if (gs <= 0) return null;
    return { wca: wca, thdg: dir360(tcrs + wca), gs: gs };
  }
  // Unknown wind: from track/GS and heading/TAS
  function unknownWind(gs, tas, tcrs, thdg) {
    // wind vector (blowing toward) = ground vector - air vector
    var gx = gs * Math.sin(tcrs * D2R), gy = gs * Math.cos(tcrs * D2R);
    var ax = tas * Math.sin(thdg * D2R), ay = tas * Math.cos(thdg * D2R);
    var wx = gx - ax, wy = gy - ay;
    var spd = Math.sqrt(wx * wx + wy * wy);
    var to = Math.atan2(wx, wy) * R2D;
    return { wspd: spd, wdir: spd < 1e-9 ? 0 : dir360(to + 180), wca: norm180(thdg - tcrs) };
  }
  // Head/tail and cross wind components. head > 0 = headwind, cross > 0 = from the right
  function windComponents(rwy, wdir, wspd) {
    var a = (wdir - rwy) * D2R;
    return { head: wspd * Math.cos(a), cross: wspd * Math.sin(a) };
  }

  /* General wind triangle solver (ground vector = air vector + wind vector).
   * k holds any of gs, tas, tcrs, thdg, wspd, wdir (null = unknown). With exactly
   * four known it returns the two missing values, or {error}; null when the
   * combination is not solvable uniquely (TCrs and THdg both unknown, or a wind
   * part mixed with another unknown). */
  function windSolve(k) {
    var keys = ['gs', 'tas', 'tcrs', 'thdg', 'wspd', 'wdir'];
    var miss = keys.filter(function (x) { return k[x] == null; });
    if (miss.length !== 2) return null;
    var m = miss.join(',');
    function vx(spd, dir) { return spd * Math.sin(dir * D2R); }
    function vy(spd, dir) { return spd * Math.cos(dir * D2R); }
    function polar(x, y) { var s = Math.sqrt(x * x + y * y); return { s: s, d: s < 1e-9 ? 0 : dir360(Math.atan2(x, y) * R2D) }; }
    // wind vector points the way the wind blows (from wdir toward wdir + 180)
    var wx = k.wspd != null ? vx(k.wspd, k.wdir + 180) : 0, wy = k.wspd != null ? vy(k.wspd, k.wdir + 180) : 0;
    if (m === 'wspd,wdir') {
      var u = unknownWind(k.gs, k.tas, k.tcrs, k.thdg);
      return { wspd: u.wspd, wdir: u.wdir };
    }
    if (m === 'gs,thdg') {
      var w = windTriangle(k.tcrs, k.tas, k.wdir, k.wspd);
      return w ? { thdg: w.thdg, gs: w.gs } : { error: 'Wind > TAS' };
    }
    if (m === 'gs,tcrs') {
      var g = polar(vx(k.tas, k.thdg) + wx, vy(k.tas, k.thdg) + wy);
      return { gs: g.s, tcrs: g.d };
    }
    if (m === 'tas,thdg') {
      var a = polar(vx(k.gs, k.tcrs) - wx, vy(k.gs, k.tcrs) - wy);
      return { tas: a.s, thdg: a.d };
    }
    if (m === 'gs,tas') {
      // gs·g − tas·a = w, with g, a unit vectors along TCrs and THdg (Cramer's rule)
      var gx = Math.sin(k.tcrs * D2R), gy = Math.cos(k.tcrs * D2R);
      var ax = Math.sin(k.thdg * D2R), ay = Math.cos(k.thdg * D2R);
      var det = -gx * ay + ax * gy;
      if (Math.abs(det) < 1e-9) return { error: 'No Solution' };
      var gs = (-wx * ay + ax * wy) / det, tas = (gx * wy - gy * wx) / det;
      if (gs <= 0 || tas <= 0) return { error: 'No Solution' };
      return { gs: gs, tas: tas };
    }
    return null;
  }

  // ---------- Navigation ----------
  function rhumbLine(lat1, lon1, lat2, lon2) {
    var p1 = lat1 * D2R, p2 = lat2 * D2R;
    var dp = p2 - p1;
    var dl = norm180(lon2 - lon1) * D2R;
    var dpsi = Math.log(Math.tan(Math.PI / 4 + p2 / 2) / Math.tan(Math.PI / 4 + p1 / 2));
    var q = Math.abs(dpsi) > 1e-12 ? dp / dpsi : Math.cos(p1);
    var dist = Math.sqrt(dp * dp + q * q * dl * dl) * EARTH_NM;
    var crs = Math.atan2(dl, dpsi) * R2D;
    return { dist: dist, tcrs: dist < 1e-9 ? 0 : dir360(crs) };
  }
  function reciprocal(c) { return dir360(c + 180); }

  // Holding pattern entry (AIM 5-3-8). inbd = inbound course to the fix,
  // hdg = aircraft heading on arrival at the fix, right = true for standard right turns
  function holdingEntry(inbd, hdg, right) {
    var d = norm360(hdg - inbd);
    if (!right) d = norm360(360 - d);
    if (d <= 110 || d >= 290) return 'Direct';
    if (d <= 180) return 'Teardrop';
    return 'Parallel';
  }
  function holding(inbd, hdg, right, tas, wdir, wspd) {
    var out = norm360(inbd + 180);
    var r = {
      entry: holdingEntry(inbd, hdg, right),
      inHdg: dir360(inbd), outHdg: dir360(out),
      tearHdg: dir360(right ? out - 30 : out + 30), wca: 0
    };
    if (tas > 0 && wspd != null && wdir != null) {
      var w = windTriangle(inbd, tas, wdir, wspd);
      if (w) {
        r.wca = w.wca;
        r.inHdg = w.thdg;
        r.outHdg = dir360(out - 3 * w.wca);   // triple the drift outbound
        r.tearHdg = dir360((right ? out - 30 : out + 30) - 3 * w.wca);
      }
    }
    return r;
  }

  // ---------- Climb / descent / glide ----------
  function gradToAngle(ftPerNm) { return Math.atan(ftPerNm / FT_PER_NM) * R2D; }

  var Aviation = {
    FT_PER_NM: FT_PER_NM, EARTH_NM: EARTH_NM,
    norm360: norm360, norm180: norm180, dir360: dir360,
    deltaAt: deltaAt, isaTempC: isaTempC, stdAtmosphere: stdAtmosphere, speedOfSound: speedOfSound,
    pressureAltitude: pressureAltitude, densityAltitude: densityAltitude, cloudBase: cloudBase,
    machFromCas: machFromCas, casFromMach: casFromMach, plannedTas: plannedTas, actualTas: actualTas,
    windTriangle: windTriangle, unknownWind: unknownWind, windSolve: windSolve, windComponents: windComponents,
    rhumbLine: rhumbLine, reciprocal: reciprocal,
    holdingEntry: holdingEntry, holding: holding, gradToAngle: gradToAngle
  };
  root.Aviation = Aviation;
  if (typeof module !== 'undefined') module.exports = Aviation;
})(typeof window !== 'undefined' ? window : globalThis);
