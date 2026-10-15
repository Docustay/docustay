// THE SHARED DOCUMENT ENGINE — the creation service (design §3.4). One place that turns a SOURCE into a template (or a one-off document) for either render profile,
// stamps the source on the row, and reads it back. The screens of both products call these through the routes in src/routes/documentsEngine.mjs; nothing else writes
// the source columns.
//   profile "contract"  → today's contract builder: the source is compiled to a contract body (sourceToSections), the template is a `contract` row, rendered by the view tree and pdfkit
//   profile "typeset"   → the starters' pipeline: the source is compiled to HTML + text tags (sourceToHtml), printed by Gotenberg, fields read back, a `pdf` row
// Both keep `source`, `source_version`, `source_hash`, `render_profile` and `origin` on the row, so a template can be opened again in the editor and so its text has a hash.
// A new version is a new row (the rule every builder here keeps); a sent document never re-reads its template.
import { assertNotBuiltin } from "../library.mjs";
import { invalid, notFound, conflict } from "../../http/errors.mjs";
import { createTemplate, newTemplateVersion } from "../templates.mjs";
import { createTemplateFromSource, createFromHtml } from "../templateSources.mjs";
import { ensureAgreementType } from "../starterTemplates.mjs";
import { starter, starterFields } from "../starters/index.mjs";
import { htmlToSource } from "./fromHtml.mjs";
import { resolvableVariableCatalogue } from "../variableCatalogue.mjs";
import { parseTemplateBody } from "../body.mjs";
import { SOURCE_VERSION, parseSource, sourceHash, stripSenderOnly, stripByRules } from "./source.mjs";
import { sourceToSections, sectionsToSource } from "./compileBody.mjs";
import { sourceToHtml } from "./compileHtml.mjs";
import { validateSource } from "./validate.mjs";
import { factsResolver } from "./resolver.mjs";
import { recordAuditEvent } from "../auditTrail.mjs";
import { sendOptionsSchema } from "../pdfDocs.mjs";

const PROFILES = Object.freeze(["typeset", "contract"]);
const ORIGINS = Object.freeze(["readymade", "upload", "written", "ai", "import"]);

/** parse + validate + compile, no database. Throws a plain `invalid` on the first problem a person can act on. */
function compileSource({ source, profile = "typeset", facts = {}, requireSignature = true, forTemplateCompile = false }) {
  if (!PROFILES.includes(profile)) throw invalid(`profile must be one of ${PROFILES.join(", ")}`, { field: "profile" });
  const p = parseSource(source);
  if (!p.ok) throw invalid(`The document is not valid: ${p.errors[0]}`, { field: "source", details: p.errors.slice(0, 8) });
  const names = resolvableVariableCatalogue().map((v) => v.name);
  const v = validateSource(p.source, { names, profile, requireSignature });
  if (!v.ok) throw invalid(`The document cannot be saved yet: ${v.errors[0]}`, { field: "source", details: v.errors.slice(0, 12) });
  if (profile === "contract") {
    const r = sourceToSections(p.source);
    if (r.errors.length) throw invalid(`This document cannot use the contract view: ${r.errors[0]}`, { field: "source", details: r.errors });
    const body = parseTemplateBody("contract", { kind: "contract", schema_version: 1, sections: r.sections });
    return { source: p.source, hash: sourceHash(p.source), warnings: [...p.warnings, ...v.warnings, ...r.warnings], roles: v.roles, body };
  }
  // Run 9: conditional sections are decided now, from the sender's own values, and the text reflows (a reusable template has no values yet, so it keeps every section until a document is made from it)
  const ruled = forTemplateCompile ? { source: p.source, removed: 0, hidden: [] } : stripByRules(p.source, (name) => factsResolver(facts).resolve(name));
  // Docustay flow v2: what a signer receives never contains a Sender-only section (and the rest must still stand on its own: someone signs, merge fields resolve)
  const stripped0 = stripSenderOnly(ruled.source);
  const stripped = { source: stripped0.source, removed: stripped0.removed + ruled.removed };
  if (stripped.removed) {
    const v2 = validateSource(stripped.source, { names, profile, requireSignature });
    if (!v2.ok) throw invalid(ruled.removed ? `Without the sections your answers leave out (${ruled.hidden.join(", ")}) the document cannot be sent: ${v2.errors[0]}` : `Without the Sender only section the document cannot be sent: ${v2.errors[0]}`, { field: "source", details: v2.errors.slice(0, 12) });
  }
  const h = sourceToHtml(stripped.source, { resolver: factsResolver(facts) });
  const senderHtml = stripped.removed ? (() => { try { const x = sourceToHtml(p.source, { resolver: factsResolver(facts) }); return x.errors.length ? null : x.html; } catch { return null; } })() : null;
  if (h.errors.length) throw invalid(`A field in the document is not right: ${h.errors[0]}`, { field: "source", details: h.errors });
  if (h.unresolved.length) throw invalid(`These merge fields have no value when a reusable document is saved: ${h.unresolved.join(", ")}. A reusable document can use the organisation and sender fields; for anything else, add a field the signer or sender fills in.`, { field: "source", details: h.unresolved });
  return { source: p.source, hash: sourceHash(p.source), warnings: [...p.warnings, ...v.warnings], roles: v.roles, html: h.html, senderHtml, senderOnlyBlocks: stripped0.removed, sectionsLeftOut: ruled.hidden, tagCount: h.tags.length };
}

