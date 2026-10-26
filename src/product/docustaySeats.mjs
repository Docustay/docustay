// src/product/docustaySeats.mjs — the daily seat count for a Docustay workspace (6 Oct 2026). A seat is a person who signs in to send or manage documents; a signer is never a seat.
// Count and date only, one row per workspace per day. Nothing here limits or charges: the two seat settings (docustayPlans.seatSettings) are default OFF and are enforced where a person is invited, not here.
import { teamSeatUsage } from "../people/seats.mjs";

const pacificDay = (now = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

/** Writes (or refreshes) today's number for this workspace. Only a Docustay workspace is counted. Returns the row, or null when this organisation is not a Docustay workspace. */
export async function logSeatsToday(tx, { tenantId, now = new Date() }) {
  const { rows: t } = await tx.query(`SELECT product FROM keystone.tenant WHERE id = $1`, [tenantId]);
  if (t[0]?.product !== "docustay") return null;
  const { billable: staff } = await teamSeatUsage(tx);   // people who have joined; an open invitation is not a seat yet (Phase 2 sync proof, 23 Oct)
  const day = pacificDay(now);
  await tx.query(
    `INSERT INTO keystone.docustay_seat_day (tenant_id, day, seat_count) VALUES ($1, $2::date, $3)
       ON CONFLICT (tenant_id, day) DO UPDATE SET seat_count = EXCLUDED.seat_count, logged_at = now()`, [tenantId, day, staff]);
  return { tenantId, day, seatCount: staff };
}
