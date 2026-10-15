// 18.35 — PARENT AND TEEN HOME PAYLOADS (the payload law's hard cases)
//
// ★★★ THE PARENT'S HOME: each child's attendance and money only; the teen's HOME: zero money,
//     always the 988 line. Every field is derived from the same tenant-scoped queries the
//     route already enforces; the person scoping is this function's WHERE clause, as for
//     every `/api/app/*` read.

import { creditStanding } from "../money/credits.mjs";
import { policyFor } from "../booking/writes.mjs";
import { policySentence } from "../booking/policySentence.mjs";
import { CRISIS_LINE } from "./crisisLine.mjs";
import { pendingCosignInstancesFor, hasSignedRole, nextInstanceAwaitingSignature } from "../documents/api.mjs";

/**
 * Build the parent's home payload with children's attendance and family money.
 *
 * @param db - tenant-scoped database client
 * @param principal - the session principal with user and appUserId
 * @returns {object} home payload with role, family data including children and cosign
 */
export async function parentHome(db, principal) {
  const tenantId = principal.user.tenant_id;
  const parentId = principal.appUserId;
  const now = new Date();

  // ★ GET GUARDIAN EDGES — the parent's children
  const { rows: guardians } = await db.query(
    `SELECT g.child_user_id, au.first_name, au.date_of_birth
       FROM keystone.guardian g
       LEFT JOIN keystone.app_user au ON au.id = g.child_user_id
      WHERE g.tenant_id = $1 AND g.guardian_user_id = $2
      ORDER BY au.first_name`,
    [tenantId, parentId]
  );

  // ★ GET OPEN INVOICES — payer = me, status = 'open'
  const { rows: invoices } = await db.query(
    `SELECT ie.id, ie.amount_minor, ie.currency, i.due_at
       FROM keystone.invoice_effective ie
       LEFT JOIN keystone.invoice i ON i.id = ie.id
      WHERE ie.tenant_id = $1 AND ie.payer_user_id = $2 AND ie.status = 'open'
      ORDER BY i.due_at ASC`,
    [tenantId, parentId]
  );

  // ★ Compute family totals
  let totalDueMinor = 0;
  let currency = null;
  let openInvoices = invoices.length;
  let latestDueAt = null;

  if (invoices.length > 0) {
    totalDueMinor = invoices.reduce((sum, inv) => sum + inv.amount_minor, 0);
    currency = invoices[0].currency;
    latestDueAt = invoices[0].due_at;
  }

  // ★ GET THE DEFAULT PAYMENT METHOD IF ONE EXISTS
  // ★ FIX, 1 Oct 2026 (saved-card brief, Part 6) — `detached_at IS NULL` was missing.
  const { rows: paymentMethods } = await db.query(
    `SELECT pm.brand, pm.last_four
       FROM keystone.person_card_effective pm
      WHERE pm.app_user_id = $1 AND pm.is_default = true
      LIMIT 1`,
    [parentId]
  );

  const savedCard = paymentMethods.length > 0
    ? {
        brand: paymentMethods[0].brand,
        lastFour: paymentMethods[0].last_four,
      }
    : null;

  // ★ BUILD CHILDREN ARRAY
  const children = [];
  for (const guardian of guardians) {
    const childId = guardian.child_user_id;

    // ★ Calculate age from date_of_birth
    let age = null;
    if (guardian.date_of_birth) {
      const birthDate = new Date(guardian.date_of_birth);
      age = Math.floor((now - birthDate) / (1000 * 60 * 60 * 24 * 365.25));
    }

    // ★ GET THE NEXT BOOKING FOR THIS CHILD
    const { rows: nextBookings } = await db.query(
      `SELECT b.id, b.starts_at, s.name AS service_name,
              b.location_kind, b.location_detail
         FROM keystone.booking b
         LEFT JOIN keystone.service s ON s.id = b.service_id
         JOIN keystone.booking_participant bp ON bp.booking_id = b.id
        WHERE bp.app_user_id = $1 AND bp.party = 'client'
          AND b.tenant_id = $2
          AND b.starts_at > now()
          AND b.state != 'cancelled'
        ORDER BY b.starts_at ASC
        LIMIT 1`,
      [childId, tenantId]
    );

    let next = null;
    if (nextBookings.length > 0) {
      const nextBooking = nextBookings[0];
      next = {
        startsAt: nextBooking.starts_at,
        serviceName: nextBooking.service_name,
        place: {
          kind: nextBooking.location_kind,
          detail: nextBooking.location_detail,
        },
      };
    }

    // ★ GET ATTENDANCE AND CREDITS FOR THIS CHILD
    const { rows: attendanceRows } = await db.query(
      `SELECT COUNT(*) FILTER (WHERE bp.attended = true)::int AS used,
              COUNT(*)::int AS total
         FROM keystone.booking_participant bp
         JOIN keystone.booking b ON b.id = bp.booking_id
        WHERE bp.app_user_id = $1 AND b.tenant_id = $2 AND bp.attended = true`,
      [childId, tenantId]
    );

    const used = attendanceRows.length > 0 ? attendanceRows[0].used : 0;
    const total = attendanceRows.length > 0 ? attendanceRows[0].total : 0;

    // ★ GET ENTITLEMENT STANDING FOR THIS CHILD
    const standing = await creditStanding(db, { tenantId, ownerUserId: childId });
    let remaining = 0;
    if (standing) {
      remaining = standing.remaining;
    }

    // ★ GET ENTITLEMENT EXPIRATION AND START DATE
    let expiresAt = null;
    let sinceMonth = null;
    if (standing && standing.total > 0) {
      const { rows: entitlements } = await db.query(
        `SELECT expires_at, created_at
           FROM keystone.entitlement
          WHERE tenant_id = $1 AND owner_user_id = $2 AND status = 'active'
          ORDER BY expires_at DESC
          LIMIT 1`,
        [tenantId, childId]
      );

      if (entitlements.length > 0) {
        expiresAt = entitlements[0].expires_at;
        // ★ sinceMonth is the month the entitlement was created
        const createdDate = new Date(entitlements[0].created_at);
        sinceMonth = createdDate.toISOString().slice(0, 7); // YYYY-MM format
      }
    }

    // ★ owingMinor is null unless Stage 15 links invoices to a child
    const owingMinor = null;

    children.push({
      childId,
      firstName: guardian.first_name,
      age,
      next,
      used,
      total,
      remaining,
      expiresAt,
      sinceMonth,
      owingMinor,
    });
  }

  // ★ GET DOCUMENTS TO COSIGN — documents where the child is the subject, parent is a signer
  //   in sent/partially_signed state
  const childIds = guardians.map((g) => g.child_user_id);
  let cosignDocs = [];

  if (childIds.length > 0) {
    // ★ DOCUSTAY WALL FIX — routed through documents/api.mjs; same query, relocated verbatim.
    cosignDocs = await pendingCosignInstancesFor(db, { tenantId, subjectUserIds: childIds });
  }

  // ★ BUILD COSIGN ARRAY WITH SIGNATURE STATUS
  const cosign = [];
  for (const doc of cosignDocs) {
    // ★ Find the child name for display
    const childRow = guardians.find((g) => g.child_user_id === doc.subject_user_id);
    const childFirstName = childRow?.first_name || null;

    // ★ DOCUSTAY WALL FIX — routed through documents/api.mjs; same two queries, relocated verbatim.
    const parentSigned = await hasSignedRole(db, { instanceId: doc.id, role: "parent" });
    const childSigned = await hasSignedRole(db, { instanceId: doc.id, role: "client" });

    cosign.push({
      documentId: doc.id,
      title: doc.title,
      childFirstName,
      parentSigned,
      childSigned,
    });
  }

  return {
    role: "parent",
    family: {
      totalDueMinor,
      currency,
      openInvoices,
      latestDueAt,
      savedCard,
      children,
      cosign,
    },
  };
}

