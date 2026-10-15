// src/documents/parties.mjs — THE ISLAND'S OWN SNAPSHOT OF WHO IS ON A SEND (QUEUE §23.3.2, migration 0598). Written at send; updated at signing; read first by the certificate and the document lists, so a signed
// record stands alone after its person is gone. The host's person id is kept as an opaque `external_ref` (no foreign key); names and emails are COPIED, never joined.
//
// A package (several documents in one send) keeps its parties on the LEAD instance; `documentsOfSend` returns the lead and its members, and a one-document send is a package of one.
import { SIGNER_CONFIGS } from "./vocabulary.mjs";
import { ports } from "./ports.mjs";

const PARTY_ROLES = ["pir", "parent", "coach", "client", "consultant", "familyMember", "recipient"];

/** The documents in one send, in order: the lead first, then its members by position. `instanceId` may be the lead or any member. A one-document send returns just itself. */
export async function documentsOfSend(tx, { instanceId }) {
  const { rows: [row] } = await tx.query(`SELECT id, package_lead_id FROM keystone.document_instance WHERE id = $1`, [instanceId]);
  if (!row) return [];
  const leadId = row.package_lead_id ?? row.id;
  const { rows } = await tx.query(
    `SELECT id, title, package_position, state FROM keystone.document_instance WHERE id = $1 OR package_lead_id = $1 ORDER BY package_position NULLS FIRST, created_at`, [leadId]);
  return rows;
}

/** The lead instance id of the send this instance belongs to (itself when it is not part of a package). */
export async function leadOf(tx, { instanceId }) {
  const { rows: [row] } = await tx.query(`SELECT id, package_lead_id FROM keystone.document_instance WHERE id = $1`, [instanceId]);
  return row ? (row.package_lead_id ?? row.id) : null;
}

/**
 * Snapshot the people on this send, from the document type's signing order and the host's people directory (through the port). Idempotent: a send that already has parties is left alone.
 * Roles with nobody to resolve (a coach who signs in the CRM, a parent with no guardian on file) are still recorded when a name is known; they are never invented.
 * @returns {Promise<number>} parties written
 */
