-- 0801 — ONE CUSTOM PAGE SYSTEM (23 Oct 2026). The old "Booking links" tab (Stage 20, 0496) is gone; its pages are Custom pages.
-- The old editor wrote keystone.booking_link without ever making a keystone.booking_address, and resolveAddress only sent /book/l/<slug> to
-- /book/p/<slug> when a p/ address existed, so a link made on the old screen went nowhere. This gives EVERY page that exists a live p/ address,
-- and turns the old "categories" axis into services (the one axis the Custom page editor offers), so no page starts offering more than it did.
--
-- Same discipline as 0800 (F173): booking_link and its join tables have FORCE row security and this runs as app_owner with no signed-in viewer,
-- so a plain statement would see ZERO rows. FORCE is lifted for this file's own reads and writes and put back in the same transaction, and the
-- file checks its own result. Additive and idempotent: it never deletes a row, and a second run changes nothing.

ALTER TABLE keystone.booking_link NO FORCE ROW LEVEL SECURITY;
ALTER TABLE keystone.booking_link_service NO FORCE ROW LEVEL SECURITY;
ALTER TABLE keystone.booking_link_category NO FORCE ROW LEVEL SECURITY;
ALTER TABLE keystone.booking_address NO FORCE ROW LEVEL SECURITY;
-- read, not written: keystone.service is FORCE too, so the category join below would see no service at all (the 0800 lesson, again)
ALTER TABLE keystone.service NO FORCE ROW LEVEL SECURITY;

-- 1 · categories → services. A page that named service categories (and no services) now names the public services in them.
INSERT INTO keystone.booking_link_service (tenant_id, link_id, service_id)
SELECT DISTINCT l.tenant_id, l.id, s.id
  FROM keystone.booking_link l
  JOIN keystone.booking_link_category c ON c.tenant_id = l.tenant_id AND c.link_id = l.id
  JOIN keystone.service s ON s.tenant_id = c.tenant_id AND s.category_id = c.category_id AND s.archived_at IS NULL AND s.public_bookable
 WHERE l.archived_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM keystone.booking_link_service x WHERE x.tenant_id = l.tenant_id AND x.link_id = l.id)
ON CONFLICT DO NOTHING;

-- A page that named categories but whose categories hold no public service would, with no service rows, offer EVERY service. Never widen:
-- such a page starts switched off (its Live switch), and the staff turn it on after choosing its services.
UPDATE keystone.booking_link l
   SET active = false, updated_at = now()
 WHERE l.archived_at IS NULL AND l.active
   AND EXISTS (SELECT 1 FROM keystone.booking_link_category c WHERE c.tenant_id = l.tenant_id AND c.link_id = l.id)
   AND NOT EXISTS (SELECT 1 FROM keystone.booking_link_service x WHERE x.tenant_id = l.tenant_id AND x.link_id = l.id);

-- 2 · every page that exists gets a live p/<slug> address. A name another live address already holds gets a numbered one; the slug column is
--     kept equal to the address, as addresses.mjs keeps it.
DO $$
DECLARE r record; v_path text; v_try text; n int;
BEGIN
  FOR r IN SELECT l.id, l.tenant_id, l.slug FROM keystone.booking_link l
            WHERE l.archived_at IS NULL
              AND NOT EXISTS (SELECT 1 FROM keystone.booking_address a WHERE a.tenant_id = l.tenant_id AND a.kind = 'page' AND a.target_id = l.id AND a.state = 'live')
            ORDER BY l.created_at, l.id
  LOOP
    v_path := 'p/' || lower(r.slug);
    v_try := v_path; n := 1;
    LOOP
      -- a redirect or "gone" row that holds the name gives way (addresses.mjs: "those give way")
      DELETE FROM keystone.booking_address a WHERE a.tenant_id = r.tenant_id AND lower(a.path) = v_try AND a.state <> 'live';
      EXIT WHEN NOT EXISTS (SELECT 1 FROM keystone.booking_address a WHERE a.tenant_id = r.tenant_id AND lower(a.path) = v_try);
      n := n + 1;
      v_try := left(v_path, 60 - length(n::text) - 1) || '-' || n::text;
      EXIT WHEN n > 999;
    END LOOP;
    INSERT INTO keystone.booking_address (tenant_id, path, kind, target_id, state) VALUES (r.tenant_id, v_try, 'page', r.id, 'live');
    IF v_try <> v_path THEN
      UPDATE keystone.booking_link SET slug = substr(v_try, 3) WHERE tenant_id = r.tenant_id AND id = r.id;
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE n_bare int;
BEGIN
  SELECT count(*) INTO n_bare FROM keystone.booking_link l
   WHERE l.archived_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM keystone.booking_address a WHERE a.tenant_id = l.tenant_id AND a.kind = 'page' AND a.target_id = l.id AND a.state = 'live');
  IF n_bare > 0 THEN
    RAISE EXCEPTION '0801: % custom page(s) still have no live address', n_bare;
  END IF;
END $$;

ALTER TABLE keystone.booking_link FORCE ROW LEVEL SECURITY;
ALTER TABLE keystone.booking_link_service FORCE ROW LEVEL SECURITY;
ALTER TABLE keystone.booking_link_category FORCE ROW LEVEL SECURITY;
ALTER TABLE keystone.booking_address FORCE ROW LEVEL SECURITY;
ALTER TABLE keystone.service FORCE ROW LEVEL SECURITY;
