/* Magnetic variation from the World Magnetic Model WMM2025 (NOAA / NGA,
 * public domain; valid 2025.0 – 2030.0). Own implementation of the model's
 * spherical-harmonic sum. Declination: degrees, east positive.
 * On the CX-3, variation is entered west positive: Var = −declination. */
(function (root) {
  'use strict';
  var EPOCH = 2025.0, NMAX = 12;
  // g, h, dg/dt, dh/dt (nT, nT/yr) for n = 1..12, m = 0..n
  var C = [
    -29351.8,0,12,0,
    -1410.8,4545.4,9.7,-21.5,
    -2556.6,0,-11.6,0,
    2951.1,-3133.6,-5.2,-27.7,
    1649.3,-815.1,-8,-12.1,
    1361,0,-1.3,0,
    -2404.1,-56.6,-4.2,4,
    1243.8,237.5,0.4,-0.3,
    453.6,-549.5,-15.6,-4.1,
    895,0,-1.6,0,
    799.5,278.6,-2.4,-1.1,
    55.7,-133.9,-6,4.1,
    -281.1,212,5.6,1.6,
    12.1,-375.6,-7,-4.4,
    -233.2,0,0.6,0,
    368.9,45.4,1.4,-0.5,
    187.2,220.2,0,2.2,
    -138.7,-122.9,0.6,0.4,
    -142,43,2.2,1.7,
    20.9,106.1,0.9,1.9,
    64.4,0,-0.2,0,
    63.8,-18.4,-0.4,0.3,
    76.9,16.8,0.9,-1.6,
    -115.7,48.8,1.2,-0.4,
    -40.9,-59.8,-0.9,0.9,
    14.9,10.9,0.3,0.7,
    -60.7,72.7,0.9,0.9,
    79.5,0,0,0,
    -77,-48.9,-0.1,0.6,
    -8.8,-14.4,-0.1,0.5,
    59.3,-1,0.5,-0.8,
    15.8,23.4,-0.1,0,
    2.5,-7.4,-0.8,-1,
    -11.1,-25.1,-0.8,0.6,
    14.2,-2.3,0.8,-0.2,
    23.2,0,-0.1,0,
    10.8,7.1,0.2,-0.2,
    -17.5,-12.6,0,0.5,
    2,11.4,0.5,-0.4,
    -21.7,-9.7,-0.1,0.4,
    16.9,12.7,0.3,-0.5,
    15,0.7,0.2,-0.6,
    -16.8,-5.2,0,0.3,
    0.9,3.9,0.2,0.2,
    4.6,0,0,0,
    7.8,-24.8,-0.1,-0.3,
    3,12.2,0.1,0.3,
    -0.2,8.3,0.3,-0.3,
    -2.5,-3.3,-0.3,0.3,
    -13.1,-5.2,0,0.2,
    2.4,7.2,0.3,-0.1,
    8.6,-0.6,-0.1,-0.2,
    -8.7,0.8,0.1,0.4,
    -12.9,10,-0.1,0.1,
    -1.3,0,0.1,0,
    -6.4,3.3,0,0,
    0.2,0,0.1,0,
    2,2.4,0.1,-0.2,
    -1,5.3,0,0.1,
    -0.6,-9.1,-0.3,-0.1,
    -0.9,0.4,0,0.1,
    1.5,-4.2,-0.1,0,
    0.9,-3.8,-0.1,-0.1,
    -2.7,0.9,0,0.2,
    -3.9,-9.1,0,0,
    2.9,0,0,0,
    -1.5,0,0,0,
    -2.5,2.9,0,0.1,
    2.4,-0.6,0,0,
    -0.6,0.2,0,0.1,
    -0.1,0.5,-0.1,0,
    -0.6,-0.3,0,0,
    -0.1,-1.2,0,0.1,
    1.1,-1.7,-0.1,0,
    -1,-2.9,-0.1,0,
    -0.2,-1.8,-0.1,0,
    2.6,-2.3,-0.1,0,
    -2,0,0,0,
    -0.2,-1.3,0,0,
    0.3,0.7,0,0,
    1.2,1,0,-0.1,
    -1.3,-1.4,0,0.1,
    0.6,0,0,0,
    0.6,0.6,0.1,0,
    0.5,-0.1,0,0,
    -0.1,0.8,0,0,
    -0.4,0.1,0,0,
    -0.2,-1,-0.1,0,
    -1.3,0.1,0,0,
    -0.7,0.2,-0.1,-0.1
  ];
  var D2R = Math.PI / 180;

  // Schmidt semi-normalised associated Legendre functions P[n][m](x)
  function legendre(x) {
    var c = Math.sqrt(Math.max(0, 1 - x * x)), P = [[1], [x, c]];
    for (var n = 2; n <= NMAX; n++) {
      P[n] = [];
      for (var m = 0; m < n; m++) {
        var p2 = m <= n - 2 ? P[n - 2][m] : 0;
        P[n][m] = ((2 * n - 1) * x * P[n - 1][m] - Math.sqrt((n - 1) * (n - 1) - m * m) * p2) / Math.sqrt(n * n - m * m);
      }
      P[n][n] = Math.sqrt((2 * n - 1) / (2 * n)) * c * P[n - 1][n - 1];
    }
    return P;
  }

  // field components (north, east, down) in geocentric spherical coordinates
  function field(phic, lam, r, t) {
    var dt = t - EPOCH, ar = 6371.2 / r, X = 0, Y = 0, Z = 0, i = 0, e = 1e-7;
    var P = legendre(Math.sin(phic)), Pp = legendre(Math.sin(phic + e)), Pm = legendre(Math.sin(phic - e));
    for (var n = 1; n <= NMAX; n++) {
      var k = Math.pow(ar, n + 2);
      for (var m = 0; m <= n; m++, i++) {
        var c = C[4 * i], s = C[4 * i + 1], g = c + dt * C[4 * i + 2], h = s + dt * C[4 * i + 3];
        var cm = Math.cos(m * lam), sm = Math.sin(m * lam);
        var dP = (Pp[n][m] - Pm[n][m]) / (2 * e);
        X -= k * (g * cm + h * sm) * dP;
        Y += k * m * (g * sm - h * cm) * P[n][m] / Math.cos(phic);
        Z -= (n + 1) * k * (g * cm + h * sm) * P[n][m];
      }
    }
    return { X: X, Y: Y, Z: Z };
  }

  function decimalYear(date) {
    var y = date.getUTCFullYear(), a = Date.UTC(y, 0, 1), b = Date.UTC(y + 1, 0, 1);
    return y + (date.getTime() - a) / (b - a);
  }

  /** declination (deg, east +) at geodetic lat/lon (deg, north/east +), altitude ft MSL, date */
  function declination(lat, lon, altFt, date) {
    var t = decimalYear(date || new Date()), h = (altFt || 0) * 0.0003048;
    var a = 6378.137, f = 1 / 298.257223563, e2 = f * (2 - f), phi = lat * D2R;
    var Rc = a / Math.sqrt(1 - e2 * Math.sin(phi) * Math.sin(phi));
    var p = (Rc + h) * Math.cos(phi), z = (Rc * (1 - e2) + h) * Math.sin(phi);
    var r = Math.sqrt(p * p + z * z), phic = Math.asin(z / r);
    var F = field(phic, lon * D2R, r, t);
    // rotate north into the geodetic frame (east is unchanged)
    var X = F.X * Math.cos(phic - phi) - F.Z * Math.sin(phic - phi);
    return Math.atan2(F.Y, X) / D2R;
  }

  var WMM = { declination: declination, valid: [2025.0, 2030.0] };
  root.WMM = WMM;
  if (typeof module !== 'undefined') module.exports = WMM;
})(typeof window !== 'undefined' ? window : globalThis);
