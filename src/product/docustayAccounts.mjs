// Part 29 step 2 — Docustay's own customers and their money, seen from inside the PLATFORM organisation (Docustay) by the people named in the setting `platform.docustay_viewers`, and by nobody else.
// Every read goes through the database's own gate (`keystone.docustay_may_view()` inside `keystone.docustay_workspaces()` and the three `docustay_*_effective` views): a person who is not listed gets zero rows, whatever this file does.
import { forbidden, invalid } from "../http/errors.mjs";
import { issueLicense } from "./docustayLicense.mjs";

/** Is the signed-in person allowed to see Docustay customers? (the same function the views use) */
async function mayView(tx) {
  const { rows } = await tx.query(`SELECT keystone.docustay_may_view() AS ok`);
  return rows[0]?.ok === true;
}
async function assertMayView(tx) { if (!(await mayView(tx))) throw forbidden("refused: Docustay customers are visible only to the people the platform names"); }

/** Every Docustay workspace — one row each: who, which plan, in what state, the owner's contact, how busy. */
export async function listCustomers(tx) {
  await assertMayView(tx);
  const { rows } = await tx.query(`SELECT * FROM keystone.docustay_workspaces() ORDER BY created_at DESC`);
  return rows.map((r) => ({ workspaceId: r.tenant_id, slug: r.slug, name: r.name, createdAt: r.created_at, plan: ({ docustay_pro: "Pro", docustay_payg: "Pay as you go", docustay_lifetime: "Lifetime" })[r.plan_key] ?? "Free", status: r.status, interval: r.billing_interval, founders: r.founders_price === true,
    owner: { name: r.owner_name, email: r.owner_email }, stripeCustomerId: r.stripe_customer_id, renewsAt: r.current_period_end, paymentProblem: r.past_due_since != null, people: r.people, documentsThisMonth: r.documents_this_month }));
}

/** What Docustay earned from its own platform fee on payment fields in a calendar month (default: this one), one line per currency. Totals only — never a customer's payment amount, a workspace or a person (the reading role is granted the fee columns alone). */
export async function platformFee(tx, { now = new Date() } = {}) {
  await assertMayView(tx);
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const { rows } = await tx.query(`SELECT * FROM keystone.docustay_platform_fee($1, $2)`, [from, to]);
  return { month: from.toISOString().slice(0, 7), byCurrency: rows.map((r) => ({ currency: r.currency, feeMinor: Number(r.fee_minor), refundedMinor: Number(r.fee_refunded_minor), netMinor: Number(r.fee_minor) - Number(r.fee_refunded_minor), payments: r.payments })) };
}

/** Docustay's invoices and payments, from Stripe's mirror, tagged origin = docustay so no the platform screen mistakes them for coaching money. */
export async function listMoney(tx) {
  await assertMayView(tx);
  const [inv, pay, sub] = await Promise.all([
    tx.query(`SELECT * FROM keystone.docustay_invoice_effective ORDER BY created_at DESC LIMIT 500`),
    tx.query(`SELECT * FROM keystone.docustay_payment_effective ORDER BY created_at DESC LIMIT 500`),
    tx.query(`SELECT * FROM keystone.docustay_subscription_effective ORDER BY current_period_end DESC LIMIT 500`)]);
  return { invoices: inv.rows, payments: pay.rows, subscriptions: sub.rows, platformFee: await platformFee(tx) };
}

/** One Accounts row per Docustay workspace in the platform organisation (type "Docustay customer"), kept current each time the list is opened. Never makes a person, never a coaching client. */
export async function syncAccounts(tx, { tenantId }) {
  const customers = await listCustomers(tx);
  let made = 0, updated = 0;
  for (const c of customers) {
    const desc = `Docustay ${c.plan}${c.interval ? ` (${c.interval}ly)` : ""}${c.founders ? " · founders' price" : ""} · ${c.status ?? "no subscription"}${c.paymentProblem ? " · payment problem" : ""}`;
    const upd = await tx.query(`UPDATE keystone.account SET name=$3, email=$4, stripe_customer_id=$5, description=$6, status=$7, updated_at=now() WHERE tenant_id=$1 AND customer_tenant_id=$2 RETURNING id`,
      [tenantId, c.workspaceId, c.name, c.owner.email, c.stripeCustomerId, desc, c.status === "canceled" ? "closed" : "active"]);
    if (upd.rowCount) { updated += 1; continue; }
    await tx.query(`INSERT INTO keystone.account (tenant_id, name, customer_tenant_id, status, account_type, email, stripe_customer_id, description, source) VALUES ($1,$2,$3,$7,'docustay_customer',$4,$5,$6,'docustay')`,
      [tenantId, c.name, c.workspaceId, c.owner.email, c.stripeCustomerId, desc, c.status === "canceled" ? "closed" : "active"]);
    made += 1;
  }
  const installs = await syncInstallAccounts(tx, { tenantId });
  return { customers: customers.length, made, updated, installs };
}

