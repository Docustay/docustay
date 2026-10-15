// Part 30 item 5 — DOWNLOAD LINKS FOR THE SIGNED COPY. With `download.link_days` above 0 the "signed copy" email carries a link instead of the PDF; the link belongs to ONE person on the send
// (their party row), works for that many days, and — with `download.require_code` — asks them for an emailed code first (the same check a signing page uses, re-asked after 30 minutes).
// ★ A link opens only the documents of the send it was made for (never another document in the organisation: file rows are tenant-wide, so membership is checked here), only once the send has
//   been executed, and every fetch is written to the audit log as `downloaded`.
import { languageFor } from "./signerLanguage.mjs";
import { forbidden, invalid, notFound, conflict } from "../http/errors.mjs";
import { mintLinkToken } from "../auth/linkToken.mjs";
import { ports } from "./ports.mjs";
import { documentsOfSend } from "./parties.mjs";
import { getDocumentSettings } from "./settings.mjs";
import { sendVerificationCode, verifyParty, maskEmail } from "./pdfVerify.mjs";
import { fetchArchivedPdf } from "./archive.mjs";
import { readFileBytes } from "./files.mjs";
import { recordAuditEvent } from "./auditTrail.mjs";
import { emit, userActor } from "../events/outbox.mjs";

export const DOWNLOAD_PURPOSE = "pdf_download";
const FRESH_MINUTES = 30;
const REFUSED = "That link is not valid. It may have expired — ask the sender to send you a new one.";

/** A link for one person to the sealed copy of a send, valid for `days` days. Returns {url, expiresAt}. */
export async function mintDownloadLink(tx, { tenantId, leadId, partyId, days }) {
  if (!Number.isInteger(days) || days < 1 || days > 365) throw invalid("days must be between 1 and 365", { field: "days" });
  const minted = await mintLinkToken(tx, { tenantId, purpose: DOWNLOAD_PURPOSE, subjectType: "document_instance", subjectId: leadId, issuedTo: partyId, ttlHours: days * 24 });
  const { publicBase } = await (await ports()).brand.get(tx, { tenantId });
  return { url: `${publicBase}/download?t=${encodeURIComponent(minted.presented)}`, expiresAt: minted.expiresAt };
}

async function context(tx, { leadId, partyId }) {
  const { rows: [party] } = await tx.query(`SELECT * FROM keystone.document_party WHERE id = $1 AND instance_id = $2`, [partyId, leadId]);
  const { rows: [lead] } = await tx.query(`SELECT id, title, state, send_options FROM keystone.document_instance WHERE id = $1 AND builder = 'pdf' AND archived_at IS NULL`, [leadId]);
  if (!party || !lead || lead.state !== "executed") throw forbidden(REFUSED);
  return { party, lead };
}
const fresh = (party) => party.verified_at && Date.now() - new Date(party.verified_at).getTime() < FRESH_MINUTES * 60_000;
const asCodeLead = (lead) => ({ ...lead, send_options: { ...(lead.send_options ?? {}), verification: "email_code" } });

/** What the download page shows: the title, who is offering it, and whether a code is needed first. Nothing about the document itself until the code (when asked for) is answered. */
export async function openDownload(tx, { tenantId, leadId, partyId }) {
  const { party, lead } = await context(tx, { leadId, partyId });
  const s = await getDocumentSettings(tx);
  const needsCode = s["download.require_code"] === true && !fresh(party) && Boolean(party.email);
  const { practiceName, logoUrl } = await (await ports()).brand.get(tx, { tenantId });
  const base = { title: lead.title, org: { name: practiceName, logoUrl }, ...(await signerLanguageView(tx, { lead, party })), needsCode, email: needsCode ? maskEmail(party.email) : null };
  if (needsCode) return { ...base, documents: [], certificate: false };
  const members = await documentsOfSend(tx, { instanceId: leadId });
  const { rows: [cert] } = await tx.query(`SELECT 1 AS x FROM keystone.document_file WHERE instance_id = $1 AND kind = 'certificate'`, [leadId]);
  return { ...base, documents: members.map((m, i) => ({ id: m.id, title: m.title, position: i + 1 })), certificate: Boolean(cert) };
}

