// Part 29 follow-up (item 5) — SELF-HOSTED PRO, PAID: a paid self-host subscription makes a licence key by itself; renewals extend it; a cancelled subscription ends it. Plus the offline usage report.
// Plain words: the buyer pays on Stripe; Stripe tells us (a webhook); we make the key, keep only its fingerprint (hash), and email the key ONCE from the Docustay address. The key is never shown again anywhere.
// Events handled (only those carrying docustay_kind = selfhost, stamped by us on the Checkout and on the subscription): checkout.session.completed → issue + email · invoice.paid → extend to the paid period's end · customer.subscription.deleted → end.
import { docustayFrame } from "../email/docustayBilling.mjs";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { issueLicense } from "./docustayLicense.mjs";
import { invalid } from "../http/errors.mjs";
import { installVersion } from "./installVersion.mjs";
import * as mail from "../mail/index.mjs";
import { esignExecutionCount, sendCountForPeriod } from "../documents/api.mjs";

const DAY = 86_400_000;
const GRACE_DAYS = 14;   // a late renewal does not switch a install off the day the year ends
const metaOf = (o = {}) => ({ ...(o.metadata ?? {}), ...(o.subscription_details?.metadata ?? {}), ...(o.parent?.subscription_details?.metadata ?? {}) });

export const isSelfhostEvent = (event) => metaOf(event?.data?.object).docustay_kind === "selfhost";

async function remember(tx, event, tenantId) {
  const { rowCount } = await tx.query(`INSERT INTO keystone.billing_event (event_id, tenant_id, type) VALUES ($1,$2,$3) ON CONFLICT (event_id) DO NOTHING`, [event.id, tenantId, event.type]);
  return rowCount === 1;
}

async function emailKey(tx, { tenantId, to, key, expiresAt }) {
  const base = (process.env.KEYSTONE_DOCUSTAY_APP_URL || "https://docustay.app").replace(/\/+$/, "");
  const until = expiresAt.toISOString().slice(0, 10);
  // The buyer has no Docustay account to hold a language, so this one is English; the frame (white card, wordmark, one button, plain-text twin, dark mode) is Docustay's own.
  const { text, html } = docustayFrame({
    preheader: "Your licence key is inside. Keep this email safe.", heading: "Your Docustay self-hosting licence key",
    intro: ["Thank you for choosing Docustay Pro for your own server.", "Your licence key (shown only in this email — keep it safe):"], code: key,
    after: [`Put it in your install's .env as DOCUSTAY_LICENSE_KEY=${key} and restart: the install downloads the Pro add-on with this key the first time it starts. It covers one install and is valid until ${until}; it renews itself each year while your subscription is paid.`,
      `The licence is for use in your own business. It does not cover embedding Docustay in a product you sell, white-labelling or resale; those need a commercial licence (${base}/legal/licensing).`],
    button: { label: "Open the setup guide", url: `${base}/self-host` },
  });
  return mail.sendMail(tx, { tenantId, to, purpose: "platform", product: "docustay", subject: "Your Docustay self-hosting licence key", text, html });
}

/** Apply one verified self-hosted-purchase event inside the platform organisation's tenant transaction. */
export async function applySelfhostEvent(tx, event, { tenantId }) {
  if (!(await remember(tx, event, tenantId))) return { applied: false, reason: "duplicate_event", type: event.type, selfhost: true };
  const o = event.data?.object ?? {};
  if (event.type === "checkout.session.completed") {
    if (o.mode !== "subscription") return { applied: false, reason: "not_a_subscription", selfhost: true };
    const sub = o.subscription ?? null, session = o.id;
    const to = String(o.customer_details?.email ?? o.customer_email ?? metaOf(o).buyer_email ?? "").trim();
    if (!to) return { applied: false, reason: "no_buyer_email", selfhost: true };
    const { rows: [already] } = await tx.query(`SELECT 1 FROM keystone.docustay_license WHERE tenant_id = $1 AND note LIKE $2 LIMIT 1`, [tenantId, `selfhost session=${session} %`]);
    if (already) return { applied: false, reason: "already_issued", selfhost: true };
    const expiresAt = new Date(Date.now() + (365 + GRACE_DAYS) * DAY);
    const { key } = await issueLicense(tx, { tenantId, expiresAt, note: `selfhost session=${session} sub=${sub} email=${to.toLowerCase()}` });
    const sent = await emailKey(tx, { tenantId, to, key, expiresAt });
    return { applied: true, selfhost: true, type: event.type, issued: true, email: sent.status };
  }
  const sub = o.subscription ?? (event.type === "customer.subscription.deleted" ? o.id : null) ?? o.parent?.subscription_details?.subscription ?? null;
  if (!sub) return { applied: false, reason: "no_subscription", selfhost: true };
  if (event.type === "invoice.paid") {
    const end = Math.max(0, ...(o.lines?.data ?? []).map((l) => l.period?.end ?? 0));
    if (!end) return { applied: false, reason: "no_period", selfhost: true };
    const until = new Date(end * 1000 + GRACE_DAYS * DAY);
    const { rowCount } = await tx.query(`UPDATE keystone.docustay_license SET expires_at = GREATEST(expires_at, $3), revoked_at = NULL WHERE tenant_id = $1 AND note LIKE $2`, [tenantId, `% sub=${sub} %`, until]);
    return { applied: rowCount > 0, selfhost: true, type: event.type, extended: rowCount };
  }
  if (event.type === "customer.subscription.deleted") {
    const { rowCount } = await tx.query(`UPDATE keystone.docustay_license SET revoked_at = COALESCE(revoked_at, now()) WHERE tenant_id = $1 AND note LIKE $2`, [tenantId, `% sub=${sub} %`]);
    return { applied: rowCount > 0, selfhost: true, type: event.type, revoked: rowCount };
  }
  return { applied: false, reason: "unhandled_event_type", type: event.type, selfhost: true };
}

