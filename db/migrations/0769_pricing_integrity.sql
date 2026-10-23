-- 0769 · Pricing integrity (the maintainer, 21 Oct 2026; specs/v1/PRICING-INTEGRITY-SPEC.md). Everything additive.
--  (1) keystone.canonical_email(text): lower case; +tags removed for providers that honour them; dots removed for gmail.com and googlemail.com (which is gmail.com). The stored address is never changed.
--  (2) keystone.docustay_signup_identity: one row per workspace creator (canonical + real address), so ONE FREE WORKSPACE PER PERSON can be checked across workspaces without reading anyone's data
--      (keystone.docustay_free_workspace_exists answers yes or no and nothing else). Backfilled from the existing Docustay owners.
--  (3) keystone.docustay_review_flag: the internal review list (repeat patterns, fair-use lines). Review only: nothing reads it to block anyone. The application can write, never read.
--  (4) keystone.document_send_tombstone: when a SENT document is deleted (deleting a Contact deletes its unsigned sent documents) one line stays, so the Free document and signer counts cannot be reset by deleting.
--  (5) keystone.document_ai_secret.grandfathered_until: a Free workspace that already holds its own AI key keeps it until the end of this month (the maintainer, decision 2).
--  (6) a session can end because the Free plan's three-device line was passed (revoked_reason device_limit).
--  (7) the billing record learns the new facts: a dispute lost or cleared, a downgrade scheduled or cancelled, a switch credit.

