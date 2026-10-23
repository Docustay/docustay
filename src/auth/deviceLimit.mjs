// src/auth/deviceLimit.mjs — A FREE WORKSPACE'S LOGIN IS ONE PERSON'S, ON AT MOST THREE DEVICES AT ONCE (the maintainer, 21 Oct 2026, decision 5).
// When a person signs in on a fourth device, their OLDEST signed-in device (least recently used) is signed out. Free only: the paid plans have no device line (their terms say one login per person).
// Only full browser sessions count (kind "app"); a half-finished sign-in (the second step still to do) and a handoff are not devices. The Security page lists the devices and lets a person remove one themselves.
import { withTenant } from "../db/index.mjs";
import { listSessionsForUser, revokeSessionById } from "./session.mjs";
import { effectivePlan } from "../product/docustayPlans.mjs";

export const FREE_DEVICE_LIMIT = 3;
export const DEVICE_NOTICE = "You are signed in on 3 devices, the most a Free workspace allows at once, so your oldest device was signed out. Pay as you go, Pro and Lifetime have no device limit.";

/** Called right after a full session is made. Best effort: a failure here never stops a sign-in. → { signedOut: number } */
export async function enforceFreeDeviceLimit({ tenantId, appUserId, currentTokenId, max = FREE_DEVICE_LIMIT }) {
  if (process.env.KEYSTONE_SELF_HOST === "1") return { signedOut: 0 };
  try {
    return await withTenant(tenantId, async (tx) => {
      const { rows: [sub] } = await tx.query(`SELECT plan_key, status, cancel_at FROM keystone.workbench_subscription LIMIT 1`);
      const plan = effectivePlan(sub ?? null);
      if (!plan || plan.key !== "docustay_free") return { signedOut: 0 };
      const live = (await listSessionsForUser(tx, tenantId, appUserId, currentTokenId)).filter((s) => s.kind === "app");   // newest-active first
      const keep = live.filter((s) => s.current).concat(live.filter((s) => !s.current)).slice(0, max);
      const keepIds = new Set(keep.map((s) => s.id));
      let n = 0;
      for (const s of live) if (!keepIds.has(s.id) && (await revokeSessionById(tx, tenantId, appUserId, s.id, "device_limit")).revoked) n += 1;
      return { signedOut: n };
    }, { userId: appUserId });
  } catch (e) { console.error(`free device limit: ${e?.message ?? e}`); return { signedOut: 0 }; }
}
