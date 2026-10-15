// src/queue/recipientResolvers.mjs — PART 2 ADDITION (worker-failures brief, 1 Oct 2026).
//
// ★★★★ F854 FIX, 1 Oct 2026 (Part 4a, money-map pass) — `invoice`/`subscription`/`estimate`/
//     `payment` MEASURED BROKEN: those four tables' RLS gates every SELECT behind
//     `keystone.user_may(current_user_id(), 'invoice', 'view', owner_chain) OR <payer/recipient
//     column> = current_user_id()` — and every one of these resolvers runs inside the worker
//     dispatcher's own `withTenant(tenantId, tx => ...)`, which sets NO viewer (`keystone.user_id`
//     is never set for a job). `current_user_id()` is NULL there, so BOTH halves of that OR are
//     false/NULL and the row is invisible — confirmed by directly calling the REAL, PRE-EXISTING
//     `money.credit_note.issued` listener (TOPIC_HANDLERS, tasks.mjs) and the REAL
//     `NOTIFY_PAYMENT_RECEIVED` listener end-to-end against a real invoice/payment row: the first
//     silently logged "invoice not found or has no payer — nobody to notify" and created zero
//     notifications; the second THREW "neither a payment nor an invoice is readable in tenant
//     <id>" — on every real payment, unconditionally. This is the exact P15 GUC-nothing-sets shape
//     CLAUDE.md's own history already names for `document_is_visible`/`staff_write`, recurring here
//     for money tables. `document`/`entitlement`/`task`/`person_goal`/`staff_shift`/`time_off`/
//     `booking`/`booking_participant_payload`/`message_thread` are UNAFFECTED (checked each
//     table's own RLS directly — none of them gate behind a viewer-permission check, tenant_id
//     alone or `document_is_visible()` is enough). Fixed by wrapping the four gated reads in
//     `asPracticeOwner` (src/money/asPracticeOwner.mjs) — the SAME, already-established pattern
//     `noShow.mjs`/`loyaltyAccrual.mjs` already use for this exact RLS shape; not invented here.
// ★★★ WHY THIS EXISTS. Wiring ~80 new notification topics one bespoke listener at a time would
//     mean ~80 near-identical functions, each re-deriving "who gets this email" from the event's
//     own subjectType — the SAME question, answered once per subjectType here instead, and reused
//     by every topic that shares it (`src/queue/tasks.mjs`'s generic dispatcher, below).
//
// ★★ THREE STRATEGIES, NAMED:
//   - DIRECT  — `subjectType: "person"`: subjectId IS the recipient's own app_user id. No query.
//   - OWNER   — the practice's own staff (owner/admin), same shape as the existing
//     `MONEY_OWNER_NOTICE` listener already uses. No per-subject query either.
//   - LOOKUP  — a real column on the subject's own table resolves the recipient. One resolver per
//     subject type, each verified against the real schema (not guessed) before being written here.
//
// ★ EVERY RESOLVER RETURNS `null` RATHER THAN THROWING when the data genuinely is not there (an
//   archived row, a participant with no account, a thread with no messages yet) — the same
//   "nobody to notify, not a failure" posture `src/queue/tasks.mjs`'s own bespoke listeners already
//   use (e.g. documents.document.expired's `if (!row.created_by) { ...; return; }`).

import { asPracticeOwner } from "../money/asPracticeOwner.mjs";
import { instanceCreatedBy } from "../documents/frontDoor.mjs";

/** ★ DIRECT. subjectType "person": the subject IS the recipient. */
export async function recipientIsSubject(tx, tenantId, ev) {
  return ev.subject_id;
}

/** ★ OWNER. The practice's own owner/admin staff — same query shape as MONEY_OWNER_NOTICE. */
export async function recipientsAreOwners(tx, tenantId) {
  const { rows } = await tx.query(
    `SELECT id FROM keystone.app_user
      WHERE tenant_id = $1 AND role = 'staff' AND staff_role IN ('owner', 'admin')
        AND archived_at IS NULL`,
    [tenantId]);
  return rows.map((r) => r.id);
}

