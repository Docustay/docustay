-- 0139_each_listener_keeps_its_own_score
-- Stage 3 Task 5 — F475. Spec 02 §2 rules 6 and 8, §12 (poison test, retry schedule, duplicate delivery);
-- spec 07 §3–§4 (1 min, 5 min, 30 min, 2 h, 12 h, then dead).
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ WHY THIS TABLE EXISTS. Until now an event had ONE status, so "the event failed" could not say WHICH
--     listener failed — and the retry re-ran EVERY listener, including the ones that had already sent an
--     email, opened a task or enqueued a webhook (spec §2.6: no double emails, tasks or webhooks).
--     [MEASURED, recon §4] the dispatcher also ran the whole batch in ONE transaction with no savepoints,
--     so a real SQL error in one listener aborted the transaction, markFailed then failed too, and
--     withTenant rolled back every event in the batch.
--
--   ★★ One row per (event, listener). The dispatcher runs each listener in its own SAVEPOINT and records
--      the outcome HERE: `delivered` (or `failed` with the next attempt time from 07's schedule, or
--      `dead` after the sixth attempt). An event is `processed` once every one of its rows is
--      delivered, dead or skipped. A retry re-runs ONLY the rows that are not.
--
--   ★ `listener` is a stable string constant per listener (src/queue/tasks.mjs `LISTENER`), because these
--     rows outlive a deploy: renaming a listener would make every in-flight row point at nothing.
--
--   ★ `last_error` is NEVER a raw message. The dispatcher stores the error class, the SQLSTATE and, for a
--     Postgres error, only catalogue identifiers (constraint/table/column names) — never the message,
--     whose text can quote the failing row's values (`invalid input syntax for type uuid: "…"`, trigger
--     RAISE text) — and for an application error a bounded, redacted message. See `safeErrorText` in
--     src/events/outbox.mjs. The CHECK below bounds the length at the database as well.
--
--   ★ `gave_up_reported_at` — the `job.gave_up` platform event is written through the app_worker-only
--     SECURITY DEFINER writer (0138) on the worker's OWN connection, AFTER the `dead` state commits (the
--     tenant transaction is app_rw and cannot call it). This column is how a report that failed is
--     retried on the next dispatch instead of being lost: a dead row with this column NULL is owed a
--     platform event.
--
--   ★ event_id is ON DELETE CASCADE, and that is deliberate (unlike record_reason's RESTRICT, Stage 3 T3
--     fix 2): a delivery row is BOOKKEEPING about an event, pruned at 30 days by 07's prune_bookkeeping,
--     not a record of a decision. Events themselves are never deleted by the application (spec 07 §3).
--
--   ★ NO reference-practice DELETE/TRUNCATE guard trigger (0099) on this table, same as record_reason
--     (0140): 0099 attached the guard from the catalogue ONCE; bookkeeping rows must remain prunable.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS keystone.event_delivery (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  event_id             uuid        NOT NULL REFERENCES keystone.event(id)  ON DELETE CASCADE,
  listener             text        NOT NULL CHECK (listener ~ '^[a-z][a-z0-9_]{1,62}$'),
  status               text        NOT NULL DEFAULT 'pending'
                                   CHECK (status IN ('pending', 'delivered', 'failed', 'dead', 'skipped')),
  attempts             integer     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at      timestamptz NOT NULL DEFAULT now(),
  last_error           text        CHECK (last_error IS NULL OR char_length(last_error) BETWEEN 1 AND 500),
  delivered_at         timestamptz,
  -- ★ The job a listener handed its work to, when the listener's job is to enqueue (the `webhooks`
  --   listener records 'deliver_webhooks': that job owns the HTTP retries). An identifier, never text.
  handed_off_to        text        CHECK (handed_off_to IS NULL OR handed_off_to ~ '^[a-z][a-z0-9_]{1,62}$'),
  gave_up_reported_at  timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  -- ★ Leads with tenant_id (catalog-conformance check 8).
  CONSTRAINT event_delivery_one_per_listener UNIQUE (tenant_id, event_id, listener),
  -- ★★ Shape: delivered ⇔ a delivery time; failed/dead always say why; only a dead row can be reported.
  CONSTRAINT event_delivery_shape CHECK (
    ((status = 'delivered') = (delivered_at IS NOT NULL))
    AND (status NOT IN ('failed', 'dead') OR last_error IS NOT NULL)
    AND (gave_up_reported_at IS NULL OR status = 'dead')
  )
);

