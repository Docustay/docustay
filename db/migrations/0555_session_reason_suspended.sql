-- 0555_session_reason_suspended
--
-- ★★★ FOUND LIVE, 1 Oct 2026, verifying suspendTeamMember (src/people/offboard.mjs, migration 0554)
-- through a real scratch database BEFORE deploying it: `revokeSessionsForUser(tx, tenantId,
-- personId, "suspended")` would have thrown "revoke reason must be one of logout, tenant_changed,
-- admin, expired_sweep, role_changed, password_changed, device_removed, operator_ended,
-- removed_from_team" on its very first real call — 'suspended' was never one of REVOKE_REASONS
-- (src/auth/session.mjs:118) or the matching database CHECK this migration widens. Exactly the same
-- shape as 0387 (removed_from_team) and the same reasoning: a suspend needs its own reason, distinct
-- from the generic 'admin', so the session row can say WHY it died without guessing from context.
--
-- ★ Widening a CHECK cannot invalidate an existing row (0173's own reasoning, repeated by 0387) —
--   every value the old set admitted, the new set still admits.
-- ★ keystone_auth.session is owned by auth_owner; same SET LOCAL ROLE dance as 0387, put back
--   explicitly, never RESET ROLE (0176's rule, F482).
SET LOCAL ROLE auth_owner;
ALTER TABLE keystone_auth.session DROP CONSTRAINT session_revoked_reason_check;
ALTER TABLE keystone_auth.session ADD CONSTRAINT session_revoked_reason_check
  CHECK (revoked_reason IN ('logout','tenant_changed','admin','expired_sweep',
                            'role_changed','password_changed','device_removed','operator_ended',
                            'removed_from_team','suspended'));
SET LOCAL ROLE app_owner;    -- put back explicitly, never RESET ROLE (0176's rule)
