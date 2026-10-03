'use strict';
/* CALC module tests.
 * 1. Branch-by-branch cases with hand-worked results.
 * 2. Randomised expressions typed key by key, checked against an exact
 *    rational-arithmetic reference evaluator written independently below.
 * 3. Random key mashing: no key sequence may throw or corrupt the state. */
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/calc.js');

// ------------------------------------------------------------------ helpers
function run(keys, st = C.freshState(), sel = { sel: -1 }) {
  const toasts = [];
  for (const k of keys.split(' ').filter(Boolean)) {
    const r = C.key(st, sel, k);
    if (r && r.toast) toasts.push(r.toast);
  }
  return { st, sel, toasts, last: st.tape[st.tape.length - 1] };
}
const near = (a, b, rel = 1e-12) => assert.ok(Math.abs(a - b) <= rel * Math.max(1, Math.abs(b)), `${a} !≈ ${b}`);
const digits = s => s.split('').join(' ');

// ------------------------------------------------------------------ 1. branches
test('arithmetic and precedence', () => {
  assert.equal(run('2 + 3 × 4 =').last.value, 14);
  assert.equal(run('1 0 ÷ 4 =').last.value, 2.5);
  assert.equal(run('7 - 1 0 =').last.value, -3);
  assert.equal(run('8 ÷ 2 ÷ 2 =').last.value, 2);          // left to right
  assert.equal(run('2 - 3 - 4 =').last.value, -5);
  assert.equal(run('2 × 3 + 4 × 5 - 6 ÷ 3 =').last.value, 24);
  assert.equal(run('. 5 + 5 . =').last.value, 5.5);         // leading / trailing point
  assert.equal(run('0 0 7 =').last.value, 7);
});

test('floating point noise is hidden, chained results keep full precision', () => {
  const r = run('0 . 1 + 0 . 2 =');
  assert.equal(C.fmtCalc(r.last.value), '0.3');
  const t = run('1 ÷ 3 = × 3 =');
  assert.equal(t.last.expr, 'Ans×3');
  assert.equal(t.last.value, 1);                             // was 0.99999999 when the result was re-typed rounded
  assert.equal(C.fmtCalc(run('2 SQRT × 2 SQRT =').last.value), '2');
});

test('continuing from a result uses Ans', () => {
  assert.equal(run('5 = + 1 =').last.expr, 'Ans+1');
  assert.equal(run('5 = + 1 =').last.value, 6);
  assert.equal(run('5 = 3 =').last.value, 3);                // a digit starts a new line
  assert.equal(run('5 = +/-').st.expr, '-Ans');
  assert.equal(run('5 = +/- =').last.value, -5);
  assert.equal(run('5 = +/- 7').st.expr, '-7');              // typing replaces Ans
  assert.equal(run('9 = SQRT =').last.value, 3);
  assert.equal(run('5 = = =').st.tape.length, 1);            // = on a fresh line does nothing
});

test('first key on an empty calculator', () => {
  assert.equal(run('+ 5 =').last.value, 5);                  // 0+5
  assert.equal(run('- 5 =').last.value, -5);                 // unary minus
  assert.equal(run('- +').st.expr, '-');                     // operator after a lone minus is ignored
  assert.equal(run('SQRT +').st.expr, '√');
  assert.equal(run('+/- SQRT 9 =').last.value, -3);
  assert.equal(run('=').st.tape.length, 0);
});

test('operator replacement and unary minus with ±', () => {
  assert.equal(run('5 × + 3 =').last.value, 8);              // last operator wins
  assert.equal(run('5 × - 3 =').last.value, 2);              // − replaces ×
  assert.equal(run('5 × +/- 3 =').last.value, -15);          // ± makes a negative operand
  assert.equal(run('5 - +/- 3 =').last.value, 8);
  assert.equal(run('5 - +/- 3').st.expr, '5--3');
  assert.equal(run('3 +/-').st.expr, '-3');
  assert.equal(run('3 +/- +/-').st.expr, '3');
  assert.equal(run('2 × 3 +/-').st.expr, '2×-3');
  assert.equal(run('2 × 3 +/- +/-').st.expr, '2×3');
  assert.equal(run('5 × +/- +').st.expr, '5+');               // pending "×-" replaced as a whole
  assert.equal(run('5 + =').last.expr, '5');                  // dangling operator dropped
});

