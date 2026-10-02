/* CX-3 Flight Computer simulator — UI engine */
(function () {
  'use strict';

  var A = window.Aviation, UT = window.Units.TYPES, FNS = window.Defs.FNS,
      MENUS = window.Defs.MENUS, FN_TAG = window.Defs.FN_TAG;

  var STORE_KEY = 'cx3-sim-v1';
  var FN_ROWS = 7, MENU_ROWS = 8, SET_ROWS = 8;

  // ------------------------------------------------------------------ state
  var SETTINGS_DEF = [
    { id: 'backlight', label: 'Backlight', opts: ['1', '2', '3', '4', '5'], def: 4 },
    { id: 'theme', label: 'Theme', opts: ['Day', 'Night', 'Blue'], def: 0 },
    { id: 'clock', label: 'Clock', opts: ['Local', 'UTC'], def: 0 },
    { id: 'tfmt', label: 'Time Format', opts: ['24 Hour', '12 Hour'], def: 0 },
    { id: 'units', label: 'Default Units', opts: ['US', 'Metric'], def: 0 },
    { id: 'dec', label: 'Decimals', opts: ['Auto', '0', '1', '2', '3'], def: 0 },
    { id: 'click', label: 'Key Click', opts: ['On', 'Off'], def: 1 },
    { id: 'autooff', label: 'Auto Off', opts: ['Off', '5 min', '10 min', '30 min'], def: 2 },
    { id: 'reset', label: 'Reset All Data', action: true },
    { id: 'about', label: 'About CX-3', action: true }
  ];

  function freshState() {
    var s = { settings: {}, data: {}, units: {}, favs: [], mem: [], calc: { tape: [], expr: '', fresh: true },
              sw: { running: false, start: 0, acc: 0, laps: [] },
              cd: { set: 0, running: false, end: 0, left: 0, alarm: false } };
    SETTINGS_DEF.forEach(function (d) { if (!d.action) s.settings[d.id] = d.def; });
    for (var i = 0; i < 10; i++) s.mem.push(null);
    return s;
  }

  var S = freshState();
  try {
    var saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (saved) {
      Object.keys(saved).forEach(function (k) { S[k] = saved[k]; });
      SETTINGS_DEF.forEach(function (d) { if (!d.action && S.settings[d.id] == null) S.settings[d.id] = d.def; });
      S.sw.running = false;   // timers do not survive reloads
      S.cd.running = false; S.cd.alarm = false;
    }
  } catch (e) { /* storage unavailable */ }

  var V = {            // volatile UI state
    power: false, booting: false, stack: [], edit: null, pending: null,
    toast: null, lastKey: Date.now(), enterDown: 0, offTimer: null
  };

  var saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) { /* ignore */ }
    }, 200);
  }

  function top() { return V.stack[V.stack.length - 1]; }
  function toast(t, ms) { V.toast = { text: t, until: Date.now() + (ms || 1400) }; }

  // ------------------------------------------------------------ formatting
  function pad(n, w) { n = String(n); while (n.length < (w || 2)) n = '0' + n; return n; }
  function decimals(dp) {
    var d = S.settings.dec;
    return d === 0 ? dp : d - 1;
  }
  function fmtNum(x, dp) {
    if (x == null || !isFinite(x)) return '---';
    var s = Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
    var zero = /^[0.,]*$/.test(s);
    return (x < 0 && !zero ? '-' : '') + s;
  }
  function fmtHMS(h) {
    var neg = h < 0, t = Math.round(Math.abs(h) * 3600);
    var H = Math.floor(t / 3600), M = Math.floor(t / 60) % 60, Sx = t % 60;
    return (neg ? '-' : '') + H + ':' + pad(M) + ':' + pad(Sx);
  }
  function fmtClock(h, secs) {
    var t = Math.round((((h % 24) + 24) % 24) * 3600 * (secs ? 1 : 1 / 60));
    var H, M, Sx = 0;
    if (secs) { H = Math.floor(t / 3600); M = Math.floor(t / 60) % 60; Sx = t % 60; }
    else { H = Math.floor(t / 60); M = t % 60; }
    H = H % 24;
    var suffix = '';
    if (S.settings.tfmt === 1) { suffix = H < 12 ? ' AM' : ' PM'; H = H % 12 || 12; }
    return pad(H) + ':' + pad(M) + (secs ? ':' + pad(Sx) : '') + suffix;
  }
  function fmtDir(d) {
    var r = Math.round(A.norm360(d));
    if (r === 0 || r === 360) r = 360;
    return pad(r, 3) + '°';
  }
  function fmtDM(d, pos, neg) {
    var hemi = d < 0 ? neg : pos, a = Math.abs(d);
    var deg = Math.floor(a), min = Math.round((a - deg) * 6000) / 100;
    if (min >= 60) { deg += 1; min -= 60; }
    return hemi + ' ' + deg + '°' + (min < 10 ? '0' : '') + min.toFixed(2) + "'";
  }

  // ----------------------------------------------------------- field model
  function unitList(f) { return UT[f.type] || null; }
  function unitIdx(fn, f) {
    if (f.fixedUnit != null) return f.fixedUnit;
    var list = unitList(f);
    if (!list) return 0;
    var k = fn.id + '.' + f.id;
    if (S.units[k] != null) return S.units[k];
    if (S.units['*' + f.type] != null) return S.units['*' + f.type];
    var m = S.settings.units === 1 ? (window.Units.METRIC_DEFAULT[f.type] || 0) : 0;
    return m;
  }
  function unitLabel(fn, f) {
    var list = unitList(f);
    if (list) {
      var u = list[unitIdx(fn, f)].name;
      return u === 'h:m:s' ? '' : u;
    }
    return { pct: '%', ratio: ': 1', wca: '', dir: '', rwy: '' }[f.type] || '';
  }

  function data(fn) { return S.data[fn.id] || (S.data[fn.id] = {}); }
  function curIdx(fn) { return fn.indexed ? (data(fn)[fn.indexed] || 1) : 0; }
  function key(fn, f, idx) { return f.per ? f.id + '@' + idx : f.id; }
  function rawVal(fn, f, idx) {
    var v = data(fn)[key(fn, f, idx == null ? curIdx(fn) : idx)];
    if (v == null && f.def != null && !f.per) return f.def;
    return v == null ? null : v;
  }
  // value with leg-to-leg inheritance; returns {v, inherited}
  function effVal(fn, f, idx) {
    var v = rawVal(fn, f, idx);
    if (v != null || !f.inherit) return { v: v, inherited: false };
    for (var i = idx - 1; i >= 1; i--) {
      var p = rawVal(fn, f, i);
      if (p != null) return { v: p, inherited: true };
    }
    return { v: null, inherited: false };
  }
  function fieldById(fn, id) {
    for (var i = 0; i < fn.fields.length; i++) if (fn.fields[i].id === id) return fn.fields[i];
    return null;
  }

  function compute(fn) {
    var idx = curIdx(fn), v = {};
    fn.fields.forEach(function (f) {
      if (f.input) v[f.id] = f.type === 'index' ? idx : effVal(fn, f, idx).v;
    });
    var ctx = {
      idx: idx,
      get: function (id, i) { var f = fieldById(fn, id); return f ? effVal(fn, f, i).v : null; }
    };
    var r;
    try { r = fn.calc(v, ctx) || {}; } catch (e) { r = {}; }
    return r;
  }

  function displayValue(fn, f, base) {
    if (base == null || (typeof base === 'number' && !isFinite(base))) return f.type === 'text' ? '---' : '---';
    switch (f.type) {
      case 'text': return String(base);
      case 'enum': return f.options[base] || f.options[0];
      case 'index': return base + ' / ' + f.max;
      case 'dir': case 'rwy': return fmtDir(base);
      case 'wca':
        var w = Math.round(base * 10) / 10;
        return Math.abs(w) < 0.05 ? '0.0°' : Math.abs(w).toFixed(1) + '° ' + (w > 0 ? 'R' : 'L');
      case 'var':
        return Math.abs(base) < 1e-9 ? '0.0°' : Math.abs(base).toFixed(1) + '° ' + (base > 0 ? 'W' : 'E');
      case 'dev': return (base > 0 ? '+' : '') + fmtNum(base, 1) + '°';
      case 'lat': return fmtDM(base, 'N', 'S');
      case 'lon': return fmtDM(base, 'E', 'W');
      case 'clock': return fmtClock(base, false);
      case 'ratio': return fmtNum(base, decimals(1));
      case 'pct': return fmtNum(base, decimals(1));
      case 'num': return fmtNum(base, decimals(f.dp != null ? f.dp : 2));
    }
    var list = unitList(f);
    if (list) {
      var u = list[unitIdx(fn, f)];
      var x = u.fromBase(base);
      if (u.name === 'h:m:s') return fmtHMS(x);
      return fmtNum(x, decimals(f.dp != null && f.type === 'angle' ? f.dp : u.dp));
    }
    return fmtNum(base, 2);
  }

  // ------------------------------------------------- expression evaluation
  // Supports + - × ÷ with precedence and colon values (h:m:s / d:m:s)
  function evaluate(str) {
    var toks = [], i = 0, s = str.replace(/\s+/g, '');
    if (!s) return null;
    var timeUsed = false;
    while (i < s.length) {
      var c = s[i];
      var expectNum = !toks.length || typeof toks[toks.length - 1] === 'string';
      if (/[0-9.:]/.test(c) || (c === '-' && expectNum)) {
        var j = i + 1;
        while (j < s.length && /[0-9.:]/.test(s[j])) j++;
        var t = s.slice(i, j), neg = false;
        if (t[0] === '-') { neg = true; t = t.slice(1); }
        var v;
        if (t.indexOf(':') >= 0) {
          var parts = t.split(':');
          if (parts.length > 3) return null;
          v = 0;
          for (var k = 0; k < parts.length; k++) {
            var p = parts[k] === '' ? 0 : Number(parts[k]);
            if (isNaN(p)) return null;
            v += p / Math.pow(60, k);
          }
          timeUsed = true;
        } else {
          if (t === '' || t === '.') return null;
          v = Number(t);
          if (isNaN(v)) return null;
        }
        toks.push(neg ? -v : v);
        i = j;
      } else if ('+-×÷*/'.indexOf(c) >= 0) {
        if (expectNum) return null;
        toks.push(c === '*' ? '×' : c === '/' ? '÷' : c);
        i++;
      } else return null;
    }
    if (typeof toks[toks.length - 1] === 'string') toks.pop();
    if (!toks.length) return null;
    // precedence: × ÷ first
    var out = [toks[0]];
    for (var n = 1; n < toks.length; n += 2) {
      var op = toks[n], b = toks[n + 1];
      if (op === '×') out[out.length - 1] *= b;
      else if (op === '÷') { if (b === 0) return { error: 'Div by Zero' }; out[out.length - 1] /= b; }
      else out.push(op, b);
    }
    var r = out[0];
    for (var m = 1; m < out.length; m += 2) r = out[m] === '+' ? r + out[m + 1] : r - out[m + 1];
    return { value: r, time: timeUsed };
  }

  // Parse an edit buffer for a field into a base value (or undefined if invalid)
  function parseField(fn, f, buf) {
    var e = evaluate(buf);
    if (!e || e.error) return undefined;
    var x = e.value;
    switch (f.type) {
      case 'dir':
        if (x < 0 || x > 360) return undefined;
        return x === 0 ? 360 : x;
      case 'rwy':
        if (x < 0 || x > 360) return undefined;
        return x <= 36 && buf.indexOf('.') < 0 ? (x === 0 ? 360 : x * 10) : x;
      case 'var': case 'dev': return x;
      case 'lat': return Math.abs(x) <= 90 ? x : undefined;
      case 'lon': return Math.abs(x) <= 180 ? x : undefined;
      case 'clock':
        if (!e.time && x >= 100) x = Math.floor(x / 100) + (x % 100) / 60;   // 1430 → 14:30
        return x >= 0 && x < 24 ? x : undefined;
      case 'index': x = Math.round(x); return x >= 1 && x <= f.max ? x : undefined;
      case 'ratio': case 'pct': case 'num': return x;
    }
    var list = unitList(f);
    if (list) {
      var u = list[unitIdx(fn, f)];
      if (f.type === 'dur' && e.time) return x;      // colon entries are always h:m:s
      return u.toBase(x);
    }
    return x;
  }

  // ----------------------------------------------------------- navigation
  function goRoot(menuId) {
    V.edit = null; V.pending = null;
    V.stack = [{ type: 'menu', id: menuId, sel: 0, top: 0 }];
  }
  function push(scr) { V.edit = null; V.pending = null; V.stack.push(scr); }
  function back() {
    V.pending = null;
    if (V.edit) { V.edit = null; return; }
    if (V.stack.length > 1) V.stack.pop();
  }
  function openFn(id) {
    var fn = FNS[id];
    push({ type: 'fn', id: id, sel: firstInput(fn), top: 0 });
  }
  function firstInput(fn) {
    for (var i = 0; i < fn.fields.length; i++) if (fn.fields[i].input) return i;
    return 0;
  }
  function openItem(it) {
    if (it.menu) push({ type: 'menu', id: it.menu, sel: 0, top: 0 });
    else if (it.fn) openFn(it.fn);
    else if (it.screen) push({ type: it.screen, sel: 0 });
    else if (it.action === 'clearPlan') confirm('Clear all flight plan legs?', function () { delete S.data.plan; toast('Flight Plan Cleared'); });
    else if (it.action === 'clearWB') confirm('Clear all W/B items?', function () { delete S.data.wb; toast('W/B Items Cleared'); });
  }
  function confirm(text, yes) { push({ type: 'confirm', text: text, yes: yes }); }

  function keepVisible(scr, rows, count) {
    if (scr.sel < scr.top) scr.top = scr.sel;
    if (scr.sel >= scr.top + rows) scr.top = scr.sel - rows + 1;
    if (scr.top > Math.max(0, count - rows)) scr.top = Math.max(0, count - rows);
  }

  // ---------------------------------------------------------- key handling
  var DIGITS = '0123456789';

  function press(k) {
    V.lastKey = Date.now();
    click();
    if (!V.power) { if (k === 'ENTER') powerOn(); return; }
    if (V.booting) return;
    if (S.cd.alarm) { S.cd.alarm = false; stopAlarm(); return; }
    if (V.toast && V.toast.sticky) V.toast = null;

    if (k === 'FLT') return goRoot('FLT');
    if (k === 'PLAN') return goRoot('PLAN');
    if (k === 'TIMER') return goRoot('TIMER');
    if (k === 'W/B') return goRoot('WB');
    if (k === 'CALC') { V.edit = null; V.pending = null; V.stack = [{ type: 'calc', sel: -1 }]; return; }
    if (k === 'SET') { if (top().type !== 'set') push({ type: 'set', sel: 0, top: 0 }); return; }
    if (k === 'BACK') return back();

    if (V.pending) return pendingKey(k);
    if (k === 'STO' || k === 'RCL') {
      if (k === 'STO' && top().type !== 'calc' && top().type !== 'fn') return toast('Nothing to Store');
      V.pending = k; return;
    }

    var scr = top();
    if (k === 'M') {
      if (scr.type === 'fn') {
        var i = S.favs.indexOf(scr.id);
        if (i >= 0) { S.favs.splice(i, 1); toast('Removed from Favorites'); }
        else { S.favs.push(scr.id); toast('Saved to Favorites'); }
        save();
      } else if (scr.type !== 'favs') push({ type: 'favs', sel: 0, top: 0 });
      return;
    }
    var h = HANDLERS[scr.type];
    if (h) h(scr, k);
    save();
  }

  function pendingKey(k) {
    var p = V.pending;
    if (DIGITS.indexOf(k) < 0) { V.pending = null; if (k === 'CLR') return; return press(k); }
    V.pending = null;
    var n = Number(k), scr = top();
    if (p === 'STO') {
      var val = currentValueForStore(scr);
      if (val == null) return toast('No Value');
      S.mem[n] = val; save();
      toast('Stored in M' + n);
    } else {
      var m = S.mem[n];
      if (m == null) return toast('M' + n + ' is Empty');
      insertNumber(scr, m);
    }
  }

  function numStr(x) {
    var s = String(Math.round(x * 1e8) / 1e8);
    return s.indexOf('e') >= 0 ? x.toFixed(6) : s;
  }

  function currentValueForStore(scr) {
    if (scr.type === 'calc') {
      var c = S.calc;
      if (c.expr) { var e = evaluate(c.expr); return e && !e.error ? e.value : null; }
      return c.tape.length ? c.tape[c.tape.length - 1].value : null;
    }
    if (scr.type === 'fn') {
      var fn = FNS[scr.id], f = fn.fields[scr.sel], r = compute(fn);
      var base = f.input ? (effVal(fn, f, curIdx(fn)).v ?? r[f.id]) : r[f.id];
      if (typeof base !== 'number') return null;
      var list = unitList(f);
      return list ? list[unitIdx(fn, f)].fromBase(base) : base;
    }
    return null;
  }

  function insertNumber(scr, x) {
    var s = numStr(x);
    if (scr.type === 'calc') {
      var c = S.calc;
      if (c.fresh) { c.expr = ''; c.fresh = false; }
      c.expr += s;
    } else if (scr.type === 'fn') {
      var fn = FNS[scr.id], f = fn.fields[scr.sel];
      if (!isEditable(fn, f)) return toast('Select an Input');
      if (!V.edit) V.edit = { buf: '' };
      V.edit.buf += s;
    }
  }

  function isEditable(fn, f) { return f.input && f.type !== 'enum'; }

  // --------------------------------------------------- per-screen handlers
  var HANDLERS = {};

  HANDLERS.menu = function (scr, k) {
    var items = MENUS[scr.id].items;
    listNav(scr, k, items.length, MENU_ROWS, function () { openItem(items[scr.sel]); });
    if (DIGITS.indexOf(k) > 0 && Number(k) <= items.length) {
      scr.sel = Number(k) - 1; keepVisible(scr, MENU_ROWS, items.length); openItem(items[scr.sel]);
    }
  };

  HANDLERS.favs = function (scr, k) {
    var n = S.favs.length;
    if (k === 'CLR' && n) { S.favs.splice(scr.sel, 1); if (scr.sel >= S.favs.length) scr.sel = Math.max(0, S.favs.length - 1); return toast('Favorite Removed'); }
    if (!n) return;
    listNav(scr, k, n, MENU_ROWS, function () { openFn(S.favs[scr.sel]); });
  };

  function listNav(scr, k, n, rows, enter) {
    if (k === 'UP') scr.sel = (scr.sel - 1 + n) % n;
    else if (k === 'DOWN') scr.sel = (scr.sel + 1) % n;
    else if (k === 'ENTER' || k === 'RIGHT') return enter();
    else if (k === 'LEFT') return back();
    keepVisible(scr, rows, n);
  }

  HANDLERS.confirm = function (scr, k) {
    if (k === 'ENTER') { V.stack.pop(); scr.yes(); save(); }
    else if (k === 'CLR' || k === 'LEFT') V.stack.pop();
  };

  HANDLERS.about = function (scr, k) { if (k === 'ENTER' || k === 'LEFT') back(); };

  HANDLERS.set = function (scr, k) {
    var n = SETTINGS_DEF.length, d = SETTINGS_DEF[scr.sel];
    if (k === 'UP' || k === 'DOWN') { listNav(scr, k, n, SET_ROWS); return; }
    if (d.action) {
      if (k === 'ENTER' || k === 'RIGHT') {
        if (d.id === 'about') push({ type: 'about' });
        if (d.id === 'reset') confirm('Erase all data and restore factory settings?', function () {
          S = freshState(); stopAlarm(); toast('Reset Complete');
          applyLook();
        });
      }
      return;
    }
    var step = k === 'LEFT' ? -1 : (k === 'RIGHT' || k === 'ENTER') ? 1 : 0;
    if (!step) return;
    var cur = S.settings[d.id], nv = (cur + step + d.opts.length) % d.opts.length;
    S.settings[d.id] = nv;
    if (d.id === 'units') {   // drop per-field unit choices so defaults take effect
      S.units = {};
    }
    applyLook();
  };

  HANDLERS.fn = function (scr, k) {
    var fn = FNS[scr.id], f = fn.fields[scr.sel], n = fn.fields.length;

    // ----- editing
    if (V.edit) {
      if (DIGITS.indexOf(k) >= 0 || k === '.' || k === ':' || k === '+' || k === '-' || k === '×' || k === '÷') {
        if (V.edit.buf.length < 16) V.edit.buf += k;
        return;
      }
      if (k === '+/-') { V.edit.buf = V.edit.buf[0] === '-' ? V.edit.buf.slice(1) : '-' + V.edit.buf; return; }
      if (k === 'LEFT') { V.edit.buf = V.edit.buf.slice(0, -1); if (!V.edit.buf) V.edit = null; return; }
      if (k === 'CLR') { V.edit = null; return; }
      if (k === 'ENTER' || k === '=' || k === 'UP' || k === 'DOWN') {
        if (!commit(fn, f)) return;
        if (k === 'UP') return moveSel(scr, fn, -1);
        if (k === 'DOWN') return moveSel(scr, fn, 1);
        return nextInput(scr, fn);
      }
      return;
    }

    // ----- not editing
    if (DIGITS.indexOf(k) >= 0 || k === '.' || k === ':') {
      if (!isEditable(fn, f)) {
        if (f.type === 'enum') return;
        return toast('Output — Select an Input');
      }
      V.edit = { buf: k };
      return;
    }
    if (k === '-' && isEditable(fn, f)) { V.edit = { buf: '-' }; return; }
    switch (k) {
      case 'UP': return moveSel(scr, fn, -1);
      case 'DOWN': return moveSel(scr, fn, 1);
      case 'ENTER':
        if (f.input) return nextInput(scr, fn);
        return;
      case 'LEFT': case 'RIGHT':
        return sideKey(fn, f, k === 'LEFT' ? -1 : 1);
      case 'CLR':
        if (f.input && f.type !== 'index') {
          delete data(fn)[key(fn, f, curIdx(fn))];
        }
        return;
      case '+/-':
        if (f.input) {
          var cur = rawVal(fn, f);
          if (typeof cur === 'number' && f.type !== 'index' && f.type !== 'enum') data(fn)[key(fn, f, curIdx(fn))] = -cur;
        }
        return;
    }
  };

  function commit(fn, f) {
    var x = parseField(fn, f, V.edit.buf);
    if (x === undefined) { toast('Invalid Entry'); V.edit = null; return false; }
    data(fn)[key(fn, f, curIdx(fn))] = x;
    V.edit = null;
    save();
    return true;
  }
  function moveSel(scr, fn, d) {
    var n = fn.fields.length;
    scr.sel = (scr.sel + d + n) % n;
    keepVisible(scr, FN_ROWS, n);
  }
  function nextInput(scr, fn) {
    var n = fn.fields.length;
    // W/B: after the last item field, step to the next item's weight
    if (fn.advance && fn.fields[scr.sel].id === fn.advance) {
      var ix = fieldById(fn, fn.indexed);
      data(fn)[fn.indexed] = Math.min(curIdx(fn) + 1, ix.max);
      scr.sel = fn.fields.indexOf(ix) + 1; keepVisible(scr, FN_ROWS, n);
      return;
    }
    for (var i = scr.sel + 1; i < n; i++) {
      if (fn.fields[i].input) { scr.sel = i; keepVisible(scr, FN_ROWS, n); return; }
    }
    // past the last input: jump to the first result
    for (var j = 0; j < n; j++) {
      if (!fn.fields[j].input) { scr.sel = j; keepVisible(scr, FN_ROWS, n); return; }
    }
    scr.sel = firstInput(fn); keepVisible(scr, FN_ROWS, n);
  }
  function cycleEnum(fn, f, d) {
    var cur = rawVal(fn, f) || 0;
    data(fn)[f.id] = (cur + d + f.options.length) % f.options.length;
  }
  function sideKey(fn, f, d) {
    if (f.type === 'enum') return cycleEnum(fn, f, d);
    if (f.type === 'index') {
      var i = curIdx(fn) + d;
      if (i < 1) i = f.max; if (i > f.max) i = 1;
      data(fn)[f.id] = i;
      return;
    }
    var cur = rawVal(fn, f);
    if (f.input && (f.type === 'var' || f.type === 'lat' || f.type === 'lon')) {
      if (typeof cur === 'number') data(fn)[key(fn, f, curIdx(fn))] = -cur;
      return;
    }
    var list = unitList(f);
    if (!list || f.fixedUnit != null || list.length < 2) return;
    var ui = (unitIdx(fn, f) + d + list.length) % list.length;
    S.units[fn.id + '.' + f.id] = ui;
  }

  // ------------------------------------------------------------ calculator
  HANDLERS.calc = function (scr, k) {
    var c = S.calc;
    var n = c.tape.length;
    if (k === 'UP' || k === 'DOWN') {
      if (!n) return;
      if (scr.sel < 0) scr.sel = n;
      scr.sel += k === 'UP' ? -1 : 1;
      if (scr.sel < 0) scr.sel = 0;
      if (scr.sel >= n) scr.sel = -1;
      return;
    }
    if (scr.sel >= 0 && k === 'ENTER') {      // recall a tape result
      if (c.fresh) { c.expr = ''; c.fresh = false; }
      c.expr += numStr(c.tape[scr.sel].value);
      scr.sel = -1;
      return;
    }
    scr.sel = -1;
    if (DIGITS.indexOf(k) >= 0 || k === '.' || k === ':') {
      if (c.fresh) { c.expr = ''; c.fresh = false; }
      if (c.expr.length < 32) c.expr += k;
      return;
    }
    if ('+-×÷'.indexOf(k) >= 0 && k.length === 1) {
      if (c.fresh) {
        c.fresh = false;
        c.expr = n ? (c.tape[n - 1].time ? fmtHMS(c.tape[n - 1].value) : numStr(c.tape[n - 1].value)) : (k === '-' ? '' : '0');
      }
      if (/[+\-×÷]$/.test(c.expr)) c.expr = c.expr.slice(0, -1);
      c.expr += k;
      return;
    }
    if (k === '+/-') {
      if (c.fresh) { c.expr = n ? numStr(-c.tape[n - 1].value) : '-'; c.fresh = false; return; }
      var i = c.expr.length;
      while (i > 0 && /[0-9.:]/.test(c.expr[i - 1])) i--;
      var unary = i > 0 && c.expr[i - 1] === '-' && (i === 1 || /[+\-×÷]/.test(c.expr[i - 2]));
      c.expr = unary ? c.expr.slice(0, i - 1) + c.expr.slice(i) : c.expr.slice(0, i) + '-' + c.expr.slice(i);
      return;
    }
    if (k === 'LEFT') { if (!c.fresh) c.expr = c.expr.slice(0, -1); return; }
    if (k === 'CLR') {
      if (c.expr && !c.fresh) { c.expr = ''; return; }
      c.tape = []; c.expr = ''; c.fresh = true; return;
    }
    if (k === '=' || k === 'ENTER') {
      if (!c.expr || c.fresh) return;
      var e = evaluate(c.expr);
      if (!e) return toast('Syntax Error');
      if (e.error) return toast(e.error);
      c.tape.push({ expr: c.expr, value: e.value, time: e.time });
      if (c.tape.length > 50) c.tape.shift();
      c.expr = ''; c.fresh = true;
    }
  };

  // ---------------------------------------------------------------- timers
  function swElapsed() { return S.sw.acc + (S.sw.running ? Date.now() - S.sw.start : 0); }
  HANDLERS.stopwatch = function (scr, k) {
    var sw = S.sw;
    if (k === 'ENTER') {
      if (sw.running) { sw.acc += Date.now() - sw.start; sw.running = false; }
      else { sw.start = Date.now(); sw.running = true; }
    } else if (k === 'CLR') {
      if (sw.running) return toast('Stop Before Reset');
      sw.acc = 0; sw.laps = [];
    } else if (k === 'RIGHT') {
      if (!sw.running) return;
      sw.laps.unshift(swElapsed());
      if (sw.laps.length > 20) sw.laps.pop();
    } else if (k === 'LEFT') back();
  };

  function cdLeft() { return S.cd.running ? Math.max(0, S.cd.end - Date.now()) : S.cd.left; }
  HANDLERS.countdown = function (scr, k) {
    var cd = S.cd;
    if (V.edit) {
      if (DIGITS.indexOf(k) >= 0 || k === ':' || k === '.') { if (V.edit.buf.length < 10) V.edit.buf += k; return; }
      if (k === 'LEFT') { V.edit.buf = V.edit.buf.slice(0, -1); if (!V.edit.buf) V.edit = null; return; }
      if (k === 'CLR') { V.edit = null; return; }
      if (k === 'ENTER') {
        var e = evaluate(V.edit.buf);
        V.edit = null;
        if (!e || e.error || e.value <= 0 || e.value >= 100) return toast('Invalid Entry');
        // plain numbers are minutes, colon entries are h:m:s
        var h = e.time ? e.value : e.value / 60;
        cd.set = h * 3600000; cd.left = cd.set; cd.running = false;
      }
      return;
    }
    if (DIGITS.indexOf(k) >= 0 || k === ':') {
      if (cd.running) return toast('Stop Timer First');
      V.edit = { buf: k }; return;
    }
    if (k === 'ENTER') {
      if (cd.running) { cd.left = cdLeft(); cd.running = false; }
      else {
        if (!cd.left) cd.left = cd.set;
        if (!cd.left) return toast('Enter a Time');
        cd.end = Date.now() + cd.left; cd.running = true;
      }
    } else if (k === 'CLR') { cd.running = false; cd.left = cd.set; }
    else if (k === 'LEFT') back();
  };

  HANDLERS.clock = function (scr, k) { if (k === 'LEFT') back(); };

  function tickTimers() {
    var cd = S.cd;
    if (cd.running && Date.now() >= cd.end) {
      cd.running = false; cd.left = 0; cd.alarm = true;
      startAlarm();
      if (!V.power) powerOn();
    }
  }

  // ----------------------------------------------------------------- sound
  var AC = null;
  function audio() {
    if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { AC = null; } }
    return AC;
  }
  function tone(freq, dur, vol) {
    var ac = audio(); if (!ac) return;
    var o = ac.createOscillator(), g = ac.createGain();
    o.type = 'square'; o.frequency.value = freq;
    g.gain.value = vol || 0.04;
    o.connect(g); g.connect(ac.destination);
    o.start(); o.stop(ac.currentTime + dur);
  }
  function click() { if (S.settings.click === 0) tone(2400, 0.012, 0.02); }
  var alarmTimer = null;
  function startAlarm() {
    clearInterval(alarmTimer);
    var n = 0;
    alarmTimer = setInterval(function () {
      if (!S.cd.alarm || n++ > 60) return stopAlarm();
      tone(2800, 0.08, 0.06); setTimeout(function () { tone(2800, 0.08, 0.06); }, 150);
    }, 700);
  }
  function stopAlarm() { clearInterval(alarmTimer); alarmTimer = null; if (S) S.cd.alarm = false; }

  // ---------------------------------------------------------------- power
  var screenEl, bodyEl;
  function powerOn() {
    V.power = true; V.booting = true; V.lastKey = Date.now();
    if (!V.stack.length) goRoot('FLT');
    render();
    setTimeout(function () { V.booting = false; render(); }, 1300);
  }
  function powerOff() {
    V.power = false; V.edit = null; V.pending = null; V.toast = null;
    render();
  }

  // ------------------------------------------------------------- rendering
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function nowHours(utc) {
    var d = new Date();
    if (utc) return d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
    return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
  }

  function statusBar(title, tag) {
    var utc = S.settings.clock === 1;
    var icons = '';
    if (S.sw.running) icons += '<span class="ic" title="Stopwatch running">SW</span>';
    if (S.cd.running) icons += '<span class="ic" title="Countdown running">CD</span>';
    if (V.pending) icons += '<span class="ic hot">' + V.pending + '</span>';
    return '<div class="sbar"><span class="tag">' + esc(tag || '') + '</span>' +
      '<span class="ttl">' + esc(title) + '</span>' + icons +
      '<span class="clk">' + fmtClock(nowHours(utc), false) + (utc ? 'Z' : '') + '</span>' +
      '<span class="bat"><i></i></span></div>';
  }
  function footer(t) { return '<div class="foot">' + t + '</div>'; }

  function renderMenu(scr) {
    var m = MENUS[scr.id], h = statusBar(m.title, m.tag) + '<div class="list">';
    keepVisible(scr, MENU_ROWS, m.items.length);
    for (var i = scr.top; i < Math.min(m.items.length, scr.top + MENU_ROWS); i++) {
      var it = m.items[i];
      h += '<div class="li' + (i === scr.sel ? ' sel' : '') + '"><span class="num">' + (i < 9 ? i + 1 : '') + '</span>' +
        esc(it.label) + (it.menu ? '<span class="arr">▸</span>' : '') + '</div>';
    }
    h += '</div>' + scrollbar(scr.top, MENU_ROWS, m.items.length);
    return h + footer('▲▼ Select &nbsp; ENTER Open &nbsp; M Favorites');
  }

  function scrollbar(topRow, rows, n) {
    if (n <= rows) return '';
    var hgt = rows / n * 100, t = topRow / n * 100;
    return '<div class="sb"><i style="top:' + t + '%;height:' + hgt + '%"></i></div>';
  }

  function renderFn(scr) {
    var fn = FNS[scr.id], r = compute(fn), idx = curIdx(fn), n = fn.fields.length;
    var fav = S.favs.indexOf(fn.id) >= 0;
    var h = statusBar(fn.title, FN_TAG[fn.id] || 'FLT') + '<div class="rows">';
    keepVisible(scr, FN_ROWS, n);
    for (var i = scr.top; i < Math.min(n, scr.top + FN_ROWS); i++) {
      var f = fn.fields[i], sel = i === scr.sel, cls = 'row';
      var val, dim = false, isOut = !f.input, label = f.label;
      if (r._labels && r._labels[f.id]) label = r._labels[f.id];
      if (f.input) {
        if (f.type === 'index') val = idx;
        else {
          var ev = effVal(fn, f, idx);
          val = ev.v; dim = ev.inherited;
          if (val == null && fn.solver && r[f.id] != null) { val = r[f.id]; isOut = true; }
        }
      } else val = r[f.id];
      var shown = displayValue(fn, f, val);
      if (f.input && val == null && !isOut) shown = f.opt ? '<span class="opt">opt</span>' : '';
      if (sel && V.edit) shown = '<span class="ed">' + esc(V.edit.buf) + '</span><span class="cur"></span>';
      cls += isOut ? ' out' : ' in';
      if (f.total) cls += ' tot';
      if (f.type === 'index') cls += ' idx';
      if (sel) cls += ' sel';
      if (dim) cls += ' dim';
      var unit = unitLabel(fn, f);
      var lab = fn.conv && !f.input ? '' : esc(label);
      var arrows = sel && !V.edit && (f.type === 'index' || f.type === 'enum') ? ['◂ ', ' ▸'] : ['', ''];
      h += '<div class="' + cls + '"><span class="lab">' + lab + '</span>' +
        '<span class="val">' + arrows[0] + (sel && V.edit ? shown : (shown.indexOf('<span') === 0 ? shown : esc(shown))) + arrows[1] + '</span>' +
        '<span class="unit">' + esc(unit) + '</span></div>';
    }
    h += '</div>' + scrollbar(scr.top, FN_ROWS, n);
    if (r.error) h += '<div class="err">' + esc(r.error) + '</div>';
    var f0 = fn.fields[scr.sel], hint;
    if (V.edit) hint = 'ENTER Accept &nbsp; ◄ Del &nbsp; CLR Cancel';
    else if (f0.type === 'index') hint = '◄► ' + f0.label + ' &nbsp; ▲▼ Select';
    else if (f0.type === 'enum') hint = '◄► Change &nbsp; ▲▼ Select';
    else if (f0.type === 'dur' && f0.input) hint = 'Use : for h:m:s &nbsp; ◄► Units';
    else if (f0.type === 'var') hint = '◄► E/W &nbsp; West = +';
    else if (f0.type === 'lat' || f0.type === 'lon') hint = 'd:m:s &nbsp; ◄► ' + (f0.type === 'lat' ? 'N/S' : 'E/W');
    else if (f0.type === 'rwy') hint = 'Rwy 1–36 or heading';
    else if (fn.solver) hint = 'Leave one blank to solve';
    else if (unitList(f0) && f0.fixedUnit == null) hint = '◄► Units &nbsp; ▲▼ Select';
    else hint = '▲▼ Select &nbsp; ENTER Next';
    return h + footer((fav ? '<b class="fav">★</b> ' : '') + hint);
  }

  function renderSet(scr) {
    var h = statusBar('Settings', 'SET') + '<div class="list">';
    keepVisible(scr, SET_ROWS, SETTINGS_DEF.length);
    for (var i = scr.top; i < Math.min(SETTINGS_DEF.length, scr.top + SET_ROWS); i++) {
      var d = SETTINGS_DEF[i], sel = i === scr.sel;
      h += '<div class="li set' + (sel ? ' sel' : '') + '">' + esc(d.label) +
        (d.action ? '<span class="arr">▸</span>' :
          '<span class="sv">' + (sel ? '◂ ' : '') + esc(d.opts[S.settings[d.id]]) + (sel ? ' ▸' : '') + '</span>') + '</div>';
    }
    h += '</div>' + scrollbar(scr.top, SET_ROWS, SETTINGS_DEF.length);
    return h + footer('◄► Change &nbsp; BACK Exit');
  }

  function renderFavs(scr) {
    var h = statusBar('Favorites', 'M') + '<div class="list">';
    if (!S.favs.length) h += '<div class="empty">No favorites saved.<br><br>Open any function and<br>press <b>M</b> to save it here.</div>';
    keepVisible(scr, MENU_ROWS, S.favs.length);
    for (var i = scr.top; i < Math.min(S.favs.length, scr.top + MENU_ROWS); i++) {
      var fn = FNS[S.favs[i]];
      h += '<div class="li' + (i === scr.sel ? ' sel' : '') + '"><span class="num">★</span>' + esc(fn ? fn.title : S.favs[i]) +
        '<span class="arr sm">' + esc(FN_TAG[S.favs[i]] || '') + '</span></div>';
    }
    return h + '</div>' + footer('ENTER Open &nbsp; CLR Remove');
  }

  function renderCalc(scr) {
    var c = S.calc, h = statusBar('Calculator', 'CALC') + '<div class="tape">';
    var lines = c.tape.slice(-6), off = c.tape.length - lines.length;
    lines.forEach(function (t, i) {
      var sel = off + i === scr.sel;
      h += '<div class="tl' + (sel ? ' sel' : '') + '"><span class="tx">' + esc(t.expr) + ' =</span><span class="tr">' +
        esc(t.time ? fmtHMS(t.value) : fmtCalc(t.value)) + '</span></div>';
    });
    if (!c.tape.length) h += '<div class="tl ghost">Ready</div>';
    h += '</div><div class="cin">' + (c.fresh ? '<span class="ghost">' + (c.tape.length ? 'Ans ' : '') + '0</span>' : esc(c.expr)) +
      '<span class="cur"></span></div>';
    var mem = S.mem.some(function (m) { return m != null; });
    return h + footer((mem ? '<b class="fav">M</b> ' : '') + '▲▼ Tape &nbsp; : h:m:s &nbsp; CLR Clear');
  }
  function fmtCalc(x) {
    if (!isFinite(x)) return 'Error';
    if (Math.abs(x) >= 1e12 || (Math.abs(x) < 1e-6 && x !== 0)) return x.toExponential(6);
    var s = String(Math.round(x * 1e8) / 1e8);
    var p = s.split('.');
    p[0] = Number(p[0]).toLocaleString('en-US');
    if (s[0] === '-' && p[0][0] !== '-') p[0] = '-' + p[0];
    return p.join('.');
  }

  function fmtMs(ms, tenths) {
    var t = Math.floor(ms / 100), ds = t % 10, s = Math.floor(t / 10);
    return pad(Math.floor(s / 3600)) + ':' + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60) + (tenths ? '<small>.' + ds + '</small>' : '');
  }

  function renderStopwatch() {
    var sw = S.sw, h = statusBar('Stopwatch', 'TIMER');
    h += '<div class="big">' + fmtMs(swElapsed(), true) + '</div>';
    h += '<div class="state">' + (sw.running ? '<b class="run">● RUNNING</b>' : (sw.acc ? 'STOPPED' : 'READY')) + '</div><div class="laps">';
    sw.laps.slice(0, 3).forEach(function (l, i) {
      h += '<div>Lap ' + (sw.laps.length - i) + '<span>' + fmtMs(l, true) + '</span></div>';
    });
    return h + '</div>' + footer('ENTER Start/Stop &nbsp; ► Lap &nbsp; CLR Reset');
  }

  function renderCountdown() {
    var cd = S.cd, h = statusBar('Countdown', 'TIMER');
    var left = cdLeft();
    if (V.edit) h += '<div class="big edit">' + esc(V.edit.buf) + '<span class="cur"></span></div>';
    else h += '<div class="big' + (cd.alarm ? ' flash' : '') + '">' + fmtMs(Math.ceil(left / 1000) * 1000, false) + '</div>';
    h += '<div class="state">' + (cd.alarm ? '<b class="alarm">TIME UP</b>' : cd.running ? '<b class="run">● COUNTING DOWN</b>' :
      (left && left !== cd.set ? 'PAUSED' : 'SET ' + fmtMs(cd.set, false))) + '</div>';
    h += '<div class="note">Type minutes, or h:m:s with the : key</div>';
    return h + footer('ENTER Start/Stop &nbsp; CLR Reset');
  }

  function renderClock() {
    var d = new Date(), h = statusBar('Clock', 'TIMER');
    var days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    var mons = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    h += '<div class="clkrow"><span class="cl">LOCAL</span><span class="cv">' + fmtClock(nowHours(false), true) + '</span></div>';
    h += '<div class="clkrow"><span class="cl">UTC</span><span class="cv">' + fmtClock(nowHours(true), true) + 'Z</span></div>';
    h += '<div class="date">' + days[d.getDay()] + ' ' + pad(d.getDate()) + ' ' + mons[d.getMonth()] + ' ' + d.getFullYear() +
      '<br><small>UTC ' + pad(d.getUTCDate()) + ' ' + mons[d.getUTCMonth()] + '</small></div>';
    return h + footer('SET to change clock format');
  }

  function renderConfirm(scr) {
    return statusBar('Confirm', '') + '<div class="dlg"><div class="q">' + esc(scr.text) +
      '</div><div class="yn"><span>ENTER = Yes</span><span>BACK = No</span></div></div>' + footer('');
  }

  function renderAbout() {
    return statusBar('About', 'SET') + '<div class="about"><div class="logo">CX-3</div>' +
      '<div>Flight Computer</div><div class="sm">Browser simulator · v1.0</div>' +
      '<div class="sm">Keyboard: digits, + − * /, Enter, Esc = BACK,<br>Backspace = ◄, Del = CLR, arrows</div></div>' +
      footer('BACK Exit');
  }

  function renderPending() {
    if (!V.pending) return '';
    var h = '<div class="pend"><div class="ph">' + (V.pending === 'STO' ? 'Store to memory' : 'Recall memory') + ' — press 0–9</div><div class="pg">';
    for (var i = 0; i < 10; i++) {
      h += '<div><b>M' + i + '</b> ' + (S.mem[i] == null ? '<i>empty</i>' : esc(fmtCalc(S.mem[i]))) + '</div>';
    }
    return h + '</div></div>';
  }

  var RENDER = { menu: renderMenu, fn: renderFn, set: renderSet, favs: renderFavs, calc: renderCalc,
                 stopwatch: renderStopwatch, countdown: renderCountdown, clock: renderClock,
                 confirm: renderConfirm, about: renderAbout };

  function render() {
    if (!screenEl) return;
    if (!V.power) { screenEl.className = 'screen off'; screenEl.innerHTML = ''; return; }
    applyLook();
    if (V.booting) {
      screenEl.innerHTML = '<div class="boot"><div class="logo">CX-3</div><div>FLIGHT COMPUTER</div><div class="bar"><i></i></div></div>';
      return;
    }
    var scr = top(), h = RENDER[scr.type](scr);
    if (V.toast) {
      if (Date.now() > V.toast.until) V.toast = null;
      else h += '<div class="toast">' + esc(V.toast.text) + '</div>';
    }
    h += renderPending();
    screenEl.innerHTML = h;
  }

  function applyLook() {
    if (!screenEl) return;
    var th = ['day', 'night', 'blue'][S.settings.theme] || 'day';
    screenEl.className = 'screen theme-' + th + (S.cd.alarm ? ' alarm' : '');
    var b = 0.45 + S.settings.backlight * 0.11;
    screenEl.style.filter = 'brightness(' + b.toFixed(2) + ')';
  }

  // ------------------------------------------------------------ keypad DOM
  var KEYMAP = {
    'Enter': 'ENTER', 'NumpadEnter': 'ENTER', 'Escape': 'BACK', 'Delete': 'CLR',
    'ArrowUp': 'UP', 'ArrowDown': 'DOWN', 'ArrowLeft': 'LEFT', 'ArrowRight': 'RIGHT',
    'Backspace': 'LEFT', '*': '×', 'x': '×', '/': '÷', '+': '+', '-': '-', '=': '=', '.': '.', ':': ':', ';': ':',
    'f': 'FLT', 'p': 'PLAN', 't': 'TIMER', 'c': 'CALC', 'w': 'W/B', 's': 'SET', 'm': 'M', 'b': 'BACK',
    'n': '+/-', 'k': 'STO', 'r': 'RCL'
  };

  function keyEl(k) { return document.querySelector('[data-k="' + (k === '+/-' ? '+/-' : k) + '"]'); }
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
    bodyEl = document.getElementById('device');
    document.querySelectorAll('[data-k]').forEach(function (el) {
      var k = el.getAttribute('data-k');
      var down = function (e) {
        e.preventDefault();
        el.classList.add('pressed');
        if (k === 'ENTER') return enterDown();
        press(k); render();
      };
      var up = function () {
        el.classList.remove('pressed');
        if (k === 'ENTER') enterUp();
      };
      el.addEventListener('pointerdown', down);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointerleave', function () { el.classList.remove('pressed'); if (k === 'ENTER' && V.enterDown) enterUp(); });
    });
    document.addEventListener('keydown', function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      var k = /^[0-9]$/.test(e.key) ? e.key : KEYMAP[e.key] || KEYMAP[e.key.toLowerCase()];
      if (!k) return;
      e.preventDefault();
      if (k === 'ENTER') { if (!e.repeat) { flash('ENTER'); keyEl('ENTER') && keyEl('ENTER').classList.add('pressed'); enterDown(); } return; }
      flash(k); press(k); render();
    });
    document.addEventListener('keyup', function (e) {
      if (e.key === 'Enter' || e.key === 'NumpadEnter') { var el = keyEl('ENTER'); el && el.classList.remove('pressed'); enterUp(); }
    });
    window.addEventListener('resize', fit);
    fit();
  }

  function fit() {
    var dev = document.getElementById('device');
    var wrap = document.getElementById('stage');
    var w = window.innerWidth - 24, h = window.innerHeight - 24;
    var k = Math.min(w / dev.offsetWidth, h / dev.offsetHeight, 1.6);
    dev.style.transform = 'scale(' + k + ')';
    wrap.style.height = Math.ceil(dev.offsetHeight * k + 24) + 'px';
  }

  // ------------------------------------------------------------- main loop
  function loop() {
    tickTimers();
    var ao = [0, 5, 10, 30][S.settings.autooff];
    if (V.power && ao && !S.sw.running && !S.cd.running && Date.now() - V.lastKey > ao * 60000) powerOff();
    if (V.power) render();
  }

  document.addEventListener('DOMContentLoaded', function () {
    bind();
    powerOn();
    setInterval(loop, 100);
  });

  // exposed for tests / debugging
  window.CX3 = { press: function (k) { press(k); render(); }, state: function () { return S; }, ui: function () { return V; },
                 evaluate: evaluate };
})();
