-- 0541 — LEAD INTAKE (Ty's spec, 30 Sep 2026): turn public booking off for GLRS, turn client
-- self-booking off in the portal, seed the lead-interest list. GLRS is matched by SLUG
-- ('glrs', keystone.resolve_tenant_by_slug's own key, db/migrations/0020/0030) — never a
-- hardcoded tenant uuid, so this migration is a no-op anywhere GLRS does not exist under that slug.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ WHY THIS IS A DATA MIGRATION, NOT AN APP-SETTINGS-SCREEN CLICK: this session has no
--     authenticated GLRS session to click through Settings with, and HARD RULES name the migration
--     runner as the one sanctioned way to change the deployed database — never raw DDL/DML from an
--     investigation. Every value written here is one Ty's own brief specifies (public booking off,
--     self-booking off, the six named interests); nothing here is inferred.
--
-- ★ `booking.online_enabled` and `client_app.surfaces_off` ALREADY EXIST and are ALREADY WIRED —
--   [MEASURED, recon] `resolveGatedTenantId` (src/routes/public.mjs) already 404s every
--   `/api/public/book*` route when `booking.online_enabled` is false, and `GET /api/app/home`
--   (src/routes/app.mjs:200-212) already omits a surface listed in `client_app.surfaces_off` from
--   the client portal nav. This migration only sets the VALUES for GLRS; `src/routes/app.mjs`'s
--   `POST /api/app/booking` gained its own matching server-side check in the same brief (★ FIX, 30
--   Sep 2026) so turning the surface off is enforced, not merely hidden (§K3).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_tenant_id uuid;
BEGIN
  SELECT keystone.resolve_tenant_by_slug('glrs') INTO v_tenant_id;
  IF v_tenant_id IS NULL THEN
    RAISE NOTICE '0541: no tenant with slug ''glrs'' — nothing to seed';
    RETURN;
  END IF;
  -- ★ tenant_setting is FORCE-RLS; set the tenant context for this transaction (fix applied by chat, 30 Sep).
  PERFORM set_config('keystone.tenant_id', v_tenant_id::text, true);

  -- ── public booking OFF for GLRS (no free first session, no public booking page anymore) ──────
  INSERT INTO keystone.tenant_setting (tenant_id, key, value)
  VALUES (v_tenant_id, 'booking.online_enabled', 'false'::jsonb)
  ON CONFLICT (tenant_id, key) DO UPDATE SET value = 'false'::jsonb;

  -- ── client-portal self-booking OFF for GLRS — merge into whatever surfaces_off already holds ──
  INSERT INTO keystone.tenant_setting (tenant_id, key, value)
  VALUES (v_tenant_id, 'client_app.surfaces_off', '["app-booking"]'::jsonb)
  ON CONFLICT (tenant_id, key) DO UPDATE SET
    value = (
      SELECT jsonb_agg(DISTINCT x)
      FROM jsonb_array_elements(keystone.tenant_setting.value || '["app-booking"]'::jsonb) AS x
    );

  -- ── the six lead-interest choices the marketing site already lists ─────────────────────────────
  INSERT INTO keystone.tenant_setting (tenant_id, key, value)
  VALUES (v_tenant_id, 'growth.lead_interests', $LEADS$[
    {"id": "life_coaching",         "name": "Life coaching"},
    {"id": "career_coaching",       "name": "Career coaching"},
    {"id": "relationship_coaching", "name": "Relationship coaching"},
    {"id": "communication_skills",  "name": "Communication skills"},
    {"id": "young_adult_coaching",  "name": "Young adult coaching"},
    {"id": "family_coaching",       "name": "Family coaching"}
  ]$LEADS$::jsonb)
  ON CONFLICT (tenant_id, key) DO NOTHING; -- ★ never overwrite a list someone may have already edited
END $$;
