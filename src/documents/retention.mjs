// src/documents/retention.mjs — THE RETENTION GUARD (QUEUE §23.3.6, research §8.2). An executed (signed) document is a legal record: the shared Delete may not remove it while it is inside its retention
// window (`retention_years`; unset = indefinite). After the window it may be deleted with the audited reason. Drafts and unsigned sends stay freely deletable. The database enforces the same rule
// (migration 0598's document_instance_terminal_no_delete) so no path — a bulk delete, a person delete, a script — can forget it; THIS module is what makes the refusal readable BEFORE the confirm button.
import { getDocumentSetting } from "./settings.mjs";

/** Blockers for deleting one document, in the shape the shared delete plan uses: [{what, count, hint}] — empty when it may go. */
export async function documentDeleteBlockers(tx, { instanceId }) {
  const { rows: [d] } = await tx.query(
    `SELECT state, executed_at, keystone.document_is_retained(tenant_id, state, executed_at) AS retained FROM keystone.document_instance WHERE id = $1`, [instanceId]);
  if (!d || d.retained !== true) return [];
  const years = await getDocumentSetting(tx, "retention_years");
  const until = Number.isInteger(years) ? new Date(new Date(d.executed_at).getTime() + years * 365.25 * 86400000) : null;
  return [{
    what: "signed document inside its retention period", count: 1,
    hint: until
      ? `A signed document is a legal record. This one is kept until ${until.toISOString().slice(0, 10)} (${years} years from signing).`
      : "A signed document is a legal record. This practice keeps signed documents indefinitely (Documents → Settings → Keep signed documents for).",
  }];
}