/** Self-hosted installs that have pinged (counts only) and whether a Pro licence is bound to them. Read-only. */
export async function listInstalls(tx) {
  await assertMayView(tx);
  const { rows } = await tx.query(
    `SELECT i.install_id, i.first_seen_at, i.last_seen_at, i.version, i.counts, i.pings,
            EXISTS (SELECT 1 FROM keystone.docustay_license l WHERE l.tenant_id = i.tenant_id AND l.install_id = i.install_id AND l.revoked_at IS NULL AND l.expires_at > now()) AS pro
       FROM keystone.docustay_install i ORDER BY i.last_seen_at DESC LIMIT 500`);
  return rows.map((r) => ({ installId: r.install_id, firstSeenAt: r.first_seen_at, lastSeenAt: r.last_seen_at, version: r.version, counts: r.counts, pings: r.pings, pro: r.pro }));
}

/** Issue a Pro licence key (viewer only). The key is returned ONCE and only its hash is stored. */
export async function issueLicenseForViewer(tx, { tenantId, expiresAt, note = null, subscriptionId = null }) {
  await assertMayView(tx);
  const when = new Date(expiresAt);
  if (Number.isNaN(+when) || +when <= Date.now()) throw invalid("expiresAt must be a future date");
  return issueLicense(tx, { tenantId, subscriptionId, expiresAt: when, note });
}

/** One read-only Accounts row per self-hosted install ("Docustay self-hosted"), refreshed with the list. */
async function syncInstallAccounts(tx, { tenantId }) {
  const installs = await listInstalls(tx);
  for (const i of installs) {
    const tag = `selfhost:${i.installId}`;
    const desc = `Self-hosted · ${i.pro ? "Pro licence" : "free"} · version ${i.version ?? "?"} · ${i.counts?.users ?? "?"} users · ${i.counts?.documentsSentThisMonth ?? "?"} documents this month · last seen ${new Date(i.lastSeenAt).toISOString().slice(0, 10)}`;
    const upd = await tx.query(`UPDATE keystone.account SET description=$3, updated_at=now() WHERE tenant_id=$1 AND source=$2 RETURNING id`, [tenantId, tag, desc]);
    if (!upd.rowCount) await tx.query(`INSERT INTO keystone.account (tenant_id, name, status, account_type, description, source) VALUES ($1,$2,'active','docustay_selfhost',$3,$4)`, [tenantId, `Self-hosted install ${i.installId.slice(0, 8)}`, desc, tag]);
  }
  return installs.length;
}

/** The Docustay panel on one Accounts record (read-only): a hosted workspace's plan, status, renewal, founders' flag and people, or a self-hosted install's counts. Not a Docustay account → { docustay: false } (no data). */
export async function accountPanel(tx, { accountId }) {
  await assertMayView(tx);
  const { rows: [a] } = await tx.query(`SELECT id, account_type, customer_tenant_id, source FROM keystone.account WHERE id = $1`, [accountId]);
  if (!a || !["docustay_customer", "docustay_selfhost"].includes(a.account_type)) return { docustay: false };
  if (a.account_type === "docustay_customer") {
    const c = (await listCustomers(tx)).find((x) => x.workspaceId === a.customer_tenant_id);
    return c ? { docustay: true, kind: "hosted", ...c } : { docustay: true, kind: "hosted", missing: true };
  }
  const installId = String(a.source ?? "").replace(/^selfhost:/, "");
  const i = (await listInstalls(tx)).find((x) => x.installId === installId);
  return { docustay: true, kind: "selfhosted", ...(i ?? { installId, missing: true }) };
}
