// src/documents/pdfBody.mjs — THE THIRD BUILDER: AN UPLOADED FILE WITH FIELDS PLACED ON ITS PAGES (QUEUE §23.4, migration 0600). Pure: zod and nothing else, so the browser can import it too.
//
//   { kind:'pdf', schema_version:1,
//     file:   { file_id, sha256, page_count, pages:[{w,h}], name },        ← the ORIGINAL (or its PDF conversion); w/h are PDF points
//     roles:  [{ key:'signer_1', label:'Signer 1' }],                       ← the seats fields are assigned to; a send maps each seat to a person (a template keeps only the seats)
//     fields: [{ id, type, role, page, x, y, w, h, required, label?, options?, default?, validation?, repeat? }],
//     suggestions?: […]                                                    ← detected spots, shown dashed in the editor, dropped when the document is sent }
//
// ★ Positions are FRACTIONS of the page (0–1, origin top-left), so the editor, the signing view and the flattener agree whatever the rendering scale. A field is a box on one page, assigned to one seat.
import { z } from "zod";
import { SENDER_TYPES, emptySenderBoxes, senderBoxMessage, SENDER_BOX_KEY } from "./senderBoxes.mjs";
import { parseFormula, formulaNames } from "./formula.mjs";
import { checkRule, checkRuleRefs, checkRuleOrderDetailed } from "./rules.mjs";
import { cleanEmailAddress } from "./textSafety.mjs";

const PDF_BODY_SCHEMA_VERSION = 1;

/** What can be placed. `date_signed` is filled by the system at signing; `signature` and `initials` take a mark; the rest take what the signer types or picks. */
const PDF_FIELD_TYPES = Object.freeze(["signature", "initials", "date_signed", "text", "checkbox", "dropdown", "multiselect", "image", "file", "stamp", "payment"]);
/** Fields that take no typed value: they are filled by the act of signing. */
export const AUTO_FIELD_TYPES = Object.freeze(["signature", "initials", "date_signed", "stamp"]);
/** A seat's key: signer_1 … signer_999. */
export const SEAT_KEY = /^signer_[0-9]{1,3}$/;

const frac = z.number().min(0).max(1);
const roleKey = z.string().regex(SEAT_KEY, "a seat is named signer_1, signer_2 …");

