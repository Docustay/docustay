// Part 30 item 7 — TEXT TAGS. A tag is written inside a document's own text, `{{Buyer signature;type=signature;role=Buyer}}`, and becomes a field at that spot. This file is the grammar and nothing else
// (pure; imports only the formula and rule grammars): `findTags` pulls tags out of text, `parseTag` turns one into a field description, `defaultSize` says how big each kind of field is. Placement in a PDF is textTagPlacement.mjs;
// HTML is htmlDocument.mjs.
// ★ WRITTEN FROM SCRATCH for Docustay's own field model (pdfBody.mjs); the shape `{{Name;key=value;…}}` is a common convention, the key list below is ours and is documented on the Developers pages.
//
//   {{Name;key=value;key=value}}            the name is the first part; keys follow, separated by semicolons
//   type       signature · initials · date_signed · text · number · date · email · phone · zip · checkbox · dropdown · multiselect · image · file · stamp · payment   (default: text)
//   role       who fills it in — any words ("Buyer", "Landlord"); the first role you write is the first signer
//   required   true | false (default true)
//   default    a starting value (not allowed on signature, initials, date_signed, stamp)
//   options    a comma list, for dropdown and multiselect:  options=Monthly,Yearly
//   label      the caption shown to the signer (default: the name)
//   width, height   the field's size in points (1/72 inch) — default per type
//   max_length      most characters a text field takes
//   show       the box is part of the document only when this holds, over answers given EARLIER (Run 9):  show="[Tenant has pets] is ticked"  ·  show="[Months] > 6 and [Rent] <= 2000"
//   filled     signer | sender (default signer). filled=sender: the SENDER gives the answer before sending (the organisation's own facts, the terms it sets); signers see it and cannot change it
//   from       with filled=sender, where the answer comes from: org.name · org.email · sender.name · sender.email (the sender may still change it before sending)
//   calc, places   the box works itself out:  calc="[Monthly rent] * [Months]"  places=2   (+ - * / brackets, round(), min(), max(); names in [square brackets])
//   amount, currency   for payment: amount=150.00 currency=usd — or ONE of: formula=quantity*unit_price*(1+tax/100) (other fields' names; + - * / and brackets only) · price=price_1Abc… (a Stripe price) · link=https://buy.stripe.com/… (a Stripe payment link)
// A value that has a semicolon or an equals sign in it goes in double quotes:  default="Smith; Jones".
// ★ A tag with no `key=value` after its name is NOT a tag — `{{signer.name}}` and `{{custom.company}}` stay merge fields.

import { parseFormula } from "./formula.mjs";
import { parseReadableRule, resolveFormula } from "./rules.mjs";
import { SENDER_SOURCES, SENDER_TYPES } from "./senderBoxes.mjs";

const TAG_PATTERN = /\{\{([^{}\n]{1,600})\}\}/g;

const TYPE_ALIASES = Object.freeze({
  signature: { type: "signature" }, initials: { type: "initials" }, date_signed: { type: "date_signed" }, stamp: { type: "stamp" },
  text: { type: "text" }, number: { type: "text", validation: "number" }, date: { type: "text", validation: "date" },
  email: { type: "text", validation: "email" }, phone: { type: "text", validation: "phone" }, zip: { type: "text", validation: "zip" },
  checkbox: { type: "checkbox" }, dropdown: { type: "dropdown" }, select: { type: "dropdown" }, multiselect: { type: "multiselect" },
  image: { type: "image" }, file: { type: "file" }, payment: { type: "payment" },
});
export const TAG_TYPES = Object.freeze(Object.keys(TYPE_ALIASES));
const KEYS = Object.freeze(["type", "role", "required", "default", "options", "label", "width", "height", "max_length", "amount", "currency", "formula", "price", "link", "autofill", "editable", "placeholder", "tooltip", "locked", "min", "max", "suggested", "deposit", "every", "count", "show", "calc", "places", "filled", "from"]);
const AUTO = new Set(["signature", "initials", "date_signed", "stamp"]);

