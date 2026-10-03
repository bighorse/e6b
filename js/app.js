/* CX-3 Flight Computer simulator — UI engine */
(function () {
  'use strict';

  var A = window.Aviation, UT = window.Units.TYPES, FNS = window.Defs.FNS,
      MENUS = window.Defs.MENUS, FN_TAG = window.Defs.FN_TAG;

  var STORE_KEY = 'cx3-sim-v2';
  var ROW_H = 25.5;            // list row height on the 320×240 display
  var VERSION = '1.0';

  // ------------------------------------------------------------------ state
  var SETTINGS_DEF = [
    { id: 'theme', label: 'Theme', opts: ['Day', 'Night'], def: 0 },
    { id: 'backlight', label: 'Backlighting', opts: ['Daylight', 'Normal', 'Dim'], def: 0 },
    { id: 'timeset', label: 'Time Set', kind: 'time' },
    { id: 'units', label: 'Default Units', opts: ['U. S.', 'Metric'], def: 0 },
    { id: 'unitmode', label: 'Unit Changes', opts: ['Per Screen', 'Global'], def: 0 },
    { id: 'fav', label: 'Favorite', kind: 'action', value: 'Set' },
    { id: 'profile', label: 'Aircraft Profile', kind: 'action', value: 'Edit' },
    { id: 'userdata', label: 'User Data', kind: 'action', value: 'Save' },
    { id: 'click', label: 'Key Click', opts: ['On', 'Off'], def: 1 },
    { id: 'autooff', label: 'Auto Off', opts: ['Off', '5 Min', '10 Min', '30 Min'], def: 2 },
    { id: 'version', label: 'Version', kind: 'info', value: VERSION }
  ];

  function freshState() {
    var s = { settings: { clockOffset: 0, favFn: null }, data: {}, units: {}, mem: [],
              calc: window.CalcCore.freshState(),
              tm: { mode: 0, running: false, start: 0, acc: 0, set: 0, alarm: false } };
    SETTINGS_DEF.forEach(function (d) { if (d.opts) s.settings[d.id] = d.def; });
    for (var i = 0; i < 10; i++) s.mem.push(null);
    return s;
  }

  var S = freshState();
  function loadState(obj) {
    var s = freshState();
    Object.keys(obj || {}).forEach(function (k) { if (k in s) s[k] = obj[k]; });
    SETTINGS_DEF.forEach(function (d) { if (d.opts && s.settings[d.id] == null) s.settings[d.id] = d.def; });
    if (!s.tm || typeof s.tm !== 'object') s.tm = freshState().tm;
    if (!s.calc || !Array.isArray(s.calc.tape)) s.calc = window.CalcCore.freshState();
    if (!('ans' in s.calc)) { var lt = s.calc.tape[s.calc.tape.length - 1]; s.calc.ans = lt ? { value: lt.value, time: lt.time } : null; }
    s.tm.running = false; s.tm.alarm = false;
    return s;
  }
  try { S = loadState(JSON.parse(localStorage.getItem(STORE_KEY) || 'null')); } catch (e) { /* no storage */ }

  var V = { power: false, booting: false, stack: [], edit: null, mem: null,
            toast: null, lastKey: Date.now(), enterDown: 0, offTimer: null };

  var saveTimer = null;
  function saveNow() {
    clearTimeout(saveTimer); saveTimer = null;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) { /* ignore */ }
  }
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 200);
  }
  // flush when the page is hidden or closed (iOS may end a backgrounded web app at any time)
  window.addEventListener('pagehide', saveNow);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') saveNow(); });
  function top() { return V.stack[V.stack.length - 1]; }
  function toast(t, ms) { V.toast = { text: t, until: Date.now() + (ms || 1400) }; }

  // ------------------------------------------------------------ formatting
  function pad(n, w) { n = String(n); while (n.length < (w || 2)) n = '0' + n; return n; }
  function fmtNum(x, dp) {
    if (x == null || !isFinite(x)) return '--';
    // nudge by a few ulps so exact halves hidden by binary error (7.4999999… for 7.5) round up
    var a = Math.abs(x) * (1 + 4e-15);
    var s = a.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
    return (x < 0 && !/^[0.,]*$/.test(s) ? '-' : '') + s;
  }
  function fmtClock(h, trunc) {
    var m = (((h % 24) + 24) % 24) * 60;
    var t = trunc ? Math.floor(m + 1e-9) : Math.round(m);
    return pad(Math.floor(t / 60) % 24) + ':' + pad(t % 60);
  }
  function fmtDir(d) {
    var r = Math.round(A.norm360(d));
    return pad(r === 0 ? 360 : r, 3) + '°';
  }
  function fmtDM(d, pos, neg) {
    var hemi = d < 0 ? neg : pos, a = Math.abs(d);
    var deg = Math.floor(a), min = Math.round((a - deg) * 6000) / 100;
    if (min >= 60) { deg += 1; min -= 60; }
    return hemi + ' ' + deg + '°' + (min < 10 ? '0' : '') + min.toFixed(2) + "'";
  }

  // ------------------------------------------------------------- clock
  function now() { return new Date(Date.now() + (S.settings.clockOffset || 0) * 60000); }
  function utcHours() {
    var d = now();
    return d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
  }

  // ----------------------------------------------------------- field model
  function unitList(f) { return UT[f.type] || null; }
  function unitKey(fn, f) { return S.settings.unitmode === 1 ? '*' + f.type : fn.id + '.' + f.id; }
  function unitIdx(fn, f) {
    if (f.fixedUnit != null) return f.fixedUnit;
    if (!unitList(f)) return 0;
    var k = fn.id + '.' + f.id;
    if (S.settings.unitmode !== 1 && S.units[k] != null) return S.units[k];
    if (S.units['*' + f.type] != null) return S.units['*' + f.type];
    return S.settings.units === 1 ? (window.Units.METRIC_DEFAULT[f.type] || 0) : 0;
  }
  function unitLabel(fn, f) {
    var list = unitList(f);
    if (list) { var u = list[unitIdx(fn, f)].name; return u === 'h:m:s' ? '' : u; }
    return { pct: '%', ratio: ': 1' }[f.type] || '';
  }

  function data(fn) { return S.data[fn.id] || (S.data[fn.id] = {}); }
  function itemCount(fn) { return fn.items ? (data(fn)._n || 1) : 0; }
  function key(f, idx) { return f.per ? f.id + '@' + idx : f.id; }
  function rawVal(fn, f, idx) {
    var v = data(fn)[key(f, idx)];
    if (v == null && f.def != null) return f.def;
    return v == null ? null : v;
  }
  // value with item-to-item inheritance (and aircraft profile fallback)
  function effVal(fn, f, idx) {
    var v = rawVal(fn, f, idx);
    if (v != null || !f.inherit) return { v: v, inherited: false };
    for (var i = idx - 1; i >= 1; i--) {
      var p = rawVal(fn, f, i);
      if (p != null) return { v: p, inherited: true };
    }
    if (f.profile && S.data.profile && S.data.profile[f.profile] != null) return { v: S.data.profile[f.profile], inherited: true };
    return { v: null, inherited: false };
  }
  function fieldById(fn, id) {
    for (var i = 0; i < fn.fields.length; i++) if (fn.fields[i].id === id) return fn.fields[i];
    return null;
  }

  function compute(fn) {
    var v = {};
    fn.fields.forEach(function (f) { if (f.input && !f.per) v[f.id] = effVal(fn, f, 0).v; });
    var ctx = { n: itemCount(fn), get: function (id, i) { var f = fieldById(fn, id); return f ? effVal(fn, f, i).v : null; } };
    try { return fn.calc(v, ctx) || {}; } catch (e) { return {}; }
  }

  // Rows shown for a function screen
  function buildRows(fn) {
    var rows = [];
    if (!fn.items) {
      fn.fields.forEach(function (f) { rows.push({ t: 'f', f: f, idx: 0 }); });
      return rows;
    }
    var n = itemCount(fn);
    fn.fields.forEach(function (f) { if (!f.per && !f.total) rows.push({ t: 'f', f: f, idx: 0 }); });
    for (var i = 1; i <= n; i++) {
      rows.push({ t: 'h', text: fn.items + ' ' + i, idx: i });
      fn.fields.forEach(function (f) { if (f.per) rows.push({ t: 'f', f: f, idx: i, sub: true }); });
    }
    if (n < fn.max) rows.push({ t: 'add', text: fn.items + ' ' + (n + 1) });
    rows.push({ t: 'h', text: 'TOTALS' });
    fn.fields.forEach(function (f) { if (f.total) rows.push({ t: 'f', f: f, idx: 0, sub: true }); });
    if (fn.clearRow) rows.push({ t: 'clear', text: fn.clearRow });
    return rows;
  }
  function selectable(r) { return r.t !== 'h'; }
  function rowValue(fn, r, res) {
    var f = r.f;
    if (f.input) {
      var ev = effVal(fn, f, r.idx);
      if (ev.v == null && fn.solver && res[f.id] != null) return { v: res[f.id], solved: true };
      return { v: ev.v, inherited: ev.inherited };
    }
    return { v: res[f.per ? f.id + '@' + r.idx : f.id] };
  }

  function displayValue(fn, f, base) {
    if (base == null || (typeof base === 'number' && !isFinite(base))) return null;
    switch (f.type) {
      case 'text': return String(base);
      case 'enum': return f.options[base] || f.options[0];
      case 'dir': case 'rwy': return fmtDir(base);
      case 'wca':
        var w = Math.round(base * 10) / 10;
        return Math.abs(w) < 0.05 ? '0.0°' : Math.abs(w).toFixed(1) + '° ' + (w > 0 ? 'R' : 'L');
      case 'var': return Math.abs(base) < 1e-9 ? '0.0°' : Math.abs(base).toFixed(1) + '° ' + (base > 0 ? 'W' : 'E');
      case 'dev': return (base > 0 ? '+' : '') + fmtNum(base, 1) + '°';
      case 'lat': return fmtDM(base, 'N', 'S');
      case 'lon': return fmtDM(base, 'E', 'W');
      case 'clock': return fmtClock(base);
      case 'ratio': case 'pct': return fmtNum(base, 1);
      case 'num': return fmtNum(base, f.dp != null ? f.dp : 2);
    }
    var list = unitList(f);
    if (list) {
      var u = list[unitIdx(fn, f)], x = u.fromBase(base);
      if (u.name === 'h:m:s') return fmtHMS(x);
      return fmtNum(x, f.dp != null && f.type === 'angle' ? f.dp : u.dp);
    }
    return fmtNum(base, 2);
  }

  // ------------------------------------------------- expression evaluation
  var CC = window.CalcCore, evaluate = CC.evaluate, fmtCalc = CC.fmtCalc, fmtHMS = CC.fmtHMS, numStr = CC.numStr;

  function parseField(fn, f, buf) {
    var e = evaluate(buf.replace(/[+\-×÷√]+$/, ''));
    if (!e || e.error) return undefined;
    var x = e.value;
    switch (f.type) {
      case 'dir': return x < 0 || x > 360 ? undefined : (x === 0 ? 360 : x);
      case 'rwy':
        if (x < 0 || x > 360) return undefined;
        return x <= 36 && buf.indexOf('.') < 0 ? (x === 0 ? 360 : x * 10) : x;
      case 'var': case 'dev': case 'ratio': case 'pct': case 'num': return x;
      case 'lat': return Math.abs(x) <= 90 ? x : undefined;
      case 'lon': return Math.abs(x) <= 180 ? x : undefined;
      case 'clock':
        if (!e.time && x >= 100) x = Math.floor(x / 100) + (x % 100) / 60;
        return x >= 0 && x < 24 ? x : undefined;
    }
    var list = unitList(f);
    if (list) {
      if (f.type === 'dur' && e.time) return x;
      return list[unitIdx(fn, f)].toBase(x);
    }
    return x;
  }

  // ----------------------------------------------------------- navigation
  function setStack(scr) { V.edit = null; V.mem = null; V.stack = [scr]; }
  function push(scr) { V.edit = null; V.mem = null; V.stack.push(scr); }
  function back() {
    if (V.edit) { V.edit = null; return; }
    if (V.stack.length > 1) V.stack.pop();
  }
  function menuScr(id) { return { type: 'menu', id: id, sel: 0, scroll: 0 }; }
  function fnScr(id) {
    var rows = buildRows(FNS[id]), sel = 0;
    while (sel < rows.length && !selectable(rows[sel])) sel++;
    return { type: 'fn', id: id, sel: sel, scroll: 0 };
  }
  function openFn(id) { push(fnScr(id)); }
  function openItem(it) {
    if (it.menu) push(menuScr(it.menu));
    else if (it.fn) openFn(it.fn);
  }
  function confirmDlg(text, yes) { push({ type: 'confirm', text: text, yes: yes }); }

  function keepVisible(scr, rowCount, viewH) {
    var y = scr.sel * ROW_H, maxScroll = Math.max(0, rowCount * ROW_H - viewH);
    if (y < scr.scroll) scr.scroll = y;
    if (y + ROW_H > scr.scroll + viewH) scr.scroll = y + ROW_H - viewH;
    scr.scroll = Math.max(0, Math.min(scr.scroll, maxScroll));
  }

  // ---------------------------------------------------------- key handling
  var DIGITS = '0123456789';
  var ENTRY = '0123456789.:';

  function press(k) {
    V.lastKey = Date.now();
    click();
    if (!V.power) { if (k === 'ENTER') powerOn(); return; }
    if (V.booting) return;
    if (S.tm.alarm) { S.tm.alarm = false; stopAlarm(); return; }

    if (V.mem) return memKey(k);

    switch (k) {
      case 'FLT': return setStack(menuScr('FLT'));
      case 'W/B': return setStack(menuScr('WB'));
      case 'PLAN': return setStack(fnScr('plan'));
      case 'TIMER': return setStack({ type: 'timer', sel: 0 });
      case 'CALC': return setStack({ type: 'calc', sel: -1 });
      case 'SET': if (top().type !== 'set') push({ type: 'set', sel: 0, scroll: 0 }); return;
      case 'BACK': return back();
      case 'FAV':
        if (S.settings.favFn && FNS[S.settings.favFn]) {
          if (top().type === 'fn' && top().id === S.settings.favFn) return;
          return setStack(fnScr(S.settings.favFn));
        }
        toast('Set a Favorite in SET menu');
        return push({ type: 'pick', sel: 0, scroll: 0 });
      case 'M':
        V.edit && commitIfFn();
        V.mem = { sel: 0 };
        return;
    }
    var scr = top(), h = HANDLERS[scr.type];
    if (h) h(scr, k);
    save();
  }

  // ----- memory panel (M key)
  function memKey(k) {
    var m = V.mem;
    if (k === 'UP') m.sel = (m.sel + 9) % 10;
    else if (k === 'DOWN') m.sel = (m.sel + 1) % 10;
    else if (DIGITS.indexOf(k) >= 0) m.sel = Number(k);
    else if (k === 'M') {
      var val = currentValue(top());
      if (val == null) { V.mem = null; toast('No Value to Store'); return; }
      S.mem[m.sel] = val; save(); toast('Stored M' + m.sel); V.mem = null;
    } else if (k === 'ENTER') {
      var v = S.mem[m.sel];
      V.mem = null;
      if (v == null) return toast('M' + m.sel + ' Empty');
      insertNumber(top(), v);
    } else if (k === 'C') { S.mem[m.sel] = null; save(); }
    else if (k === 'BACK') V.mem = null;
    else { V.mem = null; press(k); }          // any other key closes the panel and acts normally
  }

  function currentValue(scr) {
    if (scr.type === 'calc') return CC.currentValue(S.calc);
    if (scr.type === 'fn') {
      var fn = FNS[scr.id], r = buildRows(fn)[scr.sel];
      if (!r || r.t !== 'f') return null;
      var base = rowValue(fn, r, compute(fn)).v;
      if (typeof base !== 'number') return null;
      // store what the display shows (rounded), falling back to the raw value
      var shown = Number(String(displayValue(fn, r.f, base) || '').replace(/,/g, ''));
      if (isFinite(shown) && /^-?[\d,]+(\.\d+)?$/.test(displayValue(fn, r.f, base))) return shown;
      var list = unitList(r.f);
      return list ? list[unitIdx(fn, r.f)].fromBase(base) : base;
    }
    return null;
  }
  function insertNumber(scr, x) {
    var s = numStr(x);
    if (scr.type === 'calc') {
      CC.appendOperand(S.calc, s);
    } else if (scr.type === 'fn') {
      var fn = FNS[scr.id], r = buildRows(fn)[scr.sel];
      if (!r || r.t !== 'f' || !r.f.input || r.f.type === 'enum') return toast('Select an Input');
      V.edit = { buf: s };
    }
  }
  function commitIfFn() {
    var scr = top();
    if (scr.type !== 'fn') { V.edit = null; return; }
    var fn = FNS[scr.id], r = buildRows(fn)[scr.sel];
    if (r && r.t === 'f') commit(fn, r);
  }

  var HANDLERS = {};

  function listMove(scr, k, n, viewH, ok) {
    var d = k === 'UP' ? -1 : 1;
    for (var t = 0; t < n; t++) {
      scr.sel = (scr.sel + d + n) % n;
      if (!ok || ok(scr.sel)) break;
    }
    keepVisible(scr, n, viewH);
  }

  HANDLERS.menu = function (scr, k) {
    var items = MENUS[scr.id].items;
    if (k === 'UP' || k === 'DOWN') return listMove(scr, k, items.length, VIEW_LIST);
    if (k === 'ENTER') return openItem(items[scr.sel]);
    if (DIGITS.indexOf(k) > 0 && Number(k) <= items.length) { scr.sel = Number(k) - 1; return openItem(items[scr.sel]); }
    if (k === 'CONVUNIT') return push(menuScr('CONV'));
  };

  // favorite picker: every function reachable from the menus
  var ALL_FNS = (function () {
    var out = [], seen = {};
    function walk(id) {
      MENUS[id].items.forEach(function (it) {
        if (it.menu) walk(it.menu);
        else if (it.fn && !seen[it.fn]) { seen[it.fn] = 1; out.push(it.fn); }
      });
    }
    walk('FLT'); out.push('plan'); walk('WB');
    return out;
  })();
  HANDLERS.pick = function (scr, k) {
    if (k === 'UP' || k === 'DOWN') return listMove(scr, k, ALL_FNS.length, VIEW_LIST);
    if (k === 'ENTER') {
      S.settings.favFn = ALL_FNS[scr.sel];
      toast('Favorite: ' + FNS[S.settings.favFn].title);
      back();
    }
  };

  HANDLERS.confirm = function (scr, k) {
    if (k === 'ENTER') { V.stack.pop(); scr.yes(); save(); }
    else if (k === 'C') V.stack.pop();
  };

  HANDLERS.userdata = function (scr, k) {
    var items = USERDATA;
    if (k === 'UP' || k === 'DOWN') return listMove(scr, k, items.length, VIEW_LIST);
    if (k === 'ENTER') items[scr.sel].run();
  };
  var USERDATA = [
    { label: 'Save to File', run: function () {
      try {
        var blob = new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = 'cx3-user-data.json';
        document.body.appendChild(a); a.click(); a.remove();
        toast('User Data Saved');
      } catch (e) { toast('Save Failed'); }
    } },
    { label: 'Load from File', run: function () {
      var inp = document.createElement('input');
      inp.type = 'file'; inp.accept = '.json,application/json';
      inp.onchange = function () {
        var f = inp.files[0]; if (!f) return;
        f.text().then(function (t) { S = loadState(JSON.parse(t)); save(); toast('User Data Loaded'); render(); })
          .catch(function () { toast('Invalid File'); render(); });
      };
      inp.click();
    } },
    { label: 'Erase All Data', run: function () {
      confirmDlg('Erase all data and restore factory settings?', function () {
        S = freshState(); stopAlarm(); toast('Data Erased');
      });
    } }
  ];

  HANDLERS.set = function (scr, k) {
    var n = SETTINGS_DEF.length, d = SETTINGS_DEF[scr.sel];
    if (V.edit) {                          // Time Set entry (HHMM Zulu)
      if (DIGITS.indexOf(k) >= 0 && V.edit.buf.length < 4) V.edit.buf += k;
      else if (k === 'BKSP') V.edit.buf = V.edit.buf.slice(0, -1);
      else if (k === 'C') V.edit = null;
      else if (k === 'ENTER') {
        var b = V.edit.buf; V.edit = null;
        if (b.length !== 4 || +b.slice(0, 2) > 23 || +b.slice(2) > 59) return toast('Enter HHMM Zulu');
        var want = +b.slice(0, 2) * 60 + +b.slice(2);
        var d0 = new Date(), cur = d0.getUTCHours() * 60 + d0.getUTCMinutes();
        var off = want - cur;
        if (off > 720) off -= 1440; if (off < -720) off += 1440;
        S.settings.clockOffset = off; toast('Time Set ' + b + 'Z');
      }
      return;
    }
    if (k === 'UP' || k === 'DOWN') return listMove(scr, k, n, VIEW_LIST);
    if (d.kind === 'time') {
      if (DIGITS.indexOf(k) >= 0) V.edit = { buf: k };
      else if (k === 'ENTER') V.edit = { buf: '' };
      else if (k === 'C') { S.settings.clockOffset = 0; toast('Clock Reset'); }
      return;
    }
    if (k !== 'ENTER') return;
    if (d.id === 'fav') return push({ type: 'pick', sel: Math.max(0, ALL_FNS.indexOf(S.settings.favFn)), scroll: 0 });
    if (d.id === 'profile') return openFn('profile');
    if (d.id === 'userdata') return push({ type: 'userdata', sel: 0, scroll: 0 });
    if (!d.opts) return;
    S.settings[d.id] = (S.settings[d.id] + 1) % d.opts.length;
    if (d.id === 'units' || d.id === 'unitmode') S.units = {};
    applyLook();
  };

  // ----- function screens
  HANDLERS.fn = function (scr, k) {
    var fn = FNS[scr.id], rows = buildRows(fn), r = rows[scr.sel];
    if (!r) { scr.sel = 0; return; }
    var f = r.f, editable = r.t === 'f' && f.input && f.type !== 'enum';

    if (V.edit) {
      if (ENTRY.indexOf(k) >= 0 || '+-×÷'.indexOf(k) >= 0) { if (V.edit.buf.length < 16) V.edit.buf += k; return; }
      if (k === '+/-') { V.edit.buf = V.edit.buf[0] === '-' ? V.edit.buf.slice(1) : '-' + V.edit.buf; return; }
      if (k === 'SQRT') { var e0 = evaluate(V.edit.buf); if (e0 && !e0.error && e0.value >= 0) V.edit.buf = numStr(Math.sqrt(e0.value)); return; }
      if (k === 'BKSP') { V.edit.buf = V.edit.buf.slice(0, -1); if (!V.edit.buf) V.edit = null; return; }
      if (k === 'C') { V.edit = null; return; }
      if (k === 'SETUNIT' || k === 'CONVUNIT') { unitKeyPress(fn, r, false); return; }
      if (k === 'ENTER' || k === '=' || k === 'UP' || k === 'DOWN') {
        if (!commit(fn, r)) return;
        if (k === 'UP' || k === 'DOWN') return listMove(scr, k, rows.length, VIEW_FN, function (i) { return selectable(rows[i]); });
        return nextInput(scr, fn);
      }
      return;
    }

    if (ENTRY.indexOf(k) >= 0 || k === '-') {
      if (editable) V.edit = { buf: k };
      else if (r.t === 'f' && !f.input) toast('Result — Select an Input');
      return;
    }
    switch (k) {
      case 'UP': case 'DOWN':
        return listMove(scr, k, rows.length, VIEW_FN, function (i) { return selectable(rows[i]); });
      case 'ENTER':
        if (r.t === 'add') { data(fn)._n = itemCount(fn) + 1; return nextInput(scr, fn); }
        if (r.t === 'clear') return confirmDlg('Clear all ' + fn.items.toLowerCase() + 's?', function () { delete S.data[fn.id]; scr.sel = 0; scr.scroll = 0; });
        if (f.type === 'enum') { var cur = rawVal(fn, f, r.idx) || 0; data(fn)[key(f, r.idx)] = (cur + 1) % f.options.length; return; }
        if (f.input) return nextInput(scr, fn);
        return;
      case 'C':
        if (r.t === 'f' && f.input) delete data(fn)[key(f, r.idx)];
        return;
      case 'BKSP':
        if (editable && rawVal(fn, f, r.idx) != null) {
          var shown = displayValue(fn, f, rawVal(fn, f, r.idx)) || '';
          V.edit = { buf: shown.replace(/[^0-9.:\-]/g, '').slice(0, -1) };
          if (!V.edit.buf) { V.edit = null; delete data(fn)[key(f, r.idx)]; }
        }
        return;
      case '+/-':
        if (r.t === 'f' && f.input) {
          var v = rawVal(fn, f, r.idx);
          if (typeof v === 'number' && f.type !== 'enum') data(fn)[key(f, r.idx)] = -v;
        }
        return;
      case 'SETUNIT': return unitKeyPress(fn, r, false);
      case 'CONVUNIT':
        if (r.t === 'f' && unitList(f) && f.fixedUnit == null) return unitKeyPress(fn, r, true);
        return push(menuScr('CONV'));
    }
  };

  // SET UNIT changes the unit and keeps the number shown (re-labels it);
  // CONV UNIT changes the unit and converts the value.
  function unitKeyPress(fn, r, convert) {
    if (r.t !== 'f') return;
    var f = r.f, list = unitList(f);
    if (!list || f.fixedUnit != null || list.length < 2) return toast('No Units');
    var oldU = list[unitIdx(fn, f)], ni = (unitIdx(fn, f) + 1) % list.length, newU = list[ni];
    var kk = key(f, r.idx), base = data(fn)[kk];
    if (!convert && f.input && base != null && !V.edit) data(fn)[kk] = newU.toBase(oldU.fromBase(base));
    S.units[unitKey(fn, f)] = ni;
    if (S.settings.unitmode !== 1) delete S.units['*' + f.type];
  }

  function commit(fn, r) {
    var x = parseField(fn, r.f, V.edit.buf);
    V.edit = null;
    if (x === undefined) { toast('Invalid Entry'); return false; }
    data(fn)[key(r.f, r.idx)] = x;
    save();
    return true;
  }
  function nextInput(scr, fn) {
    var rows = buildRows(fn), n = rows.length;
    for (var i = scr.sel + 1; i < n; i++) {
      var r = rows[i];
      if ((r.t === 'f' && r.f.input) || r.t === 'add') { scr.sel = i; keepVisible(scr, n, VIEW_FN); return; }
    }
    for (var j = 0; j < n; j++) {
      if (rows[j].t === 'f' && !rows[j].f.input) { scr.sel = j; keepVisible(scr, n, VIEW_FN); return; }
    }
  }

  // ------------------------------------------------------------ calculator
  HANDLERS.calc = function (scr, k) {
    if (k === 'CONVUNIT') return push(menuScr('CONV'));
    var r = CC.key(S.calc, scr, k);
    if (r && r.toast) toast(r.toast);
  };

  // ------------------------------------------------------------------ timer
  // mode 0 = count up (stopwatch), 1 = count down
  function tmElapsed() { var t = S.tm; return t.acc + (t.running ? Date.now() - t.start : 0); }
  function tmShown() {
    var t = S.tm;
    if (t.mode === 0) return tmElapsed();
    return Math.max(0, t.set - tmElapsed());
  }
  function timerItems() {
    return [S.tm.running ? 'Stop' : 'Start', 'Restart', 'Reset', S.tm.mode === 0 ? 'Count Up' : 'Count Down'];
  }
  HANDLERS.timer = function (scr, k) {
    var t = S.tm;
    if (V.edit) {
      if (DIGITS.indexOf(k) >= 0 && V.edit.buf.length < 6) V.edit.buf += k;
      else if (k === 'BKSP') { V.edit.buf = V.edit.buf.slice(0, -1); if (!V.edit.buf) V.edit = null; }
      else if (k === 'C') V.edit = null;
      else if (k === 'ENTER') {
        var b = pad(V.edit.buf, 6), h = +b.slice(0, 2), m = +b.slice(2, 4), s = +b.slice(4);
        V.edit = null;
        if (m > 59 || s > 59) return toast('Invalid Time');
        t.mode = 1; t.set = ((h * 60 + m) * 60 + s) * 1000; t.acc = 0; t.running = false;
      }
      return;
    }
    if (DIGITS.indexOf(k) >= 0) { if (t.running) return toast('Stop Timer First'); V.edit = { buf: k === '0' ? '' : k }; return; }
    if (k === 'UP' || k === 'DOWN') { scr.sel = (scr.sel + (k === 'UP' ? 3 : 1)) % 4; return; }
    if (k === 'C') { t.running = false; t.acc = 0; return; }
    if (k !== 'ENTER') return;
    switch (scr.sel) {
      case 0:
        if (t.running) { t.acc += Date.now() - t.start; t.running = false; }
        else {
          if (t.mode === 1 && tmShown() <= 0) return toast('Type HHMMSS to Set');
          t.start = Date.now(); t.running = true;
        }
        break;
      case 1: t.acc = 0; t.start = Date.now(); t.running = true; break;
      case 2: t.running = false; t.acc = 0; break;
      case 3: t.mode = 1 - t.mode; t.running = false; t.acc = 0; break;
    }
  };
  function tickTimers() {
    var t = S.tm;
    if (t.running && t.mode === 1 && tmShown() <= 0) {
      t.running = false; t.acc = t.set; t.alarm = true;
      startAlarm();
      if (!V.power) powerOn();
    }
  }

  // ----------------------------------------------------------------- sound
  var AC = null;
  function tone(freq, dur, vol) {
    if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; } }
    var o = AC.createOscillator(), g = AC.createGain();
    o.type = 'square'; o.frequency.value = freq; g.gain.value = vol || 0.04;
    o.connect(g); g.connect(AC.destination);
    o.start(); o.stop(AC.currentTime + dur);
  }
  function click() { if (S.settings.click === 0) tone(2400, 0.012, 0.02); }
  var alarmTimer = null;
  function startAlarm() {
    clearInterval(alarmTimer);
    var n = 0;
    alarmTimer = setInterval(function () {
      if (!S.tm.alarm || n++ > 60) return stopAlarm();
      tone(2800, 0.08, 0.06); setTimeout(function () { tone(2800, 0.08, 0.06); }, 150);
    }, 700);
  }
  function stopAlarm() { clearInterval(alarmTimer); alarmTimer = null; S.tm.alarm = false; }

  // ---------------------------------------------------------------- power
  var screenEl;
  function powerOn() {
    V.power = true; V.booting = true; V.lastKey = Date.now();
    if (!V.stack.length) setStack(menuScr('FLT'));
    render();
    setTimeout(function () { V.booting = false; render(); }, 1300);
  }
  function powerOff() { V.power = false; V.edit = null; V.mem = null; V.toast = null; render(); }

  // ------------------------------------------------------------- rendering
  var VIEW_LIST = 240 - 20;          // below the header
  var VIEW_FN = 240 - 20 - 19;       // below header + title line

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function header(tag) {
    var ic = '';
    if (S.tm.running) ic = '<span class="hic">' + (S.tm.mode ? '▼' : '▲') + '</span>';
    return '<div class="hdr"><span class="htag">' + esc(tag) + '</span>' +
      '<span class="htime">' + fmtClock(utcHours(), true) + 'Z</span>' + ic +
      '<span class="hbat"><i></i></span></div>';
  }
  function cursor() { return '<span class="cur"></span>'; }

  function listHtml(items, scr, viewH, cls) {
    keepVisible(scr, items.length, viewH);
    var h = '<div class="view" style="height:' + viewH + 'px"><div class="lst ' + (cls || '') + '" style="transform:translateY(' + (-scr.scroll) + 'px)">';
    items.forEach(function (it, i) {
      h += '<div class="li' + (i === scr.sel ? ' sel' : '') + '"><span class="ll">' + it.l + '</span>' +
        (it.r != null ? '<span class="lr">' + it.r + '</span>' : '') + '</div>';
    });
    return h + '</div></div>';
  }

  function renderMenu(scr) {
    var m = MENUS[scr.id];
    var items = m.items.map(function (it) { return { l: esc(it.label), r: it.menu ? '<span class="chev">›</span>' : null }; });
    return header(m.tag) + listHtml(items, scr, VIEW_LIST);
  }

  function renderPick(scr) {
    var items = ALL_FNS.map(function (id) {
      return { l: esc(FNS[id].title), r: id === S.settings.favFn ? '★' : null };
    });
    return header('FAVORITE') + listHtml(items, scr, VIEW_LIST);
  }

  function renderUserData(scr) {
    return header('USER DATA') + listHtml(USERDATA.map(function (u) { return { l: esc(u.label) }; }), scr, VIEW_LIST);
  }

  function renderSet(scr) {
    var items = SETTINGS_DEF.map(function (d, i) {
      var r;
      if (d.kind === 'time') {
        r = V.edit && i === scr.sel ? esc(V.edit.buf) + cursor() : fmtClock(utcHours(), true).replace(':', '') + 'Z';
      } else if (d.opts) r = esc(d.opts[S.settings[d.id]]);
      else r = esc(d.value);
      return { l: esc(d.label), r: r };
    });
    return header('SETTINGS') + listHtml(items, scr, VIEW_LIST, 'set');
  }

  function renderFn(scr) {
    var fn = FNS[scr.id], res = compute(fn), rows = buildRows(fn);
    if (scr.sel >= rows.length) scr.sel = rows.length - 1;
    keepVisible(scr, rows.length, VIEW_FN);
    var tag = FN_TAG[fn.id] || 'FLIGHT';
    var h = header(tag) + '<div class="sub">' + esc(fn.title) + (S.settings.favFn === fn.id ? ' <span class="star">★</span>' : '') + '</div>';
    h += '<div class="view" style="height:' + VIEW_FN + 'px"><div class="lst" style="transform:translateY(' + (-scr.scroll) + 'px)">';
    rows.forEach(function (r, i) {
      var sel = i === scr.sel;
      if (r.t === 'h') { h += '<div class="li hd">' + esc(r.text) + '</div>'; return; }
      if (r.t === 'add') { h += '<div class="li hd' + (sel ? ' sel' : '') + '">' + esc(r.text) + '<span class="lr add">Add</span></div>'; return; }
      if (r.t === 'clear') { h += '<div class="li hd' + (sel ? ' sel' : '') + '">' + esc(r.text) + '<span class="lr add">Clear</span></div>'; return; }
      var f = r.f, rv = rowValue(fn, r, res), shown = displayValue(fn, f, rv.v);
      var label = (res._labels && res._labels[f.id]) || f.label;
      var cls = 'li fr' + (r.sub ? ' sub' : '') + (sel ? ' sel' : '') + (f.input && !rv.solved ? ' in' : ' out') +
        (rv.inherited ? ' inh' : '') + (fn.conv && !f.input ? ' cv' : '');
      var q = shown == null && !(f.input && f.opt) ? '<span class="q">?</span>' : '<span class="q no"></span>';
      var val;
      if (sel && V.edit) val = esc(V.edit.buf) + cursor();
      else if (shown == null) val = f.input && f.opt ? '<span class="opt">opt</span>' : '--';
      else val = esc(shown);
      var unit = unitLabel(fn, f);
      h += '<div class="' + cls + '">' + q + '<span class="lab">' + (fn.conv && !f.input ? '' : esc(label)) + '</span>' +
        '<span class="val">' + val + '</span><span class="unit">' + esc(unit) + '</span></div>';
    });
    h += '</div></div>';
    if (res.error) h += '<div class="err">' + esc(res.error) + '</div>';
    return h;
  }

  function renderCalc(scr) {
    var c = S.calc, h = header('CALC') + '<div class="tape">';
    // show the last 5 lines, or a window that keeps the selected line visible
    var off = Math.max(0, c.tape.length - 5);
    if (scr.sel >= 0 && scr.sel < off) off = scr.sel;
    var lines = c.tape.slice(off, off + 5);
    lines.forEach(function (t, i) {
      h += '<div class="tl' + (off + i === scr.sel ? ' sel' : '') + '"><span class="tx">' + esc(t.expr) + ' =</span><span class="tr">' +
        esc(t.time ? fmtHMS(t.value) : fmtCalc(t.value)) + '</span></div>';
    });
    h += '</div><div class="cin"><span class="cx">' + (c.fresh || !c.expr ? '<span class="dim">0</span>' : esc(c.expr)) + cursor() + '</span></div>';
    return h;
  }

  function renderTimer(scr) {
    var t = S.tm, ms = tmShown(), sec = t.mode === 1 ? Math.ceil(ms / 1000) : Math.floor(ms / 1000);
    var digits;
    if (V.edit) {
      var b = pad(V.edit.buf, 6);
      digits = b.slice(0, 2) + ':' + b.slice(2, 4) + ':' + b.slice(4);
    } else digits = pad(Math.floor(sec / 3600)) + ':' + pad(Math.floor(sec / 60) % 60) + ':' + pad(sec % 60);
    var h = header('TIMER') + '<div class="big' + (t.alarm ? ' flash' : '') + (V.edit ? ' editing' : '') + '"><span>' + digits + '</span></div>' +
      '<div class="hms"><span>Hours</span><span>Mins</span><span>Secs</span></div><div class="tlist">';
    timerItems().forEach(function (l, i) {
      h += '<div class="li c' + (i === scr.sel ? ' sel' : '') + '">' + esc(l) + '</div>';
    });
    return h + '</div>';
  }

  function renderConfirm(scr) {
    return header('CONFIRM') + '<div class="dlg"><div class="dq">' + esc(scr.text) +
      '</div><div class="dyn"><span>ENTER = Yes</span><span>C = No</span></div></div>';
  }

  function renderMem() {
    if (!V.mem) return '';
    var h = '<div class="mem"><div class="mh">MEMORY <small>ENTER Recall · M Store · C Clear</small></div>';
    for (var i = 0; i < 10; i++) {
      h += '<div class="mr' + (i === V.mem.sel ? ' sel' : '') + '"><b>M' + i + '</b><span>' +
        (S.mem[i] == null ? '--' : esc(fmtCalc(S.mem[i]))) + '</span></div>';
    }
    return h + '</div>';
  }

  var RENDER = { menu: renderMenu, fn: renderFn, set: renderSet, calc: renderCalc, timer: renderTimer,
                 confirm: renderConfirm, pick: renderPick, userdata: renderUserData };

  function render() {
    if (!screenEl) return;
    applyLook();
    if (!V.power) { screenEl.innerHTML = ''; return; }
    if (V.booting) {
      screenEl.innerHTML = '<div class="boot"><div class="bt">CX-3</div><div class="bs">FLIGHT COMPUTER</div><div class="bar"><i></i></div></div>';
      return;
    }
    var scr = top(), h = RENDER[scr.type](scr);
    if (V.toast) {
      if (Date.now() > V.toast.until) V.toast = null;
      else h += '<div class="toast">' + esc(V.toast.text) + '</div>';
    }
    screenEl.innerHTML = h + renderMem();
  }

  function applyLook() {
    if (!screenEl) return;
    var cls = 'screen theme-' + (S.settings.theme === 1 ? 'night' : 'day');
    if (!V.power) cls += ' off';
    if (S.tm.alarm) cls += ' alarm';
    if (screenEl.className !== cls) screenEl.className = cls;
    screenEl.style.filter = 'brightness(' + [1, 0.82, 0.6][S.settings.backlight || 0] + ')';
  }

  // ------------------------------------------------------------ keypad DOM
  var KEYMAP = {
    'Enter': 'ENTER', 'NumpadEnter': 'ENTER', 'Escape': 'BACK', 'Delete': 'C',
    'ArrowUp': 'UP', 'ArrowDown': 'DOWN', 'Backspace': 'BKSP',
    '*': '×', 'x': '×', '/': '÷', '+': '+', '-': '-', '=': '=', '.': '.', ':': ':', ';': ':',
    'f': 'FLT', 'p': 'PLAN', 't': 'TIMER', 'c': 'CALC', 'w': 'W/B', 's': 'SET', 'm': 'M', 'b': 'BACK',
    'n': '+/-', 'r': 'SQRT', 'u': 'SETUNIT', 'v': 'CONVUNIT', '8': '8', 'a': 'FAV', 'ArrowLeft': 'BKSP'
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
    tickTimers();
    var ao = [0, 5, 10, 30][S.settings.autooff];
    if (V.power && ao && !S.tm.running && Date.now() - V.lastKey > ao * 60000) powerOff();
    if (V.power) render();
  }

  document.addEventListener('DOMContentLoaded', function () {
    bind();
    powerOn();
    setInterval(loop, 100);
  });

  window.CX3 = { press: function (k) { press(k); render(); }, state: function () { return S; }, ui: function () { return V; },
                 evaluate: evaluate };
})();
