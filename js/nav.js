/* Route parsing and leg geometry for the route helper.
 * Waypoints: airport codes (ICAO, IATA, FAA local), VOR/NDB idents, or
 * coordinates ("38.82/-92.22", "N3849.1W09213.1", "3849N09213W").
 * Positions here are lat (+N), lon (+E); the CX-3 counts longitude +W. */
(function (root) {
  'use strict';
  var D2R = Math.PI / 180;

  // ----------------------------------------------------------- coordinates
  function parseCoord(t) {
    var m;
    if ((m = /^(-?\d+(?:\.\d+)?)[\/,](-?\d+(?:\.\d+)?)$/.exec(t))) {
      var la = +m[1], lo = +m[2];
      return Math.abs(la) <= 90 && Math.abs(lo) <= 180 ? [la, lo] : null;
    }
    // N3849.1W09213.1 · 3849N09213W · N38W092
    if ((m = /^([NS])(\d{2})(\d{2}(?:\.\d+)?)?([EW])(\d{3})(\d{2}(?:\.\d+)?)?$/.exec(t)) ||
        (m = /^(?:)(\d{2})(\d{2}(?:\.\d+)?)?([NS])(\d{3})(\d{2}(?:\.\d+)?)?([EW])$/.exec(t))) {
      var ns, la2, lam, ew, lo2, lom;
      if (/^[NS]/.test(t)) { ns = m[1]; la2 = m[2]; lam = m[3]; ew = m[4]; lo2 = m[5]; lom = m[6]; }
      else { la2 = m[1]; lam = m[2]; ns = m[3]; lo2 = m[4]; lom = m[5]; ew = m[6]; }
      var lat = (+la2 + (lam ? +lam / 60 : 0)) * (ns === 'S' ? -1 : 1);
      var lon = (+lo2 + (lom ? +lom / 60 : 0)) * (ew === 'W' ? -1 : 1);
      return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [lat, lon] : null;
    }
    return null;
  }

  // ----------------------------------------------------------- geometry
  function n360(a) { a %= 360; return a < 0 ? a + 360 : a; }
  function gcDist(a, b) {
    var p1 = a[0] * D2R, p2 = b[0] * D2R, dl = (b[1] - a[1]) * D2R;
    var h = Math.sin((p2 - p1) / 2) * Math.sin((p2 - p1) / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return 2 * Math.asin(Math.min(1, Math.sqrt(h))) * 3440.065;
  }
  // rhumb line course (deg true) and distance (NM, one minute of arc = 1 NM, as the CX-3)
  function rhumb(a, b) {
    var p1 = a[0] * D2R, p2 = b[0] * D2R, dl = (b[1] - a[1]) * D2R;
    if (Math.abs(dl) > Math.PI) dl = dl > 0 ? dl - 2 * Math.PI : dl + 2 * Math.PI;
    var dpsi = Math.log(Math.tan(Math.PI / 4 + p2 / 2) / Math.tan(Math.PI / 4 + p1 / 2));
    var q = Math.abs(dpsi) > 1e-12 ? (p2 - p1) / dpsi : Math.cos(p1);
    var d = Math.sqrt((p2 - p1) * (p2 - p1) + q * q * dl * dl) * 60 * 180 / Math.PI;
    return { tc: n360(Math.atan2(dl, dpsi) / D2R), dist: d };
  }
  function midpoint(a, b) {
    var dl = b[1] - a[1];
    if (Math.abs(dl) > 180) dl -= dl > 0 ? 360 : -360;
    var lon = a[1] + dl / 2;
    if (lon > 180) lon -= 360; if (lon < -180) lon += 360;
    return [(a[0] + b[0]) / 2, lon];
  }

  // ----------------------------------------------------------- lookup
  var shards = {};
  function shard(c, base) {
    if (!shards[c]) {
      shards[c] = fetch((base || '') + 'data/nav/' + encodeURIComponent(c) + '.json')
        .then(function (r) { if (!r.ok) throw new Error('nav data ' + r.status); return r.json(); })
        .catch(function (e) { delete shards[c]; throw e; });
    }
    return shards[c];
  }
  var KIND = { A: 'Airport', V: 'VOR', N: 'NDB', D: 'DME' };

  /* Resolve route text to waypoints. Ambiguous idents take the candidate nearest
   * the previous waypoint (the first waypoint prefers an airport whose own code
   * matches). Returns {points:[{id,name,kind,lat,lon,elev,country}], errors:[…]} */
  function resolve(text, base) {
    var toks = String(text).toUpperCase().split(/[\s,;]+/).filter(function (t) { return t && t !== 'DCT' && t !== 'DIRECT' && t !== '-'; });
    var out = [], errors = [];
    return toks.reduce(function (p, t) {
      return p.then(function () {
        var c = parseCoord(t);
        if (c) { out.push({ id: t, name: 'Coordinates', kind: 'Point', lat: c[0], lon: c[1] }); return; }
        if (!/^[A-Z0-9]{2,5}$/.test(t)) { errors.push(t + ': not a code or coordinates'); return; }
        return shard(t[0], base).then(function (s) {
          var cand = s[t] || [];
          if (!cand.length) { errors.push(t + ': not found'); return; }
          var prev = out[out.length - 1], pick;
          if (prev) pick = cand.slice().sort(function (x, y) { return gcDist([prev.lat, prev.lon], [x[1], x[2]]) - gcDist([prev.lat, prev.lon], [y[1], y[2]]); })[0];
          else pick = cand.filter(function (e) { return e[4] === 'A' && e[0] === t; })[0] || cand.filter(function (e) { return e[4] === 'A'; })[0] || cand[0];
          out.push({ id: t, ident: pick[0], name: pick[5], kind: KIND[pick[4]] || pick[4], lat: pick[1], lon: pick[2], elev: pick[3], country: pick[6],
                     others: cand.length - 1 });
        }).catch(function () { errors.push(t + ': navigation data not available'); });
      });
    }, Promise.resolve()).then(function () { return { points: out, errors: errors }; });
  }

  var Nav = { parseCoord: parseCoord, rhumb: rhumb, gcDist: gcDist, midpoint: midpoint, resolve: resolve };
  root.Nav = Nav;
  if (typeof module !== 'undefined') module.exports = Nav;
})(typeof window !== 'undefined' ? window : globalThis);
