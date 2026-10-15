// PLAYS AND PLAYBOOKS, the workspace side (FINAL PUSH Stage 4). Built-ins come from builtin.mjs (memory); a workspace's own plays and playbooks are rows. Making, changing, publishing and bundling the workspace's own is PRO
// (custom_plays), asked of the host through the entitlements port; USING a play (built-in or the workspace's published one) is not.
import { invalid, notFound, conflict } from "../../http/errors.mjs";
import { ports } from "../ports.mjs";
import { parsePlay, brief, exportPlayZip, importPlayZip } from "./play.mjs";
import { builtinPlays, builtinPlay, builtinBriefs } from "./builtin.mjs";

const needPro = async (tx, tenantId) => (await ports()).entitlements?.assertEntitled?.(tx, { tenantId, item: "custom_plays" });
export const isPro = async (tx, tenantId, item = "custom_plays") => { const P = await ports(); return P.entitlements?.isEntitled ? Boolean(await P.entitlements.isEntitled(tx, { tenantId, item })) : true; };

/** Everything usable now: the built-ins, then the workspace's published plays. Briefs only (name and description), as the picker needs. `on` is the workspace's switch (Plays page; a skill that is off is not offered to Scribe). */
export async function listPlays(tx, { includeArchived = false } = {}) {
  const { rows } = await tx.query(`SELECT p.id, p.name, p.kind, p.category, p.title, p.description, p.current_version, p.archived, p.updated_at FROM keystone.document_play p ${includeArchived ? "" : "WHERE NOT p.archived"} ORDER BY p.title`);
  const off = await playsOff(tx);
  return [...builtinBriefs(), ...rows.map((r) => ({ id: r.id, name: r.name, title: r.title, description: r.description, kind: r.kind, category: r.category, builtin: false, published: r.current_version > 0, version: r.current_version, ref: r.current_version > 0 ? `ws:${r.id}@${r.current_version}` : null, archived: r.archived, updatedAt: r.updated_at }))]
    .map((p) => ({ ...p, on: !off.has(p.name) }));
}
// Run 9 Part 4R: a skill (built-in or the workspace's own) can be switched off for the workspace. Using and switching is every plan's; MAKING a skill is Pro.
const playsOff = async (tx) => new Set(((await (await import("../settings.mjs")).getDocumentSetting(tx, "plays.off")) ?? []).map(String));
export async function setPlayOn(tx, { tenantId, name, on }) {
  const n = String(name ?? ""); if (!builtinPlay(n) && !(await tx.query(`SELECT 1 FROM keystone.document_play WHERE name = $1`, [n])).rowCount) throw notFound("That skill was not found.");
  const off = await playsOff(tx); if (on) off.delete(n); else off.add(n);
  await (await import("../settings.mjs")).setDocumentSetting(tx, { tenantId, key: "plays.off", value: [...off].sort() });
  return { name: n, on: on === true };
}

/** One play by name: { play, ref, builtin, source? }. A workspace play must be published to be used (`draft:true` reads its newest unpublished version for the builder). */
export async function getPlay(tx, { name, draft = false }) {
  const b = builtinPlay(name); if (b) return { play: b.play, ref: b.ref, builtin: true, hash: b.hash };
  const { rows: [r] } = await tx.query(`SELECT id, name, current_version, archived FROM keystone.document_play WHERE name = $1`, [String(name ?? "")]);
  if (!r || (r.archived && !draft)) return null;
  const v = draft ? (await tx.query(`SELECT version, source, hash FROM keystone.document_play_version WHERE play_id = $1 ORDER BY version DESC LIMIT 1`, [r.id])).rows[0]
    : r.current_version > 0 ? (await tx.query(`SELECT version, source, hash FROM keystone.document_play_version WHERE play_id = $1 AND version = $2`, [r.id, r.current_version])).rows[0] : null;
  if (!v) return null;
  const parsed = parsePlay(v.source); if (!parsed.ok) return null;
  return { play: parsed.play, ref: `ws:${r.id}@${v.version}`, builtin: false, id: r.id, version: v.version, published: v.version === r.current_version && r.current_version > 0, source: v.source, hash: v.hash };
}

