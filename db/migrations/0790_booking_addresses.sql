-- 0790 — BOOKING ADDRESSES (Ty, 22 Oct 2026; specs/BOOKING-EVERYWHERE-SPEC.md §2). One registry of every public booking
-- address a practice has: people and services at /book/<path>, custom pages at /book/p/<slug>. ADDITIVE: one new table,
-- a backfill that only INSERTS into it (and fills service.booking_key / app_user.booking_slug where they are empty), no
-- existing value changed.
--
--   path        lowercase; 'grant' | 'first-light-call' | 'p/intro-week'. People and services share ONE namespace, so a person
--               and a service can never both claim /book/<x>; custom pages live under 'p/'.
--   state       'live' answers; 'redirect' answers a permanent redirect to redirect_to (NULL = the organization page /book),
--               for ever, unless another live address takes the name (the redirect row is then deleted, plan decision 1);
--               'gone' answers "This page has moved" (deleted custom page) or "Not available online right now" (a service
--               that stopped being public; it becomes 'live' again if the service is made public again).
--   The current value is kept in the old columns too (app_user.booking_slug, service.booking_key, booking_link.slug), so code
--   that reads them keeps working; the one writer that changes an address (src/booking/addresses.mjs) updates both.

CREATE TABLE IF NOT EXISTS keystone.booking_address (
  id          uuid        NOT NULL DEFAULT keystone.uuid_generate_v7(),
  tenant_id   uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  path        text        NOT NULL,
  kind        text        NOT NULL,
  target_id   uuid        NOT NULL,
  state       text        NOT NULL DEFAULT 'live',
  redirect_to uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid        REFERENCES keystone.app_user(id) ON DELETE SET NULL,
  retired_at  timestamptz,
  retired_by  uuid        REFERENCES keystone.app_user(id) ON DELETE SET NULL,
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT booking_address_kind_check  CHECK (kind IN ('person', 'service', 'page')),
  CONSTRAINT booking_address_state_check CHECK (state IN ('live', 'redirect', 'gone')),
  CONSTRAINT booking_address_path_shape  CHECK (
    (kind <> 'page' AND path ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(path) <= 60)
    OR (kind = 'page' AND path ~ '^p/[a-z0-9]+(-[a-z0-9]+)*$' AND length(path) <= 62)),
  CONSTRAINT booking_address_redirect_shape CHECK (state = 'redirect' OR redirect_to IS NULL),
  CONSTRAINT booking_address_redirect_fkey FOREIGN KEY (tenant_id, redirect_to)
    REFERENCES keystone.booking_address (tenant_id, id) ON DELETE SET NULL (redirect_to)
);

-- one row per name per practice (redirect and gone rows hold their name too); one live address per thing
CREATE UNIQUE INDEX IF NOT EXISTS booking_address_path_unique ON keystone.booking_address (tenant_id, lower(path));
CREATE UNIQUE INDEX IF NOT EXISTS booking_address_live_target_unique ON keystone.booking_address (tenant_id, kind, target_id) WHERE state = 'live';
CREATE INDEX IF NOT EXISTS booking_address_target_idx ON keystone.booking_address (tenant_id, target_id);

COMMENT ON TABLE keystone.booking_address IS
  'Every public booking address of a practice (spec BOOKING-EVERYWHERE §2). Written only by src/booking/addresses.mjs; old columns kept equal.';

-- ═══ CT-F52: RLS (ENABLE + FORCE), tenant policies, reference-guard read, refuse-reference triggers, grants ═══
DO $rls$
BEGIN
  ALTER TABLE keystone.booking_address ENABLE ROW LEVEL SECURITY;
  ALTER TABLE keystone.booking_address FORCE  ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'keystone' AND tablename = 'booking_address' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON keystone.booking_address USING (tenant_id = keystone.current_tenant_id());
    CREATE POLICY tenant_insert ON keystone.booking_address FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
    CREATE POLICY tenant_update ON keystone.booking_address FOR UPDATE USING (tenant_id = keystone.current_tenant_id()) WITH CHECK (tenant_id = keystone.require_tenant_id());
    CREATE POLICY tenant_delete ON keystone.booking_address FOR DELETE USING (tenant_id = keystone.current_tenant_id());
    CREATE POLICY reference_guard_read ON keystone.booking_address FOR SELECT TO reference_guard USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));
  END IF;
