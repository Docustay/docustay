-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- P2.5 — `booking`: 14 COLUMNS, AND IT COULD NOT SAY WHERE IT WAS.
--
-- ★★★ THE MEASURED STATE. `keystone.booking` is (id · tenant_id · host_id · service_id · starts_at ·
--     ends_at · occupies · buffer_before_minutes · buffer_after_minutes · state · cancelled_at ·
--     invitee_timezone · created_at · updated_at). Fourteen columns, and **not one of them says
--     where the session happens, what it is about, or anything a coach wrote down.**
--
-- ★★ AND A RULING ALREADY DEPENDED ON A COLUMN THAT DID NOT EXIST — F120. `src/app/surfaces.mjs`'s
--    `R6_RULINGS` declines to build messaging partly because *"a booking has a notes field."* It has
--    fourteen columns and none is `notes`. **This migration makes an existing decision true**, which
--    is a different and better thing than adding a field somebody might want.
--
-- ★ EVERYTHING HERE IS NULLABLE. A booking made before this migration is not a defective booking,
--   and a NOT NULL with a backfilled default would invent a location for sessions that happened
--   years ago. The absence is the honest value.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- ── 1 · WHAT IT IS ABOUT ────────────────────────────────────────────────────────────────────────
-- ★ NULL means "call it by the service's name", which is what every screen does today. A title is an
--   override for the session that is not like the others, not a duplicate of the service name.
ALTER TABLE keystone.booking ADD COLUMN title text;

-- ★★★ THE NOTES FIELD F120 IS ABOUT. Kept distinct from a SESSION NOTE, which is a clinical-ish
--     record living on `document_instance` behind `is_session_note` and the guardian rules (F148).
--     This is the agenda: "bring the paperwork", "second half on the housing application".
ALTER TABLE keystone.booking ADD COLUMN description text;

-- ── 2 · ★★★ WHERE IT IS — TWO COLUMNS, NEVER ONE STRING ─────────────────────────────────────────
-- A single `location text` cannot be acted on. "Zoom" is not a link you can join, and a room number
-- is not a telephone number you can ring. The KIND decides what the detail MEANS and therefore what
-- the screen can do with it — render a join button, a map link, or a dial link.
--   ★★ A CLOSED SET, in the database, because a kind the UI does not understand renders as nothing.
--      This is the TOPIC pattern rather than the SETTING pattern: adding a kind costs a migration on
--      purpose, because every new kind needs a renderer to go with it.
ALTER TABLE keystone.booking ADD COLUMN location_kind text;
ALTER TABLE keystone.booking ADD COLUMN location_detail text;

ALTER TABLE keystone.booking
  ADD CONSTRAINT booking_location_kind_check
  CHECK (location_kind IS NULL OR location_kind IN ('in_person', 'video', 'phone', 'other'));

-- ★★ A DETAIL WITH NO KIND IS UNREADABLE — refuse it. A KIND WITH NO DETAIL IS ALLOWED, and that is
--    deliberate in the other direction: a video link is often generated after the booking is made,
--    and refusing the kind until the link exists would mean the booking could not record that it is
--    a video call at all. The screen says "link not set yet", which is true and actionable.
ALTER TABLE keystone.booking
  ADD CONSTRAINT booking_location_detail_needs_kind
  CHECK (location_detail IS NULL OR location_kind IS NOT NULL);

-- ── 3 · WHO MADE IT ─────────────────────────────────────────────────────────────────────────────
-- ★ Distinct from `host_id`: the front desk books a session the coach runs. Collapsing them loses
--   the one fact an audit of "who put this in the diary" needs.
-- ★★ COMPOSITE, and SET NULL names its own column (F144) — the bare form nulls `tenant_id` too.
ALTER TABLE keystone.booking ADD COLUMN created_by uuid;

ALTER TABLE keystone.booking
  ADD CONSTRAINT booking_created_by_fkey
  FOREIGN KEY (tenant_id, created_by) REFERENCES keystone.app_user (tenant_id, id)
  ON DELETE SET NULL (created_by);

-- ── 4 · WHY IT DID NOT HAPPEN ───────────────────────────────────────────────────────────────────
-- ★★ A reason with no cancellation is a statement about nothing. `cancelled_shape` already ties
--    `cancelled_at` to the state; this ties the reason to the cancellation, so the three cannot
--    drift into a row that reads "confirmed — client was unwell".
ALTER TABLE keystone.booking ADD COLUMN cancellation_reason text;

ALTER TABLE keystone.booking
  ADD CONSTRAINT booking_reason_needs_cancellation
  CHECK (cancellation_reason IS NULL OR cancelled_at IS NOT NULL);

