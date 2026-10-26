// src/documents/rules.mjs — CONDITIONS AND "WORKS ITSELF OUT" (Run 9 board "Conditions and formulas"; rulings R9-d, R9-e). Pure: json-logic-js (MIT) and formula.mjs, nothing else,
// so the browser runs the very same file (copied to docustay/web/src/lib/rules/rules.js by scripts/build-rules.mjs; the parity test fails on any difference).
//
//   A RULE is JSON Logic (jsonlogic.com) over field ids — {"==": [{"var": "Tenant_has_pets"}, true]} — limited to RULE_OPS: no arithmetic, no string tricks, no custom operations.
//   A rule decides whether a FIELD (a box), a PAGE of an uploaded PDF, or a SECTION of a written document is part of the document. A hidden box is not asked for, not required,
//   not stored and not printed; a hidden page is left out of the sealed copy; a hidden section is left out before the document is printed, so the words reflow.
//   A FORMULA ("works itself out") is a number box's `calc` over other boxes (formula.mjs: + − × ÷, brackets, round, min, max; exact arithmetic). The signer cannot type in it.
//
// ★ THE ORDER RULE (the maintainer, Run 9 decision 6): a rule reads only answers from people who act EARLIER — the sender (a locked box, a "filled in by you" value) or a seat at an earlier step of a
//   one-after-another order. Never the same person, never someone later, never a loop. checkRuleOrder() refuses anything else when the document or template is saved, in plain words.
// ★ THE SERVER DECIDES. The page shows and hides live from these functions, but at signing the server works every rule and formula out again from the stored and submitted values; what
//   a browser says is hidden or computed is never trusted.
import jsonLogic from "json-logic-js";
import { parseFormula, formulaNames, formulaText, FormulaError } from "./formula.mjs";

const RULE_OPS = Object.freeze(["==", "!=", "<", "<=", ">", ">=", "!", "!!", "and", "or", "in", "var"]);
const MAX_RULE_BYTES = 2000, MAX_DEPTH = 8, MAX_TERMS = 24;
export class RuleError extends Error { constructor(m) { super(m); this.name = "RuleError"; } }

/** Throws RuleError unless `rule` is a JSON Logic expression made only of RULE_OPS, with every `var` a field id. → the list of field ids it reads. */
export function checkRule(rule) {
  if (rule === null || typeof rule !== "object" || Array.isArray(rule)) throw new RuleError("a rule must be a condition, for example “Has pets is ticked”");
  if (JSON.stringify(rule).length > MAX_RULE_BYTES) throw new RuleError("that rule is too long");
  const vars = new Set(); let terms = 0;
  const walk = (n, depth) => {
    if (depth > MAX_DEPTH) throw new RuleError("that rule goes too deep");
    if (n === null || typeof n === "number" || typeof n === "boolean") return;
    if (typeof n === "string") { if (n.length > 200) throw new RuleError("a value in the rule is too long"); return; }
    if (Array.isArray(n)) { if (n.length > MAX_TERMS) throw new RuleError("that rule has too many parts"); n.forEach((x) => walk(x, depth + 1)); return; }
    const keys = Object.keys(n);
    if (keys.length !== 1) throw new RuleError("each part of a rule does one thing");
    const op = keys[0], arg = n[op];
    if (!RULE_OPS.includes(op)) throw new RuleError(`“${op}” is not something a rule can do`);
    if ((terms += 1) > MAX_TERMS * 2) throw new RuleError("that rule has too many parts");
    if (op === "var") { const id = Array.isArray(arg) ? arg[0] : arg; if (typeof id !== "string" || !/^[A-Za-z0-9_.-]{1,64}$/.test(id)) throw new RuleError("a rule names a field by its id"); vars.add(id); return; }
    walk(arg, depth + 1);
  };
  walk(rule, 0);
  return [...vars];
}