/**
 * Build the adolescent client's home payload with zero money and always the crisis line.
 *
 * @param db - tenant-scoped database client
 * @param principal - the session principal with user and appUserId
 * @returns {object} home payload with sessions, agreement, and crisis line only
 */
export async function teenHome(db, principal) {
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
  let nextServiceId = null;

  if (nextBookings.length > 0) {
    const nextBooking = nextBookings[0];
    nextServiceId = nextBooking.service_id;
    const policy = await policyFor(db, tenantId, nextBooking.service_id);

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
        note: null,
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

  // ★ DOCUSTAY WALL FIX — routed through documents/api.mjs; same query, relocated verbatim.
  const documentsToSign = await nextInstanceAwaitingSignature(db, { tenantId, signerUid: userId, role: "client" });

  let toSign = null;
  if (documentsToSign.length > 0) {
    const doc = documentsToSign[0];

    // ★ GET THE TEEN'S AGE
    const { rows: userRows } = await db.query(
      `SELECT date_of_birth FROM keystone.app_user WHERE id = $1`,
      [userId]
    );

    let age = null;
    if (userRows.length > 0 && userRows[0].date_of_birth) {
      const birthDate = new Date(userRows[0].date_of_birth);
      age = Math.floor((now - birthDate) / (1000 * 60 * 60 * 24 * 365.25));
    }

    // ★ GET THE FIRST GUARDIAN'S RELATIONSHIP TO BUILD guardianWord
    const { rows: guardianRows } = await db.query(
      `SELECT relationship FROM keystone.guardian
        WHERE tenant_id = $1 AND child_user_id = $2
        ORDER BY created_at ASC
        LIMIT 1`,
      [tenantId, userId]
    );

    let guardianWord = "parent";
    if (guardianRows.length > 0) {
      const rel = guardianRows[0].relationship?.toLowerCase() || "parent";
      if (["mother", "mum", "mom"].includes(rel)) {
        guardianWord = "mum";
      } else if (["father", "dad"].includes(rel)) {
        guardianWord = "dad";
      } else {
        guardianWord = "parent";
      }
    }

    // ★ BUILD THE TOSIGN SENTENCE
    let ageClause = "";
    if (age !== null) {
      ageClause = ` because you're ${age}`;
    }
    const sentence = `Your ${guardianWord} signs it too${ageClause}.`;

    toSign = {
      documentId: doc.id,
      title: doc.title,
      sentence,
    };
  }

  // ★ GET THE FIRST GUARDIAN'S RELATIONSHIP
  const { rows: guardianRows } = await db.query(
    `SELECT relationship FROM keystone.guardian
      WHERE tenant_id = $1 AND child_user_id = $2
      ORDER BY created_at ASC
      LIMIT 1`,
    [tenantId, userId]
  );

  let guardianWord = "parent";
  if (guardianRows.length > 0) {
    const rel = guardianRows[0].relationship?.toLowerCase() || "parent";
    if (["mother", "mum", "mom"].includes(rel)) {
      guardianWord = "mum";
    } else if (["father", "dad"].includes(rel)) {
      guardianWord = "dad";
    } else {
      guardianWord = "parent";
    }
  }

  // ★ GET MOVE POLICY AND BUILD MOVE SENTENCE
  let move = null;
  if (next && nextServiceId) {
    const policy = await policyFor(db, tenantId, nextServiceId);
    const { short: moveShort } = policySentence(policy, { hostFirstName: next.hostName?.split(" ")[0] || null });
    if (policy.client_may_reschedule) {
      move = {
        allowed: true,
        sentence: moveShort,
      };
    }
  }

  return {
    role: "adolescent_client",
    next,
    comingUp: upcomingBookings,
    toSign,
    guardianWord,
    move,
    crisisLine: CRISIS_LINE,
  };
}
