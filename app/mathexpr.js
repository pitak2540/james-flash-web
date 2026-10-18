/* ===== Safe arithmetic evaluator for map scaling formulas (TunerPro-style "X*0.5-10") =====
 * Works in both the Electron main process (require) and the renderer (<script>).
 * Grammar: expr := term (('+'|'-') term)*   term := unary (('*'|'/') unary)*   unary := ('-'|'+') unary | pow
 *          pow := atom ('^' unary)?           atom := number | X | '(' expr ')' | func '(' expr ')'
 * Only X is a variable (case-insensitive). Functions: round, floor, ceil, abs, sqrt. Anything else → error.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MathExpr = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const FUNCS = { round: Math.round, floor: Math.floor, ceil: Math.ceil, abs: Math.abs, sqrt: Math.sqrt };

  function tokenize(src) {
    const t = []; let i = 0; const s = String(src);
    while (i < s.length) {
      const c = s[i];
      if (/\s/.test(c)) { i++; continue; }
      if (/[0-9.]/.test(c)) { const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(s.slice(i)); if (!m) throw new Error('bad number at ' + i); t.push({ k: 'num', v: parseFloat(m[0]) }); i += m[0].length; continue; }
      if (/[a-zA-Z_]/.test(c)) { let j = i; while (j < s.length && /[a-zA-Z0-9_]/.test(s[j])) j++; t.push({ k: 'id', v: s.slice(i, j).toLowerCase() }); i = j; continue; }
      if ('+-*/^()'.includes(c)) { t.push({ k: c }); i++; continue; }
      throw new Error('unexpected "' + c + '"');
    }
    return t;
  }

  /** Compile an equation string → { f(x), linear:{a,b}|null, src } */
  function compile(src) {
    const eq = (src === undefined || src === null || String(src).trim() === '') ? 'X' : String(src);
    const tok = tokenize(eq); let p = 0;
    const peek = () => tok[p], next = () => tok[p++];
    function expr() { let v = term(); for (;;) { const t = peek(); if (t && (t.k === '+' || t.k === '-')) { next(); const r = term(); v = t.k === '+' ? bin(v, r, (a, b) => a + b) : bin(v, r, (a, b) => a - b); } else return v; } }
    function term() { let v = unary(); for (;;) { const t = peek(); if (t && (t.k === '*' || t.k === '/')) { next(); const r = unary(); v = t.k === '*' ? bin(v, r, (a, b) => a * b) : bin(v, r, (a, b) => a / b); } else return v; } }
    function unary() { const t = peek(); if (t && t.k === '-') { next(); const r = unary(); return (x) => -r(x); } if (t && t.k === '+') { next(); return unary(); } return pow(); }
    function pow() { const a = atom(); const t = peek(); if (t && t.k === '^') { next(); const e = unary(); return (x) => Math.pow(a(x), e(x)); } return a; }
    function atom() {
      const t = next(); if (!t) throw new Error('unexpected end');
      if (t.k === 'num') { const v = t.v; return () => v; }
      if (t.k === '(') { const v = expr(); if (!peek() || next().k !== ')') throw new Error('missing )'); return v; }
      if (t.k === 'id') {
        if (t.v === 'x') return (x) => x;
        if (FUNCS[t.v]) { if (!peek() || next().k !== '(') throw new Error('function needs ('); const a = expr(); if (!peek() || next().k !== ')') throw new Error('missing )'); const fn = FUNCS[t.v]; return (x) => fn(a(x)); }
        throw new Error('unknown symbol ' + t.v);
      }
      throw new Error('unexpected token ' + t.k);
    }
    const bin = (l, r, op) => (x) => op(l(x), r(x));
    const f = expr(); if (p !== tok.length) throw new Error('trailing input');
    // linearity probe: a = f(0), b = f(1)-f(0); accept if f(2) and f(255) agree
    const a = f(0), b = f(1) - a; let linear = null;
    if (Number.isFinite(a) && Number.isFinite(b) && Math.abs(f(2) - (a + 2 * b)) < 1e-9 * Math.max(1, Math.abs(a + 2 * b)) && Math.abs(f(255) - (a + 255 * b)) < 1e-6 * Math.max(1, Math.abs(a + 255 * b))) linear = { a, b };
    return { f, linear, src: eq };
  }

  /** raw → value */
  function apply(c, raw) { return c.f(raw); }
  /** value → raw (exact for linear; bisection within [lo,hi] otherwise) */
  function invert(c, value, lo = -32768, hi = 65535) {
    if (c.linear) return c.linear.b === 0 ? 0 : (value - c.linear.a) / c.linear.b;
    let fl = c.f(lo), fh = c.f(hi); if (!Number.isFinite(fl) || !Number.isFinite(fh)) return 0;
    const inc = fh >= fl; if ((inc && value <= fl) || (!inc && value >= fl)) return lo; if ((inc && value >= fh) || (!inc && value <= fh)) return hi;
    for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2, fm = c.f(mid); if ((fm < value) === inc) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  }
  /** Convert legacy {scale, add} into an equation string */
  function fromScaleAdd(scale, add) { const s = Number(scale) || 1, a = Number(add) || 0; return `X*${s}${a ? (a > 0 ? '+' : '') + a : ''}`; }

  return { compile, apply, invert, fromScaleAdd };
});