const stamp = (tx, { id, source, hash, profile, origin }) => tx.query(
  `UPDATE keystone.document_template SET source = $2::jsonb, source_version = $3, source_hash = $4, render_profile = $5, origin = $6 WHERE id = $1`,
  [id, JSON.stringify(source), SOURCE_VERSION, hash, profile, origin]);

/** Make a reusable template from a source. Returns { templateId, profile, version, hash, warnings, fields? }. */
export async function saveSourceTemplate(tx, { tenantId, actorUserId = null, name, source, profile = "typeset", origin = "written", paper = "letter", facts = {}, requireSignature = true, description = null, kind = "document" }) {
  if (!["document", "form"].includes(kind)) throw invalid("kind must be document or form", { field: "kind" });
  const title = String(name ?? "").trim();
  if (!title) throw invalid("The template needs a name.", { field: "name" });
  if (!ORIGINS.includes(origin)) throw invalid(`origin must be one of ${ORIGINS.join(", ")}`, { field: "origin" });
  const c = compileSource({ source, profile, facts: profile === "typeset" ? withPlaceholders(source, facts) : facts, requireSignature, forTemplateCompile: true });
  if (profile === "contract") {
    const { id } = await createTemplate(tx, { tenantId, builder: "contract", name: title, body: c.body, actorUserId, description });
    // an authored contract takes the practice's agreement type, exactly as the contract builder's own route does (F777), so it is routed, signed and executed the same way
    const typeId = await ensureAgreementType(tx, { tenantId, actorUserId });
    await tx.query(`UPDATE keystone.document_template SET type_id = $1 WHERE id = $2 AND tenant_id = $3`, [typeId, id, tenantId]);
    await stamp(tx, { id, source: c.source, hash: c.hash, profile, origin });
    return { templateId: id, profile, version: 1, hash: c.hash, warnings: c.warnings };
  }
  const made = await createTemplateFromSource(tx, { tenantId, actorUserId, name: title, source: { html: c.html }, paper, typeset: { ref: null, initials: [] } });
  await stamp(tx, { id: made.templateId, source: c.source, hash: c.hash, profile, origin });
  if (kind === "form") await tx.query(`UPDATE keystone.document_template SET kind = 'form', collects_many = true WHERE id = $1`, [made.templateId]);   // ★ Run 7: the type is chosen where the template is made
  return { templateId: made.templateId, profile, version: 1, hash: c.hash, warnings: [...c.warnings, ...made.warnings], fields: made.fields, kind };
}

