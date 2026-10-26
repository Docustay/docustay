// ⌘K SEARCH (Run 9 board "Search everything"): one box over the workspace — documents, templates and forms, people — answered in groups, at most `per` each, best first.
// Postgres only (R9-j): ILIKE for "contains" plus pg_trgm WORD similarity for near misses (the best-matching stretch of the title, so a long title is not penalised) ("leese" finds "lease"), both under the caller's RLS — every query runs in the tenant's own transaction, so
// another workspace's rows are never even candidates. The words a row shows under its title are built from the row's own facts (who is still to sign, when it was sent, how many responses).
import { invalid } from "../http/errors.mjs";

const SEARCH_MAX_Q = 120;
const escapeLike = (s) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

/** → { q, groups: { documents: [...], templates: [...], people: [...] } }. An empty or one-letter query answers empty groups (the palette then shows recent items from the client). */
export async function searchWorkspace(tx, { q = "", per = 6, now = new Date() } = {}) {
  const term = String(q ?? "").replace(/\s+/g, " ").trim();
  if (term.length > SEARCH_MAX_Q) throw invalid(`Search for at most ${SEARCH_MAX_Q} characters.`, { field: "q" });
  const empty = { q: term, groups: { documents: [], templates: [], people: [] } };
  if (term.length < 2) return empty;
  const n = Math.min(Math.max(Number(per) || 6, 1), 20);
  const like = `%${escapeLike(term.toLowerCase())}%`, start = `${escapeLike(term.toLowerCase())}%`;

  // DOCUMENTS: the title, or anyone on it (name or address). One row per document; a package shows its lead only.
  const { rows: docs } = await tx.query(
    `SELECT i.id, i.title, i.state, i.sent_at, i.executed_at, i.created_at, i.updated_at, i.source_channel,
            (SELECT count(*)::int FROM keystone.document_party p WHERE p.instance_id = i.id AND p.role <> 'witness' AND p.action_role IS DISTINCT FROM 'copy') AS signers,
            (SELECT count(*)::int FROM keystone.document_party p WHERE p.instance_id = i.id AND p.status = 'signed') AS signed,
            GREATEST(keystone.word_similarity($1, lower(i.title)), COALESCE((SELECT max(keystone.word_similarity($1, lower(p.name))) FROM keystone.document_party p WHERE p.instance_id = i.id), 0)) AS score,
            lower(i.title) LIKE $3 AS prefix
       FROM keystone.document_instance i
      WHERE i.archived_at IS NULL AND (i.package_lead_id IS NULL OR i.package_lead_id = i.id)
        AND (lower(i.title) LIKE $2 OR keystone.word_similarity($1, lower(i.title)) > 0.3
             OR EXISTS (SELECT 1 FROM keystone.document_party p WHERE p.instance_id = i.id AND (lower(p.name) LIKE $2 OR lower(p.email) LIKE $2)))
      ORDER BY prefix DESC, score DESC, i.updated_at DESC LIMIT $4`, [term.toLowerCase(), like, start, n]);

  // TEMPLATES AND FORMS: the current version of each family, never a retired one.
  const { rows: tpls } = await tx.query(
    `SELECT t.id, t.name, t.kind, t.updated_at, t.family_id,
            (SELECT count(*)::int FROM keystone.document_instance r WHERE r.source_channel = 'form' AND r.template_id IN (SELECT v.id FROM keystone.document_template v WHERE v.family_id = t.family_id)) AS responses,
            keystone.word_similarity($1, lower(t.name)) AS score, lower(t.name) LIKE $3 AS prefix
       FROM keystone.document_template t
      WHERE t.active AND t.retired_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM keystone.document_template n2 WHERE n2.family_id = t.family_id AND n2.version > t.version)
        AND (lower(t.name) LIKE $2 OR keystone.word_similarity($1, lower(t.name)) > 0.3)
      ORDER BY prefix DESC, score DESC, t.updated_at DESC LIMIT $4`, [term.toLowerCase(), like, start, n]);

  // PEOPLE: name or address; the line under them is the last thing they did (signed / filled in / was sent).
  const { rows: people } = await tx.query(
    `SELECT c.id, c.first_name, c.last_name, c.email, c.last_activity_at,
            (SELECT json_build_object('title', i.title, 'status', p.status, 'at', COALESCE(p.completed_at, p.viewed_at, p.invited_at, i.sent_at), 'form', i.source_channel = 'form')
               FROM keystone.document_party p JOIN keystone.document_instance i ON i.id = p.instance_id
              WHERE lower(p.email) = c.email ORDER BY COALESCE(p.completed_at, p.viewed_at, p.invited_at, i.sent_at, i.created_at) DESC NULLS LAST LIMIT 1) AS last,
            GREATEST(keystone.word_similarity($1, lower(c.first_name || ' ' || c.last_name)), keystone.word_similarity($1, c.email)) AS score
       FROM keystone.document_contact c
      WHERE lower(c.first_name || ' ' || c.last_name) LIKE $2 OR c.email LIKE $2 OR keystone.word_similarity($1, lower(c.first_name || ' ' || c.last_name)) > 0.3
      ORDER BY score DESC, c.last_activity_at DESC LIMIT $3`, [term.toLowerCase(), like, n]);

  return {
    q: term,
    groups: {
      documents: docs.map((d) => ({ id: d.id, title: d.title, state: d.state, form: d.source_channel === "form", signers: d.signers, signed: d.signed, sentAt: d.sent_at, executedAt: d.executed_at, href: `/documents/${d.id}` })),
      templates: tpls.map((t) => ({ id: t.id, title: t.name, kind: t.kind === "form" ? "form" : "template", responses: t.kind === "form" ? t.responses : null, href: t.kind === "form" ? `/forms?open=${t.id}` : `/create/flow?mode=template&template=${t.id}` })),
      people: people.map((p) => ({ id: p.id, name: `${p.first_name} ${p.last_name}`.trim() || p.email, email: p.email, last: p.last, href: `/contacts/${p.id}` })),
    },
    at: now.toISOString(),
  };
}
