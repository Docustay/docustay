-- 0496_booking_link_scope
--
-- Stage 20 §4 — THE SEPARATION (Ty, 25 Sep 2026): recovery coaching and life coaching must not
-- share a booking page, and the mechanism must GENERALISE. Two pieces of schema:
--
--   §1  `phone` joins the delivery-mode vocabulary on `service.delivery_modes` (0410) and
--       `price.delivery_mode` (0413). Ty's ruling asked for "virtual" to be added; the repo's
--       identifier for virtual delivery is ALREADY `video` (0085's applied booking.location_kind,
--       0410, 0413, items.default_delivery) — a second spelling of the same fact is the exact
--       defect class this project hunts, so `video` stays the identifier, every UI label reads
--       "Virtual", and `phone` (which Ty's own catalogue sells: the $12.50 check-in call) is the
--       value that was genuinely missing. Recorded as a ruling in STRIPE-CLEANUP-AND-IMPORT.md.
--
--   §2  `keystone.booking_link` + three scope join tables — a practice's named, shareable booking
--       links, each optionally scoped to service categories, staff, and locations. NO scope rows
--       of a kind = unscoped on that axis (all categories / all staff / all locations). The bare
--       public page's default is NOT schema: it is the `booking.public_page_categories` tenant
--       setting (settings are enforced server-side on the route — Group C ruling 1).
--
-- CT-F52 — the new-tenant-table checklist, all eight points, for each table below (idiom copied
-- from 0381_location.sql, including the EXECUTE lend for the reference-guard triggers).

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §1 · `phone` joins the delivery-mode vocabulary
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0410's CHECK is unnamed (inline on the column), so find-and-drop by definition is fragile;
-- the constraint name Postgres generated is deterministic (`service_delivery_modes_check`).
ALTER TABLE keystone.service DROP CONSTRAINT service_delivery_modes_check;
ALTER TABLE keystone.service ADD CONSTRAINT service_delivery_modes_check
  CHECK (cardinality(delivery_modes) >= 1
         AND delivery_modes <@ ARRAY['in_person','video','at_client','phone']);
COMMENT ON COLUMN keystone.service.delivery_modes IS
  '0410 / widened 0496 (§4): in_person | video | at_client | phone. `video` IS the virtual mode —
   UI labels read "Virtual"; the identifier matches 0085''s applied booking.location_kind
   vocabulary and is never respelled.';

ALTER TABLE keystone.price DROP CONSTRAINT price_delivery_mode_check;
ALTER TABLE keystone.price ADD CONSTRAINT price_delivery_mode_check
  CHECK (delivery_mode IS NULL OR delivery_mode IN ('in_person', 'video', 'at_client', 'phone'));

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §2 · keystone.booking_link — a practice's named, shareable, SCOPED booking links
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★ Distinct from a coach's own `/book/:coachSlug` (`app_user.booking_slug`, 0312): that link is a
--   PERSON; this is a PAGE — "the recovery-coaching page", "the life-coaching page" — resolved at
--   `GET /api/public/book/link?slug=…`, never colliding with the coach namespace.
CREATE TABLE keystone.booking_link (
  id          uuid PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id   uuid NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  slug        text NOT NULL CHECK (slug ~ '^[a-z0-9](-?[a-z0-9])*$'),  -- same shape family as 0312
  name        text NOT NULL CHECK (btrim(name) <> '' AND char_length(name) <= 120),
  active      boolean NOT NULL DEFAULT true,
  archived_at timestamptz NULL,
  created_by  uuid NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_link_created_by_fkey FOREIGN KEY (tenant_id, created_by)
    REFERENCES keystone.app_user (tenant_id, id) ON DELETE SET NULL (created_by)
);
CREATE UNIQUE INDEX booking_link_tenant_id_key ON keystone.booking_link (tenant_id, id);
CREATE UNIQUE INDEX booking_link_slug_key ON keystone.booking_link (tenant_id, lower(slug))
  WHERE archived_at IS NULL;

-- ★ The three scope axes as REAL join tables with REAL FKs — never uuid[] columns, which can
--   reference nothing. No rows of a kind = unscoped on that axis. ON DELETE CASCADE from the link
--   (scope rows are meaningless without it); RESTRICT from the target (archiving a category/staff/
--   location that a live link points at is a decision, not a silent unscoping).
CREATE TABLE keystone.booking_link_category (
  tenant_id   uuid NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  link_id     uuid NOT NULL,
  category_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, link_id, category_id),
  CONSTRAINT booking_link_category_link_fkey FOREIGN KEY (tenant_id, link_id)
    REFERENCES keystone.booking_link (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT booking_link_category_category_fkey FOREIGN KEY (tenant_id, category_id)
    REFERENCES keystone.service_category (tenant_id, id) ON DELETE RESTRICT
);
CREATE TABLE keystone.booking_link_staff (
  tenant_id   uuid NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  link_id     uuid NOT NULL,
  app_user_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, link_id, app_user_id),
  CONSTRAINT booking_link_staff_link_fkey FOREIGN KEY (tenant_id, link_id)
    REFERENCES keystone.booking_link (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT booking_link_staff_user_fkey FOREIGN KEY (tenant_id, app_user_id)
    REFERENCES keystone.app_user (tenant_id, id) ON DELETE CASCADE
);
CREATE TABLE keystone.booking_link_location (
  tenant_id   uuid NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  link_id     uuid NOT NULL,
  location_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, link_id, location_id),
  CONSTRAINT booking_link_location_link_fkey FOREIGN KEY (tenant_id, link_id)
    REFERENCES keystone.booking_link (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT booking_link_location_location_fkey FOREIGN KEY (tenant_id, location_id)
    REFERENCES keystone.location (tenant_id, id) ON DELETE RESTRICT
);

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §3 · CT-F52 for all four tables: RLS (ENABLE + FORCE), tenant policies, reference-guard read,
--      both refuse-reference triggers (ENABLE ALWAYS), grants.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $rls$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['booking_link','booking_link_category','booking_link_staff','booking_link_location'] LOOP
    EXECUTE format('ALTER TABLE keystone.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE keystone.%I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON keystone.%I USING (tenant_id = keystone.current_tenant_id())', t);
    EXECUTE format('CREATE POLICY tenant_insert ON keystone.%I FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id())', t);
    EXECUTE format('CREATE POLICY tenant_update ON keystone.%I FOR UPDATE USING (tenant_id = keystone.current_tenant_id()) WITH CHECK (tenant_id = keystone.require_tenant_id())', t);
    EXECUTE format('CREATE POLICY tenant_delete ON keystone.%I FOR DELETE USING (tenant_id = keystone.current_tenant_id())', t);
    EXECUTE format('CREATE POLICY reference_guard_read ON keystone.%I FOR SELECT TO reference_guard USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference))', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.%I TO app_rw', t);
    EXECUTE format('GRANT SELECT ON keystone.%I TO reference_guard', t);
  END LOOP;
END
$rls$;

-- ★★★ THE EXECUTE LEND (0381's own idiom, measured there): CREATE TRIGGER requires EXECUTE on the
--     trigger function at CREATE time; reference_guard owns it and every prior borrower REVOKEd it
--     back, so there is no standing grant to inherit.
SET LOCAL ROLE reference_guard;
GRANT EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() TO app_owner;
SET LOCAL ROLE app_owner;

DO $trg$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['booking_link','booking_link_category','booking_link_staff','booking_link_location'] LOOP
    EXECUTE format('CREATE TRIGGER %I AFTER DELETE ON keystone.%I REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows()', t || '_refuse_reference_delete_trg', t);
    EXECUTE format('ALTER TABLE keystone.%I ENABLE ALWAYS TRIGGER %I', t, t || '_refuse_reference_delete_trg');
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON keystone.%I FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows()', t || '_refuse_reference_truncate_trg', t);
    EXECUTE format('ALTER TABLE keystone.%I ENABLE ALWAYS TRIGGER %I', t, t || '_refuse_reference_truncate_trg');
  END LOOP;
END
$trg$;

SET LOCAL ROLE reference_guard;
REVOKE EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() FROM app_owner;
SET LOCAL ROLE app_owner;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §4 · self-check — by content, not by absence of error
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $check$
DECLARE t text; n int;
BEGIN
  -- the widened vocabulary actually admits 'phone' and still refuses junk
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'service_delivery_modes_check'
       AND conrelid = 'keystone.service'::regclass
       AND pg_get_constraintdef(oid) LIKE '%phone%') THEN
    RAISE EXCEPTION '0496: service_delivery_modes_check does not admit phone';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'price_delivery_mode_check'
       AND conrelid = 'keystone.price'::regclass
       AND pg_get_constraintdef(oid) LIKE '%phone%') THEN
    RAISE EXCEPTION '0496: price_delivery_mode_check does not admit phone';
  END IF;
  FOREACH t IN ARRAY ARRAY['booking_link','booking_link_category','booking_link_staff','booking_link_location'] LOOP
    SELECT count(*) INTO n FROM pg_policy WHERE polrelid = ('keystone.' || t)::regclass;
    IF n < 5 THEN RAISE EXCEPTION '0496: keystone.% has % policies, expected >= 5', t, n; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = ('keystone.' || t)::regclass AND relrowsecurity AND relforcerowsecurity) THEN
      RAISE EXCEPTION '0496: keystone.% is not ENABLE + FORCE RLS', t;
    END IF;
    SELECT count(*) INTO n FROM pg_trigger
     WHERE tgrelid = ('keystone.' || t)::regclass AND NOT tgisinternal AND tgenabled = 'A';
    IF n <> 2 THEN RAISE EXCEPTION '0496: keystone.% has % ENABLE ALWAYS triggers, expected 2', t, n; END IF;
  END LOOP;
END
$check$;
