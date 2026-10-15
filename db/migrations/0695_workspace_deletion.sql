-- 0695 · DELETING A WORKSPACE (Run 4, 10 Oct 2026). Until now there was no way for the owner of a workspace to remove it: a by-hand deletion had to switch the "a practice must always have an Owner" trigger off for a moment.
-- This migration adds the real route's database half. Additive, and everything that stays refused today stays refused for every caller except this one function:
--   · keystone_meta.workspace_deletion_in_flight — a private table only app_owner can write. delete_workspace() writes one row (this transaction's id) and removes it before it returns. The guards below ask workspace_deletion_active(),
--     which is true only while that row exists IN THE SAME TRANSACTION. A session cannot fake it (no other role can insert the row), unlike a setting any session can set.
--   · four guards learn the exception: the last-owner rule, the permanent credit ledger, a payment plan's frozen rows, and the "signed document inside its retention window" rule. Each answers "yes, go ahead" only while a workspace is being deleted
--     and only for rows of THAT workspace. Every other caller meets exactly the refusals it met before.
--   · every table that carries a tenant_id gets one more policy, FOR DELETE TO app_owner, true only while that workspace's deletion is in flight. (Many tables have no delete policy at all — "nothing is deleted" — so a plain DELETE finds no rows.)
--   · keystone.delete_workspace(): SECURITY DEFINER, refuses unless the caller is already inside that workspace's own context and the person named is an owner there; refuses the reference/platform workspaces and anything marked a protected real client;
--     deletes every row of the workspace in foreign-key order (the object-storage keys and the sign-in identities that belonged only to this workspace are handed back so the application can remove them), writes one platform-level record that outlives the workspace.
-- The application route (POST /api/product/docustay/delete-workspace) is the only caller.

CREATE TABLE keystone_meta.workspace_deletion_in_flight (
  tenant_id  uuid        NOT NULL,
  txid       bigint      NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, txid)
);
ALTER TABLE keystone_meta.workspace_deletion_in_flight ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone_meta.workspace_deletion_in_flight FORCE  ROW LEVEL SECURITY;
CREATE POLICY owner_only ON keystone_meta.workspace_deletion_in_flight TO app_owner USING (true) WITH CHECK (true);
COMMENT ON TABLE keystone_meta.workspace_deletion_in_flight IS '0695 — one row while delete_workspace() runs, in its own transaction; nothing but app_owner can read or write it, so "a workspace is being deleted" cannot be claimed by an ordinary session.';

