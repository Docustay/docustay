// src/documents/pdfBulk.mjs — SEND ONE TEMPLATE TO MANY PEOPLE FROM A SPREADSHEET (QUEUE §23.5.3). Each row (name, email, plus any extra columns) becomes its OWN document from the template, sent to that one person — its own link, certificate and audit trail, exactly as if sent by hand.
// ★ Templates with exactly one signing seat only (the row IS the signer). Extra columns become `{{custom.<column>}}` for the email subject and message.
// ★ One bad row never spoils the rest (each row runs inside a savepoint) and a dry run reports every problem without creating anything. At most 50 rows a call — the page sends longer lists in batches.
// R13-D439 (23 Oct 2026): moved from the Pro add-on into the core. Sending to a list is on every plan (decisions 46/47, v1 item 16) and the Self-host page says it is in the free Community edition, but a Community build refused it with "Install the Pro add-on". The plan gate inside (assertEntitled + bulkCap) still decides on hosted.
import { invalid, notFound } from "../http/errors.mjs";
import { ports } from "./ports.mjs";
import { parsePdfBodyData } from "./pdfBody.mjs";
import { createPdfFromTemplate, savePdfDocument } from "./pdfDocs.mjs";
import { sendPdfDocument, templateBoxProblems } from "./pdfSend.mjs";
import { assertUsable } from "./pdfTemplates.mjs";

export const BULK_MAX_ROWS = 50;
const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const KEY = /^[a-z][a-z0-9_]{0,40}$/;

/** Clean one row → { name, email, custom } or { problem }. Column names are lower-cased and spaces become underscores. */
export function checkRow(raw) {
  const row = Object.fromEntries(Object.entries(raw ?? {}).map(([k, v]) => [String(k).trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, ""), v == null ? "" : String(v).trim()]));
  const name = row.name ?? [row.first_name, row.last_name].filter(Boolean).join(" ");
  if (!name) return { problem: "no name" };
  const email = (row.email ?? "").toLowerCase();
  if (!EMAIL.test(email)) return { problem: email ? `“${email}” is not an email address` : "no email" };
  const custom = {};
  for (const [k, v] of Object.entries(row)) if (!["name", "first_name", "last_name", "email"].includes(k) && KEY.test(k) && v) custom[k] = v.slice(0, 200);
  return { name: name.slice(0, 120), email, custom };
}

export async function bulkSend(tx, { tenantId, actorUserId = null, templateId, rows, dryRun = false }) {
  // ★ Part 29 (A7-3): sending to a list is a paid-plan item — the host's plan answers, in its own words
  await (await ports()).entitlements?.assertEntitled?.(tx, { tenantId, item: "bulk_send" });
  if (!Array.isArray(rows) || rows.length === 0) throw invalid("There are no rows to send.", { field: "rows" });
  const cap = await (await ports()).entitlements?.bulkCap?.(tx, { tenantId });
  if (cap != null && rows.length > cap) throw invalid(`Your plan sends to at most ${cap} people from one list. Switch to Pay as you go or Pro to send to more.`, { field: "rows", code: "plan_bulk_cap", limit: cap });
  if (rows.length > BULK_MAX_ROWS) throw invalid(`Send at most ${BULK_MAX_ROWS} rows at a time.`, { field: "rows", code: "too_many" });
  const { rows: [t] } = await tx.query(`SELECT id, name, builder, body, active, approval_status FROM keystone.document_template WHERE id = $1 AND builder = 'pdf'`, [templateId]);
  assertUsable(t);
  if (!t) throw notFound("no such uploaded-document template");
  const body = parsePdfBodyData(t.body);
  if (body.roles.length !== 1) throw invalid("Sending from a spreadsheet needs a template with exactly one person signing.", { field: "templateId", code: "one_seat" });
  const seat = body.roles[0].key;
  const seen = new Set();
  const results = [];
  for (let n = 0; n < rows.length; n += 1) {
    const c = checkRow(rows[n]);
    if (c.problem) { results.push({ row: n + 1, ok: false, error: c.problem }); continue; }
    if (seen.has(c.email)) { results.push({ row: n + 1, ok: false, error: `${c.email} appears twice in this list`, email: c.email }); continue; }
    seen.add(c.email);
    if (dryRun) {   // Run 9: the check says what the send will say — a sender box of the template with nothing to fill it fails every row the same way (before, "Check the list" passed and the send then failed all of them)
      const probs = await templateBoxProblems(tx, { tenantId, actorUserId, body, seat, custom: c.custom, name: c.name, email: c.email });
      results.push(probs.length ? { row: n + 1, ok: false, error: probs[0], email: c.email } : { row: n + 1, ok: true, email: c.email, name: c.name });
      continue;
    }
    await tx.query(`SAVEPOINT bulk_row`);
    try {
      const made = await createPdfFromTemplate(tx, { tenantId, templateId, actorUserId, title: `${t.name} — ${c.name}`, customValues: c.custom });
      await savePdfDocument(tx, { tenantId, actorUserId, instanceId: made.instanceId, parties: [{ role: seat, name: c.name, email: c.email, action_role: "signer" }] });
      const sent = await sendPdfDocument(tx, { tenantId, instanceId: made.instanceId, actorUserId });
      await tx.query(`RELEASE SAVEPOINT bulk_row`);
      // Run 8 F985 scope: a row whose email did not go out (the day's limit) is sent but NOT emailed — counted and named, never folded into "sent"
      results.push({ row: n + 1, ok: true, instanceId: made.instanceId, email: c.email, name: c.name, notEmailed: sent?.notEmailed?.[0]?.reason ?? null });
    } catch (e) {
      await tx.query(`ROLLBACK TO SAVEPOINT bulk_row`);
      results.push({ row: n + 1, ok: false, error: e.message, email: c.email });
    }
  }
  return { dryRun, sent: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, notEmailed: results.filter((r) => r.ok && r.notEmailed).length, results };
}
