/* A synthetic Open-Meteo response: 48 hourly steps from 2026-10-04 00Z, ISA
 * temperatures. Default wind: 270° at 20 kt below 700 hPa, 30 kt above.
 * With lats/lons given, each location gets its own wind (direction and speed
 * from its position, calm where the speed works out under 3 kt). */
'use strict';
const Winds = require('../../js/winds.js');
const Z = { 1000: 110, 975: 320, 950: 540, 925: 760, 900: 990, 850: 1460, 800: 1950, 700: 3010, 600: 4210, 500: 5570,
            400: 7180, 300: 9160, 250: 10360, 200: 11780 };
module.exports = function (nLoc, lats, lons) {
  const t0 = Date.UTC(2026, 9, 4) / 1000, loc = (j) => {
    const vary = lats && lons, la = vary ? lats[j] : 0, lo = vary ? lons[j] : 0;
    const dir = vary ? ((Math.abs(la * 37.3 + lo * 11.7) % 360) + 360) % 360 : 270;
    let spd = vary ? Math.abs(la * 3.1 + lo * 1.7) % 45 : 20;
    if (spd < 3) spd = 0;
    const H = { time: [] };
    for (let i = 0; i < 48; i++) H.time.push(t0 + i * 3600);
    Winds.LEVELS.forEach(p => {
      H['geopotential_height_' + p + 'hPa'] = H.time.map(() => Z[p]);
      H['wind_speed_' + p + 'hPa'] = H.time.map((t, i) => (vary ? spd * (1 + 0.004 * i) : p >= 700 ? 20 : 30));
      H['wind_direction_' + p + 'hPa'] = H.time.map((t, i) => (vary ? (dir + i) % 360 : 270));
      H['temperature_' + p + 'hPa'] = H.time.map(() => 15 - 0.0065 * Z[p]);
    });
    return { latitude: 0, longitude: 0, hourly: H };
  };
  return nLoc === 1 && !lats ? loc(0) : Array.from({ length: nLoc }, (x, j) => loc(j));
};
