-- 0712 · THE "HEALTH DATA" SWITCH IS GONE (the maintainer, 11 Oct 2026). HIPAA is not a switch; Docustay is not offered for protected health information yet.
-- The island's `health.enabled` setting no longer exists in code (src/documents/settingsSchema.mjs), so any stored value is removed: a workspace that had it on goes back to the normal
-- behaviour at once (AI as the workspace stored it, emails naming the document, signed copies as before, two-step only if an owner requires it, idle sign-out as the workspace set it).
-- The access log it used to switch on is always on now (src/documents/accessLog.mjs). Idempotent (production held no such row when measured, 11 Oct 2026).
-- ★ document_setting has FORCED row-level security: a bare DELETE as app_owner sees no rows (MEASURED locally: 11 rows survived it). So, as 0708 does, each workspace in turn.
DO $b$
DECLARE v_ids uuid[]; v_t uuid;
BEGIN
  SET LOCAL ROLE auth_owner;
  SELECT coalesce(array_agg(id), '{}') INTO v_ids FROM keystone.tenant;
  SET LOCAL ROLE app_owner;
  FOREACH v_t IN ARRAY v_ids LOOP
    PERFORM set_config('keystone.tenant_id', v_t::text, true);
    DELETE FROM keystone.document_setting WHERE tenant_id = v_t AND key = 'health.enabled';
  END LOOP;
  PERFORM set_config('keystone.tenant_id', '', true);
END $b$;
