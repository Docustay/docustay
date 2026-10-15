-- 0387_session_reason_removed_from_team
-- Stage 12 task 12.13 — offboard finish. TeamRemove ends a departing team member's live sessions
-- with a reason of its own (`removed_from_team`), distinct from the generic `admin` revoke it used
-- before this task, so the session row can say WHY it died without guessing from context.
--
-- ★ Widening a CHECK cannot invalidate an existing row (0173:33-34's own reasoning) — every value
--   the old set admitted, the new set still admits.
-- ★ keystone_auth.session is OWNED BY auth_owner (0176:30-33's own note); this file runs as
--   app_owner (db/migrate.mjs per-file `SET ROLE app_owner`), a NOINHERIT member of auth_owner
--   (0132 header), so the role is switched exactly as 0173/0176 do and put back explicitly — NOT
--   `RESET ROLE`, the session-level reset that caused F482 (db/migrate.mjs:301-316).
SET LOCAL ROLE auth_owner;
ALTER TABLE keystone_auth.session DROP CONSTRAINT session_revoked_reason_check;
ALTER TABLE keystone_auth.session ADD CONSTRAINT session_revoked_reason_check
  CHECK (revoked_reason IN ('logout','tenant_changed','admin','expired_sweep',
                            'role_changed','password_changed','device_removed','operator_ended',
                            'removed_from_team'));
SET LOCAL ROLE app_owner;    -- put back explicitly, never RESET ROLE (0176's rule)
