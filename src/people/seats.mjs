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
// ★ `limit`/`planKey` come from `keystone.mainstay_subscription` (0334) — a NULL `seat_limit` means
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
  // Phase 2 team-member sync proof (23 Oct): inviting a teammate creates their staff row at once, so `staff` includes people who have not joined.
  // Pay as you go bills only those who have (the Team page: "An invitation that has not been accepted is not charged"), so billing reads `billable`.
  const { rows: billRows } = await tx.query(
    `SELECT count(*)::int AS n FROM keystone.app_user u
      WHERE u.role = 'staff' AND u.lifecycle_status <> 'former'
        AND (NOT EXISTS (SELECT 1 FROM keystone.invite i WHERE i.tenant_id = u.tenant_id AND i.role = 'staff' AND lower(i.email) = lower(u.email))
             OR EXISTS (SELECT 1 FROM keystone.invite i WHERE i.tenant_id = u.tenant_id AND i.role = 'staff' AND lower(i.email) = lower(u.email) AND i.accepted_at IS NOT NULL))`);   // never invited (the owner, someone added directly) or joined; an open, revoked or expired invitation is not a seat
  const billable = billRows[0]?.n ?? 0;

  // ★ An invitation uses a seat even before it is accepted — matches `inviteWithRoleCheck`'s own
  //   "resend is not a new seat" reasoning: a REVOKED or EXPIRED or already-ACCEPTED invite is
  //   excluded, so revoking an open invite frees the seat it was holding.
  const { rows: openRows } = await tx.query(
    `SELECT count(*)::int AS n FROM keystone.invite i
      WHERE i.role = 'staff' AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
        -- F102: an invite creates its staff person up front, and that person is already counted by \`staff\` above —
        -- count only an open invite with no staff person on that email, so one person never takes two seats.
        AND NOT EXISTS (SELECT 1 FROM keystone.app_user u
                         WHERE u.role = 'staff' AND u.lifecycle_status <> 'former'
                           AND lower(u.email) = lower(i.email))`);
  const openInvites = openRows[0]?.n ?? 0;

  const { rows: subRows } = await tx.query(
    `SELECT plan_key, seat_limit FROM keystone.mainstay_subscription LIMIT 1`);
  const sub = subRows[0] ?? null;

  // ★ A Docustay workspace has no per-plan seat cap. The two seat settings (6 Oct 2026; default OFF, so unlimited) are the only thing that can give it one: included seats, and an optional price for each extra.
  const docustay = typeof sub?.plan_key === "string" && sub.plan_key.startsWith("docustay_");
  const seats = docustay ? seatSettings() : null;
  return {
    staff,
    billable,
    openInvites,
    used: staff + openInvites,
    // ★ `seat_limit` is a NULLABLE int (0334) — a plan with no seat cap returns `limit: null`.
    limit: docustay ? (seats.includedSeats ?? null) : (sub?.seat_limit ?? null),
    planKey: sub?.plan_key ?? null,
    docustay,
    extraSeatPriceMinor: docustay ? seats.extraSeatPriceMinor : null,
  };
}
