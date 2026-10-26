-- ★★★ STAGE 4 TASK 1 — F486. THE GIVE-UP LEDGER (spec 07 §4.6-7, §5, §11).
--
-- [MEASURED, production] 139 graphile jobs sat at attempts = max_attempts (25), every one closed by
-- reap_orphan_jobs (P3.3) for a practice that no longer exists (deleted TEST practices). The queue check
-- counted each as "gave up", so the hourly "Job queue needs attention" email could never clear: nothing
-- could be done about those jobs, and nothing recorded that anyone had looked.
--
-- ★★ THE FIX IS A LEDGER, NOT A FILTER. keystone_meta.job_failure holds one row per graphile job that
--    gave up: what it was, whose it was (tenant_id, NO foreign key — the practice may be gone), a
--    plain-language reason, and whether (and why, and by whom) it was acknowledged. The queue check then
--    asks "is there any give-up nobody has acknowledged?" (Ruling R59: no last-hour window), and a graphile
--    job at max_attempts with NO ledger row still counts — a real give-up the ledger has not heard of is
--    never hidden.
--
-- ★★ app_worker KEEPS ZERO TABLE RIGHTS (p21a_role_matrix). It writes and reads ONLY through two SECURITY
--    DEFINER functions owned by app_owner (the table's owner — the table carries no RLS, like backup_run,
--    0114/0129, so there is no FORCE-RLS owner trap here), with SET search_path = '', EXECUTE to app_worker
--    only, REVOKE from PUBLIC. They are created, revoked and granted in ONE role (app_owner, their owner) —
--    0141's lesson: a REVOKE run by a non-owner WARNS and does nothing.
--
-- ★★ AND ONE auth_owner RESOLVER, keystone_auth.tenant_exists(uuid). The reaper must tell "the practice
--    is GONE" (its jobs can never run — record, acknowledge, remove) from "the practice EXISTS but is not
--    active" (suspended/closed — never removed by this path). tenant_is_active() cannot tell those apart.
--    Same shape as tenant_is_active (0017 family): owned by auth_owner so tenant_health_read applies
--    instead of app_owner's forced tenant_isolation, a boolean too narrow to carry a leak, EXECUTE to
--    app_worker only. Its grants are made AS auth_owner (0141).
--
-- ★ The graphile rows themselves are removed by the REAPER at run time (app_worker can write graphile's
--   tables), not here: migrations run as app_owner and graphile_worker is owned by the admin role
--   (MEASURED db/migrate.mjs:93; pg_namespace), so this migration cannot touch the queue (Ruling R60).