/** Answers as a rule compares them: a checkbox is true/false, a number box a number, a multi-choice a list, anything else its text; a box with nothing in it is null. */
export function typedValues(fields, values = {}) {
  const out = {};
  for (const f of fields) {
    const v = values[f.id];
    if (v === undefined || v === null || v === "") { out[f.id] = f.type === "checkbox" ? false : null; continue; }
    if (f.type === "checkbox") out[f.id] = v === true || v === "true";
    else if (f.validation === "number" || f.calc) { const n = Number(String(v).replace(/^[$€£]/, "").replace(/,/g, "")); out[f.id] = Number.isFinite(n) ? n : null; }
    else if (f.type === "multiselect") { try { const a = JSON.parse(v); out[f.id] = Array.isArray(a) ? a : String(v).split(",").map((x) => x.trim()); } catch { out[f.id] = String(v).split(",").map((x) => x.trim()).filter(Boolean); } }
    else out[f.id] = String(v);
  }
  for (const [k, v] of Object.entries(values)) if (k.startsWith("custom.") && !(k in out)) out[k] = v;   // a written document's sender values ("filled in by you")
  return out;
}

/** Does the rule hold for these (typed) answers? A rule that cannot be worked out (it should never happen: rules are checked when saved) counts as TRUE, so a box is never silently dropped. */
export function evaluateRule(rule, typed) {
  if (rule == null) return true;
  try { return Boolean(jsonLogic.apply(rule, typed)); } catch { return true; }
}