-- (1) ------------------------------------------------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION keystone.canonical_email(p_email text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN p_email IS NULL OR position('@' IN p_email) = 0 THEN lower(btrim(p_email))
    ELSE
      CASE
        WHEN dom IN ('gmail.com', 'googlemail.com') THEN coalesce(nullif(replace(split_part(loc, '+', 1), '.', ''), ''), loc) || '@gmail.com'
        WHEN dom IN ('outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'mac.com', 'proton.me', 'protonmail.com', 'pm.me', 'fastmail.com', 'hey.com', 'zoho.com')
          THEN coalesce(nullif(split_part(loc, '+', 1), ''), loc) || '@' || dom
        ELSE loc || '@' || dom
      END
  END
  FROM (SELECT lower(btrim(p_email)) AS e) s,
       LATERAL (SELECT substr(s.e, 1, length(s.e) - length(split_part(s.e, '@', array_length(string_to_array(s.e, '@'), 1))) - 1) AS loc,
                       split_part(s.e, '@', array_length(string_to_array(s.e, '@'), 1)) AS dom) p
$$;

-- (2) ------------------------------------------------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS keystone.docustay_signup_identity (
  tenant_id       uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE CASCADE,
  canonical_email text        NOT NULL CHECK (length(canonical_email) BETWEEN 3 AND 320),
  email           text        NOT NULL CHECK (length(email) BETWEEN 3 AND 320),
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, canonical_email)
);
CREATE INDEX IF NOT EXISTS docustay_signup_identity_canonical_idx ON keystone.docustay_signup_identity (canonical_email);

-- (4) ------------------------------------------------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS keystone.document_send_tombstone (
  id         uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id  uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE CASCADE,
  sent_at    timestamptz NOT NULL,
  counted    boolean     NOT NULL,
  emails     text[]      NOT NULL DEFAULT '{}',
  deleted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS document_send_tombstone_tenant_sent_idx ON keystone.document_send_tombstone (tenant_id, sent_at);

DO $p$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['docustay_signup_identity', 'document_send_tombstone'] LOOP
    EXECUTE format('ALTER TABLE keystone.%I ENABLE ROW LEVEL SECURITY', r);
    EXECUTE format('ALTER TABLE keystone.%I FORCE ROW LEVEL SECURITY', r);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON keystone.%I', r);
    EXECUTE format('DROP POLICY IF EXISTS tenant_insert ON keystone.%I', r);
    EXECUTE format('DROP POLICY IF EXISTS reference_guard_read ON keystone.%I', r);
    EXECUTE format('DROP POLICY IF EXISTS workspace_deletion ON keystone.%I', r);
    EXECUTE format('CREATE POLICY tenant_isolation ON keystone.%I USING (tenant_id = keystone.current_tenant_id())', r);
    EXECUTE format('CREATE POLICY tenant_insert ON keystone.%I FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id())', r);
    EXECUTE format('CREATE POLICY reference_guard_read ON keystone.%I FOR SELECT TO reference_guard USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference))', r);
    EXECUTE format('CREATE POLICY workspace_deletion ON keystone.%I FOR DELETE TO app_owner USING (keystone.workspace_deletion_active(tenant_id))', r);
    EXECUTE format('GRANT SELECT, INSERT ON keystone.%I TO app_rw, app_worker', r);
    EXECUTE format('GRANT SELECT ON keystone.%I TO reference_guard', r);
  END LOOP;
END $p$;
-- the tombstone is written by the delete trigger, which runs as the table owner
DROP POLICY IF EXISTS owner_insert ON keystone.document_send_tombstone;
CREATE POLICY owner_insert ON keystone.document_send_tombstone FOR INSERT TO app_owner WITH CHECK (true);
-- the one-free-workspace question is asked across workspaces by a definer function owned by auth_owner, which therefore may read this table
GRANT SELECT ON keystone.docustay_signup_identity TO auth_owner;
DROP POLICY IF EXISTS identity_platform_read ON keystone.docustay_signup_identity;
CREATE POLICY identity_platform_read ON keystone.docustay_signup_identity FOR SELECT TO auth_owner USING (true);

SET LOCAL ROLE reference_guard;
GRANT EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() TO app_owner;
SET LOCAL ROLE app_owner;
DO $t$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['docustay_signup_identity', 'document_send_tombstone'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON keystone.%I', r || '_refuse_reference_delete_trg', r);
    EXECUTE format('CREATE TRIGGER %I AFTER DELETE ON keystone.%I REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows()', r || '_refuse_reference_delete_trg', r);
    EXECUTE format('ALTER TABLE keystone.%I ENABLE ALWAYS TRIGGER %I', r, r || '_refuse_reference_delete_trg');
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON keystone.%I', r || '_refuse_reference_truncate_trg', r);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON keystone.%I FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows()', r || '_refuse_reference_truncate_trg', r);
  END LOOP;
END $t$;

-- the tombstone trigger: only a SENT, non-test document leaves a line, and it counts exactly what keystone's own count (documents/api.mjs sendCountForPeriod) counts
CREATE OR REPLACE FUNCTION keystone.document_send_tombstone_fn() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_counted boolean; v_emails text[];
BEGIN
  IF OLD.sent_at IS NULL OR OLD.is_test THEN RETURN OLD; END IF;
  IF keystone.workspace_deletion_active(OLD.tenant_id) THEN RETURN OLD; END IF;   -- a whole workspace going away keeps nothing
  v_counted := (OLD.package_lead_id IS NULL OR OLD.package_lead_id = OLD.id)
    AND NOT (coalesce(OLD.source_channel, '') = 'form' AND OLD.executed_at IS NULL
             AND coalesce((SELECT p.status FROM keystone.document_party p WHERE p.instance_id = OLD.id AND p.action_role = 'signer' ORDER BY p.position LIMIT 1), '') NOT IN ('signed', 'approved'));
  SELECT coalesce(array_agg(DISTINCT lower(p.email)), '{}') INTO v_emails FROM keystone.document_party p WHERE p.instance_id = OLD.id AND p.email IS NOT NULL AND p.email <> '';
  INSERT INTO keystone.document_send_tombstone (tenant_id, sent_at, counted, emails) VALUES (OLD.tenant_id, OLD.sent_at, v_counted, v_emails);
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION keystone.document_send_tombstone_fn() FROM PUBLIC;
DROP TRIGGER IF EXISTS document_send_tombstone_trg ON keystone.document_instance;
CREATE TRIGGER document_send_tombstone_trg BEFORE DELETE ON keystone.document_instance FOR EACH ROW EXECUTE FUNCTION keystone.document_send_tombstone_fn();

-- backfill (2): the owners of the existing Docustay workspaces, one workspace at a time (the tables have forced row security)
DO $b$
DECLARE v_ids uuid[]; v_t uuid;
BEGIN
  SET LOCAL ROLE auth_owner;
  SELECT coalesce(array_agg(id), '{}') INTO v_ids FROM keystone.tenant WHERE product = 'docustay';
  SET LOCAL ROLE app_owner;
  FOREACH v_t IN ARRAY v_ids LOOP
    PERFORM set_config('keystone.tenant_id', v_t::text, true);
    INSERT INTO keystone.docustay_signup_identity (tenant_id, canonical_email, email)
      SELECT u.tenant_id, keystone.canonical_email(u.email), lower(u.email) FROM keystone.app_user u
       WHERE u.tenant_id = v_t AND u.role = 'staff' AND u.staff_role = 'owner' AND u.email IS NOT NULL AND u.email NOT LIKE '%@deleted.invalid'
      ON CONFLICT DO NOTHING;
  END LOOP;
  PERFORM set_config('keystone.tenant_id', '', true);
END $b$;

SET LOCAL ROLE auth_owner;
CREATE OR REPLACE FUNCTION keystone.docustay_free_workspace_exists(p_canonical text, p_except_email text DEFAULT NULL) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM keystone.docustay_signup_identity i JOIN keystone.workbench_subscription s ON s.tenant_id = i.tenant_id
     WHERE i.canonical_email = p_canonical AND s.plan_key = 'docustay_free' AND (p_except_email IS NULL OR i.email <> lower(p_except_email)))
$$;
REVOKE ALL ON FUNCTION keystone.docustay_free_workspace_exists(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.docustay_free_workspace_exists(text, text) TO app_rw;
DO $s$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_signup') THEN GRANT EXECUTE ON FUNCTION keystone.docustay_free_workspace_exists(text, text) TO app_signup; END IF; END $s$;
SET LOCAL ROLE app_owner;

-- (3) ------------------------------------------------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS keystone.docustay_review_flag (
  id           uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  kind         text        NOT NULL CHECK (kind IN ('repeat_free_workspace', 'same_business_name', 'throwaway_domain_refused', 'fair_use_seats', 'fair_use_documents', 'fair_use_storage', 'dispute_lost', 'complaints_paused', 'own_key_grandfathered')),
  subject      text        NOT NULL CHECK (length(subject) BETWEEN 1 AND 200),
  workspace_id uuid        NULL,
  detail       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS docustay_review_flag_open_once ON keystone.docustay_review_flag (kind, subject) WHERE resolved_at IS NULL;
ALTER TABLE keystone.docustay_review_flag ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.docustay_review_flag FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS anyone_writes ON keystone.docustay_review_flag;
CREATE POLICY anyone_writes ON keystone.docustay_review_flag FOR INSERT WITH CHECK (true);   -- the grants below decide who may insert; nobody but auth_owner can read
DROP POLICY IF EXISTS platform_read ON keystone.docustay_review_flag;
CREATE POLICY platform_read ON keystone.docustay_review_flag FOR SELECT TO auth_owner USING (true);
DROP POLICY IF EXISTS platform_resolve ON keystone.docustay_review_flag;
CREATE POLICY platform_resolve ON keystone.docustay_review_flag FOR UPDATE TO auth_owner USING (true) WITH CHECK (true);
GRANT INSERT ON keystone.docustay_review_flag TO app_rw, app_worker;
DO $s$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_signup') THEN GRANT INSERT ON keystone.docustay_review_flag TO app_signup; END IF; END $s$;
GRANT SELECT, UPDATE ON keystone.docustay_review_flag TO auth_owner;

SET LOCAL ROLE auth_owner;
CREATE OR REPLACE FUNCTION keystone.docustay_review_flags(p_limit integer DEFAULT 200)
RETURNS TABLE (id uuid, kind text, subject text, workspace_id uuid, detail jsonb, created_at timestamptz, resolved_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT f.id, f.kind, f.subject, f.workspace_id, f.detail, f.created_at, f.resolved_at FROM keystone.docustay_review_flag f ORDER BY (f.resolved_at IS NOT NULL), f.created_at DESC LIMIT greatest(1, least(p_limit, 1000))
$$;
CREATE OR REPLACE FUNCTION keystone.docustay_review_flag_resolve(p_id uuid) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  WITH u AS (UPDATE keystone.docustay_review_flag SET resolved_at = now() WHERE id = p_id AND resolved_at IS NULL RETURNING 1) SELECT EXISTS (SELECT 1 FROM u)
$$;
REVOKE ALL ON FUNCTION keystone.docustay_review_flags(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION keystone.docustay_review_flag_resolve(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.docustay_review_flags(integer) TO app_rw;
GRANT EXECUTE ON FUNCTION keystone.docustay_review_flag_resolve(uuid) TO app_rw;
SET LOCAL ROLE app_owner;

-- (5) ------------------------------------------------------------------------------------------------------------------------------------------------------------
ALTER TABLE keystone.document_ai_secret ADD COLUMN IF NOT EXISTS grandfathered_until timestamptz NULL;
DO $g$
DECLARE v_ids uuid[]; v_t uuid; v_until timestamptz := (date_trunc('month', now() AT TIME ZONE 'UTC') + interval '1 month') AT TIME ZONE 'UTC';
BEGIN
  SET LOCAL ROLE auth_owner;
  SELECT coalesce(array_agg(id), '{}') INTO v_ids FROM keystone.tenant WHERE product = 'docustay';
  SET LOCAL ROLE app_owner;
  FOREACH v_t IN ARRAY v_ids LOOP
    PERFORM set_config('keystone.tenant_id', v_t::text, true);
    UPDATE keystone.document_ai_secret a SET grandfathered_until = v_until
     WHERE a.tenant_id = v_t AND a.grandfathered_until IS NULL
       AND EXISTS (SELECT 1 FROM keystone.workbench_subscription s WHERE s.tenant_id = v_t AND (s.plan_key = 'docustay_free' OR s.status = 'canceled'));
  END LOOP;
  PERFORM set_config('keystone.tenant_id', '', true);
END $g$;

-- (6) ------------------------------------------------------------------------------------------------------------------------------------------------------------
SET LOCAL ROLE auth_owner;
ALTER TABLE keystone_auth.session DROP CONSTRAINT session_revoked_reason_check;
ALTER TABLE keystone_auth.session ADD CONSTRAINT session_revoked_reason_check
  CHECK (revoked_reason IN ('logout','tenant_changed','admin','expired_sweep','role_changed','password_changed','device_removed','operator_ended','removed_from_team','suspended','device_limit'));
SET LOCAL ROLE app_owner;

-- (7) ------------------------------------------------------------------------------------------------------------------------------------------------------------
ALTER TABLE keystone.docustay_billing_record DROP CONSTRAINT IF EXISTS docustay_billing_record_kind_check;
ALTER TABLE keystone.docustay_billing_record ADD CONSTRAINT docustay_billing_record_kind_check
  CHECK (kind IN ('renewal_terms_accepted', 'cancel_intent', 'cancel_confirmed', 'resumed', 'renewal_reminder_sent', 'refund_noted', 'plan_switched',
                  'dispute_lost', 'dispute_cleared', 'downgrade_scheduled', 'downgrade_cancelled', 'switch_credit'));

-- (8) ------------------------------------------------------------------------------------------------------------------------------------------------------------
-- One production instance per self-host licence key (the maintainer, 21 Oct 2026, answer 8): the light version. Every instance that presents a key is remembered (anonymous instance id, role, version, when), so a SECOND
-- production instance on the same key can be noticed. It is only ever a warning (admin screen and an email to the licence owner): nothing here can block an instance. Platform-organisation rows, like docustay_install.
CREATE TABLE IF NOT EXISTS keystone.docustay_license_instance (
  tenant_id     uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  key_hash      text        NOT NULL,
  install_id    uuid        NOT NULL,
  role          text        NOT NULL DEFAULT 'production' CHECK (role IN ('production', 'test')),
  version       text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  notified_at   timestamptz,
  PRIMARY KEY (tenant_id, key_hash, install_id),
  FOREIGN KEY (tenant_id, key_hash) REFERENCES keystone.docustay_license (tenant_id, key_hash) ON DELETE CASCADE
);
ALTER TABLE keystone.docustay_license_instance ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.docustay_license_instance FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON keystone.docustay_license_instance;
CREATE POLICY tenant_isolation ON keystone.docustay_license_instance USING (tenant_id = keystone.current_tenant_id()) WITH CHECK (tenant_id = keystone.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON keystone.docustay_license_instance TO app_rw, app_worker;
-- the instances already bound to a key keep counting as that key's first production instance
INSERT INTO keystone.docustay_license_instance (tenant_id, key_hash, install_id, first_seen_at, last_seen_at)
  SELECT tenant_id, key_hash, install_id, COALESCE(last_seen_at, created_at), COALESCE(last_seen_at, created_at) FROM keystone.docustay_license WHERE install_id IS NOT NULL
  ON CONFLICT DO NOTHING;

DO $c$
BEGIN
  IF keystone.canonical_email('A.B.C+tag@GoogleMail.com') <> 'abc@gmail.com' THEN RAISE EXCEPTION '0769 self-check: gmail'; END IF;
  IF keystone.canonical_email('Jo+x@outlook.com') <> 'jo@outlook.com' THEN RAISE EXCEPTION '0769 self-check: outlook'; END IF;
  IF keystone.canonical_email('first.last+x@corp.example') <> 'first.last+x@corp.example' THEN RAISE EXCEPTION '0769 self-check: other domain must be unchanged'; END IF;
  IF has_table_privilege('app_rw', 'keystone.docustay_review_flag', 'SELECT') THEN RAISE EXCEPTION '0769 self-check: the review list must not be readable by the application'; END IF;
  IF current_user <> 'app_owner' THEN RAISE EXCEPTION '0769 finished as % — it must hand back to app_owner', current_user; END IF;
END $c$;
