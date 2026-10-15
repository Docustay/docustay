// Part 30 test harness — the same real-database, fake-ports setup test/s23_pdf_api.test.mjs uses, shared so every Part 30 test starts the same way.
// Run with the p29-test env (KEYSTONE_ADMIN_URL / KEYSTONE_DATABASE_URL pointing at a local scratch database).
import pg from "pg";
import { randomBytes } from "node:crypto";
import { useOwnSigningCert } from "./ownSigningCert.mjs";
import { contractPdf } from "./samplePdfs.mjs";

export async function setup({ converter = null, entitlements = null, payments = null, access = null } = {}) {
  const adminUrl = process.env.KEYSTONE_ADMIN_URL ?? process.env.KEYSTONE_SEED_URL;
  if (!adminUrl || !process.env.KEYSTONE_DATABASE_URL) { console.log("no database configured — NOT RUN"); process.exit(0); }
  useOwnSigningCert();
  const { withTenant } = await import("../../src/db/index.mjs");
  const { installDocumentsPorts } = await import("../../src/documents/ports.mjs");
  const Dreal = await import("../../src/documents/frontDoor.mjs");
  const admin = new pg.Client({ connectionString: adminUrl, ssl: process.env.PGSSLMODE === "disable" ? false : undefined }); await admin.connect();
  const TAG = `p30${randomBytes(3).toString("hex")}`;
  const q = async (text, params) => (await admin.query(text, params)).rows;
  const store = new Map(), sent = [], mails = [];
  const ctx = { admin, TAG, q, store, sent, mails, tenant: null, staffId: null, withTenant, strictPeople: false };
  const D = new Proxy(Dreal, { get: (o, k) => (typeof o[k] === "function" ? (first, ...rest) => (first === admin ? withTenant(ctx.tenant, (tx) => o[k](tx, ...rest), { userId: ctx.staffId }) : o[k](first, ...rest)) : o[k]) });
  ctx.D = D;
  const staffIdOf = () => ctx.staffId;
  const staffId = null; // (the ports block below closes over `ctx.staffId` through staffIdOf)
  installDocumentsPorts({
  mailer: { sendSigningEmail: async (m) => { sent.push(m); return { status: "sent", providerMessageId: `m${sent.length}`, error: null }; }, renderSigningEmail: async () => ({ subject: "s", html: "h", text: "t" }), send: async (m) => { mails.push(m); return { status: "sent", providerMessageId: `s${mails.length}` }; }, routeRecipient: (x) => x, platformSender: () => ({ name: "P", address: "p@x.test" }), domains: {} },
  brand: { get: async () => ({ practiceName: "Bright Path", tenantName: "Bright Path", logoUrl: null, timezone: "America/Los_Angeles", publicBase: "https://x.test", slug: "x" }) },
  people: { byIds: async (tx, ids) => { if (ctx.strictPeople) return (await tx.query(`SELECT id, display_name, email, role FROM keystone.app_user WHERE id = ANY($1::uuid[])`, [ids ?? []])).rows; return (ids ?? []).map((id) => ({ id, display_name: "Staff Admin", email: "staff@example.invalid", role: "staff" })); }, guardianOf: async () => null, ownerOf: async () => null, practiceOwner: async () => ctx.staffId, search: async () => [] },
  facts: { gather: async () => ({}), gatherBatch: async () => ({ tenant: {}, settings: {}, people: new Map() }) },
  price: { current: async () => null }, usage: { recordEsign: async () => {} }, items: { repointAgreementRequirements: async () => {} }, notices: { sentToEmails: async () => [] }, access: access ?? { assertMay: async () => {} },
  secrets: { seal: () => ({ envelope: {}, fingerprint: "f", kekVersion: 1 }), open: () => "" },
  files: { configured: () => true, bucket: () => "test", put: async ({ tenantId, id, bytes }) => { const key = `t/${tenantId}/document_file/${id}`; store.set(key, Buffer.from(bytes)); return { key }; }, get: async ({ key }) => store.get(key), delete: async ({ key }) => { store.delete(key); } },
  converter: converter ?? { available: () => false, toPdf: async () => { throw new Error("no"); } },
  ...(entitlements ? { entitlements } : {}),
  ...(payments ? { payments } : {}),
  });
  // a tenant with a general category, an agreement type and a staff admin who may delete (so a draft can be cleaned up)
  ctx.tenant = (await q(`INSERT INTO keystone.tenant (name, slug, is_platform, timezone, status) VALUES ($1,$1,false,'America/Los_Angeles','active') RETURNING id`, [TAG]))[0].id;
  await admin.query(`SELECT set_config('keystone.tenant_id', $1, false)`, [ctx.tenant]);
  const cat = (await q(`INSERT INTO keystone.document_category (tenant_id, key, label) VALUES ($1,'general','General') RETURNING id`, [ctx.tenant]))[0].id;
  await q(`INSERT INTO keystone.document_type (tenant_id, key, label, category_id, sub_category, signer_config) VALUES ($1,'agreement','Agreement',$2,'agreement','CLIENT_ONLY')`, [ctx.tenant, cat]);
  ctx.staffId = (await q(`INSERT INTO keystone.app_user (tenant_id, email, display_name, role, staff_role) VALUES ($1,$2,'Staff Admin','staff','admin') RETURNING id`, [ctx.tenant, `staff.${TAG}@example.invalid`]))[0].id;
  const roleId = (await q(`INSERT INTO keystone.role (tenant_id, key, label, is_builtin, rank) VALUES ($1,'t_admin','Admin',false,'admin') RETURNING id`, [ctx.tenant]))[0].id;
  await q(`INSERT INTO keystone.role_permission (tenant_id, role_id, object, verb, scope) VALUES ($1,$2,'document','delete','everything'), ($1,$2,'person','delete','everything')`, [ctx.tenant, roleId]);
  await q(`INSERT INTO keystone.user_role (tenant_id, user_id, role_id) VALUES ($1,$2,$3)`, [ctx.tenant, ctx.staffId, roleId]);
  ctx.contractPdf = contractPdf;
  ctx.close = async () => { await admin.end(); };
  return ctx;
}
export const makeCounter = () => { let pass = 0, fail = 0; const t = async (n, fn) => { try { await fn(); console.log("  ok", n); pass++; } catch (e) { console.log("  FAIL", n, "-", e.message); fail++; } }; return { t, done: () => { console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); } }; };
export const must = (c, m) => { if (!c) throw new Error(m); };