test('square root', () => {
  assert.equal(run('1 6 SQRT =').last.value, 4);
  assert.equal(run('1 6 SQRT').st.expr, '√16');
  assert.equal(run('1 6 SQRT SQRT').st.expr, '16');
  assert.equal(run('SQRT 1 6 × 2 =').last.value, 8);
  assert.equal(run('4 +/- SQRT').st.expr, '-√4');
  assert.equal(run('4 +/- SQRT =').last.value, -2);
  assert.equal(run('2 + 9 SQRT =').last.value, 5);
  assert.equal(C.evaluate('√-4'), null);                     // cannot be typed; rejected if it ever appears
});

test('time arithmetic', () => {
  let r = run('1 : 3 0 + 0 : 4 5 =');
  assert.equal(r.last.time, true); assert.equal(C.fmtHMS(r.last.value), '2:15:00');
  r = run('1 : 3 0 + 0 : 4 5 = + 0 : 1 5 =');
  assert.equal(C.fmtHMS(r.last.value), '2:30:00'); assert.equal(r.last.time, true);
  assert.equal(C.fmtHMS(run('1 : 3 0 × 2 =').last.value), '3:00:00');
  assert.equal(run('1 : 3 0 ÷ 2 =').last.time, true);
  r = run('1 : 3 0 ÷ 0 : 3 0 =');
  assert.equal(r.last.value, 3); assert.equal(r.last.time, false);   // time ÷ time is a number
  assert.equal(C.fmtHMS(run('1 : 3 0 + 1 5 =').last.value), '16:30:00'); // a plain number counts as hours
  assert.equal(C.fmtHMS(run('1 : 0 0 - 2 : 0 0 =').last.value), '-1:00:00');
  assert.equal(C.fmtHMS(run('0 : 0 0 : 3 0 + 0 : 0 0 : 4 5 =').last.value), '0:01:15');
  assert.equal(run('1 : 3 0 = × 2 =').last.time, true);               // Ans keeps the time flag
  assert.equal(run('SQRT 4 : 0 0 =').last.time, false);
  assert.equal(C.fmtHMS(run(': 4 5 =').last.value), '0:45:00');
  assert.equal(C.fmtHMS(run('1 : 2 0 : 3 0 . 5 =').last.value), '1:20:31');
  assert.equal(C.fmtHMS(-1e-6), '0:00:00');                            // no "-0:00:00"
});

test('syntax errors and arithmetic errors leave the line for correction', () => {
  for (const ks of ['. =', '1 . 2 . 3 =', '1 : 2 : 3 : 4 =', '1 : . =']) {
    const r = run(ks);
    assert.deepEqual(r.toasts, ['Syntax Error'], ks);
    assert.equal(r.st.tape.length, 0); assert.equal(r.st.fresh, false);
  }
  let r = run('5 ÷ 0 =');
  assert.deepEqual(r.toasts, ['Div by Zero']); assert.equal(r.st.expr, '5÷0');
  r = run('5 ÷ 0 BKSP 2 =');
  assert.equal(r.last.value, 2.5);
  assert.deepEqual(run('0 ÷ 0 =').toasts, ['Div by Zero']);
  assert.deepEqual(C.evaluate('1' + '0'.repeat(200) + '×1' + '0'.repeat(200)), { error: 'Overflow' });
});

test('overflow from chained results is reported, not stored', () => {
  const nine40 = digits('9'.repeat(40));
  const r = run(`${nine40} =`);
  for (let i = 0; i < 3; i++) run('× UP ENTER =', r.st, r.sel);      // 1e40 → 1e80 → 1e160 → 1e320
  assert.ok(isFinite(r.st.tape[r.st.tape.length - 1].value));
  assert.equal(r.st.tape.length, 3);
  const before = r.st.tape.length;
  const o = run('× UP ENTER =', r.st, r.sel);
  assert.deepEqual(o.toasts, ['Overflow']);
  assert.equal(r.st.tape.length, before);
});