END
$rls$;
GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.booking_address TO app_rw;
GRANT SELECT ON keystone.booking_address TO app_worker;
GRANT SELECT ON keystone.booking_address TO reference_guard;

SET LOCAL ROLE reference_guard;
GRANT EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() TO app_owner;
SET LOCAL ROLE app_owner;
DO $trg$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'booking_address_refuse_reference_delete_trg') THEN
    CREATE TRIGGER booking_address_refuse_reference_delete_trg AFTER DELETE ON keystone.booking_address
      REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
    ALTER TABLE keystone.booking_address ENABLE ALWAYS TRIGGER booking_address_refuse_reference_delete_trg;
    CREATE TRIGGER booking_address_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.booking_address
      FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
    ALTER TABLE keystone.booking_address ENABLE ALWAYS TRIGGER booking_address_refuse_reference_truncate_trg;
  END IF;
END
$trg$;
SET LOCAL ROLE reference_guard;
REVOKE EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() FROM app_owner;
SET LOCAL ROLE app_owner;

-- ═══ BACKFILL, every practice (plan §1: "a backfill for every existing practice") ═══
-- The migration runs as app_owner, which has no tenant context; each insert names its tenant and RLS's WITH CHECK reads the
-- GUC, so the backfill sets keystone.tenant_id per practice (the 0661 idiom).
CREATE OR REPLACE FUNCTION pg_temp.addr_slug(t text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT left(trim(both '-' from regexp_replace(lower(coalesce(t, '')), '[^a-z0-9]+', '-', 'g')), 50)
$$;

DO $backfill$
DECLARE
  v_t record; v_r record; v_base text; v_try text; v_n int;
  reserved text[] := ARRAY['p','l','manage','booked','change','cancel','api','new','admin','app','login','signup','book','s2s','staff','settings','help','embed'];
BEGIN
  FOR v_t IN SELECT id FROM keystone.tenant_timezones_for_health() LOOP
    PERFORM set_config('keystone.tenant_id', v_t.id::text, true);

    -- 1 · people who already have a link (their current slug is their address)
    INSERT INTO keystone.booking_address (tenant_id, path, kind, target_id, state)
    SELECT u.tenant_id, lower(u.booking_slug), 'person', u.id, 'live'
      FROM keystone.app_user u
     WHERE u.tenant_id = v_t.id AND u.role = 'staff' AND u.archived_at IS NULL AND u.booking_slug IS NOT NULL
       AND lower(u.booking_slug) ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(u.booking_slug) <= 60 AND NOT (lower(u.booking_slug) = ANY (reserved))
    ON CONFLICT DO NOTHING;

    -- 2 · old coach slugs that already redirect (0313: old_slug → redirect_to_app_user_id, NULL = the practice page). They keep
    --     redirecting, now from this one table. A redirect to nobody (NULL) points at the organization page: redirect_to NULL,
    --     and target_id carries the practice's own id (the column is NOT NULL; nothing resolves a redirect by its target).
    INSERT INTO keystone.booking_address (tenant_id, path, kind, target_id, state, redirect_to)
    SELECT r.tenant_id, lower(r.old_slug), 'person', coalesce(r.redirect_to_app_user_id, r.tenant_id), 'redirect',
           (SELECT a.id FROM keystone.booking_address a WHERE a.tenant_id = r.tenant_id AND a.kind = 'person' AND a.target_id = r.redirect_to_app_user_id AND a.state = 'live')
      FROM keystone.booking_link_redirect r
     WHERE r.tenant_id = v_t.id AND r.subject_type = 'coach' AND lower(r.old_slug) ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
       AND length(r.old_slug) <= 60 AND NOT (lower(r.old_slug) = ANY (reserved))
    ON CONFLICT DO NOTHING;

    -- 3 · public services: keep a booking_key they have; make one from the name when they have none
    FOR v_r IN
      SELECT s.id, s.name, s.booking_key FROM keystone.service s
       WHERE s.tenant_id = v_t.id AND s.public_bookable AND s.archived_at IS NULL
       ORDER BY s.booking_key IS NULL, s.created_at, s.id
    LOOP
      v_base := coalesce(v_r.booking_key, nullif(pg_temp.addr_slug(v_r.name), ''), 'service');
      v_try := v_base; v_n := 1;
      WHILE v_try = ANY (reserved) OR EXISTS (SELECT 1 FROM keystone.booking_address a WHERE a.tenant_id = v_t.id AND lower(a.path) = v_try)
            OR EXISTS (SELECT 1 FROM keystone.service o WHERE o.tenant_id = v_t.id AND o.id <> v_r.id AND o.booking_key = v_try) LOOP
        v_n := v_n + 1; v_try := v_base || '-' || v_n;
      END LOOP;
      IF v_r.booking_key IS NULL THEN UPDATE keystone.service SET booking_key = v_try WHERE tenant_id = v_t.id AND id = v_r.id; END IF;
      INSERT INTO keystone.booking_address (tenant_id, path, kind, target_id, state) VALUES (v_t.id, v_try, 'service', v_r.id, 'live')
      ON CONFLICT DO NOTHING;
    END LOOP;

    -- 4 · people who take bookings (a current hours rule or a service they deliver) and have no address yet: first name
    FOR v_r IN
      SELECT u.id, u.display_name FROM keystone.app_user u
       WHERE u.tenant_id = v_t.id AND u.role = 'staff' AND u.archived_at IS NULL AND u.booking_slug IS NULL
         AND (EXISTS (SELECT 1 FROM keystone.availability_rule r WHERE r.tenant_id = u.tenant_id AND r.host_id = u.id AND r.effective_to IS NULL)
              OR EXISTS (SELECT 1 FROM keystone.service_host h WHERE h.tenant_id = u.tenant_id AND h.app_user_id = u.id))
         AND NOT EXISTS (SELECT 1 FROM keystone.booking_address a WHERE a.tenant_id = u.tenant_id AND a.kind = 'person' AND a.target_id = u.id AND a.state = 'live')
       ORDER BY u.created_at, u.id
    LOOP
      v_base := coalesce(nullif(pg_temp.addr_slug(split_part(v_r.display_name, ' ', 1)), ''), 'coach');
      v_try := v_base; v_n := 1;
      WHILE v_try = ANY (reserved) OR EXISTS (SELECT 1 FROM keystone.booking_address a WHERE a.tenant_id = v_t.id AND lower(a.path) = v_try)
            OR EXISTS (SELECT 1 FROM keystone.app_user o WHERE o.tenant_id = v_t.id AND lower(o.booking_slug) = v_try) LOOP
        v_n := v_n + 1;
        v_try := CASE WHEN v_n = 2 THEN coalesce(nullif(pg_temp.addr_slug(v_r.display_name), ''), v_base || '-2') ELSE v_base || '-' || v_n END;
      END LOOP;
      UPDATE keystone.app_user SET booking_slug = v_try WHERE tenant_id = v_t.id AND id = v_r.id;
      INSERT INTO keystone.booking_address (tenant_id, path, kind, target_id, state) VALUES (v_t.id, v_try, 'person', v_r.id, 'live')
      ON CONFLICT DO NOTHING;
    END LOOP;

    -- 5 · custom pages that exist (booking_link) get their p/ address
    INSERT INTO keystone.booking_address (tenant_id, path, kind, target_id, state)
    SELECT l.tenant_id, 'p/' || lower(l.slug), 'page', l.id, CASE WHEN l.archived_at IS NULL THEN 'live' ELSE 'gone' END
      FROM keystone.booking_link l
     WHERE l.tenant_id = v_t.id AND lower(l.slug) ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(l.slug) <= 60
    ON CONFLICT DO NOTHING;
  END LOOP;
  PERFORM set_config('keystone.tenant_id', '', true);
END
$backfill$;

-- self-check, per practice (RLS hides other practices' rows): every public service has a live address
DO $$
DECLARE v_t record; n int;
BEGIN
  FOR v_t IN SELECT id FROM keystone.tenant_timezones_for_health() LOOP
    PERFORM set_config('keystone.tenant_id', v_t.id::text, true);
    SELECT count(*) INTO n FROM keystone.service s
     WHERE s.tenant_id = v_t.id AND s.public_bookable AND s.archived_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM keystone.booking_address a WHERE a.tenant_id = s.tenant_id AND a.kind = 'service' AND a.target_id = s.id AND a.state = 'live');
    IF n <> 0 THEN RAISE EXCEPTION '0790 — % public services of tenant % have no live address', n, v_t.id; END IF;
  END LOOP;
  PERFORM set_config('keystone.tenant_id', '', true);
END $$;
