// 18.34 — THE ADULT CLIENT'S HOME SURFACE, DISPATCHING TO PARENT/TEEN HOMES FROM 18.35
//
// ★★★ THE HOME SURFACE: NEXT SESSION, MONEY, DOCUMENT, CREDITS, AND COMING UP.
//     All roles read the same route; the payload shape is role-specific, enforced at return time.

import { creditStanding } from "../money/credits.mjs";
import { policyFor } from "../booking/writes.mjs";
import { paceSentence } from "../app/pace.mjs";
import { forbidden, notFound } from "../http/errors.mjs";
import { nextInstanceAwaitingSignature, executedCountFor, newestOpenInstanceFor } from "../documents/api.mjs";

/**
 * Assert the caller is a client (not staff).
 */
function assertClientRole(principal) {
  const role = principal?.user?.role ?? null;
  // ★ the maintainer, 29 Sep 2026 — "parent" is no longer a `role` value; see src/routes/app.mjs's own note.
  const CLIENT_ROLES = Object.freeze(["adult_client", "adolescent_client"]);
  if (!CLIENT_ROLES.includes(role)) {
    throw forbidden(
      `the client app is for ${CLIENT_ROLES.join(", ")}. A staff session belongs in the CRM.`);
  }
  return role;
}

/**
 * Build the adult client's home payload.
 *
 * @param db - tenant-scoped database client
 * @param principal - the session principal with user and appUserId
 * @returns {object} home payload with next session, money, documents, credits, coming up
 */
