/* Winds and temperatures aloft for a point, altitude and time.
 *  - FB: the official US forecast (aviationweather.gov FB/FD, published 4× a day),
 *    parsed from its text and interpolated between stations and levels.
 *  - Model: Open-Meteo pressure-level forecast (worldwide), interpolated to the
 *    altitude by geopotential height.
 * Directions are degrees true (where the wind blows from), speeds in knots,
 * temperatures °C. Works in the browser and in Node. */
(function (root) {
  'use strict';
  var D2R = Math.PI / 180;

  // ------------------------------------------------------------ vectors
  // wind "from" direction/speed ↔ components; null direction = light and variable
  function toUV(dir, spd) { return dir == null ? [0, 0] : [spd * Math.sin(dir * D2R), spd * Math.cos(dir * D2R)]; }
  function fromUV(u, v) {
    var s = Math.sqrt(u * u + v * v);
    if (s < 0.5) return { dir: null, spd: 0 };
    var d = Math.atan2(u, v) / D2R; d = (d + 360) % 360;
    return { dir: d, spd: s };
  }
  function nmBetween(a, b) {
    var p1 = a[0] * D2R, p2 = b[0] * D2R, dl = (b[1] - a[1]) * D2R;
    var h = Math.sin((p2 - p1) / 2) * Math.sin((p2 - p1) / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return 2 * Math.asin(Math.min(1, Math.sqrt(h))) * 3440.065;
  }

  // ------------------------------------------------------------ FB text
  // one coded value: 2715-07, 2715, 731535 (≥ 30,000 ft, temperature negative), 9900+05
  function decodeFB(code, level) {
    code = (code || '').trim();
    if (!/^\d{4}([+-]\d{2}|\d{2})?$/.test(code)) return null;
    var dd = +code.slice(0, 2), ss = +code.slice(2, 4), t = null;
    if (code.length === 7) t = +code.slice(4);
    else if (code.length === 6) t = -(+code.slice(4));
    if (dd === 99 && ss === 0) return { dir: null, spd: 0, temp: t };           // light and variable
    if (dd >= 51 && dd <= 86) { dd -= 50; ss += 100; }                          // 100 kt or more
    return { dir: dd * 10, spd: ss, temp: t };
  }

  // "031800Z" → ms, choosing the month that puts it closest to `near`
  function dayTime(s, near) {
    var m = /(\d{2})(\d{2})(\d{2})Z/.exec(s); if (!m) return null;
    var n = new Date(near), best = null;
    [-1, 0, 1].forEach(function (k) {
      var t = Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + k, +m[1], +m[2], +m[3]);
      if (best == null || Math.abs(t - near) < Math.abs(best - near)) best = t;
    });
    return best;
  }

  /* Parse one FB product. Returns {based, valid, useFrom, useTo, levels:[ft],
   * stations:{ID:{raw, v:[{dir,spd,temp}|null per level]}}} */
  function parseFB(text, now) {
    now = now || Date.now();
    var lines = String(text).split(/\r?\n/), out = { levels: [], stations: {} }, cols = null;
    lines.forEach(function (ln) {
      var m;
      if ((m = /DATA BASED ON (\d{6}Z)/.exec(ln))) out.based = dayTime(m[1], now);
      if ((m = /VALID (\d{6}Z)\s+FOR USE (\d{4})-(\d{4})Z/.exec(ln))) {
        out.valid = dayTime(m[1], now);
        // the use window brackets the valid time
        var v = new Date(out.valid), base = Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate());
        var f = base + (+m[2].slice(0, 2) * 60 + +m[2].slice(2)) * 60000, t = base + (+m[3].slice(0, 2) * 60 + +m[3].slice(2)) * 60000;
        if (f > out.valid) f -= 86400000;
        if (t < out.valid) t += 86400000;
        out.useFrom = f; out.useTo = t;
      }
      if (/^FT\s+\d/.test(ln)) {
        cols = []; var re = /\d+/g, mm;
        while ((mm = re.exec(ln))) cols.push({ ft: +mm[0], end: mm.index + mm[0].length });
        out.levels = cols.map(function (c) { return c.ft; });
        return;
      }
      if (cols && /^[A-Z0-9]{3}\s/.test(ln)) {
        var id = ln.slice(0, 3), vals = [], prev = 3;
        cols.forEach(function (c) { vals.push(decodeFB(ln.slice(prev, c.end), c.ft)); prev = c.end; });
        out.stations[id] = { raw: ln.replace(/\s+$/, ''), v: vals };
      }
    });
    return out;
  }

  // a station's wind at an altitude (ft), interpolating between the levels it reports
  function stationAt(st, levels, alt) {
    var pts = [];
    levels.forEach(function (ft, i) { if (st.v[i]) pts.push({ ft: ft, w: st.v[i] }); });
    if (!pts.length) return null;
    var lo = pts[0], hi = pts[pts.length - 1];
    for (var i = 0; i < pts.length - 1; i++) if (pts[i].ft <= alt && alt <= pts[i + 1].ft) { lo = pts[i]; hi = pts[i + 1]; break; }
    if (alt <= pts[0].ft) hi = lo = pts[0];
    if (alt >= pts[pts.length - 1].ft) lo = hi = pts[pts.length - 1];
    var k = hi.ft === lo.ft ? 0 : (alt - lo.ft) / (hi.ft - lo.ft);
    var a = toUV(lo.w.dir, lo.w.spd), b = toUV(hi.w.dir, hi.w.spd);
    var w = fromUV(a[0] + k * (b[0] - a[0]), a[1] + k * (b[1] - a[1]));
    // temperature from the levels that report one
    var tp = pts.filter(function (p) { return p.w.temp != null; }), temp = null;
    if (tp.length) {
      var l = tp[0], h = tp[tp.length - 1];
      for (var j = 0; j < tp.length - 1; j++) if (tp[j].ft <= alt && alt <= tp[j + 1].ft) { l = tp[j]; h = tp[j + 1]; break; }
      if (alt <= tp[0].ft) h = l = tp[0];
      if (alt >= tp[tp.length - 1].ft) l = h = tp[tp.length - 1];
      // below the lowest temperature level: standard lapse rate 2 °C / 1000 ft
      if (alt < l.ft && l === h) temp = l.w.temp + (l.ft - alt) * 0.002;
      else temp = h.ft === l.ft ? l.w.temp : l.w.temp + (alt - l.ft) / (h.ft - l.ft) * (h.w.temp - l.w.temp);
    }
    return { dir: w.dir, spd: w.spd, temp: temp, extrapolated: alt < pts[0].ft || alt > pts[pts.length - 1].ft };
  }

  /* FB wind at a point: the forecast period whose "for use" window holds `time`
   * (else the nearest), the nearest stations (inverse distance squared, up to 3
   * within 250 NM). data = {periods:[parsed FB…], coords:{ID:[lat,lon]}} */
  function fbAt(data, lat, lon, alt, time) {
    if (!data || !data.periods || !data.periods.length) return null;
    var per = null;
    data.periods.forEach(function (p) {
      if (p.useFrom <= time && time < p.useTo) per = per || p;
    });
    if (!per) per = data.periods.slice().sort(function (a, b) { return Math.abs(a.valid - time) - Math.abs(b.valid - time); })[0];
    var near = [];
    Object.keys(per.stations).forEach(function (id) {
      var c = data.coords[id]; if (!c) return;
      var d = nmBetween([lat, lon], c);
      if (d <= 250) near.push({ id: id, d: d });
    });
    near.sort(function (a, b) { return a.d - b.d; });
    near = near.slice(0, 3);
    if (!near.length) return null;
    if (near[0].d < 5) near = near.slice(0, 1);
    var u = 0, v = 0, t = 0, tw = 0, sw = 0, used = [], extrap = false;
    near.forEach(function (n) {
      var w = stationAt(per.stations[n.id], per.levels, alt);
      if (!w) return;
      var k = 1 / Math.max(n.d, 1) / Math.max(n.d, 1), uv = toUV(w.dir, w.spd);
      u += k * uv[0]; v += k * uv[1]; sw += k;
      if (w.temp != null) { t += k * w.temp; tw += k; }
      extrap = extrap || w.extrapolated;
      used.push({ id: n.id, nm: n.d, raw: per.stations[n.id].raw });
    });
    if (!sw) return null;
    var r = fromUV(u / sw, v / sw);
    return { dir: r.dir, spd: r.spd, temp: tw ? t / tw : null, source: 'FB', stations: used, period: per, extrapolated: extrap };
  }

  // ------------------------------------------------------------ Open-Meteo
  var LEVELS = [1000, 975, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300, 250, 200];
  function modelURL(points, days) {
    var vars = [];
    LEVELS.forEach(function (p) {
      ['wind_speed', 'wind_direction', 'temperature', 'geopotential_height'].forEach(function (v) { vars.push(v + '_' + p + 'hPa'); });
    });
    return 'https://api.open-meteo.com/v1/forecast?latitude=' + points.map(function (p) { return p[0].toFixed(4); }).join(',') +
      '&longitude=' + points.map(function (p) { return p[1].toFixed(4); }).join(',') +
      '&hourly=' + vars.join(',') + '&wind_speed_unit=kn&timeformat=unixtime&forecast_days=' + (days || 3);
  }
  // one location's response → wind at altitude (ft MSL) and time (ms)
  function modelAt(loc, alt, time) {
    var H = loc && loc.hourly; if (!H || !H.time) return null;
    var ti = 0, best = Infinity;
    H.time.forEach(function (t, i) { var d = Math.abs(t * 1000 - time); if (d < best) { best = d; ti = i; } });
    if (best > 3 * 3600000) return null;                     // outside the forecast
    var h = alt * 0.3048, pts = [];
    LEVELS.forEach(function (p) {
      var z = H['geopotential_height_' + p + 'hPa'], s = H['wind_speed_' + p + 'hPa'], d = H['wind_direction_' + p + 'hPa'], t = H['temperature_' + p + 'hPa'];
      if (!z || z[ti] == null || s[ti] == null || d[ti] == null) return;
      pts.push({ z: z[ti], uv: toUV(d[ti], s[ti]), t: t ? t[ti] : null });
    });
    if (!pts.length) return null;
    pts.sort(function (a, b) { return a.z - b.z; });
    var lo = pts[0], hi = pts[pts.length - 1];
    for (var i = 0; i < pts.length - 1; i++) if (pts[i].z <= h && h <= pts[i + 1].z) { lo = pts[i]; hi = pts[i + 1]; break; }
    if (h <= pts[0].z) hi = lo = pts[0];
    if (h >= pts[pts.length - 1].z) lo = hi = pts[pts.length - 1];
    var k = hi.z === lo.z ? 0 : (h - lo.z) / (hi.z - lo.z);
    var w = fromUV(lo.uv[0] + k * (hi.uv[0] - lo.uv[0]), lo.uv[1] + k * (hi.uv[1] - lo.uv[1]));
    var temp = lo.t == null || hi.t == null ? null : lo.t + k * (hi.t - lo.t);
    return { dir: w.dir, spd: w.spd, temp: temp, source: 'Model', time: H.time[ti] * 1000 };
  }

  var Winds = { parseFB: parseFB, decodeFB: decodeFB, stationAt: stationAt, fbAt: fbAt, modelURL: modelURL,
                modelAt: modelAt, toUV: toUV, fromUV: fromUV, nmBetween: nmBetween, LEVELS: LEVELS };
  root.Winds = Winds;
  if (typeof module !== 'undefined') module.exports = Winds;
})(typeof window !== 'undefined' ? window : globalThis);
