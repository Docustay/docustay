// Run 9 Part 4R (the maintainer, 12 Oct 2026, final) — THE TEMPLATE LIBRARY: the 54 built-in templates (24 Document templates, 30 Form templates) every workspace has beside its own.
//
//   · A built-in is a READ-ONLY MASTER. Its words and boxes are the starter's own (src/documents/starters); its Scribe guidance is the template's own (starters/guidance.mjs).
//   · SEND straight from it: the workspace's copy of the master (a `document_template` row with `builtin_slug`, made the first time it is used — or by the seed job — through the product's own
//     print path) is the template the document is made from. Nothing is copied into the workspace's own templates, so it never counts toward the monthly new-template cap; the document
//     counts toward the month's documents like any send (the send path counts it).
//   · CUSTOMIZE: the workspace's own, editable copy, written in the editor (the words and the boxes). That IS a new template: it passes the cap check and writes the ledger line, as any.
//   · A master is changed only by the library itself, when a starter changes (its fingerprint): a new version of the same family, so a pack that names it follows.
//     The database refuses any other change (migration 0726's trigger); the functions here and the routes refuse first, in words.
import { invalid, notFound, conflict } from "../http/errors.mjs";
import { STARTERS, FORM_STARTERS, starter, starterFields } from "./starters/index.mjs";
import { fingerprint } from "./starters/fingerprint.mjs";
import { guidanceFor, guidanceBrief } from "./starters/guidance.mjs";
import { createTemplateFromSource } from "./templateSources.mjs";
import { createPdfFromTemplate } from "./pdfDocs.mjs";
import { readyMadeSource, saveSourceTemplate } from "./engine/creation.mjs";
import { getDocumentSetting } from "./settings.mjs";

