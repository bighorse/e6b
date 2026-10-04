/* CX-3 variables, equations and screens.
 * Base units: m, m/s, s (time of day for clock values), K, mb, L, kg, kg·m,
 * degrees; climb angle in m/m; ratio, mach and RF are plain numbers. */
(function (root) {
  'use strict';
  var Engine = root.Engine || require('./engine.js');

  // --- physical constants (US Standard Atmosphere 1976)
  var G = 9.80665, MOL = 0.0289644, RGAS = 8.31432, LAPSE = 0.0065;
  var GMRL = G * MOL / (RGAS * LAPSE), T0 = 288.15, P0 = 1013.25, GAMMA = 1.4;
  var T0L = T0 / LAPSE, GRM = GAMMA * RGAS / MOL, CS0 = Math.sqrt(GRM * T0);
  var D2R = Math.PI / 180, R2D = 180 / Math.PI, DAY = 86400;
  var NM_PER_RAD = 60 * 180 / Math.PI;           // rhumb line: one minute of arc = 1 NM
  var LAYERS = [ // base height m, base pressure mb, base temperature K, lapse K/m
    [0, 1013.25, 288.15, -0.0065], [11000, 226.321, 216.65, 0], [20000, 54.7489, 216.65, 0.001],
    [32000, 8.68019, 228.65, 0.0028], [47000, 1.10906, 270.65, 0], [51000, 0.669389, 270.65, -0.0028],
    [71000, 0.0395642, 214.65, -0.002], [84852, 0.0037338, 0, 0]];

  function n360(a) { a %= 360; return a < 0 ? a + 360 : a; }
  function n180(a) { a = n360(a); return a > 180 ? a - 360 : a; }
  function sq(x) { return x * x; }

  // ---------------------------------------------------------- atmosphere
  function hFromBaro(p) { return T0L * (1 - Math.pow(p / P0, 1 / GMRL)); }
  function pFromPalt(h) { return P0 * Math.pow(1 - h / T0L, GMRL); }
  function layerOf(h) { for (var i = 0; i < LAYERS.length - 1; i++) if (h >= LAYERS[i][0] && h < LAYERS[i + 1][0]) return LAYERS[i]; return null; }
  function stdTemp(h) { var l = layerOf(h); return l ? l[2] + l[3] * (h - l[0]) : NaN; }
  function stdPress(h) {
    var l = layerOf(h); if (!l) return NaN;
    if (l[3]) return l[1] * Math.pow(l[2] / stdTemp(h), G * MOL / (RGAS * l[3]));
    return l[1] * Math.exp(-G * MOL * (h - l[0]) / (RGAS * l[2]));
  }
  function stdAlt(p) {
    for (var i = 0; i < LAYERS.length - 1; i++) {
      var l = LAYERS[i];
      if (p <= l[1] && p > LAYERS[i + 1][1]) {
        if (l[3]) return l[2] / l[3] * (Math.pow(p / l[1], -RGAS * l[3] / (G * MOL)) - 1) + l[0];
        return RGAS * l[2] * Math.log(p / l[1]) / (-G * MOL) + l[0];
      }
    }
    return NaN;
  }
  function sound(t) { return Math.sqrt(GRM * t); }

  // ---------------------------------------------------------- wind vectors
  // a vector of speed s toward direction d (degrees true): [east, north]
  function vec(s, d) { return [s * Math.sin(d * D2R), s * Math.cos(d * D2R)]; }
  function wind(ws, wd) { return vec(ws, wd + 180); }          // wind blows from wd
  function mag(v) { return Math.sqrt(v[0] * v[0] + v[1] * v[1]); }
  function dirOf(v) { return n360(Math.atan2(v[0], v[1]) * R2D); }

  // ---------------------------------------------------------- rhumb line
  function dphi(l1, l2) { return Math.log(Math.tan(l2 / 2 + Math.PI / 4) / Math.tan(l1 / 2 + Math.PI / 4)); }
  function mod(y, x) { var m = y - x * Math.floor(y / x); return m < 0 ? m + x : m; }
  // latitudes +N, longitudes +W (as on the CX-3)
  function rhumbCourse(la1, lo1, la2, lo2) {
    la1 *= D2R; lo1 *= D2R; la2 *= D2R; lo2 *= D2R;
    var w = mod(lo2 - lo1, 2 * Math.PI), e = mod(lo1 - lo2, 2 * Math.PI), dp = dphi(la1, la2);
    var q = w < e ? Math.atan2(-w, dp) : Math.atan2(e, dp);
    return mod(q, 2 * Math.PI) * R2D;
  }
  function rhumbDist(la1, lo1, la2, lo2) {
    la1 *= D2R; lo1 *= D2R; la2 *= D2R; lo2 *= D2R;
    var w = mod(lo2 - lo1, 2 * Math.PI), e = mod(lo1 - lo2, 2 * Math.PI);
    var q = Math.abs(la2 - la1) < 1e-8 ? Math.cos(la1) : (la2 - la1) / dphi(la1, la2);
    var dl = Math.min(w, e);
    return Math.sqrt(q * q * dl * dl + sq(la2 - la1)) * NM_PER_RAD * 1852;
  }
  function rhumbLat(la1, lo1, tc, d) {
    var lat = la1 * D2R + d / 1852 / NM_PER_RAD * Math.cos(tc * D2R);
    return Math.abs(lat) > Math.PI / 2 ? Infinity : lat * R2D;
  }
  function rhumbLon(la1, lo1, tc, d) {
    var r = d / 1852 / NM_PER_RAD, l1 = la1 * D2R, l2 = l1 + r * Math.cos(tc * D2R);
    if (Math.abs(l2) > Math.PI / 2) return Infinity;
    var q = Math.abs(l2 - l1) < 1e-8 ? Math.cos(l1) : (l2 - l1) / dphi(l1, l2);
    var lon = mod(lo1 * D2R - r * Math.sin(tc * D2R) / q + Math.PI, 2 * Math.PI) - Math.PI;
    return lon * R2D;
  }

  var M = new Engine.Model();
  function V(id, label, dim, o) { return M.v(id, label, dim, o); }
  function E(out, ins, fn) { return M.eq(out, ins, fn); }

  // ================================================================ variables
  // Shared by several screens, exactly like the CX-3 (a Dist entered on
  // Ground Speed is the Dist on Glide and on Climb & Descent).
  var Dist = V('dist', 'Dist', 'distance'), Dur = V('dur', 'Dur', 'duration'), GS = V('gs', 'GS', 'ground_speed');
  var IAlt = V('ialt', 'IAlt', 'altitude'), Baro = V('baro', 'Baro', 'pressure'), PAlt = V('palt', 'PAlt', 'altitude');
  var DAlt = V('dalt', 'DAlt', 'altitude'), OAT = V('oat', 'OAT', 'temperature');
  var TAS = V('tas', 'TAS', 'air_speed'), MACH = V('mach', 'MACH', 'mach'), TAT = V('tat', 'TAT', 'temperature');
  var CAS = V('cas', 'CAS', 'air_speed'), K = V('k', 'K', 'calibration', { ro: true });
  var Dewp = V('dewp', 'Dewp', 'temperature'), AGL = V('agl', 'AGL', 'altitude');
  var SAlt = V('salt', 'Alt', 'altitude'), SBaro = V('sbaro', 'Baro', 'pressure'), SOAT = V('soat', 'OAT', 'temperature', { ro: true });
  var Vol = V('vol', 'Vol', 'volume'), Rate = V('rate', 'Rate', 'fuel_rate'), Wt = V('fwt', 'Wt', 'weight');
  var WRate = V('wrate', 'Rate', 'fuel_wt_rate'), FType = V('ftype', 'Type', 'fuel_type', { choice: true });
  var Rat = V('rat', 'Rat', 'ratio'), Desc = V('desc', 'Desc', 'altitude');
  var RoC = V('roc', 'RoC/D', 'climb_rate'), AoC = V('aoc', 'AoC/D', 'climb_angle');
  var WSpd = V('wspd', 'WSpd', 'air_speed'), WDir = V('wdir', 'WDir', 'angle'), Rwy = V('rwy', 'Runway', 'runway');
  var XWnd = V('xwnd', 'X Wnd', 'air_speed', { ro: true }), HWnd = V('hwnd', 'H Wnd', 'air_speed', { ro: true });
  var Dep = V('dep', 'Dep', 'time'), ETA = V('eta', 'ETA', 'time');
  var From = V('from', 'From', 'angle'), To = V('to', 'To', 'angle');
  var THdg = V('thdg', 'THdg', 'angle'), Var = V('var', 'Var', 'angle_180'), MHdg = V('mhdg', 'MHdg', 'angle', { ro: true });
  var Dev = V('dev', 'Dev', 'angle_180'), CHdg = V('chdg', 'CHdg', 'angle');
  var TCrs = V('tcrs', 'TCrs', 'angle'), WCA = V('wca', 'WCA', 'angle_180', { ro: true });
  var Turn = V('turn', 'Turn Dir', 'turn_dir', { choice: true }), Head = V('head', 'Head', 'angle');
  var Hold = V('hold', 'Hold', 'angle'), Entry = V('entry', 'Entry', 'entry', { ro: true });
  var Inbound = V('inbd', 'Inbound', 'angle', { ro: true });

  // ================================================================ equations
  // (created in the CX-3's order: the order decides which result wins)
  // Ground Speed
  E(GS, [Dist, Dur], function (d, t) { return d / t; });
  E(Dist, [GS, Dur], function (s, t) { return s * t; });
  E(Dur, [Dist, GS], function (d, s) { return d / s; });
  // Altitude
  E(IAlt, [Baro, PAlt], function (b, p) { return p - hFromBaro(b); });
  E(Baro, [IAlt, PAlt], function (i, p) { return P0 * Math.pow(1 - (p - i) / T0L, GMRL); });
  E(PAlt, [IAlt, Baro], function (i, b) { return i + hFromBaro(b); });
  E(DAlt, [PAlt, OAT], function (p, t) {
    var x = T0 / t * Math.pow(1 - LAPSE * p / T0, GMRL);
    return T0L * (1 - Math.pow(x, 1 / (GMRL - 1)));
  });
  E(PAlt, [DAlt, OAT], function (d, t) {
    var x = t / T0 * Math.pow(1 - d * LAPSE / T0, GMRL - 1);
    return T0L - T0L * Math.pow(x, 1 / GMRL);
  });
  E(OAT, [DAlt, PAlt], function (d, p) { return T0 * Math.pow(1 - LAPSE * p / T0, GMRL) / Math.pow(1 - d * LAPSE / T0, GMRL - 1); });
  // Airspeed (K = temperature probe recovery factor, from the Aircraft Profile)
  E(MACH, [TAS, OAT], function (v, t) { return v / sound(t); });
  E(OAT, [TAT, MACH, K], function (tt, m, k) { return tt / (0.2 * k * m * m + 1); });
  E(TAT, [OAT, MACH, K], function (t, m, k) { return t * (0.2 * k * m * m + 1); });
  E(OAT, [TAT, TAS, K], function (tt, v, k) { return tt - 0.2 / GRM * k * v * v; });
  E(TAT, [OAT, TAS, K], function (t, v, k) { return t + 0.2 / GRM * k * v * v; });
  E(MACH, [CAS, PAlt], function (c, h) {
    var qc = P0 * (Math.pow(1 + 0.2 * sq(c / CS0), 3.5) - 1);
    return Math.sqrt(5 * (Math.pow(qc / pFromPalt(h) + 1, 2 / 7) - 1));
  });
  E(TAS, [OAT, MACH], function (t, m) { return m * sound(t); });
  E(CAS, [PAlt, MACH], function (h, m) {
    var x = Math.pow(1 - h / T0L, GMRL), qc = Math.pow(1 + m * m / 5, 3.5) - 1;
    return CS0 * Math.sqrt(5 * (Math.pow(1 + x * qc, 2 / 7) - 1));
  });
  // Cloud Base: 2.444 °C spread per 1000 ft
  E(AGL, [OAT, Dewp], function (t, d) { return (t - d) / 2.444444 * 304.8; });
  E(OAT, [AGL, Dewp], function (a, d) { return 2.444444 * a / 304.8 + d; });
  E(Dewp, [AGL, OAT], function (a, t) { return t - 2.444444 * a / 304.8; });
  // Standard Atmosphere
  E(SBaro, [SAlt], stdPress);
  E(SOAT, [SAlt], stdTemp);
  E(SAlt, [SBaro], stdAlt);
  // Fuel
  E(Rate, [Vol, Dur], function (v, t) { return v / t; });
  E(Vol, [Rate, Dur], function (r, t) { return r * t; });
  E(Dur, [Vol, Rate], function (v, r) { return v / r; });
  E(Vol, [Wt, FType], function (w, d) { return w / d; });
  E(Wt, [Vol, FType], function (v, d) { return v * d; });
  E(WRate, [Wt, Dur], function (w, t) { return w / t; });
  E(Wt, [WRate, Dur], function (r, t) { return r * t; });
  E(Dur, [Wt, WRate], function (w, r) { return w / r; });
  // Glide
  E(Rat, [Dist, Desc], function (d, h) { return d / h; });
  E(Dist, [Rat, Desc], function (r, h) { return r * h; });
  E(Desc, [Dist, Rat], function (d, r) { return d / r; });
  // Climb & Descent
  E(Dist, [Desc, AoC], function (h, a) { return h / a; });
  E(Desc, [Dist, AoC], function (d, a) { return d * a; });
  E(AoC, [Desc, Dist], function (h, d) { return h / d; });
  E(GS, [RoC, AoC], function (r, a) { return r / a; });
  E(AoC, [RoC, GS], function (r, s) { return r / s; });
  E(RoC, [GS, AoC], function (s, a) { return s * a; });
  E(Rat, [Dist, Desc], function (d, h) { return d / h; });
  // Compass Heading (variation and deviation: west / plus)
  E(THdg, [Var, Dev, CHdg], function (v, d, c) { return n360(c - d - v); });
  E(Dev, [THdg, Var, CHdg], function (t, v, c) { return n180(c - v - t); });
  E(Var, [THdg, Dev, CHdg], function (t, d, c) { return n180(c - d - t); });
  E(CHdg, [THdg, Var, Dev], function (t, v, d) { return n360(t + v + d); });
  E(MHdg, [THdg, Var], function (t, v) { return n360(t + v); });
  // Wind Correction: ground vector = air vector + wind vector
  E(WSpd, [GS, TAS, TCrs, THdg], function (g, a, tc, th) {
    var gv = vec(g, tc), av = vec(a, th); return mag([gv[0] - av[0], gv[1] - av[1]]);
  });
  E(TAS, [GS, WSpd, WDir, TCrs], function (g, ws, wd, tc) {
    var gv = vec(g, tc), w = wind(ws, wd); return mag([gv[0] - w[0], gv[1] - w[1]]);
  });
  E(GS, [TAS, WSpd, WDir, THdg], function (a, ws, wd, th) {
    var av = vec(a, th), w = wind(ws, wd); return mag([av[0] + w[0], av[1] + w[1]]);
  });
  E(THdg, [TCrs, WDir, WSpd, TAS], function (tc, wd, ws, a) {
    var s = ws * Math.sin((wd - tc) * D2R) / a;
    return Math.abs(s) > 1 ? NaN : n360(tc + Math.asin(s) * R2D);
  });
  E(TCrs, [THdg, WDir, WSpd, GS], function (th, wd, ws, g) {
    // wind split along / across the heading; the ground vector must have length GS
    var c = ws * Math.sin((wd + 180 - th) * D2R);
    if (Math.abs(c) > g) return NaN;
    return n360(th + Math.atan2(c, Math.sqrt(g * g - c * c)) * R2D);
  });
  E(WDir, [TCrs, TAS, THdg, GS], function (tc, a, th, g) {
    var gv = vec(g, tc), av = vec(a, th), w = [gv[0] - av[0], gv[1] - av[1]];
    return mag(w) < 1e-9 ? 0 : n360(dirOf(w) + 180);
  });
  E(WCA, [THdg, TCrs], function (th, tc) { return n180(th - tc); });
  // Wind Component: + cross wind from the right, + head wind
  E(XWnd, [WSpd, WDir, Rwy], function (s, d, r) { return s * Math.sin((d - r) * D2R); });
  E(HWnd, [WSpd, WDir, Rwy], function (s, d, r) { return s * Math.cos((d - r) * D2R); });
  // Estimated Time Arrival (clock times in seconds of the day)
  E(ETA, [Dur, Dep], function (t, d) { return mod(t + d, DAY); });
  E(Dep, [Dur, ETA], function (t, e) { return mod(e - t, DAY); });
  E(Dur, [Dep, ETA], function (d, e) { return mod(e - d, DAY); });
  // To - From
  E(To, [From], function (f) { return n360(f - 180); });
  E(From, [To], function (t) { return n360(t - 180); });
  // Holding Pattern: entry from the heading to the fix and the holding radial
  E(Hold, [Inbound], function (i) { return n360(i - 180); });
  E(Inbound, [Hold], function (h) { return n360(h - 180); });
  E(Entry, [Turn, Head, Hold], function (turn, hd, hr) {
    var t = n360(hr - hd);
    if (turn === 0) return t >= 70 && t <= 250 ? 0 : t > 250 ? 1 : 2;      // right turns
    return t >= 110 && t <= 290 ? 0 : t < 110 ? 1 : 2;                       // left turns
  });

  // ---------------------------------------------------------- Unit Conversions
  var CV = [['cdist', 'Dist', 'distance_all'], ['cspd', 'Spd', 'ground_speed'], ['cdur', 'Dur', 'duration'],
    ['ctemp', 'Temp', 'temperature'], ['cpres', 'Pres', 'pressure'], ['cvol', 'Vol', 'volume'],
    ['crate', 'Rate', 'fuel_rate'], ['cwt', 'Wt', 'weight'], ['croc', 'RoC/D', 'climb_rate'],
    ['caoc', 'AoC/D', 'climb_angle'], ['ctorq', 'Torq', 'torque'], ['cang', 'Angle', 'angle_dms']]
    .map(function (c) { return V(c[0], c[1], c[2]); });

  // ---------------------------------------------------------- Rhumb Line
  // Points A-D (Lat/Long), lines AB, BC, CD (TCrs/Dist). Lines after AB are added.
  var RP = 'ABCD'.split('').map(function (p) {
    return { lat: V('lat' + p, 'Lat', 'angle_dms'), lon: V('lon' + p, 'Long', 'angle_dms') };
  });
  var RL = [0, 1, 2].map(function (i) {
    return { tc: V('rtc' + i, 'TCrs', 'angle'), d: V('rd' + i, 'Dist', 'distance') };
  });
  RL.forEach(function (l, i) {
    var a = RP[i], b = RP[i + 1];
    E(l.tc, [a.lat, a.lon, b.lat, b.lon], rhumbCourse);
    E(l.d, [a.lat, a.lon, b.lat, b.lon], rhumbDist);
    E(b.lon, [a.lat, a.lon, l.tc, l.d], rhumbLon);
    E(b.lat, [a.lat, a.lon, l.tc, l.d], rhumbLat);
  });

  // ---------------------------------------------------------- Weight and Balance
  var MAX_ITEMS = 8;
  var RF = V('rf', 'RF', 'number');
  var WB = [];
  for (var i = 0; i < MAX_ITEMS; i++) {
    WB.push({ wt: V('wbw' + i, 'Wt', 'weight'), arm: V('wba' + i, 'Arm', 'length'), mom: V('wbm' + i, 'Mom', 'torque') });
  }
  var TWt = V('wbtw', 'Wt', 'weight', { ro: true }), TMom = V('wbtm', 'Mom', 'torque', { ro: true });
  var CG = V('wbcg', 'CG', 'length', { ro: true });
  WB.forEach(function (it) {
    E(it.wt, [RF, it.mom, it.arm], function (rf, m, a) { return rf * m / a; });
    E(it.mom, [RF, it.wt, it.arm], function (rf, w, a) { return w * a / rf; });
    E(it.arm, [RF, it.mom, it.wt], function (rf, m, w) { return rf * m / w; });
  });
  // eight item slots; a removed slot stays in place and shows "Add"
  var wbState = { on: [true, false, false, false, false, false, false, false] };
  function activeItems() { return WB.filter(function (x, j) { return wbState.on[j]; }); }
  // totals: every item in use must have its value
  var eTWt = E(TWt, WB.map(function (x) { return x.wt; }), function () {
    return activeItems().reduce(function (s, x) { return s + x.wt.v; }, 0);
  });
  var eTMom = E(TMom, WB.map(function (x) { return x.mom; }), function () {
    return activeItems().reduce(function (s, x) { return s + x.mom.v; }, 0);
  });
  eTWt.canCompute = function () { return activeItems().every(function (x) { return x.wt.has; }); };
  eTMom.canCompute = function () { return activeItems().every(function (x) { return x.mom.has; }); };
  E(CG, [RF, TMom, TWt], function (rf, m, w) { return rf * m / w; });

  // Weight Shift Formula: Item Wt × ΔArm = Total Wt × ΔCG
  var SIW = V('siw', 'Item Wt', 'weight'), STW = V('stw', 'Total Wt', 'weight');
  var DCG = V('dcg', '∆CG', 'length'), DArm = V('darm', '∆Arm', 'length');
  E(DArm, [SIW, STW, DCG], function (w, t, c) { return t * c / w; });
  E(DCG, [SIW, STW, DArm], function (w, t, a) { return w * a / t; });
  E(SIW, [DArm, STW, DCG], function (a, t, c) { return t * c / a; });
  E(STW, [SIW, DArm, DCG], function (w, a, c) { return w * a / c; });

  // % MAC
  var MAC = V('mac', 'MAC', 'length'), MCG = V('mcg', 'CG', 'length'), LMAC = V('lmac', 'LMAC', 'length');
  var PMAC = V('pmac', '%MAC', 'percent');
  E(PMAC, [MAC, MCG, LMAC], function (m, c, l) { return (c - l) / m; });
  E(MAC, [PMAC, MCG, LMAC], function (p, c, l) { return (c - l) / p; });
  E(MCG, [PMAC, MAC, LMAC], function (p, m, l) { return p * m + l; });
  E(LMAC, [PMAC, MAC, MCG], function (p, m, c) { return c - p * m; });

  // ---------------------------------------------------------- Aircraft Profile
  var PK = V('pk', 'K', 'calibration'), PValid = V('pvalid', 'Profile Valid', 'on_off', { choice: true });
  var PRF = V('prf', 'RF', 'number'), PWt = V('pwt', 'Wt', 'weight'), PArm = V('parm', 'Arm', 'length');
  var PMom = V('pmom', 'Mom', 'torque');
  var PFType = V('pftype', 'Type', 'fuel_type', { choice: true }), PFArm = V('pfarm', 'Arm', 'length');
  var PFAux = V('pfaux', 'Fuel Aux', 'length');
  var SEATS = ['Pilot', 'Pax 1', 'Pax 2', 'Cargo 1', 'Cargo 2', 'Custom 1', 'Custom 2', 'Custom 3'];
  var PItems = SEATS.map(function (s, j) {
    return { arm: V('pia' + j, s, 'length'), wt: V('piw' + j, s, 'weight'), mom: V('pim' + j, 'Mom', 'torque', { ro: true }) };
  });
  E(PWt, [PRF, PMom, PArm], function (rf, m, a) { return rf * m / a; });
  E(PMom, [PRF, PWt, PArm], function (rf, w, a) { return w * a / rf; });
  E(PArm, [PRF, PMom, PWt], function (rf, m, w) { return rf * m / w; });
  // W&B with the profile: fuel volume and the weight in each seat / cargo spot
  var AFVol = V('afvol', 'Fuel', 'volume'), AFWt = V('afwt', 'Fuel', 'weight', { ro: true });
  var AFMom = V('afmom', 'Mom', 'torque', { ro: true });
  var ARF = V('arf', 'RF', 'number', { ro: true });
  var ATWt = V('atw', 'Wt', 'weight', { ro: true }), ATMom = V('atm', 'Mom', 'torque', { ro: true });
  var ACG = V('acg', 'CG', 'length', { ro: true });
  E(ARF, [PRF], function (x) { return x; });
  E(AFWt, [AFVol, PFType], function (v, d) { return v * d; });
  E(AFMom, [ARF, AFWt, PFArm], function (rf, w, a) { return w * a / rf; });
  PItems.forEach(function (it) { E(it.mom, [ARF, it.wt, it.arm], function (rf, w, a) { return w * a / rf; }); });
  var profIns = [PWt, PMom, AFWt, AFMom].concat(PItems.map(function (x) { return x.wt; }), PItems.map(function (x) { return x.mom; }));
  var eATW = E(ATWt, profIns, function () {
    return [PWt, AFWt].concat(PItems.map(function (x) { return x.wt; }))
      .reduce(function (s, x) { return s + (x.has ? x.v : 0); }, 0);
  });
  var eATM = E(ATMom, profIns, function () {
    return [PMom, AFMom].concat(PItems.map(function (x) { return x.mom; }))
      .reduce(function (s, x) { return s + (x.has ? x.v : 0); }, 0);
  });
  eATW.canCompute = eATM.canCompute = function () { return PWt.has && PMom.has; };
  E(ACG, [ARF, ATMom, ATWt], function (rf, m, w) { return rf * m / w; });

  // ---------------------------------------------------------- Trip planner
  var MAX_LEGS = 5;
  var LEG_IN = [['dist', 'Dist', 'distance'], ['tc', 'TCrs', 'angle'], ['tas', 'TAS', 'air_speed'],
    ['wdir', 'WDir', 'angle'], ['wspd', 'WSpd', 'air_speed'], ['var', 'Var', 'angle_180'],
    ['dev', 'Dev', 'angle_180'], ['frate', 'Fuel Rate', 'fuel_rate'], ['dep', 'Depart', 'time']];
  var LEG_OUT = [['gs', 'GS', 'ground_speed'], ['ch', 'CH', 'angle'], ['mh', 'MH', 'angle'], ['th', 'TH', 'angle'],
    ['wca', 'WCA', 'angle_180'], ['fuel', 'Fuel', 'volume'], ['ete', 'ETE', 'duration'], ['eta', 'ETA', 'time']];
  var planState = { n: 0 };
  var LEGS = [];
  for (var L = 0; L < MAX_LEGS; L++) {
    var g = {};
    LEG_IN.forEach(function (d) { g[d[0]] = V('l' + L + d[0], d[1], d[2]); });
    LEG_OUT.forEach(function (d) { g[d[0]] = V('l' + L + d[0] + '_o', d[1], d[2], { ro: true, unit: d[0] === 'ete' ? 'HMS' : null }); });
    LEGS.push(g);
  }
  LEGS.forEach(function (g, i) {
    E(g.gs, [g.tas, g.wspd, g.wdir, g.th], function (a, ws, wd, th) {
      var av = vec(a, th), w = wind(ws, wd); return mag([av[0] + w[0], av[1] + w[1]]);
    });
    E(g.th, [g.tc, g.wdir, g.wspd, g.tas], function (tc, wd, ws, a) {
      var s = ws * Math.sin((wd - tc) * D2R) / a;
      return Math.abs(s) > 1 ? NaN : n360(tc + Math.asin(s) * R2D);
    });
    E(g.wca, [g.th, g.tc], function (th, tc) { return n180(th - tc); });
    E(g.ch, [g.th, g.var, g.dev], function (t, v, d) { return n360(t + v + d); });
    E(g.mh, [g.th, g.var], function (t, v) { return n360(t + v); });
    E(g.ete, [g.dist, g.gs], function (d, s) { return d / s; });
    E(g.eta, [g.ete, g.dep], function (t, d) { return mod(t + d, DAY); });
    E(g.fuel, [g.frate, g.ete], function (r, t) { return r * t; });
    if (i > 0) E(g.dep, [LEGS[i - 1].eta], function (t) { return t; });     // next leg departs at the ETA
  });
  var TDist = V('tdist', 'Dist', 'distance', { ro: true }), TETE = V('tete', 'ETE', 'duration', { ro: true, unit: 'HMS' });
  var TETA = V('teta', 'ETA', 'time', { ro: true }), TFuel = V('tfuel', 'Fuel', 'volume', { ro: true });
  function legsUsed() { return LEGS.slice(0, planState.n); }
  function total(out, key, fn) {
    var e = E(out, LEGS.map(function (g) { return g[key]; }), fn);
    e.canCompute = function () { var u = legsUsed(); return u.length > 0 && u.every(function (g) { return g[key].has; }); };
    return e;
  }
  var eTot = [
    total(TDist, 'dist', function () { return legsUsed().reduce(function (s, g) { return s + g.dist.v; }, 0); }),
    total(TETE, 'ete', function () { return legsUsed().reduce(function (s, g) { return s + g.ete.v; }, 0); }),
    total(TETA, 'eta', function () { var u = legsUsed(); return u[u.length - 1].eta.v; }),
    total(TFuel, 'fuel', function () { return legsUsed().reduce(function (s, g) { return s + g.fuel.v; }, 0); })];

  // ---------------------------------------------------------- Time Set
  // (clock values are handled by the app; listed here for the screen)

  // ================================================================== screens
  // Row kinds: {v: var}  · {h: 'TITLE'} header · {add/remove item rows built by the app}
  function rows() { return Array.prototype.map.call(arguments, function (x) { return { v: x }; }); }
  var SCREENS = {
    conv:   { title: 'Unit Conversions', rows: rows.apply(null, CV), conv: true },
    alt:    { title: 'Altitude', rows: rows(IAlt, Baro, PAlt, OAT, DAlt) },
    cloud:  { title: 'Cloud Base', rows: rows(OAT, Dewp, AGL) },
    stdatm: { title: 'Standard Atmosphere', rows: rows(SAlt, SBaro, SOAT) },
    airspd: { title: 'Airspeed', rows: rows(TAS, OAT, MACH, TAT, CAS, PAlt) },
    fuel:   { title: 'Fuel', rows: rows(Vol, Dur, Rate, Wt, WRate, FType) },
    gs:     { title: 'Ground Speed', rows: rows(Dist, Dur, GS) },
    glide:  { title: 'Glide', rows: rows(Rat, Desc, Dist) },
    climb:  { title: 'Climb & Descent', rows: rows(Dist, Desc, GS, RoC, AoC, Rat) },
    wcomp:  { title: 'Wind Component', rows: rows(WSpd, WDir, Rwy, XWnd, HWnd) },
    eta:    { title: 'Estimated Time Arrival', rows: rows(Dur, Dep, ETA) },
    tofrom: { title: 'To - From', rows: rows(From, To) },
    chdg:   { title: 'Compass Heading', rows: rows(THdg, Var, MHdg, Dev, CHdg) },
    wcorr:  { title: 'Wind Correction', rows: rows(GS, TAS, TCrs, THdg, WSpd, WDir, WCA) },
    rhumb:  { title: 'Rhumb Line', kind: 'rhumb' },
    hold:   { title: 'Holding Pattern', rows: rows(Turn, Head, Hold, Entry, Inbound) },
    wb:     { title: 'Weight and Balance', kind: 'wb' },
    wbp:    { title: 'Weight and Balance - Aircraft Profile', kind: 'wbp' },
    wshift: { title: 'Weight Shift Formula', rows: rows(SIW, STW, DCG, DArm) },
    mac:    { title: '% MAC', rows: rows(MAC, MCG, LMAC, PMAC) },
    profile:{ title: 'Aircraft Profile', kind: 'profile', tag: 'SETTINGS' },
    total:  { title: 'Total Trip', rows: rows(TDist, TETE, TETA, TFuel), tag: 'TRIP' }
  };
  for (var li = 0; li < MAX_LEGS; li++) SCREENS['leg' + li] = { title: 'Leg ' + (li + 1), kind: 'leg', leg: li, tag: 'TRIP' };
  var FLT_LIST = ['conv', 'alt', 'cloud', 'stdatm', 'airspd', 'fuel', 'gs', 'glide', 'climb', 'wcomp', 'eta',
                  'tofrom', 'chdg', 'wcorr', 'rhumb', 'hold'];
  var WB_LIST = ['wb', 'wshift', 'mac'];

  var rhumbState = { n: 3 };          // items in use: A, AB, B (3) … up to A, AB, B, BC, C, CD, D (7)

  // Rows of the screens built from items
  function screenRows(id) {
    var s = SCREENS[id], r = [];
    if (s.rows) return s.rows;
    if (s.kind === 'rhumb') {
      // A, line AB and B are always there; BC, C, CD and D are added one at a time.
      // The next item shows "Add" (at the start: line BC and point C).
      var extra = rhumbState.n > 3;
      for (var q = 0; q < 7; q++) {
        var isPoint = q % 2 === 0, k = q >> 1;
        var title = isPoint ? 'POINT: ' + 'ABCD'[k] : 'RHUMB LINE: ' + 'ABCD'[k] + 'ABCD'[k + 1];
        if (q < rhumbState.n) {
          r.push({ h: title, act: extra ? 'Remove' : null, item: q });
          if (isPoint) r.push({ v: RP[k].lat, sub: 1 }, { v: RP[k].lon, sub: 1 });
          else r.push({ v: RL[k].tc, sub: 1 }, { v: RL[k].d, sub: 1 });
        } else {
          r.push({ h: title, act: 'Add', add: true, item: q });
          if (!(rhumbState.n === 3 && q === 3)) break;
        }
      }
      return r;
    }
    if (s.kind === 'wb') {
      r.push({ v: RF });
      var last = wbState.on.lastIndexOf(true);
      for (var j = 0; j < MAX_ITEMS && j <= last + 1; j++) {
        if (!wbState.on[j]) { r.push({ h: 'ITEM ' + (j + 1), act: 'Add', add: true, item: j }); continue; }
        r.push({ h: 'ITEM ' + (j + 1), act: 'Remove', item: j });
        r.push({ v: WB[j].wt, sub: 1 }, { v: WB[j].arm, sub: 1 }, { v: WB[j].mom, sub: 1 });
      }
      r.push({ h: 'TOTALS', ro: true }, { v: TWt, sub: 1 }, { v: TMom, sub: 1 }, { v: CG, sub: 1 });
      return r;
    }
    if (s.kind === 'wbp') {
      r.push({ v: AFVol });
      PItems.forEach(function (x) { r.push({ v: x.wt }); });
      r.push({ h: 'TOTALS', ro: true }, { v: ARF, sub: 1 }, { v: ATWt, sub: 1 }, { v: ACG, sub: 1 }, { v: ATMom, sub: 1 });
      return r;
    }
    if (s.kind === 'profile') {
      r.push({ h: 'Instrument Calibration' }, { v: PK, sub: 1 }, { h: 'Weight & Balance Profile' }, { v: PValid, sub: 1 },
        { h: 'Empty Aircraft' }, { v: PRF, sub: 1 }, { v: PWt, sub: 1 }, { v: PArm, sub: 1 }, { v: PMom, sub: 1 },
        { h: 'Fuel' }, { v: PFType, sub: 1 }, { v: PFArm, sub: 1 }, { v: PFAux, sub: 1 }, { h: 'Individual Item Arms' });
      PItems.forEach(function (x) { r.push({ v: x.arm, sub: 1 }); });
      return r;
    }
    if (s.kind === 'leg') {
      var g = LEGS[s.leg];
      LEG_IN.forEach(function (d) { r.push({ v: g[d[0]] }); });
      r.push({ h: 'CALCULATED VALUES' });
      LEG_OUT.forEach(function (d) { r.push({ v: g[d[0]], sub: 1 }); });
      return r;
    }
    return r;
  }

  // ---------------------------------------------------------- item operations
  function refresh(list) { list.forEach(function (e) { e.update(); }); }
  function wbAdd(j) { if (j >= 0 && j < MAX_ITEMS) { wbState.on[j] = true; refresh([eTWt, eTMom]); } }
  function wbRemove(j) {
    if (!wbState.on[j]) return;
    ['mom', 'arm', 'wt'].forEach(function (f) { WB[j][f].clear(); });
    wbState.on[j] = false; refresh([eTWt, eTMom]);
  }
  function rhumbAdd() { if (rhumbState.n < 7) rhumbState.n++; }
  // Remove takes away the last line or point added
  function rhumbRemove() {
    if (rhumbState.n <= 3) return;
    var q = --rhumbState.n, k = q >> 1;
    if (q % 2 === 0) { RP[k].lon.clear(); RP[k].lat.clear(); } else { RL[k].d.clear(); RL[k].tc.clear(); }
  }
  function copyVar(src, dst) {
    dst.clear();
    if (src.has) { dst.set(src.v, src.computed); dst.copied = src.copied; }
  }
  // a new leg starts with the previous leg's inputs (shown with the blue "global" icon)
  function legAdd() {
    if (planState.n >= MAX_LEGS) return -1;
    var i = planState.n++;
    if (i > 0) {
      var p = LEGS[i - 1], g = LEGS[i];
      LEG_IN.forEach(function (d) {
        if (d[0] === 'dep') return;
        var x = g[d[0]];
        x.clear();
        if (p[d[0]].has) { x.set(p[d[0]].v, false); x.copied = true; }
      });
      g.dep.clear();
      // the departure comes from the previous leg's ETA
      M.eqs.forEach(function (e) { if (e.out === g.dep) e.update(); });
    }
    refresh(eTot);
    return i;
  }
  function legRemove(i) {
    if (i < 0 || i >= planState.n) return;
    for (var k = i; k < planState.n - 1; k++) {
      LEG_IN.forEach(function (d) { if (d[0] !== 'dep' || k === 0) copyVar(LEGS[k + 1][d[0]], LEGS[k][d[0]]); });
    }
    var last = LEGS[planState.n - 1];
    LEG_IN.slice().reverse().forEach(function (d) { last[d[0]].clear(); });
    planState.n--;
    refresh(eTot);
  }

  function setChoice(x, idx) {
    var d = root.Units ? root.Units.DIMS[x.dim] : require('./units.js').DIMS[x.dim];
    var val = x.dim === 'fuel_type' ? d.units[idx].f : idx;
    x.clear(); x.set(val, false);
  }
  function choiceIndex(x) {
    var d = (root.Units || require('./units.js')).DIMS[x.dim];
    if (!x.has) return 0;
    if (x.dim === 'fuel_type') { for (var i = 0; i < d.units.length; i++) if (Math.abs(d.units[i].f - x.v) < 1e-9) return i; return 0; }
    return x.v;
  }

  // values every fresh CX-3 starts with
  function defaults() {
    setChoice(Turn, 0); setChoice(FType, 0); setChoice(PFType, 0); setChoice(PValid, 0);
    PK.set(1, false); K.set(1, false);
  }

  // state that is not a variable value
  function saveState() { return { m: M.save(), wb: wbState.on.slice(), rh: rhumbState.n, plan: planState.n }; }
  function loadState(o) {
    o = o || {};
    wbState.on = Array.isArray(o.wb) ? o.wb.slice() : [true, false, false, false, false, false, false, false];
    rhumbState.n = o.rh >= 3 ? o.rh : 3; planState.n = o.plan || 0;
    if (o.m) M.load(o.m); else { M.reset(); defaults(); }
  }
  defaults();

  var Model = {
    M: M, vars: M.vars, SCREENS: SCREENS, FLT_LIST: FLT_LIST, WB_LIST: WB_LIST, screenRows: screenRows,
    wbAdd: wbAdd, wbRemove: wbRemove, rhumbAdd: rhumbAdd, rhumbRemove: rhumbRemove,
    legAdd: legAdd, legRemove: legRemove, planState: planState, wbState: wbState, rhumbState: rhumbState,
    MAX_LEGS: MAX_LEGS, setChoice: setChoice, choiceIndex: choiceIndex, saveState: saveState, loadState: loadState,
    reset: function () { loadState({}); },
    profileOn: function () { return PValid.has && PValid.v === 1; },
    setK: function () { K.locked = false; if (PK.has) { K.clear(); K.set(PK.v, false); } },
    ENTRY_NAMES: ['Direct', 'Parallel', 'Teardrop'],
    math: { stdTemp: stdTemp, stdPress: stdPress, stdAlt: stdAlt, rhumbCourse: rhumbCourse, rhumbDist: rhumbDist,
            rhumbLat: rhumbLat, rhumbLon: rhumbLon, hFromBaro: hFromBaro }
  };
  root.Model = Model;
  if (typeof module !== 'undefined') module.exports = Model;
})(typeof window !== 'undefined' ? window : globalThis);