CREATE TABLE keystone_meta.job_failure (
  id                  bigserial   PRIMARY KEY,
  job_id              bigint      NOT NULL CONSTRAINT job_failure_job_id_key UNIQUE,
  task_identifier     text        NOT NULL CONSTRAINT job_failure_task_check CHECK (btrim(task_identifier) <> ''),
  -- ★ NO foreign key: the practice may be gone — that is exactly the case this ledger exists for.
  tenant_id           uuid,
  reason              text        NOT NULL CONSTRAINT job_failure_reason_check CHECK (btrim(reason) <> ''),
  gave_up_at          timestamptz NOT NULL DEFAULT now(),
  acknowledged_at     timestamptz,
  acknowledged_by     text        CONSTRAINT job_failure_acknowledged_by_check CHECK (
                        acknowledged_by = 'system'
                        OR acknowledged_by ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  acknowledge_reason  text,
  -- ★ An acknowledgement is all three or none: when, who, and why in words.
  CONSTRAINT job_failure_acknowledgement_complete CHECK (
    (acknowledged_at IS NULL AND acknowledged_by IS NULL AND acknowledge_reason IS NULL)
    OR (acknowledged_at IS NOT NULL AND acknowledged_by IS NOT NULL
        AND acknowledge_reason IS NOT NULL AND btrim(acknowledge_reason) <> ''))
);
CREATE INDEX job_failure_unacknowledged ON keystone_meta.job_failure (gave_up_at) WHERE acknowledged_at IS NULL;
REVOKE ALL ON keystone_meta.job_failure FROM PUBLIC;
REVOKE ALL ON SEQUENCE keystone_meta.job_failure_id_seq FROM PUBLIC;

COMMENT ON TABLE keystone_meta.job_failure IS
  'Stage 4 Task 1 / F486 / spec 07 §4.6-7 — one row per background job that gave up: task, tenant (no FK — the practice may be gone), plain reason, and its acknowledgement (when/by/why). Written only through keystone_meta.record_job_failure(); read by the watcher only through keystone_meta.job_failure_health(). No application role holds any grant on this table.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- THE WRITER. Idempotent: the first reason is kept; an acknowledgement, once made, is never
-- rewritten (a second acknowledge is a no-op), and acknowledging a row that was recorded
-- unacknowledged completes it. Acknowledgements from this function are always by 'system' —
-- a person's acknowledgement ("Give up…" in Platform, 07 §4.8) is a separate, platform-gated path.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE FUNCTION keystone_meta.record_job_failure(
  p_job_id bigint, p_task text, p_tenant_id uuid, p_reason text,
  p_acknowledged boolean, p_ack_reason text)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
  INSERT INTO keystone_meta.job_failure AS f
         (job_id, task_identifier, tenant_id, reason, acknowledged_at, acknowledged_by, acknowledge_reason)
  VALUES (p_job_id, p_task, p_tenant_id, p_reason,
          CASE WHEN p_acknowledged THEN pg_catalog.now() END,
          CASE WHEN p_acknowledged THEN 'system' END,
          CASE WHEN p_acknowledged THEN p_ack_reason END)
  ON CONFLICT (job_id) DO UPDATE
     SET acknowledged_at    = pg_catalog.now(),
         acknowledged_by    = 'system',
         acknowledge_reason = EXCLUDED.acknowledge_reason
   WHERE f.acknowledged_at IS NULL AND EXCLUDED.acknowledged_at IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION keystone_meta.record_job_failure(bigint, text, uuid, text, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone_meta.record_job_failure(bigint, text, uuid, text, boolean, text) TO app_worker;

COMMENT ON FUNCTION keystone_meta.record_job_failure(bigint, text, uuid, text, boolean, text) IS
  'Stage 4 Task 1 / F486 — the only application write path into keystone_meta.job_failure. Idempotent on job_id: keeps the first reason, never rewrites an acknowledgement. EXECUTE to app_worker only.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- THE READ FOR THE WATCHER — aggregates only. The watcher passes the ids graphile holds at
-- max_attempts (app_worker can read graphile; app_owner cannot), and gets back two counts:
--   unacknowledged — ledger rows nobody has acknowledged;
--   unrecorded     — of the ids passed, how many the ledger has never heard of.
-- Their sum is "give-ups nobody has acknowledged". No id, no reason, no tenant crosses back.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE FUNCTION keystone_meta.job_failure_health(p_dead_job_ids bigint[])
RETURNS TABLE (unacknowledged int, unrecorded int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT (SELECT pg_catalog.count(*)::int FROM keystone_meta.job_failure f WHERE f.acknowledged_at IS NULL),
         (SELECT pg_catalog.count(DISTINCT d.id)::int
            FROM pg_catalog.unnest(coalesce(p_dead_job_ids, '{}'::bigint[])) AS d(id)
           WHERE NOT EXISTS (SELECT 1 FROM keystone_meta.job_failure f WHERE f.job_id = d.id))
$$;
REVOKE ALL ON FUNCTION keystone_meta.job_failure_health(bigint[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone_meta.job_failure_health(bigint[]) TO app_worker;

COMMENT ON FUNCTION keystone_meta.job_failure_health(bigint[]) IS
  'Stage 4 Task 1 / F486 — the queue check''s read: count of unacknowledged ledger rows, and how many of the given graphile ids (those at max_attempts) have no ledger row at all. Aggregates only. EXECUTE to app_worker only.';

GRANT USAGE ON SCHEMA keystone_meta TO app_worker;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- tenant_exists — owned, revoked and granted AS auth_owner (0141), then back to app_owner.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
SET LOCAL ROLE auth_owner;

CREATE FUNCTION keystone_auth.tenant_exists(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM keystone.tenant t WHERE t.id = p_tenant_id);
$$;
REVOKE ALL ON FUNCTION keystone_auth.tenant_exists(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone_auth.tenant_exists(uuid) TO app_worker;

COMMENT ON FUNCTION keystone_auth.tenant_exists(uuid) IS
  'Stage 4 Task 1 / F486 — does this practice row exist at all (any status)? The reaper removes a job only when its practice is GONE; a suspended or closed practice still exists and its jobs are never removed by that path. Owned by auth_owner so tenant_health_read applies (FORCE RLS would show app_owner nothing). A boolean — too narrow to carry a leak. EXECUTE to app_worker only.';

SET LOCAL ROLE app_owner;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- ★★ ASSERT THE RESULT, NOT THE STATEMENT (0141) — in both directions.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE r text; c text; f text; bad text[] := '{}'; probe record; t_any uuid;
BEGIN
  IF current_user <> 'app_owner' THEN
    RAISE EXCEPTION '0145 finished as % — it must hand back to app_owner, never RESET ROLE', current_user;
  END IF;

  -- NEGATIVE: no application role holds any table privilege on the ledger.
  FOREACH r IN ARRAY ARRAY['app_rw','app_worker','app_embed','app_signup'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN CONTINUE; END IF;
    FOREACH c IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'] LOOP
      IF has_table_privilege(r, 'keystone_meta.job_failure', c) THEN bad := bad || (r || ':' || c); END IF;
    END LOOP;
  END LOOP;
  IF cardinality(bad) > 0 THEN
    RAISE EXCEPTION '0145: keystone_meta.job_failure is reachable directly: % — app_worker holds zero table rights', bad;
  END IF;

  -- The two ledger functions: PUBLIC no, app_rw/app_embed/app_signup no, app_worker YES (positive).
  -- (tenant_exists is checked below, as auth_owner: app_owner has no USAGE on keystone_auth.)
  FOREACH f IN ARRAY ARRAY[
      'keystone_meta.record_job_failure(bigint,text,uuid,text,boolean,text)',
      'keystone_meta.job_failure_health(bigint[])'] LOOP
    IF has_function_privilege('public', f, 'EXECUTE') THEN
      RAISE EXCEPTION '0145: % is executable by PUBLIC (acl %)', f, (SELECT proacl FROM pg_proc WHERE oid = f::regprocedure);
    END IF;
    FOREACH r IN ARRAY ARRAY['app_rw','app_embed','app_signup'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) AND has_function_privilege(r, f, 'EXECUTE') THEN
        RAISE EXCEPTION '0145: % can execute %', r, f;
      END IF;
    END LOOP;
    IF NOT has_function_privilege('app_worker', f, 'EXECUTE') THEN
      RAISE EXCEPTION '0145: app_worker cannot execute % — the reaper/watcher would break', f;
    END IF;
  END LOOP;

  -- POSITIVE CONTROL: the watcher's read runs, and counts an id it has never heard of.
  SELECT * INTO probe FROM keystone_meta.job_failure_health(ARRAY[-1]::bigint[]);
  IF probe.unrecorded IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION '0145: job_failure_health did not count an unrecorded id (got %)', probe.unrecorded;
  END IF;
END $$;

-- ★ tenant_exists grants and positive control, as its owner (app_owner, NOINHERIT, holds no EXECUTE of its own):
--   it must SEE a practice that exists — the FORCE-RLS owner trap (0129) would make it say false for all.
SET LOCAL ROLE auth_owner;
DO $$
DECLARE t_any uuid; n_tenants int; r text; f text := 'keystone_auth.tenant_exists(uuid)';
BEGIN
  IF has_function_privilege('public', f, 'EXECUTE') THEN
    RAISE EXCEPTION '0145: % is executable by PUBLIC (acl %)', f, (SELECT proacl FROM pg_proc WHERE oid = f::regprocedure);
  END IF;
  FOREACH r IN ARRAY ARRAY['app_rw','app_embed','app_signup'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) AND has_function_privilege(r, f, 'EXECUTE') THEN
      RAISE EXCEPTION '0145: % can execute %', r, f;
    END IF;
  END LOOP;
  IF NOT has_function_privilege('app_worker', f, 'EXECUTE') THEN
    RAISE EXCEPTION '0145: app_worker cannot execute % — the reaper could not tell gone from inactive', f;
  END IF;

  SELECT count(*) INTO n_tenants FROM keystone.tenant;
  IF n_tenants > 0 THEN
    SELECT id INTO t_any FROM keystone.tenant LIMIT 1;
    IF NOT keystone_auth.tenant_exists(t_any) THEN
      RAISE EXCEPTION '0145: tenant_exists() said false for a practice that exists — it cannot see keystone.tenant';
    END IF;
  END IF;
  IF keystone_auth.tenant_exists('00000000-0000-0000-0000-000000000000') THEN
    RAISE EXCEPTION '0145: tenant_exists() said true for the nil uuid';
  END IF;
END $$;
SET LOCAL ROLE app_owner;
