-- 0719_booking_redirect_read_scoped
-- Run 9 (security checks run in full). The cross-tenant fuzz gate (db/gates/p21a_cross_tenant_fuzz.mjs) had been stopping at its first refused statement,
-- so it covered nothing; with that instrument fixed, its SELECT leg found tenant B reading tenant A's booking_link_redirect row.
--
-- 0313 made the app role's read USING (true) on the argument that the one caller filters by a tenant it has already resolved. MEASURED today: that caller,
-- resolveDeadCoachSlug (src/booking/publicBooking.mjs:338), runs only inside withTenant(tenantId, …) (src/routes/public.mjs:125), so
-- keystone.current_tenant_id() is already that tenant. Scoping the policy to it changes nothing the application does and closes the read for every other
-- path: an app-role query that forgets its WHERE now sees its own tenant's redirects, not everyone's.
-- Writes are unchanged (auth_owner only, through record_booking_slug_redirect).
ALTER POLICY booking_link_redirect_read ON keystone.booking_link_redirect USING (tenant_id = keystone.current_tenant_id());
