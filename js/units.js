/* CX-3 unit system.
 * Every value is stored internally in a base unit. A unit converts with
 * toBase(x) / fromBase(x); linear units only declare a factor (base per unit). */
(function (root) {
  'use strict';

  function lin(name, factor, dp) {
    return {
      name: name, dp: dp,
      toBase: function (x) { return x * factor; },
      fromBase: function (x) { return x / factor; }
    };
  }
  function id(x) { return x; }
  function fn(name, toBase, fromBase, dp) {
    return { name: name, toBase: toBase, fromBase: fromBase, dp: dp };
  }

  var FT_PER_NM = 6076.11549;

  var TYPES = {
    // base: nautical miles
    dist: [lin('nm', 1, 1), lin('sm', 0.868976242, 1), lin('km', 0.539956803, 1),
           lin('ft', 1 / FT_PER_NM, 0), lin('m', 1 / 1852, 0)],
    // base: feet
    alt: [lin('ft', 1, 0), lin('m', 3.280839895, 0)],
    // base: knots
    speed: [lin('kts', 1, 0), lin('mph', 0.868976242, 0), lin('km/h', 0.539956803, 0),
            lin('m/s', 1.943844492, 1)],
    // base: feet per minute
    vs: [lin('ft/min', 1, 0), lin('m/s', 196.8503937, 2), lin('m/min', 3.280839895, 0)],
    // base: degrees Celsius
    temp: [lin('°C', 1, 1),
           fn('°F', function (f) { return (f - 32) / 1.8; }, function (c) { return c * 1.8 + 32; }, 1),
           fn('K', function (k) { return k - 273.15; }, function (c) { return c + 273.15; }, 1)],
    // base: inches of mercury
    press: [lin('inHg', 1, 2), lin('hPa', 1 / 33.8638866, 0), lin('mb', 1 / 33.8638866, 0),
            lin('psi', 2.036020657, 2), lin('mmHg', 1 / 25.4, 1)],
    // base: US gallons
    vol: [lin('gal', 1, 1), lin('L', 0.264172052, 1), lin('Imp gal', 1.200949925, 1),
          lin('qt', 0.25, 1)],
    // base: pounds
    weight: [lin('lbs', 1, 1), lin('kg', 2.204622622, 1), lin('oz', 1 / 16, 1)],
    // base: US gallons per hour
    rate: [lin('gal/hr', 1, 1), lin('L/hr', 0.264172052, 1), lin('Imp gal/hr', 1.200949925, 1)],
    // base: feet per nautical mile (angle of climb / descent)
    grad: [lin('ft/nm', 1, 0),
           fn('%', function (p) { return p / 100 * FT_PER_NM; }, function (g) { return g / FT_PER_NM * 100; }, 2),
           fn('°', function (d) { return Math.tan(d * Math.PI / 180) * FT_PER_NM; },
                   function (g) { return Math.atan(g / FT_PER_NM) * 180 / Math.PI; }, 2),
           // 1 m/km = 1.852 m/nm = 6.076 ft/nm
           lin('m/km', 1.852 * 3.280839895, 1)],
    // base: foot-pounds
    torque: [lin('ft-lbs', 1, 1), lin('N-m', 0.737562149, 1), lin('in-lbs', 1 / 12, 1)],
    // base: degrees
    angle: [lin('deg', 1, 2), lin('rad', 180 / Math.PI, 4), lin('grad', 0.9, 2)],
    // base: hours
    dur: [fn('h:m:s', id, id, 0), lin('hr', 1, 2), lin('min', 1 / 60, 1), lin('sec', 1 / 3600, 0)],
    // base: inches (W/B arm, MAC)
    arm: [lin('in', 1, 2), lin('cm', 0.393700787, 1), lin('mm', 0.0393700787, 0)],
    // base: lb-in
    mom: [lin('lb-in', 1, 1), lin('kg-cm', 2.204622622 * 0.393700787, 1)]
  };
  // Metric defaults when SET > Units = Metric
  var METRIC_DEFAULT = { dist: 2, alt: 1, speed: 2, vs: 1, press: 1, vol: 1, weight: 1,
                         rate: 1, arm: 1, mom: 1, torque: 1 };

  // Category list for FLT > Unit Conversions (12 categories)
  var CONVERSIONS = [
    { title: 'Distance', type: 'dist' },
    { title: 'Speed', type: 'speed' },
    { title: 'Duration', type: 'dur' },
    { title: 'Temperature', type: 'temp' },
    { title: 'Pressure', type: 'press' },
    { title: 'Volume', type: 'vol' },
    { title: 'Rate', type: 'rate' },
    { title: 'Weight', type: 'weight' },
    { title: 'Rate of Climb', type: 'vs' },
    { title: 'Angle of Climb', type: 'grad' },
    { title: 'Torque', type: 'torque' },
    { title: 'Angle', type: 'angle' }
  ];

  var Units = { TYPES: TYPES, METRIC_DEFAULT: METRIC_DEFAULT, CONVERSIONS: CONVERSIONS,
                FT_PER_NM: FT_PER_NM };
  root.Units = Units;
  if (typeof module !== 'undefined') module.exports = Units;
})(typeof window !== 'undefined' ? window : globalThis);