export const pdfFieldSchema = z.object({
  id: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, "a field id is letters, digits, - and _"),
  type: z.enum(PDF_FIELD_TYPES),
  role: roleKey,
  page: z.number().int().min(1).max(2000),
  x: frac, y: frac,
  w: z.number().min(0.005).max(1), h: z.number().min(0.005).max(1),
  required: z.boolean().default(true),
  label: z.string().max(120).optional(),
  sensitive: z.boolean().optional(),                                          // an SSN, an ID or a bank number: masked in the timeline and exports, never sent to the assistant
  options: z.array(z.string().min(1).max(120)).max(50).optional(),            // dropdown and multiselect
  default: z.string().max(500).optional(),                                    // prefill; may be a merge field such as {{custom.company}}
  validation: z.enum(["none", "email", "phone", "number", "date", "zip"]).optional(),
  max_length: z.number().int().min(1).max(5000).optional(),
  autofill: z.enum(["name", "email"]).optional(),                             // a text field that fills itself from the person it belongs to (their name or email); locked for the signer unless `editable`
  editable: z.boolean().optional(),
  placeholder: z.string().max(120).optional(),                                // the grey hint inside an empty box
  tooltip: z.string().max(300).optional(),                                    // shown when the signer points at the box
  locked: z.boolean().optional(),                                             // the sender's `default` is the answer and the signer cannot change it (a locked dropdown, a read-only box)
  sender: z.boolean().optional(),                                             // Run 9 (R8-57): "Filled in by: Sender" — the sender gives the answer before sending (senderBoxes.mjs); frozen at send as the seat's locked answer
  amount_minor: z.number().int().min(50).max(99999999).optional(),            // payment: a fixed amount in the smallest unit (Stripe's minimum is 50)
  amount_from: z.string().regex(/^custom\.[a-z0-9_]{1,40}$/).optional(),      // payment: OR the amount comes from a custom merge value on the document, e.g. custom.deposit = "150.00" (no formulas)
  amount_formula: z.string().min(1).max(300).optional(),                      // payment: OR a formula over other fields' submitted values — numbers, field ids, + - * / and brackets, nothing else (formula.mjs)
  price_id: z.string().regex(/^price_[A-Za-z0-9]{6,80}$/, "a Stripe price id like price_1AbC…").optional(),   // payment: OR a Stripe price on the workspace's own Stripe account
  payment_link: z.string().url().max(300).refine((u) => /^https:\/\/(buy|donate)\.stripe\.com\/[A-Za-z0-9_\-/]+$/.test(u), "a Stripe payment link like https://buy.stripe.com/…").optional(),   // payment: OR a pasted Stripe payment link
  amount_ask: z.object({ min_minor: z.number().int().min(50).max(99999999).optional(), max_minor: z.number().int().min(50).max(99999999).optional(), suggested_minor: z.number().int().min(50).max(99999999).optional() }).strict().optional(),   // payment: OR the SIGNER chooses the amount (a donation, a tip), inside the sender's bounds
  deposit: z.union([z.object({ percent: z.number().int().min(1).max(99) }).strict(), z.object({ amount_minor: z.number().int().min(50).max(99999999) }).strict()]).optional(),   // payment: with a fixed amount (the total), only this part is charged now; the balance is not collected here
  plan: z.object({ every: z.enum(["week", "month", "year"]), count: z.number().int().min(2).max(60).optional() }).strict().optional(),   // payment: with a fixed amount (each payment), repeat it — `count` payments (installments) or until cancelled (a subscription); a Stripe subscription
  currency: z.string().regex(/^[a-z]{3}$/, "a three-letter currency code like usd").optional(),
  repeat: z.enum(["every_page"]).optional(),                                  // expanded to one field per page at freeze; kept so the editor can show the intent
  // Run 9 (rules.mjs): the box is part of the document only when this JSON Logic rule over EARLIER answers holds; and/or the box works itself out from a formula (the signer cannot type in it)
  show_when: z.record(z.string(), z.any()).optional(),
  calc: z.string().min(1).max(300).optional(),
  places: z.number().int().min(0).max(6).optional(),
}).strict().superRefine((f, ctx) => {
  if (f.show_when !== undefined) { try { checkRule(f.show_when); } catch (e) { ctx.addIssue({ code: "custom", path: ["show_when"], message: e.message }); } }
  if (f.calc !== undefined) {
    if (f.type !== "text") ctx.addIssue({ code: "custom", path: ["calc"], message: "only a number box can work itself out" });
    try { parseFormula(f.calc); } catch (e) { ctx.addIssue({ code: "custom", path: ["calc"], message: e.message }); }
    if (f.locked) ctx.addIssue({ code: "custom", path: ["calc"], message: "a box that works itself out is not also a locked answer" });
  }
  if (f.x + f.w > 1.0001) ctx.addIssue({ code: "custom", path: ["w"], message: "the field runs off the right edge of the page" });
  if (f.y + f.h > 1.0001) ctx.addIssue({ code: "custom", path: ["h"], message: "the field runs off the bottom edge of the page" });
  if (f.sender && !SENDER_TYPES.includes(f.type)) ctx.addIssue({ code: "custom", path: ["sender"], message: `a ${f.type} is filled in by the person signing, not the sender` });
  if (f.sender && f.calc !== undefined) ctx.addIssue({ code: "custom", path: ["sender"], message: "a box that works itself out is not filled in by the sender" });
  if (f.locked && f.default === undefined) ctx.addIssue({ code: "custom", path: ["default"], message: "a locked field needs the answer in default" });
  // R13-D305: an optional sender box left empty is locked with no answer (resolveBoxValues) — "" there is "nothing chosen", not a choice; a required one still needs a real choice
  if (f.locked && f.options && f.default !== undefined && f.type === "dropdown" && !(f.default === "" && f.required === false) && !f.options.includes(f.default)) ctx.addIssue({ code: "custom", path: ["default"], message: "the locked answer must be one of the choices" });
  const choosing = f.type === "dropdown" || f.type === "multiselect";
  if (choosing && (!f.options || f.options.length === 0)) ctx.addIssue({ code: "custom", path: ["options"], message: `a ${f.type === "multiselect" ? "multi-select" : "dropdown"} needs its choices` });
  if (!choosing && f.options) ctx.addIssue({ code: "custom", path: ["options"], message: "only a dropdown or multi-select carries choices" });
  if (f.type === "payment") {
    const kinds = [f.amount_minor, f.amount_from, f.amount_formula, f.price_id, f.payment_link, f.amount_ask].filter((x) => x !== undefined).length;
    if (kinds !== 1) ctx.addIssue({ code: "custom", path: ["amount_minor"], message: "a payment field has exactly one way of setting the amount: a fixed amount, a custom value, a formula, a Stripe price, a Stripe payment link or an amount the signer chooses — not several, not none" });
    if (f.amount_ask) { const { min_minor: lo, max_minor: hi, suggested_minor: sg } = f.amount_ask; if (lo !== undefined && hi !== undefined && lo > hi) ctx.addIssue({ code: "custom", path: ["amount_ask"], message: "the smallest amount cannot be more than the largest" }); if (sg !== undefined && ((lo !== undefined && sg < lo) || (hi !== undefined && sg > hi))) ctx.addIssue({ code: "custom", path: ["amount_ask"], message: "the suggested amount must sit between the smallest and the largest" }); }
    if (f.deposit && f.plan) ctx.addIssue({ code: "custom", path: ["deposit"], message: "a payment is either a deposit or a repeating plan, not both" });
    if ((f.deposit || f.plan) && f.amount_minor === undefined) ctx.addIssue({ code: "custom", path: ["amount_minor"], message: "a deposit or a repeating plan needs a fixed amount to work from" });
    if (f.deposit && "amount_minor" in f.deposit && f.amount_minor !== undefined && f.deposit.amount_minor >= f.amount_minor) ctx.addIssue({ code: "custom", path: ["deposit"], message: "the deposit must be less than the total" });
    if (f.deposit && "percent" in f.deposit && f.amount_minor !== undefined && Math.round(f.amount_minor * f.deposit.percent / 100) < 50) ctx.addIssue({ code: "custom", path: ["deposit"], message: "the deposit works out to less than 0.50, which cannot be charged" });
    if (f.amount_formula !== undefined) { try { parseFormula(f.amount_formula); } catch (e) { ctx.addIssue({ code: "custom", path: ["amount_formula"], message: e.message }); } }
    if (f.required === false) ctx.addIssue({ code: "custom", path: ["required"], message: "a payment field is always required: the signature does not complete until it is paid" });
    if (f.default !== undefined) ctx.addIssue({ code: "custom", path: ["default"], message: "a payment cannot be prefilled" });
  } else if (f.amount_minor !== undefined || f.amount_from !== undefined || f.amount_formula !== undefined || f.price_id !== undefined || f.payment_link !== undefined || f.currency !== undefined || f.amount_ask !== undefined || f.deposit !== undefined || f.plan !== undefined) ctx.addIssue({ code: "custom", path: ["amount_minor"], message: "only a payment field carries an amount" });
  if (AUTO_FIELD_TYPES.includes(f.type) && f.default !== undefined) ctx.addIssue({ code: "custom", path: ["default"], message: `a ${f.type} is filled by signing and cannot be prefilled` });
});