/** Default size in points (w × h). */
const SIZES = Object.freeze({ signature: [170, 42], initials: [64, 32], date_signed: [96, 18], stamp: [100, 44], text: [150, 18], checkbox: [14, 14], dropdown: [150, 18], multiselect: [150, 18], image: [120, 60], file: [150, 20], payment: [130, 26] });
export const defaultSize = (type) => SIZES[type] ?? SIZES.text;

function splitParts(inner) {
  const parts = []; let cur = "", quoted = false;
  for (const ch of inner) {
    if (ch === '"') { quoted = !quoted; continue; }
    if (ch === ";" && !quoted) { parts.push(cur); cur = ""; continue; }
    cur += ch;
  }
  parts.push(cur);
  return quoted ? null : parts.map((p) => p.trim());
}

/**
 * @returns {null | {error:string} | {name:string, spec:object, size:{w:number,h:number}|null, role:string, warnings:string[]}}
 *   null — this is not a tag (leave the text alone); {error} — it is meant as a tag but cannot be used (the sender is told which one and why).
 */
export function parseTag(inner) {
  const parts = splitParts(inner);
  if (!parts || parts.length < 2 || !parts.slice(1).some((p) => /^[A-Za-z_]+\s*=/.test(p))) return null;
  const name = parts[0];
  if (!name) return { error: "a tag needs a name before the first semicolon" };
  const attrs = {}, warnings = [];
  for (const p of parts.slice(1)) {
    if (p === "") continue;
    const m = /^([A-Za-z_]+)\s*=\s*([\s\S]*)$/.exec(p);
    if (!m) return { error: `“${p}” is not key=value (in the tag “${name}”)` };
    const k = m[1].toLowerCase();
    if (!KEYS.includes(k)) { warnings.push(`“${k}” is not a setting Docustay uses; it was ignored`); continue; }
    attrs[k] = m[2].trim();
  }
  const typeName = (attrs.type ?? "text").toLowerCase();
  const alias = TYPE_ALIASES[typeName];
  if (!alias) return { error: `“${attrs.type}” is not a field type (in the tag “${name}”). Use one of: ${TAG_TYPES.join(", ")}` };
  const spec = { type: alias.type, required: true, label: (attrs.label || name).slice(0, 120) };
  if (alias.validation) spec.validation = alias.validation;
  if ("required" in attrs) {
    if (!/^(true|false)$/i.test(attrs.required)) return { error: `required must be true or false (in the tag “${name}”)` };
    spec.required = attrs.required.toLowerCase() === "true";
  }
  if (attrs.default !== undefined) {
    if (AUTO.has(spec.type)) return { error: `a ${spec.type} is filled in by signing and cannot have a default (in the tag “${name}”)` };
    spec.default = attrs.default.slice(0, 500);
  }
  if (["dropdown", "multiselect"].includes(spec.type)) {
    const opts = (attrs.options ?? "").split(",").map((o) => o.trim()).filter(Boolean);
    if (!opts.length) return { error: `“${name}” has no choices. Add its choices, or remove the field.` };   // P10R1-5: the same plain sentence the form check uses
    if (opts.length > 50) return { error: `a ${typeName} takes at most 50 options (in the tag “${name}”)` };
    spec.options = opts.map((o) => o.slice(0, 120));
  } else if (attrs.options !== undefined) warnings.push("options only apply to dropdown and multiselect; ignored");
  if (attrs.autofill !== undefined) {   // fills itself from the person the field belongs to; locked for the signer unless editable=true
    const a = attrs.autofill.toLowerCase();
    if (spec.type !== "text") return { error: `autofill only goes on a text field (in the tag “${name}”)` };
    if (!["name", "email"].includes(a)) return { error: `autofill must be name or email (in the tag “${name}”)` };
    spec.autofill = a;
    if ("editable" in attrs) { if (!/^(true|false)$/i.test(attrs.editable)) return { error: `editable must be true or false (in the tag “${name}”)` }; if (attrs.editable.toLowerCase() === "true") spec.editable = true; }
  }
  if (attrs.placeholder !== undefined) spec.placeholder = attrs.placeholder.slice(0, 120);
  if (attrs.tooltip !== undefined) spec.tooltip = attrs.tooltip.slice(0, 300);
  if (attrs.locked !== undefined) {
    if (!/^(true|false)$/i.test(attrs.locked)) return { error: `locked must be true or false (in the tag “${name}”)` };
    if (attrs.locked.toLowerCase() === "true") { if (AUTO.has(spec.type) || spec.type === "payment" || spec.type === "file" || spec.type === "image") return { error: `a ${spec.type} cannot be locked (in the tag “${name}”)` }; if (spec.default === undefined) return { error: `a locked field needs the answer: add default=… (in the tag “${name}”)` }; spec.locked = true; }
  }
  if (attrs.max_length !== undefined) {
    const n = Number(attrs.max_length);
    if (!Number.isInteger(n) || n < 1 || n > 5000) return { error: `max_length must be a whole number from 1 to 5000 (in the tag “${name}”)` };
    spec.max_length = n;
  }
  if (spec.type === "payment") {
    const cur = (attrs.currency ?? "usd").toLowerCase();
    if (!/^[a-z]{3}$/.test(cur)) return { error: `currency must be a three-letter code like usd (in the tag “${name}”)` };
    spec.currency = cur;
    const askAmount = String(attrs.amount ?? "").toLowerCase() === "ask";
    const kinds = ["amount", "formula", "price", "link"].filter((k) => attrs[k] !== undefined);
    if (kinds.length !== 1) return { error: `a payment needs exactly one of amount=…, formula=…, price=… or link=… (amount=ask lets the signer choose) (in the tag “${name}”)` };
    const minor = (k) => { const n = Number(attrs[k]); return Number.isFinite(n) && n >= 0.5 && n <= 999999.99 ? Math.round(n * 100) : null; };
    if (askAmount) {
      const ask = {}; for (const [k, key] of [["min", "min_minor"], ["max", "max_minor"], ["suggested", "suggested_minor"]]) if (attrs[k] !== undefined) { const m = minor(k); if (m === null) return { error: `${k} must be an amount from 0.50 to 999,999.99 (in the tag “${name}”)` }; ask[key] = m; }
      if (ask.min_minor !== undefined && ask.max_minor !== undefined && ask.min_minor > ask.max_minor) return { error: `min cannot be more than max (in the tag “${name}”)` };
      spec.amount_ask = ask;
    } else if (attrs.amount !== undefined && /^custom\.[a-z0-9_]{1,40}$/.test(attrs.amount)) {   // v1 item 10: the sender sets the amount before sending (a custom value of this send)
      spec.amount_from = attrs.amount;
    } else if (attrs.amount !== undefined) {
      const amt = Number(attrs.amount);
      if (!(amt > 0) || !Number.isFinite(amt)) return { error: `a payment needs amount=… in major units, for example amount=150.00 (in the tag “${name}”)` };
      spec.amount_minor = Math.round(amt * 100);
      if (spec.amount_minor < 50 || spec.amount_minor > 99999999) return { error: `the payment amount must be between 0.50 and 999,999.99 (in the tag “${name}”)` };
    } else if (attrs.formula !== undefined) {
      try { parseFormula(attrs.formula); } catch (e) { return { error: `${e.message} (in the tag “${name}”)` }; }
      spec.amount_formula = attrs.formula;
    } else if (attrs.price !== undefined) {
      if (!/^price_[A-Za-z0-9]{6,80}$/.test(attrs.price)) return { error: `price must be a Stripe price id like price_1AbC… (in the tag “${name}”)` };
      spec.price_id = attrs.price;
    } else {
      if (!/^https:\/\/(buy|donate)\.stripe\.com\/[A-Za-z0-9_\-/]+$/.test(attrs.link)) return { error: `link must be a Stripe payment link like https://buy.stripe.com/… (in the tag “${name}”)` };
      spec.payment_link = attrs.link;
    }
    if (attrs.deposit !== undefined) {
      if (spec.amount_minor === undefined) return { error: `a deposit needs a fixed amount=… to take a part of (in the tag “${name}”)` };
      const m = /^(\d{1,2})%$/.exec(String(attrs.deposit).trim());
      if (m) spec.deposit = { percent: Number(m[1]) }; else { const d = Number(attrs.deposit); if (!Number.isFinite(d) || Math.round(d * 100) < 50) return { error: `deposit must be a percent like 25% or an amount like 100.00 (in the tag “${name}”)` }; spec.deposit = { amount_minor: Math.round(d * 100) }; }
    }
    if (attrs.every !== undefined) {
      if (spec.amount_minor === undefined || attrs.deposit !== undefined) return { error: `every=… needs a fixed amount=… and cannot be combined with a deposit (in the tag “${name}”)` };
      if (!["week", "month", "year"].includes(String(attrs.every))) return { error: `every must be week, month or year (in the tag “${name}”)` };
      spec.plan = { every: String(attrs.every), ...(attrs.count !== undefined ? { count: Number(attrs.count) } : {}) };
      if (spec.plan.count !== undefined && !(Number.isInteger(spec.plan.count) && spec.plan.count >= 2 && spec.plan.count <= 60)) return { error: `count must be a whole number from 2 to 60 (in the tag “${name}”)` };
    }
  }
  // Run 9: rules are kept as written here and turned into ids by fieldsFromTags, once every box on the document has a name
  let rule = null;
  if (attrs.show !== undefined) { if (!attrs.show) return { error: `show needs a rule like show="[Has pets] is ticked" (in the tag “${name}”)` }; rule = { show: attrs.show.slice(0, 600) }; }
  if (attrs.calc !== undefined) {
    if (spec.type !== "text") return { error: `only a text or number box can work itself out (in the tag “${name}”)` };
    if (spec.locked) return { error: `a box that works itself out cannot also be locked (in the tag “${name}”)` };
    rule = { ...rule, calc: attrs.calc.slice(0, 300) };
    spec.required = false;   // nobody types in it: the server works it out
    if (attrs.places !== undefined) { const n = Number(attrs.places); if (!Number.isInteger(n) || n < 0 || n > 6) return { error: `places must be a whole number from 0 to 6 (in the tag “${name}”)` }; spec.places = n; }
  } else if (attrs.places !== undefined) warnings.push("places only applies with calc; ignored");
  // Run 9 Part 4.2 (R8-57): a box the sender fills in before sending
  if (attrs.filled !== undefined) {
    const by = attrs.filled.toLowerCase();
    if (!["signer", "sender"].includes(by)) return { error: `filled must be signer or sender (in the tag “${name}”)` };
    if (by === "sender") {
      if (!SENDER_TYPES.includes(spec.type)) return { error: `a ${typeName} is filled in by the person signing, so it cannot be filled=sender (in the tag “${name}”)` };
      if (rule?.calc) return { error: `a box that works itself out cannot be filled=sender (in the tag “${name}”)` };
      spec.sender = true;
    }
  }
  if (attrs.from !== undefined) {
    const src = attrs.from.toLowerCase();
    if (!spec.sender) return { error: `from=… goes with filled=sender (in the tag “${name}”)` };
    if (!SENDER_SOURCES.includes(src)) return { error: `from must be one of ${SENDER_SOURCES.join(", ")} (in the tag “${name}”)` };
    if (spec.default !== undefined) return { error: `a box takes from=… or default=…, not both (in the tag “${name}”)` };
    spec.default = `{{${src}}}`;
  }
  let size = null;
  const dim = (k) => { if (attrs[k] === undefined) return null; const n = Number(attrs[k]); return Number.isFinite(n) && n >= 6 && n <= 800 ? n : NaN; };
  const w = dim("width"), h = dim("height");
  if (Number.isNaN(w) || Number.isNaN(h)) return { error: `width and height are sizes in points from 6 to 800 (in the tag “${name}”)` };
  if (w !== null || h !== null) { const [dw, dh] = defaultSize(spec.type); size = { w: w ?? dw, h: h ?? dh }; }
  return { name, spec, size, role: (attrs.role || "Signer").slice(0, 80), warnings, ...(rule ? { rule } : {}) };
}