/** A NEW VERSION of a source template (a new row; the old one is retired, never edited). */
export async function saveSourceVersion(tx, { tenantId, actorUserId = null, templateId, source, facts = {}, requireSignature = true, changeNote = null }) {
  const { rows: [t] } = await tx.query(`SELECT id, family_id, name, builder, version, active, render_profile, origin, source_hash, previous_version_id, folder, tags, ai_rules, collects_many, form_settings, send_defaults, description, client_description, message FROM keystone.document_template WHERE id = $1`, [templateId]);
  if (!t) throw notFound("That template was not found.");
  await assertNotBuiltin(tx, templateId);   // Run 9 Part 4R
  if (!t.render_profile) throw invalid("That template was not written in the editor, so it has no source to change. Make a copy in the editor instead.", { field: "templateId" });
  if (!t.active) throw conflict("Only the current version of a template can be changed — open the current one.");
  const profile = t.render_profile;
  const c = compileSource({ source, profile, facts: profile === "typeset" ? withPlaceholders(source, facts) : facts, requireSignature, forTemplateCompile: true });
  if (c.hash === t.source_hash) throw invalid("Nothing has changed.", { code: "no_change" });
  if (profile === "contract") {
    const v = await newTemplateVersion(tx, { tenantId, templateId, body: c.body, actorUserId });
    await stamp(tx, { id: v.id, source: c.source, hash: c.hash, profile, origin: t.origin ?? "written" });
    return { templateId: v.id, profile, version: v.version, hash: c.hash, warnings: c.warnings };
  }
  // typeset: print the new source as a fresh template, then take the old template's name and put it in the line of versions
  const made = await createTemplateFromSource(tx, { tenantId, actorUserId, name: `${t.name} (new version)`, source: { html: c.html }, paper: "letter", typeset: { ref: null, initials: [] } });
  const { rows: [{ max }] } = await tx.query(`SELECT max(version)::int AS max FROM keystone.document_template WHERE family_id = $1`, [t.family_id]);
  // ★ Run 7: the new version joins the family (the trigger copies family_id and kind from previous_version_id) and carries what does not change what is signed: folder, tags, rules, the
  //   remembered send choices and notes, and a form's settings — before this, editing a written form made a version that was no longer a form and had no link.
  await tx.query(`UPDATE keystone.document_template SET name = $2, version = $3, previous_version_id = $4, change_note = $5, folder = $6, tags = $7::text[], ai_rules = $8, collects_many = $9, form_settings = $10::jsonb, send_defaults = $11::jsonb, description = $12, client_description = $13, message = $14 WHERE id = $1`,
    [made.templateId, t.name, max + 1, t.id, changeNote ? String(changeNote).slice(0, 300) : null, t.folder, t.tags ?? [], t.ai_rules, t.collects_many, t.form_settings ? JSON.stringify(t.form_settings) : null, t.send_defaults ? JSON.stringify(t.send_defaults) : null, t.description, t.client_description, t.message]);
  const { rows: [n] } = await tx.query(`SELECT approval_status FROM keystone.document_template WHERE id = $1`, [made.templateId]);
  if (n.approval_status === "approved") {
    const { rows: [link] } = await tx.query(`SELECT self_serve_enabled, self_serve_slug FROM keystone.document_template WHERE id = $1`, [t.id]);
    await tx.query(`UPDATE keystone.document_template SET active = false, retired_at = now(), self_serve_enabled = false, self_serve_slug = NULL WHERE id = $1`, [t.id]);
    await tx.query(`UPDATE keystone.document_template SET active = true, retired_at = NULL, self_serve_enabled = $2, self_serve_slug = $3 WHERE id = $1`, [made.templateId, link?.self_serve_enabled === true, link?.self_serve_slug ?? null]);   // the public link moves to the new version
  }
  await stamp(tx, { id: made.templateId, source: c.source, hash: c.hash, profile, origin: t.origin ?? "written" });
  return { templateId: made.templateId, profile, version: max + 1, hash: c.hash, warnings: [...c.warnings, ...made.warnings], active: n.approval_status === "approved" };
}

/** The source a template was written from, for the editor. A contract template made before the shared editor has no stored source: it is converted on the way out (the text and the
 *  section keys are kept; nothing is written until the person saves, which stamps the source). `converted: true` says so. */
export async function getTemplateSource(tx, { templateId }) {
  const { rows: [t] } = await tx.query(`SELECT id, name, version, active, builder, body, source, source_version, source_hash, render_profile, origin, description, client_description, message, send_defaults, ai_rules FROM keystone.document_template WHERE id = $1`, [templateId]);
  if (!t) throw notFound("That template was not found.");
  const defaults = { description: t.description ?? null, clientDescription: t.client_description ?? null, message: t.message ?? null, sendDefaults: t.send_defaults ?? {}, aiRules: t.ai_rules ?? "" };   // what a document made from it starts with
  if (t.source) return { variables: variablesOf(t.source), defaults, templateId: t.id, name: t.name, version: t.version, active: t.active, builder: t.builder, profile: t.render_profile, origin: t.origin, hash: t.source_hash, source: t.source, converted: false };
  if (t.builder === "contract" && Array.isArray(t.body?.sections)) {
    const source = sectionsToSource(t.body.sections);
    const p = parseSource(source);
    if (!p.ok) throw invalid(`That template cannot be opened in the editor: ${p.errors[0]}`, { code: "no_source" });
    return { templateId: t.id, name: t.name, version: t.version, active: t.active, builder: t.builder, profile: "contract", origin: null, hash: sourceHash(p.source), source: p.source, converted: true };
  }
  throw invalid("That template was not written in the editor, so there is no text to open. Make a copy in the editor instead.", { code: "no_source" });
}

