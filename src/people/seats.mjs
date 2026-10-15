// src/people/seats.mjs — Task 12.14 (features plan §2.4 TeamInvite / OQ-12.8) — ONE function for
// seat usage: "an invitation uses a seat — even before it's accepted".
//
// ★★★ `used = staff + openInvites`, NOT staff alone. An ACCEPTED invite becomes a staff `app_user`
//     row (already counted by `staff`); an OPEN one has not, but it already reserves the seat it
//     would become — spec 02 §2.4's own words. `teamSeatUsage` is the ONE place this arithmetic
//     happens: the seats route (`src/routes/index.mjs`, `GET /api/people/team/seats`) and the
//     invite-cap check (`src/routes/writes.mjs`'s `inviteWithRoleCheck`) both call it, so they can
//     never disagree about what "used" means.
//
// ★ `limit`/`planKey` come from `keystone.workbench_subscription` (0334) — a NULL `seat_limit` means
//   no cap, never a made-up number (mirrors the seats route's own prior comment, unchanged in spirit).
//
// ★ Takes the caller's own transaction/connection and opens none of its own — same discipline
//   `src/people/offboard.mjs`'s header states for every function in that file.

/**
 * @param {import('pg').ClientBase} tx
 * @returns {Promise<{staff: number, openInvites: number, used: number, limit: number|null, planKey: string|null}>}
 */
import { seatSettings } from "../product/docustayPlans.mjs";
export async function teamSeatUsage(tx) {
  const { rows: staffRows } = await tx.query(
    `SELECT count(*)::int AS n FROM keystone.app_user
      WHERE role = 'staff' AND lifecycle_status <> 'former'`);
  const staff = staffRows[0]?.n ?? 0;

  // ★ An invitation uses a seat even before it is accepted — matches `inviteWithRoleCheck`'s own
  //   "resend is not a new seat" reasoning: a REVOKED or EXPIRED or already-ACCEPTED invite is
  //   excluded, so revoking an open invite frees the seat it was holding.
  const { rows: openRows } = await tx.query(
    `SELECT count(*)::int AS n FROM keystone.invite
      WHERE role = 'staff' AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()`);
  const openInvites = openRows[0]?.n ?? 0;

  const { rows: subRows } = await tx.query(
    `SELECT plan_key, seat_limit FROM keystone.workbench_subscription LIMIT 1`);
  const sub = subRows[0] ?? null;

  // ★ A Docustay workspace has no per-plan seat cap. The two seat settings (6 Oct 2026; default OFF, so unlimited) are the only thing that can give it one: included seats, and an optional price for each extra.
  const docustay = typeof sub?.plan_key === "string" && sub.plan_key.startsWith("docustay_");
  const seats = docustay ? seatSettings() : null;
  return {
    staff,
    openInvites,
    used: staff + openInvites,
    // ★ `seat_limit` is a NULLABLE int (0334) — a plan with no seat cap returns `limit: null`.
    limit: docustay ? (seats.includedSeats ?? null) : (sub?.seat_limit ?? null),
    planKey: sub?.plan_key ?? null,
    docustay,
    extraSeatPriceMinor: docustay ? seats.extraSeatPriceMinor : null,
  };
}
