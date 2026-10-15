-- ★★★ STAGE 3 TASK 6 — PLATFORM FACTS HAVE A HOME (spec 02-event-catalogue §2 rule 11, §5 platform).
--     Every event belongs to one practice: `keystone.event.tenant_id` is NOT NULL (0016:22). A health
--     check failing or recovering, a backup verified or failed, a background job giving up — facts
--     about the PLATFORM — had nowhere to live. §2.11: "they go to a separate `platform_event` list
--     read by Platform and the alerting job, never to a practice's outbox."
--
-- ★★ THE SHAPE OF THE ACCESS, AND WHY EACH PIECE IS WHERE IT IS:
--   · the table lives in keystone_meta beside backup_run and alert_state, NO tenant column, NO grant
--     to any application role. app_rw cannot read it — a practice's staff must never see platform
--     facts — and app_worker keeps ZERO table rights (p21a_role_matrix §3, 0127's "a QUEUE identity,
--     not a data identity").
--   · WRITE: `keystone_meta.record_platform_event()`, SECURITY DEFINER owned by app_owner (the table's
--     owner; the table has no RLS, so 0129's auth_owner trap does not arise), EXECUTE to app_worker
--     only. The 0127/0128 shape.
--   · READ: `keystone.platform_list_platform_events()`, SECURITY DEFINER, `WHERE
--     keystone.caller_is_platform()` — the gate 0018 built for platform_list_tenants, evaluated by the
--     database on every call, copied exactly. EXECUTE to app_rw only (the Platform route runs on
--     app_rw inside the platform tenant's context); any other context gets zero rows.
--
-- ★★ WRITERS:
--   · health.check_failed / health.check_recovered — src/health/alerts.mjs, from the verdict
--     `alert_transition()` already computes, in the SAME transaction (so a failed alert email rolls
--     the fact back with the alert row, and the retry records it exactly once). alert_transition is
--     replaced below to return 'repeat' for a 60-minute reminder — before this, a reminder and a NEW
--     problem both returned 'alert', and a reminder is not a new failure.
--   · backup.verified / backup.failed — an AFTER INSERT trigger on keystone_meta.backup_run.
--     CHOICE, STATED: the backup scripts (infra/backup/backup-offsite.sh, scripts/backup.sh) write
--     backup_run as a superuser connection, and a row there IS the outcome. Deriving the fact from
--     the row in the database means every writer of backup_run — both scripts, the nightly and the
--     weekly restore test — produces it without a second psql call that could be forgotten or fail
--     separately. Facts are ids, counts, booleans and a timestamp; the free-text `note`, the
--     `target` and the `destination` URL never travel.
--     ★ A nightly run that dies BEFORE writing backup_run records nothing here — that silence is
--       caught by the backup health check going stale → health.check_failed(backup).
--   · job.gave_up — src/health/platformEvents.mjs exports `recordJobGaveUp`; the outbox dispatcher
--     (Stage 3 Task 5) calls it when a listener reaches `dead`.
--
-- ★ `facts` obeys the event payload rule (§2.4/§12) — enforced in JS by the SAME validator emit()
--   uses (src/events/outbox.mjs assertSafePayload, imported). The database holds it to a JSON object.

CREATE TABLE keystone_meta.platform_event (
  id          bigserial   PRIMARY KEY,
  kind        text        NOT NULL CONSTRAINT platform_event_kind_check CHECK (kind IN (
                'health.check_failed', 'health.check_recovered',
                'backup.verified', 'backup.failed',
                'job.gave_up')),
  -- ★ An enum-shaped token (`check:outbox`, `backup_run:42`, `listener:notifications`) — never text.
  subject     text        NOT NULL CONSTRAINT platform_event_subject_check CHECK (subject ~ '^[A-Za-z0-9_.:-]{1,100}$'),
  facts       jsonb       NOT NULL DEFAULT '{}'::jsonb CONSTRAINT platform_event_facts_check CHECK (jsonb_typeof(facts) = 'object'),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX platform_event_recent ON keystone_meta.platform_event (created_at DESC, id DESC);
REVOKE ALL ON keystone_meta.platform_event FROM PUBLIC;
REVOKE ALL ON SEQUENCE keystone_meta.platform_event_id_seq FROM PUBLIC;

COMMENT ON TABLE keystone_meta.platform_event IS
  'Stage 3 Task 6 / spec 02 §2.11 — facts about the platform itself (health, backups, jobs giving up). No tenant. Written only through keystone_meta.record_platform_event() (EXECUTE app_worker) and the backup_run trigger; read only through keystone.platform_list_platform_events() (gated on caller_is_platform()). No application role holds any grant on this table.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- WRITE — VOLATILE (it inserts; 0130's lesson is that the declaration must say what the body does).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE FUNCTION keystone_meta.record_platform_event(p_kind text, p_subject text, p_facts jsonb)
RETURNS bigint
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, keystone_meta AS $$
  INSERT INTO keystone_meta.platform_event (kind, subject, facts)
  VALUES (p_kind, p_subject, coalesce(p_facts, '{}'::jsonb))
  RETURNING id;
$$;
REVOKE ALL ON FUNCTION keystone_meta.record_platform_event(text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone_meta.record_platform_event(text, text, jsonb) TO app_worker;
GRANT USAGE ON SCHEMA keystone_meta TO app_worker;

COMMENT ON FUNCTION keystone_meta.record_platform_event(text, text, jsonb) IS
  'Stage 3 Task 6 — the only application write path into keystone_meta.platform_event. EXECUTE to app_worker only; the worker holds no table rights. Callers go through src/health/platformEvents.mjs, which validates facts with the event payload rule first.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- HEALTH — alert_transition now tells a reminder ('repeat') from a new problem ('alert').
-- Same signature, so CREATE OR REPLACE keeps the OID, the owner and the app_worker EXECUTE grant.
-- Behaviour of alert_state is byte-for-byte what 0128 did; only the returned word changes.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION keystone_meta.alert_transition(p_key text, p_state text, p_repeat_minutes int)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, keystone_meta AS $$
DECLARE prev keystone_meta.alert_state%ROWTYPE;
BEGIN
  SELECT * INTO prev FROM keystone_meta.alert_state WHERE key = p_key FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO keystone_meta.alert_state (key, state, last_sent_at) VALUES
      (p_key, p_state, CASE WHEN p_state = 'problem' THEN now() END);
    RETURN CASE WHEN p_state = 'problem' THEN 'alert' ELSE 'quiet' END;
  END IF;
  IF p_state = 'problem' THEN
    IF prev.state <> 'problem' OR prev.last_sent_at IS NULL
       OR prev.last_sent_at < now() - make_interval(mins => p_repeat_minutes) THEN
      UPDATE keystone_meta.alert_state SET state = 'problem', last_sent_at = now(),
             changed_at = CASE WHEN prev.state <> 'problem' THEN now() ELSE prev.changed_at END
       WHERE key = p_key;
      -- ★ Stage 3 Task 6: a problem that was ALREADY a problem is a reminder, not a new failure.
      RETURN CASE WHEN prev.state <> 'problem' THEN 'alert' ELSE 'repeat' END;
    END IF;
    RETURN 'quiet';
  END IF;
  UPDATE keystone_meta.alert_state SET state = p_state, changed_at = now() WHERE key = p_key AND state <> p_state;
  RETURN CASE WHEN prev.state = 'problem' AND p_state = 'ok' THEN 'recovered' ELSE 'quiet' END;
END $$;
REVOKE ALL ON FUNCTION keystone_meta.alert_transition(text, text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone_meta.alert_transition(text, text, int) TO app_worker;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- BACKUP — every backup_run row becomes backup.verified or backup.failed.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE FUNCTION keystone_meta.backup_run_records_platform_event()
RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, keystone_meta AS $$
BEGIN
  INSERT INTO keystone_meta.platform_event (kind, subject, facts)
  VALUES (
    CASE WHEN NEW.verified THEN 'backup.verified' ELSE 'backup.failed' END,
    'backup_run:' || NEW.id,
    jsonb_build_object(
      'backup_run_id',       NEW.id,
      'verified',            NEW.verified,
      'dump_bytes',          NEW.dump_bytes,
      'object_count',        NEW.object_count,
      'off_site',            NEW.destination IS NOT NULL AND NEW.destination !~ '^local:',
      'weekly_restore_test', NEW.target LIKE '% (weekly restore test)',
      'finished_at',         NEW.finished_at));
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION keystone_meta.backup_run_records_platform_event() FROM PUBLIC;

CREATE TRIGGER backup_run_platform_event
  AFTER INSERT ON keystone_meta.backup_run
  FOR EACH ROW EXECUTE FUNCTION keystone_meta.backup_run_records_platform_event();

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- READ — the Platform lister. Gate copied from 0018 exactly: `WHERE keystone.caller_is_platform()`.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE FUNCTION keystone.platform_list_platform_events(p_limit integer DEFAULT 50)
RETURNS TABLE (id bigint, kind text, subject text, facts jsonb, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT e.id, e.kind, e.subject, e.facts, e.created_at
    FROM keystone_meta.platform_event e
   -- ★★★ THE GATE. A non-platform context — or no context at all — yields zero rows.
   WHERE keystone.caller_is_platform()
   ORDER BY e.created_at DESC, e.id DESC
   LIMIT greatest(1, least(coalesce(p_limit, 50), 500))
$$;
REVOKE ALL ON FUNCTION keystone.platform_list_platform_events(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.platform_list_platform_events(integer) TO app_rw;

COMMENT ON FUNCTION keystone.platform_list_platform_events(integer) IS
  'Stage 3 Task 6 — platform facts for /api/platform/health. Gated on caller_is_platform() exactly as platform_list_tenants() (0018): any other tenant context returns zero rows. Facts are ids, enums, counts and timestamps only.';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- ★★ PROVE IT, IN THE MIGRATION, IN BOTH DIRECTIONS. A grant nobody has seen refuse is not installed.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE r text; c text; bad text[] := '{}';
BEGIN
  -- NEGATIVE: no application role holds ANY table privilege on platform_event.
  FOREACH r IN ARRAY ARRAY['app_rw','app_worker','app_embed','app_signup'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN CONTINUE; END IF;
    FOREACH c IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'] LOOP
      IF has_table_privilege(r, 'keystone_meta.platform_event', c) THEN bad := bad || (r || ':' || c); END IF;
    END LOOP;
  END LOOP;
  IF cardinality(bad) > 0 THEN
    RAISE EXCEPTION 'platform_event is reachable directly: % — app_rw must never read platform facts and app_worker holds zero table rights', bad;
  END IF;

  -- The writer: app_worker yes (POSITIVE), app_rw / app_embed / app_signup no.
  IF NOT has_function_privilege('app_worker', 'keystone_meta.record_platform_event(text,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'app_worker cannot EXECUTE record_platform_event — nothing in the worker could record a platform fact';
  END IF;
  IF has_function_privilege('app_rw', 'keystone_meta.record_platform_event(text,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'app_rw can EXECUTE record_platform_event — a web process could forge a platform fact';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_embed')
     AND has_function_privilege('app_embed', 'keystone_meta.record_platform_event(text,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'app_embed can EXECUTE record_platform_event';
  END IF;

  -- The lister: app_rw yes (POSITIVE), app_worker no.
  IF NOT has_function_privilege('app_rw', 'keystone.platform_list_platform_events(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'app_rw cannot EXECUTE platform_list_platform_events — the Platform route could not read anything';
  END IF;
  IF has_function_privilege('app_worker', 'keystone.platform_list_platform_events(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'app_worker can EXECUTE platform_list_platform_events';
  END IF;

  -- No PUBLIC EXECUTE on any of the three new definers.
  IF EXISTS (SELECT 1 FROM pg_proc p
              WHERE p.oid IN ('keystone_meta.record_platform_event(text,text,jsonb)'::regprocedure,
                              'keystone_meta.backup_run_records_platform_event()'::regprocedure,
                              'keystone.platform_list_platform_events(integer)'::regprocedure)
                AND (p.proacl IS NULL OR EXISTS (SELECT 1 FROM unnest(p.proacl) a WHERE a::text LIKE '=%'))) THEN
    RAISE EXCEPTION 'a platform_event definer is EXECUTE to PUBLIC';
  END IF;
END $$;

-- ★★ POSITIVE CONTROLS THAT RUN THE BODIES: the writer, the trigger, and the lister's gate.
--   The lister proof needs a platform tenant; 0018's bootstrap pattern (NO FORCE for the bootstrap,
--   restored in the same transaction, asserted) is reused when this database has none.
ALTER TABLE keystone.tenant NO FORCE ROW LEVEL SECURITY;

DO $$
DECLARE v_id bigint; v_run bigint; n integer; v_platform uuid; v_other uuid; created boolean := false;
BEGIN
  -- writer
  v_id := keystone_meta.record_platform_event('health.check_failed', 'check:m0138_probe', '{"check":"m0138_probe"}'::jsonb);
  IF NOT EXISTS (SELECT 1 FROM keystone_meta.platform_event WHERE id = v_id) THEN
    RAISE EXCEPTION 'record_platform_event returned % but no row exists', v_id;
  END IF;
  -- the kind list is enforced
  BEGIN
    PERFORM keystone_meta.record_platform_event('health.exploded', 'check:x', '{}'::jsonb);
    RAISE EXCEPTION 'an unknown kind was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- trigger
  INSERT INTO keystone_meta.backup_run (started_at, target, dump_bytes, object_count, verified, destination, note)
  VALUES (now(), 'm0138 probe', 1, 1, true, 'local: probe', 'm0138 probe') RETURNING id INTO v_run;
  SELECT count(*) INTO n FROM keystone_meta.platform_event
   WHERE kind = 'backup.verified' AND subject = 'backup_run:' || v_run AND (facts->>'backup_run_id')::bigint = v_run
     AND facts->>'off_site' = 'false' AND NOT facts ? 'note';
  IF n <> 1 THEN RAISE EXCEPTION 'the backup_run trigger wrote % backup.verified row(s) for run %, expected 1', n, v_run; END IF;

  -- lister gate
  SELECT id INTO v_platform FROM keystone.tenant WHERE is_platform;
  IF v_platform IS NULL THEN
    INSERT INTO keystone.tenant (slug, name, timezone, status, is_platform)
    VALUES ('m0138-platform-probe', 'Migration 0138 probe', 'UTC', 'active', true)
    RETURNING id INTO v_platform;
    created := true;
  END IF;
  SELECT id INTO v_other FROM keystone.tenant WHERE NOT is_platform LIMIT 1;

  PERFORM set_config('keystone.tenant_id', v_platform::text, true);
  SELECT count(*) INTO n FROM keystone.platform_list_platform_events(500) WHERE id = v_id;
  IF n <> 1 THEN RAISE EXCEPTION 'platform_list_platform_events() does not show the probe row from the PLATFORM context'; END IF;

  IF v_other IS NOT NULL THEN
    PERFORM set_config('keystone.tenant_id', v_other::text, true);
    SELECT count(*) INTO n FROM keystone.platform_list_platform_events(500);
    IF n <> 0 THEN RAISE EXCEPTION 'platform_list_platform_events() returned % row(s) to a NON-platform tenant', n; END IF;
  ELSE
    RAISE NOTICE 'no non-platform tenant exists on this database; the non-platform leg is proven by the no-context leg and test/s3_platform_event.test.mjs';
  END IF;

  PERFORM set_config('keystone.tenant_id', '', true);
  SELECT count(*) INTO n FROM keystone.platform_list_platform_events(500);
  IF n <> 0 THEN RAISE EXCEPTION 'platform_list_platform_events() returned % row(s) with NO tenant context', n; END IF;

  -- tidy the probes: they are proofs, not facts
  DELETE FROM keystone_meta.platform_event WHERE id = v_id OR subject = 'backup_run:' || v_run;
  DELETE FROM keystone_meta.backup_run WHERE id = v_run;
  IF created THEN DELETE FROM keystone.tenant WHERE id = v_platform; END IF;
  RAISE NOTICE 'platform_event: writer, backup trigger and lister gate proven in both directions';
END $$;

ALTER TABLE keystone.tenant FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'keystone.tenant'::regclass) THEN
    RAISE EXCEPTION 'FORCE ROW LEVEL SECURITY was not restored on keystone.tenant';
  END IF;
END $$;
