/* CX-3 function and menu definitions.
 * A function is a list of fields plus a calc(v, ctx) that receives input values
 * in base units (null when empty) and returns outputs in base units. */
(function (root) {
  'use strict';
  var A = root.Aviation || require('./aviation.js');
  var Units = root.Units || require('./units.js');

  function I(id, label, type, o) { return Object.assign({ id: id, label: label, type: type, input: true }, o || {}); }
  function O(id, label, type, o) { return Object.assign({ id: id, label: label, type: type, input: false }, o || {}); }
  function has() { for (var i = 0; i < arguments.length; i++) if (arguments[i] == null) return false; return true; }

  var FNS = {};
  function def(id, title, fields, calc, extra) {
    FNS[id] = Object.assign({ id: id, title: title, fields: fields, calc: calc }, extra || {});
  }

  // ---------------- FLT: Altitude ----------------
  def('palt', 'Pressure Altitude',
    [I('ialt', 'Ind Alt', 'alt'), I('baro', 'Baro', 'press'), O('palt', 'PAlt', 'alt')],
    function (v) { if (has(v.ialt, v.baro)) return { palt: A.pressureAltitude(v.ialt, v.baro) }; });

  def('dalt', 'Density Altitude',
    [I('palt', 'PAlt', 'alt'), I('oat', 'OAT', 'temp'), O('dalt', 'DAlt', 'alt')],
    function (v) { if (has(v.palt, v.oat)) return { dalt: A.densityAltitude(v.palt, v.oat) }; });

  def('cloud', 'Cloud Base',
    [I('temp', 'Temp', 'temp'), I('dew', 'Dew Pt', 'temp'), I('elev', 'Elev', 'alt', { opt: true }),
     O('agl', 'Base AGL', 'alt'), O('msl', 'Base MSL', 'alt')],
    function (v) {
      if (!has(v.temp, v.dew)) return;
      var agl = A.cloudBase(v.temp, v.dew);
      return { agl: agl, msl: agl + (v.elev || 0) };
    });

  def('stdatm', 'Standard Atmosphere',
    [I('alt', 'Alt', 'alt'), O('temp', 'Temp', 'temp'), O('press', 'Press', 'press'),
     O('sigma', 'Dens Ratio', 'num', { dp: 4 }), O('a', 'Sp Sound', 'speed')],
    function (v) {
      if (!has(v.alt)) return;
      var s = A.stdAtmosphere(v.alt);
      return { temp: s.temp, press: s.press, sigma: s.sigma, a: s.a };
    });

  // ---------------- FLT: Airspeed ----------------
  def('ptas', 'Planned TAS',
    [I('palt', 'PAlt', 'alt'), I('oat', 'OAT', 'temp'), I('cas', 'CAS', 'speed'),
     O('tas', 'TAS', 'speed'), O('mach', 'Mach', 'num', { dp: 3 }), O('dalt', 'DAlt', 'alt')],
    function (v) {
      if (!has(v.palt, v.oat, v.cas)) return;
      return A.plannedTas(v.palt, v.oat, v.cas);
    });

  def('atas', 'Actual TAS',
    [I('palt', 'PAlt', 'alt'), I('tat', 'TAT', 'temp'), I('cas', 'CAS', 'speed'),
     O('tas', 'TAS', 'speed'), O('mach', 'Mach', 'num', { dp: 3 }), O('oat', 'OAT', 'temp'),
     O('dalt', 'DAlt', 'alt')],
    function (v) {
      if (!has(v.palt, v.tat, v.cas)) return;
      return A.actualTas(v.palt, v.tat, v.cas);
    });

  def('mach', 'Mach Number',
    [I('oat', 'OAT', 'temp'), I('tas', 'TAS', 'speed'), O('mach', 'Mach', 'num', { dp: 3 }),
     O('a', 'Sp Sound', 'speed')],
    function (v) {
      if (!has(v.oat, v.tas)) return;
      var a = A.speedOfSound(v.oat);
      return { mach: v.tas / a, a: a };
    });

  // ---------------- FLT: Fuel ----------------
  def('fburn', 'Fuel Burn',
    [I('rate', 'Rate', 'rate'), I('time', 'Time', 'dur'), O('fuel', 'Fuel', 'vol')],
    function (v) { if (has(v.rate, v.time)) return { fuel: v.rate * v.time }; });

  def('frate', 'Fuel Rate',
    [I('fuel', 'Fuel', 'vol'), I('time', 'Time', 'dur'), O('rate', 'Rate', 'rate')],
    function (v) { if (has(v.fuel, v.time) && v.time > 0) return { rate: v.fuel / v.time }; });

  def('endur', 'Endurance',
    [I('fuel', 'Fuel', 'vol'), I('rate', 'Rate', 'rate'), O('time', 'Time', 'dur')],
    function (v) { if (has(v.fuel, v.rate) && v.rate > 0) return { time: v.fuel / v.rate }; });

  def('fwt', 'Fuel Weight',
    [I('fuel', 'Fuel', 'vol'), I('type', 'Type', 'enum', { options: ['AvGas', 'Jet A', 'Oil'], def: 0 }),
     O('wt', 'Weight', 'weight')],
    function (v) {
      if (!has(v.fuel)) return;
      var lbsPerGal = [6.0, 6.7, 7.5][v.type || 0];
      return { wt: v.fuel * lbsPerGal };
    });

  // ---------------- FLT: Time / Speed / Distance ----------------
  def('gs', 'Ground Speed',
    [I('dist', 'Dist', 'dist'), I('time', 'Time', 'dur'), O('gs', 'GS', 'speed')],
    function (v) { if (has(v.dist, v.time) && v.time > 0) return { gs: v.dist / v.time }; });

  def('time', 'Time',
    [I('dist', 'Dist', 'dist'), I('gs', 'GS', 'speed'), O('time', 'Time', 'dur')],
    function (v) { if (has(v.dist, v.gs) && v.gs > 0) return { time: v.dist / v.gs }; });

  def('dist', 'Distance',
    [I('gs', 'GS', 'speed'), I('time', 'Time', 'dur'), O('dist', 'Dist', 'dist')],
    function (v) { if (has(v.gs, v.time)) return { dist: v.gs * v.time }; });

  def('eta', 'Est Time of Arrival',
    [I('dist', 'Dist', 'dist'), I('gs', 'GS', 'speed'), I('dep', 'Dep Time', 'clock'),
     O('ete', 'ETE', 'dur'), O('eta', 'ETA', 'clock')],
    function (v) {
      if (!has(v.dist, v.gs, v.dep) || v.gs <= 0) return;
      var ete = v.dist / v.gs;
      return { ete: ete, eta: v.dep + ete };
    });

  // ---------------- FLT: Wind / Heading ----------------
  def('cmphdg', 'Compass Heading',
    [I('tcrs', 'TCrs', 'dir'), I('tas', 'TAS', 'speed'), I('wdir', 'WDir', 'dir'),
     I('wspd', 'WSpd', 'speed'), I('var', 'Var', 'var', { opt: true }), I('dev', 'Dev', 'dev', { opt: true }),
     O('wca', 'WCA', 'wca'), O('thdg', 'THdg', 'dir'), O('mhdg', 'MHdg', 'dir'),
     O('chdg', 'CHdg', 'dir'), O('gs', 'GS', 'speed')],
    function (v) {
      if (!has(v.tcrs, v.tas, v.wdir, v.wspd)) return;
      var w = A.windTriangle(v.tcrs, v.tas, v.wdir, v.wspd);
      if (!w) return { error: 'Wind > TAS' };
      var mh = A.dir360(w.thdg + (v.var || 0));      // West variation positive (west is best)
      return { wca: w.wca, thdg: w.thdg, mhdg: mh, chdg: A.dir360(mh + (v.dev || 0)), gs: w.gs };
    });

  // Real CX-3: enter any four of GS, TAS, TCrs, THdg, WSpd, WDir; the other two are solved
  def('windcorr', 'Wind Correction',
    [I('gs', 'GS', 'speed', { solve: true }), I('tas', 'TAS', 'speed', { solve: true }),
     I('tcrs', 'TCrs', 'dir', { solve: true }), I('thdg', 'THdg', 'dir', { solve: true }),
     I('wspd', 'WSpd', 'speed', { solve: true }), I('wdir', 'WDir', 'dir', { solve: true }),
     O('wca', 'WCA', 'wca')],
    function (v) {
      var r = A.windSolve(v) || {};
      if (r.error) return { error: r.error };
      var tc = v.tcrs != null ? v.tcrs : r.tcrs, th = v.thdg != null ? v.thdg : r.thdg;
      if (tc != null && th != null) r.wca = A.norm180(th - tc);
      return r;
    }, { solver: true });

  def('windcomp', 'Wind Component',
    [I('rwy', 'Rwy', 'rwy'), I('wdir', 'WDir', 'dir'), I('wspd', 'WSpd', 'speed'),
     O('head', 'Headwind', 'speed'), O('cross', 'X-Wind', 'speed')],
    function (v) {
      if (!has(v.rwy, v.wdir, v.wspd)) return;
      var c = A.windComponents(v.rwy, v.wdir, v.wspd);
      var r = { head: Math.abs(c.head), cross: Math.abs(c.cross), _labels: {} };
      r._labels.head = c.head < -0.05 ? 'Tailwind' : 'Headwind';
      r._labels.cross = Math.abs(c.cross) < 0.05 ? 'X-Wind' : (c.cross > 0 ? 'X-Wind R' : 'X-Wind L');
      return r;
    });

  def('tofrom', 'To-From',
    [I('rad', 'Radial', 'dir'), O('crs', 'Crs To', 'dir'),
     I('crsto', 'Crs To', 'dir', { opt: true }), O('radf', 'Radial', 'dir')],
    function (v) {
      var r = {};
      if (v.rad != null) r.crs = A.reciprocal(v.rad);
      if (v.crsto != null) r.radf = A.reciprocal(v.crsto);
      return r;
    }, { anyInput: true });

  def('rhumb', 'Rhumb Line',
    [I('lat1', 'Lat 1', 'lat'), I('lon1', 'Long 1', 'lon'), I('lat2', 'Lat 2', 'lat'),
     I('lon2', 'Long 2', 'lon'), O('tcrs', 'TCrs', 'dir'), O('dist', 'Dist', 'dist')],
    function (v) {
      if (!has(v.lat1, v.lon1, v.lat2, v.lon2)) return;
      return A.rhumbLine(v.lat1, v.lon1, v.lat2, v.lon2);
    });

  // ---------------- FLT: Climb / Descent / Glide ----------------
  def('climb', 'Climb / Descent',
    [I('alt', 'Alt Chg', 'alt'), I('gs', 'GS', 'speed'), I('dist', 'Dist', 'dist'),
     O('time', 'Time', 'dur'), O('rate', 'Rate', 'vs'), O('grad', 'Gradient', 'grad'),
     O('ang', 'Angle', 'angle', { dp: 1 })],
    function (v) {
      if (!has(v.alt, v.gs, v.dist) || v.gs <= 0 || v.dist <= 0) return;
      var t = v.dist / v.gs, alt = Math.abs(v.alt);
      var g = alt / v.dist;
      return { time: t, rate: alt / (t * 60), grad: g, ang: A.gradToAngle(g) };
    });

  def('tod', 'Top of Descent',
    [I('cur', 'Cur Alt', 'alt'), I('tgt', 'Tgt Alt', 'alt'), I('gs', 'GS', 'speed'), I('rate', 'Rate', 'vs'),
     O('time', 'Time', 'dur'), O('dist', 'Dist', 'dist'), O('grad', 'Gradient', 'grad')],
    function (v) {
      if (!has(v.cur, v.tgt, v.gs, v.rate) || v.rate <= 0) return;
      var alt = Math.abs(v.cur - v.tgt), t = alt / v.rate / 60, d = v.gs * t;
      return { time: t, dist: d, grad: d > 0 ? alt / d : 0 };
    });

  def('reqrate', 'Required Rate',
    [I('gs', 'GS', 'speed'), I('grad', 'Gradient', 'grad'), O('rate', 'Rate', 'vs')],
    function (v) {
      if (!has(v.gs, v.grad)) return;
      return { rate: v.grad * v.gs / 60 };
    });

  def('glide', 'Glide',
    [I('hgt', 'Height', 'alt'), I('ratio', 'Glide Ratio', 'ratio'), I('gs', 'GS', 'speed', { opt: true }),
     O('dist', 'Dist', 'dist'), O('time', 'Time', 'dur'), O('rate', 'Sink Rate', 'vs')],
    function (v) {
      if (!has(v.hgt, v.ratio)) return;
      var d = v.hgt * v.ratio / A.FT_PER_NM, r = { dist: d };
      if (v.gs > 0) { r.time = d / v.gs; r.rate = v.hgt / (r.time * 60); }
      return r;
    });

  // ---------------- FLT: Holding ----------------
  def('hold', 'Holding Pattern',
    [I('inbd', 'Inbd Crs', 'dir'), I('hdg', 'Hdg to Fix', 'dir'),
     I('turn', 'Turns', 'enum', { options: ['Right', 'Left'], def: 0 }),
     I('tas', 'TAS', 'speed', { opt: true }), I('wdir', 'WDir', 'dir', { opt: true }),
     I('wspd', 'WSpd', 'speed', { opt: true }),
     O('entry', 'Entry', 'text'), O('inHdg', 'Inbd Hdg', 'dir'), O('outHdg', 'Outbd Hdg', 'dir'),
     O('tearHdg', 'Tear Hdg', 'dir'), O('wca', 'WCA', 'wca')],
    function (v) {
      if (!has(v.inbd, v.hdg)) return;
      return A.holding(v.inbd, v.hdg, (v.turn || 0) === 0, v.tas, v.wdir, v.wspd);
    });

  // ---------------- Unit conversions ----------------
  Units.CONVERSIONS.forEach(function (c) {
    var units = Units.TYPES[c.type];
    var fields = [I('v', c.title, c.type)];
    units.forEach(function (u, j) { fields.push(O('o' + j, '', c.type, { fixedUnit: j, label: '=' })); });
    def('conv_' + c.type, c.title, fields, function (v) {
      if (v.v == null) return;
      var r = {};
      units.forEach(function (u, j) { r['o' + j] = v.v; });
      return r;
    }, { conv: true });
  });

  // ---------------- PLAN: Flight plan (legs) ----------------
  // Item-based functions: fields with `per` repeat for each item (leg / station);
  // calc returns per-item outputs keyed "id@i" and totals keyed by id.
  def('plan', 'Flight Plan',
    [I('tcrs', 'TCrs', 'dir', { per: true }), I('dist', 'Dist', 'dist', { per: true }),
     I('tas', 'TAS', 'speed', { per: true, inherit: true, profile: 'tas' }),
     I('wdir', 'WDir', 'dir', { per: true, inherit: true, opt: true }),
     I('wspd', 'WSpd', 'speed', { per: true, inherit: true, opt: true }),
     I('var', 'Var', 'var', { per: true, inherit: true, opt: true }),
     I('frate', 'Fuel Rate', 'rate', { per: true, inherit: true, opt: true, profile: 'frate' }),
     O('thdg', 'THdg', 'dir', { per: true }), O('mhdg', 'MHdg', 'dir', { per: true }),
     O('gs', 'GS', 'speed', { per: true }), O('ete', 'ETE', 'dur', { per: true }),
     O('fuel', 'Fuel', 'vol', { per: true }),
     O('tdist', 'Dist', 'dist', { total: true }), O('tete', 'ETE', 'dur', { total: true }),
     O('tfuel', 'Fuel', 'vol', { total: true })],
    function (v, ctx) {
      var r = {}, td = 0, te = 0, tf = 0, any = false, anyFuel = false;
      for (var i = 1; i <= ctx.n; i++) {
        var g = function (id) { return ctx.get(id, i); };
        var tcrs = g('tcrs'), dist = g('dist'), tas = g('tas');
        if (!has(tcrs, dist, tas)) continue;
        var w = A.windTriangle(tcrs, tas, g('wdir') || 0, g('wspd') || 0);
        if (!w) continue;
        var ete = dist / w.gs, fr = g('frate');
        r['thdg@' + i] = w.thdg; r['mhdg@' + i] = A.dir360(w.thdg + (g('var') || 0));
        r['gs@' + i] = w.gs; r['ete@' + i] = ete;
        any = true; td += dist; te += ete;
        if (fr != null) { r['fuel@' + i] = fr * ete; tf += fr * ete; anyFuel = true; }
      }
      if (any) { r.tdist = td; r.tete = te; if (anyFuel) r.tfuel = tf; }
      return r;
    }, { items: 'LEG', max: 20, clearRow: 'CLEAR PLAN' });

  def('profile', 'Aircraft Profile',
    [I('tas', 'Cruise TAS', 'speed'), I('frate', 'Fuel Rate', 'rate'), I('fcap', 'Fuel Cap', 'vol'),
     I('ewt', 'Empty Wt', 'weight'), I('earm', 'Empty Arm', 'arm'),
     O('endur', 'Endurance', 'dur'), O('range', 'Range', 'dist')],
    function (v) {
      var r = {};
      if (has(v.fcap, v.frate) && v.frate > 0) {
        r.endur = v.fcap / v.frate;
        if (v.tas != null) r.range = r.endur * v.tas;
      }
      return r;
    });

  // ---------------- W/B ----------------
  def('wb', 'Weight and Balance',
    [I('rf', 'RF', 'num', { dp: 0 }),
     I('wt', 'Wt', 'weight', { per: true }), I('arm', 'Arm', 'arm', { per: true }),
     O('mom', 'Mom', 'mom', { per: true }),
     O('twt', 'Wt', 'weight', { total: true }), O('tmom', 'Mom', 'mom', { total: true }),
     O('cg', 'CG', 'arm', { total: true })],
    function (v, ctx) {
      var rf = v.rf || 1, tw = 0, tm = 0, any = false, missingArm = false, r = {};
      for (var i = 1; i <= ctx.n; i++) {
        var wt = ctx.get('wt', i), arm = ctx.get('arm', i);
        if (wt == null) continue;
        any = true; tw += wt;
        if (arm != null) { tm += wt * arm; r['mom@' + i] = wt * arm / rf; }
        else missingArm = true;
      }
      if (any) {
        r.twt = tw;
        // moment and CG are only meaningful once every weighed item has an arm
        if (!missingArm) { r.tmom = tm / rf; if (tw !== 0) r.cg = tm / tw; }
      }
      return r;
    }, { items: 'ITEM', max: 20 });

  def('wshift', 'Weight Shift',
    [I('tw', 'Tot Wt', 'weight', { solve: true }), I('sw', 'Wt Shift', 'weight', { solve: true }),
     I('d', 'Dist', 'arm', { solve: true }), I('cg', 'CG Chg', 'arm', { solve: true })],
    function (v) {
      // Wt Shift × Dist = Tot Wt × CG Chg ; leave one blank to solve for it
      var miss = ['tw', 'sw', 'd', 'cg'].filter(function (k) { return v[k] == null; });
      if (miss.length !== 1) return;
      var k = miss[0], r = {};
      if (k === 'cg' && v.tw) r.cg = v.sw * v.d / v.tw;
      if (k === 'tw' && v.cg) r.tw = v.sw * v.d / v.cg;
      if (k === 'sw' && v.d) r.sw = v.tw * v.cg / v.d;
      if (k === 'd' && v.sw) r.d = v.tw * v.cg / v.sw;
      return r;
    }, { solver: true });

  def('wadd', 'Weight Add/Remove',
    [I('tw', 'Old Wt', 'weight'), I('cg', 'Old CG', 'arm'), I('dw', 'Wt Chg', 'weight'),
     I('arm', 'Arm', 'arm'), O('nw', 'New Wt', 'weight'), O('ncg', 'New CG', 'arm')],
    function (v) {
      if (!has(v.tw, v.cg, v.dw, v.arm)) return;
      var nw = v.tw + v.dw;
      if (nw === 0) return;
      return { nw: nw, ncg: (v.tw * v.cg + v.dw * v.arm) / nw };
    });

  def('mac', '% MAC',
    [I('cg', 'CG', 'arm'), I('lemac', 'LMAC', 'arm'), I('mac', 'MAC', 'arm'), O('pct', '%MAC', 'pct')],
    function (v) {
      if (!has(v.cg, v.lemac, v.mac) || v.mac === 0) return;
      return { pct: (v.cg - v.lemac) / v.mac * 100 };
    });

  // ---------------- Menus ----------------
  var MENUS = {
    FLT: { title: 'Flight', tag: 'E6-B', items: [
      { label: 'Altitude', menu: 'ALT' },
      { label: 'Airspeed', menu: 'AIRSPD' },
      { label: 'Fuel', menu: 'FUEL' },
      { label: 'Ground Speed', fn: 'gs' },
      { label: 'Time', fn: 'time' },
      { label: 'Distance', fn: 'dist' },
      { label: 'Est Time of Arrival', fn: 'eta' },
      { label: 'Compass Heading', fn: 'cmphdg' },
      { label: 'Wind Correction', fn: 'windcorr' },
      { label: 'Wind Component', fn: 'windcomp' },
      { label: 'To-From', fn: 'tofrom' },
      { label: 'Rhumb Line', fn: 'rhumb' },
      { label: 'Climb & Descent', menu: 'CLIMB' },
      { label: 'Glide', fn: 'glide' },
      { label: 'Holding Pattern', fn: 'hold' },
      { label: 'Unit Conversions', menu: 'CONV' }
    ] },
    ALT: { title: 'Altitude', tag: 'E6-B', items: [
      { label: 'Pressure Altitude', fn: 'palt' },
      { label: 'Density Altitude', fn: 'dalt' },
      { label: 'Cloud Base', fn: 'cloud' },
      { label: 'Standard Atmosphere', fn: 'stdatm' }
    ] },
    AIRSPD: { title: 'Airspeed', tag: 'E6-B', items: [
      { label: 'Planned TAS', fn: 'ptas' },
      { label: 'Actual TAS', fn: 'atas' },
      { label: 'Mach Number', fn: 'mach' }
    ] },
    FUEL: { title: 'Fuel', tag: 'E6-B', items: [
      { label: 'Fuel Burn', fn: 'fburn' },
      { label: 'Fuel Rate', fn: 'frate' },
      { label: 'Endurance', fn: 'endur' },
      { label: 'Fuel Weight', fn: 'fwt' }
    ] },
    CLIMB: { title: 'Climb & Descent', tag: 'E6-B', items: [
      { label: 'Climb / Descent', fn: 'climb' },
      { label: 'Top of Descent', fn: 'tod' },
      { label: 'Required Rate', fn: 'reqrate' }
    ] },
    CONV: { title: 'Unit Conversions', tag: 'E6-B', items: Units.CONVERSIONS.map(function (c) {
      return { label: c.title, fn: 'conv_' + c.type };
    }) },
    WB: { title: 'Weight and Balance', tag: 'E6-B', items: [
      { label: 'Weight and Balance', fn: 'wb' },
      { label: 'Weight Shift', fn: 'wshift' },
      { label: 'Weight Add/Remove', fn: 'wadd' },
      { label: '% MAC', fn: 'mac' }
    ] }
  };

  // Which menu tag each function belongs to (for the status bar)
  var FN_TAG = { plan: 'PLAN', profile: 'SETTINGS' };
  Object.keys(MENUS).forEach(function (m) {
    MENUS[m].items.forEach(function (it) { if (it.fn) FN_TAG[it.fn] = MENUS[m].tag; });
  });

  var Defs = { FNS: FNS, MENUS: MENUS, FN_TAG: FN_TAG };
  root.Defs = Defs;
  if (typeof module !== 'undefined') module.exports = Defs;
})(typeof window !== 'undefined' ? window : globalThis);
