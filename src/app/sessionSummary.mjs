// 18.41 — SESSION SUMMARY: ATTENDANCE FACTS FOR EVERY CLIENT ROLE
//
// ★★★ THE TRUST LINE. A parent sees their children's attendance; every client sees the honest
//     count of sessions attended and cancelled in time, plus a sentence about charges.
//     "Nothing has been charged for a session you didn't have" IS the point — the absence of
//     a charge where one might have been applies.

/**
 * Calculate session summary statistics from a list of booking rows.
 *
 * ★★★ THE MATH:
 *   - attended: count of sessions where attended = true
 *   - cancelledInTime: count where state = 'cancelled' AND cancelled_at <= starts_at - cancellation_notice
 *   - cancelledLate: count where state = 'cancelled' AND cancelled_at > starts_at - cancellation_notice
 *   - chargedWithoutSession: count of entitlement_credit consumed rows linked to bookings that are
 *     EITHER not attended (attended = false) AND not cancelled late
 *     — this is the honest count: we charged for something that didn't happen
 *
 * @param {Array} rows - booking rows with fields: id, attended, state, cancelled_at, starts_at, cancellation_notice_minutes
 * @param {Object} options - { chargedBookingIds: Set of booking IDs that had charges }
 * @returns {Object} { attended, cancelledInTime, cancelledLate, chargedWithoutSession }
 */
export function sessionSummary(rows, { chargedBookingIds = new Set() } = {}) {
  let attended = 0;
  let cancelledInTime = 0;
  let cancelledLate = 0;
  let chargedWithoutSession = 0;

  for (const row of rows) {
    if (row.attended) {
      attended++;
    } else if (row.state === "cancelled") {
      // ★ Check if cancelled in time or late
      // In time means: cancelled_at <= starts_at - cancellation_notice_minutes
      const startsAtMs = new Date(row.starts_at).getTime();
      const cancelledAtMs = new Date(row.cancelled_at).getTime();
      const noticeMs = (row.cancellation_notice_minutes || 0) * 60 * 1000;
      const inTimeThresholdMs = startsAtMs - noticeMs;

      if (cancelledAtMs <= inTimeThresholdMs) {
        cancelledInTime++;
      } else {
        cancelledLate++;
      }
    }

    // ★ Count charges on sessions that were not attended and not late-cancelled
    if (chargedBookingIds.has(row.id)) {
      if (!row.attended) {
        // Not attended — check if it's also not late-cancelled
        if (row.state !== "cancelled") {
          // Not cancelled at all (confirmed, pending_payment, completed, no-show)
          chargedWithoutSession++;
        } else {
          // Cancelled — check if it was in time or late
          const startsAtMs = new Date(row.starts_at).getTime();
          const cancelledAtMs = new Date(row.cancelled_at).getTime();
          const noticeMs = (row.cancellation_notice_minutes || 0) * 60 * 1000;
          const inTimeThresholdMs = startsAtMs - noticeMs;

          if (cancelledAtMs > inTimeThresholdMs) {
            // Late cancellation — count the charge
            chargedWithoutSession++;
          }
        }
      }
    }
  }

  return {
    attended,
    cancelledInTime,
    cancelledLate,
    chargedWithoutSession,
  };
}