/** The questions a template asks the sender: every custom.* merge chip (except the per-person ones) once, with its label, kind and starting value. */
export function variablesOf(source) {
  const out = new Map();
  const visit = (n) => { if (!n || typeof n !== "object") return; if (n.type === "variableChip" && /^custom\./.test(n.attrs?.name ?? "") && !/^custom\.p_/.test(n.attrs.name)) { const key = n.attrs.name.slice(7); if (!out.has(key)) out.set(key, { key, label: n.attrs.label || key, kind: n.attrs.kind || "text", default: n.attrs.default ?? "", help: n.attrs.help ?? "" }); } if (Array.isArray(n.content)) n.content.forEach(visit); };
  visit(source); return [...out.values()];
}
/** A reusable template has no values yet: each custom.* chip prints as its starting value or [Label] in the template's own preview (a document made from it is printed again from the words with the real values). */
function withPlaceholders(source, facts = {}) {
  const f = { ...facts, custom: { ...(facts.custom ?? {}) } };
  const visit = (n) => { if (!n || typeof n !== "object") return; if (n.type === "variableChip" && /^custom\./.test(n.attrs?.name ?? "")) { const k = n.attrs.name.slice(7); if (f.custom[k] === undefined) f.custom[k] = n.attrs.default || `[${n.attrs.label || k}]`; } if (Array.isArray(n.content)) n.content.forEach(visit); };
  visit(source); return f;
}

/** Check a source without saving: what the person would be told on save, plus the HTML for a typeset preview. */
export function checkSource({ source, profile = "typeset", facts = {}, requireSignature = true, forTemplate = false }) {
  try { const c = compileSource({ source, profile, facts: forTemplate && profile === "typeset" ? withPlaceholders(source, facts) : facts, requireSignature, forTemplateCompile: forTemplate === true }); return { ok: true, errors: [], warnings: c.warnings, roles: c.roles, hash: c.hash, html: c.html ?? null, senderHtml: c.senderHtml ?? null, senderOnlyBlocks: c.senderOnlyBlocks ?? 0, sectionsLeftOut: c.sectionsLeftOut ?? [], tagCount: c.tagCount ?? null }; }
  catch (e) { return { ok: false, errors: e.detail?.details ?? [e.message], message: e.message, warnings: [], roles: [], hash: null, html: null }; }
}

/** A ONE-OFF document from a source (mode "document"): printed through the same pipeline and left as a draft for the send flow. `saveAsTemplate` also keeps it as a template. */
export async function createSourceDocument(tx, { tenantId, actorUserId = null, title, source, facts = {}, paper = "letter", saveAsTemplate = false, requireSignature = true, variableValues = null }) {
  const name = String(title ?? "").trim() || "Document";
  const c = compileSource({ source, profile: "typeset", facts, requireSignature });
  const draft = await createFromHtml(tx, { tenantId, actorUserId, name, html: c.html, paper, typeset: { ref: null, initials: [] } });
  const instanceId = draft.instanceId ?? draft.id;
  // the sender keeps the FULL text; everything a signer receives was made from the text without Sender only sections
  // the words stay with the draft, so they can be edited until Send (revise.mjs)
  await tx.query(`UPDATE keystone.document_instance SET source = $2::jsonb, source_facts = $3::jsonb, source_paper = $4, variable_values = $5::jsonb WHERE id = $1`, [instanceId, JSON.stringify(c.source), JSON.stringify(facts ?? {}), paper === "a4" ? "a4" : "letter", variableValues && Object.keys(variableValues).length ? JSON.stringify(variableValues) : null]);
  // Run 9: the sections the sender's answers left out are part of the trail (their headings, never an answer)
  if (c.sectionsLeftOut?.length) await recordAuditEvent(tx, { tenantId, instanceId, kind: "hidden_by_rule", detail: { sections: c.sectionsLeftOut.slice(0, 50).map((h) => String(h).slice(0, 120)) } });
  if (c.senderOnlyBlocks) await tx.query(`UPDATE keystone.document_instance SET sender_view = $2::jsonb WHERE id = $1`, [instanceId, JSON.stringify({ source: c.source, html: c.senderHtml, sectionsHidden: c.senderOnlyBlocks })]);
  let template = null, templateNotKept = null;
  // Run 8 (verify): "also keep it as a template" at the Free cap keeps the DOCUMENT and says the template was not kept — the same rule as keeping one on send (pdfSend.mjs). The cap's refusal is
  // a plain check raised before the template writes anything, so the transaction is still good.
  if (saveAsTemplate) {
    try { template = await saveSourceTemplate(tx, { tenantId, actorUserId, name, source, profile: "typeset", origin: "written", paper, facts, requireSignature }); }
    catch (e) { if (e?.detail?.code !== "plan_template_limit") throw e; templateNotKept = { code: e.detail.code, message: e.message, used: e.detail.used, limit: e.detail.limit, resetsAt: e.detail.resetsAt }; }
  }
  return { instanceId, warnings: [...c.warnings, ...(draft.warnings ?? [])], hash: c.hash, templateId: template?.templateId ?? null, ...(templateNotKept ? { templateNotKept } : {}) };
}

