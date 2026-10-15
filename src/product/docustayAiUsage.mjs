// The Docustay owner's AI cost screen (Platform > AI usage): the ceiling bar, the manual pause, the by-plan/feature/model breakdowns, the busiest workspaces and the ledger as CSV. Platform viewers only: the database
// functions behind it answer nobody else (docustay_may_view()). The ceiling and the pause are two platform-organisation settings (src/settings/keys.mjs), changed here.
import { aiPlatformSummary, aiPlatformEventsCsv } from "../documents/frontDoor.mjs";
import { setSetting } from "../settings/writes.mjs";
import { invalid } from "../http/errors.mjs";
import { aiPlatformCeilingUsd } from "./docustayPlans.mjs";

import { platformAlertTo } from "../mail/index.mjs";
import { sendViaResend } from "../email/resend.mjs";
import { sendingAddress } from "../email/send.mjs";
import { redirectForEnvironment } from "../email/redirect.mjs";
import { deliverOrThrow } from "../email/deliverOrThrow.mjs";
import { aiPlatformStatus, aiLevelsReached } from "../documents/frontDoor.mjs";
import { getSetting } from "../settings/writes.mjs";
import { AI_ALERT_LEVELS } from "./docustayPlans.mjs";

export const summary = (db, { now = new Date(), env = process.env } = {}) => aiPlatformSummary(db, { now, ceilingUsdDefault: aiPlatformCeilingUsd(env) });

export async function setCeiling(db, { tenantId, usd, userId = null }) {
  const v = usd === null || usd === "" || usd === undefined ? null : Number(usd);
  if (v !== null && (!Number.isFinite(v) || v < 0 || v > 1_000_000)) throw invalid("The ceiling is a dollar amount from 0 to 1,000,000, or empty to use the default.", { field: "usd" });
  await setSetting(db, { tenantId, key: "platform.ai_monthly_usd", value: v, updatedBy: userId });
  return { ceilingUsd: v };
}
export async function setPaused(db, { tenantId, paused, userId = null }) {
  if (typeof paused !== "boolean") throw invalid("paused must be true or false", { field: "paused" });
  await setSetting(db, { tenantId, key: "platform.ai_paused", value: paused, updatedBy: userId });
  return { paused };
}
export async function eventsCsv(db, { month = null, now = new Date() } = {}) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month ?? ""));
  const y = m ? Number(m[1]) : now.getUTCFullYear(), mo = m ? Number(m[2]) - 1 : now.getUTCMonth();
  return aiPlatformEventsCsv(db, { from: new Date(Date.UTC(y, mo, 1)), to: new Date(Date.UTC(y, mo + 1, 1)) });
}

// ── the alerts: at 50, 80 and 100 percent of the monthly ceiling the Docustay owner is emailed ONCE each (the markers live in the platform organisation's own settings), through the same sender as every other platform alert ──

/** Called every minute by the sweep for the PLATFORM organisation only. Returns the alert levels it just sent. `send` and `now` are for tests. */
export async function watchCeiling(db, { tenantId, now = new Date(), env = process.env, send = null }) {
  const { rows: [t] } = await db.query(`SELECT is_platform FROM keystone.tenant WHERE id = $1`, [tenantId]);
  if (!t?.is_platform) return { sent: [] };
  const st = await aiPlatformStatus(db, { policy: { platformMonthlyUsd: aiPlatformCeilingUsd(env) }, now, env });
  if (st.ceilingMicro == null || st.ceilingMicro <= 0) return { sent: [] };
  const month = now.toISOString().slice(0, 7);
  const sentMap = (await getSetting(db, "platform.ai_alerts_sent", {})) ?? {};
  const already = new Set(sentMap[month] ?? []);
  const fresh = aiLevelsReached(st.monthMicro, st.ceilingMicro, [...AI_ALERT_LEVELS]).filter((l) => !already.has(l));
  const to = platformAlertTo(env);
  const done = [];
  for (const level of fresh) {
    const spent = (st.monthMicro / 1_000_000).toFixed(2), ceiling = (st.ceilingMicro / 1_000_000).toFixed(2);
    const subject = `Docustay AI spend: ${level} percent of this month's ceiling`;
    const text = `The hosted service has spent $${spent} of its $${ceiling} monthly AI ceiling (${level} percent) in ${month}.\n${level >= 100 ? "AI is now PAUSED for every hosted workspace that uses the platform's key (workspaces with their own provider key, and self-hosts, are not affected). Raise the ceiling or resume under Platform → AI usage." : "Nothing is paused yet. Platform → AI usage shows where the spend is going, and can raise or lower the ceiling."}\n`;
    if (to && to.includes("@")) {
      const routed = redirectForEnvironment({ to, subject }, env);
      await deliverOrThrow(send ?? ((m) => sendViaResend(m, { env })), { to: routed.to, from: sendingAddress(env), subject: routed.subject, text });
    } else console.error(`ai platform alert (${level}%): no KEYSTONE_MAIL_ALERT_TO / KEYSTONE_ALERT_EMAIL is set, so nobody was emailed`);
    done.push(level);
  }
  if (done.length) await setSetting(db, { tenantId, key: "platform.ai_alerts_sent", value: { ...sentMap, [month]: [...already, ...done].sort((a, b) => a - b) }, updatedBy: null });
  return { sent: done };
}