export async function snapshotParties(tx, { tenantId, instanceId }) {
  const lead = await leadOf(tx, { instanceId });
  if (!lead) return 0;
  const have = await tx.query(`SELECT 1 FROM keystone.document_party WHERE instance_id = $1 LIMIT 1`, [lead]);
  if (have.rowCount > 0) return 0;
  const { rows: [inst] } = await tx.query(
    `SELECT i.subject_user_id, i.created_by, t.signer_config FROM keystone.document_instance i LEFT JOIN keystone.document_type t ON t.id = i.type_id WHERE i.id = $1`, [lead]);
  const order = inst?.signer_config ? SIGNER_CONFIGS[inst.signer_config] : null;
  if (!inst || !Array.isArray(order)) return 0;
  const P = await ports();
  let written = 0;
  for (let i = 0; i < order.length; i += 1) {
    const role = order[i];
    let person = null;
    if ((role === "client" || role === "pir") && inst.subject_user_id) [person] = await P.people.byIds(tx, [inst.subject_user_id]);
    else if (role === "parent" && inst.subject_user_id) person = await P.people.guardianOf(tx, inst.subject_user_id);
    else if (role === "coach") { const id = inst.created_by ?? (inst.subject_user_id ? await P.people.ownerOf(tx, inst.subject_user_id) : null); if (id) [person] = await P.people.byIds(tx, [id]); }
    if (!person?.display_name) continue;
    await tx.query(
      `INSERT INTO keystone.document_party (tenant_id, instance_id, role, position, name, email, external_ref) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [tenantId, lead, role, i + 1, person.display_name, person.email ?? null, person.id]);
    written += 1;
  }
  return written;
}

/**
 * A signature was recorded: mark the party signed and copy the consent facts onto it (so the certificate survives the deletion of the person's own consent row). A signature on a document sent
 * before parties existed gets its party row now, from the signature itself.
 */
export async function markPartySigned(tx, { tenantId, instanceId, role, signerName, signerUid }) {
  const lead = await leadOf(tx, { instanceId });
  if (!lead || !PARTY_ROLES.includes(role)) return;
  let consent = null;
  if (signerUid) {
    const { rows } = await tx.query(
      `SELECT version, accepted_at, accepted_ip, user_agent FROM keystone.esign_disclosure_acceptance WHERE app_user_id = $1 AND withdrawn_at IS NULL AND accepted_at <= now() ORDER BY accepted_at DESC LIMIT 1`, [signerUid]);
    consent = rows[0] ?? null;
  }
  const upd = await tx.query(
    `UPDATE keystone.document_party SET status = 'signed', updated_at = now(),
            consent_version = coalesce($3, consent_version), consented_at = coalesce($4, consented_at), consent_ip = coalesce($5, consent_ip), consent_user_agent = coalesce($6, consent_user_agent)
      WHERE instance_id = $1 AND role = $2`,
    [lead, role, consent?.version ?? null, consent?.accepted_at ?? null, consent?.accepted_ip ?? null, consent?.user_agent ?? null]);
  if (upd.rowCount === 0) {
    const email = signerUid ? (await (await ports()).people.byIds(tx, [signerUid]))[0]?.email ?? null : null;
    await tx.query(
      `INSERT INTO keystone.document_party (tenant_id, instance_id, role, position, name, email, external_ref, status, consent_version, consented_at, consent_ip, consent_user_agent)
       VALUES ($1,$2,$3,coalesce((SELECT max(position) FROM keystone.document_party WHERE instance_id = $2), 0) + 1,$4,$5,$6,'signed',$7,$8,$9,$10)`,
      [tenantId, lead, role, signerName, email, signerUid ?? null, consent?.version ?? null, consent?.accepted_at ?? null, consent?.accepted_ip ?? null, consent?.user_agent ?? null]);
  }
}

/** The parties of a send, in order. */
export async function partiesOf(tx, { instanceId }) {
  const lead = await leadOf(tx, { instanceId });
  if (!lead) return [];
  const { rows } = await tx.query(`SELECT * FROM keystone.document_party WHERE instance_id = $1 ORDER BY position, created_at`, [lead]);
  return rows;
}

/**
 * Before a person is deleted (QUEUE §23.3.6): make sure every signed or declined document they are on carries its party snapshot, then delete their UNSIGNED documents (drafts stay freely
 * deletable) and let the signed ones be detached by the database (subject_user_id → NULL). Called by the shared delete flow through the front door, inside its transaction, with the audited reason set.
 * @returns {Promise<{kept:number, removed:number}>}
 */
export async function prepareForPersonDelete(tx, { tenantId, personId }) {
  // KEPT: executed or declined documents, and any document that already carries a signature (a partly signed one is evidence too). REMOVED: the rest (drafts, unsigned sends).
  const keptSql = `SELECT id FROM keystone.document_instance d WHERE d.subject_user_id = $1
                      AND (d.state IN ('executed','declined') OR EXISTS (SELECT 1 FROM keystone.signature_record s WHERE s.instance_id = d.id))`;
  const { rows: kept } = await tx.query(keptSql, [personId]);
  for (const d of kept) await snapshotParties(tx, { tenantId, instanceId: d.id });
  const { rowCount: removed } = await tx.query(
    `DELETE FROM keystone.document_instance d WHERE d.subject_user_id = $1 AND d.state NOT IN ('executed','declined')
        AND NOT EXISTS (SELECT 1 FROM keystone.signature_record s WHERE s.instance_id = d.id)`, [personId]);
  return { kept: kept.length, removed };
}

/** What a person's delete will do to their documents, for the delete dialog: how many signed documents are kept (detached, name and email stay on the record) and how many unsigned ones go. */
export async function personDeleteDocumentPlan(tx, { personId }) {
  const { rows: [r] } = await tx.query(
    `SELECT count(*) FILTER (WHERE d.state IN ('executed','declined') OR EXISTS (SELECT 1 FROM keystone.signature_record s WHERE s.instance_id = d.id))::int AS kept,
            count(*) FILTER (WHERE d.state NOT IN ('executed','declined') AND NOT EXISTS (SELECT 1 FROM keystone.signature_record s WHERE s.instance_id = d.id))::int AS removed
       FROM keystone.document_instance d WHERE d.subject_user_id = $1`, [personId]);
  return { kept: r?.kept ?? 0, removed: r?.removed ?? 0 };
}
