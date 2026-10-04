/* A synthetic Open-Meteo response: 48 hourly steps from 2026-10-04 00Z, wind
 * from 270° at 20 kt below 700 hPa and 30 kt above, ISA temperatures. */
'use strict';
const Winds = require('../../js/winds.js');
const Z = { 1000: 110, 975: 320, 950: 540, 925: 760, 900: 990, 850: 1460, 800: 1950, 700: 3010, 600: 4210, 500: 5570,
            400: 7180, 300: 9160, 250: 10360, 200: 11780 };
module.exports = function (nLoc) {
  const t0 = Date.UTC(2026, 9, 4) / 1000, loc = () => {
    const H = { time: [] };
    for (let i = 0; i < 48; i++) H.time.push(t0 + i * 3600);
    Winds.LEVELS.forEach(p => {
      H['geopotential_height_' + p + 'hPa'] = H.time.map(() => Z[p]);
      H['wind_speed_' + p + 'hPa'] = H.time.map(() => (p >= 700 ? 20 : 30));
      H['wind_direction_' + p + 'hPa'] = H.time.map(() => 270);
      H['temperature_' + p + 'hPa'] = H.time.map(() => 15 - 0.0065 * Z[p]);
    });
    return { latitude: 0, longitude: 0, hourly: H };
  };
  return nLoc === 1 ? loc() : Array.from({ length: nLoc }, loc);
};
