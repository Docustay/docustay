-- 0730 · Launch step 8 (13 Oct 2026): THE PUBLIC DEMO. A demo is a real, throw-away Docustay workspace (same schema, same row-level security, same code) that lives 24 hours, sends nothing and charges nothing.
-- This migration adds only the bookkeeping around it:
--   · keystone.docustay_demo       one row per demo workspace: who owns it (a synthetic person, no email, no password), when it expires, a hash of the visitor's address (never the address), how many real AI prompts and uploads it has used,
--                                  whether it was seeded, and whether it was turned into a real account ("keep my work").
--   · keystone.docustay_demo_seed  the ids of the sample documents, templates and forms the seed made, so "keep my work" removes exactly those and nothing the visitor made.
--   · keystone.docustay_demo_mail  what the demo WOULD have emailed (to, subject, text and the signing link in it): nothing leaves the machine; the visitor sees these in the demo inbox.
--   · three read functions for the places that have no workspace in hand: the start (how many demos this address made lately / are alive), the mail and request guards (is this a demo?), the hourly purge (which have expired).
-- Also: docustay_welcome (0729) gets the workspace-deletion policy every tenant table must carry (0695's rule), which 0729 missed.
-- Additive and idempotent. A demo row holds no name, no address and no email.

CREATE TABLE IF NOT EXISTS keystone.docustay_demo (
  tenant_id     uuid        PRIMARY KEY REFERENCES keystone.tenant(id) ON DELETE CASCADE,
  owner_user_id uuid        NOT NULL,
  ip_hash       text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  seeded_at     timestamptz,
  ai_prompts    integer     NOT NULL DEFAULT 0 CHECK (ai_prompts >= 0),
  uploads       integer     NOT NULL DEFAULT 0 CHECK (uploads >= 0),
  converted_at  timestamptz
);
CREATE INDEX IF NOT EXISTS docustay_demo_ip_created ON keystone.docustay_demo (ip_hash, created_at);
CREATE INDEX IF NOT EXISTS docustay_demo_expires    ON keystone.docustay_demo (expires_at) WHERE converted_at IS NULL;

CREATE TABLE IF NOT EXISTS keystone.docustay_demo_seed (
  tenant_id uuid NOT NULL REFERENCES keystone.tenant(id) ON DELETE CASCADE,
  kind      text NOT NULL CHECK (kind IN ('document', 'template', 'form')),
  item_id   uuid NOT NULL,
  PRIMARY KEY (tenant_id, kind, item_id)
);

CREATE TABLE IF NOT EXISTS keystone.docustay_demo_mail (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  to_addr    text        NOT NULL,
  subject    text        NOT NULL,
  body_text  text        NOT NULL DEFAULT '',
  link       text
);
CREATE INDEX IF NOT EXISTS docustay_demo_mail_tenant ON keystone.docustay_demo_mail (tenant_id, created_at DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['docustay_demo', 'docustay_demo_seed', 'docustay_demo_mail', 'docustay_welcome'] LOOP
    EXECUTE format('ALTER TABLE keystone.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE keystone.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON keystone.%I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON keystone.%I USING (tenant_id = keystone.current_tenant_id()) WITH CHECK (tenant_id = keystone.current_tenant_id())', t);
    EXECUTE format('DROP POLICY IF EXISTS workspace_deletion ON keystone.%I', t);
    EXECUTE format('CREATE POLICY workspace_deletion ON keystone.%I FOR DELETE TO app_owner USING (keystone.workspace_deletion_active(tenant_id))', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE         ON keystone.docustay_demo      TO app_rw;
GRANT SELECT, INSERT, DELETE         ON keystone.docustay_demo_seed TO app_rw;
GRANT SELECT, INSERT, DELETE         ON keystone.docustay_demo_mail TO app_rw;

-- the registry read, for the three callers with no workspace in hand (same ownership shape as 0715: created AS auth_owner, column-level read + a policy for that role, handed back to app_owner)
GRANT SELECT (tenant_id, ip_hash, created_at, expires_at, converted_at, owner_user_id) ON keystone.docustay_demo TO auth_owner;
DROP POLICY IF EXISTS demo_registry_read ON keystone.docustay_demo;
CREATE POLICY demo_registry_read ON keystone.docustay_demo FOR SELECT TO auth_owner USING (true);
COMMENT ON POLICY demo_registry_read ON keystone.docustay_demo IS '0730 — auth_owner (owner of the keystone_auth.demo_* functions) reads the registry: ids, a hash of the visitor address, times. No names, no emails, no content.';

SET LOCAL ROLE auth_owner;

-- how many demos this (hashed) address started inside the window, and how many demos are alive now: what the start asks before it makes anything
CREATE OR REPLACE FUNCTION keystone_auth.demo_budget(p_ip_hash text, p_window interval DEFAULT interval '1 hour')
RETURNS TABLE (ip_recent integer, alive integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
  SELECT (SELECT count(*)::int FROM keystone.docustay_demo WHERE ip_hash = p_ip_hash AND created_at > now() - p_window),
         (SELECT count(*)::int FROM keystone.docustay_demo WHERE converted_at IS NULL AND expires_at > now());
$$;
REVOKE ALL ON FUNCTION keystone_auth.demo_budget(text, interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone_auth.demo_budget(text, interval) TO app_rw;

-- is this workspace a live (not converted) demo?
CREATE OR REPLACE FUNCTION keystone_auth.is_demo_tenant(p_tenant uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$ SELECT EXISTS (SELECT 1 FROM keystone.docustay_demo WHERE tenant_id = p_tenant AND converted_at IS NULL) $$;
REVOKE ALL ON FUNCTION keystone_auth.is_demo_tenant(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone_auth.is_demo_tenant(uuid) TO app_rw, app_worker;

-- the demos whose time is up (and a bounded number at a time): what the hourly purge deletes
CREATE OR REPLACE FUNCTION keystone_auth.list_expired_demos(p_limit integer DEFAULT 25)
RETURNS TABLE (tenant_id uuid, owner_user_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
  SELECT d.tenant_id, d.owner_user_id FROM keystone.docustay_demo d
   WHERE d.converted_at IS NULL AND d.expires_at <= now() ORDER BY d.expires_at LIMIT greatest(1, least(p_limit, 200));
$$;
REVOKE ALL ON FUNCTION keystone_auth.list_expired_demos(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone_auth.list_expired_demos(integer) TO app_worker, app_rw;

SET LOCAL ROLE app_owner;

DO $$ BEGIN
  IF current_user <> 'app_owner' THEN RAISE EXCEPTION '0730 finished as % — it must hand back to app_owner', current_user; END IF;
END $$;
