// src/documents/formula.mjs — THE PAYMENT-AMOUNT FORMULA (Part 30 item 11). Pure, no imports, no eval, no Function: a hand-written parser over exactly numbers, field names, + - * / and brackets (and a leading minus).
// "quantity * unit_price * (1 + tax / 100)" is the whole language. A name is the id of another field on the document and takes that field's SUBMITTED value; anything else — a word that is not a field, a call, a property, a
// string, a power, a percent sign — is refused with a plain message, never evaluated. The server runs this on the values it was given; the browser never supplies the answer.
// Limits: 300 characters, 40 tokens of depth, 200 steps — a formula cannot be made to run long.

export const FORMULA_MAX = 300;
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function tokens(src) {
  const out = []; let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t") { i += 1; continue; }
    if ("+-*/(),".includes(c)) { out.push({ t: c }); i += 1; continue; }
    const num = /^(?:\d+\.?\d*|\.\d+)/.exec(src.slice(i));
    if (num) { out.push({ t: "num", v: Number(num[0]), s: num[0] }); i += num[0].length; continue; }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
    if (id) { out.push({ t: "name", v: id[0] }); i += id[0].length; continue; }
    throw new FormulaError(`“${c}” is not allowed in a formula (only numbers, field names, + − × ÷, brackets, and round, min and max)`);
  }
  return out;
}

export class FormulaError extends Error { constructor(m) { super(m); this.name = "FormulaError"; } }

/** Parse to a tree. Grammar: expr = term (('+'|'-') term)* ; term = unary (('*'|'/') unary)* ; unary = '-' unary | atom ; atom = number | name | fn '(' expr (',' expr)* ')' | '(' expr ')'.
 *  Run 9: `fn` is one of round(x) / round(x, places), min(a, b, …), max(a, b, …) — nothing else; a name followed by a bracket that is not one of them is refused. */
export const FORMULA_FUNCTIONS = Object.freeze(["round", "min", "max"]);
export function parseFormula(src) {
  const s = String(src ?? "");
  if (!s.trim()) throw new FormulaError("the formula is empty");
  if (s.length > FORMULA_MAX) throw new FormulaError(`the formula is longer than ${FORMULA_MAX} characters`);
  const tk = tokens(s); let p = 0, steps = 0;
  const tick = () => { if ((steps += 1) > 200) throw new FormulaError("the formula is too complicated"); };
  const peek = () => tk[p]?.t;
  function expr(depth) { let l = term(depth); while (peek() === "+" || peek() === "-") { const op = tk[p++].t; l = { op, l, r: term(depth) }; tick(); } return l; }
  function term(depth) { let l = unary(depth); while (peek() === "*" || peek() === "/") { const op = tk[p++].t; l = { op, l, r: unary(depth) }; tick(); } return l; }
  function unary(depth) { if (peek() === "-") { p += 1; tick(); return { op: "neg", l: unary(depth) }; } return atom(depth); }
  function atom(depth) {
    if (depth > 40) throw new FormulaError("the brackets go too deep");
    const x = tk[p]; tick();
    if (!x) throw new FormulaError("the formula ends where a number or field name was expected");
    if (x.t === "num") { p += 1; return { num: x.v, text: x.s }; }
    if (x.t === "name" && tk[p + 1]?.t === "(") {
      const fn = x.v.toLowerCase();
      if (!FORMULA_FUNCTIONS.includes(fn)) throw new FormulaError(`“${x.v}” is not something a formula can do (round, min and max are)`);
      p += 2; const args = [expr(depth + 1)];
      while (peek() === ",") { p += 1; args.push(expr(depth + 1)); tick(); }
      if (peek() !== ")") throw new FormulaError(`${fn}( … ) is not closed`); p += 1;
      if (fn === "round" && (args.length > 2)) throw new FormulaError("round takes a number and, if you like, how many decimal places");
      if (fn !== "round" && args.length < 2) throw new FormulaError(`${fn} needs at least two things to compare`);
      if (args.length > 12) throw new FormulaError(`${fn} takes at most 12 things`);
      return { fn, args };
    }
    if (x.t === "name") { p += 1; return { name: x.v }; }
    if (x.t === "(") { p += 1; const e = expr(depth + 1); if (peek() !== ")") throw new FormulaError("a bracket is not closed"); p += 1; return e; }
    throw new FormulaError(`“${x.t}” is in the wrong place in the formula`);
  }
  const tree = expr(0);
  if (p < tk.length) throw new FormulaError(`“${tk[p].t === "num" ? tk[p].v : tk[p].t === "name" ? tk[p].v : tk[p].t}” is in the wrong place in the formula`);
  return tree;
}

/** The field names a formula reads. */
export function formulaNames(src) { const out = new Set(); const walk = (n) => { if (n.name) out.add(n.name); if (n.l) walk(n.l); if (n.r) walk(n.r); for (const a of n.args ?? []) walk(a); }; walk(parseFormula(src)); return [...out]; }

/** A submitted value as a number: "3", "12.50", "$12.50", "1,200" → number; anything else → NaN (a blank is NaN too — the amount cannot be worked out until it is filled). */
export function numberOf(v) { const s = String(v ?? "").trim().replace(/^[$€£]/, "").replace(/,/g, ""); return /^-?(?:\d+\.?\d*|\.\d+)$/.test(s) ? Number(s) : NaN; }

