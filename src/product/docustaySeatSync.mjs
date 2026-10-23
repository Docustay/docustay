// src/product/docustaySeatSync.mjs — PAY AS YOU GO BILLS BY THE TEAM MEMBER, SO STRIPE IS TOLD WHEN THE TEAM CHANGES (the maintainer, 21 Oct 2026, decision 4).
// Called right after someone joins (an invitation is accepted), leaves, or comes back. Stripe prorates the change: a member who was there for a day is billed for that day. An open invitation is NOT billed (it is only a reserved seat).
// The daily seat task (queue/tasks.mjs docustay_seat_log) stays as the safety net that only reconciles. Never throws: a Stripe problem here must never stop someone joining or leaving; the reconcile fixes the count.
import { teamSeatUsage } from "../people/seats.mjs";
import { syncPaygSeats } from "./docustayUsage.mjs";

export async function syncSeatsNow(tx, { tenantId, why = "team_change", syncImpl = syncPaygSeats } = {}) {
  try {
    const { rows: [t] } = await tx.query(`SELECT product FROM keystone.tenant WHERE id = $1`, [tenantId]);
    if (t?.product !== "docustay") return { changed: false };
    const { staff } = await teamSeatUsage(tx);
    const r = await syncImpl(tx, { tenantId, staffCount: staff });
    if (r?.changed) console.log(`docustay seat sync (${why}): workspace ${tenantId} Pay as you go seats ${r.from} to ${r.to}`);
    return r ?? { changed: false };
  } catch (e) { console.error(`docustay seat sync (${why}) for ${tenantId} failed; the daily reconcile will correct it: ${e?.message ?? e}`); return { changed: false, failed: true }; }
}
