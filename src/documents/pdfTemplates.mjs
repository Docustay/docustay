// src/documents/pdfTemplates.mjs — MANAGING UPLOADED-DOCUMENT TEMPLATES (QUEUE §23.5.5): find them (search, folder, tag), clone one, change its fields as a NEW VERSION with a note and a diff against the one before, and — when the
// practice asks for it — approve a template or version before anyone can send it. A version is a NEW ROW; the old one stays as it was (the rule every builder here keeps). Nothing in this file sends anything.
import { assertNotBuiltin } from "./library.mjs";
import { randomUUID } from "node:crypto";
import { invalid, notFound, conflict } from "../http/errors.mjs";
import { ports } from "./ports.mjs";
import { parsePdfBodyData } from "./pdfBody.mjs";
import { readFileBytes, sha256Hex } from "./files.mjs";
import { getDocumentSetting } from "./settings.mjs";
import { assertTemplateVisible } from "./teams.mjs";
import { recordAuditEvent } from "./auditTrail.mjs";
import { sendOptionsSchema } from "./pdfDocs.mjs";
import { beforeNewTemplate, afterNewTemplate } from "./templateCap.mjs";

const TAG = /^[\p{L}\p{N}][\p{L}\p{N} _.-]{0,29}$/u;
const cleanTags = (tags) => {
  const out = [...new Set((tags ?? []).map((t) => String(t).trim().toLowerCase()).filter(Boolean))];
  if (out.length > 20) throw invalid("A template can have at most 20 tags.", { field: "tags" });
  const bad = out.find((t) => !TAG.test(t));
  if (bad) throw invalid(`“${bad}” cannot be a tag — use letters, numbers, spaces, dashes (up to 30 characters).`, { field: "tags" });
  return out;
};
const cleanFolder = (f) => { if (f == null || String(f).trim() === "") return null; const v = String(f).trim(); if (v.length > 60) throw invalid("A folder name can be at most 60 characters.", { field: "folder" }); return v; };
const cleanName = (n) => { const v = String(n ?? "").trim(); if (!v) throw invalid("The template needs a name.", { field: "name" }); if (v.length > 200) throw invalid("That name is too long.", { field: "name" }); return v; };

/** A name nobody else is using for an uploaded template (the (tenant, builder, name, version) key is unique): "Waiver", "Waiver (2)", "Waiver (3)" … */
export async function uniqueTemplateName(tx, base) {
  const { rows } = await tx.query(`SELECT lower(name) AS n FROM keystone.document_template WHERE builder = 'pdf'`);
  const taken = new Set(rows.map((r) => r.n));
  const root = String(base).trim().slice(0, 190) || "Template";
  if (!taken.has(root.toLowerCase())) return root;
  for (let k = 2; k < 1000; k += 1) if (!taken.has(`${root} (${k})`.toLowerCase())) return `${root} (${k})`;
  return `${root} (${randomUUID().slice(0, 6)})`;
}

/** What a newly made template or version starts as: `pending` when the practice wants approval first, else `approved`. */
// Run 9 Part 4R (the maintainer): MEMBERS need an owner's approval for their own templates; whoever may approve (an owner or admin, in the host's roles) never waits for themselves, and a template
// made with no person (an API key acts as the owner) is approved. The switch is Settings → Templates; with it off, nothing waits.
export async function startingApproval(tx, actorUserId = null) {
  if ((await getDocumentSetting(tx, "upload.template_approval")) !== true) return "approved";
  if (!actorUserId) return "approved";
  try { await (await ports()).access.assertMay(tx, { appUserId: actorUserId }, { object: "document", action: "delete" }, null); return "approved"; }
  catch (e) { if (e?.kind === "forbidden") return "pending"; throw e; }
}

/** Why a template cannot be a form, or null. A form has one person who fills it (plus, optionally, one staff counter-signer) and is the current approved version. */
function formReasonOf(r) {
  if (!r.active) return "retired";
  if (r.approval_status !== "approved") return "not_approved";
  if (Number(r.seats) === 0) return "no_signer";
  if (Number(r.seats) > 2) return "too_many_people";
  return null;
}