-- ── 5 · ★★ RECURRENCE — THE SERIES, NOT AN RRULE ENGINE ─────────────────────────────────────────
-- ★★★ WHAT IS DELIBERATELY NOT BUILT, AND WHY. A full RFC 5545 recurrence rule with expansion,
--     exceptions and materialisation is a feature, not a column, and `keystone-spec-check` warns
--     against inventing a general system where the domain has a small one. A coaching practice books
--     "same time every week until we stop" — a CADENCE and a SERIES, and those two facts are what
--     the product actually needs to answer "is this one of Dana's weekly slots?"
--   ★★ EXPANSION — creating next week's row — IS P7.19's, and it is named here rather than implied.
--      What this migration guarantees is that when P7.19 creates it, the series is REPRESENTABLE.
ALTER TABLE keystone.booking ADD COLUMN recurrence_cadence text;
ALTER TABLE keystone.booking ADD COLUMN recurrence_group_id uuid;

ALTER TABLE keystone.booking
  ADD CONSTRAINT booking_recurrence_cadence_check
  CHECK (recurrence_cadence IS NULL OR recurrence_cadence IN ('weekly', 'fortnightly', 'monthly'));

-- ★★ THE TWO TRAVEL TOGETHER, IN BOTH DIRECTIONS. A cadence with no series is a claim that something
--    repeats with nothing to repeat with; a series with no cadence cannot say what the pattern is.
--    Stated as one CHECK so neither half can be added alone later.
ALTER TABLE keystone.booking
  ADD CONSTRAINT booking_recurrence_is_whole
  CHECK ((recurrence_cadence IS NULL) = (recurrence_group_id IS NULL));

-- ★ The composite self-FK needs a unique index on (tenant_id, id) to point at — the same thing 0066
--   had to add for `app_user`, for the same reason: the primary key is on `id` alone.
CREATE UNIQUE INDEX booking_tenant_id_id_key ON keystone.booking (tenant_id, id);

-- ★★ THE SERIES POINTS AT ITS FIRST BOOKING, which points at itself. That makes "the whole series"
--    one predicate (`recurrence_group_id = $1`) rather than a walk, and it makes a cross-tenant
--    series unrepresentable — a series spanning two practices is not a thing.
ALTER TABLE keystone.booking
  ADD CONSTRAINT booking_recurrence_group_fkey
  FOREIGN KEY (tenant_id, recurrence_group_id) REFERENCES keystone.booking (tenant_id, id)
  ON DELETE SET NULL (recurrence_group_id);

CREATE INDEX booking_recurrence_group_idx
  ON keystone.booking (tenant_id, recurrence_group_id)
  WHERE recurrence_group_id IS NOT NULL;

-- ── 6 · ★★★ THE REMINDER — AND THE TEMPLATE THAT HAS NEVER BEEN SENT ────────────────────────────
-- [MEASURED] `src/email/templates.mjs:97` defines `booking.reminder`, with its required variables
-- declared at :122. Its ONLY reference anywhere else in the project is `db/gates/p18_email.mjs:94`,
-- which RENDERS it to check the wording. **Nothing schedules it. Nothing sends it.** A reminder
-- template that has never reminded anybody is the orphan class this project keeps finding.
--   ★★ So this column is not a preference for a feature that exists — it is half of making the
--      feature exist, and `src/booking/reminders.mjs` is the other half.
--   ★ NULL means NO REMINDER, explicitly. Zero is not used as an off switch: a magic value in an
--     integer column is read as a duration by the next person to open the file.
ALTER TABLE keystone.booking ADD COLUMN reminder_minutes_before integer;

ALTER TABLE keystone.booking
  ADD CONSTRAINT booking_reminder_is_positive
  CHECK (reminder_minutes_before IS NULL OR reminder_minutes_before > 0);

-- ── 7 · OPTIONAL ATTENDEES ──────────────────────────────────────────────────────────────────────
-- ★ On the PARTICIPANT, not the booking: optional-ness is a fact about a person's relationship to
--   this session, not about the session. A parent who may join their adolescent's review is optional;
--   the adolescent is not.
-- ★★ NOT NULL DEFAULT false — every existing participant is required, which is what they were.
ALTER TABLE keystone.booking_participant
  ADD COLUMN optional boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN keystone.booking.location_kind IS
  'P2.5 — in_person | video | phone | other. ★★ The kind decides what location_detail MEANS, and '
  'therefore what the screen can offer: a join link, a map, or a dial link. One free-text location '
  'column can be displayed and never acted on.';

COMMENT ON COLUMN keystone.booking.reminder_minutes_before IS
  'P2.5 — NULL means no reminder, explicitly; zero is NOT an off switch. ★★★ The booking.reminder '
  'email template has existed since P18 and nothing has ever sent it — this column and '
  'src/booking/reminders.mjs are the two halves that change that.';

COMMENT ON COLUMN keystone.booking.recurrence_group_id IS
  'P2.5 — every booking in a series points at the FIRST one, which points at itself. Composite FK, '
  'so a series cannot span two practices. ★ Creating the NEXT occurrence is P7.19; this guarantees '
  'the series is representable when it does.';