// ★ EXACT ARITHMETIC (D-022). Amounts are worked out as exact fractions of whole numbers (BigInt), never as floating-point numbers: 89,935.50 x 46.97 is exactly half a cent over a whole cent, and a float answers one cent low. A rounding rule that charges one cent wrong on some prices is a money bug.
const gcd = (a, b) => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a || 1n; };
const rat = (n, d = 1n) => { if (d < 0n) { n = -n; d = -d; } const g = gcd(n, d); return { n: n / g, d: d / g }; };
const ratOfDecimal = (str) => { const neg = str.startsWith("-"); const t = neg ? str.slice(1) : str; const [i, f = ""] = t.split("."); const n = BigInt((i || "0") + f); return rat(neg ? -n : n, 10n ** BigInt(f.length)); };
const decimalText = (v) => { if (typeof v === "number") { if (!Number.isFinite(v)) return null; const x = String(v); return /e/i.test(x) ? v.toFixed(12).replace(/0+$/, "").replace(/\.$/, "") : x; } const s = String(v ?? "").trim().replace(/^[$€£]/, "").replace(/,/g, ""); return /^-?(?:\d+\.?\d*|\.\d+)$/.test(s) ? s : null; };
function evalRat(src, values = {}) {
  const tree = parseFormula(src);
  const run = (n) => {
    if (n.num !== undefined) return ratOfDecimal(n.text ?? String(n.num));
    if (n.name !== undefined) {
      if (!NAME.test(n.name) || !Object.prototype.hasOwnProperty.call(values, n.name)) throw new FormulaError(`“${n.name}” needs a value before the amount can be worked out`);
      const t = decimalText(values[n.name]); if (t === null) throw new FormulaError(`“${n.name}” needs a number before the amount can be worked out`); return ratOfDecimal(t);
    }
    if (n.fn) {
      const xs = n.args.map(run);
      const cmp = (a, b) => (a.n * b.d < b.n * a.d ? -1 : a.n * b.d > b.n * a.d ? 1 : 0);
      if (n.fn === "min") return xs.reduce((a, b) => (cmp(a, b) <= 0 ? a : b));
      if (n.fn === "max") return xs.reduce((a, b) => (cmp(a, b) >= 0 ? a : b));
      // round(x, places): half away from zero, exactly; places is a whole number 0–6
      const places = xs[1] ? Number(xs[1].n) / Number(xs[1].d) : 0;
      if (!Number.isInteger(places) || places < 0 || places > 6) throw new FormulaError("round can keep 0 to 6 decimal places");
      const scale = 10n ** BigInt(places), num = xs[0].n * scale, neg = num < 0n, abs = neg ? -num : num;
      const q = (2n * abs + xs[0].d) / (2n * xs[0].d);
      return rat(neg ? -q : q, scale);
    }
    if (n.op === "neg") { const a = run(n.l); return rat(-a.n, a.d); }
    const a = run(n.l), b = run(n.r);
    if (n.op === "+") return rat(a.n * b.d + b.n * a.d, a.d * b.d);
    if (n.op === "-") return rat(a.n * b.d - b.n * a.d, a.d * b.d);
    if (n.op === "*") return rat(a.n * b.n, a.d * b.d);
    if (b.n === 0n) throw new FormulaError("the formula divides by zero");
    return rat(a.n * b.d, a.d * b.n);
  };
  return run(tree);
}

/** Evaluate against `values` (field id → submitted value). → a number in MAJOR units (for display). Throws FormulaError in plain words. */
export function evalFormula(src, values = {}) {
  const r = evalRat(src, values); const x = Number(r.n) / Number(r.d);
  if (!Number.isFinite(x)) throw new FormulaError("the formula does not give a number");
  return x;
}

/** → whole minor units (cents), rounded to the nearest cent, a half going away from zero, computed exactly. */
export function formulaMinor(src, values) {
  const r = evalRat(src, values); const num = r.n * 100n, neg = num < 0n, abs = neg ? -num : num;
  const q = (2n * abs + r.d) / (2n * r.d); const out = Number(neg ? -q : q);
  if (!Number.isSafeInteger(out)) throw new FormulaError("the amount is too large");
  return out;
}

/** Run 9 · "WORKS ITSELF OUT": a number field's own formula, as the text printed in the box. Exact; rounded half away from zero to `places` (default 2) and written without trailing zeros
 *  ("21600", "1234.5"). Throws FormulaError while an input is still empty, so the box stays empty until it can be worked out. */
export function formulaText(src, values = {}, { places = 2 } = {}) {
  const r = evalRat(src, values), scale = 10n ** BigInt(places), num = r.n * scale, neg = num < 0n, abs = neg ? -num : num;
  const q = (2n * abs + r.d) / (2n * r.d); const whole = q / scale, frac = q % scale;
  const f = places ? String(frac).padStart(places, "0").replace(/0+$/, "") : "";
  return `${neg && q !== 0n ? "-" : ""}${whole}${f ? `.${f}` : ""}`;
}