// ── the words people write: "[Tenant has pets] is ticked and [Months] > 6" ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// clause := [Name] is ticked | is not ticked | is empty | is not empty | (= | != | > | >= | < | <=) value      rule := clause ((and | or) clause)*   (and/or are not mixed in one rule)
// A name in square brackets is a field's name as the person sees it; `resolve(name)` gives its id (and its kind, for "ticked"). A value is a number or words ('in quotes' if they have spaces).
const CLAUSE = /^\s*\[([^\]]{1,120})\]\s*(is not ticked|is ticked|is not empty|is empty|!=|>=|<=|=|>|<)\s*(.*)$/i;
export function parseReadableRule(text, resolve) {
  const src = String(text ?? "").trim();
  if (!src) throw new RuleError("the rule is empty");
  if (src.length > 600) throw new RuleError("that rule is too long");
  const parts = src.split(/\s+(and|or)\s+(?=\[)/i);
  const clauses = [], joins = new Set();
  for (let i = 0; i < parts.length; i += 2) { clauses.push(parts[i]); if (parts[i + 1]) joins.add(parts[i + 1].toLowerCase()); }
  if (joins.size > 1) throw new RuleError("a rule uses either “and” or “or”, not both — split it into two rules");
  const logic = clauses.map((c) => {
    const m = CLAUSE.exec(c);
    if (!m) throw new RuleError(`“${c.trim()}” is not a rule I can read — write it like “[Has pets] is ticked” or “[Months] > 6”`);
    const id = resolve(m[1].trim());
    if (!id) throw new RuleError(`there is no field called “${m[1].trim()}”`);
    const v = { var: id }, op = m[2].toLowerCase(), rest = m[3].trim();
    if (op === "is ticked") return { "==": [v, true] };
    if (op === "is not ticked") return { "!=": [v, true] };
    if (op === "is empty") return { "!": [v] };
    if (op === "is not empty") return { "!!": [v] };
    if (!rest) throw new RuleError(`“${c.trim()}” needs something to compare with`);
    const q = /^'(.*)'$|^"(.*)"$/.exec(rest); const val = q ? (q[1] ?? q[2]) : /^-?\d+(\.\d+)?$/.test(rest) ? Number(rest) : rest;
    return { [op === "=" ? "==" : op]: [v, val] };
  });
  const rule = logic.length === 1 ? logic[0] : { [joins.has("or") ? "or" : "and"]: logic };
  checkRule(rule);
  return rule;
}
/** The inverse of parseReadableRule: a rule built from rows, as the words a text tag carries (`show="[Tenant has pets] is ticked"`). `nameOf(id)` gives the name in the brackets. */
export function ruleToText(rule, nameOf = (id) => id) {
  checkRule(rule);
  const one = (c) => {
    const [op] = Object.keys(c), a = c[op]; const arg = Array.isArray(a) ? a : [a];
    const id = arg[0]?.var; if (typeof id !== "string") throw new RuleError("only a rule built from boxes can be written as words");
    const n = `[${nameOf(id)}]`;
    if (op === "==" && arg[1] === true) return `${n} is ticked`;
    if (op === "!=" && arg[1] === true) return `${n} is not ticked`;
    if (op === "!") return `${n} is empty`;
    if (op === "!!") return `${n} is not empty`;
    if (!["==", "!=", ">", ">=", "<", "<="].includes(op)) throw new RuleError(`“${op}” cannot be written as words`);
    const v = typeof arg[1] === "number" ? String(arg[1]) : `'${String(arg[1]).replace(/'/g, "’")}'`;
    return `${n} ${op === "==" ? "=" : op} ${v}`;
  };
  const [op] = Object.keys(rule);
  return op === "and" || op === "or" ? rule[op].map(one).join(` ${op} `) : one(rule);
}
/** The words for a rule, for the screens, the audit trail and the certificate ("Tenant has pets is ticked"). `nameOf(id)` gives the field's name. */
export function describeRule(rule, nameOf = (id) => id) {
  const d = (n) => {
    if (!n || typeof n !== "object") return JSON.stringify(n);
    const [op] = Object.keys(n), a = n[op];
    const name = (x) => (x && typeof x === "object" && "var" in x ? nameOf(Array.isArray(x.var) ? x.var[0] : x.var) : JSON.stringify(x));
    if (op === "and" || op === "or") return a.map(d).join(` ${op} `);
    if (op === "==" && a[1] === true) return `${name(a[0])} is ticked`;
    if (op === "!=" && a[1] === true) return `${name(a[0])} is not ticked`;
    if (op === "!") return `${name(Array.isArray(a) ? a[0] : a)} is empty`;
    if (op === "!!") return `${name(Array.isArray(a) ? a[0] : a)} is not empty`;
    const words = { "==": "is", "!=": "is not", ">": "is more than", ">=": "is at least", "<": "is less than", "<=": "is at most", in: "is one of" }[op] ?? op;
    return `${name(a[0])} ${words} ${typeof a[1] === "string" ? `“${a[1]}”` : JSON.stringify(a[1])}`;
  };
  return d(rule);
}
/** "[Monthly rent] * [Months]" → "Monthly_rent * Months" (ids). Names in square brackets are resolved; a bare word must already be an id. */
export function resolveFormula(text, resolve) {
  const out = String(text ?? "").replace(/\[([^\]]{1,120})\]/g, (_, n) => { const id = resolve(n.trim()); if (!id) throw new FormulaError(`there is no field called “${n.trim()}”`); return id; });
  parseFormula(out);
  return out;
}

