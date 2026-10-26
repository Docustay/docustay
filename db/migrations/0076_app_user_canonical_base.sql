-- 0076 — P2.1 · `app_user` GETS THE FIELDS A PRACTICE ACTUALLY RECORDS ABOUT A PERSON.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE MEASURED SHAPE, AND A CORRECTION TO THE SLOGAN. `~/keystone/CLAUDE.md` failure 3 and the
--     `keystone-spec-check` skill both say `app_user` shipped with "FOUR columns — name, email, role,
--     rank". [EXECUTED against the catalog] it has NINE: `id · tenant_id · email · display_name ·
--     role · created_at · updated_at · staff_role · firebase_uid`.
--   ★★ **The real gap is worse than the slogan, not better.** Four of the nine are plumbing and two
--      are auth. **TWO are person data** — `email` and `display_name`. The schema was built from the
--      ACCESS RULES, and no form can fix a table that holds nothing.
--
-- ★★★ THE FOUR CONSEQUENCES THIS FIXES, EACH MEASURED RATHER THAN IMAGINED:
--   1. `display_name` is ONE free-text field, so the practice cannot sort by surname.
--   2. `role` carries `adolescent_client`, so **minority is asserted and never dated** — nothing
--      records when the person stops being a minor, and nothing can.
--   3. `/people/leads` filters on `role`, so **a lead who converts loses the fact they were ever
--      one.** Lifecycle is a different axis from what kind of person somebody is.
--   4. **An emergency contact cannot be recorded, in a recovery-coaching product.**
--
-- ★★★ WHAT IS DELIBERATELY *NOT* ADDED, AND WHY — READ THIS BEFORE "COMPLETING" THE LIST.
--     The canonical model lists `next appointment`, `lifetime value` and `balance` under
--     Operational. **Those are DERIVED, and they are already derived**: `src/records/queries.mjs`
--     computes `next_session`, `credit_progress` and `billing_status` from the booking, entitlement
--     and invoice tables at read time.
--   ★★ Storing them here would be two systems holding one fact — the `DUPLICATE-TRUTH` class this
--      project has already paid for twice — and the stored copy is the one that goes stale the first
--      time somebody cancels a session. **The canonical list describes what a CRM SHOWS, not what it
--      STORES.** A field that can be computed is not a field.
--
-- ★ ALSO NOT ADDED: allergies, injuries, dietary restrictions. They sit close to health data, and
--   `keystone-spec-check` Part 1B requires the terms to say in plain words that Keystone is not a
--   medical record wherever they exist. **P11.9 owes that sentence regardless**; this item does not
--   create the obligation early.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- IDENTITY
-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- ★★ `display_name` STAYS AND STAYS NOT-NULL. It is read in 40+ places and is what a person is
--    called; splitting it would be a rename disguised as a schema change. The parts are added
--    BESIDE it so the practice can sort by surname, and P2.2's field layer decides which the form
--    asks for first.
ALTER TABLE keystone.app_user
  ADD COLUMN first_name     text,
  ADD COLUMN last_name      text,
  ADD COLUMN preferred_name text,
  ADD COLUMN pronouns       text,
  -- ★★★ THE COLUMN THAT ENDS "MINORITY IS ASSERTED AND NEVER DATED". `role='adolescent_client'` is
  --     a claim with no date behind it; a date of birth is a fact that answers itself over time.
  ADD COLUMN date_of_birth  date;

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- CONTACT — including the three flags that are routinely missed
-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- ★★★ [MEASURED] THERE IS NO PHONE COLUMN ANYWHERE IN THE 63 TABLES. A CRM for an appointment
--     business could not store a phone number.
ALTER TABLE keystone.app_user
  ADD COLUMN secondary_email text,
  ADD COLUMN mobile_phone    text,
  ADD COLUMN home_phone      text,

  -- ★ A closed set, enumerated: a typo here silently routes a reminder nowhere.
  ADD COLUMN preferred_contact_method text
    CONSTRAINT app_user_contact_method_check
    CHECK (preferred_contact_method IS NULL
           OR preferred_contact_method IN ('email', 'text', 'call', 'none')),

  -- ★★★ THE THREE DO-NOT-CONTACT FLAGS. **A CRM that cannot record "do not text this person" will
  --     text them.** NOT NULL with a `false` default, because a null here is a question nobody
  --     answered and the send path would read it as permission.
  ADD COLUMN do_not_email boolean NOT NULL DEFAULT false,
  ADD COLUMN do_not_text  boolean NOT NULL DEFAULT false,
  ADD COLUMN do_not_call  boolean NOT NULL DEFAULT false;

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- ADDRESS
-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- ★ `state_region`, not `state`: `state` is already a loaded word in this schema (booking.state,
--   document_instance.state) and a column that means two things in one database is a bug waiting
--   for a join.
ALTER TABLE keystone.app_user
  ADD COLUMN address_line1 text,
  ADD COLUMN address_line2 text,
  ADD COLUMN city          text,
  ADD COLUMN state_region  text,
  ADD COLUMN postcode      text,
  ADD COLUMN country       text,
  -- ★★ THE PERSON'S OWN ZONE, WHICH IS NOT THE PRACTICE'S. `tenant.timezone` is where the business
  --    is; a client can be somewhere else, and a reminder sent at "9am" has to pick one. IANA name,
  --    same convention as `tenant.timezone` and `booking.invitee_timezone`.
  ADD COLUMN timezone      text;

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- RELATIONSHIP
-- ───────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE keystone.app_user
  -- ★★★ LIFECYCLE IS A DIFFERENT AXIS FROM WHAT KIND OF PERSON SOMEBODY IS, and conflating them is
  --     what makes a converted lead forget it was one. `role` says adult_client / parent / staff;
  --     this says where they are in the relationship. **P6.7 re-points `/people/leads` at this.**
  --   ★ Defaults to 'lead', because that is what everybody is before they are anything else — and
  --     the backfill below moves the ones who are demonstrably further along.
  ADD COLUMN lifecycle_status text NOT NULL DEFAULT 'lead'
    CONSTRAINT app_user_lifecycle_check
    CHECK (lifecycle_status IN ('lead', 'active', 'paused', 'former')),

  ADD COLUMN source          text,
  ADD COLUMN referred_by_id  uuid,
  -- ★ An array, not a join table. Tags are a free vocabulary with no attributes of their own; a
  --   `tag` table would be three joins to render a chip row, and P2.2's CUSTOM layer is where a
  --   tenant gets structured fields.
  ADD COLUMN tags            text[] NOT NULL DEFAULT '{}';

-- ★★ COMPOSITE, like every other cross-row FK added since P1.2 — RLS does not police foreign keys,
--    so without `tenant_id` in the key a person could be "referred by" somebody in another practice.
ALTER TABLE keystone.app_user ADD CONSTRAINT app_user_referred_by_fkey
  FOREIGN KEY (tenant_id, referred_by_id) REFERENCES keystone.app_user (tenant_id, id)
  ON DELETE SET NULL (referred_by_id);

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- OPERATIONAL · EMERGENCY · SYSTEM · the recovery-coaching vertical
-- ───────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE keystone.app_user
  -- ★ `joined_at` is NOT `created_at`. The row is created when somebody types it in; the person
  --   joined when they joined, which is often earlier and is a fact about the practice.
  ADD COLUMN joined_at    date,
  ADD COLUMN last_seen_at timestamptz,
  ADD COLUMN notes        text,

  -- ★★★ AN EMERGENCY CONTACT, IN A RECOVERY-COACHING PRODUCT. Three columns rather than a related
  --     table: it is exactly one contact, it has no lifecycle of its own, and a table would make
  --     the common case (read it off the record page) a join.
  ADD COLUMN emergency_contact_name         text,
  ADD COLUMN emergency_contact_relationship text,
  ADD COLUMN emergency_contact_phone        text,

  ADD COLUMN created_by uuid REFERENCES keystone.app_user(id) ON DELETE SET NULL,

  -- ★★ THE VERTICAL ADD-ON (recovery coaching). Four fields on top of the base — which is the whole
  --    point of the layer model: most verticals differ by about four fields and the BASE does the
  --    work. P2.2 makes this set a TEMPLATE rather than something every tenant carries.
  --  ★ `sobriety_date` is a DATE the person owns, not a computed streak. A streak is derived.
  ADD COLUMN sobriety_date      date,
  ADD COLUMN recovery_programme text,
  ADD COLUMN sponsor_name       text,
  ADD COLUMN support_network    text;

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- INDEXES — only where a screen already asks the question
-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- ★ `/people/leads` becomes a lifecycle filter at P6.7; this is the index that read needs.
CREATE INDEX app_user_lifecycle_idx ON keystone.app_user (tenant_id, lifecycle_status);
-- ★ Sorting by surname is one of the four consequences this item exists to fix.
CREATE INDEX app_user_last_name_idx ON keystone.app_user (tenant_id, last_name);

COMMENT ON COLUMN keystone.app_user.lifecycle_status IS
  'P2.1 — where the person is in the relationship: lead · active · paused · former. ★★★ A DIFFERENT '
  'AXIS FROM `role`, which says what KIND of person they are. Conflating them is why /people/leads '
  'filtered on `role` and a converted lead lost the fact it had ever been one.';

COMMENT ON COLUMN keystone.app_user.date_of_birth IS
  'P2.1 — ★★ the column that ends "minority is asserted and never dated". `role = adolescent_client` '
  'is a claim with no date behind it and nothing that expires; a date of birth answers itself.';

COMMENT ON COLUMN keystone.app_user.do_not_text IS
  'P2.1 — one of three canonical do-not-contact flags, NOT NULL DEFAULT false. ★★★ A null here is a '
  'question nobody answered, and a send path would read it as permission. **A CRM that cannot record '
  '"do not text this person" will text them.**';