test('C clears the line, then everything', () => {
  let r = run('1 + 2 = 4 5');
  run('C', r.st, r.sel);
  assert.equal(r.st.expr, ''); assert.equal(r.st.tape.length, 1); assert.equal(r.st.fresh, true);
  run('+ 1 =', r.st, r.sel);
  assert.equal(r.st.tape[1].expr, 'Ans+1');
  assert.equal(r.st.tape[1].value, 4);                               // 3 + 1
  run('C', r.st, r.sel);
  assert.equal(r.st.tape.length, 0); assert.equal(r.st.ans, null);
  assert.equal(run('+ 1 =', r.st, r.sel).st.tape[0].value, 1);      // 0+1 after a full clear
});

test('BKSP', () => {
  assert.equal(run('1 2 3 BKSP').st.expr, '12');
  assert.equal(run('5 = +/- BKSP').st.expr, '-');                   // removes "Ans" as one token
  assert.equal(run('5 = BKSP').st.fresh, true);                     // nothing to delete on a fresh line
  assert.equal(run('1 BKSP BKSP BKSP').st.expr, '');
});

test('history navigation and recall', () => {
  const r = run('1 = 2 = 3 =');
  const s = r.sel;
  run('UP', r.st, s); assert.equal(s.sel, 2);
  run('UP UP UP', r.st, s); assert.equal(s.sel, 0);                 // stops at the oldest
  run('DOWN DOWN', r.st, s); assert.equal(s.sel, 2);
  run('DOWN', r.st, s); assert.equal(s.sel, -1);                    // back to the input line
  run('UP UP ENTER', r.st, s); assert.equal(r.st.expr, '2'); assert.equal(s.sel, -1);
  run('+ UP UP UP ENTER =', r.st, s); assert.equal(r.st.tape[3].value, 3);
  // recall replaces a number being typed instead of gluing onto it
  const g = run('5 0 = 1 2');
  run('UP ENTER', g.st, g.sel); assert.equal(g.st.expr, '50');
  // a time line is recalled as a time
  const t = run('1 : 3 0 = 7 UP ENTER');
  assert.equal(t.st.expr, '1:30:00');
  assert.equal(run('× 2 =', t.st, t.sel).last.time, true);
  assert.equal(run('UP').sel.sel, -1);                                // nothing to select on an empty tape
  // any other key leaves history selection
  const k = run('1 = UP 5');
  assert.equal(k.sel.sel, -1); assert.equal(k.st.expr, '5');
});

test('limits: entry length and tape size', () => {
  const r = run(digits('1'.repeat(60)));
  assert.equal(r.st.expr.length, C.MAX_ENTRY);
  assert.equal(r.toasts.length, 20); assert.ok(r.toasts.every(t => t === 'Line Full'));
  const t = C.freshState(), sel = { sel: -1 };
  for (let i = 1; i <= 55; i++) run(`${digits(String(i))} =`, t, sel);
  assert.equal(t.tape.length, C.MAX_TAPE);
  assert.equal(t.tape[0].value, 6); assert.equal(t.tape[49].value, 55);
});

test('memory helpers: current value and inserting a recalled number', () => {
  assert.equal(C.currentValue(run('2 + 3').st), 5);
  assert.equal(C.currentValue(run('2 +').st), 2);
  assert.equal(C.currentValue(run('7 =').st), 7);
  assert.equal(C.currentValue(run('.').st), null);
  assert.equal(C.currentValue(C.freshState()), null);
  let st = run('1 2').st; C.appendOperand(st, '7262'); assert.equal(st.expr, '7262');
  st = run('1 2 +').st; C.appendOperand(st, '7262'); assert.equal(st.expr, '12+7262');
  st = run('3 =').st; C.appendOperand(st, '-4'); assert.equal(st.expr, '-4');
  st = run('3 =').st; C.appendOperand(st, '4'); assert.equal(st.fresh, false);
});

test('result display format', () => {
  const cases = [[1234567.891, '1,234,567.891'], [-1234.5, '-1,234.5'], [1e12, '1.000000e+12'],
    [999999999999.4, '999,999,999,999.4'], [5e-7, '5.000000e-7'], [0.000001, '0.000001'], [-0, '0'],
    [1 / 3, '0.33333333'], [2 / 3, '0.66666667'], [-4e-9, '-4.000000e-9'], [100, '100'], [-0.5, '-0.5'],
    [Infinity, 'Error'], [12.000000004, '12'], [-12.000000004, '-12'], [1e-6 * 1.0000001, '0.000001']];
  for (const [x, s] of cases) assert.equal(C.fmtCalc(x), s, String(x));
});