/** Docustay flow v2: what a template starts a document with — the internal note, the signer-facing note, the default message and the default subject, reminders, expiry, language, who plays each role.
 *  Written into the columns the template record already has; nothing new in the table. */
export async function saveTemplateDefaults(tx, { templateId, description = null, clientDescription = null, message = null, sendDefaults = {}, aiRules }) {
  const r = sendOptionsSchema.safeParse(sendDefaults ?? {});
  if (!r.success) throw invalid(`The defaults are not valid: ${r.error.issues[0].path.join(".") || "(root)"} — ${r.error.issues[0].message}`, { field: "sendDefaults" });
  const cap = (v, n) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
  const { rows } = await tx.query(`UPDATE keystone.document_template SET description = $2, client_description = $3, message = $4, send_defaults = $5::jsonb, updated_at = now() WHERE id = $1 AND active RETURNING id`,
    [templateId, cap(description, 2000), cap(clientDescription, 2000), cap(message, 4000), Object.keys(r.data).length ? JSON.stringify(r.data) : null]);
  if (!rows.length) throw notFound("That template was not found, or it has been replaced by a newer version.");
  if (aiRules !== undefined) {   // the rules the assistant follows on THIS template (migration 0673); plain sentences, at most 1500 characters, never able to send, charge or sign
    const text = aiRules == null ? null : String(aiRules).trim();
    if (text && text.length > 1500) throw invalid("The rules can be at most 1500 characters.", { field: "aiRules" });
    await tx.query(`UPDATE keystone.document_template SET ai_rules = $2 WHERE id = $1`, [templateId, text || null]);
  }
  return { templateId };
}

/** A READY-MADE starter as an editable source (the words, tables, lists and tags; print-only layout is reported in `warnings`). */
export function readyMadeSource({ slug }) {
  const s = starter(slug);
  if (!s) throw invalid("There is no ready-made template with that name.", { field: "slug" });
  const r = htmlToSource(s.html);
  const p = parseSource(r.source);
  if (!p.ok) throw invalid(`That template could not be opened for editing: ${p.errors[0]}`, { field: "slug" });
  return { slug: s.slug, title: s.title, summary: s.summary, source: p.source, warnings: r.warnings, seats: starterFields(s).roles, paper: s.paper ?? "letter", ...(s.kind === "form" ? { kind: "form", publish: s.publish } : {}) };
}

/** The workspace's clause library as pieces of a document source, so the writer can drop one in at the cursor: [{id, name, gist, kind, nodes}]. A clause that cannot be shown as source is left out, never half-shown. */
export async function listClauseFragments(tx) {
  const { rows } = await tx.query(`SELECT id, name, gist, kind, body FROM keystone.document_clause WHERE archived_at IS NULL ORDER BY lower(name)`);
  const out = [];
  for (const r of rows) {
    try {
      const sections = (r.body?.sections ?? []).map((sec) => ({ ...sec, requires_signature: false }));
      const src = sectionsToSource(sections); const p = parseSource(src);
      if (!p.ok) continue;
      const nodes = p.source.content.filter((n) => n.type !== "signatureBlock");
      if (nodes.length) out.push({ id: r.id, name: r.name, gist: r.gist, kind: r.kind, nodes });
    } catch { /* not expressible as source: skipped */ }
  }
  return out;
}