-- ★ Cascade from keystone.event deletes by event_id; the unique index leads with tenant_id and so cannot serve it.
CREATE INDEX IF NOT EXISTS event_delivery_event_idx ON keystone.event_delivery (event_id);
-- ★ The owed-report sweep: dead rows whose job.gave_up has not been written yet.
CREATE INDEX IF NOT EXISTS event_delivery_unreported_dead_idx
  ON keystone.event_delivery (tenant_id) WHERE status = 'dead' AND gave_up_reported_at IS NULL;

COMMENT ON TABLE keystone.event_delivery IS
  'Stage 3 Task 5 (F475). One row per (event, listener): the listener''s own delivered/failed/dead state, '
  'attempts and next attempt time on the 07 schedule (1m, 5m, 30m, 2h, 12h, then dead). A retry re-runs only '
  'rows not yet delivered. last_error holds an error class, SQLSTATE and identifiers only — never client text.';

ALTER TABLE keystone.event_delivery ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.event_delivery FORCE  ROW LEVEL SECURITY;

-- ★ The tenant policy set, copied from keystone.task (0055).
CREATE POLICY tenant_isolation ON keystone.event_delivery
  USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert ON keystone.event_delivery
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update ON keystone.event_delivery
  FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
             WITH CHECK (tenant_id = keystone.require_tenant_id());

-- ★ DELETE for 07's prune_bookkeeping (and p21a_role_matrix: app_rw lacks UPDATE/DELETE only on the
--   declared immutable tables). app_worker gets nothing — it keeps ZERO table rights.
GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.event_delivery TO app_rw;

DO $event_delivery_check$
DECLARE
  v_rls   boolean;
  v_force boolean;
  v_owner text;
  v_pols  integer;
BEGIN
  SELECT c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner)
    INTO v_rls, v_force, v_owner
    FROM pg_class c WHERE c.oid = 'keystone.event_delivery'::regclass;
  IF NOT (v_rls AND v_force) THEN
    RAISE EXCEPTION '0139: event_delivery must have RLS enabled AND forced (rls=%, force=%)', v_rls, v_force;
  END IF;
  IF v_owner <> 'app_owner' THEN
    RAISE EXCEPTION '0139: event_delivery must be owned by app_owner, got %', v_owner;
  END IF;
  SELECT count(*) INTO v_pols FROM pg_policy
   WHERE polrelid = 'keystone.event_delivery'::regclass
     AND polname IN ('tenant_isolation', 'tenant_insert', 'tenant_update');
  IF v_pols <> 3 THEN
    RAISE EXCEPTION '0139: event_delivery must carry the three tenant policies, found %', v_pols;
  END IF;
  IF NOT (has_table_privilege('app_rw', 'keystone.event_delivery', 'SELECT')
          AND has_table_privilege('app_rw', 'keystone.event_delivery', 'INSERT')
          AND has_table_privilege('app_rw', 'keystone.event_delivery', 'UPDATE')) THEN
    RAISE EXCEPTION '0139: app_rw must hold SELECT, INSERT and UPDATE on event_delivery';
  END IF;
  IF has_table_privilege('app_worker', 'keystone.event_delivery', 'SELECT')
     OR has_table_privilege('app_worker', 'keystone.event_delivery', 'INSERT') THEN
    RAISE EXCEPTION '0139: app_worker must hold no rights on event_delivery (two-identity split)';
  END IF;
END
$event_delivery_check$;
