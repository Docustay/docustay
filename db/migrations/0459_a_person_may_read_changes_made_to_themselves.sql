-- 0459_a_person_may_read_changes_made_to_themselves.sql — Stage 17 task 17.20
--
-- Allows a staff member (Coach included) to read changes made to their own settings,
-- even if they don't have audit:view permission. This is used by the SettingsMine
-- screen to show "Last Changed" timestamps for the user's own profile.
-- (REHEARSAL FIX 25 Sep 2026: explicit BEGIN removed — db/migrate.mjs wraps every file in its own transaction; an inner COMMIT would commit half a migration and orphan the runner's bookkeeping.)
CREATE POLICY self_setting_change ON keystone.audit_entry
  FOR SELECT USING (
    tenant_id = keystone.current_tenant_id()
    AND action = 'settings.changed'
    AND subject_id = keystone.current_user_id()
  );

COMMENT ON POLICY self_setting_change ON keystone.audit_entry IS
  'Stage 17 task 17.20 — a person reads only settings.changed audit entries where they are the subject (their own profile changes).';
-- (REHEARSAL FIX 25 Sep 2026: explicit COMMIT removed — the runner commits.)