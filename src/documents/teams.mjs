// Part 30 item 8 — TEAMS: named groups of people; a document or template can belong to one team; with `teams.restrict_visibility` on, a member sees their teams' work (rule in SQL: keystone.document_team_visible, migration 0636).
// ★ The person is an opaque id (the host's user id). Names for the screen come from the `people` port, so a person who has left simply shows as "Former team member" until they are removed.
// ★ A team is a Pro item (`team_roles`): creating one asks the plan; a workspace on no plan is never limited.
import { invalid, notFound, conflict } from "../http/errors.mjs";
import { ports } from "./ports.mjs";
import { emit, userActor } from "../events/outbox.mjs";

const NAME_MAX = 80;
const clean = (n) => (typeof n === "string" ? n.trim().replace(/\s+/g, " ") : "");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function listTeams(tx) {
  const { rows: teams } = await tx.query(`SELECT id, name, created_at FROM keystone.document_team ORDER BY lower(name)`);
  const { rows: members } = await tx.query(`SELECT team_id, user_ref FROM keystone.document_team_member`);
  const people = members.length ? await (await ports()).people.byIds(tx, [...new Set(members.map((m) => m.user_ref))]) : [];
  const nameOf = new Map(people.map((p) => [p.id, p.display_name]));
  const { rows: counts } = await tx.query(`SELECT t.id AS team_id, (SELECT count(*)::int FROM keystone.document_instance i WHERE i.team_id = t.id AND i.archived_at IS NULL AND (i.package_lead_id IS NULL OR i.package_lead_id = i.id)) AS documents,
                                                  (SELECT count(*)::int FROM keystone.document_template d WHERE d.team_id = t.id AND d.builder = 'pdf' AND d.active) AS templates FROM keystone.document_team t`);
  const c = new Map(counts.map((r) => [r.team_id, r]));
  return teams.map((t) => ({
    id: t.id, name: t.name,
    members: members.filter((m) => m.team_id === t.id).map((m) => ({ id: m.user_ref, name: nameOf.get(m.user_ref) ?? "Former team member" })).sort((a, b) => a.name.localeCompare(b.name)),
    documents: c.get(t.id)?.documents ?? 0, templates: c.get(t.id)?.templates ?? 0,
  }));
}

export async function createTeam(tx, { tenantId, name, actorUserId = null }) {
  const n = clean(name);
  if (!n || n.length > NAME_MAX) throw invalid(`A team needs a name of 1 to ${NAME_MAX} characters.`, { field: "name" });
  await (await ports()).entitlements?.assertEntitled?.(tx, { tenantId, item: "team_roles" });
  const { rows: [dup] } = await tx.query(`SELECT 1 AS x FROM keystone.document_team WHERE lower(btrim(name)) = lower($1)`, [n]);
  if (dup) throw conflict("There is already a team with that name.");
  const { rows: [t] } = await tx.query(`INSERT INTO keystone.document_team (tenant_id, name, created_by) VALUES ($1,$2,$3) RETURNING id, name`, [tenantId, n, actorUserId]);
  await emit(tx, { tenantId, topic: "documents.team.created", emittedBy: "documents", actor: userActor(actorUserId ?? null), payload: { team_id: t.id } });
  return { id: t.id, name: t.name, members: [], documents: 0, templates: 0 };
}

export async function renameTeam(tx, { tenantId = null, teamId, name, actorUserId = null }) {
  const n = clean(name);
  if (!n || n.length > NAME_MAX) throw invalid(`A team needs a name of 1 to ${NAME_MAX} characters.`, { field: "name" });
  const { rows: [dup] } = await tx.query(`SELECT 1 AS x FROM keystone.document_team WHERE lower(btrim(name)) = lower($1) AND id <> $2`, [n, teamId]);
  if (dup) throw conflict("There is already a team with that name.");
  const { rowCount } = await tx.query(`UPDATE keystone.document_team SET name = $2 WHERE id = $1`, [teamId, n]);
  if (!rowCount) throw notFound("no such team");
  if (tenantId) await emit(tx, { tenantId, topic: "documents.team.updated", emittedBy: "documents", actor: userActor(actorUserId ?? null), payload: { team_id: teamId, what: "renamed" } });
  return { id: teamId, name: n };
}

/** Deleting a team never deletes work: its documents and templates become unassigned (visible to everyone, as before teams). */
export async function deleteTeam(tx, { tenantId = null, teamId, actorUserId = null }) {
  const { rowCount } = await tx.query(`DELETE FROM keystone.document_team WHERE id = $1`, [teamId]);
  if (!rowCount) throw notFound("no such team");
  if (tenantId) await emit(tx, { tenantId, topic: "documents.team.deleted", emittedBy: "documents", actor: userActor(actorUserId ?? null), payload: { team_id: teamId } });
  return { deleted: true };
}