export async function listPdfTemplates(tx, { q = "", folder = null, tag = null, showRetired = false, kind = null } = {}) {
  const { rows } = await tx.query(
    `SELECT t.id, t.family_id, t.kind, t.name, t.version, t.active, t.folder, t.tags, t.approval_status, t.approval_note, t.change_note, t.self_serve_enabled, t.self_serve_slug, t.updated_at,
            (t.body -> 'file' ->> 'page_count')::int AS pages, jsonb_array_length(t.body -> 'roles') AS seats, jsonb_array_length(t.body -> 'fields') AS fields,
            (SELECT count(*)::int FROM keystone.document_template v WHERE v.family_id = t.family_id) AS versions,
            (t.source IS NOT NULL) AS editable
       FROM keystone.document_template t
      WHERE t.builder = 'pdf' AND (t.active OR $1::boolean OR t.approval_status = 'pending') AND t.builtin_slug IS NULL   -- Run 9 Part 4R: the workspace's own; the built-ins are the library (library.mjs)
        AND keystone.document_team_visible(nullif(current_setting('keystone.user_id', true), '')::uuid, t.team_id, NULL)
        AND ($2::text = '' OR t.name ILIKE '%' || $2 || '%' OR coalesce(t.folder, '') ILIKE '%' || $2 || '%' OR array_to_string(t.tags, ' ') ILIKE '%' || $2 || '%')
        AND ($3::text IS NULL OR t.folder = $3) AND ($4::text IS NULL OR $4 = ANY (t.tags)) AND ($5::text IS NULL OR t.kind = $5)
      ORDER BY lower(t.name), t.version DESC`, [showRetired, String(q ?? "").trim().slice(0, 100), folder || null, tag ? String(tag).toLowerCase() : null, kind === "form" || kind === "document" ? kind : null]);
  const { rows: facets } = await tx.query(`SELECT folder, tags FROM keystone.document_template WHERE builder = 'pdf' AND active AND builtin_slug IS NULL`);
  return {
    // ★ Run 7: each document template says whether it can become a form, and if not, why (the Forms page used to hide it without a word)
    templates: rows.map((r) => ({ ...r, formReason: formReasonOf(r) })),
    folders: [...new Set(facets.map((r) => r.folder).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    tags: [...new Set(facets.flatMap((r) => r.tags))].sort(),
    approvalRequired: (await getDocumentSetting(tx, "upload.template_approval")) === true,
  };
}

export async function getPdfTemplate(tx, { templateId }) {
  const { rows: [t] } = await tx.query(
    `SELECT id, family_id, kind, name, version, active, body, send_defaults, folder, tags, approval_status, approval_note, approved_at, change_note, previous_version_id, self_serve_enabled, self_serve_slug, ai_rules, collects_many, form_settings, created_at, updated_at
       FROM keystone.document_template WHERE id = $1 AND builder = 'pdf'`, [templateId]);
  if (!t) throw notFound("no such uploaded-document template");
  await assertTemplateVisible(tx, templateId);
  const { rows: versions } = await tx.query(
    `SELECT id, version, active, approval_status, change_note, created_at FROM keystone.document_template WHERE family_id = $1 ORDER BY version DESC`, [t.family_id]);   // ★ Run 7: by family, not name
  return { ...t, body: parsePdfBodyData(t.body), versions, approvalRequired: (await getDocumentSetting(tx, "upload.template_approval")) === true };
}

/** The template's own pages (hash-checked), for the editor. */
export async function readTemplateFile(tx, { templateId }) {
  const { rows: [t] } = await tx.query(`SELECT body FROM keystone.document_template WHERE id = $1 AND builder = 'pdf'`, [templateId]);
  if (!t) throw notFound("no such uploaded-document template");
  const { bytes, row } = await readFileBytes(tx, { fileId: parsePdfBodyData(t.body).file.file_id });
  return { bytes, name: row.name };
}

/** Name, folder, tags, remembered send choices and the self-serve link — the things that do NOT change what is signed, so they do not make a new version. */
export async function updatePdfTemplateMeta(tx, { tenantId, templateId, name, folder, tags, sendDefaults, selfServe, aiRules }) {
  await assertNotBuiltin(tx, templateId);   // Run 9 Part 4R: a built-in is a read-only master (the database refuses too)
  const { rows: [t] } = await tx.query(`SELECT id, family_id, name, active FROM keystone.document_template WHERE id = $1 AND builder = 'pdf'`, [templateId]);
  if (!t) throw notFound("no such uploaded-document template");
  const sameName = `family_id = $1`;   // ★ Run 7: every version of THIS template (its family), never "every template with this name"
  if (name !== undefined) {
    const next = cleanName(name);
    if (next.toLowerCase() !== t.name.toLowerCase()) {
      const { rows: [clash] } = await tx.query(`SELECT 1 FROM keystone.document_template WHERE builder = 'pdf' AND lower(name) = lower($1) AND family_id <> $2`, [next, t.family_id]);
      if (clash) throw conflict(`There is already an uploaded template called “${next}”.`, { field: "name" });
      await tx.query(`UPDATE keystone.document_template SET name = $2 WHERE ${sameName}`, [t.family_id, next]);     // every version keeps the same name
    }
  }
  const now = { name: t.family_id };   // the family id is what the updates below key on
  if (folder !== undefined) await tx.query(`UPDATE keystone.document_template SET folder = $2 WHERE ${sameName}`, [now.name, cleanFolder(folder)]);
  if (tags !== undefined) await tx.query(`UPDATE keystone.document_template SET tags = $2::text[] WHERE ${sameName}`, [now.name, cleanTags(tags)]);
  if (aiRules !== undefined) {
    const text = aiRules == null ? null : String(aiRules).trim();
    if (text && text.length > 1500) throw invalid("The rules can be at most 1500 characters.", { field: "aiRules" });
    await tx.query(`UPDATE keystone.document_template SET ai_rules = $2 WHERE ${sameName}`, [now.name, text || null]);   // every version keeps the same rules
  }
  if (sendDefaults !== undefined) {
    let clean = null;
    if (sendDefaults !== null) {
      const parsed = sendOptionsSchema.partial().safeParse(sendDefaults);
      if (!parsed.success) throw invalid(`send defaults: ${parsed.error.issues[0].path.join(".") || "(root)"} — ${parsed.error.issues[0].message}`, { field: "sendDefaults" });
      const { access_code, access_code_hash, access_code_set, in_person, send_at, attachments, save_as_template, kiosk, ...rest } = parsed.data;
      if (rest.verification === "access_code") delete rest.verification;
      clean = Object.keys(rest).length ? rest : null;
    }
    await tx.query(`UPDATE keystone.document_template SET send_defaults = $2::jsonb WHERE id = $1`, [templateId, clean ? JSON.stringify(clean) : null]);
  }
  if (selfServe !== undefined) {
    const enabled = selfServe?.enabled === true;
    let slug = selfServe?.slug == null || selfServe.slug === "" ? null : String(selfServe.slug).trim().toLowerCase();
    if (enabled && !slug) throw invalid("Choose a short name for the link (letters, numbers, dashes).", { field: "slug" });
    if (enabled) {
      const { rows: [cur] } = await tx.query(`SELECT body, active, approval_status FROM keystone.document_template WHERE id = $1`, [templateId]);
      if (!cur.active || cur.approval_status !== "approved") throw conflict("Only the current, approved version of a template can have a public link.", { field: "enabled" });
      if (parsePdfBodyData(cur.body).roles.length !== 1) throw invalid("A public link needs a template with exactly one person signing.", { field: "enabled", code: "one_seat" });
    }
    if (slug && !/^[a-z0-9][a-z0-9-]{2,58}[a-z0-9]$/.test(slug)) throw invalid("The link name must be 4–60 characters: letters, numbers and dashes.", { field: "slug" });
    if (slug) {
      const { rows: [clash] } = await tx.query(`SELECT 1 FROM keystone.document_template WHERE lower(self_serve_slug) = $1 AND family_id <> $2`, [slug, t.family_id]);
      if (clash) throw conflict("That link name is already used by another template.", { field: "slug" });
    }
    await tx.query(`UPDATE keystone.document_template SET self_serve_enabled = false, self_serve_slug = NULL WHERE ${sameName} AND id <> $2`, [now.name, templateId]);   // only the current version carries the link
    await tx.query(`UPDATE keystone.document_template SET self_serve_enabled = $2, self_serve_slug = $3 WHERE id = $1`, [templateId, enabled, slug]);
  }
  return getPdfTemplate(tx, { templateId });
}

/** Change the roles and fields: a NEW version (the page file cannot change). It carries the folder, tags, remembered choices and link forward. With approval on it waits, inactive, until approved; otherwise it becomes current at once and the old one is retired. */
export async function newPdfTemplateVersion(tx, { tenantId, templateId, body, changeNote = null, actorUserId = null }) {
  await assertNotBuiltin(tx, templateId);   // Run 9 Part 4R: a built-in is a read-only master (the database refuses too)
  const { rows: [t] } = await tx.query(`SELECT * FROM keystone.document_template WHERE id = $1 AND builder = 'pdf'`, [templateId]);
  if (!t) throw notFound("no such uploaded-document template");
  if (!t.active) throw conflict("Only the current version of a template can be changed — open the current one.");
  const { rows: [pending] } = await tx.query(`SELECT version FROM keystone.document_template WHERE family_id = $1 AND approval_status = 'pending' AND NOT active`, [t.family_id]);
  if (pending) throw conflict(`Version ${pending.version} is waiting for approval — approve or reject it before making another.`, { code: "pending_version" });
  const old = parsePdfBodyData(t.body);
  let next;
  try { next = parsePdfBodyData({ ...body, suggestions: undefined }); } catch (e) { throw invalid(e.message, { field: "body" }); }
  delete next.suggestions; delete next.detect;
  if (next.file.file_id !== old.file.file_id || next.file.sha256 !== old.file.sha256) throw invalid("The pages of a template cannot be replaced — upload the new file and save it as a new template.", { field: "body.file" });
  const note = changeNote == null ? null : String(changeNote).trim().slice(0, 300) || null;
  if (JSON.stringify(diffBodies(old, next)) === "[]") throw invalid("Nothing has changed.", { code: "no_change" });
  const approval = await startingApproval(tx, actorUserId);
  const id = randomUUID();
  const { rows: [{ max }] } = await tx.query(`SELECT max(version)::int AS max FROM keystone.document_template WHERE family_id = $1`, [t.family_id]);
  const goLive = approval === "approved";
  await tx.query(
    `INSERT INTO keystone.document_template (id, tenant_id, builder, name, version, active, body, type_id, send_defaults, folder, tags, approval_status, change_note, previous_version_id, self_serve_enabled, self_serve_slug, published_at, ai_rules, collects_many, form_settings)
     VALUES ($1,$2,'pdf',$3,$4,false,$5::jsonb,$6,$7::jsonb,$8,$9::text[],$10,$11,$12,false,NULL,CASE WHEN $13 THEN now() ELSE NULL END,(SELECT ai_rules FROM keystone.document_template WHERE id = $12),(SELECT collects_many FROM keystone.document_template WHERE id = $12),(SELECT form_settings FROM keystone.document_template WHERE id = $12))`,   // ★ Run 7: a form stays a form (its kind and family come from the trigger, its settings from here)
    [id, tenantId, t.name, max + 1, JSON.stringify(next), t.type_id, t.send_defaults ? JSON.stringify(t.send_defaults) : null, t.folder, t.tags, approval, note, t.id, goLive]);
  if (goLive) await activateVersion(tx, { newId: id, oldId: t.id });
  return { templateId: id, version: max + 1, active: goLive, approvalStatus: approval };
}

async function activateVersion(tx, { newId, oldId }) {
  const { rows: [old] } = await tx.query(`SELECT self_serve_enabled, self_serve_slug FROM keystone.document_template WHERE id = $1`, [oldId]);
  await tx.query(`UPDATE keystone.document_template SET active = false, retired_at = now(), self_serve_enabled = false, self_serve_slug = NULL WHERE id = $1`, [oldId]);
  await tx.query(`UPDATE keystone.document_template SET active = true, retired_at = NULL, self_serve_enabled = $2, self_serve_slug = $3 WHERE id = $1`, [newId, old?.self_serve_enabled === true, old?.self_serve_slug ?? null]);
}

// ── the diff between two versions ───────────────────────────────────────────────────────────────────────────
const FIELD_PROPS = ["type", "role", "page", "x", "y", "w", "h", "required", "label", "options", "default", "validation", "max_length", "autofill", "editable", "placeholder", "tooltip", "locked", "sender", "repeat"];
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const near = (a, b) => (typeof a === "number" && typeof b === "number" ? Math.abs(a - b) < 0.0005 : same(a, b));
const nameOf = (f) => f.label || f.type.replace("_", " ");

/** Pure: what changed from `a` to `b`, as a flat list of { kind, ... }. Fields are matched by id; a field that moved or resized is "changed", not removed and added. */
function diffBodies(a, b) {
  const out = [];
  const roleLabel = (body) => Object.fromEntries(body.roles.map((r) => [r.key, r.label]));
  const ra = roleLabel(a), rb = roleLabel(b);
  for (const k of Object.keys(rb)) if (!(k in ra)) out.push({ kind: "seat_added", seat: k, label: rb[k] });
  for (const k of Object.keys(ra)) if (!(k in rb)) out.push({ kind: "seat_removed", seat: k, label: ra[k] });
  for (const k of Object.keys(rb)) if (k in ra && ra[k] !== rb[k]) out.push({ kind: "seat_renamed", seat: k, from: ra[k], to: rb[k] });
  const fa = new Map(a.fields.map((f) => [f.id, f])), fb = new Map(b.fields.map((f) => [f.id, f]));
  for (const [id, f] of fb) if (!fa.has(id)) out.push({ kind: "field_added", id, field: nameOf(f), seat: f.role, page: f.page });
  for (const [id, f] of fa) if (!fb.has(id)) out.push({ kind: "field_removed", id, field: nameOf(f), seat: f.role, page: f.page });
  for (const [id, f] of fb) {
    const o = fa.get(id); if (!o) continue;
    const changes = FIELD_PROPS.filter((p) => !near(o[p], f[p])).map((p) => ({ prop: p, from: o[p] ?? null, to: f[p] ?? null }));
    if (changes.length) out.push({ kind: "field_changed", id, field: nameOf(f), seat: f.role, page: f.page, changes });
  }
  return out;
}

/** The diff as plain sentences (what the screen shows). */
function describeDiff(items) {
  const place = (i) => `${i.field} on page ${i.page}`;
  const label = { type: "type", role: "person", page: "page", x: "position", y: "position", w: "size", h: "size", required: "required", label: "label", options: "choices", default: "prefilled value", validation: "check", max_length: "length limit", locked: "locked answer", sender: "filled in by", repeat: "repeat" };
  return items.map((i) => {
    switch (i.kind) {
      case "seat_added": return `Added a person to sign: ${i.label}`;
      case "seat_removed": return `Removed a person to sign: ${i.label}`;
      case "seat_renamed": return `Renamed ${i.from} to ${i.to}`;
      case "field_added": return `Added ${place(i)}`;
      case "field_removed": return `Removed ${place(i)}`;
      case "field_changed": return `Changed ${place(i)}: ${[...new Set(i.changes.map((c) => label[c.prop] ?? c.prop))].join(", ")}`;
      default: return i.kind;
    }
  });
}

export async function diffPdfTemplates(tx, { templateId, againstId = null }) {
  const { rows: [t] } = await tx.query(`SELECT id, version, body, previous_version_id FROM keystone.document_template WHERE id = $1 AND builder = 'pdf'`, [templateId]);
  if (!t) throw notFound("no such uploaded-document template");
  const otherId = againstId ?? t.previous_version_id;
  if (!otherId) return { from: null, to: { id: t.id, version: t.version }, items: [], lines: ["This is the first version."] };
  const { rows: [o] } = await tx.query(`SELECT id, version, body FROM keystone.document_template WHERE id = $1 AND builder = 'pdf'`, [otherId]);
  if (!o) throw notFound("no such version to compare with");
  const items = diffBodies(parsePdfBodyData(o.body), parsePdfBodyData(t.body));
  return { from: { id: o.id, version: o.version }, to: { id: t.id, version: t.version }, items, lines: items.length ? describeDiff(items) : ["No difference in the people or fields."] };
}

/** A copy: its own pages (so removing the original never touches it), version 1, a fresh name, the same people-seats, fields, folder, tags and remembered choices — never the self-serve link. */
export async function clonePdfTemplate(tx, { tenantId, templateId, name = null, actorUserId = null }) {
  const { rows: [t] } = await tx.query(`SELECT * FROM keystone.document_template WHERE id = $1 AND builder = 'pdf'`, [templateId]);
  if (!t) throw notFound("no such uploaded-document template");
  await beforeNewTemplate(tx, { tenantId });   // Run 8: a duplicate is a new template (Free: 5 a month); checked before anything is stored
  const body = parsePdfBodyData(t.body);
  const P = await ports();
  const { bytes, row } = await readFileBytes(tx, { fileId: body.file.file_id });
  const id = randomUUID(), fileId = randomUUID();
  const stored = await P.files.put({ tenantId, id: fileId, bytes, contentType: "application/pdf" });
  const finalName = name ? await uniqueTemplateName(tx, cleanName(name)) : await uniqueTemplateName(tx, `${t.name} (copy)`);
  const approval = await startingApproval(tx, actorUserId);
  await tx.query(
    `INSERT INTO keystone.document_template (id, tenant_id, builder, name, version, active, body, type_id, send_defaults, folder, tags, approval_status, change_note, kind, collects_many)
     VALUES ($1,$2,'pdf',$3,1,true,$4::jsonb,$5,$6::jsonb,$7,$8::text[],$9,$10,$11,$11 = 'form')`,
    [id, tenantId, finalName, JSON.stringify({ ...body, file: { ...body.file, file_id: fileId } }), t.type_id, t.send_defaults ? JSON.stringify(t.send_defaults) : null, t.folder, t.tags, approval, `Copy of ${t.name} (version ${t.version})`, t.kind === "form" ? "form" : "document"]);   // Run 8: a copy of a FORM template is a form template (it used to come out as a document template)
  await tx.query(
    `INSERT INTO keystone.document_file (id, tenant_id, template_id, kind, name, mime, byte_size, sha256, storage_key, page_count, pages, meta) VALUES ($1,$2,$3,'original',$4,'application/pdf',$5,$6,$7,$8,$9::jsonb,'{}'::jsonb)`,
    [fileId, tenantId, id, row.name, bytes.length, sha256Hex(bytes), stored.key, body.file.page_count, JSON.stringify(body.file.pages)]);
  await afterNewTemplate(tx, { tenantId, templateId: id, kind: t.kind, how: "duplicate", actorUserId });
  return { templateId: id, name: finalName, approvalStatus: approval };
}

export async function approvePdfTemplate(tx, { templateId, actorUserId = null }) {
  const { rows: [t] } = await tx.query(`SELECT id, name, active, approval_status, previous_version_id FROM keystone.document_template WHERE id = $1 AND builder = 'pdf'`, [templateId]);
  if (!t) throw notFound("no such uploaded-document template");
  if (t.approval_status === "approved") return { approved: true, already: true };
  if (t.approval_status !== "pending") throw conflict("Only a template that is waiting for approval can be approved.");
  await tx.query(`UPDATE keystone.document_template SET approval_status = 'approved', approved_by = $2, approved_at = now(), approval_note = NULL WHERE id = $1`, [t.id, actorUserId]);
  if (t.previous_version_id && !t.active) await activateVersion(tx, { newId: t.id, oldId: t.previous_version_id });
  else if (!t.active && !t.previous_version_id) await tx.query(`UPDATE keystone.document_template SET active = true, retired_at = NULL WHERE id = $1`, [t.id]);
  return { approved: true };
}

export async function rejectPdfTemplate(tx, { templateId, reason, actorUserId = null }) {
  const { rows: [t] } = await tx.query(`SELECT id, approval_status FROM keystone.document_template WHERE id = $1 AND builder = 'pdf'`, [templateId]);
  if (!t) throw notFound("no such uploaded-document template");
  if (t.approval_status !== "pending") throw conflict("Only a template that is waiting for approval can be rejected.");
  const note = String(reason ?? "").trim();
  if (!note) throw invalid("Say why, so the author knows what to change.", { field: "reason" });
  await tx.query(`UPDATE keystone.document_template SET approval_status = 'rejected', approved_by = $2, approved_at = now(), approval_note = $3 WHERE id = $1`, [t.id, actorUserId, note.slice(0, 500)]);
  return { rejected: true };
}

/** Take a template out of use (its documents are untouched). */
export async function retirePdfTemplate(tx, { templateId }) {
  await assertNotBuiltin(tx, templateId);   // Run 9 Part 4R: a built-in is a read-only master (the database refuses too)
  const { rows: [t] } = await tx.query(`SELECT id, active FROM keystone.document_template WHERE id = $1 AND builder = 'pdf'`, [templateId]);
  if (!t) throw notFound("no such uploaded-document template");
  await tx.query(`UPDATE keystone.document_template SET active = false, retired_at = coalesce(retired_at, now()), self_serve_enabled = false WHERE id = $1`, [templateId]);
  return { retired: true };
}

/** Is this template one a document may be made from right now? (shared by new-from-template, kiosk, bulk and the self-serve link) */
export function assertUsable(t) {
  if (!t || t.builder !== "pdf") throw notFound("no such uploaded-document template");
  if (!t.active) throw conflict(`“${t.name}” is a retired version of this template`);
  if (t.approval_status !== "approved") throw conflict(t.approval_status === "pending" ? `“${t.name}” is waiting for approval before it can be sent.` : `“${t.name}” was not approved.`, { code: "not_approved" });
}
