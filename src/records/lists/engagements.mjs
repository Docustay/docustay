// ═══════════════════════════════════════════════════════════════════════════════════════════════
// P6.0b — THE ENGAGEMENTS SECTION'S LIST DESCRIPTORS.
// ★★★ SPLIT OUT OF THE 627-LINE `lists.mjs` SO THE 13 P6 SECTION BATCHES CAN RUN CONCURRENTLY.
//     All 29 descriptors lived in ONE file, keyed by nav path. Descriptors are the BULK of P6,
//     so with four subagents building four sections at once, every one of them would have had to
//     queue on this single file — and the parallelism would have collapsed to the screens only.
// ★★ THE SHARED PIECES STAY SHARED. `scoped()` and the column groups live in `_shared.mjs` and
//    are imported, never copied: two lists over the same table must not disagree about a label,
//    and 29 hand-written scope predicates would be 29 chances to write the wrong one (`F146`).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { scoped, emptyOf,
} from "./_shared.mjs";

export const ENGAGEMENTS_LISTS = Object.freeze({
  '/engagements/calendar': {
    // ★★★ P2.10 — `recordType` WAS ABSENT, so a row on this list could not be clicked through to a
    //     session's record page. P2.8 built the page; this is what connects them. **A list and a
    //     record page that both exist and are not linked is the same defect as either one missing**,
    //     and it was invisible because each half worked.
    title: 'Calendar', recordType: 'booking',
    columns: [
      { field: 'starts_at',    label: 'Starts',  format: 'datetime' },
      { field: 'service_name', label: 'Service', format: 'text' },
      { field: 'host_name',    label: `Coach`,   format: 'text' },
      { field: 'attendees',    label: 'With',    format: 'text' },
      { field: 'state',        label: 'State',   format: 'enum' },
      // ★ 13.24 — seats on the occurrence. `capacity` reads NULL as 1 (0396's own comment: "NULL =
      //   one-to-one (reads as 1)"); `taken` is computed from booking_participant, never stored.
      //   FALLBACK RENDERER ONLY — no bespoke widget for these two, per field 4.
      { field: 'capacity',     label: 'Capacity', format: 'number' },
      { field: 'taken',        label: 'Taken',    format: 'number' },
    ],
    ...emptyOf({
      kind: 'period',
      icon: 'IconCalendar',
      headline: 'Nothing booked this week',
      line: 'Move to another week, or book a session into this one.',
      action: { label: 'Book session', href: '/engagements/calendar?book=1' },
      // ═══════════════════════════════════════════════════════════════════════════════════════
      // ★★★ TOUCH-UP · WORKSTREAM 6.2 — PORTED FROM `EmptyCalendar.frame.html` (read fresh):
      //     headline/line are the frame's own words. `action` deliberately does NOT reuse the
      //     frame's own button ("Book a session") — the tracker's own instruction for this item is
      //     explicit that the CTA must go to the REAL availability surface
      //     (`/engagements/booking`), never a duplicate inline hours editor, and "book a session"
      //     cannot be the fix for "no hours exist to book into." `steps` is the frame's own
      //     "HOW THIS WORKS" 1-2-3, ported verbatim.
      // ═══════════════════════════════════════════════════════════════════════════════════════
      firstRun: {
        headline: 'Set your working hours',
        line: 'Clients and your team can only book inside these hours. You can still book yourself outside them.',
        action: { label: 'Set your hours', href: '/engagements/booking' },
      },
    }),
    sql: `
      SELECT b.id, b.starts_at, b.state,
             (SELECT s.name FROM keystone.service s WHERE s.id = b.service_id)  AS service_name,
             (SELECT bpr.program_id FROM keystone.booking_program bpr WHERE bpr.booking_id = b.id) AS program_id,
             (SELECT h.display_name FROM keystone.app_user h WHERE h.id = b.host_id) AS host_name,
             (SELECT string_agg(bp.display_name, ', ' ORDER BY bp.display_name)
                FROM keystone.booking_participant bp WHERE bp.booking_id = b.id) AS attendees,
             coalesce(b.capacity, 1) AS capacity,
             (SELECT count(*) FROM keystone.booking_participant bp
               WHERE bp.booking_id = b.id AND bp.party IN ('client', 'pir')) AS taken
        FROM keystone.booking b
       WHERE ${scoped('engagement', 'b')} AND b.starts_at > now() - interval '7 days'
         AND $1::uuid IS NOT NULL
       ORDER BY b.starts_at, b.id`,
  },
  '/engagements/sessions': {
    // ★ 13.24 — the SessionsList ledger. Frame order: When/Who/What/With/Where/State. `state_label`
    //   replaces the raw `state` enum on-screen (the raw `state` still rides in the row for a caller
    //   that needs to bucket by it — e.g. a Cancelled/Coming-up split — since NO server `?view=`
    //   filter exists to do that bucketing itself; see the file-level note below this object).
    title: 'Sessions', recordType: 'booking',
    columns: [
      { field: 'starts_at',    label: 'When',  format: 'datetime' },
      { field: 'who',          label: 'Who',   format: 'text' },
      { field: 'service_name', label: 'What',  format: 'text' },
      { field: 'host_name',    label: 'With',  format: 'text' },
      { field: 'where_label',  label: 'Where', format: 'text' },
      { field: 'state_label',  label: 'State', format: 'enum' },
      { field: 'program_id', label: 'Program', format: 'program' },
    ],
    ...emptyOf({
      kind: 'first-run',
      icon: 'IconClock',
      headline: 'No sessions yet',
      line: 'Every past and upcoming session, with its state and its notes.',
      action: { label: 'Book session', href: '/engagements/sessions?book=1' },
    }),
    sql: `
      SELECT b.id, b.starts_at, b.state,
             (SELECT s.name FROM keystone.service s WHERE s.id = b.service_id) AS service_name,
             (SELECT bpr.program_id FROM keystone.booking_program bpr WHERE bpr.booking_id = b.id) AS program_id,
             (SELECT h.display_name FROM keystone.app_user h WHERE h.id = b.host_id) AS host_name,
             (SELECT string_agg(bp.display_name, ', ' ORDER BY bp.display_name)
                FROM keystone.booking_participant bp
               WHERE bp.booking_id = b.id AND bp.party IN ('client', 'pir')) AS who,
             coalesce(
               b.location_detail,
               CASE b.location_kind
                 WHEN 'video'     THEN 'Video call'
                 WHEN 'phone'     THEN 'Phone'
                 WHEN 'in_person' THEN 'In person'
                 ELSE NULL
               END) AS where_label,
             coalesce(b.capacity, 1) AS capacity,
             (SELECT count(*) FROM keystone.booking_participant bp
               WHERE bp.booking_id = b.id AND bp.party IN ('client', 'pir')) AS taken,
             CASE
               WHEN b.state = 'pending_consent' THEN 'Consent unsigned'
               WHEN b.state = 'no_show'         THEN 'Didn''t show'
               WHEN b.state = 'completed'       THEN 'Done'
               -- ★ NOT in field 4's named list — 'cancelled' falling through to the "else" branch
               --   below would label a cancelled session 'Confirmed'. Added so state_label never
               --   states a false certainty; see the report for this deviation.
               WHEN b.state = 'cancelled'       THEN 'Cancelled'
               WHEN coalesce(b.capacity, 1) > 1 THEN
                 'Group reset — ' ||
                 (SELECT count(*) FROM keystone.booking_participant bp
                   WHERE bp.booking_id = b.id AND bp.party IN ('client', 'pir')) ||
                 ' of ' || coalesce(b.capacity, 1)
               -- ★★ STRIPE IS THE MONEY RECORD — this reads booking.price_id, the price agreed AT
               --    BOOKING TIME (0399's own comment), never a computed "what was charged." A price
               --    row of 0, or no price row on a free-payment-mode service, reads as 'Free'.
               WHEN (SELECT pr.amount_minor FROM keystone.price pr WHERE pr.id = b.price_id) = 0
                 OR (b.price_id IS NULL
                     AND (SELECT bpol.payment_mode FROM keystone.booking_policy bpol
                           WHERE bpol.service_id = b.service_id) = 'free')
                 THEN 'Free'
               ELSE 'Confirmed'
             END AS state_label
        FROM keystone.booking b
       WHERE ${scoped('engagement', 'b')}
         AND $1::uuid IS NOT NULL
       ORDER BY b.starts_at DESC, b.id`,
    // ★ 12.17's shape: raw counts, formatted by the caller (SessionsLedger, 13.33) into "{n} this
    //   week. {k} no-show(s) and {m} unsigned consent(s)." — matching `/people/all`'s `{clients,
    //   quiet}` precedent, since no descriptor anywhere pre-formats a sentence in SQL and the route
    //   (`src/routes/index.mjs:1663`) returns `summarySql`'s row verbatim as `summary`.
    //   "This week" mirrors `sessions_this_week`'s own window (`src/records/lists.mjs`): a rolling
    //   7 days forward from now, excluding cancelled. no-show/unsigned-consent counts are NOT time-
    //   windowed — they are every row currently in that state within this viewer's scope.
    summarySql: `
      SELECT
        count(*) FILTER (WHERE b.starts_at BETWEEN now() AND now() + interval '7 days'
                            AND b.state <> 'cancelled')::int AS "thisWeek",
        count(*) FILTER (WHERE b.state = 'no_show')::int AS "noShows",
        count(*) FILTER (WHERE b.state = 'pending_consent')::int AS "unsignedConsent"
        FROM keystone.booking b
       WHERE ${scoped('engagement', 'b')}`,
  },
  '/engagements/booking': {
    title: 'Online booking',
    columns: [
      { field: 'host_name',  label: `Coach`, format: 'text' },
      { field: 'day',        label: 'Day',   format: 'text' },
      { field: 'window',     label: 'Hours', format: 'text' },
      { field: 'effective_from', label: 'From', format: 'date' },
    ],
    // ★★ U22 — BOOKING RULES LIVE IN ENGAGEMENTS, NOT SETTINGS. §A6: `they change when a coach's`
    //    availability changes, which is weekly, not once."
    ...emptyOf({
      kind: 'first-run',
      icon: 'IconCalendarPlus',
      headline: 'Set your availability',
      line: `Clients cannot book online until a coach has hours. Add a weekly rule to open the diary.`,
      action: { label: 'Set hours', href: '/engagements/booking?new=1' },
    }),
    sql: `
      SELECT r.id, r.effective_from,
             (SELECT h.display_name FROM keystone.app_user h WHERE h.id = r.host_id) AS host_name,
             to_char(to_timestamp(r.day_of_week::text, 'ID'), 'Dy')                  AS day,
             -- ★ start_minute/end_minute are MINUTES FROM MIDNIGHT, local wall clock. §B4 STEP 3:
             --   local wall-clock + IANA zone, never stored UTC. Rendered as wall clock here.
             lpad((r.start_minute / 60)::text, 2, '0') || ':' || lpad((r.start_minute % 60)::text, 2, '0')
               || '–' ||
             lpad((r.end_minute   / 60)::text, 2, '0') || ':' || lpad((r.end_minute   % 60)::text, 2, '0')
                                                                                     AS window
        FROM keystone.availability_rule r
         WHERE ${scoped('availability', 'r')}
       ORDER BY r.host_id, r.day_of_week, r.start_minute, r.id`,
  },
  '/engagements/booking/settings': {
    title: 'Booking settings',
    columns: [
      { field: 'service_name',   label: 'Service',        format: 'text' },
      { field: 'buffer',         label: 'Buffers',        format: 'text' },
      { field: 'minimum_notice_minutes', label: 'Min notice (min)', format: 'number' },
      { field: 'booking_window_days',    label: 'Window (days)',    format: 'number' },
      { field: 'cancellation_notice_minutes', label: 'Cancel notice (min)', format: 'number' },
    ],
    ...emptyOf({
      kind: 'blocked',
      icon: 'IconSettings',
      headline: 'No services are bookable yet',
      line: 'A booking policy decides notice, buffers and cancellation for one service.',
      action: { label: 'Add policy', href: '/engagements/booking/settings?new=1' },
      blockedAction: { label: 'Add service', href: '/items/services?new=1' },
      blockedLine: 'Nothing is bookable yet: a service needs a price before a client can book it.',
    }),
    sql: `
      SELECT p.id, p.minimum_notice_minutes, p.booking_window_days, p.cancellation_notice_minutes,
             (SELECT s.name FROM keystone.service s WHERE s.id = p.service_id) AS service_name,
             p.buffer_before_minutes || ' before / ' || p.buffer_after_minutes || ' after' AS buffer
        FROM keystone.booking_policy p
         WHERE $1::uuid IS NOT NULL
       ORDER BY service_name NULLS FIRST, p.id`,
  },

  // ══ ITEMS — U13: FOUR WORDS, FOUR THINGS ═══════════════════════════════════
});
