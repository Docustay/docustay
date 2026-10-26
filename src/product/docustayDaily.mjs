// src/product/docustayDaily.mjs — THE ONCE-A-DAY CHECKS FOR ONE DOCUSTAY WORKSPACE (the maintainer, 21 Oct 2026; specs/v1/PRICING-INTEGRITY-SPEC.md). Run from the daily seat task (queue/tasks.mjs docustay_seat_log).
//   · the own-AI-key notice: a Free workspace that already holds its own key keeps it until the end of October; its Owners are told once now, and once more on the day it stops
//   · fair use: a Pro or Lifetime workspace past 50 team members or 2,000 documents in a month goes on the internal review list (REVIEW ONLY: nothing is ever blocked automatically)
// Each check is once per fact (the once-marker table), is written to be safe to repeat, and one failing never stops the next.
import { tellOwners, once } from "./docustayStripeNotices.mjs";
import { subRow } from "./docustay.mjs";
import { flagForReview } from "./docustayIntegrity.mjs";
import { sendCountForPeriod } from "../documents/api.mjs";
import { teamSeatUsage } from "../people/seats.mjs";
import { ownKeyState } from "../documents/engine/ai/gateway.mjs";

export const FAIR_USE = Object.freeze({ teamMembers: 50, documentsPerMonth: 2000, storageBytes: 10 * 1024 ** 3 });   // storage: 10 GB per workspace on ANY plan (the maintainer, 21 Oct, answer 6); review only, per-file size limits stay
const appBase = () => String(process.env.KEYSTONE_DOCUSTAY_APP_URL || process.env.KEYSTONE_PUBLIC_URL || "https://app.docustay.app").replace(/\/+$/, "");
const longDate = (d) => d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

export async function ownKeyNotices(tx, { tenantId, now = new Date() }) {
  const st = await ownKeyState(tx, { tenantId, now });
  if (!st.present || !st.freePlan || !st.until) return { sent: 0 };
  const day = st.until.toISOString().slice(0, 10), link = { text: "See the plans", url: `${appBase()}/billing` };
  if (st.usable) {
    if (!(await once(tx, tenantId, `own_key_kept:${day}`))) return { sent: 0 };
    return { sent: await tellOwners(tx, { tenantId, link, subject: "Your own AI key works until the end of the month", lines: [
      `Docustay's Free plan no longer includes using your own AI provider key. Yours keeps working until ${longDate(new Date(st.until.getTime() - 1))}.`,
      "After that, Docustay's own AI writer is used instead, with the Free plan's monthly allowance. Pay as you go, Pro and Lifetime include using your own key, if you want to keep it.",
      "Nothing is deleted. Your key stays saved." ] }) };
  }
  if (!(await once(tx, tenantId, `own_key_stopped:${day}`))) return { sent: 0 };
  return { sent: await tellOwners(tx, { tenantId, link, subject: "Your own AI key has stopped working on the Free plan", lines: [
    "Using your own AI key is part of Pay as you go, Pro and Lifetime. Docustay's own AI writer is being used now, with the Free plan's monthly allowance.",
    "Your key is still saved. It works again as soon as you choose a plan that includes it." ] }) };
}

/** Bytes a workspace has stored: its uploaded and generated documents, signer uploads and people attachments. */
export async function storedBytes(tx, tenantId) {
  const { rows: [r] } = await tx.query(`SELECT (SELECT COALESCE(SUM(byte_size), 0) FROM keystone.document_pdf WHERE tenant_id = $1)
    + (SELECT COALESCE(SUM(byte_size), 0) FROM keystone.document_file WHERE tenant_id = $1)
    + (SELECT COALESCE(SUM(size_bytes), 0) FROM keystone.document_upload WHERE tenant_id = $1)
    + (SELECT COALESCE(SUM(size_bytes), 0) FROM keystone.person_attachment WHERE tenant_id = $1) AS bytes`, [tenantId]);
  return Number(r?.bytes ?? 0);
}

export async function fairUseFlags(tx, { tenantId, now = new Date() }) {
  const flagged = [], run = (sql, p) => tx.query(sql, p);
  const stored = await storedBytes(tx, tenantId);
  if (stored > FAIR_USE.storageBytes && await flagForReview(run, { kind: "fair_use_storage", subject: tenantId, workspaceId: tenantId, detail: { storedGB: Math.round(stored / 1024 ** 3 * 10) / 10, lineGB: 10 } })) flagged.push("fair_use_storage");
  const sub = await subRow(tx, tenantId);
  if (!["docustay_pro", "docustay_lifetime"].includes(sub?.plan_key) || !["active", "trialing", "past_due"].includes(String(sub?.status))) return { flagged };
  const { staff } = await teamSeatUsage(tx);
  if (staff > FAIR_USE.teamMembers && await flagForReview(run, { kind: "fair_use_seats", subject: tenantId, workspaceId: tenantId, detail: { teamMembers: staff, line: FAIR_USE.teamMembers, plan: sub.plan_key } })) flagged.push("fair_use_seats");
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const docs = await sendCountForPeriod(tx, { tenantId, periodStart: start, periodEnd: end });
  if (docs > FAIR_USE.documentsPerMonth && await flagForReview(run, { kind: "fair_use_documents", subject: tenantId, workspaceId: tenantId, detail: { documentsThisMonth: docs, line: FAIR_USE.documentsPerMonth, plan: sub.plan_key } })) flagged.push("fair_use_documents");
  return { flagged };
}

/** All of today's checks for one workspace. Never throws. */
export async function dailyChecks(tx, { tenantId, now = new Date(), log = () => {} }) {
  const out = {};
  for (const [name, fn] of [["ownKey", ownKeyNotices], ["fairUse", fairUseFlags]]) {
    try { await tx.query("SAVEPOINT daily_check"); out[name] = await fn(tx, { tenantId, now }); await tx.query("RELEASE SAVEPOINT daily_check"); }
    catch (e) { try { await tx.query("ROLLBACK TO SAVEPOINT daily_check"); } catch { /* the transaction is already gone */ } log(`docustay daily ${name} ${tenantId}: ${e?.message ?? e}`); }
  }
  return out;
}

/** The email guard just paused this workspace (bounces or spam reports): its Owners are told in plain words, once; a spam-report pause is also put on the internal review list (review only). Never throws. */
export async function noteEmailPaused(tx, { tenantId, cause, reason }) {
  try {
    const { rows: [t] } = await tx.query(`SELECT product FROM keystone.tenant WHERE id = $1`, [tenantId]);
    if (t?.product !== "docustay") return { sent: 0 };
    if (cause === "spam_reports") await flagForReview((sql, p) => tx.query(sql, p), { kind: "complaints_paused", subject: tenantId, workspaceId: tenantId, detail: { reason: String(reason).slice(0, 200) } });
    if (!(await once(tx, tenantId, `email_paused:${new Date().toISOString().slice(0, 10)}`))) return { sent: 0 };
    const lines = cause === "spam_reports"
      ? ["Sending is paused for this workspace because people reported your emails as spam.", `${reason}.`, "Nothing is deleted and your signers can still open and sign what you already sent. Email support and we will look at it with you."]
      : ["Sending is paused for this workspace because too many of your emails bounced.", `${reason}.`, "Clean up the addresses that bounced, then resume sending in Settings, Email events."];
    return { sent: await tellOwners(tx, { tenantId, subject: "Sending is paused for your workspace", lines, link: { text: "Open Settings", url: `${appBase()}/settings` } }) };
  } catch (e) { console.error(`docustay email pause notice ${tenantId}: ${e?.message ?? e}`); return { sent: 0 }; }
}