test('numbers re-entered into an expression never use exponent form', () => {
  assert.equal(C.numStr(0.1 + 0.2), '0.3');
  assert.equal(C.numStr(1e21), '1000000000000000000000');
  assert.equal(C.numStr(-1e21), '-1000000000000000000000');
  assert.equal(C.numStr(1e-9), '0.000000001');
  assert.equal(C.numStr(-2.5), '-2.5');
  assert.equal(C.numStr(1 / 3), '0.333333333333333');
  for (const x of [1e21, 1e-9, 123456.789, 1 / 7, 1e300, -3e-12]) {
    const e = C.evaluate(C.numStr(Math.abs(x)));
    assert.ok(e && !e.error, String(x)); near(e.value, Math.abs(x), 1e-14);
  }
});

// ------------------------------------------------------------------ 2. exact reference
// Rationals over BigInt, written independently of calc.js.
const gcd = (a, b) => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a; };
function Q(n, d = 1n) { if (d < 0n) { n = -n; d = -d; } const g = gcd(n, d) || 1n; return { n: n / g, d: d / g }; }
const add = (a, b) => Q(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a, b) => Q(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a, b) => Q(a.n * b.n, a.d * b.d);
const div = (a, b) => Q(a.n * b.d, a.d * b.n);
const toNum = a => Number(a.n) / Number(a.d);

function rng(seed) { return () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648; }

