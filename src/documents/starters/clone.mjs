// Clones a starter into a workspace as a real template (Part 31 item 4): the HTML is printed to a PDF by the host's converter, each text tag becomes a placed field, and the result is an ordinary template the person can open, edit, use and send.
import { createTemplateFromSource } from "../templateSources.mjs";
import { invalid } from "../../http/errors.mjs";
import { starter, starterFields } from "./index.mjs";

export async function createTemplateFromStarter(tx, { tenantId, actorUserId = null, slug, name = null }) {
  const s = starter(slug);
  if (!s) throw invalid("There is no starter template with that name.", { field: "slug" });
  // The same starter used twice gives the same template, not a pile of copies: a copy this workspace already has, still active and never edited (an edit makes a new version and retires the first), is reused.
  const { rows: [have] } = await tx.query(`SELECT id, name FROM keystone.document_template WHERE builder = 'pdf' AND starter_key = $1 AND version = 1 AND active`, [s.slug]);
  if (have && !(name ?? "").trim()) return { templateId: have.id, starter: s.slug, title: s.title, seats: starterFields(s).roles, fields: null, warnings: [], reused: true, name: have.name };
  const r = await createTemplateFromSource(tx, { tenantId, actorUserId, name: (name ?? "").trim() || s.title, source: { html: s.html }, paper: s.paper, typeset: { ref: `Form: ${s.slug}`, initials: s.initials ?? [] }, kind: s.kind === "form" ? "form" : "document", how: "ready_made" });
  // the first copy in a workspace carries the starter's key (the column is unique per workspace and version); later copies are plain templates named "… (2)"
  if (s.kind === "form") await tx.query(`UPDATE keystone.document_template SET kind = 'form', collects_many = true WHERE id = $1`, [r.templateId]);
  await tx.query(`UPDATE keystone.document_template SET starter_key = $2 WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM keystone.document_template o WHERE o.starter_key = $2 AND o.version = 1)`, [r.templateId, s.slug]);
  return { templateId: r.templateId, starter: s.slug, title: s.title, seats: starterFields(s).roles, fields: r.fields, warnings: r.warnings, reused: false };
}
/** What a picker or a page shows about each starter: no workspace data, the same for everyone. */
export const starterCatalogue = async ({ kind = "document" } = {}) => { const { STARTERS, FORM_STARTERS } = await import("./index.mjs"); return (kind === "form" ? FORM_STARTERS : STARTERS).map((s) => { const f = starterFields(s); return { slug: s.slug, title: s.title, summary: s.summary, use: s.use, seats: f.roles, fieldCount: s.kind === "form" ? f.fields.filter((x) => x.role === f.roles[0]?.role).length : f.fields.length, ...(s.kind === "form" ? { counterFields: f.fields.filter((x) => x.role !== f.roles[0]?.role).length } : {}), ...(s.kind === "form" ? { kind: "form", who: s.who, purpose: s.purpose, publish: s.publish, counterSign: f.roles.length > 1 } : {}) }; }); };