// Docustay v1: the thirty form templates are ordinary templates now (no Forms system), so the whole library is "document" templates.
export const LIBRARY_KINDS = Object.freeze(["document"]);
// (the form templates keep their own guidance, which is filed under use "form")
const all = () => [...STARTERS.map((s) => ({ s, kind: "document", guide: "document" })), ...FORM_STARTERS.map((s) => ({ s, kind: "document", guide: "form" }))];
const shaOf = (s) => fingerprint(s).slice(0, 32);
/** One fingerprint for the whole library: when it changes, every workspace's masters are brought up to date (the seed job). */
export const LIBRARY_VERSION = (() => { let h = 0; for (const { s } of all()) for (const c of shaOf(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h.toString(16).padStart(8, "0"); })();

function entry({ s, kind, guide }) {
  const f = starterFields(s), g = guidanceFor(s.slug, guide);
  return {
    slug: s.slug, kind, title: s.title, summary: s.summary ?? "", use: s.use ?? null,
    seats: f.roles.map((r) => r.role),
    fieldCount: f.fields.length,
    senderFields: f.fields.filter((x) => x.sender).length,
    guidance: guidanceBrief(g), builtin: true, sha: shaOf(s),
  };
}
const find = (slug) => all().find((x) => x.s.slug === String(slug ?? "")) ?? null;
/** The library's own entry for one slug (no workspace data), or null. */
export const libraryEntry = (slug) => { const x = find(slug); return x ? entry(x) : null; };

/** Whether the workspace shows the built-in library (Settings → Templates). Off hides the tabs' built-ins; a master already in use keeps working. */
export const libraryShown = async (tx) => (await getDocumentSetting(tx, "templates.library_shown")) !== false;

/** The built-ins of one kind (or both), each with the id of this workspace's master if it has one yet. */
export async function listLibrary(tx, { kind = null } = {}) {
  if (kind !== null && !LIBRARY_KINDS.includes(kind)) throw invalid("kind is document", { field: "kind" });
  const shown = await libraryShown(tx);
  const { rows } = await tx.query(`SELECT id, builtin_slug, builtin_sha FROM keystone.document_template WHERE builtin_slug IS NOT NULL AND active`);
  const have = new Map(rows.map((r) => [r.builtin_slug, r]));
  const items = shown ? all().filter((x) => !kind || x.kind === kind).map((x) => { const e = entry(x), h = have.get(e.slug); return { ...e, templateId: h?.id ?? null, current: h ? h.builtin_sha === e.sha : null }; }) : [];
  return { templates: items, shown, version: LIBRARY_VERSION };
}

/** One built-in in full: the library entry, its fields (label, type, who fills it) and its guidance (questions, facts, checklist, notes). */
export async function getLibraryTemplate(tx, { slug, use = null }) {
  const x = find(slug); if (!x) throw notFound("There is no built-in template with that name.");
  const e = entry(x), f = starterFields(x.s), g = guidanceFor(x.s.slug, use ?? x.guide);
  const { rows: [h] } = await tx.query(`SELECT id FROM keystone.document_template WHERE builtin_slug = $1 AND active`, [e.slug]);
  return { ...e, templateId: h?.id ?? null, fields: f.fields.map((x2) => ({ label: x2.label, type: x2.type, role: x2.role, required: x2.required, filledBy: x2.sender ? "sender" : "signer" })),
    guidance: g ? { ...g.guidance, ref: g.ref } : null };
}

/**
 * This workspace's master for a built-in: made (printed through the product's own path) the first time, made again as a NEW VERSION of the same family when the starter has changed,
 * left alone otherwise. Idempotent. → templateId.
 */
export async function ensureBuiltin(tx, { tenantId, actorUserId = null, slug }) {
  const x = find(slug); if (!x) throw notFound("There is no built-in template with that name.");
  const sha = shaOf(x.s);
  const { rows: [cur] } = await tx.query(`SELECT id, family_id, version, builtin_sha FROM keystone.document_template WHERE builtin_slug = $1 AND active FOR UPDATE`, [x.s.slug]);
  if (cur && cur.builtin_sha === sha) return cur.id;
  await tx.query(`SELECT set_config('keystone.library_seed', 'on', true)`);
  try {
    if (cur) await tx.query(`UPDATE keystone.document_template SET active = false, retired_at = now() WHERE id = $1`, [cur.id]);
    const made = await createTemplateFromSource(tx, { tenantId, actorUserId, name: x.s.title, source: { html: x.s.html }, paper: x.s.paper, typeset: { ref: `Form: ${x.s.slug}`, initials: x.s.initials ?? [] },
      kind: x.kind, how: "builtin", builtin: { slug: x.s.slug, sha, name: cur ? null : x.s.title } });
    if (cur) await tx.query(`UPDATE keystone.document_template SET family_id = $2, version = $3, previous_version_id = $4, name = (SELECT name FROM keystone.document_template WHERE id = $4) WHERE id = $1`, [made.templateId, cur.family_id, cur.version + 1, cur.id]);
    return made.templateId;
  } finally { await tx.query(`SELECT set_config('keystone.library_seed', '', true)`).catch(() => {}); }   // never let this reset hide the error that aborted the transaction (it would read "current transaction is aborted" and bury the cause)
}

/**
 * SEND FROM A BUILT-IN: a Document template gives a new draft made from the workspace's master (no copy of the template); it counts toward the month's documents when it is sent, like any
 * document.
 */
export async function useBuiltin(tx, { tenantId, actorUserId = null, slug, title = null, test = false }) {
  const x = find(slug); if (!x) throw notFound("There is no built-in template with that name.");
  if (!(await libraryShown(tx))) throw conflict("This workspace has hidden the built-in templates (Settings → Templates).", { code: "library_hidden" });
  const templateId = await ensureBuiltin(tx, { tenantId, actorUserId, slug });
  const made = await createPdfFromTemplate(tx, { tenantId, templateId, actorUserId, title });
  // R13-D372: a test key's draft is a test document (as in pdfApiV2), or the same key could not send it: /documents/{id}/send answered 404
  if (test) await tx.query(`UPDATE keystone.document_instance SET is_test = true WHERE id = $1`, [made.instanceId]);
  return { ...made, templateId, builtin: slug, kind: "document" };
}

/** CUSTOMIZE: the workspace's own editable copy (the editor's source: words and boxes). A new template — the cap is checked and the ledger written, as for any new template. */
export async function customizeBuiltin(tx, { tenantId, actorUserId = null, slug, name = null }) {
  const x = find(slug); if (!x) throw notFound("There is no built-in template with that name.");
  if (!(await libraryShown(tx))) throw conflict("This workspace has hidden the built-in templates (Settings → Templates).", { code: "library_hidden" });
  const r = readyMadeSource({ slug: x.s.slug });
  const made = await saveSourceTemplate(tx, { tenantId, actorUserId, name: String(name ?? "").trim() || x.s.title, source: r.source, origin: "readymade", paper: r.paper, kind: x.kind });
  return { templateId: made.templateId, from: x.s.slug, kind: x.kind, fields: made.fields ?? null, warnings: made.warnings ?? [] };
}

/** The seed job's work for one workspace (install and upgrade): every master brought to the library's current version. Idempotent; a master already current is untouched. */
export async function seedLibrary(tx, { tenantId, actorUserId = null, onlyExisting = false }) {
  const { rows } = await tx.query(`SELECT builtin_slug, builtin_sha FROM keystone.document_template WHERE builtin_slug IS NOT NULL AND active`);
  const have = new Map(rows.map((r) => [r.builtin_slug, r.builtin_sha]));
  let made = 0, kept = 0;
  for (const x of all()) {
    if (onlyExisting && !have.has(x.s.slug)) continue;
    if (have.get(x.s.slug) === shaOf(x.s)) { kept += 1; continue; }
    await ensureBuiltin(tx, { tenantId, actorUserId, slug: x.s.slug }); made += 1;
  }
  return { made, kept, version: LIBRARY_VERSION };
}

/** The refusal every change path gives a built-in (the screen's words; the database refuses too). */
export const BUILTIN_READONLY = "A built-in template cannot be changed. Customize it to make your own copy.";
export async function assertNotBuiltin(tx, templateId) {
  const { rows: [t] } = await tx.query(`SELECT builtin_slug FROM keystone.document_template WHERE id = $1`, [templateId]);
  if (t?.builtin_slug) throw conflict(BUILTIN_READONLY, { code: "builtin_readonly" });
}
export { starter as libraryStarter };
