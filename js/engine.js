/* CX-3 solver engine.
 *
 * The CX-3 keeps one global set of variables (Dist, GS, OAT, ...) shared by
 * every screen, and a list of equations, each giving one variable from others.
 * When a variable changes, every equation that reads it is re-evaluated:
 *  - all inputs known  → its output is computed (unless the output is locked
 *    or the new value is within display precision of the old one); the first
 *    time a writable output is filled in, the inputs are locked so the chain
 *    cannot be solved backwards over the user's own entries;
 *  - an input lost     → an output it had produced before is cleared.
 * Values are in base units (see units.js). */
(function (root) {
  'use strict';

  var Units = root.Units || require('./units.js');
  var ERROR_VALUE = 1e25;

  function Var(id, label, dim, opts) {
    opts = opts || {};
    this.id = id; this.label = label; this.dim = dim;
    this.ro = !!opts.ro;            // result only: the user cannot type into it
    this.v = null; this.has = false;
    this.computed = false; this.copied = false; this.locked = false;
    this.deps = [];
    this.unit = opts.unit;          // unit shown by default, when not the dimension's usual one
  }
  Var.prototype.notify = function () {
    var d = this.deps.slice();
    for (var i = 0; i < d.length; i++) d[i].update();
  };
  Var.prototype.set = function (v, computed) {
    if (this.locked) return;
    var old = this.has;
    this.v = v; this.computed = !!computed; this.copied = false;
    this.has = v != null && !isNaN(v);
    if (this.has || old) this.notify();
  };
  Var.prototype.clear = function () {
    var old = this.has;
    this.v = null; this.has = false; this.computed = false; this.copied = false; this.locked = false;
    if (old) this.notify();
  };
  // user entry: unlock, clear (so results built on the old value go away) and set
  Var.prototype.enter = function (v) {
    this.clear();
    this.set(v, false);
  };

  function Eq(out, ins, fn) {
    this.out = out; this.ins = ins; this.fn = fn; this.error = false;
    for (var i = 0; i < ins.length; i++) ins[i].deps.push(this);
    this.can = this.canCompute();
  }
  Eq.prototype.canCompute = function () {
    for (var i = 0; i < this.ins.length; i++) if (!this.ins[i].has) return false;
    return true;
  };
  Eq.prototype.update = function () {
    this.error = false;
    var could = this.can;
    this.can = this.canCompute();
    if (this.can) {
      var args = this.ins.map(function (x) { return x.v; });
      var nv = this.fn.apply(null, args);
      if (nv === undefined) return;
      if (nv > ERROR_VALUE || nv < -ERROR_VALUE || nv === Infinity || nv === -Infinity) { this.error = true; return; }
      var out = this.out;
      if (out.has) {
        if (out.locked) return;
        var dp = Units.DIMS[out.dim].dp;
        if (Math.abs(out.v - nv) < Math.pow(10, -dp)) return;
      } else if (!out.ro) {
        for (var i = 0; i < this.ins.length; i++) this.ins[i].locked = true;
      }
      out.set(nv, true);
    } else if (could) {
      this.out.clear();
    }
  };

  function Model() { this.vars = {}; this.eqs = []; }
  Model.prototype.v = function (id, label, dim, opts) {
    var x = new Var(id, label, dim, opts);
    this.vars[id] = x;
    return x;
  };
  Model.prototype.eq = function (out, ins, fn) {
    var e = new Eq(out, ins, fn);
    this.eqs.push(e);
    return e;
  };
  // snapshot for storage
  Model.prototype.save = function () {
    var o = {};
    for (var k in this.vars) {
      var x = this.vars[k];
      if (x.has || x.locked) o[k] = [x.has ? x.v : null, x.computed ? 1 : 0, x.copied ? 1 : 0, x.locked ? 1 : 0];
    }
    return o;
  };
  Model.prototype.load = function (o) {
    for (var k in this.vars) {
      var x = this.vars[k], s = o && o[k];
      x.v = s && s[0] != null ? s[0] : null; x.has = x.v != null;
      x.computed = !!(s && s[1]); x.copied = !!(s && s[2]); x.locked = !!(s && s[3]);
    }
    this.eqs.forEach(function (e) { e.can = e.canCompute(); });
  };
  Model.prototype.reset = function () { this.load({}); };

  var Engine = { Var: Var, Eq: Eq, Model: Model };
  root.Engine = Engine;
  if (typeof module !== 'undefined') module.exports = Engine;
})(typeof window !== 'undefined' ? window : globalThis);
