/* CX-3 units and value formatting.
 * Values are stored in base units: m, m/s, s, K, mb, L, kg, kg·m, degrees.
 * A dimension lists its units in the order CONV UNIT / SET UNIT cycles them;
 * dp is the number of decimals the CX-3 shows for that dimension. */
(function (root) {
  'use strict';

  // u(name, factor, offset, format): base = x * factor + offset
  function u(name, factor, offset, fmt) { return { name: name, f: factor == null ? 1 : factor, o: offset || 0, fmt: fmt || null }; }

  var KT = 1852 / 3600, GAL = 3.7854118, LB = 0.45359237;

  var DIMS = {
    air_speed:    { dp: 2, units: [u('KTS', KT), u('MPH', 0.44704), u('KPH', 1 / 3.6)] },
    ground_speed: { dp: 2, units: [u('KTS', KT), u('KPH', 1 / 3.6), u('MPH', 0.44704)] },
    climb_rate:   { dp: 2, units: [u('M/S'), u('FPM', 0.3048 / 60)] },
    distance:     { dp: 2, units: [u('NM', 1852), u('KM', 1000), u('SM', 1609.344), u('M'), u('FT', 0.3048)] },
    distance_all: { dp: 2, units: [u('NM', 1852), u('SM', 1609.344), u('FT', 0.3048), u('IN', 0.0254),
                                   u('KM', 1000), u('M'), u('CM', 0.01)] },
    climb_angle:  { dp: 2, units: [u('M/NM', 1 / 1852), u('M/KM', 1 / 1000), u('FT/SM', 0.3048 / 1609.344),
                                   u('FT/NM', 0.3048 / 1852)] },
    altitude:     { dp: 0, units: [u('M'), u('FT', 0.3048)] },
    length:       { dp: 2, units: [u('M'), u('FT', 0.3048), u('CM', 0.01), u('IN', 0.0254)] },
    fuel_rate:    { dp: 2, units: [u('LPH', 1 / 3600), u('US GPH', GAL / 3600), u('UK GPH', 4.54609 / 3600)] },
    duration:     { dp: 2, units: [u('S'), u('MIN', 60), u('HR', 3600), u('HMS', 1, 0, 'hms')] },
    time:         { dp: 0, units: [u('UTC', 1, 0, 'clock')] },
    volume:       { dp: 2, units: [u('L'), u('US GAL', GAL), u('UK GAL', 4.54609), u('US QT', GAL / 4),
                                   u('UK QT', 4.54609 / 4)] },
    weight:       { dp: 2, units: [u('KG'), u('LBS', LB)] },
    fuel_wt_rate: { dp: 2, units: [u('KG/HR', 1 / 3600), u('LBS/HR', LB / 3600)] },
    temperature:  { dp: 0, units: [u('°C', 1, 273.15), u('°F', 5 / 9, 273.15 - 32 * 5 / 9)] },
    torque:       { dp: 2, units: [u('KG M'), u('LB-IN', LB * 0.0254)] },
    angle:        { dp: 0, units: [u('°', 1, 0, '360')] },
    angle_180:    { dp: 0, units: [u('°', 1, 0, '180')] },
    angle_dms:    { dp: 1, units: [u('°', 1, 0, '360'), u('DMS', 1, 0, 'dms')] },
    runway:       { dp: 0, units: [u('', 10)] },
    pressure:     { dp: 2, units: [u('MB'), u('IN HG', 1000 / 29.53)] },
    ratio:        { dp: 1, units: [u(':1')] },
    percent:      { dp: 1, units: [u('%', 0.01)] },
    mach:         { dp: 3, units: [u('')] },
    calibration:  { dp: 2, units: [u('')] },
    number:       { dp: 0, units: [u('')] },
    entry:        { dp: 0, units: [u('')] },
    // settings-like enumerations: the "unit" is the value shown
    fuel_type:    { dp: 0, units: [u('Av Gas', 6.0 / 8.3454), u('Jet Fuel', 6.84 / 8.3454), u('Oil', 7.5 / 8.3454)], choice: true },
    turn_dir:     { dp: 0, units: [u('Right'), u('Left')], choice: true },
    on_off:       { dp: 0, units: [u('off'), u('on')], choice: true }
  };

  // SET > Default Units: unit used for each dimension
  var DEFAULTS = {
    us: { ground_speed: 'KTS', air_speed: 'KTS', distance: 'NM', distance_all: 'NM', altitude: 'FT', length: 'IN',
          duration: 'HR', temperature: '°F', pressure: 'IN HG', fuel_rate: 'US GPH', volume: 'US GAL',
          climb_rate: 'FPM', climb_angle: 'FT/NM', weight: 'LBS', torque: 'LB-IN', angle_dms: 'DMS',
          fuel_wt_rate: 'LBS/HR' },
    metric: { ground_speed: 'KTS', air_speed: 'KTS', distance: 'NM', distance_all: 'NM', altitude: 'M', length: 'M',
          duration: 'HR', temperature: '°C', pressure: 'MB', fuel_rate: 'LPH', volume: 'L',
          climb_rate: 'M/S', climb_angle: 'M/NM', weight: 'KG', torque: 'KG M', angle_dms: 'DMS',
          fuel_wt_rate: 'KG/HR' }
  };

  function unitIndex(dim, name) {
    var us = DIMS[dim].units;
    for (var i = 0; i < us.length; i++) if (us[i].name === name) return i;
    return 0;
  }
  function defaultIndex(dim, metric) {
    var n = (metric ? DEFAULTS.metric : DEFAULTS.us)[dim];
    return n == null ? 0 : unitIndex(dim, n);
  }

  function toBase(unit, x) { return x * unit.f + unit.o; }
  function fromBase(unit, b) { return (b - unit.o) / unit.f; }

  var MAX_CHARS = 9, DAY = 86400;

  // H:MM:SS with whole seconds dropped (not rounded), as the CX-3 does
  function hms(sec, padHour) {
    var neg = sec < 0, a = Math.floor(Math.abs(sec) + 1e-7);
    var h = Math.floor(a / 3600), m = Math.floor(a / 60) % 60, s = a % 60;
    var hs = String(h); if (padHour && hs.length < 2) hs = '0' + hs;
    return (neg && a > 0 ? '-' : '') + hs + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  // Display text for a base value in a unit (dimension precision)
  function format(dim, unit, b) {
    if (b == null || !isFinite(b)) return '--';
    var x = fromBase(unit, b);
    switch (unit.fmt) {
      case 'hms': return Math.abs(x) >= 1e5 * 3600 ? 'E' : hms(x, false);
      case 'clock': return hms(((x % DAY) + DAY) % DAY, true);
      case 'dms': return hms((((x * 3600) % 1296000) + 1296000) % 1296000, false);
      case '360': x = ((x % 360) + 360) % 360; break;
    }
    var dp = DIMS[dim].dp, s = x.toFixed(dp);
    if (s.length > MAX_CHARS && dp > 0) s = x.toFixed(0);
    if (s.length > MAX_CHARS) s = x.toExponential(1);
    if (/^-0(\.0*)?$/.test(s)) s = s.slice(1);
    return s;
  }

  // Parse what was typed ("1:30", "12.5", "-3") in a unit; NaN when invalid
  function parse(dim, unit, text) {
    if (!text || text === '-' || text === '.') return NaN;
    var x;
    if (unit.fmt === 'hms' || unit.fmt === 'clock' || unit.fmt === 'dms') {
      var neg = text.charAt(0) === '-', p = text.replace('-', '').split(':');
      x = (parseFloat(p[0]) || 0) * 3600 + (parseFloat(p[1]) || 0) * 60 + (parseFloat(p[2]) || 0);
      if (neg) x = -x;
      if (unit.fmt === 'dms') { x = ((x % 1296000) + 1296000) % 1296000; return x / 3600; }
      if (unit.fmt === 'clock') x = ((x % DAY) + DAY) % DAY;
      return x;
    }
    x = parseFloat(text);
    if (!isFinite(x)) return NaN;
    if (unit.fmt === '360') x = ((x % 360) + 360) % 360;
    if (unit.fmt === '180') { x = ((x % 360) + 360) % 360; if (x > 180) x -= 360; }
    return toBase(unit, x);
  }

  /* Typing into an H:M:S (or D:M:S) entry: colons are inserted automatically
   * after the hours and minutes; ":" pads a single digit with a zero. */
  function hmsType(buf, c) {
    var neg = buf.charAt(0) === '-', t = neg ? buf.slice(1) : buf;
    var c1 = t.indexOf(':'); if (c1 < 0) c1 = 2;
    if (t.length >= c1 + 6) return buf;
    var i = t.length;
    if (c === ':') {
      if (i === 0 || i === c1 + 1) t += '00';
      else if (i === 1 || i === c1 + 2) t = t.slice(0, -1) + '0' + t.slice(-1);
      if (i <= c1 || i === c1 + 3) t += ':';
    } else {
      if (i === c1 || i === c1 + 3) t += ':';
      t += c;
    }
    return (neg ? '-' : '') + t;
  }

  var Units = { DIMS: DIMS, DEFAULTS: DEFAULTS, unitIndex: unitIndex, defaultIndex: defaultIndex,
                toBase: toBase, fromBase: fromBase, format: format, parse: parse, hms: hms, hmsType: hmsType };
  root.Units = Units;
  if (typeof module !== 'undefined') module.exports = Units;
})(typeof window !== 'undefined' ? window : globalThis);