// ── the order rule ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Who may a rule read? → problems (plain sentences; empty = all good).
 *   fields   [{ id, role, type, label?, locked?, default?, show_when?, calc? }]  every box on the document
 *   pages    [{ page, show_when }]                                             (uploaded PDFs)
 *   sections [{ key, label, show_when }]                                       (written documents; only sender values allowed)
 *   stepOf   (role) → the step at which that seat acts (1, 2, …); the same number = at the same time. The sender is step 0.
 *   senderKeys  Set of value names the sender gives before sending (custom.*, and locked boxes' ids)
 */
export function checkRuleOrder(args) { return checkRuleOrderDetailed(args).map((x) => x.text); }
/** The same check, each problem as { text, key, vars }: `key` is an ICU sentence the screens translate, `vars` fills it (Run 9; the Check step shows these). */
export function checkRuleOrderDetailed({ fields = [], pages = [], sections = [], stepOf = () => 1, senderKeys = new Set() }) {
  const problems = [], byId = new Map(fields.map((f) => [f.id, f]));
  const fill = (key, vars) => key.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
  const say = (key, vars) => { const text = fill(key, vars); if (!problems.some((p) => p.text === text)) problems.push({ text, key, vars }); };
  const label = (f) => f?.label || f?.id;
  const known = (id) => senderKeys.has(id) || (byId.get(id)?.locked === true && byId.get(id)?.default !== undefined);
  const stepOfField = (id) => (known(id) ? 0 : byId.has(id) ? stepOf(byId.get(id).role) : null);
  const check = (where, rule, step) => {   // where: { box } or { page }
    let vars; try { vars = checkRule(rule); } catch (e) { say(where.page ? "The rule on page {page}: {why}" : "The rule on “{box}”: {why}", { ...where, why: e.message }); return; }
    for (const v of vars) {
      const s = stepOfField(v), other = label(byId.get(v)) ?? v;
      if (s === null) { say(where.page ? "The rule on page {page} reads “{other}”, which is not a field on this document" : "The rule on “{box}” reads “{other}”, which is not a field on this document", { ...where, other: v }); continue; }
      if (step !== null && s >= step) say(s === step
        ? (where.page ? "The rule on page {page} reads “{other}”, which the same person fills in. A rule can only use answers from people who act earlier (or that you fill in before sending)." : "The rule on “{box}” reads “{other}”, which the same person fills in. A rule can only use answers from people who act earlier (or that you fill in before sending).")
        : (where.page ? "The rule on page {page} reads “{other}”, which someone later fills in. A rule can only use answers from people who act earlier." : "The rule on “{box}” reads “{other}”, which someone later fills in. A rule can only use answers from people who act earlier."), { ...where, other });
    }
  };
  for (const f of fields) if (f.show_when) check({ box: label(f) }, f.show_when, f.locked ? 0 : stepOf(f.role));
  for (const p of pages) if (p.show_when) { const steps = fields.filter((f) => f.page === p.page && !known(f.id)).map((f) => stepOf(f.role)); check({ page: p.page }, p.show_when, steps.length ? Math.min(...steps) : null); }
  for (const s of sections) if (s.show_when) { let vars = []; try { vars = checkRule(s.show_when); } catch (e) { say("The rule on “{box}”: {why}", { box: s.label, why: e.message }); continue; }
    for (const v of vars) if (!senderKeys.has(v) && !known(v)) say("The rule on the section “{section}” reads “{other}”. A section of a written document can only depend on what you fill in before sending, so it can be laid out before anyone signs.", { section: s.label, other: label(byId.get(v)) ?? v }); }
  // formulas: names must exist, a box cannot be worked out from itself, and no loops
  const calcs = fields.filter((f) => f.calc);
  const deps = new Map();
  for (const f of calcs) {
    let names = []; try { names = formulaNames(f.calc); } catch (e) { say("The formula in “{box}”: {why}", { box: label(f), why: e.message }); continue; }
    for (const n of names) if (!byId.has(n) && !senderKeys.has(n)) say("The formula in “{box}” uses “{other}”, which is not a field on this document", { box: label(f), other: n });
    for (const n of names) { const g = byId.get(n); if (g && !known(n) && stepOf(g.role) > stepOf(f.role)) say("The formula in “{box}” uses “{other}”, which someone later fills in", { box: label(f), other: label(g) }); }
    deps.set(f.id, names.filter((n) => byId.has(n)));
  }
  const state = new Map();
  const visit = (id, path) => { if (state.get(id) === 2) return; if (state.get(id) === 1) { say("These formulas use each other in a loop: {chain}", { chain: [...path, id].map((x) => label(byId.get(x))).join(" → ") }); return; } state.set(id, 1); for (const d of deps.get(id) ?? []) visit(d, [...path, id]); state.set(id, 2); };
  for (const id of deps.keys()) visit(id, []);
  return problems;
}

/** What a body can check on its own (the order of people is only known at send): every rule and formula names boxes that exist, never itself, and formulas make no loop. → problems. */
export function checkRuleRefs({ fields = [], pages = [], senderKeys = new Set() }) {
  const problems = [], ids = new Set(fields.map((f) => f.id)), label = (id) => fields.find((f) => f.id === id)?.label || id;
  for (const f of fields) if (f.show_when) { let vars; try { vars = checkRule(f.show_when); } catch (e) { problems.push(`The rule on “${label(f.id)}”: ${e.message}`); continue; }
    for (const v of vars) { if (v === f.id) problems.push(`The rule on “${label(f.id)}” reads the box itself`); else if (!ids.has(v) && !senderKeys.has(v)) problems.push(`The rule on “${label(f.id)}” reads “${v}”, which is not a field on this document`); } }
  for (const p of pages) if (p.show_when) { let vars; try { vars = checkRule(p.show_when); } catch (e) { problems.push(`The rule on page ${p.page}: ${e.message}`); continue; }
    for (const v of vars) { if (!ids.has(v) && !senderKeys.has(v)) problems.push(`The rule on page ${p.page} reads “${v}”, which is not a field on this document`); else if (fields.find((f) => f.id === v)?.page === p.page && !fields.find((f) => f.id === v)?.locked) problems.push(`The rule on page ${p.page} reads “${label(v)}”, which is on that same page`); } }
  const loops = checkRuleOrder({ fields: fields.map((f) => ({ ...f, show_when: undefined })), stepOf: () => 1, senderKeys }).filter((x) => /formula/i.test(x));
  return [...new Set([...problems, ...loops])];
}

// ── working it all out ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Every formula box worked out, in dependency order, from `values`; a box whose inputs are not all there yet is left empty. → a new values object (the inputs plus the computed boxes). */
export function computeFormulas(fields, values = {}) {
  const out = { ...values }; const calcs = fields.filter((f) => f.calc); const done = new Set();
  for (let pass = 0; pass <= calcs.length; pass++) {
    let changed = false;
    for (const f of calcs) { if (done.has(f.id)) continue; let names; try { names = formulaNames(f.calc); } catch { done.add(f.id); continue; }
      if (names.some((n) => calcs.some((c) => c.id === n) && !done.has(n))) continue;
      try { out[f.id] = formulaText(f.calc, out, { places: f.places ?? 2 }); } catch { out[f.id] = null; } done.add(f.id); changed = true; }
    if (!changed) break;
  }
  return out;
}
/** What is hidden right now. → { fields: Set(id), pages: Set(n), why: [{ kind, id, label, rule }] }. A box on a hidden page is hidden with it. */
export function hiddenNow({ fields = [], pages = [] }, values = {}) {
  // a hidden box counts as empty for every rule and formula that reads it, so work it out again until nothing changes (at most once per box)
  let vals = { ...values }, out = null;
  for (let round = 0; round <= fields.length + pages.length; round++) {
    const typed = typedValues(fields, computeFormulas(fields, vals));
    const next = { fields: new Set(), pages: new Set(), why: [] };
    for (const p of pages) if (p.show_when && !evaluateRule(p.show_when, typed)) { next.pages.add(p.page); next.why.push({ kind: "page", id: String(p.page), label: `Page ${p.page}`, rule: p.show_when }); }
    for (const f of fields) {
      if (next.pages.has(f.page)) { next.fields.add(f.id); continue; }
      if (f.show_when && !evaluateRule(f.show_when, typed)) { next.fields.add(f.id); next.why.push({ kind: "field", id: f.id, label: f.label || f.id, rule: f.show_when }); }
    }
    const same = out && next.fields.size === out.fields.size && [...next.fields].every((x) => out.fields.has(x)) && next.pages.size === out.pages.size;
    out = next; if (same) break;
    vals = { ...values }; for (const id of out.fields) delete vals[id];
  }
  return out;
}
