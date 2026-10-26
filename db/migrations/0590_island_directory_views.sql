-- 0590 · THE DOCUMENTS ISLAND'S DIRECTORY VIEWS (QUEUE §4, Ty 2 Oct 2026).
-- Documents holds opaque person/practice ids and only needs their DISPLAY facts (a name on a list row, the practice's name and zone on a certificate, a signer's own
-- phone). Instead of Documents naming `app_user` / `tenant` in its SQL — which the island wall now forbids — the host publishes two narrow, read-only views that ARE the
-- contract: `person_directory` and `tenant_directory`. security_invoker, so the same row-level security applies as to the tables underneath; nothing here widens access.
CREATE OR REPLACE VIEW keystone.person_directory WITH (security_invoker = true) AS
  SELECT id, tenant_id, display_name, first_name, email, mobile_phone, role, owner_user_id FROM keystone.app_user;
CREATE OR REPLACE VIEW keystone.tenant_directory WITH (security_invoker = true) AS
  SELECT id, name, slug, timezone FROM keystone.tenant;
GRANT SELECT ON keystone.person_directory, keystone.tenant_directory TO app_rw, app_worker;
