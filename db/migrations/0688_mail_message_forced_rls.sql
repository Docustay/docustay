-- 0688 · mail_message was the one tenant table with RLS enabled but not forced (0622 left it unforced so its SECURITY DEFINER lookup, owned by app_owner, could read across workspaces).
-- Force it like every other table, and give that one lookup the explicit, read-only door it needs: app_owner may SELECT, nothing else. app_rw / app_worker stay confined to their tenant.
ALTER TABLE keystone.mail_message FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_lookup ON keystone.mail_message;
CREATE POLICY owner_lookup ON keystone.mail_message FOR SELECT TO app_owner USING (true);