const pdfFileRefSchema = z.object({
  file_id: z.string().uuid(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  page_count: z.number().int().min(1).max(2000),
  pages: z.array(z.object({ w: z.number().positive(), h: z.number().positive() }).strict()).min(1).max(2000),
  name: z.string().min(1).max(255),
}).strict();

const pdfRoleSchema = z.object({ key: roleKey, label: z.string().min(1).max(80) }).strict();

export const pdfBodySchema = z.object({
  kind: z.literal("pdf"),
  schema_version: z.literal(PDF_BODY_SCHEMA_VERSION),
  file: pdfFileRefSchema,
  roles: z.array(pdfRoleSchema).max(50),
  fields: z.array(pdfFieldSchema).max(2000),
  suggestions: z.array(z.object({
    id: z.string().min(1).max(64), type: z.enum(PDF_FIELD_TYPES), page: z.number().int().min(1),
    x: frac, y: frac, w: z.number().min(0.005).max(1), h: z.number().min(0.005).max(1), why: z.string().max(200).optional(),
    // from field detection (detect/engine.mjs): how sure it is, where it came from, what the printed label said, whose it is, and what kind of answer it takes
    confidence: z.number().min(0).max(1).optional(), source: z.string().max(24).optional(), label: z.string().max(120).optional(), role: roleKey.optional(),
    sensitive: z.boolean().optional(), format: z.enum(["none", "email", "phone", "number", "date", "zip"]).optional(), group: z.string().max(40).optional(), autofill: z.enum(["name", "email"]).optional(),
    knownForm: z.string().max(160).optional(),   // Run 7: the known-forms library recognised the upload as this form
  }).strict()).max(500).optional(),
  // Run 9: whole pages of an uploaded PDF that are part of the document only when a rule over earlier answers holds (a hidden page is left out of the sealed copy)
  page_rules: z.array(z.object({ page: z.number().int().min(1).max(2000), show_when: z.record(z.string(), z.any()) }).strict()).max(2000).optional(),
  // what field detection learned about the file as a whole (editing only, dropped at send and when a template is kept): which pages are forms and which are reference pages, how the packet splits, and whether the layout was remembered
  detect: z.object({
    pages: z.array(z.object({ page: z.number().int().min(1), kind: z.enum(["form", "reference"]), fields: z.number().int().min(0) }).passthrough()).max(2000).optional(),
    documents: z.array(z.object({ from: z.number().int().min(1), to: z.number().int().min(1), kind: z.enum(["form", "reference"]), title: z.string().max(200).nullable().optional() })).max(500).optional(),
    remembered: z.string().max(200).optional(), truncated: z.boolean().optional(),
  }).strict().optional(),
}).strict().superRefine((b, ctx) => {
  if (b.file.pages.length !== b.file.page_count) ctx.addIssue({ code: "custom", path: ["file", "pages"], message: "page_count and the page sizes disagree" });
  const seats = new Set(b.roles.map((r) => r.key));
  if (seats.size !== b.roles.length) ctx.addIssue({ code: "custom", path: ["roles"], message: "two seats share a key" });
  const ids = new Set();
  b.fields.forEach((f, i) => {
    if (ids.has(f.id)) ctx.addIssue({ code: "custom", path: ["fields", i, "id"], message: `two fields share the id ${f.id}` });
    ids.add(f.id);
    if (f.page > b.file.page_count) ctx.addIssue({ code: "custom", path: ["fields", i, "page"], message: `page ${f.page} does not exist (the file has ${b.file.page_count})` });
    if (!seats.has(f.role)) ctx.addIssue({ code: "custom", path: ["fields", i, "role"], message: `the seat ${f.role} is not on this document` });
  });
  for (const p of b.page_rules ?? []) if (p.page > b.file.page_count) ctx.addIssue({ code: "custom", path: ["page_rules"], message: `page ${p.page} does not exist (the file has ${b.file.page_count})` });
  for (const m of checkRuleRefs({ fields: b.fields, pages: b.page_rules ?? [] })) ctx.addIssue({ code: "custom", path: ["fields"], message: m });
  b.fields.forEach((f, i) => {   // a formula may read only OTHER fields that exist, and only ones the same person fills (their own values are what is submitted when they pay)
    if (f.type !== "payment" || f.amount_formula === undefined) return;
    let names = []; try { names = formulaNames(f.amount_formula); } catch { return; }   // a malformed formula was already reported on the field
    for (const n of names) {
      const other = b.fields.find((x) => x.id === n);
      if (!other || other.id === f.id) {
        const near = b.fields.find((x) => x.id !== f.id && x.id.toLowerCase() === n.toLowerCase());   // field names keep their capitals: say which one was meant
        ctx.addIssue({ code: "custom", path: ["fields", i, "amount_formula"], message: `the formula reads “${n}”, which is not another field on this document${near ? ` — did you mean “${near.id}”? (names are case-sensitive)` : ""}` });
      }
      else if (other.role !== f.role) ctx.addIssue({ code: "custom", path: ["fields", i, "amount_formula"], message: `the formula reads “${n}”, which a different person fills in — a payment can only use that same person's fields` });
    }
  });
});

/** Parse a pdf body (authoring or frozen — one shape). Throws a plain Error naming the first problem; callers wrap it with their own http error. */
export function parsePdfBodyData(body) {
  const r = pdfBodySchema.safeParse(body);
  if (!r.success) {
    const i = r.error.issues[0];
    const err = new Error(`this pdf body is not the one permitted shape — ${i.path.join(".") || "(root)"}: ${i.message}`);
    err.issues = r.error.issues.map((x) => ({ path: x.path.join(".") || "(root)", code: x.code, message: x.message }));
    throw err;
  }
  return r.data;
}

/** Expand `repeat: every_page` fields into one field per page (ids suffixed with the page) and drop the editing-only suggestions. The result is what is frozen at send. */
export function freezePdfBody(body) {
  const b = parsePdfBodyData(body);
  const out = [];
  for (const f of b.fields) {
    if (f.repeat !== "every_page") { out.push(f); continue; }
    for (let p = 1; p <= b.file.page_count; p += 1) out.push({ ...f, id: `${f.id}-p${p}`, page: p, repeat: undefined });
  }
  const { suggestions, detect, ...rest } = b;
  return parsePdfBodyData({ ...rest, fields: out.map((f) => { const { repeat, ...g } = f; return g; }) });
}

/**
 * The "check it" checklist (23.4.5): everything that would make a send fail or confuse someone, as {ok, text, severity}. Pure, so the browser shows the same list the server enforces.
 * @param parties [{role, name, email, action_role}] the seats' people; a seat with no person is reported.
 */
export function checkPdfDraft(body, parties, { senderIdentity = null, order = null } = {}) {
  const items = [];
  // Run 8 R8-47: a row the browser can translate carries `key` (an ICU message in the web catalogue) and `vars`; `text` stays the English line for the API and anything without a key.
  const push = (ok, text, severity = "error", key = null, vars = null, fix = null) => items.push({ ok, text, severity: ok ? "ok" : severity, ...(key ? { key, vars: vars ?? {} } : {}), ...(fix && !ok ? { fix } : {}) });
  const b = (() => { try { return parsePdfBodyData(body); } catch (e) { items.push({ ok: false, severity: "error", text: e.message }); return null; } })();
  if (!b) return { ok: false, items };
  const signers = parties.filter((p) => (p.action_role ?? "signer") === "signer");
  push(signers.length > 0, signers.length ? `${signers.length} ${signers.length === 1 ? "person signs" : "people sign"}` : "Nobody is set to sign — add at least one person", "error", signers.length ? "{n, plural, one {# person signs} other {# people sign}}" : "Nobody is set to sign — add at least one person", { n: signers.length });
  for (const p of parties) {
    const ok = !!(p.name && p.name.trim());
    if (!ok) push(false, `A person on this send has no name`, "error", "A person on this send has no name");
    const checked = p.email ? cleanEmailAddress(p.email) : { ok: true };
    const emailOk = checked.ok;
    push(emailOk, emailOk ? `${p.name || "Someone"}: email looks right` : `${p.name || "Someone"}: "${String(p.email).slice(0, 80)}" is not an email address — it ${checked.reason}`, "error", emailOk && p.name ? "{name}: email looks right" : null, { name: p.name });
    if (!p.email && !p.in_person) push(false, `${p.name || "Someone"} has no email — add one, or mark them as signing on this device`, "error", p.name ? "{name} has no email — add one, or mark them as signing on this device" : null, { name: p.name });
  }
  for (const s of signers) {
    const mine = b.fields.filter((f) => f.role === s.role);
    push(mine.some((f) => f.type === "signature"), mine.some((f) => f.type === "signature") ? `${s.name}: has a signature field` : `${s.name} has no signature field — place one`, "error", s.name ? (mine.some((f) => f.type === "signature") ? "{name}: has a signature field" : "{name} has no signature field — place one") : null, { name: s.name });
  }
  // ★ §23.5.16 — roles that do not sign carry no fields (an assistant helps by filling the fields of the signer they assist)
  for (const p of parties.filter((x) => ["approver", "viewer", "cc"].includes(x.action_role))) {
    const has = b.fields.some((f) => f.role === p.role);
    push(!has, has ? `${p.name} is ${p.action_role === "approver" ? "an approver" : p.action_role === "viewer" ? "a viewer" : "only getting a copy"}, so they cannot have fields — move them to a signer` : `${p.name}: no fields (correct for ${p.action_role === "cc" ? "a copy" : p.action_role})`);
  }
  for (const p of parties.filter((x) => x.action_role === "assistant")) {
    const target = parties.find((q) => q.role === p.assists_role && (q.action_role ?? "signer") === "signer");
    const ok = Boolean(target) && order === "sequential";
    push(ok, ok ? `${p.name} will fill in details for ${target.name}` : !target ? `${p.name} is an assistant but is not set to help a signer` : `${p.name} is an assistant, which needs people to sign in order`);
  }
  // Run 9 (R8-57): a box filled in by the sender needs its answer before anyone is asked to sign (a value worked out from {{org.name}} and the like is checked again at send)
  for (const f of emptySenderBoxes(b.fields)) push(false, senderBoxMessage(f), "error", SENDER_BOX_KEY, { label: f.label || f.id }, { step: "prepare", field: f.id });
  const seats = new Set(parties.map((p) => p.role));
  const orphan = b.fields.filter((f) => !seats.has(f.role));
  push(orphan.length === 0, orphan.length ? `${orphan.length} field${orphan.length === 1 ? " is" : "s are"} assigned to a seat nobody fills` : "Every field belongs to someone", "error", orphan.length ? "{n, plural, one {# field is assigned to a seat nobody fills} other {# fields are assigned to a seat nobody fills}}" : "Every field belongs to someone", { n: orphan.length });
  if (senderIdentity && senderIdentity.fallback) push(false, senderIdentity.reason ? `Emails will go out from the platform address, not the sender you chose: ${senderIdentity.reason.replace(/\s*—?\s*sending from the platform address( until it is)?\.?$/i, "").replace(/\.$/, "")}. Fix it in Settings → Email.` : "Emails will go out from the platform address — set your own sending domain in Documents → Settings for a more trusted sender", "warning");
  // Run 9 (decision 6): a rule may use only answers from people who act EARLIER (or what the sender locked) — checked here, against the order on this send, so Check says it before Send does
  if (b.fields.some((f) => f.show_when || f.calc) || b.page_rules?.length) {
    const stepOf = (role) => { const ps = parties.filter((p) => p.role === role && (p.action_role ?? "signer") === "signer"); return ps.length ? Math.min(...ps.map((p) => (order === "sequential" ? (p.position ?? 1) : 1))) : Number.MAX_SAFE_INTEGER; };
    for (const m of checkRuleOrderDetailed({ fields: b.fields, pages: b.page_rules ?? [], stepOf })) push(false, m.text, "error", m.key, m.vars);
  }
  return { ok: items.every((i) => i.ok || i.severity === "warning"), items };
}

// ── what a person may put in a field (shared by the signing page and the server) ──────────────────────────────────────────────
const VALIDATORS = {
  email: (v) => (/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(v) ? null : "must be an email address"),
  phone: (v) => (/^[+()\-.\s0-9]{7,25}$/.test(v) && v.replace(/\D/g, "").length >= 7 ? null : "must be a phone number"),
  number: (v) => (v.trim() !== "" && Number.isFinite(Number(v)) ? null : "must be a number"),
  date: (v) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v); const d = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); return d && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? null : "must be a date (YYYY-MM-DD)"; },   // R13-D232: a calendar check — Date.parse rolls 2026-02-31 over to 3 March
  zip: (v) => (/^\d{5}(-\d{4})?$/.test(v) ? null : "must be a ZIP code"),
};
const PNG = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Is `value` acceptable for this field? Returns a short problem ("must be a number") or null. Signature, initials and image take a PNG data URL (≤ 200 KB); date_signed is filled by the system. */
export function validateFieldValue(field, value) {
  const empty = value === undefined || value === null || value === "";
  if (field.type === "date_signed") return null;
  if (empty) return field.required ? "is required" : null;
  if (typeof value !== "string") return "has the wrong shape";
  if (["signature", "initials", "image", "stamp"].includes(field.type)) return PNG.test(value) && value.length <= 204800 ? null : "must be a picture under 200 KB";
  if (field.type === "checkbox") return value === "true" || value === "false" ? (field.required && value === "false" ? "must be ticked" : null) : "must be ticked or not";
  if (field.type === "dropdown") return (field.options ?? []).includes(value) ? null : "must be one of the choices";
  if (field.type === "multiselect") {
    let list; try { list = JSON.parse(value); } catch { return "has the wrong shape"; }
    if (!Array.isArray(list) || list.some((x) => typeof x !== "string") || new Set(list).size !== list.length) return "has the wrong shape";
    if (list.some((x) => !(field.options ?? []).includes(x))) return "must be from the choices";
    return field.required && list.length === 0 ? "needs at least one choice" : null;
  }
  if (field.type === "payment") return value === "paid" ? null : "needs to be paid";      // the browser says "paid" once Stripe confirms; the server never trusts it — it re-reads Stripe when the person signs
  if (field.type === "file") return UUID.test(value) ? null : "needs an uploaded file";
  if (value.length > (field.max_length ?? 500)) return `must be ${field.max_length ?? 500} characters or fewer`;
  const rule = field.validation && field.validation !== "none" ? VALIDATORS[field.validation] : null;
  return rule ? rule(value) : null;
}