/** Every tag in `text`, in order: [{index, length, raw, parsed}] where `parsed` is parseTag's answer (never null here — non-tags are skipped). */
export function findTags(text) {
  const out = [];
  for (const m of String(text).matchAll(TAG_PATTERN)) {
    const parsed = parseTag(m[1]);
    if (parsed) out.push({ index: m.index, length: m[0].length, raw: m[0], parsed });
  }
  return out;
}

/** Names the roles in order of first appearance and gives each a seat: ["Buyer","Seller"] → {roles:[{key:'signer_1',label:'Buyer'},…], seatOf:Map}. Case-insensitive. */
function seatsFor(roleNames) {
  const seatOf = new Map(), roles = [];
  for (const r of roleNames) {
    const k = r.toLowerCase();
    if (seatOf.has(k)) continue;
    const key = `signer_${roles.length + 1}`;
    seatOf.set(k, key); roles.push({ key, label: r });
  }
  return { roles, seatOf };
}

/** Field ids from names: letters, digits, - and _, unique within the document. */
export function fieldId(name, taken) {
  const base = (name.normalize("NFKD").replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "field").slice(0, 52);
  let id = base, n = 2;
  while (taken.has(id)) id = `${base}_${n++}`;
  taken.add(id);
  return id;
}

/** Turns found tags with their boxes (points, top-left origin, on a page of the given size) into body fields + roles. `boxes[i] = {page, x, y, w, h, pageW, pageH}` for tags[i]. */
export function fieldsFromTags(tags, boxes, { fromBlanks = false } = {}) {
  // a box the sender fills makes no seat of its own: it sits on the seat its role names, or the first seat when that role signs nothing (Run 9, R8-57)
  const signing = new Set(tags.filter((t) => !t.parsed.spec.sender).map((t) => t.parsed.role.toLowerCase()));
  const { roles, seatOf } = seatsFor(tags.map((t) => t.parsed.role).filter((r) => signing.has(r.toLowerCase())));   // seats in order of first appearance, as before
  const seatFor = (t) => seatOf.get(t.parsed.role.toLowerCase()) ?? roles[0]?.key ?? "signer_1";
  const taken = new Set(), fields = [], problems = [];
  tags.forEach((t, i) => {
    const b = boxes[i];
    // a blank typeset into a page is exactly its printed box (the page may print scaled or the box may be narrowed to its cell), so with `fromBlanks` the field covers that blank and nothing else; otherwise a size written in the tag wins
    const w = fromBlanks ? b.w : (t.parsed.size?.w ?? b.w);
    const h = fromBlanks ? b.h : (t.parsed.size?.h ?? b.h);
    const x = Math.max(0, Math.min(b.x, b.pageW - 6)), y = Math.max(0, Math.min(b.y, b.pageH - 6));
    const f = {
      id: fieldId(t.parsed.name, taken), ...t.parsed.spec, role: seatFor(t), page: b.page,
      x: round(x / b.pageW), y: round(y / b.pageH), w: round(Math.min(w, b.pageW - x) / b.pageW), h: round(Math.min(h, b.pageH - y) / b.pageH),
    };
    fields.push(f);
    for (const w2 of t.parsed.warnings) problems.push({ tag: t.parsed.name, warning: w2 });
  });
  // Run 9: rules name boxes by their tag name or label ([Tenant has pets]); a calc may also use bare ids. A rule that cannot be read is left OFF (the box always shows / is typed) and the sender is told.
  const byName = new Map();
  tags.forEach((t, i) => { for (const n of [t.parsed.name, t.parsed.spec.label]) if (n && !byName.has(n.toLowerCase())) byName.set(n.toLowerCase(), fields[i].id); });
  const ids = new Set(fields.map((f) => f.id));
  const resolve = (n) => byName.get(n.toLowerCase()) ?? (ids.has(n) ? n : null);
  tags.forEach((t, i) => {
    const r = t.parsed.rule; if (!r) return;
    if (r.show) { try { fields[i].show_when = parseReadableRule(r.show, resolve); } catch (e) { problems.push({ tag: t.parsed.name, warning: `the show rule could not be read (${e.message}), so this box always shows` }); } }
    if (r.calc) { try { fields[i].calc = resolveFormula(r.calc, resolve); } catch (e) { fields[i].required = true; problems.push({ tag: t.parsed.name, warning: `the calc could not be read (${e.message}), so the signer types this box` }); } }
  });
  return { roles, fields, warnings: problems };
}
const round = (n) => Math.round(n * 1e5) / 1e5;
