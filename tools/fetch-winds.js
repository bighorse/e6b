/* Fetches the US winds and temperatures aloft forecast (FB, aviationweather.gov)
 * for 6, 12 and 24 hours and writes data/winds.json for the route helper
 * (the page cannot read aviationweather.gov itself: it sends no CORS header).
 * Station positions come from data/nav (build it first: tools/build-navdata.js).
 * Run: node tools/fetch-winds.js [site dir]   (default: the repository) */
'use strict';
const fs = require('fs'), path = require('path'), https = require('https');
const Winds = require('../js/winds.js');
const dir = process.argv[2] || path.join(__dirname, '..');

function get(url) {
  return new Promise((res, rej) => https.get(url, { headers: { 'User-Agent': 'cx3-simulator (github.com/bighorse/e6b)' } }, r => {
    if (r.statusCode !== 200) return rej(new Error(url + ' ' + r.statusCode));
    let b = ''; r.setEncoding('utf8'); r.on('data', d => (b += d)); r.on('end', () => res(b));
  }).on('error', rej));
}
const shards = {};
function lookup(id) {
  const s = id[0];
  if (!(s in shards)) { try { shards[s] = JSON.parse(fs.readFileSync(path.join(dir, 'data/nav', s + '.json'), 'utf8')); } catch (e) { shards[s] = {}; } }
  return shards[s][id] || [];
}
// an FB station id is a US navaid or airport identifier
function coord(id) {
  const vor = lookup(id).find(e => e[4] === 'V' && e[6] === 'US') || lookup(id).find(e => e[6] === 'US');
  if (vor) return [vor[1], vor[2]];
  for (const p of ['K', 'P']) { const a = lookup(p + id).find(e => e[4] === 'A'); if (a) return [a[1], a[2]]; }
  return null;
}

(async () => {
  const periods = [], coords = {}, now = Date.now();
  for (const f of ['06', '12', '24']) {
    let text;
    for (let i = 0; i < 3 && !text; i++) {
      try { text = await get('https://aviationweather.gov/api/data/windtemp?region=all&level=low&fcst=' + f); }
      catch (e) { console.error(e.message); await new Promise(r => setTimeout(r, 5000)); }
    }
    if (!text) continue;
    const p = Winds.parseFB(text, now);
    if (!Object.keys(p.stations).length) continue;
    p.fcst = f;
    periods.push(p);
    for (const id of Object.keys(p.stations)) if (!(id in coords)) coords[id] = coord(id);
  }
  if (!periods.length) { console.error('no FB forecast fetched'); process.exit(1); }
  const missing = Object.keys(coords).filter(k => !coords[k]);
  if (missing.length) console.error('no position for', missing.join(' '));
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'data', 'winds.json'), JSON.stringify({ fetched: now, coords, periods }));
  console.log('FB periods', periods.map(p => p.fcst).join(','), 'stations', Object.keys(coords).length);
})();
