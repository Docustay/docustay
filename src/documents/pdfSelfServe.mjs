// src/documents/pdfSelfServe.mjs — THE PUBLIC LINK: ANYONE FILLS IN AND SIGNS A TEMPLATE (QUEUE §23.5.7). A practice turns it on for one template (one person signing) and shares `/s/<name>`; each visitor types a name and email and is taken
// straight to their OWN copy to fill in and sign — no account, no email round-trip. The route in front of this does the rate limiting and the bot check; this file does the rest.
// ★ The document is made and sent AS THE PRACTICE OWNER (through the people port) so it has an author: the owner is notified when it is signed and the sealed copy is archived under them.
// ★ The visitor's address is not verified (they are on the page); it is where the signed copy is mailed if the practice has that on. That is why the route limits and bot-checks, and why a link can be switched off at once.
import { invalid, notFound, dependency } from "../http/errors.mjs";
import { ports } from "./ports.mjs";
import { parsePdfBodyData } from "./pdfBody.mjs";
import { createPdfFromTemplate, savePdfDocument } from "./pdfDocs.mjs";
import { sendPdfDocument, signNowLink } from "./pdfSend.mjs";
import { assertUsable } from "./pdfTemplates.mjs";

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

async function templateBySlug(tx, slug) {
  const s = String(slug ?? "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{2,58}[a-z0-9]$/.test(s)) return null;
  const { rows: [t] } = await tx.query(
    `SELECT id, name, builder, body, active, approval_status, self_serve_enabled FROM keystone.document_template WHERE builder = 'pdf' AND lower(self_serve_slug) = $1 AND self_serve_enabled AND active AND approval_status = 'approved'`, [s]);
  if (!t) return null;
  try { if (parsePdfBodyData(t.body).roles.length !== 1) return null; } catch { return null; }
  return t;
}

/** What the public page shows: the document's name and who is offering it. null for anything that is not a live link (the page shows the same "no such page" for all of them). */
export async function readSelfServe(tx, { tenantId, slug }) {
  const t = await templateBySlug(tx, slug);
  if (!t) return null;
  const body = parsePdfBodyData(t.body);
  const { practiceName, logoUrl } = await (await ports()).brand.get(tx, { tenantId });
  return { title: t.name, org: { name: practiceName, logoUrl }, pages: body.file.page_count, seat: body.roles[0].label };
}

/** Who the documents are made as: the practice's owner (via the people port). Read with no viewer, then the start runs AS that person. */
export async function selfServeOwner(tx) {
  const P = await ports();
  const id = await P.people.practiceOwner?.(tx);
  if (!id) throw dependency("This practice has no owner set up to receive signed documents, so the link cannot be used yet.");
  return id;
}

/** One visitor starts: make their document from the template, send it "in person", and hand back the link that opens it on THIS device (under the key `presented`). */
export async function startSelfServe(tx, { tenantId, ownerId, slug, name, email }) {
  const person = String(name ?? "").trim();
  if (!person) throw invalid("Type your name to begin.", { field: "name" });
  if (person.length > 120) throw invalid("That name is too long.", { field: "name" });
  const address = String(email ?? "").trim().toLowerCase();
  if (!EMAIL.test(address)) throw invalid("Enter a valid email address — your signed copy is sent there.", { field: "email" });
  const t = await templateBySlug(tx, slug);
  if (!t) throw notFound("That page does not exist.");
  assertUsable(t);
  const seat = parsePdfBodyData(t.body).roles[0].key;
  const made = await createPdfFromTemplate(tx, { tenantId, templateId: t.id, actorUserId: ownerId, title: `${t.name} — ${person}` });
  await savePdfDocument(tx, { tenantId, actorUserId: ownerId, instanceId: made.instanceId, parties: [{ role: seat, name: person, email: address, action_role: "signer" }], sendOptions: { in_person: [seat], order: "parallel", expiry_days: 1, verification: "none", self_serve: true } });
  await sendPdfDocument(tx, { tenantId, instanceId: made.instanceId, actorUserId: ownerId, forVisitor: true });
  const { rows: [p] } = await tx.query(`SELECT id FROM keystone.document_party WHERE instance_id = $1`, [made.instanceId]);
  const { presented } = await signNowLink(tx, { tenantId, instanceId: made.instanceId, partyId: p.id });
  return { presented };
}