/** ★ LOOKUP table, keyed by subjectType, each a function(tx, tenantId, ev) -> personId | null. */
export const SUBJECT_RECIPIENT_LOOKUP = Object.freeze({
  // ★ DOCUSTAY WALL FIX (round 3, 2 Oct 2026) — this used to be a raw `tx.query` on
  //   `keystone.document_instance`, caught by db/gates/documents_wall.mjs's SQL-clause check (the
  //   half that exists specifically because booking once read document tables directly, by SQL,
  //   with no import to catch). Goes through the door (`instanceCreatedBy`, documents/frontDoor.mjs)
  //   now. ★★★ NOT wrapped in `asPracticeOwner` — unlike the four money-table resolvers below,
  //   that wrapper does NOT work for documents: MEASURED directly, `document_is_visible()` denies
  //   even the practice owner when the document's subject has no coach assigned, so asPracticeOwner
  //   would have silently resolved to null in exactly that case. `instanceCreatedBy` itself goes
  //   through a dedicated SECURITY DEFINER system lookup (migration 0570) instead — see its own
  //   comment in documents/api.mjs for the full reasoning.
  document: async (tx, tenantId, ev) =>
    instanceCreatedBy(tx, { tenantId, instanceId: ev.subject_id }),
  entitlement: async (tx, tenantId, ev) => {
    const { rows } = await tx.query(
      `SELECT owner_user_id FROM keystone.entitlement WHERE tenant_id = $1 AND id = $2`,
      [tenantId, ev.subject_id]);
    return rows[0]?.owner_user_id ?? null;
  },
  // ★ F854 — all four of these read a worker-RLS-gated table; see this file's own header.
  // ★ STRIPE-MIRROR REPOINT (2 Oct 2026) — invoice/subscription/payment now resolve through the
  //   `*_effective` views (same ids for the platform-keyed rows; Stripe-only rows resolve too). Wrapper unchanged.
  invoice: async (tx, tenantId, ev) => asPracticeOwner(tx, tenantId, async () => {
    const { rows } = await tx.query(
      `SELECT payer_user_id FROM keystone.invoice_effective WHERE tenant_id = $1 AND id = $2`,
      [tenantId, ev.subject_id]);
    return rows[0]?.payer_user_id ?? null;
  }),
  subscription: async (tx, tenantId, ev) => asPracticeOwner(tx, tenantId, async () => {
    const { rows } = await tx.query(
      `SELECT app_user_id FROM keystone.subscription_effective WHERE tenant_id = $1 AND id = $2`,
      [tenantId, ev.subject_id]);
    return rows[0]?.app_user_id ?? null;
  }),
  payment: async (tx, tenantId, ev) => asPracticeOwner(tx, tenantId, async () => {
    const { rows } = await tx.query(
      `SELECT payer_user_id FROM keystone.payment_effective WHERE tenant_id = $1 AND id = $2`,
      [tenantId, ev.subject_id]);
    return rows[0]?.payer_user_id ?? null;
  }),
  estimate: async (tx, tenantId, ev) => asPracticeOwner(tx, tenantId, async () => {
    const { rows } = await tx.query(
      `SELECT recipient_user_id FROM keystone.estimate WHERE tenant_id = $1 AND id = $2`,
      [tenantId, ev.subject_id]);
    return rows[0]?.recipient_user_id ?? null;
  }),
  task: async (tx, tenantId, ev) => {
    const { rows } = await tx.query(
      `SELECT assignee_id FROM keystone.task WHERE tenant_id = $1 AND id = $2`,
      [tenantId, ev.subject_id]);
    return rows[0]?.assignee_id ?? null;
  },
  person_goal: async (tx, tenantId, ev) => {
    const { rows } = await tx.query(
      `SELECT person_id FROM keystone.person_goal WHERE tenant_id = $1 AND id = $2`,
      [tenantId, ev.subject_id]);
    return rows[0]?.person_id ?? null;
  },
  staff_shift: async (tx, tenantId, ev) => {
    const { rows } = await tx.query(
      `SELECT app_user_id FROM keystone.staff_shift WHERE tenant_id = $1 AND id = $2`,
      [tenantId, ev.subject_id]);
    return rows[0]?.app_user_id ?? null;
  },
  time_off: async (tx, tenantId, ev) => {
    const { rows } = await tx.query(
      `SELECT app_user_id FROM keystone.time_off WHERE tenant_id = $1 AND id = $2`,
      [tenantId, ev.subject_id]);
    return rows[0]?.app_user_id ?? null;
  },
  // ★ "booking.participant.added" names the BOOKING as its subject (the fact belongs on the
  //   booking's own record page) but carries the real `participant_id` (a booking_participant row,
  //   not an app_user) in its payload — `has_account: false` is a real, expected case (a plain
  //   contact with no login), correctly resolved to null (nobody to email), not an error.
  booking_participant_payload: async (tx, tenantId, ev) => {
    const participantId = ev.payload?.participant_id;
    if (!participantId) return null;
    const { rows } = await tx.query(
      `SELECT app_user_id FROM keystone.booking_participant WHERE tenant_id = $1 AND id = $2`,
      [tenantId, participantId]);
    return rows[0]?.app_user_id ?? null;
  },
  // ★ PART 4a ADDITION (money-map pass, 1 Oct 2026) — the `money.payment_plan.*` topics name a
  //   `subscription_schedule` row as their subject (logical type "payment_plan" — there is no
  //   `payment_plan` table; src/money/paymentPlans.mjs's own table references confirm this), but
  //   every one of them carries `invoice_id` directly in its payload (checked at every emit site).
  //   Resolving through the invoice's own `payer_user_id` is simpler and more robust than adding a
  //   second `subscription_schedule` lookup table just to re-derive the same invoice_id.
  // ★ F854 — same worker-RLS gate as the `invoice` resolver above.
  invoice_id_payload: async (tx, tenantId, ev) => {
    const invoiceId = ev.payload?.invoice_id;
    if (!invoiceId) return null;
    return asPracticeOwner(tx, tenantId, async () => {
      const { rows } = await tx.query(
        `SELECT payer_user_id FROM keystone.invoice_effective WHERE tenant_id = $1 AND id = $2`,
        [tenantId, invoiceId]);
      return rows[0]?.payer_user_id ?? null;
    });
  },
  // ★★★ FOUND LIVE, the maintainer's own report, 2 Oct 2026 — "people.person.assigned" names the CLIENT as its
  //   subject (`subjectId: personId`, src/people/writes.mjs) because the fact belongs on the
  //   client's own record, but "You've been assigned a new client" is staff-directed copy: the real
  //   audience is `payload.to`, the staff member who just became this person's owner. The old
  //   `recipient: "direct"` config sent this email to the CLIENT, telling them they'd been assigned
  //   a new client of their own — same class of defect as people.person.created's "added to the
  //   team" email. `payload.to` is already a real app_user id (src/people/writes.mjs's own emit
  //   call) — no query needed.
  assigned_owner_payload: async (tx, tenantId, ev) => ev.payload?.to ?? null,
  // ★ A booking's own client — the first non-host participant with a real account. Used for
  //   booking-subject topics that are NOT already covered by booking.booking.created's own
  //   existing listener (notifyBookedFrom) — i.e. booking.hold.expired, booking.booking.confirmed
  //   when it has no bespoke listener of its own.
  booking: async (tx, tenantId, ev) => {
    const { rows } = await tx.query(
      `SELECT app_user_id FROM keystone.booking_participant
        WHERE tenant_id = $1 AND booking_id = $2 AND party <> 'host' AND app_user_id IS NOT NULL
        ORDER BY id LIMIT 1`,
      [tenantId, ev.subject_id]);
    return rows[0]?.app_user_id ?? null;
  },
  // ★ A message thread belongs to one client (`person_id`); "messages.message.sent" fires for
  //   EITHER side sending — the recipient is whichever side did NOT send it. Staff-sent → the
  //   client; client-sent → practice staff (handled by the caller falling back to recipientsAreOwners
  //   when this returns null, since "which staff member" has no single right answer here).
  message_thread: async (tx, tenantId, ev) => {
    const threadId = ev.payload?.thread_id;
    if (!threadId) return null;
    const { rows } = await tx.query(
      `SELECT mt.person_id, m.sender_id, m.sender_type
         FROM keystone.message_thread mt
         JOIN keystone.message m ON m.id = $2
        WHERE mt.tenant_id = $1 AND mt.id = $3`,
      [tenantId, ev.subject_id, threadId]);
    const row = rows[0];
    if (!row) return null;
    // sender_type 'staff' -> notify the client; sender_type the client's own id -> null (falls
    // back to OWNER, since no single staff member is "the" recipient of their own client's reply).
    return row.sender_type === "staff" ? row.person_id : null;
  },
});
