/* Route helper: true course, distance, magnetic variation and winds aloft for
 * each leg, ready for the CX-3's PLAN. The planning core (plan) is pure; the
 * page code below it only runs in the browser. */
(function (root) {
  'use strict';
  var Nav = root.Nav || require('./nav.js');
  var Winds = root.Winds || require('./winds.js');
  var WMM = root.WMM || require('./wmm.js');
  var D2R = Math.PI / 180;

  function n360(a) { a %= 360; return a < 0 ? a + 360 : a; }
  function n180(a) { a = n360(a); return a > 180 ? a - 360 : a; }

  // FB covers this time? (between the first period's start and the last one's end)
  function fbCovers(fb, t) {
    if (!fb || !fb.periods || !fb.periods.length) return false;
    var a = Math.min.apply(null, fb.periods.map(function (p) { return p.useFrom; }));
    var b = Math.max.apply(null, fb.periods.map(function (p) { return p.useTo; }));
    return t >= a && t < b;
  }

  // round half away from zero, never −0
  function rnd(x) { var r = (x < 0 ? -1 : 1) * Math.round(Math.abs(x)); return r === 0 ? 0 : r; }
  // the numbers a pilot keys into a CX-3 PLAN leg: whole degrees and knots, tenths of a mile
  function keyed(r, w, decl) {
    return { dist: Math.round(r.dist * 10) / 10, tc: n360(rnd(r.tc)), wdir: w && w.dir != null ? n360(rnd(w.dir)) : 0,
             wspd: w ? rnd(w.spd) : 0, varW: rnd(-decl), dev: 0 };
  }

  /* One PLAN leg worked out by the CX-3's own model (so the numbers here are the
   * numbers PLAN shows). k: keyed values · tas kt · frate gph · dep: seconds of the day.
   * Returns base-unit values (m/s, °, s, L) or null when the leg has no solution. */
  function cx3Leg(k, tas, frate, dep) {
    var Md = root.Model || require('./model.js'), U = root.Units || require('./units.js');
    var snap = Md.saveState(), V = Md.vars, out = null;
    function put(id, unit, x) { var v = V[id], d = U.DIMS[v.dim]; v.clear(); v.set(U.toBase(d.units[U.unitIndex(v.dim, unit)], x), false); }
    try {
      Md.reset(); Md.legAdd();
      put('l0dist', 'NM', k.dist); put('l0tc', '°', k.tc); put('l0tas', 'KTS', tas);
      put('l0wdir', '°', k.wdir); put('l0wspd', 'KTS', k.wspd); put('l0var', '°', k.varW); put('l0dev', '°', k.dev);
      if (frate) put('l0frate', 'US GPH', frate);
      V.l0dep.clear(); V.l0dep.set(dep, false);
      if (V.l0gs_o.has && V.l0ete_o.has) {
        out = { gs: V.l0gs_o.v, th: V.l0th_o.v, mh: V.l0mh_o.v, ch: V.l0ch_o.v, wca: V.l0wca_o.v, ete: V.l0ete_o.v,
                eta: V.l0eta_o.v, fuel: V.l0fuel_o.has ? V.l0fuel_o.v : null };
      }
    } finally { Md.loadState(snap); }
    return out;
  }

  /* points: [{id, lat, lon}] · o: {alt ft, dep ms, tas kt?, frate gph?, source 'auto'|'fb'|'model'}
   * data: {fb: winds.json | null, model: [Open-Meteo location per leg] | null} */
  function plan(points, o, data) {
    var legs = [], t = o.dep, d0 = new Date(o.dep);
    var dep = d0.getUTCHours() * 3600 + d0.getUTCMinutes() * 60;     // PLAN Depart, whole minutes
    var tot = { dist: 0, ete: 0, fuel: 0, timed: !!o.tas, eta: null };
    for (var i = 0; i < points.length - 1; i++) {
      var a = points[i], b = points[i + 1], A = [a.lat, a.lon], B = [b.lat, b.lon];
      var r = Nav.rhumb(A, B), mid = Nav.midpoint(A, B);
      var decl = WMM.declination(mid[0], mid[1], o.alt, d0);
      var L = { from: a, to: b, tc: r.tc, dist: r.dist, mid: mid, decl: decl, mc: n360(r.tc - decl), tStart: t };
      // wind at the leg's midpoint, at the time the aircraft gets there
      var tMid = t, w = null, wm = null;
      for (var pass = 0; pass < 2; pass++) {
        var fb = (o.source !== 'model' && data.fb && fbCovers(data.fb, tMid)) ? Winds.fbAt(data.fb, mid[0], mid[1], o.alt, tMid) : null;
        wm = data.model && data.model[i] ? Winds.modelAt(data.model[i], o.alt, tMid) : null;
        w = o.source === 'model' ? wm : o.source === 'fb' ? fb : (fb || wm);
        if (!o.tas) break;
        var tri = triangle(r.tc, o.tas, w);
        if (!tri) break;
        tMid = t + r.dist / tri.gs / 2 * 3600000;
      }
      L.wind = w; L.modelWind = wm; L.tMid = tMid;
      L.k = keyed(r, w, decl);
      L.depart = dep;
      tot.dist += L.k.dist;
      if (o.tas && tot.timed) {
        L.cx = cx3Leg(L.k, o.tas, o.frate, dep);
        if (L.cx) {
          tot.ete += L.cx.ete; t += L.cx.ete * 1000; dep = L.cx.eta; tot.eta = L.cx.eta;
          if (L.cx.fuel != null) tot.fuel += L.cx.fuel;
        } else tot.timed = false;
      }
      legs.push(L);
    }
    if (!tot.timed) tot.eta = null;
    return { legs: legs, total: tot };
  }

  // wind triangle: heading and ground speed for a true course (null when the wind exceeds TAS)
  function triangle(tc, tas, w) {
    var wd = w && w.dir != null ? w.dir : 0, ws = w ? w.spd : 0;
    var s = ws * Math.sin((wd - tc) * D2R) / tas;
    if (Math.abs(s) > 1) return null;
    var wca = Math.asin(s) / D2R, gs = tas * Math.cos(wca * D2R) - ws * Math.cos((wd - tc) * D2R);
    if (gs <= 0) return null;
    return { wca: wca, th: n360(tc + wca), gs: gs };
  }

  var Route = { plan: plan, triangle: triangle, fbCovers: fbCovers, n180: n180, keyed: keyed, cx3Leg: cx3Leg };
  root.Route = Route;
  if (typeof module !== 'undefined') module.exports = Route;

  // ================================================================ page
  if (typeof document === 'undefined') return;
  var $ = function (id) { return document.getElementById(id); };
  var STORE_KEY = 'cx3-sim-v3', FORM_KEY = 'cx3-route-form';
  var KT = 1852 / 3600, GPH = 3.7854118 / 3600;              // base units: m/s, L/s
  var last = null;

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function z(t) { var d = new Date(t); return pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + 'Z'; }
  function hm(h) { var m = Math.round(h * 60); return Math.floor(m / 60) + ':' + pad(m % 60); }
  function deg(x) { return pad3(Math.round(n360(x)) || 360); }
  function pad3(n) { return ('00' + n).slice(-3); }
  function varText(d) { var a = Math.abs(d).toFixed(1); return d < 0 ? a + '°W' : d > 0 ? a + '°E' : '0.0°'; }
  function cx3Var(d) { return (-d).toFixed(1).replace(/^-0\.0$/, '0.0'); }
  function windText(w) { return !w ? '—' : w.dir == null ? '风小风向不定' : deg(w.dir) + '° / ' + Math.round(w.spd) + ' kt'; }
  function tempText(t) { return t == null ? '—' : Math.round(t) + ' °C · ' + Math.round(t * 1.8 + 32) + ' °F'; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function defaultDep() {
    var d = new Date(Date.now() + 3600000); d.setMinutes(0, 0, 0);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }
  function readForm() {
    var dep = $('dep').value ? new Date($('dep').value).getTime() : Date.now();
    return { route: $('route').value.trim(), alt: +$('alt').value || 0, dep: dep, tas: +$('tas').value || null,
             frate: +$('frate').value || null, source: $('src').value };
  }
  function saveForm() {
    try { localStorage.setItem(FORM_KEY, JSON.stringify({ route: $('route').value, alt: $('alt').value, tas: $('tas').value, frate: $('frate').value, src: $('src').value })); } catch (e) { /* private mode */ }
  }
  function loadForm() {
    var f = null;
    try { f = JSON.parse(localStorage.getItem(FORM_KEY) || 'null'); } catch (e) { /* private mode */ }
    if (f) ['route', 'alt', 'tas', 'frate'].forEach(function (k) { if (f[k] != null) $(k).value = f[k]; });
    if (f && f.src) $('src').value = f.src;
    $('dep').value = defaultDep();
    depNote();
  }
  function depNote() { var t = $('dep').value ? new Date($('dep').value).getTime() : Date.now(); $('depz').textContent = '= ' + new Date(t).toISOString().slice(5, 16).replace('T', ' ') + 'Z'; }
  function status(t, err) { var s = $('status'); s.textContent = t || ''; s.className = 'status' + (err ? ' err' : ''); }

  function getFB() {
    return fetch('data/winds.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }
  function getModel(mids, o) {
    var days = Math.min(16, Math.max(1, Math.ceil((o.dep - Date.now()) / 86400000) + 2));
    return fetch(Winds.modelURL(mids, days)).then(function (r) { if (!r.ok) throw new Error('Open-Meteo ' + r.status); return r.json(); })
      .then(function (j) { return Array.isArray(j) ? j : [j]; });
  }

  function run() {
    var o = readForm();
    saveForm();
    if (!o.route) return status('请输入航路，例如 KCOU KMHL', true);
    status('查找航点…');
    $('out').innerHTML = '';
    Nav.resolve(o.route).then(function (res) {
      if (res.errors.length) return status(res.errors.join('；'), true);
      if (res.points.length < 2) return status('至少需要两个航点', true);
      status('获取高空风…');
      var mids = [];
      for (var i = 0; i < res.points.length - 1; i++) mids.push(Nav.midpoint([res.points[i].lat, res.points[i].lon], [res.points[i + 1].lat, res.points[i + 1].lon]));
      return Promise.all([o.source === 'model' ? null : getFB(), getModel(mids, o).catch(function (e) { return { error: e.message }; })])
        .then(function (d) {
          var model = d[1] && !d[1].error ? d[1] : null;
          last = { o: o, points: res.points, result: plan(res.points, o, { fb: d[0], model: model }), fb: d[0], modelError: d[1] && d[1].error };
          render(last);
          status('');
        });
    }).catch(function (e) { status('出错：' + e.message, true); });
  }

  // the simulator's saved settings (units chosen in SET and on the PLAN screens)
  function simState() { try { return JSON.parse(localStorage.getItem(STORE_KEY) || 'null') || {}; } catch (e) { return {}; } }
  // a PLAN value as the CX-3 shows it there: the unit that screen uses, its decimals.
  // scr: 'leg0'…'leg4' or 'total'; id: the variable. Returns [text, unit name]
  function cx(scr, id, base) {
    var U = root.Units, v = root.Model.vars[id], d = U.DIMS[v.dim], S = simState(), set = S.set || {}, units = S.units || {};
    var a = units[scr + '.' + id], b = units[scr + '#' + v.dim], i;
    if (set.unitmode === 1 && a != null) i = a;
    else if (b != null) i = b;
    else if (a != null) i = a;
    else if (v.unit) i = U.unitIndex(v.dim, v.unit);
    else i = U.defaultIndex(v.dim, set.units === 1);
    var u = d.units[i];
    return [U.format(v.dim, u, base), u.name];
  }
  // value span + unit for the page
  function show(attr, name, scr, id, base) {
    var t = cx(scr, id, base);
    return '<span data-' + attr + '="' + name + '">' + t[0] + '</span>' + (t[1] && t[1] !== '°' ? ' ' + esc(t[1]) : t[1] === '°' ? '°' : '');
  }
  function varKey(v) { return v < 0 ? (-v) + ' 再按 ±（东偏）' : v > 0 ? v + '（西偏）' : '0'; }

  function render(L) {
    var o = L.o, R = L.result, h = '';
    h += '<section class="card"><h2>航点</h2><ol class="pts">';
    L.points.forEach(function (p) {
      h += '<li><b>' + esc(p.ident || p.id) + '</b> ' + esc(p.name || '') + ' <span class="dim">' + p.lat.toFixed(4) + ', ' + p.lon.toFixed(4) +
        (p.elev != null ? ' · ' + p.elev + ' ft' : '') + (p.others ? ' · 同名 ' + (p.others + 1) + ' 个，取离上一航点最近的' : '') + '</span></li>';
    });
    h += '</ol></section>';
    if (R.legs.length > 5) h += '<p class="warn">CX-3 的 PLAN 最多 5 段：只有前 5 段会送入 PLAN。</p>';
    R.legs.forEach(function (g, i) {
      var w = g.wind, k = g.k, c = g.cx, sc = 'leg' + Math.min(i, 4), lp = 'l' + Math.min(i, 4);
      h += '<section class="card leg" data-leg="' + i + '"><h2>Leg ' + (i + 1) + ' <span class="dim">' + esc(g.from.ident || g.from.id) + ' → ' + esc(g.to.ident || g.to.id) + '</span>' +
        (i >= 5 ? ' <span class="warn">不送入 PLAN</span>' : '') + '</h2>' +
        '<h3>在 CX-3 PLAN 里输入</h3><dl class="keys">' +
        row('Dist', show('k', 'Dist', sc, lp + 'dist', k.dist * 1852), '等角航线 ' + g.dist.toFixed(2) + ' NM') +
        row('TCrs', show('k', 'TCrs', sc, lp + 'tc', k.tc), '真航迹 ' + g.tc.toFixed(1) + '°') +
        (o.tas ? row('TAS', show('k', 'TAS', sc, lp + 'tas', o.tas * KT), '') : '') +
        row('WDir', show('k', 'WDir', sc, lp + 'wdir', k.wdir), w ? (w.dir == null ? '风小风向不定' : '真北 ' + w.dir.toFixed(0) + '°') + ' · ' + srcText(w) : '无风数据，按无风计算') +
        row('WSpd', show('k', 'WSpd', sc, lp + 'wspd', k.wspd * KT), w ? w.spd.toFixed(1) + ' kt' : '') +
        row('Var', show('k', 'Var', sc, lp + 'var', k.varW), '磁差 ' + varText(g.decl) + '，按 ' + varKey(k.varW)) +
        row('Dev', show('k', 'Dev', sc, lp + 'dev', 0), '按罗盘修正卡改') +
        (o.frate ? row('Fuel Rate', show('k', 'Fuel Rate', sc, lp + 'frate', o.frate * GPH), o.frate + ' gal/hr') : '') +
        (i === 0 ? row('Depart', show('k', 'Depart', sc, lp + 'dep', g.depart), '以后各段由上一段 ETA 自动带入') : '') +
        '</dl>' +
        '<h3>参考</h3><dl>' + row('磁航迹 MC', deg(g.mc) + '°', '≈ G1000 DTK') + row('气温 OAT', tempText(w && w.temp), o.alt + ' ft') + '</dl>';
      if (c) {
        h += '<h3>CX-3 算出（与 PLAN 一致）</h3><dl class="calc">' +
          row('GS', show('c', 'GS', sc, lp + 'gs_o', c.gs), '') +
          row('CH', show('c', 'CH', sc, lp + 'ch_o', c.ch), '') +
          row('MH', show('c', 'MH', sc, lp + 'mh_o', c.mh), '') +
          row('TH', show('c', 'TH', sc, lp + 'th_o', c.th), '') +
          row('WCA', show('c', 'WCA', sc, lp + 'wca_o', c.wca), '') +
          (c.fuel != null ? row('Fuel', show('c', 'Fuel', sc, lp + 'fuel_o', c.fuel), '') : '') +
          row('ETE', show('c', 'ETE', sc, lp + 'ete_o', c.ete), '') +
          row('ETA', show('c', 'ETA', sc, lp + 'eta_o', c.eta), '') + '</dl>';
      } else if (o.tas) h += '<p class="warn">风速超过 TAS，这一段无解，后面的段不计时。</p>';
      if (w && w.source === 'FB') {
        h += '<details><summary>FB 原文（' + w.stations.map(function (s) { return s.id + ' ' + Math.round(s.nm) + ' NM'; }).join('，') + '）</summary><pre>FT  ' +
          w.period.levels.map(function (l) { return ('     ' + l).slice(-6); }).join(' ') + '\n' + w.stations.map(function (s) { return esc(s.raw); }).join('\n') +
          '</pre><p class="dim">FB ' + w.period.fcst + ' 小时预报，有效 ' + z(w.period.valid) + '，适用 ' + z(w.period.useFrom) + '–' + z(w.period.useTo) +
          (g.modelWind ? '。对照数值模式：' + windText(g.modelWind) + '，' + tempText(g.modelWind.temp) : '') + '</p></details>';
      }
      h += '</section>';
    });
    var t = R.total;
    h += '<section class="card"><h2>全程</h2><dl class="total">' + row('Dist', show('t', 'Dist', 'total', 'tdist', t.dist * 1852), '') +
      (t.timed ? row('ETE', show('t', 'ETE', 'total', 'tete', t.ete), '') + row('ETA', show('t', 'ETA', 'total', 'teta', t.eta), '') +
        (o.frate ? row('Fuel', show('t', 'Fuel', 'total', 'tfuel', t.fuel), '巡航段，不含滑行爬升和备份油') : '') : '') +
      '</dl>' + (R.legs.length > 5 ? '<p class="dim">全程含全部 ' + R.legs.length + ' 段；PLAN 的 Total Trip 只算前 5 段。</p>' : '') + '</section>';
    if (L.modelError) h += '<p class="dim">数值模式数据暂时取不到（' + esc(L.modelError) + '）。</p>';
    h += '<div class="actions"><button id="send" class="primary">送入 CX-3 PLAN</button><button id="copy">复制文字</button></div>';
    $('out').innerHTML = h;
    $('send').onclick = send;
    $('copy').onclick = copy;
  }
  function row(k, v, n) { return '<div><dt>' + k + '</dt><dd>' + v + (n ? '<small>' + esc(n) + '</small>' : '') + '</dd></div>'; }
  function srcText(w) {
    if (w.source === 'FB') return '官方 FB 预报' + (w.extrapolated ? '（超出报告高度，取最近一层）' : '');
    return '数值模式 ' + z(w.time);
  }

  function text() {
    var o = last.o, s = 'Route ' + o.route.toUpperCase() + '  ' + o.alt + ' ft  dep ' + z(o.dep) + '\n';
    last.result.legs.forEach(function (g, i) {
      var k = g.k, c = g.cx;
      s += 'Leg ' + (i + 1) + ' ' + (g.from.ident || g.from.id) + '-' + (g.to.ident || g.to.id) + ': Dist ' + k.dist.toFixed(1) + ' TCrs ' + k.tc +
        ' WDir ' + k.wdir + ' WSpd ' + k.wspd + ' Var ' + k.varW + ' (MC ' + deg(g.mc) + ')' +
        (c ? ' -> GS ' + cx('leg0', 'l0gs_o', c.gs).join(' ') + ' TH ' + cx('leg0', 'l0th_o', c.th)[0] + ' MH ' + cx('leg0', 'l0mh_o', c.mh)[0] +
             ' ETE ' + cx('leg0', 'l0ete_o', c.ete)[0] : '') + '\n';
    });
    return s;
  }
  function copy() {
    var t = text();
    (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { status('已复制'); }, function () {
      var ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); status('已复制'); } catch (e) { status('复制失败', true); }
      ta.remove();
    });
  }

  // write the legs into the simulator's saved state and open PLAN
  function send() {
    var U = root.Units, Md = root.Model, S = null;
    try { S = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { S = null; }
    S = S || {};
    Md.loadState(S.model);
    while (Md.planState.n) Md.legRemove(Md.planState.n - 1);
    var V = Md.vars, o = last.o;
    function put(id, unit, x) {
      var v = V[id], d = U.DIMS[v.dim];
      v.clear(); v.set(U.toBase(d.units[U.unitIndex(v.dim, unit)], x), false);
    }
    last.result.legs.slice(0, Md.MAX_LEGS).forEach(function (g, i) {
      Md.legAdd();
      var p = 'l' + i, k = g.k;
      put(p + 'dist', 'NM', k.dist);
      put(p + 'tc', '°', k.tc);
      if (o.tas) put(p + 'tas', 'KTS', o.tas); else V[p + 'tas'].clear();
      put(p + 'wdir', '°', k.wdir);
      put(p + 'wspd', 'KTS', k.wspd);
      put(p + 'var', '°', k.varW);
      put(p + 'dev', '°', k.dev);
      if (o.frate) put(p + 'frate', 'US GPH', o.frate); else V[p + 'frate'].clear();
      if (i === 0) { V.l0dep.clear(); V.l0dep.set(g.depart, false); }
    });
    S.model = Md.saveState();
    try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) { return status('无法保存（浏览器禁止了本地存储）', true); }
    location.href = 'index.html#plan';
  }

  document.addEventListener('DOMContentLoaded', function () {
    loadForm();
    $('dep').addEventListener('input', depNote);
    $('form').addEventListener('submit', function (e) { e.preventDefault(); run(); });
  });
  root.RoutePage = { run: run, text: function () { return last && text(); } };
})(typeof window !== 'undefined' ? window : globalThis);
