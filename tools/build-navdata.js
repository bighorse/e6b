/* Builds data/nav/<first char>.json from OurAirports (public domain):
 * every airport (small, medium, large, seaplane base) and navaid, keyed by the
 * codes a pilot may type (ICAO, IATA, FAA local code, navaid ident).
 * Entry: [ident, lat, lon, elevation ft, kind, name, country]
 *   kind: A airport · V VOR/VORTAC/VOR-DME/TACAN · N NDB · D DME
 * Run: node tools/build-navdata.js [airports.csv navaids.csv]   (downloads when no files given) */
'use strict';
const fs = require('fs'), path = require('path'), https = require('https');
const SRC = 'https://davidmegginson.github.io/ourairports-data/';

function get(url) {
  return new Promise((res, rej) => https.get(url, r => {
    if (r.statusCode !== 200) return rej(new Error(url + ' ' + r.statusCode));
    let b = ''; r.setEncoding('utf8'); r.on('data', d => (b += d)); r.on('end', () => res(b));
  }).on('error', rej));
}
// RFC 4180 CSV → array of objects
function csv(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const h = rows.shift();
  return rows.filter(r => r.length === h.length).map(r => Object.fromEntries(h.map((k, i) => [k, r[i]])));
}

(async () => {
  const [ap, nv] = process.argv[2]
    ? [fs.readFileSync(process.argv[2], 'utf8'), fs.readFileSync(process.argv[3], 'utf8')]
    : [await get(SRC + 'airports.csv'), await get(SRC + 'navaids.csv')];
  const keys = {};
  const add = (k, e) => { k = (k || '').trim().toUpperCase(); if (!/^[A-Z0-9]{2,5}$/.test(k)) return; (keys[k] = keys[k] || []).push(e); };
  const r4 = x => Math.round(parseFloat(x) * 1e4) / 1e4;
  const KEEP = new Set(['small_airport', 'medium_airport', 'large_airport', 'seaplane_base']);
  for (const a of csv(ap)) {
    if (!KEEP.has(a.type) || !a.latitude_deg) continue;
    const e = [a.ident, r4(a.latitude_deg), r4(a.longitude_deg), a.elevation_ft ? +a.elevation_ft : null, 'A', a.name, a.iso_country];
    const seen = new Set();
    for (const k of [a.ident, a.icao_code, a.gps_code, a.iata_code, a.local_code]) { const u = (k || '').toUpperCase(); if (u && !seen.has(u)) { seen.add(u); add(u, e); } }
  }
  for (const n of csv(nv)) {
    if (!n.latitude_deg) continue;
    const kind = /VOR|TACAN/.test(n.type) ? 'V' : /NDB/.test(n.type) ? 'N' : 'D';
    add(n.ident, [n.ident, r4(n.latitude_deg), r4(n.longitude_deg), n.elevation_ft ? +n.elevation_ft : null, kind, n.name + ' ' + n.type, n.iso_country]);
  }
  const out = path.join(__dirname, '..', 'data', 'nav');
  fs.mkdirSync(out, { recursive: true });
  const shards = {};
  for (const k of Object.keys(keys).sort()) (shards[k[0]] = shards[k[0]] || {})[k] = keys[k];
  let total = 0;
  for (const s of Object.keys(shards)) {
    const t = JSON.stringify(shards[s]); total += t.length;
    fs.writeFileSync(path.join(out, s + '.json'), t);
  }
  console.log(Object.keys(keys).length, 'codes,', Object.keys(shards).length, 'files,', Math.round(total / 1024), 'KB');
})();