async function adultHome(db, principal) {
  const tenantId = principal.user.tenant_id;
  const userId = principal.appUserId;
  const now = new Date();

  // ★ GET THE NEXT BOOKING — earliest session with starts_at > now() and state != cancelled
  const { rows: nextBookings } = await db.query(
    `SELECT b.id, b.starts_at, b.ends_at, (EXTRACT(EPOCH FROM b.ends_at - b.starts_at) / 60)::int AS duration_minutes, s.name AS service_name,
            h.display_name AS host_name, h.first_name AS host_first_name,
            b.location_kind, b.location_detail, b.service_id
       FROM keystone.booking b
       LEFT JOIN keystone.service s ON s.id = b.service_id
       LEFT JOIN keystone.app_user h ON h.id = b.host_id
       JOIN keystone.booking_participant bp ON bp.booking_id = b.id
      WHERE bp.app_user_id = $1 AND bp.party = 'client'
        AND b.tenant_id = $2
        AND b.starts_at > now()
        AND b.state != 'cancelled'
      ORDER BY b.starts_at ASC
      LIMIT 1`,
    [userId, tenantId]
  );

  let next = null;
  let upcomingBookings = [];

  if (nextBookings.length > 0) {
    const nextBooking = nextBookings[0];
    const policy = await policyFor(db, tenantId, nextBooking.service_id);

    // ★ Stage 13 location note: the practice's per-location note if available
    // (For now, treat as null until Stage 13 schema is confirmed)
    const locationNote = null;

    next = {
      bookingId: nextBooking.id,
      startsAt: nextBooking.starts_at,
      endsAt: nextBooking.ends_at,
      durationMinutes: nextBooking.duration_minutes,
      serviceName: nextBooking.service_name,
      hostName: nextBooking.host_name,
      place: {
        kind: nextBooking.location_kind,
        detail: nextBooking.location_detail,
        note: locationNote,
      },
      canMove: policy.client_may_reschedule,
      canCancel: policy.client_may_cancel,
    };

    // ★ GET THE NEXT THREE BOOKINGS AFTER THE FIRST ONE
    const { rows: upcoming } = await db.query(
      `SELECT b.id, b.starts_at, s.name AS service_name, b.location_kind, b.location_detail, b.state
         FROM keystone.booking b
         LEFT JOIN keystone.service s ON s.id = b.service_id
         JOIN keystone.booking_participant bp ON bp.booking_id = b.id
        WHERE bp.app_user_id = $1 AND bp.party = 'client'
          AND b.tenant_id = $2
          AND b.starts_at > $3
          AND b.state != 'cancelled'
        ORDER BY b.starts_at ASC
        LIMIT 3`,
      [userId, tenantId, nextBooking.starts_at]
    );

    upcomingBookings = upcoming.map((b) => {
      // ★ State label mapping: "Confirmed" or "Waitlisted"
      const stateLabel = b.state === 'waitlisted' ? 'Waitlisted' : 'Confirmed';
      return {
        date: b.starts_at,
        service: b.service_name,
        time: b.starts_at,
        place: {
          kind: b.location_kind,
          detail: b.location_detail,
        },
        state: stateLabel,
      };
    });
  }

  // ★ GET OPEN INVOICES — payer = me, status = 'open', earliest due date
  const { rows: invoices } = await db.query(
    `SELECT ie.id, ie.amount_minor, ie.currency, i.due_at, i.memo, i.title
       FROM keystone.invoice_effective ie
       LEFT JOIN keystone.invoice i ON i.id = ie.id
      WHERE ie.tenant_id = $1 AND ie.payer_user_id = $2 AND ie.status = 'open'
      ORDER BY i.due_at ASC
      LIMIT 1`,
    [tenantId, userId]
  );

  let money = null;
  if (invoices.length > 0) {
    const invoice = invoices[0];

    // ★ GET THE DEFAULT PAYMENT METHOD IF ONE EXISTS
    // ★ FIX, 1 Oct 2026 (saved-card brief, Part 6) — `detached_at IS NULL` was missing.
    const { rows: paymentMethods } = await db.query(
      `SELECT pm.brand, pm.last_four
         FROM keystone.person_card_effective pm
        WHERE pm.app_user_id = $1 AND pm.is_default = true
        LIMIT 1`,
      [userId]
    );

    const pm = paymentMethods.length > 0 ? paymentMethods[0] : null;

    money = {
      invoiceId: invoice.id,
      amountMinor: invoice.amount_minor,
      currency: invoice.currency,
      dueAt: invoice.due_at,
      label: invoice.title ?? invoice.memo,
      savedCard: pm
        ? {
            brand: pm.brand,
            lastFour: pm.last_four,
          }
        : null,
    };
  }

  // ★ GET DOCUMENTS TO SIGN — newest visible document_instance in state sent/partially_signed
  //   where I am a signer (role='client') and have not signed (signed_at IS NULL)
  const documentsToSign = await nextInstanceAwaitingSignature(db, { tenantId, signerUid: userId, role: "client" });

  let toSign = null;
  if (documentsToSign.length > 0) {
    const doc = documentsToSign[0];
    toSign = {
      documentId: doc.id,
      title: doc.title,
    };
  }

  // ★ GET ENTITLEMENT STANDING — credits block with pace sentence
  const standing = await creditStanding(db, { tenantId, ownerUserId: userId });

  let block = null;
  if (standing && standing.total > 0) {
    // ★ Get the entitlement to find expiration date
    const { rows: entitlements } = await db.query(
      `SELECT expires_at
         FROM keystone.entitlement
        WHERE tenant_id = $1 AND owner_user_id = $2 AND status = 'active'
        ORDER BY expires_at DESC
        LIMIT 1`,
      [tenantId, userId]
    );

    const expiresAt = entitlements.length > 0 ? entitlements[0].expires_at : null;

    // ★ Get the primary host's first name for the pace sentence
    let hostFirstName = `Your coach`;
    if (next && next.hostName) {
      hostFirstName = next.hostName.split(" ")[0];
    } else {
      // Fallback: get the first host in the tenant
      const { rows: hosts } = await db.query(
        `SELECT first_name FROM keystone.app_user
          WHERE tenant_id = $1 AND staff_role IS NOT NULL
          LIMIT 1`,
        [tenantId]
      );
      if (hosts.length > 0 && hosts[0].first_name) {
        hostFirstName = hosts[0].first_name;
      }
    }

    // ★ Compute pace sentence using attendance in the past 8 weeks
    const { rows: attendance } = await db.query(
      `SELECT COUNT(*) FILTER (WHERE bp.attended = true)::int AS attended_count
         FROM keystone.booking_participant bp
         JOIN keystone.booking b ON b.id = bp.booking_id
        WHERE bp.app_user_id = $1
          AND b.tenant_id = $2
          AND b.starts_at > now() - interval '8 weeks'
          AND bp.attended = true`,
      [userId, tenantId]
    );

    const attendedLast8Weeks = attendance.length > 0 ? attendance[0].attended_count : 0;

    const pace = paceSentence({
      remaining: standing.remaining,
      attendedLast8Weeks,
      now,
      hostFirstName,
    });

    block = {
      remaining: standing.remaining,
      total: standing.total,
      expiresAt,
      pace,
    };
  }

  // ★ CHECK IF THIS IS THE FIRST VISIT
  // First visit = no executed agreement AND no past or future booking
  const executedDocCount = await executedCountFor(db, { tenantId, subjectUserId: userId });

  const { rows: allBookings } = await db.query(
    `SELECT COUNT(*)::int AS count FROM keystone.booking_participant
      WHERE app_user_id = $1 AND booking_id IN
        (SELECT id FROM keystone.booking WHERE tenant_id = $2)`,
    [userId, tenantId]
  );

  let firstVisit = executedDocCount === 0 && allBookings[0]?.count === 0;
  let firstSteps = null;

  if (firstVisit) {
    // ★ Get the practice's default agreement document
    // ★ THIS client's agreement — it read "any sent document in the practice" (26 Sep 2026)
    const agreements = await newestOpenInstanceFor(db, { tenantId, subjectUserId: userId });

    // ★ Get a free service (price_minor = 0)
    const { rows: freeServices } = await db.query(
      `SELECT id FROM keystone.service
        WHERE tenant_id = $1 AND price_minor = 0 AND bookable AND active
        LIMIT 1`,
      [tenantId]
    );

    if (agreements.length > 0 || freeServices.length > 0) {
      firstSteps = {
        agreementId: agreements.length > 0 ? agreements[0].id : null,
        freeServiceId: freeServices.length > 0 ? freeServices[0].id : null,
        hostFirstName: next ? (next.hostName?.split(" ")[0] ?? null) : null,
      };
    }
  }

  return {
    role: "adult_client",
    firstVisit,
    next,
    money,
    toSign,
    block,
    comingUp: upcomingBookings,
    ...(firstSteps && { firstSteps }),
  };
}

export function registerAppHomeRoutes(app, { scoped, get }) {
  get("/api/app/home", (c) =>
    scoped(c, async ({ db, principal }) => {
      const role = assertClientRole(principal);

      // ★ DISPATCH ON ROLE — parent and teen homes come from 18.35 (familyHome.mjs)
      // ★★★ the maintainer, 29 Sep 2026 — "parent" is now a computed fact (`is_guardian`), not a role, and an
      //     adult_client can hold it alongside being a client themselves (Example Client: Adult +
      //     Parent). This dispatch was written when the two were mutually exclusive by construction
      //     and still picks guardian-first, unchanged in PRIORITY — flagged to the maintainer, not decided here:
      //     someone who is both sees the parent home, never a blended one. Real gap, not a bug.
      if (principal.user.is_guardian) {
        const { parentHome } = await import("../app/familyHome.mjs");
        return parentHome(db, principal);
      }
      if (role === "adolescent_client") {
        const { teenHome } = await import("../app/familyHome.mjs");
        return teenHome(db, principal);
      }

      // ★ ADULT CLIENT — the default case
      return adultHome(db, principal);
    }, { bucket: "app" })
  );
}
