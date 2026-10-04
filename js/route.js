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

  /* points: [{id, lat, lon}] · o: {alt ft, dep ms, tas kt?, frate gph?, source 'auto'|'fb'|'model'}
   * data: {fb: winds.json | null, model: [Open-Meteo location per leg] | null} */
  function plan(points, o, data) {
    var legs = [], t = o.dep, tot = { dist: 0, ete: 0, fuel: 0, timed: true };
    for (var i = 0; i < points.length - 1; i++) {
      var a = points[i], b = points[i + 1], A = [a.lat, a.lon], B = [b.lat, b.lon];
      var r = Nav.rhumb(A, B), mid = Nav.midpoint(A, B);
      var decl = WMM.declination(mid[0], mid[1], o.alt, new Date(o.dep));
      var L = { from: a, to: b, tc: r.tc, dist: r.dist, mid: mid, decl: decl, varW: -decl, mc: n360(r.tc - decl), tStart: t };
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
      if (o.tas) {
        var tr = triangle(r.tc, o.tas, w);
        if (tr) {
          L.th = tr.th; L.wca = tr.wca; L.gs = tr.gs; L.ete = r.dist / tr.gs;
          L.mh = n360(tr.th - decl);
          if (o.frate) { L.fuel = o.frate * L.ete; tot.fuel += L.fuel; }
          tot.ete += L.ete; t += L.ete * 3600000;
        } else tot.timed = false;
      } else tot.timed = false;
      tot.dist += r.dist;
      legs.push(L);
    }
    tot.eta = tot.timed ? t : null;
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

  var Route = { plan: plan, triangle: triangle, fbCovers: fbCovers, n180: n180 };
  root.Route = Route;
  if (typeof module !== 'undefined') module.exports = Route;

  // ================================================================ page
  if (typeof document === 'undefined') return;
  var $ = function (id) { return document.getElementById(id); };
  var STORE_KEY = 'cx3-sim-v3', FORM_KEY = 'cx3-route-form';
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

  function render(L) {
    var o = L.o, R = L.result, h = '';
    h += '<section class="card"><h2>航点</h2><ol class="pts">';
    L.points.forEach(function (p) {
      h += '<li><b>' + esc(p.ident || p.id) + '</b> ' + esc(p.name || '') + ' <span class="dim">' + p.lat.toFixed(4) + ', ' + p.lon.toFixed(4) +
        (p.elev != null ? ' · ' + p.elev + ' ft' : '') + (p.others ? ' · 同名 ' + (p.others + 1) + ' 个，取离上一航点最近的' : '') + '</span></li>';
    });
    h += '</ol></section>';
    R.legs.forEach(function (g, i) {
      var w = g.wind;
      h += '<section class="card leg"><h2>Leg ' + (i + 1) + ' <span class="dim">' + esc(g.from.ident || g.from.id) + ' → ' + esc(g.to.ident || g.to.id) + '</span>' +
        (i >= 5 ? ' <span class="warn">CX-3 只有 5 段</span>' : '') + '</h2><dl>' +
        row('TCrs 真航迹', deg(g.tc) + '°', 'CX-3 TCrs') +
        row('Dist 距离', g.dist.toFixed(1) + ' NM', 'CX-3 Dist') +
        row('磁差', varText(g.decl), 'CX-3 Var 输入 ' + cx3Var(g.decl)) +
        row('磁航迹 MC', deg(g.mc) + '°', '≈ G1000 DTK') +
        row('高空风', windText(w), w ? 'CX-3 WDir / WSpd · ' + srcText(w) : '无数据') +
        row('气温 OAT', tempText(w && w.temp), o.alt + ' ft');
      if (g.gs) h += row('真航向 TH', deg(g.th) + '°', 'WCA ' + (g.wca >= 0 ? '+' : '') + g.wca.toFixed(0) + '°') +
        row('磁航向 MH', deg(g.mh) + '°', '') + row('地速 GS', g.gs.toFixed(0) + ' kt', '') +
        row('ETE', hm(g.ete), '起 ' + z(g.tStart)) + (g.fuel != null ? row('燃油', g.fuel.toFixed(1) + ' gal', '') : '');
      else if (o.tas) h += row('航向/地速', '风速超过 TAS，无解', '');
      h += '</dl>';
      if (w && w.source === 'FB') {
        h += '<details><summary>FB 原文（' + w.stations.map(function (s) { return s.id + ' ' + Math.round(s.nm) + ' NM'; }).join('，') + '）</summary><pre>FT  ' +
          w.period.levels.map(function (l) { return ('     ' + l).slice(-6); }).join(' ') + '\n' + w.stations.map(function (s) { return esc(s.raw); }).join('\n') +
          '</pre><p class="dim">FB ' + w.period.fcst + ' 小时预报，有效 ' + z(w.period.valid) + '，适用 ' + z(w.period.useFrom) + '–' + z(w.period.useTo) +
          (g.modelWind ? '。对照数值模式：' + windText(g.modelWind) + '，' + tempText(g.modelWind.temp) : '') + '</p></details>';
      }
      h += '</section>';
    });
    var t = R.total;
    h += '<section class="card"><h2>全程</h2><dl>' + row('距离', t.dist.toFixed(1) + ' NM', '') +
      (t.timed ? row('ETE', hm(t.ete), '') + row('ETA', z(t.eta), '') + (o.frate ? row('燃油', t.fuel.toFixed(1) + ' gal', '巡航段，不含滑行爬升和备份油') : '') : '') +
      '</dl></section>';
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
      s += 'Leg ' + (i + 1) + ' ' + (g.from.ident || g.from.id) + '-' + (g.to.ident || g.to.id) + ': TC ' + deg(g.tc) + ' Dist ' + g.dist.toFixed(1) +
        ' Var ' + varText(g.decl) + ' MC ' + deg(g.mc) + ' Wind ' + windText(g.wind) + (g.wind && g.wind.temp != null ? ' OAT ' + Math.round(g.wind.temp) + 'C' : '') +
        (g.gs ? ' TH ' + deg(g.th) + ' GS ' + g.gs.toFixed(0) + ' ETE ' + hm(g.ete) : '') + '\n';
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
      var p = 'l' + i, w = g.wind;
      put(p + 'dist', 'NM', Math.round(g.dist * 10) / 10);
      put(p + 'tc', '°', Math.round(n360(g.tc)));
      if (o.tas) put(p + 'tas', 'KTS', o.tas);
      put(p + 'wdir', '°', w && w.dir != null ? Math.round(w.dir) : 0);
      put(p + 'wspd', 'KTS', w ? Math.round(w.spd) : 0);
      put(p + 'var', '°', Math.round(-g.decl * 10) / 10);
      if (!V[p + 'dev'].has || V[p + 'dev'].copied) put(p + 'dev', '°', 0);
      if (o.frate) put(p + 'frate', 'US GPH', o.frate);
      if (i === 0) { var d = new Date(o.dep); put(p + 'dep', 'UTC', d.getUTCHours() * 3600 + d.getUTCMinutes() * 60); }
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
