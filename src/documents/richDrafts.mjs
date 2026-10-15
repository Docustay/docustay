// src/documents/richDrafts.mjs — DOCUSTAY'S RICH-TEXT TEMPLATES → AN UNSIGNED PDF DRAFT (Part 29 follow-up, item 3).
// A rich-text template is an ordinary contract template (heading / paragraph / list / bold / italic / merge-field blocks, versioned, clauses insertable).
// A the platform contract instance needs a subject person; Docustay has none, so a document made from a template is RENDERED with the values the sender typed and
// enters the PDF flow (place signature fields, add people, send, sign, sealed copy) exactly like an uploaded PDF.
import { invalid, notFound } from "../http/errors.mjs";
import { renderPreviewPdf } from "./pdf.mjs";
import { chromeInputsFor } from "./chromeInputs.mjs";
import { acceptUpload } from "./files.mjs";
import { parseTemplateBody } from "./body.mjs";

const slugName = (s) => String(s || "document").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "document";

/** The merge fields a template's body uses, in order, with the label each carries — what the "create document" form asks for. */
function mergeFieldsOf(body) {
  const seen = new Map();
  for (const s of body?.sections ?? []) for (const b of s.blocks ?? []) {
    if (b.type === "variable" && !seen.has(b.name)) seen.set(b.name, b.label || b.name);
    if (b.type === "list") for (const item of b.items ?? []) for (const r of item) if (r.type === "variable" && !seen.has(r.name)) seen.set(r.name, r.label || r.name);
  }
  return [...seen].map(([name, label]) => ({ name, label }));
}

async function loadTemplate(tx, templateId) {
  const { rows: [t] } = await tx.query(`SELECT id, name, version, body, active FROM keystone.document_template WHERE id = $1 AND builder = 'contract'`, [templateId]);
  if (!t) throw notFound("no such template");
  return t;
}

/** The fields to ask for, with sensible defaults already filled (today's date, the workspace name). */
export async function richTemplateForm(tx, { tenantId, templateId }) {
  const t = await loadTemplate(tx, templateId);
  const chrome = await chromeInputsFor(tx, { tenantId, templateId, withLogoBytes: false });
  const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: chrome.zone || "UTC" });
  const defaults = { "org.name": chrome.brand.practiceName ?? "", "document.date": today, "document.title": t.name };
  return { templateId: t.id, name: t.name, version: t.version, fields: mergeFieldsOf(t.body).map((f) => ({ ...f, value: defaults[f.name] ?? "" })) };
}

/** Render the template with `values` and start a PDF draft from it. Returns what an upload returns ({ instanceId, … }). */
export async function createDraftFromRichTemplate(tx, { tenantId, actorUserId = null, templateId, values = {}, title = null }) {
  const t = await loadTemplate(tx, templateId);
  if (!t.active) throw invalid("that template version is retired — open the template and use its newest version", { field: "templateId" });
  const body = parseTemplateBody("contract", t.body);
  const given = Object.fromEntries(Object.entries(values ?? {}).filter(([, v]) => typeof v === "string"));
  const missing = mergeFieldsOf(body).filter((f) => !String(given[f.name] ?? "").trim()).map((f) => f.label);
  if (missing.length) throw invalid(`fill in: ${missing.join(", ")}`, { code: "values_missing", missing });
  const docTitle = (title && title.trim()) || t.name;
  const chrome = await chromeInputsFor(tx, { tenantId, templateId, withLogoBytes: true });
  // the PDF is written once, now — so the signer's name and the rest are typed by the sender here, like any other merge field
  // the template carries one signature section only because a contract body must have one; the drafted PDF gets its signature fields placed in the editor, so it is left off here
  const pageBody = { ...body, sections: body.sections.filter((x) => !(x.blocks ?? []).every((b) => b.type === "signature")) };
  const { bytes } = await renderPreviewPdf({ builder: "contract", title: docTitle, body: pageBody, values: given, settings: chrome.settings, brand: chrome.brand, logoBytes: chrome.logoBytes, zone: chrome.zone, draft: true });
  const out = await acceptUpload(tx, { tenantId, actorUserId, name: `${slugName(docTitle)}.pdf`, bytes: Buffer.from(bytes), title: docTitle, origin: "created" });
  return { ...out, fromTemplate: { id: t.id, version: t.version } };
}
