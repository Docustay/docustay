// src/documents/teamRecipients.mjs — SENDING TO TEAMMATES (21 Oct 2026, the maintainer). A teammate (an Owner, Admin or Member of this workspace) can be a recipient of a document like anyone else:
//   · the picker lists teammates first (listTeammates), each linked to the member record through the party's `external_ref` (the member's id), and shown as internal (`internal` on the party);
//   · "Waiting on you" (waitingOnMe) lists the documents where the signed-in person is a recipient who still has to act, whoever made the document;
//   · a teammate who is a recipient may OPEN that document in the app even when the workspace limits visibility by team or they are a Member (isPartyOn, used by assertDocumentVisible), read only: every change still asks for the usual right;
//   · when it is their turn they get a notice in the app (notifyTeammate), besides the same email link every signer gets. Signing is unchanged: the same link, the same audit trail.
const STAFF = `u.role = 'staff' AND u.archived_at IS NULL AND u.lifecycle_status <> 'former' AND u.email IS NOT NULL AND u.email NOT LIKE '%@deleted.invalid'`;
const nameOf = (r) => (r.display_name && r.display_name.trim()) || r.email;

/** Teammates for the picker: name, email, role, id; the asking person marked. `q` filters by name or email. */
export async function listTeammates(tx, { q = "", limit = 50, selfId = null } = {}) {
  const like = `%${String(q ?? "").trim().toLowerCase().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const { rows } = await tx.query(
    `SELECT u.id, u.display_name, u.email, u.staff_role FROM keystone.app_user u
      WHERE ${STAFF} AND ($1 = '%%' OR lower(coalesce(u.display_name, '')) LIKE $1 OR lower(u.email) LIKE $1)
      ORDER BY (u.id = $2::uuid) DESC, lower(coalesce(u.display_name, u.email)) LIMIT $3`, [like, selfId, limit]);
  return rows.map((r) => ({ id: r.id, name: nameOf(r), email: r.email, role: r.staff_role, you: r.id === selfId, team: true }));
}

/** Is this person a recipient on the document (matched by the member id in `external_ref`, or by their email)? */
export async function isPartyOn(tx, { instanceId, userId }) {
  if (!instanceId || !userId) return false;
  const { rows } = await tx.query(
    `SELECT 1 FROM keystone.document_instance i
       JOIN keystone.document_party p ON p.instance_id = coalesce(i.package_lead_id, i.id)
       JOIN keystone.app_user u ON u.id = $2::uuid
      WHERE i.id = $1 AND (p.external_ref = u.id OR (p.email IS NOT NULL AND lower(p.email) = lower(u.email))) LIMIT 1`, [instanceId, userId]);
  return rows.length > 0;
}

/** Documents with something for this person to sign or approve, newest first. Only the ones out for signature, only where it is their turn (in a one-after-another send, no earlier step is still open). */
export async function waitingOnMe(tx, { userId, limit = 50 }) {
  const { rows } = await tx.query(
    `SELECT i.id, i.title, i.state, i.sent_at, i.expires_at, p.action_role, p.role, p.status,
            coalesce(s.display_name, s.email) AS sender
       FROM keystone.document_instance i
       JOIN keystone.app_user u ON u.id = $1::uuid
       JOIN keystone.document_party p ON p.instance_id = coalesce(i.package_lead_id, i.id)
                                     AND (p.external_ref = u.id OR (p.email IS NOT NULL AND lower(p.email) = lower(u.email)))
       LEFT JOIN keystone.app_user s ON s.id = i.created_by
      WHERE i.builder = 'pdf' AND i.archived_at IS NULL AND i.state IN ('sent', 'partially_signed')
        AND p.action_role IN ('signer', 'approver') AND p.status IN ('pending', 'viewed')
        AND (coalesce(i.send_options->>'order', 'parallel') <> 'sequential'
             OR NOT EXISTS (SELECT 1 FROM keystone.document_party q WHERE q.instance_id = p.instance_id AND q.position < p.position AND q.action_role IN ('signer', 'approver') AND q.status NOT IN ('signed', 'approved', 'declined', 'rejected')))
      ORDER BY i.sent_at DESC NULLS LAST LIMIT $2`, [userId, limit]);
  return rows.map((r) => ({ id: r.id, title: r.title, sentAt: r.sent_at, expiresAt: r.expires_at, action: r.action_role === "approver" ? "approve" : "sign", from: r.sender ?? null }));
}

/** The in-app notice for a teammate whose turn it is (never for the person who sent it; never blocks the send). */
export async function notifyTeammate(tx, { tenantId, leadId, party, createNotification }) {
  if (!party?.external_ref) return null;
  await tx.query("SAVEPOINT notify_teammate");
  try {
    const { rows: [who] } = await tx.query(`SELECT u.id FROM keystone.app_user u WHERE u.id = $1::uuid AND ${STAFF}`, [party.external_ref]);
    const { rows: [doc] } = await tx.query(`SELECT i.id, i.title, i.created_by, coalesce(s.display_name, s.email) AS sender FROM keystone.document_instance i LEFT JOIN keystone.app_user s ON s.id = i.created_by WHERE i.id = $1`, [leadId]);
    if (!who || !doc || doc.created_by === who.id) { await tx.query("RELEASE SAVEPOINT notify_teammate"); return null; }
    const { rows: [ev] } = await tx.query(`SELECT id FROM keystone.event WHERE subject_id = $1 AND topic = 'documents.document.sent' ORDER BY created_at DESC LIMIT 1`, [leadId]);
    if (!ev) { await tx.query("RELEASE SAVEPOINT notify_teammate"); return null; }
    const act = party.action_role === "approver" ? "approve" : "sign";
    const n = await createNotification(tx, { tenantId, recipientId: who.id, eventId: ev.id, topic: "documents.document.sent", title: `${doc.sender ?? "A teammate"} needs you to ${act} “${doc.title}”`, body: null, deepLink: `/documents/${doc.id}` });
    await tx.query("RELEASE SAVEPOINT notify_teammate");
    return n;
  } catch (e) { await tx.query("ROLLBACK TO SAVEPOINT notify_teammate"); console.error(`notify teammate failed: ${e?.message ?? e}`); return null; }
}
