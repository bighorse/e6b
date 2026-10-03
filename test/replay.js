/* Replays key-level scenarios on the model (no browser): the shared helper for
 * test/model.test.js. A step types text into a row (as the keys would: the
 * value is cleared at the first key, set on ENTER), presses C, or turns a
 * choice (ENTER on Turn Dir / Type). Rows come back as [label, value, unit, icon]. */
'use strict';
const U = global.Units = require('../js/units.js');
require('../js/engine.js');
const Md = require('../js/model.js');

function unitOf(v) { return U.DIMS[v.dim].units[v.unit ? U.unitIndex(v.dim, v.unit) : U.defaultIndex(v.dim, false)]; }
function typed(v, text) {
  const u = unitOf(v), hms = u.fmt === 'hms' || u.fmt === 'clock' || u.fmt === 'dms';
  const neg = text[0] === '-';
  let buf = '';
  for (const c of text.replace('-', '')) buf = hms ? U.hmsType(buf, c) : buf + c;
  return U.parse(v.dim, u, (neg ? '-' : '') + buf);
}
function row(r) {
  if (!r.v) return [r.h, '', r.act || '', ''];
  const v = r.v, d = U.DIMS[v.dim];
  const icon = !v.has ? 'question' : v.computed ? 'equals' : v.copied ? 'global' : 'check';
  if (d.choice) return [v.label, d.units[Md.choiceIndex(v)].name, '', icon];
  if (v.dim === 'entry') return [v.label, v.has ? Md.ENTRY_NAMES[v.v] : '--', '', icon];
  return [v.label, U.format(v.dim, unitOf(v), v.has ? v.v : null), unitOf(v).name, icon];
}
function replay(sc) {
  Md.reset();
  const rows = Md.screenRows(sc.screen);
  for (const st of sc.steps) {
    const v = rows[st.row].v;
    if (st.rotate) Md.setChoice(v, (Md.choiceIndex(v) + 1) % U.DIMS[v.dim].units.length);
    else if (st.clear) v.clear();
    else { v.clear(); const x = typed(v, st.text); if (!isNaN(x)) { v.locked = false; v.set(x, false); } }
  }
  return rows.map(row);
}
module.exports = { replay, Md, U };
