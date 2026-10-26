-- 0013_booking_model
-- P7.3 / §B4 STEP 2 — the booking data model. Eight tables, every one `tenant_id`, ENABLE + FORCE.
--
-- ★★★ THE DECISION THIS MIGRATION TURNS ON — §B4 STEP 3, VERBATIM:
--   "Working hours, holidays and cutoffs stored as LOCAL time with the business's IANA zone.
--    Bookings stored as UTC instants. Storing everything in UTC is the mistake — a 09:00 slot is
--    wall-clock time in a timezone, not a point in time."
--
-- ★★ So the two kinds of time live in DIFFERENT COLUMN TYPES, and the type system carries the
-- rule. A rule column is `integer` minutes-from-local-midnight — a shape with **nowhere to put a
-- UTC offset**, so it cannot be silently reinterpreted. A booking column is `timestamptz` — a
-- real instant. ★ You cannot accidentally store one as the other; they do not type-check.
-- (Prior art: [MEASURED, research/B1-snagtime-diff.md §3] SnagTime reached the same
-- minutes-from-midnight primitive independently.)

-- ─────────────────────────────────────────────────────────────────────────────
-- 1 · availability_rule — the weekly pattern, in LOCAL time
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE keystone.availability_rule (
  id           uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id    uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  -- the staff member whose week this is
  host_id      uuid        NOT NULL REFERENCES keystone.app_user(id) ON DELETE CASCADE,
  -- ★ 0 = Sunday, matching EXTRACT(DOW) so the comparison needs no translation layer.
  day_of_week  smallint    NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  -- ★★ MINUTES FROM LOCAL MIDNIGHT. Not a time, not a timestamp — an offset into a wall-clock
  -- day. 540 = 09:00 wherever the business is, on a DST boundary or not.
  start_minute integer     NOT NULL CHECK (start_minute BETWEEN 0 AND 1440),
  end_minute   integer     NOT NULL CHECK (end_minute   BETWEEN 0 AND 1440),
  -- ★ EFFECTIVE DATING — [MEASURED, B1 §3] SnagTime has none, so "Tuesdays change from 1 March"
  -- cannot be expressed there and must be done by editing on the day.
  effective_from date      NOT NULL DEFAULT current_date,
  effective_to   date,
  created_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT rule_is_forward CHECK (end_minute > start_minute),
  CONSTRAINT rule_dates_ordered CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX availability_rule_lookup
  ON keystone.availability_rule (tenant_id, host_id, day_of_week);

COMMENT ON COLUMN keystone.availability_rule.start_minute IS
  '§B4 STEP 3 — minutes from LOCAL midnight. Deliberately not a timestamp: a 09:00 slot is wall-clock time in a timezone, not a point in time.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2 · date_override — a specific day differs (holiday, extra hours)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE keystone.date_override (
  id           uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id    uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  host_id      uuid        NOT NULL REFERENCES keystone.app_user(id) ON DELETE CASCADE,
  -- ★ A real `date`, not SnagTime's `dateKey` string. A date sorts and compares; a string does
  -- both wrong at a year boundary if anyone ever changes the format.
  on_date      date        NOT NULL,
  -- ★★ `is_available = false` is a CLOSURE (holiday). true with minutes is EXTRA hours.
  is_available boolean     NOT NULL DEFAULT false,
  start_minute integer     CHECK (start_minute BETWEEN 0 AND 1440),
  end_minute   integer     CHECK (end_minute   BETWEEN 0 AND 1440),
  reason       text,
  created_at   timestamptz NOT NULL DEFAULT now(),

  -- ★ A closure carries no hours; an opening must carry both and be forward.
  CONSTRAINT override_shape CHECK (
    (NOT is_available AND start_minute IS NULL AND end_minute IS NULL) OR
    (is_available AND start_minute IS NOT NULL AND end_minute IS NOT NULL
       AND end_minute > start_minute)
  ),
  UNIQUE (tenant_id, host_id, on_date)
);
CREATE INDEX date_override_lookup ON keystone.date_override (tenant_id, host_id, on_date);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3 · booking_policy — buffers, notice and window, per service
-- ─────────────────────────────────────────────────────────────────────────────
-- ★ §A6: "Booking rules live in Engagements, NOT Settings — they change when a coach's
-- availability changes, which is weekly, not once." P5.9 asserts the nav placement; this is where
-- the values actually live.
CREATE TABLE keystone.booking_policy (
  id                     uuid    PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id              uuid    NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  service_id             uuid    NOT NULL REFERENCES keystone.service(id) ON DELETE CASCADE,
  buffer_before_minutes  integer NOT NULL DEFAULT 0  CHECK (buffer_before_minutes >= 0),
  buffer_after_minutes   integer NOT NULL DEFAULT 0  CHECK (buffer_after_minutes  >= 0),
  minimum_notice_minutes integer NOT NULL DEFAULT 120 CHECK (minimum_notice_minutes >= 0),
  booking_window_days    integer NOT NULL DEFAULT 60 CHECK (booking_window_days > 0),
  cancellation_notice_minutes integer NOT NULL DEFAULT 1440 CHECK (cancellation_notice_minutes >= 0),
  UNIQUE (tenant_id, service_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4 · booking — UTC INSTANTS, and ★★★ THE OVERLAP GUARD
-- ─────────────────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE keystone.booking (
  id           uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id    uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  host_id      uuid        NOT NULL REFERENCES keystone.app_user(id) ON DELETE RESTRICT,
  service_id   uuid        NOT NULL REFERENCES keystone.service(id) ON DELETE RESTRICT,

  -- ★★ REAL INSTANTS. A booking IS a point in time; only the RULES are wall-clock.
  starts_at    timestamptz NOT NULL,
  ends_at      timestamptz NOT NULL,

  -- ★★★ THE OCCUPIED RANGE, INCLUDING BUFFERS. Maintained by a trigger so it cannot drift from
  -- starts_at/ends_at, and so the EXCLUDE constraint below is always guarding the truth.
  occupies     tstzrange   NOT NULL,
  buffer_before_minutes integer NOT NULL DEFAULT 0 CHECK (buffer_before_minutes >= 0),
  buffer_after_minutes  integer NOT NULL DEFAULT 0 CHECK (buffer_after_minutes  >= 0),

  state        text        NOT NULL DEFAULT 'confirmed'
                 CHECK (state IN ('pending_payment','confirmed','cancelled','completed','no_show')),
  cancelled_at timestamptz,
  -- ★ The invitee's zone, kept so a confirmation can be rendered in THEIR wall-clock time.
  invitee_timezone text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT booking_is_forward CHECK (ends_at > starts_at),
  CONSTRAINT cancelled_shape CHECK (
    (state = 'cancelled' AND cancelled_at IS NOT NULL) OR
    (state <> 'cancelled' AND cancelled_at IS NULL)
  ),

  -- ★★★ GUARD 1 — THE INDEX ITSELF UNDERSTANDS OVERLAP.
  -- [MEASURED, B1 §2] §B4 STEP 4 says "a unique index on the staff-and-slot pair … EITHER ONE
  -- ALONE STILL LETS DOUBLES THROUGH", and that is TRUE OF A START-KEYED INDEX: a 60-minute
  -- booking at 09:00 and a 30-minute at 09:30 have different starts, different keys, and overlap.
  -- ★★ An EXCLUDE on a RANGE is a different mechanism — it compares extents, not start points.
  -- P7.7 MEASURES whether it suffices alone rather than assuming either way.
  -- ★ A CANCELLED booking must not block the slot, hence the WHERE clause.
  EXCLUDE USING gist (
    tenant_id WITH =,
    host_id   WITH =,
    occupies  WITH &&
  ) WHERE (state <> 'cancelled')
);
CREATE INDEX booking_host_time ON keystone.booking (tenant_id, host_id, starts_at);

COMMENT ON COLUMN keystone.booking.occupies IS
  'P7.6 GUARD 1 — starts_at/ends_at WIDENED BY BUFFERS. The EXCLUDE constraint guards this, not the raw times, so a buffer collision is refused by the same index. Maintained by trigger; never written by hand.';

-- ★★ THE RANGE IS DERIVED, NEVER SUPPLIED. If a caller could set `occupies` independently of
-- `starts_at`/`ends_at`, the guard would protect a value that no longer describes the booking —
-- which is worse than no guard, because it still looks like one.
CREATE OR REPLACE FUNCTION keystone.booking_set_occupies()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.occupies := tstzrange(
    NEW.starts_at - make_interval(mins => NEW.buffer_before_minutes),
    NEW.ends_at   + make_interval(mins => NEW.buffer_after_minutes),
    '[)'   -- ★ half-open: a 10:00 end and a 10:00 start do NOT overlap, which is what
           -- back-to-back appointments mean. '[]' would forbid every adjacent booking.
  );
  RETURN NEW;
END $$;

CREATE TRIGGER booking_occupies_biu
  BEFORE INSERT OR UPDATE OF starts_at, ends_at, buffer_before_minutes, buffer_after_minutes
  ON keystone.booking
  FOR EACH ROW EXECUTE FUNCTION keystone.booking_set_occupies();

CREATE TRIGGER booking_touch BEFORE UPDATE ON keystone.booking
  FOR EACH ROW EXECUTE FUNCTION keystone.touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5 · booking_participant
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE keystone.booking_participant (
  id          uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id   uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  booking_id  uuid        NOT NULL REFERENCES keystone.booking(id) ON DELETE CASCADE,
  app_user_id uuid        REFERENCES keystone.app_user(id) ON DELETE RESTRICT,
  -- ★ A participant may be someone with no account — a parent attending, a referrer.
  display_name text       NOT NULL,
  email        text,
  -- ★ §2.7 — NAME THE PARTY YOU MEAN. The same closed vocabulary as document assignment.
  party        text       NOT NULL CHECK (party IN
                 ('pir','parent','coach','client','consultant','familyMember','recipient')),
  attended     boolean,
  UNIQUE (tenant_id, booking_id, party, display_name)
);
CREATE INDEX booking_participant_booking ON keystone.booking_participant (tenant_id, booking_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6 · package_balance and 7 · package_credit — ★★★ THE CREDIT IS A ROW
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE keystone.package_balance (
  id          uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id   uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  package_id  uuid        NOT NULL REFERENCES keystone.package(id) ON DELETE RESTRICT,
  app_user_id uuid        NOT NULL REFERENCES keystone.app_user(id) ON DELETE RESTRICT,
  purchased_at timestamptz NOT NULL DEFAULT now(),
  -- ★ The validity WINDOW resolved at purchase (0009 stores the duration on the package).
  expires_on  date,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX package_balance_owner ON keystone.package_balance (tenant_id, app_user_id);

-- ★★★ §B4 STEP 6: "the credit is a ROW, not a counter."
-- ★★ A counter cannot answer "which booking consumed which credit", cannot be audited, and
-- CANNOT BE MADE SAFE UNDER CONCURRENCY without a lock — two simultaneous `balance = balance - 1`
-- both read the same value. A row per credit turns draw-down into a WRITE THAT EITHER HAPPENS OR
-- DOES NOT, and returning one is setting a column back to NULL.
CREATE TABLE keystone.package_credit (
  id          uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id   uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  balance_id  uuid        NOT NULL REFERENCES keystone.package_balance(id) ON DELETE CASCADE,
  service_id  uuid        NOT NULL REFERENCES keystone.service(id) ON DELETE RESTRICT,
  -- ★★★ WHICH BOOKING CONSUMED THIS CREDIT. NULL = unspent. Named by §B4 STEP 6 explicitly.
  consumed_by_booking_id uuid REFERENCES keystone.booking(id) ON DELETE RESTRICT,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),

  -- ★ The two halves move together or not at all.
  CONSTRAINT credit_consumption_shape CHECK (
    (consumed_by_booking_id IS NULL     AND consumed_at IS NULL) OR
    (consumed_by_booking_id IS NOT NULL AND consumed_at IS NOT NULL)
  ),
  -- ★★★ ONE CREDIT PER BOOKING, ENFORCED. This is what makes "returns EXACTLY ONCE" (P7.11)
  -- provable rather than hoped for: a booking cannot consume two credits, so a double-return
  -- has nothing to return twice.
  UNIQUE (tenant_id, consumed_by_booking_id)
);
CREATE INDEX package_credit_unspent
  ON keystone.package_credit (tenant_id, balance_id) WHERE consumed_by_booking_id IS NULL;

COMMENT ON TABLE keystone.package_credit IS
  '§B4 STEP 6 — ★★★ THE CREDIT IS A ROW, NOT A COUNTER. A counter cannot say which booking consumed which credit, cannot be audited, and cannot be made concurrency-safe without a lock.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 8 · calendar_connection and 9 · calendar_event_map
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE keystone.calendar_connection (
  id            uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id     uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  host_id       uuid        NOT NULL REFERENCES keystone.app_user(id) ON DELETE CASCADE,
  provider      text        NOT NULL CHECK (provider IN ('google','microsoft')),
  external_account text     NOT NULL,
  -- ★ The incremental-sync token. [DOC] Google returns `nextSyncToken`; a 410 Gone means it is
  -- dead and a FULL RESYNC with a fresh token is required (§B3.1).
  sync_token    text,
  -- ★★★ THE RENEWAL DEADLINE. [DOC] Google push channels expire at a MAXIMUM of 604800s (7 days).
  -- "IF RENEWAL FAILS YOU SILENTLY START MISSING CHANGE EVENTS. That is this project's exact
  -- failure class." P7.9 asserts that a missed renewal is LOUD.
  channel_expires_at timestamptz,
  last_renewed_at    timestamptz,
  last_swept_at      timestamptz,
  -- ★ A connection that has failed renewal is not "maybe fine" — it is degraded and says so.
  status        text        NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','renewal_failed','revoked','needs_full_resync')),
  last_error    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, host_id, provider, external_account)
);
CREATE INDEX calendar_connection_renewal
  ON keystone.calendar_connection (channel_expires_at) WHERE status = 'active';

CREATE TRIGGER calendar_connection_touch BEFORE UPDATE ON keystone.calendar_connection
  FOR EACH ROW EXECUTE FUNCTION keystone.touch_updated_at();

CREATE TABLE keystone.calendar_event_map (
  id            uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id     uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  connection_id uuid        NOT NULL REFERENCES keystone.calendar_connection(id) ON DELETE CASCADE,
  booking_id    uuid        REFERENCES keystone.booking(id) ON DELETE CASCADE,
  external_event_id text    NOT NULL,
  external_etag     text,
  -- ★★ OUR OWN WRITES ARE TAGGED, so an A→B→A echo is recognisable and dropped (§B3.2).
  written_by_us boolean     NOT NULL DEFAULT false,
  sync_marker   text,
  last_seen_at  timestamptz NOT NULL DEFAULT now(),

  -- ★★★ KEYED ON CONNECTION ID **PLUS** EVENT ID, NEVER EVENT ID ALONE.
  -- [DOC, §B3.2] Google shares ONE event id across all attendees; Microsoft and iCloud do not.
  -- ★ Keying on the event id alone would make two coaches' copies of the same Google meeting
  -- collide — one coach's sync would overwrite the other's, and the symptom would be a booking
  -- that silently changes owner.
  UNIQUE (connection_id, external_event_id)
);
CREATE INDEX calendar_event_map_booking ON keystone.calendar_event_map (tenant_id, booking_id);

COMMENT ON CONSTRAINT calendar_event_map_connection_id_external_event_id_key
  ON keystone.calendar_event_map IS
  '§B3.2 — connection id PLUS event id. Google shares one event id across attendees; keying on the id alone makes two hosts'' copies of the same meeting collide.';

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS — every table, ENABLE *and* FORCE (P1.7). The catalog gate enforces it independently.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['availability_rule','date_override','booking_policy','booking',
                           'booking_participant','package_balance','package_credit',
                           'calendar_connection','calendar_event_map'] LOOP
    EXECUTE format('ALTER TABLE keystone.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE keystone.%I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format($f$CREATE POLICY tenant_isolation ON keystone.%I
                      USING (tenant_id = keystone.current_tenant_id())$f$, t);
    EXECUTE format($f$CREATE POLICY tenant_insert ON keystone.%I
                      FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id())$f$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.%I TO app_rw', t);
  END LOOP;
END $$;
