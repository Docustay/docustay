// THE CHECK BEFORE SENDING (Run 9 Part 3.5; board "ScribeAct", right half; Free on every plan). Deterministic — no AI, nothing guessed. Four rows on the Check step, each either one green line or
// the problems it found, and each problem says where to fix it (`fix`: the step, and the box when there is one) and, when it has a place on the page, where to look (`show`):
//   1. every signer has a signature box;
//   2. the signing order makes sense (no empty step in a one-after-the-other send; a rule or formula only reads answers from people who act earlier);
//   3. every required box has someone to fill it (a box whose seat has nobody signing in it, with no answer from the sender, can never be filled);
//   4. the email matches the document: a labelled number ("unit 4", "invoice 1182"), an amount, or the name the email greets, that the document contradicts.
// Every row carries `text` (English, for the API) and `key` + `vars` (an ICU sentence the web catalogue translates), like checkPdfDraft's rows (R8-47).
import { parsePdfBodyData } from "./pdfBody.mjs";
import { checkRuleOrderDetailed } from "./rules.mjs";
import { getPdfDocument } from "./pdfDocs.mjs";
import { documentsOfSend } from "./parties.mjs";
import { readFileBytes } from "./files.mjs";
import { pdfTextRuns } from "./pdfProcess.mjs";

const fill = (key, vars) => key.replace(/\{(\w+)\}/g, (_, k) => String(vars?.[k] ?? ""));
const row = (kind, ok, key, vars = {}, extra = {}) => ({ kind, ok, text: fill(key, vars), key, vars, ...extra });
const FILLS = new Set(["signer"]);   // the people who type into boxes (an assistant fills in for the signer they help, whose seat is then also on the send)
const labelOf = (f) => f.label || f.type;