// random operand: integer, decimal, perfect square under √, or h:mm[:ss] time; optional sign
function operand(r) {
  const kind = Math.floor(r() * 4), neg = r() < 0.25;
  let text, q, dim = 0, keys;
  if (kind === 0) { const v = Math.floor(r() * 10000); text = String(v); q = Q(BigInt(v)); }
  else if (kind === 1) {
    const ip = Math.floor(r() * 1000), fp = String(Math.floor(r() * 1000)).padStart(3, '0');
    text = `${ip}.${fp}`; q = Q(BigInt(ip) * 1000n + BigInt(fp), 1000n);
  } else if (kind === 2) {
    const k = Math.floor(r() * 99) + 1; text = String(k * k); q = Q(BigInt(k)); keys = digits(text) + ' SQRT';
  } else {
    const h = Math.floor(r() * 30), m = Math.floor(r() * 60), s = Math.floor(r() * 60), withS = r() < 0.5;
    text = withS ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${h}:${String(m).padStart(2, '0')}`;
    q = add(add(Q(BigInt(h)), Q(BigInt(m), 60n)), withS ? Q(BigInt(s), 3600n) : Q(0n));
    dim = 1;
  }
  keys = (keys || digits(text)) + (neg ? ' +/-' : '');
  return { keys, q: neg ? Q(-q.n, q.d) : q, dim };
}

// independent evaluation: precedence by two passes, dimension per the documented rules
function reference(terms, ops) {
  const vals = [{ q: terms[0].q, dim: terms[0].dim }], addOps = [];
  for (let i = 0; i < ops.length; i++) {
    const b = terms[i + 1], a = vals[vals.length - 1];
    if (ops[i] === '×') vals[vals.length - 1] = { q: mul(a.q, b.q), dim: a.dim + b.dim };
    else if (ops[i] === '÷') vals[vals.length - 1] = { q: div(a.q, b.q), dim: a.dim - b.dim };
    else { vals.push({ q: b.q, dim: b.dim }); addOps.push(ops[i]); }
  }
  let acc = vals[0];
  for (let i = 0; i < addOps.length; i++) {
    const b = vals[i + 1];
    const dim = acc.dim === b.dim ? acc.dim : (acc.dim === 1 || b.dim === 1 ? 1 : acc.dim);
    acc = { q: addOps[i] === '+' ? add(acc.q, b.q) : sub(acc.q, b.q), dim };
  }
  return acc;
}

test('5,000 random expressions typed key by key match exact rational arithmetic', () => {
  const r = rng(20261003);
  let checked = 0, skipped = 0;
  for (let c = 0; c < 5000; c++) {
    const n = 1 + Math.floor(r() * 6), terms = [], ops = [];
    for (let i = 0; i < n; i++) {
      let t = operand(r);
      if (i > 0) {
        const op = '+-×÷'[Math.floor(r() * 4)];
        if (op === '÷') while (t.q.n === 0n) t = operand(r);
        ops.push(op);
      }
      terms.push(t);
    }
    let keys = terms[0].keys;
    for (let i = 0; i < ops.length; i++) keys += ` ${ops[i]} ${terms[i + 1].keys}`;
    const res = run(keys + ' =');
    if (res.toasts.includes('Line Full')) { skipped++; continue; }   // longer than one line: covered by the limits test
    const ref = reference(terms, ops);
    assert.deepEqual(res.toasts, [], keys);
    assert.ok(res.last, keys);
    near(res.last.value, toNum(ref.q), 1e-9);
    assert.equal(res.last.time, ref.dim === 1, `time flag for ${keys}`);
    checked++;
  }
  assert.equal(checked + skipped, 5000);
  assert.ok(checked > 4000, `only ${checked} expressions fit on one line`);
});

test('2,000 random chains continuing from Ans keep exact values', () => {
  const r = rng(77);
  for (let c = 0; c < 2000; c++) {
    const st = C.freshState(), sel = { sel: -1 };
    let first = operand(r); while (first.dim) first = operand(r);
    run(first.keys + ' =', st, sel);
    let acc = first.q;
    for (let s = 0; s < 4; s++) {
      const op = '+-×÷'[Math.floor(r() * 4)];
      let t = operand(r); while (t.dim || (op === '÷' && t.q.n === 0n)) t = operand(r);
      run(`${op} ${t.keys} =`, st, sel);
      acc = op === '+' ? add(acc, t.q) : op === '-' ? sub(acc, t.q) : op === '×' ? mul(acc, t.q) : div(acc, t.q);
      near(st.tape[st.tape.length - 1].value, toNum(acc), 1e-9);
    }
  }
});

// ------------------------------------------------------------------ 3. key mashing
test('50,000 random key sequences never throw or corrupt the state', () => {
  const KEYS = ['0', '1', '2', '5', '9', '.', ':', '+', '-', '×', '÷', '=', 'ENTER', 'C', 'BKSP', '+/-', 'SQRT', 'UP', 'DOWN'];
  const r = rng(4242);
  for (let c = 0; c < 50000; c++) {
    const st = C.freshState(), sel = { sel: -1 };
    const len = 1 + Math.floor(r() * 30);
    for (let i = 0; i < len; i++) {
      const k = KEYS[Math.floor(r() * KEYS.length)];
      const prevAns = st.ans, before = st.tape.length, expr = st.expr, wasFresh = st.fresh, s0 = sel.sel;
      const out = C.key(st, sel, k);
      assert.equal(typeof st.expr, 'string');
      assert.ok(/^[0-9.:+\-×÷√Ans]*$/.test(st.expr), st.expr);
      assert.ok(st.tape.length <= C.MAX_TAPE);
      assert.ok(sel.sel >= -1 && sel.sel < Math.max(1, st.tape.length));
      if ((k === '=' || (k === 'ENTER' && s0 < 0)) && !wasFresh && expr && !out && st.fresh) {
        // a successful "=" stores exactly what evaluate() returns for the stored line
        const last = st.tape[st.tape.length - 1];
        assert.ok(st.tape.length === Math.min(before + 1, C.MAX_TAPE));
        assert.ok(isFinite(last.value));
        const again = C.evaluate(last.expr, prevAns);
        assert.equal(again.value, last.value);
        assert.equal(C.fmtCalc(last.value).length > 0, true);
      }
      if (out) assert.ok(['Syntax Error', 'Div by Zero', 'Overflow', 'Error', 'Line Full'].includes(out.toast), out.toast);
    }
  }
});

test('evaluate() never throws on arbitrary strings', () => {
  const A = '0123456789.:+-×÷√Ans ';
  const r = rng(99);
  for (let c = 0; c < 50000; c++) {
    let s = '';
    const len = Math.floor(r() * 16);
    for (let i = 0; i < len; i++) s += A[Math.floor(r() * A.length)];
    const e = C.evaluate(s, r() < 0.5 ? { value: 2, time: false } : null);
    assert.ok(e === null || e.error || (isFinite(e.value) && typeof e.time === 'boolean'), s);
  }
});