/** Save the words as a NEW immutable version (creating the play the first time). Not published until publishPlay. */
export async function savePlay(tx, { tenantId, actorUserId = null, source }) {
  await needPro(tx, tenantId);
  const r = parsePlay(source); if (!r.ok) throw invalid(r.errors[0], { field: "source", errors: r.errors });
  const p = r.play;
  if (builtinPlays().has(p.name)) throw conflict("That name belongs to a built-in play. Duplicate it under a new name instead.", { code: "name_taken" });
  let { rows: [row] } = await tx.query(`SELECT id FROM keystone.document_play WHERE name = $1`, [p.name]);
  if (!row) ({ rows: [row] } = await tx.query(`INSERT INTO keystone.document_play (tenant_id, name, kind, category, title, description, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [tenantId, p.name, p.kind, p.category, p.title, p.description, actorUserId]));
  else await tx.query(`UPDATE keystone.document_play SET kind=$2, category=$3, title=$4, description=$5, archived=false, updated_at=now() WHERE id=$1`, [row.id, p.kind, p.category, p.title, p.description]);
  const { rows: [{ v }] } = await tx.query(`SELECT coalesce(max(version),0)+1 AS v FROM keystone.document_play_version WHERE play_id = $1`, [row.id]);
  await tx.query(`INSERT INTO keystone.document_play_version (tenant_id, play_id, version, source, hash, created_by) VALUES ($1,$2,$3,$4,$5,$6)`, [tenantId, row.id, v, source, r.hash, actorUserId]);
  return { id: row.id, name: p.name, version: v, published: false };
}
export async function publishPlay(tx, { tenantId, name, version = null }) {
  await needPro(tx, tenantId);
  const { rows: [pl] } = await tx.query(`SELECT id FROM keystone.document_play WHERE name = $1`, [String(name ?? "")]); if (!pl) throw notFound("That play was not found.");
  const { rows: [v] } = await tx.query(`SELECT version FROM keystone.document_play_version WHERE play_id = $1 AND ($2::int IS NULL OR version = $2) ORDER BY version DESC LIMIT 1`, [pl.id, version]); if (!v) throw notFound("That version was not found.");
  await tx.query(`UPDATE keystone.document_play SET current_version = $2, archived = false, updated_at = now() WHERE id = $1`, [pl.id, v.version]);
  return { name, published: true, version: v.version };
}
export async function archivePlay(tx, { tenantId, name, archived = true }) {
  await needPro(tx, tenantId);
  const { rowCount } = await tx.query(`UPDATE keystone.document_play SET archived = $2, updated_at = now() WHERE name = $1`, [String(name ?? ""), archived]); if (!rowCount) throw notFound("That play was not found.");
  return { name, archived };
}
/** Copy a play (built-in or the workspace's) as a new editable play of the workspace under a new name. */
export async function duplicatePlay(tx, { tenantId, actorUserId = null, name, as }) {
  await needPro(tx, tenantId);
  const src = await getPlay(tx, { name, draft: true }); if (!src) throw notFound("That play was not found.");
  let text = src.source;
  if (!text) { const fs = await import("node:fs"), path = await import("node:path"), { fileURLToPath } = await import("node:url"); text = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "builtin", `${name}.md`), "utf8"); }
  const newName = String(as ?? `${name}-copy`).toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 60);
  return savePlay(tx, { tenantId, actorUserId, source: text.replace(/^name:.*$/m, `name: ${newName}`) });
}
export async function playVersions(tx, { name }) {
  const { rows } = await tx.query(`SELECT v.version, v.hash, v.created_at, (v.version = p.current_version) AS published FROM keystone.document_play_version v JOIN keystone.document_play p ON p.id = v.play_id WHERE p.name = $1 ORDER BY v.version DESC`, [String(name ?? "")]);
  return rows;
}
/** A dry run: checks the words and shows what the picker and the interview would use. Creates nothing. */
export function testPlaySource(source) {
  const r = parsePlay(source); if (!r.ok) return { ok: false, errors: r.errors };
  const p = r.play; return { ok: true, name: p.name, kind: p.kind, brief: brief(p), questions: p.questions.length, mustAsk: p.questions.filter((q) => q.mustAsk).length, flags: Math.min(p.flags.length, 3), checklist: p.checklist.length };
}
export async function exportPlay(tx, { name }) {
  const g = await getPlay(tx, { name, draft: true }); if (!g) throw notFound("That play was not found.");
  let text = g.source; if (!text) { const fs = await import("node:fs"), path = await import("node:path"), { fileURLToPath } = await import("node:url"); text = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "builtin", `${name}.md`), "utf8"); }
  return exportPlayZip(text);
}
export async function importPlay(tx, { tenantId, actorUserId = null, bytes }) {
  const z = importPlayZip(bytes); if (!z.ok) throw invalid(z.errors[0], { field: "file" });
  return savePlay(tx, { tenantId, actorUserId, source: z.source });
}

// ── playbooks: PACKS (Run 9 Part 4R) — a named bundle of skills AND templates for one job ("New tenant pack"). Switched on, its templates and skills are offered first: on the Templates page
//    and to Scribe. Templates are `builtin:<slug>` (a library template) or a workspace template's family id. A row with a flow is an AUTOMATION (playbooks.mjs), never listed here.
const SLUG = /^[a-z0-9][a-z0-9-]{2,60}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const packShape = (r) => ({ id: r.id, name: r.name, title: r.title, description: r.description, plays: r.plays, templates: r.templates ?? [], enabled: r.enabled === true, builtin: r.builtin === true, updatedAt: r.updated_at ?? null });
export async function listPlaybooks(tx) {
  const { rows } = await tx.query(`SELECT id, name, title, description, plays, templates, enabled, archived, updated_at FROM keystone.document_playbook WHERE NOT archived AND flow IS NULL ORDER BY title`);
  const { BUILTIN_PACKS } = await import("./packs.mjs");
  const on = new Set(((await (await import("../settings.mjs")).getDocumentSetting(tx, "packs.enabled")) ?? []).map(String));
  return [...BUILTIN_PACKS.map((b) => packShape({ ...b, enabled: on.has(b.name), builtin: true })), ...rows.map(packShape)];
}
async function checkTemplateRefs(tx, refs) {
  const { libraryEntry } = await import("../library.mjs");
  for (const ref of refs) {
    const v = String(ref ?? "");
    if (v.startsWith("builtin:")) { if (!libraryEntry(v.slice(8))) throw invalid(`There is no built-in template called “${v.slice(8)}”.`, { field: "templates" }); continue; }
    if (!UUID.test(v) || !(await tx.query(`SELECT 1 FROM keystone.document_template WHERE family_id = $1 AND active AND builtin_slug IS NULL`, [v])).rowCount) throw invalid(`“${v}” is not one of this workspace's templates.`, { field: "templates" });
  }
}
export async function savePlaybook(tx, { tenantId, actorUserId = null, name, title, description = "", plays = [], templates = [] }) {
  await needPro(tx, tenantId);
  const n = String(name ?? "").trim().toLowerCase(); if (!SLUG.test(n)) throw invalid("The name is 3 to 61 characters: lowercase letters, numbers and dashes.", { field: "name" });
  const { BUILTIN_PACKS } = await import("./packs.mjs"); if (BUILTIN_PACKS.some((b) => b.name === n)) throw conflict("That name belongs to a built-in pack. Choose another name.", { code: "name_taken", field: "name" });
  const t = String(title ?? "").trim().slice(0, 80); if (!t) throw invalid("Give the playbook a title.", { field: "title" });
  if (!Array.isArray(plays) || plays.length > 12) throw invalid("A playbook holds at most 12 skills.", { field: "plays" });
  if (!Array.isArray(templates) || templates.length > 24) throw invalid("A playbook holds at most 24 templates.", { field: "templates" });
  if (plays.length + templates.length < 1) throw invalid("A playbook needs at least one skill or template.", { field: "plays" });
  for (const pn of plays) if (!(await getPlay(tx, { name: pn }))) throw invalid(`There is no usable play called “${pn}”. A workspace play must be published first.`, { field: "plays" });
  await checkTemplateRefs(tx, templates);
  const { rows: [r] } = await tx.query(`INSERT INTO keystone.document_playbook (tenant_id, name, title, description, plays, templates, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (tenant_id, name) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description, plays = EXCLUDED.plays, templates = EXCLUDED.templates, archived = false, updated_at = now() WHERE keystone.document_playbook.flow IS NULL RETURNING id`, [tenantId, n, t, String(description ?? "").slice(0, 240), plays, templates.map(String), actorUserId]);
  if (!r) throw invalid("That name belongs to an automation. Choose another name.", { field: "name" });
  return { id: r.id, name: n };
}
/** Switch a pack on or off. A built-in pack is on per workspace (a setting); the workspace's own pack carries its own switch. Using a pack is open to every plan; MAKING one is Pro. */
export async function setPlaybookEnabled(tx, { tenantId, name, on }) {
  const n = String(name ?? "");
  const { BUILTIN_PACKS } = await import("./packs.mjs");
  if (BUILTIN_PACKS.some((b) => b.name === n)) {
    const S = await import("../settings.mjs"); const cur = new Set(((await S.getDocumentSetting(tx, "packs.enabled")) ?? []).map(String));
    if (on) cur.add(n); else cur.delete(n);
    await S.setDocumentSetting(tx, { tenantId, key: "packs.enabled", value: [...cur].sort() });
    return { name: n, enabled: on === true, builtin: true };
  }
  const { rowCount } = await tx.query(`UPDATE keystone.document_playbook SET enabled = $2, updated_at = now() WHERE name = $1 AND flow IS NULL AND NOT archived`, [n, on === true]);
  if (!rowCount) throw notFound("That playbook was not found.");
  return { name: n, enabled: on === true, builtin: false };
}
/** What the switched-on packs bring: their skills (play names) and templates (refs), for the Templates page and for Scribe. */
export async function enabledPackContents(tx) {
  const packs = (await listPlaybooks(tx)).filter((p) => p.enabled);
  return { packs: packs.map((p) => ({ name: p.name, title: p.title })), plays: [...new Set(packs.flatMap((p) => p.plays))], templates: [...new Set(packs.flatMap((p) => p.templates))] };
}
export async function archivePlaybook(tx, { tenantId, name }) {
  await needPro(tx, tenantId);
  const { rowCount } = await tx.query(`UPDATE keystone.document_playbook SET archived = true, enabled = false, updated_at = now() WHERE name = $1 AND flow IS NULL`, [String(name ?? "")]); if (!rowCount) throw notFound("That playbook was not found.");
  return { name, archived: true };
}