// "unit 4", "Apt. 12B", "invoice #1182", "lot 7": a word that names a thing, then its number. Kept to words that name a thing so "within 30 days" is never read as one.
const LABELS = { unit: "unit", apt: "apartment", apartment: "apartment", suite: "suite", room: "room", lot: "lot", plot: "plot", flat: "flat", house: "house", building: "building", space: "space", parking: "parking", invoice: "invoice", order: "order", policy: "policy", contract: "contract", account: "account", case: "case", reference: "reference", ref: "reference" };
const LABELLED = new RegExp(`\\b(${Object.keys(LABELS).join("|")})\\.?\\s*(?:#|no\\.?|number)?\\s*([A-Za-z]?\\d[\\dA-Za-z-]{0,11})\\b`, "gi");
// "$1,850", "$1,850.00", "€90", "1850 USD": an amount with its currency mark
const MONEY = /(?:([$€£])\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{2}))?)|(?:\b(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{2}))?\s?(USD|EUR|GBP|dollars|euros|pounds)\b)/gi;
const GREETING = /\b(?:[Hh]i|[Hh]ello|[Dd]ear|[Hh]ey)\s+([A-Z][a-zA-Z'’-]{1,30})\b/;   // the greeting word in any case, the name capitalised

/** Every labelled number in a text → [{label, value, raw}]. Pure. */
function labelledNumbers(text) {
  const out = [];
  for (const m of String(text ?? "").matchAll(LABELLED)) out.push({ label: LABELS[m[1].toLowerCase()], value: m[2].toUpperCase(), raw: m[0].trim() });
  return out;
}
/** Every amount in a text → [{minor, raw}] (minor units, so $1,850 and 1850.00 USD are the same). Pure. */
function amountsIn(text) {
  const out = [];
  for (const m of String(text ?? "").matchAll(MONEY)) { const whole = (m[2] ?? m[4] ?? "").replace(/,/g, ""), cents = m[3] ?? m[5] ?? "00"; if (whole) out.push({ minor: Number(whole) * 100 + Number(cents), raw: m[0].trim() }); }
  return out;
}

/**
 * The four rows. Pure.
 * @param {{ fields:object[], pageRules?:object[], parties:object[], order?:string|null, subject?:string|null, message?:string|null, pages?:{page:number, runs:{str,x,y,w,h}[]}[], title?:string }} a
 * @returns {{ ok:boolean, rows:object[] }}
 */
export function checkBeforeSending({ fields = [], pageRules = [], parties = [], order = null, subject = null, message = null, pages = [] }) {
  const rows = [];
  const signers = parties.filter((p) => FILLS.has(p.action_role ?? "signer"));
  // 1 · signatures (a signing group is one seat: one box for the group)
  const seats = [...new Map(signers.map((p) => [p.role, p])).values()];
  const noBox = seats.filter((p) => !fields.some((f) => f.role === p.role && f.type === "signature"));
  if (!seats.length) rows.push(row("signatures", false, "Nobody is set to sign — add at least one person", {}, { fix: { step: "people" } }));
  else if (!noBox.length) rows.push(row("signatures", true, "Every signer has a signature box"));
  else for (const p of noBox) rows.push(row("signatures", false, "{name} has no signature box", { name: p.group_label || p.name || p.role }, { fix: { step: "prepare", role: p.role } }));

  // 2 · order
  const orderRows = [];
  if (order === "sequential") {
    const steps = [...new Set(parties.filter((p) => ["signer", "approver", "assistant"].includes(p.action_role ?? "signer")).map((p) => p.position ?? 1))].sort((a, b) => a - b);
    for (let i = 0; i < steps.length; i += 1) if (steps[i] !== i + 1) { orderRows.push(row("order", false, "Nobody acts at step {n}, so the signing would stop there. Number the steps 1, 2, 3 without a gap.", { n: i + 1 }, { fix: { step: "people" } })); break; }
  }
  const stepOf = (role) => { const ps = signers.filter((p) => p.role === role); return ps.length ? Math.min(...ps.map((p) => (order === "sequential" ? (p.position ?? 1) : 1))) : Number.MAX_SAFE_INTEGER; };
  if (fields.some((f) => f.show_when || f.calc) || pageRules.length) for (const m of checkRuleOrderDetailed({ fields, pages: pageRules, stepOf }).slice(0, 4)) orderRows.push({ kind: "order", ok: false, ...m, fix: { step: "prepare" } });
  rows.push(...(orderRows.length ? orderRows : [row("order", true, "Signing order makes sense")]));

  // 3 · required boxes with nobody to fill them (signature boxes are row 1; a box that works itself out, a locked answer or one the sender already filled needs nobody)
  const fillable = new Set(signers.map((p) => p.role));
  const orphans = fields.filter((f) => f.required && !["signature", "date_signed"].includes(f.type) && !f.calc && !(f.locked && f.default !== undefined) && !(typeof f.default === "string" && f.default.trim()) && !fillable.has(f.role));
  if (!orphans.length) rows.push(row("required", true, "Every required box has someone to fill it"));
  else for (const f of orphans.slice(0, 6)) rows.push(row("required", false, "“{box}” is empty and nobody is set to fill it.", { box: labelOf(f) }, { fix: { step: "prepare", field: f.id }, show: { page: f.page, x: f.x, y: f.y, w: f.w, h: f.h, field: f.id } }));

  // 4 · the email against the document
  const email = [subject, message].filter(Boolean).join("\n").replace(/\{\{[^}]*\}\}/g, " ");
  const emailRows = [];
  if (email.trim()) {
    const docRuns = pages.flatMap((p) => p.runs.map((r) => ({ ...r, page: p.page })));
    const prefilled = fields.filter((f) => typeof f.default === "string" && f.default.trim() && !/\{\{/.test(f.default)).map((f) => ({ str: `${f.label ?? ""} ${f.default}`, page: f.page, x: f.x, y: f.y, w: f.w, h: f.h }));
    const where = [...docRuns, ...prefilled];
    // a document's text is in short runs: read each run with its neighbour, so "Unit" and "5" in two runs still pair
    const windows = where.map((r, i) => ({ r, text: `${r.str} ${where[i + 1] && where[i + 1].page === r.page ? where[i + 1].str : ""}` }));
    const docPairs = windows.flatMap(({ r, text }) => labelledNumbers(text).map((x) => ({ ...x, at: r })));
    for (const e of labelledNumbers(email)) {
      const same = docPairs.filter((d) => d.label === e.label);
      if (same.length && !same.some((d) => d.value === e.value) && !emailRows.some((x) => x.vars.email === e.raw)) emailRows.push(row("email", false, "The email says “{email}” but the document says “{doc}”.", { email: e.raw, doc: same[0].raw }, { fix: { step: "details" }, show: { page: same[0].at.page, x: same[0].at.x, y: same[0].at.y, w: same[0].at.w, h: same[0].at.h } }));
    }
    const docAmounts = windows.flatMap(({ r, text }) => amountsIn(text).map((x) => ({ ...x, at: r })));
    const payAmounts = fields.filter((f) => f.type === "payment" && Number.isInteger(f.amount_minor)).map((f) => ({ minor: f.amount_minor, raw: null, at: { page: f.page, x: f.x, y: f.y, w: f.w, h: f.h } }));
    const allAmounts = [...docAmounts, ...payAmounts];
    for (const e of amountsIn(email)) {
      if (allAmounts.length && !allAmounts.some((d) => d.minor === e.minor) && !emailRows.some((x) => x.vars.email === e.raw)) { const d = docAmounts[0] ?? payAmounts[0];
        emailRows.push(row("email", false, "The email says “{email}” but the document says “{doc}”.", { email: e.raw, doc: d.raw ?? (d.minor / 100).toFixed(2) }, { fix: { step: "details" }, show: { page: d.at.page, x: d.at.x, y: d.at.y, w: d.at.w, h: d.at.h } })); }
    }
    const greeted = GREETING.exec(message ?? "")?.[1];
    if (greeted && parties.length) {
      const names = new Set(parties.flatMap((p) => String(p.name ?? "").split(/\s+/)).concat(parties.map((p) => p.group_label ?? "")).map((s) => s.toLowerCase()).filter(Boolean));
      if (!names.has(greeted.toLowerCase()) && !["all", "everyone", "there", "team", "friend", "friends"].includes(greeted.toLowerCase())) emailRows.push(row("email", false, "The email says “{email}” but nobody on this document is called {name}.", { email: `${/\b(hi|hello|dear|hey)\b/i.exec(message)[0]} ${greeted}`, name: greeted }, { fix: { step: "details" } }));
    }
  }
  rows.push(...(emailRows.length ? emailRows.slice(0, 5) : [row("email", true, email.trim() ? "The email matches the document" : "The email uses the standard wording")]));
  return { ok: rows.every((r) => r.ok), rows };
}

/** The rows for a saved DRAFT (every document in its send, read with its own pages' words). Not a draft → { ok:true, rows:[], notDraft:true }. */
export async function sendCheckFor(tx, { tenantId, instanceId }) {
  const d = await getPdfDocument(tx, { tenantId, instanceId });
  if (d.state !== "draft" || !d.body) return { ok: true, rows: [], notDraft: true };
  const o = d.sendOptions ?? {};
  const members = (await documentsOfSend(tx, { instanceId: d.package.leadId })).map((m) => m.id);
  const out = [];
  for (const id of members.length ? members : [d.id]) {
    const m = id === d.id ? d : await getPdfDocument(tx, { tenantId, instanceId: id });
    let body; try { body = parsePdfBodyData(m.body); } catch { continue; }
    let pages = [];
    try { const { bytes } = await readFileBytes(tx, { fileId: body.file.file_id }); pages = await pdfTextRuns(bytes, { maxPages: 30 }); } catch { pages = []; }
    const r = checkBeforeSending({ fields: body.fields, pageRules: body.page_rules ?? [], parties: d.parties, order: o.order ?? null, subject: o.subject ?? `Please sign: ${d.title}`, message: o.message ?? d.message ?? null, pages });
    for (const x of r.rows) out.push(members.length > 1 ? { ...x, documentId: id, documentTitle: m.title } : x);
  }
  // one green line per kind when every document passes it; the problems otherwise
  const KINDS = ["signatures", "order", "required", "email"];
  const rows = KINDS.flatMap((k) => { const mine = out.filter((x) => x.kind === k); const bad = mine.filter((x) => !x.ok); return bad.length ? bad : mine.slice(0, 1); });
  return { ok: rows.every((x) => x.ok), rows };
}
