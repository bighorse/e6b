/* CX-3 calculator core: expression evaluation, number formatting and the CALC
 * key state machine. Pure functions over a plain state object, so it runs in
 * the browser and in Node tests alike.
 *
 * State (persisted as S.calc): { tape: [{expr, value, time}], expr: '', fresh: true, ans: {value, time} | null }
 *   expr  — the line being typed; "Ans" stands for the previous result at full precision
 *   fresh — true right after "=" or a full clear: the next digit starts a new line
 */
(function (root) {
  'use strict';

  var OPS = '+-×÷';
  var MAX_ENTRY = 40;          // characters typed into one line
  var MAX_TAPE = 50;

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  // h:mm:ss for a value in hours (rounded to the second)
  function fmtHMS(h) {
    var neg = h < 0, t = Math.round(Math.abs(h) * 3600);
    return (neg && t ? '-' : '') + Math.floor(t / 3600) + ':' + pad(Math.floor(t / 60) % 60) + ':' + pad(t % 60);
  }

  // Result display: grouped thousands, up to 8 decimals; scientific outside 1e-6 … 1e12
  function fmtCalc(x) {
    if (!isFinite(x)) return 'Error';
    if (x === 0) return '0';
    if (Math.abs(x) >= 1e12 || Math.abs(x) < 1e-6) return x.toExponential(6);
    var r = Math.round(x * 1e8) / 1e8;
    if (r === 0) return '0';
    var s = String(Math.abs(r)), p = s.split('.');
    p[0] = Number(p[0]).toLocaleString('en-US');
    return (r < 0 ? '-' : '') + p.join('.');
  }

  // Plain-decimal text for a value inserted into an expression: 15 significant
  // digits (drops binary noise such as 0.30000000000000004), never exponent form.
  function numStr(x) {
    if (!isFinite(x)) return '0';
    var v = Number(x.toPrecision(15));
    var s = String(v);
    if (s.indexOf('e') < 0) return s;
    if (Math.abs(v) >= 1) return (v < 0 ? '-' : '') + BigInt(Math.round(Math.abs(v))).toString();
    s = Math.abs(v).toFixed(20).replace(/0+$/, '').replace(/\.$/, '');
    return s === '0' ? '0' : (v < 0 ? '-' : '') + s;
  }

  /* Evaluate an expression: + − × ÷ with the usual precedence, unary minus,
   * √ prefix, colon values (h:m:s or d:m:s) and "Ans".
   * Each operand carries a time dimension (1 for a colon value) so the result is
   * shown as a time only when it is one: time ± time, time × n, time ÷ n.
   * Returns {value, time}, {error}, or null for a syntax error. */
  function evaluate(str, ans) {
    var s = String(str).replace(/\s+/g, '');
    if (!s) return null;
    var terms = [], ops = [], i = 0;
    while (i < s.length) {
      // operand
      var neg = false, root = false;
      if (s[i] === '-') { neg = true; i++; }
      if (s[i] === '√') { root = true; i++; }
      var v, dim;
      if (s.substr(i, 3) === 'Ans') {
        if (!ans) return null;
        v = ans.value; dim = ans.time ? 1 : 0; i += 3;
      } else {
        var k = i;
        while (k < s.length && /[0-9.:]/.test(s[k])) k++;
        var t = s.slice(i, k);
        if (!t || t === '.') return null;
        if (t.indexOf(':') >= 0) {
          var parts = t.split(':');
          if (parts.length > 3) return null;
          v = 0;
          for (var m = 0; m < parts.length; m++) {
            if (parts[m] !== '' && !/^(\d+\.?\d*|\.\d+)$/.test(parts[m])) return null;
            v += (parts[m] === '' ? 0 : Number(parts[m])) / Math.pow(60, m);
          }
          dim = 1;
        } else {
          if (!/^(\d+\.?\d*|\.\d+)$/.test(t)) return null;
          v = Number(t); dim = 0;
        }
        i = k;
      }
      if (root) { if (v < 0) return { error: 'Error' }; v = Math.sqrt(v); dim /= 2; }
      terms.push({ v: neg ? -v : v, d: dim });
      if (i >= s.length) break;
      // operator
      if (OPS.indexOf(s[i]) < 0) return null;
      ops.push(s[i]); i++;
      if (i >= s.length) return null;           // dangling operator
    }
    // × and ÷ first
    var sum = [terms[0]], sops = [];
    for (var n = 0; n < ops.length; n++) {
      var b = terms[n + 1], a = sum[sum.length - 1];
      if (ops[n] === '×') sum[sum.length - 1] = { v: a.v * b.v, d: a.d + b.d };
      else if (ops[n] === '÷') {
        if (b.v === 0) return { error: 'Div by Zero' };
        sum[sum.length - 1] = { v: a.v / b.v, d: a.d - b.d };
      } else { sum.push(b); sops.push(ops[n]); }
    }
    var r = sum[0].v, d = sum[0].d;
    for (var q = 0; q < sops.length; q++) {
      var c = sum[q + 1];
      r = sops[q] === '+' ? r + c.v : r - c.v;
      if (d !== c.d) d = (d === 1 || c.d === 1) ? 1 : d;   // a plain number added to a time counts as hours
    }
    if (!isFinite(r)) return { error: 'Overflow' };
    return { value: r, time: d === 1 };
  }

  // ------------------------------------------------------------ key machine
  var OPERAND_TAIL = /(Ans|[0-9.:]+)$/;
  var OPERAND_CHAR = /[0-9.:√Ans]/;

  function fresh(st) { return st.fresh; }
  function start(st) { if (st.fresh) { st.expr = ''; st.fresh = false; } }

  // put a value into the line, replacing a number already being typed there
  function appendOperand(st, text) {
    start(st);
    st.expr = st.expr.replace(OPERAND_TAIL, '') + text;
  }
  function valueText(v, time) { return time ? fmtHMS(v) : numStr(v); }

  /* Apply one key. sel = {sel: index of the highlighted tape line or -1}.
   * Returns {toast} for a message, otherwise undefined. */
  function key(st, sel, k) {
    var n = st.tape.length;
    if (!('ans' in st)) st.ans = n ? { value: st.tape[n - 1].value, time: st.tape[n - 1].time } : null;

    if (k === 'UP' || k === 'DOWN') {
      if (!n) return;
      if (sel.sel < 0) sel.sel = n;
      sel.sel += k === 'UP' ? -1 : 1;
      if (sel.sel < 0) sel.sel = 0;
      if (sel.sel >= n) sel.sel = -1;
      return;
    }
    if (sel.sel >= 0 && k === 'ENTER') {           // recall a tape line
      var line = st.tape[sel.sel];
      appendOperand(st, valueText(line.value, line.time));
      sel.sel = -1;
      return;
    }
    sel.sel = -1;

    if (/^[0-9]$/.test(k) || k === '.' || k === ':') {
      start(st);
      if (/Ans$/.test(st.expr)) st.expr = st.expr.slice(0, -3);   // typing replaces Ans
      if (st.expr.length >= MAX_ENTRY) return { toast: 'Line Full' };
      st.expr += k;
      return;
    }
    if (OPS.indexOf(k) >= 0 && k.length === 1) {
      if (st.fresh) { st.fresh = false; st.expr = st.ans ? 'Ans' : ''; }
      if (st.expr === '-' || st.expr === '√' || st.expr === '-√') return;    // nothing to operate on yet
      st.expr = st.expr.replace(/[+\-×÷√]+$/, '');                         // replace a pending operator
      if (st.expr === '') { if (k === '-') st.expr = '-'; else st.expr = '0' + k; return; }
      st.expr += k;
      return;
    }
    if (k === '+/-') {
      if (st.fresh) { st.fresh = false; st.expr = st.ans ? '-Ans' : '-'; return; }
      var i = st.expr.length;
      while (i > 0 && OPERAND_CHAR.test(st.expr[i - 1])) i--;
      var unary = i > 0 && st.expr[i - 1] === '-' && (i === 1 || OPS.indexOf(st.expr[i - 2]) >= 0);
      st.expr = unary ? st.expr.slice(0, i - 1) + st.expr.slice(i) : st.expr.slice(0, i) + '-' + st.expr.slice(i);
      return;
    }
    if (k === 'SQRT') {
      if (st.fresh) { st.fresh = false; st.expr = st.ans ? '√Ans' : '√'; return; }
      var j = st.expr.length;
      while (j > 0 && /[0-9.:Ans]/.test(st.expr[j - 1])) j--;
      if (st.expr[j - 1] === '√') st.expr = st.expr.slice(0, j - 1) + st.expr.slice(j);
      else st.expr = st.expr.slice(0, j) + '√' + st.expr.slice(j);
      return;
    }
    if (k === 'BKSP') {
      if (st.fresh) return;
      st.expr = /Ans$/.test(st.expr) ? st.expr.slice(0, -3) : st.expr.slice(0, -1);
      return;
    }
    if (k === 'C') {
      if (!st.fresh && st.expr) { st.expr = ''; st.fresh = true; return; }   // clear the line
      st.tape = []; st.expr = ''; st.fresh = true; st.ans = null;           // then clear everything
      return;
    }
    if (k === '=' || k === 'ENTER') {
      if (st.fresh || !st.expr) return;
      var ex = st.expr.replace(/[+\-×÷√]+$/, '');
      var e = ex ? evaluate(ex, st.ans) : null;
      if (!e) return { toast: 'Syntax Error' };
      if (e.error) return { toast: e.error };
      st.tape.push({ expr: ex, value: e.value, time: e.time });
      if (st.tape.length > MAX_TAPE) st.tape.shift();
      st.ans = { value: e.value, time: e.time };
      st.expr = ''; st.fresh = true;
    }
  }

  // value of the line (or the last result) for the memory key
  function currentValue(st) {
    if (!st.fresh && st.expr) {
      var e = evaluate(st.expr.replace(/[+\-×÷√]+$/, ''), st.ans || null);
      return e && !e.error ? e.value : null;
    }
    return st.ans ? st.ans.value : null;
  }

  function freshState() { return { tape: [], expr: '', fresh: true, ans: null }; }

  var CalcCore = { evaluate: evaluate, fmtCalc: fmtCalc, fmtHMS: fmtHMS, numStr: numStr, key: key,
                   appendOperand: appendOperand, currentValue: currentValue, freshState: freshState,
                   MAX_TAPE: MAX_TAPE, MAX_ENTRY: MAX_ENTRY };
  root.CalcCore = CalcCore;
  if (typeof module !== 'undefined') module.exports = CalcCore;
})(typeof window !== 'undefined' ? window : globalThis);