export async function sendDownloadCode(tx, { tenantId, leadId, partyId }) {
  const { party, lead } = await context(tx, { leadId, partyId });
  if ((await getDocumentSettings(tx))["download.require_code"] !== true) throw conflict("this link does not ask for a code");
  return sendVerificationCode(tx, { tenantId, party, lead: asCodeLead(lead), title: lead.title });
}

export async function verifyDownloadCode(tx, { tenantId, leadId, partyId, code }) {
  const { party, lead } = await context(tx, { leadId, partyId });
  return verifyParty(tx, { tenantId, party: { ...party, verified_at: null }, lead: asCodeLead(lead), code });
}

/** The bytes of one signed document (`documentId`, default the first) or the certificate (`which: 'certificate'`). */
export async function readDownload(tx, { tenantId, leadId, partyId, documentId = null, which = "signed" }) {
  const { party, lead } = await context(tx, { leadId, partyId });
  const s = await getDocumentSettings(tx);
  if (s["download.require_code"] === true && party.email && !fresh(party)) throw forbidden("Enter the code first.");
  const members = await documentsOfSend(tx, { instanceId: leadId });
  let out;
  if (which === "certificate") {
    const { rows: [f] } = await tx.query(`SELECT id, name FROM keystone.document_file WHERE instance_id = $1 AND kind = 'certificate' ORDER BY created_at DESC LIMIT 1`, [leadId]);
    if (!f) throw notFound("There is no separate certificate for this document.");
    out = { bytes: (await readFileBytes(tx, { fileId: f.id })).bytes, name: f.name };
  } else {
    const target = documentId ?? members[0]?.id;
    const m = members.find((x) => x.id === target);
    if (!m) throw forbidden(REFUSED);
    const r = await fetchArchivedPdf(tx, { instanceId: m.id });
    out = { bytes: r.body, name: `${m.title} (signed).pdf` };
  }
  await recordAuditEvent(tx, { tenantId, instanceId: leadId, kind: "downloaded", actorRole: party.role, detail: { what: which } });
  await emit(tx, { tenantId, topic: "documents.document.downloaded", emittedBy: "documents", subjectType: "document", subjectId: leadId, actor: userActor(partyId), payload: { what: which } });
  return out;
}

/** A staff member shares the signed copy: a link for one person on the send (default: the first signer), valid `days` days. Only an executed document has one. */
export async function shareDownloadLink(tx, { tenantId, instanceId, partyId = null, days = 7 }) {
  const { rows: [i] } = await tx.query(`SELECT id, package_lead_id, state FROM keystone.document_instance WHERE id = $1 AND builder = 'pdf' AND archived_at IS NULL`, [instanceId]);
  if (!i) throw notFound("That document is not in this workspace.");
  if (i.state !== "executed") throw conflict("only a finished document has a signed copy to share");
  const leadId = i.package_lead_id ?? i.id;
  const { rows: [p] } = await tx.query(partyId
    ? `SELECT id, name FROM keystone.document_party WHERE id = $1 AND instance_id = $2`
    : `SELECT id, name FROM keystone.document_party WHERE instance_id = $1 AND action_role IN ('signer','approver') ORDER BY position, created_at LIMIT 1`, partyId ? [partyId, leadId] : [leadId]);
  if (!p) throw notFound("no such person on this document");
  const out = await mintDownloadLink(tx, { tenantId, leadId, partyId: p.id, days: Number(days) });
  return { url: out.url, expiresAt: out.expiresAt, forName: p.name };
}

const signerLanguageView = async (tx, { lead, party }) => { const { language, auto } = await languageFor(tx, { sendOptions: lead.send_options, party }); return { language, languageAuto: auto }; };
