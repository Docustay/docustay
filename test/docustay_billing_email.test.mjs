// Launch Part 3 (13 Oct 2026) — A WORKSPACE'S SEPARATE BILLING EMAIL. Receipts and the failed-payment notice go to the owners AND to this address; nothing else does; one copy per business event.
// PROPERTY: with a billing email set, a paid invoice / a failed payment reaches every owner once AND the billing address once; with none set, behaviour is exactly as before; a billing address that is
// already an owner is not written to twice; a replay sends nothing more. Real database. Each negative carries its positive control.
// Run: node test/docustay_billing_email.test.mjs (local database)
import pg from "pg";
import { randomBytes } from "node:crypto";
import * as mail from "../src/mail/index.mjs";
import { withTenant } from "../src/db/index.mjs";
import { handleSubscriptionWebhook } from "../src/billing/webhook.mjs";
import { setBillingEmail, getBillingEmail } from "../src/product/docustayBillingContact.mjs";

let pass = 0, fail = 0;
const t = async (n, fn) => { try { await fn(); console.log("  ok", n); pass++; } catch (e) { console.log("  FAIL", n, "-", e.message); fail++; } };
const must = (c, m) => { if (!c) throw new Error(m); };
const adminUrl = process.env.KEYSTONE_ADMIN_URL ?? process.env.KEYSTONE_SEED_URL;
if (!adminUrl || !process.env.KEYSTONE_DATABASE_URL) { console.log("no database configured — NOT RUN"); process.exit(0); }
const admin = new pg.Client({ connectionString: adminUrl, ssl: process.env.PGSSLMODE === "disable" ? false : undefined });
await admin.connect();
const TAG = `be${randomBytes(3).toString("hex")}`;
const q = async (text, params) => (await admin.query(text, params)).rows;
const sent = [];
mail.installMailPorts({
  transport: { send: async (m) => { sent.push(m); return { ok: true, providerMessageId: "m", error: null }; }, configured: () => true },
  outside: async () => ({ ok: false, status: 404, body: {} }), providerKey: () => "re_test",
  environment: { route: ({ to, subject }) => ({ to, subject }) },
  product: () => ({ name: "Docustay", sender: { name: "Docustay", address: "hello@docustay.test" }, alertTo: "a@docustay.test", defaultDailyLimit: 500 }),
  brand: { get: async () => ({ orgName: "Acme" }) }, secrets: { seal: () => ({}), open: () => "" },
});
const as = (id, fn) => withTenant(id, (tx) => fn(tx), { userId: null });
process.env.KEYSTONE_DOCUSTAY_APP_URL = "https://app.docustay.test";
const invoice = (id) => ({ id, object: "invoice", subscription: `sub_${TAG}`, amount_paid: 2500, currency: "usd", number: `${TAG.toUpperCase()}-0001`, created: 1791763200, status_transitions: { paid_at: 1791763300 }, lines: { data: [{ period: { start: 1791763200, end: 1794441600 } }] } });
const paid = (eid, inv) => ({ id: eid, type: "invoice.paid", created: Math.floor(Date.now() / 1000), data: { object: inv } });
const failedEv = (eid) => ({ id: eid, type: "invoice.payment_failed", created: Math.floor(Date.now() / 1000), data: { object: { id: `in_f_${eid}`, subscription: `sub_${TAG}` } } });
const to = (re) => sent.filter((m) => re.test(m.subject ?? "")).map((m) => m.to).sort();
const ownerA = `owner-${TAG}@example.test`, ownerB = `admin-${TAG}@example.test`, bill = `finance-${TAG}@example.test`;
let a;
console.log("\n=== Billing email ===");
try {
  a = (await q(`INSERT INTO keystone.tenant (name, slug, is_platform, timezone, status, product) VALUES ($1,$1,false,'UTC','active','docustay') RETURNING id`, [TAG]))[0].id;
  await q(`INSERT INTO keystone.app_user (tenant_id, display_name, email, role, staff_role) VALUES ($1,'Owen',$2,'staff','owner')`, [a, ownerA]);
  await q(`INSERT INTO keystone.app_user (tenant_id, display_name, email, role, staff_role) VALUES ($1,'Ada',$2,'staff','admin')`, [a, ownerB]);
  await q(`INSERT INTO keystone.workbench_subscription (tenant_id, plan_key, status, stripe_subscription_id) VALUES ($1,'docustay_pro','active',$2)`, [a, `sub_${TAG}`]);

  await t("with no billing email set, a receipt goes to the owner and admin only (the unchanged behaviour)", async () => {
    await as(a, (tx) => handleSubscriptionWebhook(tx, paid(`evt_${TAG}_0`, invoice(`in_${TAG}_0`)), { tenantId: a }));
    const r = to(/receipt/i); must(r.length === 2 && r.includes(ownerA) && r.includes(ownerB), `got ${r}`);
  });
  await t("saving a billing email: it is stored lower-cased and read back; a bad address is refused (positive control: a good one saved)", async () => {
    const s = await as(a, (tx) => setBillingEmail(tx, { tenantId: a, email: `  Finance-${TAG}@Example.test ` }));
    must(s.email === bill, `stored ${s.email}`);
    must((await as(a, (tx) => getBillingEmail(tx, { tenantId: a }))) === bill, "read back");
    let refused = null; try { await as(a, (tx) => setBillingEmail(tx, { tenantId: a, email: "not an email" })); } catch (e) { refused = e.message; }
    must(refused && /valid email/i.test(refused), `refused: ${refused}`);
    must((await as(a, (tx) => getBillingEmail(tx, { tenantId: a }))) === bill, "the bad value changed nothing");
  });
  await t("with a billing email set, the next receipt goes to the owner, the admin AND the billing address — once each", async () => {
    sent.length = 0;
    await as(a, (tx) => handleSubscriptionWebhook(tx, paid(`evt_${TAG}_1`, invoice(`in_${TAG}_1`)), { tenantId: a }));
    const r = to(/receipt/i); must(r.length === 3 && r.includes(bill) && r.includes(ownerA) && r.includes(ownerB), `got ${r}`);
  });
  await t("a replay of the same Stripe event sends nothing more (positive control above: three were sent)", async () => {
    sent.length = 0;
    const r = await as(a, (tx) => handleSubscriptionWebhook(tx, paid(`evt_${TAG}_1`, invoice(`in_${TAG}_1`)), { tenantId: a }));
    must(r.reason === "duplicate_event" && sent.length === 0, `${JSON.stringify(r)} ${sent.length}`);
  });
  await t("a failed payment reaches the owners and the billing address once each", async () => {
    sent.length = 0;
    await as(a, (tx) => handleSubscriptionWebhook(tx, failedEv(`evt_${TAG}_f`), { tenantId: a }));
    const r = to(/didn.t go through/i); must(r.length === 3 && r.includes(bill), `got ${r}`);
  });
  await t("a billing email that IS one of the owners is not written to twice", async () => {
    await as(a, (tx) => setBillingEmail(tx, { tenantId: a, email: ownerA }));
    sent.length = 0;
    await as(a, (tx) => handleSubscriptionWebhook(tx, paid(`evt_${TAG}_2`, invoice(`in_${TAG}_2`)), { tenantId: a }));
    const r = to(/receipt/i); must(r.length === 2 && r.filter((x) => x === ownerA).length === 1, `got ${r}`);
  });
  await t("removing the billing email (empty) puts things back: owners only", async () => {
    const s = await as(a, (tx) => setBillingEmail(tx, { tenantId: a, email: "" })); must(s.email === null, "removed");
    sent.length = 0;
    await as(a, (tx) => handleSubscriptionWebhook(tx, paid(`evt_${TAG}_3`, invoice(`in_${TAG}_3`)), { tenantId: a }));
    const r = to(/receipt/i); must(r.length === 2 && !r.includes(bill), `got ${r}`);
  });
} finally {
  if (a) { for (const tb of ["billing_event", "tenant_setting", "workbench_subscription", "audit_entry", "app_user"]) await admin.query(`DELETE FROM keystone.${tb} WHERE tenant_id = $1`, [a]).catch(() => {}); await admin.query(`DELETE FROM keystone.tenant WHERE id = $1`, [a]).catch(() => {}); }
  await admin.end();
}
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
