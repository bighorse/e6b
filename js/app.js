/* CX-3 Flight Computer simulator — UI engine */
(function () {
  'use strict';

  var U = window.Units, Md = window.Model, CC = window.CalcCore, VARS = Md.vars;

  var STORE_KEY = 'cx3-sim-v3', SAVED_KEY = 'cx3-sim-v3-userdata';
  var ROW_H = 25.5;            // list row height on the 320×240 display
  var VERSION = '1.2';
  var AUTO_OFF_MIN = 10;       // the CX-3 turns itself off after 10 minutes without a key

  var THEMES = ['Standard', 'Night', 'Daylight'];
  var BACKLIGHT = ['Normal', 'Daylight', 'Night', 'Dusk'];
  // Time zones (hours from UTC)
  var ZONES = [0, 1, 2, 3, 3.5, 4, 4.5, 5, 5.5, 5.75, 6, 6.5, 7, 8, 9, 9.5, 10, 11, 12, 13, 14,
               -12, -11, -10, -9.5, -9, -8, -7, -6, -5, -4, -3.5, -3, -2, -1];
  function zoneName(z) {
    if (!z) return 'UTC';
    var a = Math.abs(z), h = Math.floor(a), m = Math.round((a - h) * 60);
    return 'UTC' + (z > 0 ? '+' : '-') + h + (m ? ':' + (m < 10 ? '0' : '') + m : '');
  }

  // ------------------------------------------------------------------ state
  function freshState() {
    return { set: { theme: 0, backlight: 0, units: 0, unitmode: 0, fav: null, zl: 0, zd: 0, clock: 0 },
             model: null, units: {}, calc: CC.freshState(), mem: null,
             tm: { running: false, start: 0, acc: 0, set: 0 } };
  }
  var S = freshState();
  function loadState(o) {
    var s = freshState();
    if (o && typeof o === 'object') {
      Object.keys(s).forEach(function (k) { if (o[k] != null) s[k] = o[k]; });
      s.set = Object.assign(freshState().set, o.set || {});
      if (!s.calc || !Array.isArray(s.calc.tape)) s.calc = CC.freshState();
      s.tm = Object.assign(freshState().tm, o.tm || {});
    }
    Md.loadState(s.model);
    return s;
  }
  try { S = loadState(JSON.parse(localStorage.getItem(STORE_KEY) || 'null')); } catch (e) { S = loadState(null); }

  var V = { power: false, booting: false, stack: [], edit: null, toast: null,
            lastKey: Date.now(), enterDown: 0, offTimer: null };

  var saveTimer = null;
  function saveNow() {
    clearTimeout(saveTimer); saveTimer = null;
    S.model = Md.saveState();
    try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) { /* ignore */ }
  }
  function save() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 200); }
  // flush when the page is hidden or closed (iOS may end a backgrounded web app at any time)
  window.addEventListener('pagehide', saveNow);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') saveNow(); });

  function top() { return V.stack[V.stack.length - 1]; }
  function toast(t, ms) { V.toast = { text: t, until: Date.now() + (ms || 1400) }; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  // ------------------------------------------------------------------ clock
  // S.set.clock: seconds added to the computer's clock (Time Set)
  function utcSec() { var t = Date.now() / 1000 + (S.set.clock || 0); return ((t % 86400) + 86400) % 86400; }
  function zoneSec(z) { return (((utcSec() + z * 3600) % 86400) + 86400) % 86400; }
  function hhmm(sec) { return pad(Math.floor(sec / 3600)) + ':' + pad(Math.floor(sec / 60) % 60); }

  // ------------------------------------------------------------------ units
  function dimOf(v) { return U.DIMS[v.dim]; }
  function unitKeyInd(scr, v) { return scr + '.' + v.id; }
  function unitKeyDim(scr, v) { return scr + '#' + v.dim; }
  function unitIdx(scr, v) {
    var a = S.units[unitKeyInd(scr, v)], b = S.units[unitKeyDim(scr, v)];
    if (S.set.unitmode === 1 && a != null) return a;
    if (b != null) return b;
    if (a != null) return a;
    if (v.unit) return U.unitIndex(v.dim, v.unit);
    return U.defaultIndex(v.dim, S.set.units === 1);
  }
  function unitOf(scr, v) { return dimOf(v).units[unitIdx(scr, v)]; }
  function setUnit(scr, v, i) {
    if (S.set.unitmode === 1) S.units[unitKeyInd(scr, v)] = i;
    else { S.units[unitKeyDim(scr, v)] = i; delete S.units[unitKeyInd(scr, v)]; }
  }
  function isHms(u) { return u.fmt === 'hms' || u.fmt === 'clock' || u.fmt === 'dms'; }

  // ------------------------------------------------------------- navigation
  function setStack(scr) { V.edit = null; V.stack = [scr]; }
  function push(scr) { V.edit = null; V.stack.push(scr); }
  function back() {
    if (V.edit) { V.edit = null; return; }
    if (V.stack.length > 1) V.stack.pop();
  }
  // FLT, W/B and PLAN reopen where they were left
  var MENU_SEL = {};
  function listScr(type, id, sel) {
    var s = { type: type, id: id, sel: sel != null ? sel : MENU_SEL[id] || 0, scroll: 0 };
    if (sel == null && MENU_SEL[id + '_s'] != null) s.scroll = MENU_SEL[id + '_s'];
    return s;
  }
  function eqScr(id) {
    var s = { type: 'eq', id: id, sel: 0, scroll: 0 }, rows = eqRows(s);
    while (s.sel < rows.length && !selectable(rows[s.sel])) s.sel++;
    return s;
  }
  function openScreen(id) {
    if (id === 'wb' && Md.profileOn()) id = 'wbp';
    push(eqScr(id));
  }
  function keepVisible(scr, n, viewH) {
    var y = scr.sel * ROW_H, max = Math.max(0, n * ROW_H - viewH);
    if (y < scr.scroll) scr.scroll = y;
    if (y + ROW_H > scr.scroll + viewH) scr.scroll = y + ROW_H - viewH;
    scr.scroll = Math.max(0, Math.min(scr.scroll, max));
  }
  // UP / DOWN stop at the ends of a list (no wrap-around), skipping lines that cannot be selected
  function listMove(scr, k, n, ok) {
    var d = k === 'UP' ? -1 : 1;
    for (var i = scr.sel + d; i >= 0 && i < n; i += d) if (!ok || ok(i)) { scr.sel = i; return; }
  }

  // ------------------------------------------------------------ menus / lists
  var TITLES = {};
  Object.keys(Md.SCREENS).forEach(function (k) { TITLES[k] = Md.SCREENS[k].title; });

  // each list screen: items [{l, r, run}] and the status bar title
  var LISTS = {
    FLT: function () {
      return { tag: 'E6-B', items: Md.FLT_LIST.map(function (id) { return { l: TITLES[id], run: function () { openScreen(id); } }; }) };
    },
    WB: function () {
      return { tag: 'E6-B', items: Md.WB_LIST.map(function (id) { return { l: TITLES[id], run: function () { openScreen(id); } }; }) };
    },
    PLAN: function () {
      var n = Md.planState.n, it = [{ l: 'Total Trip', r: 'Review', run: function () { push(eqScr('total')); } }];
      for (var i = 0; i < n; i++) (function (i) {
        it.push({ l: 'Leg ' + (i + 1), r: 'Review & Edit', run: function () { push(eqScr('leg' + i)); } });
        if (i === n - 1) it.push({ l: '', r: 'Remove', run: function () { Md.legRemove(i); top().sel = Math.max(0, top().sel - 1); } });
      })(i);
      if (n < Md.MAX_LEGS) it.push({ l: 'Leg ' + (n + 1), r: 'Add', run: function () { var j = Md.legAdd(); push(eqScr('leg' + j)); } });
      return { tag: 'TRIP', items: it };
    },
    SET: function () {
      return { tag: 'SETTINGS', items: [
        { l: 'Theme', r: THEMES[S.set.theme], run: function () { push(listScr('list', 'THEME', S.set.theme)); } },
        { l: 'Backlighting', r: BACKLIGHT[S.set.backlight], run: function () { push(listScr('list', 'BACKLIGHT', S.set.backlight)); } },
        { l: 'Time Set', r: hhmm(zoneSec(S.set.zl)) + ' ' + zoneName(S.set.zl), run: function () { push({ type: 'timeset', sel: 1, scroll: 0 }); } },
        { l: 'Default Units', r: S.set.units ? 'Metric' : 'U. S.', run: function () { push(listScr('list', 'UNITS', S.set.units)); } },
        { l: 'Unit Changes', r: S.set.unitmode ? 'Individually' : 'Per Screen', run: function () { push(listScr('list', 'UNITMODE', S.set.unitmode)); } },
        { l: 'Favorite', r: 'Set', run: function () { push(listScr('list', 'FAV', Math.max(0, Md.FLT_LIST.indexOf(S.set.fav)))); } },
        { l: 'Aircraft Profile', r: 'Edit', run: function () { push(eqScr('profile')); } },
        { l: 'User Data', r: 'Save', run: function () { push(listScr('list', 'USERDATA', 0)); } },
        { l: 'Version', r: VERSION, run: function () {} }
      ] };
    },
    THEME: function () { return choiceList('Theme', THEMES, S.set.theme, function (i) { S.set.theme = i; }); },
    BACKLIGHT: function () { return choiceList('Backlighting', BACKLIGHT, S.set.backlight, function (i) { S.set.backlight = i; }); },
    UNITS: function () {
      return { tag: 'SETTINGS', sub: 'Default Units', items: ['U. S.', 'Metric'].map(function (l, i) {
        return { l: l, r: i === S.set.units ? 'Re-set' : 'Set', check: i === S.set.units,
                 run: function () { S.set.units = i; S.units = {}; toast('Units: ' + l); back(); } };
      }) };
    },
    UNITMODE: function () {
      return choiceList('Unit Changes', ['Per Screen', 'Individually'], S.set.unitmode, function (i) { S.set.unitmode = i; });
    },
    FAV: function () {
      return { tag: 'SETTINGS', sub: 'Select Favorite', items: Md.FLT_LIST.map(function (id) {
        return { l: TITLES[id], check: S.set.fav === id, run: function () { S.set.fav = id; toast('Favorite: ' + TITLES[id]); back(); } };
      }) };
    },
    FAVPICK: function () {
      return { tag: 'FAVORITE', sub: 'Select Favorite', items: Md.FLT_LIST.map(function (id) {
        return { l: TITLES[id], run: function () { S.set.fav = id; setStack(eqScr(id)); } };
      }) };
    },
    USERDATA: function () {
      var saved = null;
      try { saved = localStorage.getItem(SAVED_KEY); } catch (e) { /* no storage */ }
      var it = [{ l: 'Cancel', run: back },
        { l: 'Save', run: function () {
          saveNow();
          try { localStorage.setItem(SAVED_KEY, JSON.stringify(S)); toast('User Data Saved'); } catch (e) { toast('Save Failed'); }
          back();
        } }];
      if (saved) it.push({ l: 'Recall', run: function () {
        try { S = loadState(JSON.parse(saved)); toast('User Data Recalled'); } catch (e) { toast('Recall Failed'); }
        setStack(listScr('list', 'SET', 7));
      } });
      return { tag: 'SETTINGS', sub: 'User Data', items: it };
    },
    MEM: function () { return memList(); }
  };
  function choiceList(sub, names, cur, set) {
    return { tag: 'SETTINGS', sub: sub, items: names.map(function (l, i) {
      return { l: l, check: i === cur, run: function () { set(i); back(); } };
    }) };
  }

  // ---------------------------------------------------------- memory (M key)
  // One memory, as on the CX-3: Recall, Store (the value at hand) and Clear
  function memList() {
    var scr = top(), prev = V.stack[V.stack.length - 2], cur = currentValue(prev);
    var it = [];
    var memText = S.mem ? (S.mem.hms ? U.hms(S.mem.v, false) : CC.fmtCalc(S.mem.v)) : (cur && cur.hms ? '00:00:00' : '0');
    it.push({ l: 'Recall', r: memText, off: !S.mem || !canTake(prev), run: function () {
      var m = S.mem; V.stack.pop(); insertValue(top(), m);
    } });
    if (cur) it.push({ l: 'Store', r: cur.text, run: function () { S.mem = { v: cur.v, hms: cur.hms }; toast('Stored'); V.stack.pop(); } });
    it.push({ l: 'Clear', r: '', run: function () { S.mem = null; toast('Memory Cleared'); V.stack.pop(); } });
    if (scr && scr.first) { scr.first = false; scr.sel = it[0].off ? 1 : 0; }
    return { tag: 'MEMORY', items: it };
  }
  function canTake(scr) {
    if (!scr) return false;
    if (scr.type === 'calc') return true;
    if (scr.type !== 'eq') return false;
    var r = eqRows(scr)[scr.sel];
    return !!(r && r.v && !r.v.ro && !dimOf(r.v).choice);
  }
  // the value at hand: the selected field or the calculator line
  function currentValue(scr) {
    if (!scr) return null;
    if (scr.type === 'calc') {
      var x = CC.currentValue(S.calc);
      return x == null ? null : { v: x, hms: false, text: CC.fmtCalc(x) };
    }
    if (scr.type !== 'eq') return null;
    var r = eqRows(scr)[scr.sel];
    if (!r || !r.v || dimOf(r.v).choice) return null;
    var v = r.v, u = unitOf(scr.id, v);
    if (V.edit && !r.v.ro) {
      var b = commitValue(scr, v, V.edit.buf);
      if (isNaN(b)) return null;
      return { v: isHms(u) ? toUnitSec(u, b) : U.fromBase(u, b), hms: isHms(u), text: V.edit.buf };
    }
    if (!v.has) return null;
    var text = U.format(v.dim, u, v.v);
    return { v: isHms(u) ? toUnitSec(u, v.v) : Number(text) || U.fromBase(u, v.v), hms: isHms(u), text: text };
  }
  function toUnitSec(u, b) { return u.fmt === 'dms' ? b * 3600 : b; }
  function insertValue(scr, m) {
    if (!m) return;
    if (scr.type === 'calc') { CC.appendOperand(S.calc, m.hms ? CC.numStr(m.v / 3600) : CC.numStr(m.v)); return; }
    if (scr.type !== 'eq') return;
    var r = eqRows(scr)[scr.sel];
    if (!r || !r.v || r.v.ro) return;
    var u = unitOf(scr.id, r.v), text;
    if (isHms(u)) text = m.hms ? U.hms(m.v, u.fmt === 'clock') : U.hms(m.v * 3600, u.fmt === 'clock');
    else text = CC.numStr(m.hms ? m.v / 3600 : m.v);
    r.v.clear();
    V.edit = { buf: text };
  }

  // ---------------------------------------------------------- equation screens
  function eqRows(scr) { return Md.screenRows(scr.id); }
  // results can be selected (to read, convert or store them) but not typed into
  function selectable(r) { return r && (r.v ? true : !r.ro); }
  function screenTag(id) { return Md.SCREENS[id].tag || 'E6-B'; }

  // after a value is entered the cursor rolls on to the next field
  function rollOn(scr) {
    var rows = eqRows(scr);
    for (var i = scr.sel + 1; i < rows.length; i++) if (selectable(rows[i])) { scr.sel = i; return; }
  }

  // text typed into a field → base value (NaN when invalid). Arithmetic is allowed: 120+15
  function commitValue(scr, v, buf) {
    var u = unitOf(scr.id, v);
    if (isHms(u)) return U.parse(v.dim, u, buf);
    if (/[+×÷]|.-/.test(buf)) {
      var e = CC.evaluate(buf.replace(/[+\-×÷]+$/, ''));
      if (!e || e.error) return NaN;
      buf = CC.numStr(e.value);
    }
    return U.parse(v.dim, u, buf);
  }
  function commitEdit(scr) {
    var r = eqRows(scr)[scr.sel], buf = V.edit.buf;
    V.edit = null;
    if (!r || !r.v) return;
    var x = commitValue(scr, r.v, buf);
    if (!buf || isNaN(x)) return;
    r.v.locked = false;
    r.v.set(x, false);
    afterChange(scr);
  }
  function afterChange(scr) {
    if (scr.id === 'profile') {
      var pk = VARS.pk, k = VARS.k;
      if (pk.has && (!k.has || Math.abs(k.v - pk.v) > 1e-9)) {
        if (pk.v < 0.7 || pk.v > 1) { toast('K: 0.70 to 1.00'); pk.clear(); pk.set(k.has ? k.v : 1, false); }
        Md.setK();
      }
    }
    save();
  }

  function rotateChoice(scr, v) {
    var n = dimOf(v).units.length;
    Md.setChoice(v, (Md.choiceIndex(v) + 1) % n);
    afterChange(scr);
  }

  // SET UNIT re-labels the number shown in the next unit; CONV UNIT converts it
  function unitKeyPress(scr, r, convert) {
    if (!r || !r.v) return;
    var v = r.v, d = dimOf(v);
    if (d.choice) { if (!v.ro) rotateChoice(scr, v); return; }
    if (d.units.length < 2) return;
    if (v.ro && !convert) return;
    var oldU = unitOf(scr.id, v), ni = (unitIdx(scr.id, v) + 1) % d.units.length, newU = d.units[ni];
    if (!convert) {
      var text = V.edit ? V.edit.buf : v.has ? U.format(v.dim, oldU, v.v) : null;
      V.edit = null;
      setUnit(scr.id, v, ni);
      if (text != null && text !== '--') {
        var x = U.parse(v.dim, newU, text);
        if (!isNaN(x)) { v.clear(); v.set(x, false); }
      }
    } else {
      if (V.edit) commitEdit(scr);
      setUnit(scr.id, v, ni);
    }
    afterChange(scr);
  }

  function editKey(scr, r, k) {
    var v = r.v, u = unitOf(scr.id, v), hms = isHms(u), e = V.edit;
    if ('0123456789.:'.indexOf(k) >= 0) {
      if (!e) { v.clear(); e = V.edit = { buf: '' }; }
      if (k === ':' && !hms) return;
      if (hms) { if (k !== '.') e.buf = U.hmsType(e.buf, k); return; }
      var tail = e.buf.split(/[+×÷]|(?!^)-/).pop();
      if (k === '.' && tail.indexOf('.') >= 0) return;
      if (v.dim === 'runway' && e.buf.length >= 2) return;
      if (e.buf.length < 16) e.buf += k;
      return;
    }
    if ('+-×÷'.indexOf(k) >= 0) {           // arithmetic inside a field
      if (hms || !e || !e.buf || /[+\-×÷]$/.test(e.buf)) return;
      e.buf += k;
    }
  }

  var HANDLERS = {};
  HANDLERS.eq = function (scr, k) {
    var rows = eqRows(scr);
    if (scr.sel >= rows.length) scr.sel = Math.max(0, rows.length - 1);
    var r = rows[scr.sel];
    var input = r && r.v && !r.v.ro && !dimOf(r.v).choice;

    if ('0123456789.:+-×÷'.indexOf(k) >= 0) { if (input) editKey(scr, r, k); return; }
    switch (k) {
      case 'UP': case 'DOWN':
        if (V.edit) commitEdit(scr);
        return listMove(scr, k, rows.length, function (i) { return selectable(rows[i]); });
      case 'ENTER': case '=':
        if (V.edit) { commitEdit(scr); return rollOn(scr); }
        if (!r) return;
        if (r.act) return itemAction(scr, r);
        if (r.v && dimOf(r.v).choice && !r.v.ro) return rotateChoice(scr, r.v);
        return rollOn(scr);
      case 'C':
        if (V.edit) { V.edit = null; return save(); }
        if (input) { r.v.clear(); afterChange(scr); }
        return;
      case 'BKSP':
        if (!input) return;
        if (V.edit) {
          var u = unitOf(scr.id, r.v);
          V.edit.buf = isHms(u) ? V.edit.buf.replace(/:?[\d\-]$/, '') : V.edit.buf.slice(0, -1);
        } else if (r.v.has) {
          var shown = U.format(r.v.dim, unitOf(scr.id, r.v), r.v.v);
          r.v.clear(); V.edit = { buf: shown.slice(0, -1).replace(/:$/, '') };
        }
        return;
      case '+/-':
        if (!input) return;
        if (V.edit) { V.edit.buf = V.edit.buf.charAt(0) === '-' ? V.edit.buf.slice(1) : '-' + V.edit.buf; return; }
        if (r.v.has) { var nv = r.v.v; r.v.clear(); r.v.set(r.v.dim === 'temperature' ? flipTemp(scr, r.v, nv) : -nv, false); afterChange(scr); }
        return;
      case 'SQRT':
        if (!V.edit || isHms(unitOf(scr.id, r.v))) return;
        var x = CC.evaluate(V.edit.buf);
        if (x && !x.error && x.value >= 0) V.edit.buf = CC.numStr(Math.sqrt(x.value));
        return;
      case 'SETUNIT': return unitKeyPress(scr, r, false);
      case 'CONVUNIT': return unitKeyPress(scr, r, true);
    }
  };
  // ± on a temperature negates the number shown (°C / °F), not the kelvins
  function flipTemp(scr, v, b) { var u = unitOf(scr.id, v); return U.toBase(u, -U.fromBase(u, b)); }

  function itemAction(scr, r) {
    var id = scr.id;
    if (id === 'wb') {
      if (r.add) { Md.wbAdd(r.item); scr.sel += 1; }       // on to the new item's Wt
      else if (r.act === 'Remove') Md.wbRemove(r.item);
    } else if (id === 'rhumb') {
      if (r.add) { Md.rhumbAdd(); scr.sel += 1; }
      else if (r.act === 'Remove') { Md.rhumbRemove(); scr.sel = Math.min(scr.sel, eqRows(scr).length - 1); }
    }
    var n = eqRows(scr).length;
    if (scr.sel >= n) scr.sel = n - 1;
    save();
  }

  // ------------------------------------------------------------ list screens
  HANDLERS.list = function (scr, k) {
    var L = LISTS[scr.id](), items = L.items;
    if (/^(FLT|WB|PLAN)$/.test(scr.id)) { MENU_SEL[scr.id] = scr.sel; }
    if (k === 'UP' || k === 'DOWN') {
      listMove(scr, k, items.length, function (i) { return !items[i].off; });
      if (/^(FLT|WB|PLAN)$/.test(scr.id)) MENU_SEL[scr.id] = scr.sel;
      return;
    }
    if (k === 'ENTER' || k === '=') { var it = items[scr.sel]; if (it && !it.off) it.run(); return; }
    if (k === 'C' && scr.id === 'MEM') return back();
    if (/^[1-9]$/.test(k) && scr.id === 'FLT' && Number(k) <= items.length) { scr.sel = Number(k) - 1; items[scr.sel].run(); }
  };

  // ------------------------------------------------------------- Time Set
  // rows: 0 UTC, 1 Local, 2 Destination, (3 header), 4 local zone, 5 destination zone
  var TS_ROWS = 6;
  HANDLERS.timeset = function (scr, k) {
    if (V.edit) {
      if (/^\d$/.test(k) || k === ':') { V.edit.buf = U.hmsType(V.edit.buf, k); return; }
      if (k === 'BKSP') { V.edit.buf = V.edit.buf.replace(/:?\d$/, ''); return; }
      if (k === 'C') { V.edit = null; return; }
      if (k === 'ENTER' || k === 'UP' || k === 'DOWN') {
        var t = U.parse('time', U.DIMS.time.units[0], V.edit.buf), z = [0, S.set.zl, S.set.zd][scr.sel];
        V.edit = null;
        if (!isNaN(t)) {
          var want = ((t - z * 3600) % 86400 + 86400) % 86400, cur = ((Date.now() / 1000) % 86400 + 86400) % 86400;
          S.set.clock = want - cur;
        }
        if (k === 'ENTER') return;
      }
    }
    if (k === 'UP' || k === 'DOWN') return listMove(scr, k, TS_ROWS, function (i) { return i !== 3; });
    if (/^\d$/.test(k) && scr.sel <= 2) { V.edit = { buf: U.hmsType('', k) }; return; }
    if ((k === 'ENTER' || k === 'SETUNIT' || k === 'CONVUNIT') && scr.sel >= 4) {
      var key = scr.sel === 4 ? 'zl' : 'zd';
      S.set[key] = ZONES[(ZONES.indexOf(S.set[key]) + 1) % ZONES.length];
    }
    if (k === 'C' && scr.sel === 0) S.set.clock = 0;
  };

  // ------------------------------------------------------------ calculator
  HANDLERS.calc = function (scr, k) {
    if (k === 'CONVUNIT' || k === 'SETUNIT') return push(eqScr('conv'));
    var r = CC.key(S.calc, scr, k);
    if (r && r.toast) toast(r.toast);
  };

  // ------------------------------------------------------------------ timer
  // S.tm.set = countdown start (ms); 0 = stopwatch. A countdown keeps running past
  // zero and shows the overrun as a negative time.
  function tmElapsed() { var t = S.tm; return t.acc + (t.running ? Date.now() - t.start : 0); }
  function tmShown() { return S.tm.set ? S.tm.set - tmElapsed() : tmElapsed(); }
  HANDLERS.timer = function (scr, k) {
    var t = S.tm;
    if (V.edit) {
      if (/^\d$/.test(k) || k === ':') { V.edit.buf = U.hmsType(V.edit.buf, k); return; }
      if (k === 'BKSP') { V.edit.buf = V.edit.buf.replace(/:?\d$/, ''); return; }
      if (k === 'C') { V.edit = null; return; }
      if (k === 'ENTER' || k === 'DOWN') {
        var sec = U.parse('duration', U.DIMS.duration.units[3], V.edit.buf);
        V.edit = null;
        if (!isNaN(sec) && sec > 0) { t.set = Math.min(sec, 99 * 3600 + 59 * 60 + 59) * 1000; t.acc = 0; t.running = false; }
        scr.sel = 1;
        return;
      }
      return;
    }
    if (/^\d$/.test(k)) {
      if (t.running) return toast('Stop the Timer First');
      scr.sel = 0; V.edit = { buf: U.hmsType('', k) }; return;
    }
    if (k === 'UP' || k === 'DOWN') { scr.sel = (scr.sel + (k === 'UP' ? 3 : 1)) % 4; return; }
    if (k !== 'ENTER') return;
    switch (scr.sel) {
      case 1:
        if (t.running) { t.acc += Date.now() - t.start; t.running = false; }
        else { t.start = Date.now(); t.running = true; }
        break;
      case 2: t.acc = 0; t.start = Date.now(); t.running = true; break;
      case 3: t.running = false; t.acc = 0; t.set = 0; break;
    }
  };

  // ---------------------------------------------------------- key handling
  function press(k) {
    V.lastKey = Date.now();
    if (!V.power) { if (k === 'ENTER') powerOn(); return; }
    if (V.booting) return;
    var scr = top();
    switch (k) {
      case 'FLT': return setStack(listScr('list', 'FLT'));
      case 'W/B': return setStack(listScr('list', 'WB'));
      case 'PLAN': return setStack(listScr('list', 'PLAN'));
      case 'TIMER': return setStack({ type: 'timer', sel: 1 });
      case 'CALC': return setStack({ type: 'calc', sel: -1 });
      case 'SET': if (!(scr.type === 'list' && scr.id === 'SET')) setStack(listScr('list', 'SET')); return;
      case 'BACK': return back();
      case 'FAV':
        if (S.set.fav && Md.SCREENS[S.set.fav]) { if (!(scr.type === 'eq' && scr.id === S.set.fav)) setStack(eqScr(S.set.fav)); return; }
        return setStack(listScr('list', 'FAVPICK'));
      case 'M':
        if (scr.type === 'list' && scr.id === 'MEM') return back();
        if (scr.type === 'eq' && V.edit) commitEdit(scr);
        var m = listScr('list', 'MEM'); m.first = true;
        V.edit = null; V.stack.push(m);
        return;
    }
    var h = HANDLERS[scr.type];
    if (h) h(scr, k);
    save();
  }

  // ---------------------------------------------------------------- power
  var screenEl;
  function powerOn() {
    V.power = true; V.booting = true; V.lastKey = Date.now();
    if (!V.stack.length) setStack(listScr('list', 'FLT'));
    render();
    setTimeout(function () { V.booting = false; render(); }, 1300);
  }
  function powerOff() { V.power = false; V.edit = null; V.toast = null; saveNow(); render(); }

  // ------------------------------------------------------------- rendering
  var VIEW_LIST = 240 - 20;          // below the header
  var VIEW_SUB = 240 - 20 - 19;      // below header + title line

  function header(tag) {
    var z = S.set.zl;
    var ic = S.tm.running ? '<span class="hic">' + (S.tm.set ? '▼' : '▲') + '</span>' : '';
    return '<div class="hdr"><span class="htag">' + esc(tag) + '</span>' +
      '<span class="htime">' + hhmm(zoneSec(z)) + (z ? '' : 'Z') + '</span>' + ic +
      '<span class="hbat"><i></i></span></div>';
  }
  function sub(t, star) { return '<div class="sub">' + esc(t) + (star ? ' <span class="star">★</span>' : '') + '</div>'; }
  function cursor() { return '<span class="cur"></span>'; }
  function icon(kind) { return '<span class="q ' + kind + '"></span>'; }

  function renderList(scr) {
    var L = LISTS[scr.id](), items = L.items, viewH = L.sub ? VIEW_SUB : VIEW_LIST;
    if (scr.sel >= items.length) scr.sel = items.length - 1;
    keepVisible(scr, items.length, viewH);
    var h = header(L.tag) + (L.sub ? sub(L.sub) : '');
    h += '<div class="view" style="height:' + viewH + 'px"><div class="lst" style="transform:translateY(' + (-scr.scroll) + 'px)">';
    items.forEach(function (it, i) {
      h += '<div class="li' + (i === scr.sel ? ' sel' : '') + (it.off ? ' off' : '') + '">' +
        (it.check != null ? (it.check ? icon('ok') : icon('none')) : '') +
        '<span class="ll">' + esc(it.l) + '</span>' + (it.r != null ? '<span class="lr">' + esc(it.r) + '</span>' : '') + '</div>';
    });
    return h + '</div></div>';
  }

  function rowHtml(scr, r, sel) {
    if (!r.v) {
      return '<div class="li hd' + (sel ? ' sel' : '') + (r.ro ? ' off' : '') + '">' + esc(r.h) +
        (r.act ? '<span class="lr add">' + esc(r.act) + '</span>' : '') + '</div>';
    }
    var v = r.v, d = dimOf(v), u = unitOf(scr.id, v), val, unit = u.name, ic;
    if (sel && V.edit && !v.ro) {
      val = esc(V.edit.buf) + cursor(); ic = 'no';
    } else if (d.choice) {
      val = esc(d.units[Md.choiceIndex(v)].name); unit = ''; ic = 'ok';
    } else if (v.dim === 'entry') {
      val = v.has ? esc(Md.ENTRY_NAMES[v.v]) : '--'; unit = '';
    } else val = esc(U.format(v.dim, u, v.has ? v.v : null));
    if (!ic) ic = !v.has ? 'no' : v.computed ? 'eq' : v.copied ? 'gl' : 'ok';
    if (sel && V.edit && !v.ro) ic = 'none';
    return '<div class="li fr' + (r.sub ? ' sub' : '') + (sel ? ' sel' : '') + (v.ro ? ' ro' : '') + '">' + icon(ic) +
      '<span class="lab">' + esc(v.label) + '</span><span class="val">' + val + '</span><span class="unit">' + esc(unit) + '</span></div>';
  }

  function renderEq(scr) {
    var rows = eqRows(scr), s = Md.SCREENS[scr.id];
    if (scr.sel >= rows.length) scr.sel = rows.length - 1;
    keepVisible(scr, rows.length, VIEW_SUB);
    var h = header(screenTag(scr.id)) + sub(s.title, S.set.fav === scr.id);
    h += '<div class="view" style="height:' + VIEW_SUB + 'px"><div class="lst" style="transform:translateY(' + (-scr.scroll) + 'px)">';
    rows.forEach(function (r, i) { h += rowHtml(scr, r, i === scr.sel); });
    return h + '</div></div>';
  }

  function renderTimeset(scr) {
    keepVisible(scr, TS_ROWS, VIEW_SUB);
    var rows = [['UTC', 0], ['Local', S.set.zl], ['Destination', S.set.zd]];
    var h = header('SETTINGS') + sub('Time Set') + '<div class="view" style="height:' + VIEW_SUB + 'px"><div class="lst" style="transform:translateY(' + (-scr.scroll) + 'px)">';
    rows.forEach(function (r, i) {
      var sel = i === scr.sel, val = sel && V.edit ? esc(V.edit.buf) + cursor() : U.hms(zoneSec(r[1]), true);
      h += '<div class="li fr' + (sel ? ' sel' : '') + '">' + icon('none') + '<span class="lab">' + r[0] + '</span><span class="val">' + val + '</span><span class="unit">' + esc(zoneName(r[1])) + '</span></div>';
    });
    h += '<div class="li hd">Set Timezone</div>';
    [['Local', S.set.zl], ['Destination', S.set.zd]].forEach(function (r, i) {
      h += '<div class="li fr sub' + (i + 4 === scr.sel ? ' sel' : '') + '">' + icon('ok') + '<span class="lab">' + r[0] + '</span><span class="val">' + esc(zoneName(r[1])) + '</span><span class="unit"></span></div>';
    });
    return h + '</div></div>';
  }

  function renderCalc(scr) {
    var c = S.calc, h = header('CALCULATOR') + '<div class="tape">';
    // show the last 5 lines, or a window that keeps the selected line visible
    var off = Math.max(0, c.tape.length - 5);
    if (scr.sel >= 0 && scr.sel < off) off = scr.sel;
    c.tape.slice(off, off + 5).forEach(function (t, i) {
      h += '<div class="tl' + (off + i === scr.sel ? ' sel' : '') + '"><span class="tx">' + esc(t.expr) + ' =</span><span class="tr">' +
        esc(t.time ? CC.fmtHMS(t.value) : CC.fmtCalc(t.value)) + '</span></div>';
    });
    h += '</div><div class="cin"><span class="cx">' + (c.fresh || !c.expr ? '<span class="dim">0</span>' : esc(c.expr)) + cursor() + '</span></div>';
    return h;
  }

  function renderTimer(scr) {
    var t = S.tm, ms = tmShown(), neg = ms < 0, digits;
    if (V.edit) {
      var b = V.edit.buf, p = b.split(':');
      digits = esc(b) + cursor();
      if (p.length > 3) digits = esc(b);
    } else {
      var sec = Math.floor(Math.abs(ms) / 1000 + (t.set && !neg ? 0.999 : 0));
      digits = (neg ? '-' : '') + pad(Math.floor(sec / 3600)) + ':' + pad(Math.floor(sec / 60) % 60) + ':' + pad(sec % 60);
    }
    var h = header('TIMER') + '<div class="big' + (scr.sel === 0 ? ' sel' : '') + (neg ? ' neg' : '') + (V.edit ? ' editing' : '') + '"><span>' + digits + '</span></div>' +
      '<div class="hms"><span>Hours</span><span>Mins</span><span>Secs</span></div><div class="tlist">';
    [t.running ? 'Stop' : 'Start', 'Restart', 'Reset'].forEach(function (l, i) {
      h += '<div class="li c' + (i + 1 === scr.sel ? ' sel' : '') + '">' + esc(l) + '</div>';
    });
    return h + '</div>';
  }

  var RENDER = { list: renderList, eq: renderEq, timeset: renderTimeset, calc: renderCalc, timer: renderTimer };

  function render() {
    if (!screenEl) return;
    applyLook();
    if (!V.power) { screenEl.innerHTML = ''; return; }
    if (V.booting) {
      screenEl.innerHTML = '<div class="boot"><div class="bt">CX-3</div><div class="bs">FLIGHT COMPUTER</div><div class="bar"><i></i></div></div>';
      return;
    }
    var h = RENDER[top().type](top());
    if (V.toast) {
      if (Date.now() > V.toast.until) V.toast = null;
      else h += '<div class="toast">' + esc(V.toast.text) + '</div>';
    }
    screenEl.innerHTML = h;
  }

  function applyLook() {
    if (!screenEl) return;
    var cls = 'screen theme-' + ['standard', 'night', 'daylight'][S.set.theme || 0];
    if (!V.power) cls += ' off';
    if (screenEl.className !== cls) screenEl.className = cls;
    screenEl.style.filter = 'brightness(' + [1, 1.12, 0.7, 0.85][S.set.backlight || 0] + ')';
  }

  // ------------------------------------------------------------ keypad DOM
  var KEYMAP = {
    'Enter': 'ENTER', 'NumpadEnter': 'ENTER', 'Escape': 'BACK', 'Delete': 'C',
    'ArrowUp': 'UP', 'ArrowDown': 'DOWN', 'Backspace': 'BKSP',
    '*': '×', 'x': '×', '/': '÷', '+': '+', '-': '-', '=': '=', '.': '.', ':': ':', ';': ':',
    'f': 'FLT', 'p': 'PLAN', 't': 'TIMER', 'c': 'CALC', 'w': 'W/B', 's': 'SET', 'm': 'M', 'b': 'BACK',
    'n': '+/-', 'r': 'SQRT', 'u': 'SETUNIT', 'v': 'CONVUNIT', 'a': 'FAV', 'ArrowLeft': 'BKSP'
  };
  function keyEl(k) {
    var els = document.querySelectorAll('[data-k]');
    for (var i = 0; i < els.length; i++) if (els[i].getAttribute('data-k') === k) return els[i];
    return null;
  }
  function flash(k) {
    var el = keyEl(k);
    if (!el) return;
    el.classList.add('pressed');
    setTimeout(function () { el.classList.remove('pressed'); }, 110);
  }
  function enterDown() {
    V.enterDown = Date.now();
    clearTimeout(V.offTimer);
    if (V.power) V.offTimer = setTimeout(function () { V.enterDown = 0; powerOff(); }, 3000);
  }
  function enterUp() {
    clearTimeout(V.offTimer);
    if (!V.enterDown) return;
    V.enterDown = 0;
    press('ENTER'); render();
  }

  function bind() {
    screenEl = document.getElementById('screen');
    Array.prototype.forEach.call(document.querySelectorAll('[data-k]'), function (el) {
      var k = el.getAttribute('data-k');
      el.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        el.classList.add('pressed');
        if (k === 'ENTER') return enterDown();
        press(k); render();
      });
      el.addEventListener('pointerup', function () { el.classList.remove('pressed'); if (k === 'ENTER') enterUp(); });
      el.addEventListener('pointerleave', function () { el.classList.remove('pressed'); if (k === 'ENTER' && V.enterDown) enterUp(); });
      el.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    });
    document.addEventListener('keydown', function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      var k = /^[0-9]$/.test(e.key) ? e.key : KEYMAP[e.key] || KEYMAP[e.key.toLowerCase()];
      if (!k) return;
      e.preventDefault();
      if (k === 'ENTER') {
        if (!e.repeat) { var el = keyEl('ENTER'); if (el) el.classList.add('pressed'); enterDown(); }
        return;
      }
      flash(k); press(k); render();
    });
    document.addEventListener('keyup', function (e) {
      if (e.key === 'Enter' || e.key === 'NumpadEnter') { var el = keyEl('ENTER'); if (el) el.classList.remove('pressed'); enterUp(); }
    });
    window.addEventListener('resize', fit);
    window.addEventListener('orientationchange', function () { setTimeout(fit, 300); });
    fit();
  }

  // safe-area insets (iPhone status bar / home indicator), read from CSS env()
  function safeInsets() {
    var probe = document.getElementById('safe-probe');
    if (!probe) {
      probe = document.createElement('div');
      probe.id = 'safe-probe';
      probe.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;' +
        'padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)';
      document.body.appendChild(probe);
    }
    var cs = getComputedStyle(probe);
    return { top: parseFloat(cs.paddingTop) || 0, bottom: parseFloat(cs.paddingBottom) || 0 };
  }
  function fit() {
    var dev = document.getElementById('device'), wrap = document.getElementById('stage');
    // phones: fill the width (tiny margin) but never past the visible height;
    // larger screens: fit the whole device
    var ins = safeInsets();
    var w = window.innerWidth, h = window.innerHeight - Math.max(4, ins.top) - ins.bottom, phone = w < 600;
    var k = phone ? Math.min((w - 6) / dev.offsetWidth, (h - 6) / dev.offsetHeight)
                  : Math.min((w - 16) / dev.offsetWidth, (h - 16) / dev.offsetHeight, 1.6);
    dev.style.transform = 'scale(' + k + ')';
    wrap.style.height = Math.ceil(dev.offsetHeight * k + 8) + 'px';
  }

  function loop() {
    if (V.power && !S.tm.running && Date.now() - V.lastKey > AUTO_OFF_MIN * 60000) powerOff();
    if (V.power) render();
  }

  document.addEventListener('DOMContentLoaded', function () {
    bind();
    powerOn();
    setInterval(loop, 100);
  });

  window.CX3 = { press: function (k) { press(k); render(); }, state: function () { return S; }, ui: function () { return V; },
                 model: Md, evaluate: CC.evaluate };
})();
