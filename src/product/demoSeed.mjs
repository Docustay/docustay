// src/product/demoSeed.mjs — Launch step 8: the believable sample data of a demo workspace ("Maple Street Property Management"): a few lease addenda and applications waiting for signature, two drafts, and two published forms.
// Everything is made through Documents' front door (the built-in templates, the real draft and send functions), so the screens show exactly what a customer's would; the mail those sends make is held by the demo's mail guard
// (nothing leaves, nothing is recorded: the visitor never asked for these). Every item is written to docustay_demo_seed so "keep my work" removes exactly these. No executed documents are seeded on purpose: a signed document is a
// legal record the product refuses to delete, so the visitor signs one themselves, as the signer, in the tour — and that one is theirs to keep.
import { withTenant } from "../db/index.mjs";
import * as D from "../documents/frontDoor.mjs";

const PEOPLE = [
  ["Priya Nair", "priya.nair@example.com"], ["Marcus Bell", "marcus.bell@example.com"], ["Elena Ortiz", "elena.ortiz@example.com"],
  ["Tom Whitaker", "tom.whitaker@example.com"], ["Jordan Lee", "jordan@example.com"], ["Maple Street Office", "office@maplestreet.example"],
];
const today = () => new Date().toISOString().slice(0, 10);
// what a sender-filled box should say, by what it is called (the starters name them plainly)
const senderValue = (f) => {
  if ((f.type === "dropdown" || f.type === "multiselect") && Array.isArray(f.options) && f.options.length) return f.type === "multiselect" ? [String(f.options[0])] : String(f.options[0]);
  const l = String(f.label ?? f.name ?? "").toLowerCase();
  if (/date/.test(l)) return today();
  if (/rent|amount|deposit|fee/.test(l)) return "2,150";
  if (/address|premises|property|unit/.test(l)) return "12 Maple Street, Unit 4B";
  if (/term|month/.test(l)) return "12 months";
  return "Maple Street Property Management";
};

/** One document: from a built-in, filled, optionally sent. Returns the instance id (or null if it could not be made — a seed never fails the demo). */
async function makeDocument(tenantId, ownerId, { slug, title, people, send }) {
  try {
    const used = await withTenant(tenantId, (tx) => D.useBuiltin(tx, { tenantId, actorUserId: ownerId, slug, title }), { userId: ownerId });
    const instanceId = used.instanceId; if (!instanceId) return null;
    if (send) {
      await withTenant(tenantId, async (tx) => {
        const doc = await D.getPdfDocument(tx, { tenantId, instanceId });
        const fields = doc.body.fields.map((f) => (f.sender && !String(f.default ?? "").trim() ? { ...f, default: senderValue(f) } : f));
        const roles = doc.body.roles.map((r) => r.key);
        await D.savePdfDocument(tx, { tenantId, instanceId, actorUserId: ownerId, body: { ...doc.body, suggestions: undefined, fields }, parties: roles.map((r, i) => ({ role: r, name: people[i]?.[0] ?? `Signer ${i + 1}`, email: people[i]?.[1] ?? `signer${i + 1}@example.com`, action_role: "signer" })), sendOptions: { order: "parallel", expiry_days: 30 } });
      }, { userId: ownerId });
      await withTenant(tenantId, (tx) => D.sendPdfDocument(tx, { tenantId, instanceId, actorUserId: ownerId }), { userId: ownerId });
    }
    await withTenant(tenantId, (tx) => tx.query(`INSERT INTO keystone.docustay_demo_seed (tenant_id, kind, item_id) VALUES ($1, 'document', $2) ON CONFLICT DO NOTHING`, [tenantId, instanceId]), { userId: ownerId });
    return instanceId;
  } catch (e) { console.warn(`demo seed: "${title}" not made (${e?.message ?? e})`); return null; }
}

async function makeForm(tenantId, ownerId, { slug, link }) {
  try {
    const used = await withTenant(tenantId, (tx) => D.useBuiltin(tx, { tenantId, actorUserId: ownerId, slug }), { userId: ownerId });
    const templateId = used.templateId; if (!templateId) return null;
    await withTenant(tenantId, (tx) => D.publishForm(tx, { tenantId, templateId, slug: link, settings: { counterSign: { on: true, userId: ownerId } }, enabled: true }), { userId: ownerId });
    await withTenant(tenantId, (tx) => tx.query(`INSERT INTO keystone.docustay_demo_seed (tenant_id, kind, item_id) VALUES ($1, 'form', $2) ON CONFLICT DO NOTHING`, [tenantId, templateId]), { userId: ownerId });
    return templateId;
  } catch (e) { console.warn(`demo seed: form "${slug}" not made (${e?.message ?? e})`); return null; }
}

/** The whole seed. Resolves with what was made; never throws for one item failing (a missing converter, say, leaves that item out). */
export async function seedDemo({ tenantId, ownerId }) {
  const made = { documents: 0, forms: 0 };
  const docs = [
    { slug: "rental-application", title: "Rental application: Elena Ortiz", people: [PEOPLE[2], PEOPLE[5]], send: true },
    { slug: "lease-addendum", title: "Lease addendum: 12 Maple Street, Unit 4B", people: [PEOPLE[5], PEOPLE[0]], send: true },
    { slug: "lease-addendum", title: "Lease addendum: 8 Oak Court, Unit 2", people: [PEOPLE[5], PEOPLE[1]], send: true },   // sent last, so the newest message in the demo inbox is a three-field one a visitor can sign in seconds
    { slug: "photo-release", title: "Photo release: Maple Street open house", people: [], send: false },
    { slug: "rental-application", title: "Rental application: Tom Whitaker", people: [], send: false },
  ];
  for (const d of docs) if (await makeDocument(tenantId, ownerId, d)) made.documents += 1;
  for (const f of [{ slug: "move-in-move-out-checklist", link: "maple-street-move-in" }, { slug: "maintenance-request", link: "maple-street-maintenance" }]) if (await makeForm(tenantId, ownerId, f)) made.forms += 1;
  return made;
}
