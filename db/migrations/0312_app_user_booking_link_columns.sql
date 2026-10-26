-- 0312_app_user_booking_link_columns
-- Spec 03b task 3b.1 · CT-106 (booking-link system) · CT-120 (app_user.source, corrected 22 Sep 2026,
-- F-13 — see the note below).
--
-- ★★★ NO NEW COLUMN FOR LEAD SOURCE (F-13 correction). This migration was originally specced to add
--    `app_user.acquisition_source text NULL` (spec 03b §3, original text). CORRECTED: `app_user.source`
--    already exists (`db/migrations/0076_app_user_canonical_base.sql:106`, free text) with two existing
--    readers (`src/records/lists/people.mjs:250,261`; `src/records/shell.mjs:177,245`) and a report
--    reader (spec 08's `report_leads`, migration 0434) but ZERO writers — that report shipped
--    returning a single `('unknown', …)` row for every practice. This migration adds no second column
--    for the same fact; the public-booking route (task 3b.3, `POST /api/public/book`) writes the
--    existing `app_user.source` column from a `?src=`/`srcTag` query tag at lead-creation time,
--    giving `report_leads` its first real writer. CT-120 in CONTRACTS-FEATURES.md is the record of
--    this correction.

-- ★ booking_slug: the coach's own persistent link segment (`/book/:coachSlug`, task 3b.3). NULL
--   until a coach sets one via EngMyLink (spec 03b §2.3) — booking links are opt-in, not seeded.
-- ★ accepting_new_bookings: EngMyLink's own on/off switch (spec 03b §2.3) — defaults true so an
--   existing coach's link, once set, is live immediately rather than silently hidden.
ALTER TABLE keystone.app_user
  ADD COLUMN booking_slug text NULL,
  ADD COLUMN accepting_new_bookings boolean NOT NULL DEFAULT true;

-- ★★ Same label shape family as `validateSubdomain`'s practice-slug rule (`src/provisioning/subdomain.mjs`)
--    — reused, not re-derived, per spec 03b §3's own note. Lowercase alnum, single internal hyphens,
--    no leading/trailing hyphen.
ALTER TABLE keystone.app_user
  ADD CONSTRAINT app_user_booking_slug_shape
    CHECK (booking_slug IS NULL OR booking_slug ~ '^[a-z0-9](-?[a-z0-9])*$');

-- ★★★ TENANT-SCOPED, CASE-INSENSITIVE, PARTIAL. Two coaches in the same practice must not collide on
--    a slug; two coaches in DIFFERENT practices sharing a slug is fine (the practice is already
--    resolved by Host before the coach segment is ever read, §4.2). Partial WHERE excludes every
--    coach who has never set one, so NULL never collides with NULL (a plain UNIQUE index already
--    treats NULLs as distinct, but the explicit WHERE also keeps the index small).
CREATE UNIQUE INDEX app_user_booking_slug_key ON keystone.app_user (tenant_id, lower(booking_slug))
  WHERE booking_slug IS NOT NULL;

COMMENT ON COLUMN keystone.app_user.booking_slug IS
  'Spec 03b / 0312 (CT-106). This coach''s own persistent booking-link segment, /book/:coachSlug.
   NULL until set via EngMyLink. Unique per practice (case-insensitive), globally reusable across
   practices — the practice is already resolved by Host before this is read (CT-117, §4.2).';
COMMENT ON COLUMN keystone.app_user.accepting_new_bookings IS
  'Spec 03b / 0312. EngMyLink''s on/off switch for this coach''s booking link. Defaults true.
   False renders "Not taking new clients" on EngPublicCoach (bookable:false, not a 404 — the
   practice page is still real, spec 03b §2.2).';
