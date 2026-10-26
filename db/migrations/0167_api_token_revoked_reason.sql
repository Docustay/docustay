-- ★ keystone_auth.api_token is OWNED BY auth_owner (0045:39, `SET LOCAL ROLE auth_owner` before the CREATE),
--   and this file runs as app_owner (db/migrate.mjs per-file SET ROLE), a NOINHERIT member of auth_owner
--   (0132 header). An ALTER TABLE needs ownership, so the role is switched exactly as 0132 does and put
--   back explicitly — NOT `RESET ROLE`, the session-level reset that caused F482.
SET LOCAL ROLE auth_owner;

ALTER TABLE keystone_auth.api_token ADD COLUMN revoked_reason text NULL;
-- ★ revoked_at and revoked_by ALREADY EXIST on the deployed table (EXECUTED 2026-09-21, 18 columns).
--   CT-017 proposes adding revoked_at; doing so would fail. See CCR-3.

SET LOCAL ROLE app_owner;