// ── the offline usage report ──────────────────────────────────────────────────────────────────────
const COUNT_KEYS = ["documentsSentThisMonth", "documentsSigned", "workspaces", "users", "uptimeDays"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What an install downloads in Settings and sends us by hand when it cannot reach us: the same five numbers the daily ping carries, for the signed-in workspace — never a document, name, email or address. */
async function buildUsageReport(tx, { tenantId, installId, version = null, startedAt = Date.now() }) {
  const now = new Date(), start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const users = Number((await tx.query(`SELECT count(*)::int n FROM keystone.app_user WHERE role = 'staff' AND archived_at IS NULL`)).rows[0].n);
  const counts = {
    documentsSentThisMonth: await sendCountForPeriod(tx, { tenantId, periodStart: start, periodEnd: end }),
    documentsSigned: await esignExecutionCount(tx, { tenantId, periodStart: new Date(0), periodEnd: new Date(Date.now() + DAY) }),
    workspaces: 1, users, uptimeDays: Math.max(0, Math.floor((Date.now() - startedAt) / DAY)),
  };
  return { kind: "docustay-usage-report", v: 1, installId, version, generatedAt: now.toISOString(), counts };
}

/** What `/api/public/docustay/usage-report` does with an uploaded file: only the known fields are read, exactly like a ping. Returns the install's record. */
export function cleanUsageReport(raw) {
  let r = raw;
  if (typeof r === "string") { try { r = JSON.parse(r); } catch { throw invalid("That file is not a Docustay usage report (it is not readable JSON)."); } }
  if (!r || typeof r !== "object" || r.kind !== "docustay-usage-report" || r.v !== 1) throw invalid("That file is not a Docustay usage report.");
  if (typeof r.installId !== "string" || !UUID.test(r.installId)) throw invalid("That report has no valid install id.");
  const counts = {};
  for (const k of COUNT_KEYS) { const v = r.counts?.[k]; if (Number.isSafeInteger(v) && v >= 0 && v < 1e9) counts[k] = v; }
  if (Object.keys(counts).length === 0) throw invalid("That report carries none of the usage numbers.");
  const version = typeof r.version === "string" && /^[0-9A-Za-z.+-]{1,32}$/.test(r.version) ? r.version : null;
  return { installId: r.installId, version, counts };
}

const STARTED = Date.now();
/** The install's own random id — the same file the daily ping reads (docustay/selfhost/usage-ping.mjs), so a downloaded report and a ping are the same install. */
function installIdOnDisk() {
  for (const dir of [process.env.KEYSTONE_DATA_DIR || "/data", path.join(os.tmpdir(), "docustay")]) {
    try { mkdirSync(dir, { recursive: true }); const f = path.join(dir, "install-id"); if (!existsSync(f)) writeFileSync(f, randomUUID()); return readFileSync(f, "utf8").trim(); } catch { /* try the next place */ }
  }
  return randomUUID();
}
export const usageReportFor = (tx, { tenantId }) => buildUsageReport(tx, { tenantId, installId: installIdOnDisk(), version: installVersion(), startedAt: STARTED });

/** What the install's admin sees about its own licence (Settings, Usage): the state of the held note and the shared-key warning the last check brought back. Hosted answers { selfHost: false }. Reads files only; sends nothing. */
export async function licenceStatusFor() {
  if (process.env.KEYSTONE_SELF_HOST !== "1") return { selfHost: false };
  const { selfHostProNote } = await import("../documents/addon.mjs");
  const dir = process.env.KEYSTONE_DATA_DIR || "/data";
  let notice = null; try { notice = JSON.parse(readFileSync(path.join(dir, "entitlement.json"), "utf8")).notice ?? null; } catch { /* no note held */ }
  const n = selfHostProNote();
  return { selfHost: true, keySet: Boolean(process.env.DOCUSTAY_LICENSE_KEY), state: n.ok ? "valid" : (n.reason === "no_note" || n.reason === "no_public_key" ? "none" : n.reason), until: n.ok ? n.note.expiresAt : null, notice,
    role: process.env.DOCUSTAY_INSTANCE_ROLE === "test" ? "test" : "production" };
}