/** Replace the team's members with exactly `userRefs`. */
export async function setTeamMembers(tx, { tenantId, teamId, userRefs, actorUserId = null }) {
  if (!Array.isArray(userRefs) || userRefs.some((u) => typeof u !== "string" || !UUID.test(u))) throw invalid("userRefs must be a list of people ids", { field: "userRefs" });
  const { rows: [t] } = await tx.query(`SELECT id FROM keystone.document_team WHERE id = $1`, [teamId]);
  if (!t) throw notFound("no such team");
  const refs = [...new Set(userRefs.map((u) => u.toLowerCase()))];
  if (refs.length) {
    const found = await (await ports()).people.byIds(tx, refs);
    if (found.length !== refs.length) throw invalid("One of those people is not in this workspace.", { field: "userRefs" });
  }
  await tx.query(`DELETE FROM keystone.document_team_member WHERE team_id = $1 AND NOT (user_ref = ANY($2::uuid[]))`, [teamId, refs]);
  for (const u of refs) await tx.query(`INSERT INTO keystone.document_team_member (tenant_id, team_id, user_ref) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [tenantId, teamId, u]);
  await emit(tx, { tenantId, topic: "documents.team.updated", emittedBy: "documents", actor: userActor(actorUserId ?? null), payload: { team_id: teamId, what: "members", count: refs.length } });
  return { teamId, members: refs.length };
}

/** The team a new document should start in: the creator's only team, or none when they are on none or several. */
export async function defaultTeamFor(tx, userId) {
  if (!userId) return null;
  const { rows } = await tx.query(`SELECT team_id FROM keystone.document_team_member WHERE user_ref = $1 LIMIT 2`, [userId]);
  return rows.length === 1 ? rows[0].team_id : null;
}

/** Put a document (with its whole package) or a template in a team, or take it out (teamId null). Only someone who can see it may move it. */
export async function assignTeam(tx, { tenantId, kind, id, teamId = null, actorUserId = null }) {
  if (!["document", "template"].includes(kind)) throw invalid("kind must be document or template", { field: "kind" });
  if (teamId) { const { rows: [t] } = await tx.query(`SELECT id FROM keystone.document_team WHERE id = $1`, [teamId]); if (!t) throw notFound("no such team"); }
  if (kind === "template") {
    await assertTemplateVisible(tx, id);
    const { rowCount } = await tx.query(`UPDATE keystone.document_template SET team_id = $2 WHERE id = $1 AND builder = 'pdf'`, [id, teamId]);
    if (!rowCount) throw notFound("no such template");
    await emit(tx, { tenantId, topic: "documents.team.updated", emittedBy: "documents", actor: userActor(actorUserId ?? null), payload: { team_id: teamId, what: "template_assigned" } });
    return { kind, id, teamId };
  }
  await assertDocumentVisible(tx, id);
  const { rows: [i] } = await tx.query(`SELECT id, package_lead_id FROM keystone.document_instance WHERE id = $1 AND builder = 'pdf' AND archived_at IS NULL`, [id]);
  if (!i) throw notFound("That document is not in this workspace.");
  const lead = i.package_lead_id ?? i.id;
  await tx.query(`UPDATE keystone.document_instance SET team_id = $2, updated_at = now() WHERE id = $1 OR package_lead_id = $1`, [lead, teamId]);
  await emit(tx, { tenantId, topic: "documents.team.updated", emittedBy: "documents", actor: userActor(actorUserId ?? null), payload: { team_id: teamId, what: "document_assigned" } });
  return { kind, id: lead, teamId };
}

// ── visibility ──
const viewerOf = async (tx) => { const { rows: [r] } = await tx.query(`SELECT nullif(current_setting('keystone.user_id', true), '') AS u`); return r?.u && UUID.test(r.u) ? r.u : null; };
/** Throws "no such document" (never "forbidden" — a hidden document must look absent) when the asking person may not see it. A signer or the worker (no staff viewer) is never refused here. */
export async function assertDocumentVisible(tx, instanceId) {
  const viewer = await viewerOf(tx);
  if (!viewer) return;
  const { rows: [r] } = await tx.query(`SELECT keystone.document_team_visible($1::uuid, i.team_id, i.created_by) AS ok FROM keystone.document_instance i WHERE i.id = $2`, [viewer, instanceId]);
  if (r && r.ok === false) throw notFound("That document is not in this workspace.");
}
export async function assertTemplateVisible(tx, templateId) {
  const viewer = await viewerOf(tx);
  if (!viewer) return;
  const { rows: [r] } = await tx.query(`SELECT keystone.document_team_visible($1::uuid, t.team_id, NULL) AS ok FROM keystone.document_template t WHERE t.id = $2`, [viewer, templateId]);
  if (r && r.ok === false) throw notFound("no such uploaded-document template");
}
/** SQL fragment for list queries: `AND <this>` with the viewer's id bound at `param` (e.g. "$1") — the same rule, so a list and a single read cannot disagree. */
export const visibleSql = (alias, viewerParam, creatorExpr = `${alias}.created_by`) => `keystone.document_team_visible(${viewerParam}::uuid, ${alias}.team_id, ${creatorExpr})`;

export async function teamOf(tx, { kind, id }) {
  const { rows: [r] } = await tx.query(kind === "template"
    ? `SELECT t.team_id, d.name FROM keystone.document_template t LEFT JOIN keystone.document_team d ON d.id = t.team_id WHERE t.id = $1`
    : `SELECT i.team_id, d.name FROM keystone.document_instance i LEFT JOIN keystone.document_team d ON d.id = i.team_id WHERE i.id = $1`, [id]);
  return r ? { teamId: r.team_id, teamName: r.name ?? null } : { teamId: null, teamName: null };
}