CREATE OR REPLACE FUNCTION keystone.workspace_deletion_active(p_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT EXISTS (SELECT 1 FROM keystone_meta.workspace_deletion_in_flight WHERE tenant_id = p_tenant AND txid = txid_current()) $$;
REVOKE ALL ON FUNCTION keystone.workspace_deletion_active(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.workspace_deletion_active(uuid) TO app_rw, app_owner, reference_guard, auth_owner;

-- the platform-level record of a deletion (it must outlive the workspace, so it cannot live in a tenant table)
ALTER TABLE keystone_meta.platform_event DROP CONSTRAINT platform_event_kind_check;
ALTER TABLE keystone_meta.platform_event ADD CONSTRAINT platform_event_kind_check CHECK (kind = ANY (ARRAY['health.check_failed','health.check_recovered','backup.verified','backup.failed','job.gave_up','job.reaper_stopped','workspace.deleted']));

-- the four guards (bodies as they were, with one early exit added)
CREATE OR REPLACE FUNCTION keystone.enforce_last_owner()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_caller_tenant text;
  v_owners        integer;
BEGIN
  IF TG_OP = 'DELETE' AND keystone.workspace_deletion_active(OLD.tenant_id) THEN RETURN OLD; END IF;   -- 0695: the whole workspace is going

  IF OLD.staff_role IS DISTINCT FROM 'owner' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.staff_role IS NOT DISTINCT FROM 'owner'
     AND NEW.tenant_id  IS NOT DISTINCT FROM OLD.tenant_id THEN
    RETURN NEW;
  END IF;

  v_caller_tenant := current_setting('keystone.tenant_id', true);

  BEGIN
    PERFORM set_config('keystone.tenant_id', OLD.tenant_id::text, true);

    SELECT count(*) INTO v_owners
      FROM keystone.app_user u
     WHERE u.tenant_id = OLD.tenant_id
       AND u.staff_role = 'owner'
       AND u.id <> OLD.id;

    PERFORM set_config('keystone.tenant_id', coalesce(v_caller_tenant, ''), true);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('keystone.tenant_id', coalesce(v_caller_tenant, ''), true);
    RAISE;
  END;

  IF v_owners = 0 THEN
    RAISE EXCEPTION 'a practice must always have an Owner'
      USING ERRCODE = 'check_violation',
            DETAIL  = format('app_user %s is the only person with staff_role = ''owner'' in practice %s', OLD.id, OLD.tenant_id),
            HINT    = 'Give the Owner rank to somebody else in this practice first, then change or remove this person.';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $function$;

CREATE OR REPLACE FUNCTION keystone.credit_event_append_only()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' AND (pg_trigger_depth() > 1 OR keystone.workspace_deletion_active(OLD.tenant_id)) THEN RETURN OLD; END IF;   -- the ledger leaves only with its whole practice (an FK cascade, or 0695's workspace deletion)
  RAISE EXCEPTION 'credit_event is a permanent ledger: it is never % — correct a mistake with a new event.',
    CASE TG_OP WHEN 'DELETE' THEN 'deleted' ELSE 'changed' END USING ERRCODE = 'check_violation';
END $function$;

CREATE OR REPLACE FUNCTION keystone.payment_plan_row_frozen()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_plan_state text;
BEGIN
  IF TG_OP = 'DELETE' AND keystone.workspace_deletion_active(OLD.tenant_id) THEN RETURN OLD; END IF;   -- 0695: the whole workspace is going

  SELECT state INTO v_plan_state FROM keystone.payment_plan WHERE id = OLD.payment_plan_id;

  IF v_plan_state IS DISTINCT FROM 'offered' AND (
       TG_OP = 'DELETE'
       OR NEW.due_date     IS DISTINCT FROM OLD.due_date
       OR NEW.amount_minor IS DISTINCT FROM OLD.amount_minor
       OR NEW.n            IS DISTINCT FROM OLD.n
     ) THEN
    RAISE EXCEPTION 'payment plan % is agreed; its rows are frozen', OLD.payment_plan_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$function$;

CREATE OR REPLACE FUNCTION keystone.document_instance_terminal_no_delete()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF keystone.workspace_deletion_active(OLD.tenant_id) THEN RETURN OLD; END IF;   -- 0695: the owner is closing the whole workspace; the export (signed copies and certificates) is theirs to take first
  IF keystone.document_is_retained(OLD.tenant_id, OLD.state, OLD.executed_at) THEN
    RAISE EXCEPTION 'a signed document is a legal record and is kept — retention is "%", and this one is still inside it. It can be deleted only after its retention window has passed.',
      coalesce((SELECT value #>> '{}' FROM keystone.document_setting WHERE tenant_id = OLD.tenant_id AND key = 'retention_years'), 'indefinite') USING ERRCODE = 'check_violation';
  END IF;
  IF nullif(btrim(coalesce(current_setting('keystone.record_delete_reason', true), '')), '') IS NOT NULL THEN
    RETURN OLD;   -- the shared delete route, for an Owner/Admin, audited (record.deleted)
  END IF;
  IF OLD.state IN ('executed', 'declined') THEN
    RAISE EXCEPTION 'an % instrument is never deleted — its signature records reference it and its snapshot is the record of what was agreed. Void it instead.', OLD.state USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END $function$;

-- every tenant table: one more policy, delete only while that workspace's deletion is in flight, only for app_owner
DO $policies$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.table_schema AS s, c.table_name AS t
      FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
     WHERE c.column_name = 'tenant_id' AND c.table_schema IN ('keystone', 'keystone_meta')
       AND NOT (c.table_schema = 'keystone_meta' AND c.table_name = 'workspace_deletion_in_flight')
       AND NOT (c.table_schema = 'keystone' AND c.table_name = 'tenant')
  LOOP
    EXECUTE format('CREATE POLICY workspace_deletion ON %I.%I FOR DELETE TO app_owner USING (keystone.workspace_deletion_active(tenant_id))', r.s, r.t);
  END LOOP;
END
$policies$;
-- the tenant row itself
CREATE POLICY workspace_deletion ON keystone.tenant FOR DELETE TO app_owner USING (keystone.workspace_deletion_active(id));

SET LOCAL ROLE auth_owner;
CREATE OR REPLACE FUNCTION keystone.workspace_only_identities(p_tenant uuid) RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT CASE WHEN keystone.workspace_deletion_active(p_tenant)
              THEN coalesce((SELECT array_agg(DISTINCT u.firebase_uid) FROM keystone.app_user u
                              WHERE u.tenant_id = p_tenant AND u.firebase_uid IS NOT NULL
                                AND NOT EXISTS (SELECT 1 FROM keystone.app_user o WHERE o.firebase_uid = u.firebase_uid AND o.tenant_id <> p_tenant)), '{}')
              ELSE '{}'::text[] END
$fn$;
REVOKE ALL ON FUNCTION keystone.workspace_only_identities(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.workspace_only_identities(uuid) TO app_owner;
SET LOCAL ROLE app_owner;

-- the sign-in tables belong to another role (auth_owner) and refuse every other reader; their own function removes this workspace's sessions, API keys and webhook sources, and the sign-in factors of the identities that were only here
SET LOCAL ROLE auth_owner;
CREATE OR REPLACE FUNCTION keystone.delete_workspace_credentials(p_tenant uuid, p_uids text[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
BEGIN
  IF NOT keystone.workspace_deletion_active(p_tenant) THEN
    RAISE EXCEPTION 'workspace credentials are removed only as part of deleting the workspace' USING ERRCODE = 'insufficient_privilege';
  END IF;
  DELETE FROM keystone_auth.session        WHERE tenant_id = p_tenant;
  DELETE FROM keystone_auth.api_token      WHERE tenant_id = p_tenant;
  DELETE FROM keystone_auth.webhook_source WHERE tenant_id = p_tenant;
  IF p_uids IS NOT NULL AND cardinality(p_uids) > 0 THEN
    DELETE FROM keystone_auth.email_code        WHERE firebase_uid = ANY (p_uids);
    DELETE FROM keystone_auth.passkey_challenge WHERE firebase_uid = ANY (p_uids);
    DELETE FROM keystone_auth.backup_code       WHERE factor_id IN (SELECT id FROM keystone_auth.totp_factor WHERE firebase_uid = ANY (p_uids));
    DELETE FROM keystone_auth.totp_factor       WHERE firebase_uid = ANY (p_uids);
    DELETE FROM keystone_auth.passkey           WHERE firebase_uid = ANY (p_uids);
  END IF;
END
$fn$;
REVOKE ALL ON FUNCTION keystone.delete_workspace_credentials(uuid, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.delete_workspace_credentials(uuid, text[]) TO app_owner;
SET LOCAL ROLE app_owner;

CREATE OR REPLACE FUNCTION keystone.delete_workspace(p_tenant uuid, p_actor uuid, p_actor_email text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_ctx     text := current_setting('keystone.tenant_id', true);
  v_t       keystone.tenant%ROWTYPE;
  v_uids    text[] := '{}';
  v_keys    text[] := '{}';
  v_counts  jsonb := '{}'::jsonb;
  v_todo    text[];
  v_pending text[];
  v_try     text[];
  v_t_name  text;
  v_n       bigint;
  v_pass    integer := 0;
  v_progress boolean;
  v_left    text;
BEGIN
  IF v_ctx IS DISTINCT FROM p_tenant::text THEN
    RAISE EXCEPTION 'a workspace can only be deleted from inside itself' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_t FROM keystone.tenant WHERE id = p_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'no such workspace' USING ERRCODE = 'no_data_found'; END IF;
  IF v_t.is_reference OR v_t.is_platform THEN
    RAISE EXCEPTION 'the % workspace is permanent and cannot be deleted', v_t.slug USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM keystone.app_user WHERE id = p_actor AND tenant_id = p_tenant AND staff_role = 'owner') THEN
    RAISE EXCEPTION 'only an owner of this workspace can delete it' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF EXISTS (SELECT 1 FROM keystone.app_user WHERE tenant_id = p_tenant AND protected_real_client) OR EXISTS (SELECT 1 FROM keystone.invoice WHERE tenant_id = p_tenant AND protected_real_client) THEN
    RAISE EXCEPTION 'this workspace holds records marked as a real client''s and is read-only; it cannot be deleted here' USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO keystone_meta.workspace_deletion_in_flight (tenant_id, txid) VALUES (p_tenant, txid_current());
  PERFORM set_config('keystone.record_delete_reason', 'workspace deleted by its owner', true);

  -- sign-in identities that belong only to this workspace (the application removes them from the identity provider afterwards)
  v_uids := keystone.workspace_only_identities(p_tenant);
  -- the built-in email+password identities (self-host and local installs) live in this database: they leave with the workspace
  DELETE FROM keystone.local_credential WHERE uid = ANY (v_uids);
  p_actor_email := coalesce(p_actor_email, (SELECT email FROM keystone.app_user WHERE id = p_actor));

  -- object-storage files that belong to it
  SELECT coalesce(array_agg(k), '{}') INTO v_keys FROM (
    SELECT storage_key AS k FROM keystone.document_file WHERE tenant_id = p_tenant AND storage_key IS NOT NULL
    UNION SELECT object_key FROM keystone.document_pdf WHERE tenant_id = p_tenant AND object_key IS NOT NULL
    UNION SELECT storage_key FROM keystone.person_attachment WHERE tenant_id = p_tenant AND storage_key IS NOT NULL
    UNION SELECT object_key FROM keystone.data_export WHERE tenant_id = p_tenant AND object_key IS NOT NULL) x;

  -- sessions, API keys, webhook sources and the sign-in factors of the identities that were only here
  PERFORM keystone.delete_workspace_credentials(p_tenant, v_uids);

  -- every table with a tenant_id, children before parents; a table that is still referenced is tried again on the next pass
  SELECT array_agg(c.table_schema || '.' || c.table_name) INTO v_todo
    FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
   WHERE c.column_name = 'tenant_id' AND c.table_schema IN ('keystone', 'keystone_meta')
     AND NOT (c.table_schema = 'keystone_meta' AND c.table_name = 'workspace_deletion_in_flight')
     AND NOT (c.table_schema = 'keystone' AND c.table_name = 'tenant');
  v_pending := v_todo;
  WHILE cardinality(v_pending) > 0 AND v_pass < 12 LOOP
    v_pass := v_pass + 1; v_progress := false;
    -- tables nothing else (still pending) points at, first
    SELECT coalesce(array_agg(p), '{}') INTO v_try FROM unnest(v_pending) p
     WHERE NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.contype = 'f' AND k.confrelid = p::regclass AND k.conrelid <> k.confrelid
                          AND (k.conrelid::regclass::text) = ANY (v_pending));
    IF cardinality(v_try) = 0 THEN v_try := v_pending; END IF;   -- a cycle: try them all and let the database say which are free
    FOREACH v_t_name IN ARRAY v_try LOOP
      BEGIN
        EXECUTE format('DELETE FROM %s WHERE tenant_id = $1', v_t_name) USING p_tenant;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        IF v_n > 0 THEN v_counts := v_counts || jsonb_build_object(v_t_name, coalesce((v_counts ->> v_t_name)::bigint, 0) + v_n); END IF;
        v_pending := array_remove(v_pending, v_t_name); v_progress := true;
      EXCEPTION WHEN foreign_key_violation THEN NULL;   -- something still points at it; next pass
      END;
    END LOOP;
    IF NOT v_progress THEN EXIT; END IF;
  END LOOP;
  IF cardinality(v_pending) > 0 THEN
    RAISE EXCEPTION 'could not remove every record of the workspace; still blocked: %', array_to_string(v_pending, ', ') USING ERRCODE = 'foreign_key_violation';
  END IF;

  DELETE FROM keystone.tenant WHERE id = p_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'the workspace row could not be removed (a record elsewhere still points at it)' USING ERRCODE = 'foreign_key_violation';
  END IF;

  INSERT INTO keystone_meta.platform_event (kind, subject, facts)
  VALUES ('workspace.deleted', p_tenant::text, jsonb_build_object('slug', v_t.slug, 'name', v_t.name, 'product', v_t.product, 'by_user', p_actor, 'by_email', p_actor_email, 'rows_removed', v_counts));

  DELETE FROM keystone_meta.workspace_deletion_in_flight WHERE tenant_id = p_tenant AND txid = txid_current();
  RETURN jsonb_build_object('slug', v_t.slug, 'name', v_t.name, 'firebase_uids', to_jsonb(v_uids), 'storage_keys', to_jsonb(v_keys), 'rows_removed', v_counts);
END
$fn$;
REVOKE ALL ON FUNCTION keystone.delete_workspace(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.delete_workspace(uuid, uuid, text) TO app_rw;
COMMENT ON FUNCTION keystone.delete_workspace(uuid, uuid, text) IS '0695 — the real "delete this workspace": owner-only, refuses the platform and reference workspaces and protected real-client records, removes every row in foreign-key order, hands back the storage keys and sign-in identities that belonged only to it, writes one platform-level record. The only caller is POST /api/product/docustay/delete-workspace.';

DO $workspace_deletion_self_check$
DECLARE v_tables integer; v_policies integer;
BEGIN
  SELECT count(*) INTO v_tables FROM information_schema.columns c JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
   WHERE c.column_name = 'tenant_id' AND c.table_schema IN ('keystone', 'keystone_meta') AND NOT (c.table_schema = 'keystone_meta' AND c.table_name = 'workspace_deletion_in_flight') AND NOT (c.table_schema = 'keystone' AND c.table_name = 'tenant');
  SELECT count(*) INTO v_policies FROM pg_policy p WHERE p.polname = 'workspace_deletion' AND p.polrelid <> 'keystone.tenant'::regclass;
  IF v_policies <> v_tables THEN RAISE EXCEPTION '0695: % tenant tables but % workspace_deletion policies', v_tables, v_policies; END IF;
  IF has_function_privilege('public', 'keystone.delete_workspace(uuid, uuid, text)', 'EXECUTE') THEN RAISE EXCEPTION '0695: delete_workspace must not be executable by PUBLIC'; END IF;
  IF has_table_privilege('app_rw', 'keystone_meta.workspace_deletion_in_flight', 'INSERT') THEN RAISE EXCEPTION '0695: app_rw must not be able to write workspace_deletion_in_flight'; END IF;
END
$workspace_deletion_self_check$;
