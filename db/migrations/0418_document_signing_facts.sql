-- 0418_document_signing_facts
--
-- Stage 14 task 14.11 — the certificate's facts get columns, and a real client (or token signer) can
-- move an instrument to `executed`.
--
-- [MEASURED, task field 3] `document_instance` today carries `tenant_isolation`, `staff_write`,
-- `signer_marks_partially_signed` (0119), `system_expiry_read`/`system_expiry` (0112), `staff_delete`,
-- `task_subject_probe_read`, `reference_guard_read` — and there is NO policy letting a client-role
-- viewer set `state = 'executed'`, so `executeInstance` from a real client session fails RLS today.
--
-- ★★★ DOCUMENTS-AS-INSTRUMENTS: this migration moves a STATE COLUMN, never a term. Price, the frozen
-- `template_snapshot` (0009:151) and the ESIGN disclosure version were already frozen at SEND
-- (0053/0032) and are untouched here. `signer_marks_executed` below can only be reached from
-- `partially_signed`, so an already-`executed` row can never be matched by its USING clause again —
-- the one-way move enforced structurally, the same discipline as `signer_marks_partially_signed`
-- (0119) before it.
--
-- CT-F52 — THE NEW-TENANT-TABLE CHECKLIST, all eight points, for the one new table
-- (`keystone.document_open`). Shape copied from `0417_document_clauses_and_template_columns.sql`
-- (this stage's own most recent precedent) and `0402_booking_block.sql`. The mandatory EXECUTE
-- lend/give-back for `refuse_touch_reference_rows` is copied verbatim from `0402:29-46`
-- (CONTRACTS.md CT-F52 point 4b, corrected).
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §a · PRECONDITIONS — must run as app_owner; the tables/columns this migration touches must exist;
-- nothing it is about to create may already exist.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $preconditions$
BEGIN
  IF current_user <> 'app_owner' THEN
    RAISE EXCEPTION '0418: must run as app_owner (db/migrate.mjs), running as %', current_user;
  END IF;

  IF to_regclass('keystone.document_instance') IS NULL THEN
    RAISE EXCEPTION '0418: keystone.document_instance does not exist';
  END IF;
  IF to_regclass('keystone.signature_record') IS NULL THEN
    RAISE EXCEPTION '0418: keystone.signature_record does not exist';
  END IF;
  IF to_regclass('keystone.document_type') IS NULL THEN
    RAISE EXCEPTION '0418: keystone.document_type does not exist';
  END IF;

  IF to_regclass('keystone.document_open') IS NOT NULL THEN
    RAISE EXCEPTION '0418: keystone.document_open already exists';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE (table_schema, table_name, column_name) IN (
       ('keystone','document_instance','declined_at'),
       ('keystone','document_instance','next_reminder_at'),
       ('keystone','document_instance','reminders_sent')
     )
  ) THEN
    RAISE EXCEPTION '0418: at least one of the columns this migration adds to document_instance already exists — check for a duplicate run';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'keystone' AND table_name = 'signature_record' AND column_name = 'mark_image'
  ) THEN
    RAISE EXCEPTION '0418: keystone.signature_record.mark_image already exists — check for a duplicate run';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'keystone' AND tablename = 'document_instance'
     AND policyname IN ('signer_marks_executed','system_reminder_read','system_reminder_write')
  ) THEN
    RAISE EXCEPTION '0418: at least one of the policies this migration adds to document_instance already exists';
  END IF;

  IF to_regprocedure('keystone.signer_order_for(text)') IS NOT NULL THEN
    RAISE EXCEPTION '0418: keystone.signer_order_for(text) already exists';
  END IF;
END
$preconditions$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §A — keystone.document_instance ADD COLUMN: when it was declined, when the reminder job may next
-- touch it, and how many reminders have gone out (capped — a runaway sweep cannot mail forever).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
ALTER TABLE keystone.document_instance
  ADD COLUMN declined_at      timestamptz NULL,
  ADD COLUMN next_reminder_at timestamptz NULL,
  ADD COLUMN reminders_sent   integer     NOT NULL DEFAULT 0 CHECK (reminders_sent BETWEEN 0 AND 10);

COMMENT ON COLUMN keystone.document_instance.declined_at IS
  '14.11 — when a signer declined the instrument.';
COMMENT ON COLUMN keystone.document_instance.next_reminder_at IS
  '14.11 — earliest instant the reminder sweep may next act on this instrument; read by system_reminder_read/system_reminder_write.';
COMMENT ON COLUMN keystone.document_instance.reminders_sent IS
  '14.11 — capped 0-10 so a stuck sweep cannot mail a signer forever.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §B — keystone.signature_record ADD COLUMN mark_image: the drawn signature "held with this record",
-- as a data URL (PNG only, 200 KiB cap). Its sha256 already lives in mark_sha256 (0036) — this is the
-- bytes themselves, not a second fact about them, and nothing from the blocked list (DOB, sobriety
-- date, recovery fields, notes, emergency contact, consent detail, guardian relationship) is added.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
ALTER TABLE keystone.signature_record
  ADD COLUMN mark_image text NULL CHECK (
    mark_image IS NULL OR (
      mark_image LIKE 'data:image/png;base64,%' AND length(mark_image) <= 204800
    )
  );

COMMENT ON COLUMN keystone.signature_record.mark_image IS
  '14.11 — the drawn signature mark itself (data:image/png;base64,... , <=200KiB), held alongside its sha256 digest (mark_sha256, 0036). signature_record is append-only (0036''s no-update/no-delete triggers), so this never changes once written.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §C — keystone.signer_order_for(text) — mirrors src/documents/vocabulary.mjs's SIGNER_CONFIGS,
-- including the twelfth configuration CLIENT_AND_PARENT added by 0417 (task 14.10) to
-- document_type_signer_config_check. IMMUTABLE: a pure lookup over a closed, literal vocabulary, no
-- table read. Used by signer_marks_executed's WITH CHECK below to count how many signature_record
-- rows an instrument NEEDS before a signer may move it to executed.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE FUNCTION keystone.signer_order_for(p_signer_config text)
  RETURNS text[]
  LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE p_signer_config
    WHEN 'PIR_ONLY'              THEN ARRAY['pir']
    WHEN 'COACH_ONLY'            THEN ARRAY['coach']
    WHEN 'CO_SIGNED'             THEN ARRAY['pir','coach']
    WHEN 'PARENT_ONLY'           THEN ARRAY['parent']
    WHEN 'PARENT_AND_COACH'      THEN ARRAY['parent','coach']
    WHEN 'PIR_PARENT_COACH'      THEN ARRAY['parent','pir','coach']
    WHEN 'CLIENT_ONLY'           THEN ARRAY['client']
    WHEN 'CLIENT_AND_CONSULTANT' THEN ARRAY['client','consultant']
    WHEN 'FAMILY_MEMBER_ONLY'    THEN ARRAY['familyMember']
    WHEN 'RECIPIENT_ONLY'        THEN ARRAY['recipient']
    WHEN 'RECIPIENT_AND_COACH'   THEN ARRAY['recipient','coach']
    WHEN 'CLIENT_AND_PARENT'     THEN ARRAY['client','parent']
    ELSE NULL
  END;
$$;

COMMENT ON FUNCTION keystone.signer_order_for(text) IS
  '14.11 (0418) — mirrors src/documents/vocabulary.mjs SIGNER_CONFIGS, the 12 configurations'' party arrays in signing order. The p6 vocabulary gate is extended in task 14.15 to compare this function against the JS object, the same way it already compares document_type_signer_config_check.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §D — POLICY signer_marks_executed ON document_instance. The signer's execute: a client-role viewer
-- who can already see a partially_signed instrument may move it to executed, but ONLY once every
-- signature the type's signer_config requires is on record. One row short is refused (WITH CHECK
-- fails, RLS error). `executed` was staff-only through 0119; this adds the signer's own path without
-- widening `staff_write` or touching `signer_marks_partially_signed`.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE POLICY signer_marks_executed ON keystone.document_instance
  FOR UPDATE
  USING (tenant_id = keystone.current_tenant_id()
         AND keystone.document_is_visible(document_instance.*)
         AND state = 'partially_signed'
         AND archived_at IS NULL
         AND EXISTS (SELECT 1 FROM keystone.app_user u
                      WHERE u.id = keystone.current_user_id()
                        AND u.role IN ('adult_client','adolescent_client','parent')))
  WITH CHECK (tenant_id = keystone.current_tenant_id()
              AND state = 'executed'
              AND (SELECT count(*) FROM keystone.signature_record s
                    WHERE s.instance_id = document_instance.id)
                  = (SELECT cardinality(keystone.signer_order_for(t.signer_config))
                       FROM keystone.document_type t WHERE t.id = document_instance.type_id));

COMMENT ON POLICY signer_marks_executed ON keystone.document_instance IS
  '14.11 (0418). The signer''s execute: partially_signed -> executed, permitted only once signature_record holds one row per party the type''s signer_config requires. Reachable only from partially_signed, so an already-executed instrument can never be matched by this policy''s USING clause again.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §E — POLICIES for the reminder sweep (null user), mirroring system_expiry_read/system_expiry
-- (0112) verbatim in shape: an unviewered caller may see and move only sent/partially_signed rows
-- whose next_reminder_at is due, and may only touch that column set (state stays put; this is a
-- read-then-mark cycle, not a state transition).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE POLICY system_reminder_read ON keystone.document_instance
  FOR SELECT
  USING (tenant_id = keystone.current_tenant_id()
         AND keystone.current_user_id() IS NULL
         AND state IN ('sent','partially_signed')
         AND next_reminder_at IS NOT NULL
         AND next_reminder_at <= now()
         AND archived_at IS NULL);

CREATE POLICY system_reminder_write ON keystone.document_instance
  FOR UPDATE
  USING (tenant_id = keystone.current_tenant_id()
         AND keystone.current_user_id() IS NULL
         AND state IN ('sent','partially_signed')
         AND next_reminder_at IS NOT NULL
         AND next_reminder_at <= now()
         AND archived_at IS NULL)
  WITH CHECK (tenant_id = keystone.current_tenant_id()
              AND state IN ('sent','partially_signed'));

COMMENT ON POLICY system_reminder_read ON keystone.document_instance IS
  '14.11 (0418). Mirrors system_expiry_read (0112) in shape: exposes only due sent/partially_signed instruments to an unviewered caller (the reminder sweep), nothing else.';
COMMENT ON POLICY system_reminder_write ON keystone.document_instance IS
  '14.11 (0418). The ONLY write the reminder sweep may make: state stays in (sent, partially_signed) — it advances next_reminder_at/reminders_sent, never the state itself.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §F — keystone.document_open (§0.4 A shape, no touch trigger, append-only; app_rw SELECT/INSERT
-- only). Each row is one open of an instrument, for the certificate's "opened" fact.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE keystone.document_open (
  id          uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id   uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  instance_id uuid        NOT NULL REFERENCES keystone.document_instance(id) ON DELETE CASCADE,
  opened_by   uuid        NULL REFERENCES keystone.app_user(id) ON DELETE SET NULL,
  ip          text        NULL,
  user_agent  text        NULL,
  opened_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX document_open_instance_idx ON keystone.document_open (tenant_id, instance_id, opened_at);

ALTER TABLE keystone.document_open ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.document_open FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keystone.document_open USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert    ON keystone.document_open FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
-- No tenant_update, no tenant_delete: document_open is append-only (SELECT/INSERT grant only, below).

GRANT SELECT, INSERT ON keystone.document_open TO app_rw;

-- ═══ CT-F52 §3.2 points (3)(4)(5) — THE REFERENCE-PRACTICE GUARD HALF ═══════════════════════════
-- ★★★ THE EXECUTE LEND IS NOT OPTIONAL. `keystone.refuse_touch_reference_rows()` is owned by
--     `reference_guard` (0144:245) and 0099:83 revoked ALL on it FROM PUBLIC. 0151:91-110 verbatim.
SET LOCAL ROLE reference_guard;
GRANT EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() TO app_owner;
SET LOCAL ROLE app_owner;

CREATE TRIGGER document_open_refuse_reference_delete_trg AFTER DELETE ON keystone.document_open
  REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT
  EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.document_open ENABLE ALWAYS TRIGGER document_open_refuse_reference_delete_trg;
CREATE TRIGGER document_open_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.document_open
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.document_open ENABLE ALWAYS TRIGGER document_open_refuse_reference_truncate_trg;

SET LOCAL ROLE reference_guard;
REVOKE EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() FROM app_owner;
SET LOCAL ROLE app_owner;

GRANT SELECT ON keystone.document_open TO reference_guard;
CREATE POLICY reference_guard_read ON keystone.document_open FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));

-- ═══ CT-F52 §3.2 point (6) — THE SELF-CHECK, WITH POSITIVE CONTROLS ═══════════════════════════════
DO $ct_f52_self_check$
DECLARE n int; v_arr text[];
BEGIN
  -- ── keystone.document_open ────────────────────────────────────────────────────────────────────
  IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'keystone.document_open'::regclass) THEN
    RAISE EXCEPTION '0418 — keystone.document_open is not FORCE ROW LEVEL SECURITY';
  END IF;

  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'keystone' AND tablename = 'document_open'
     AND policyname IN ('tenant_isolation','tenant_insert','reference_guard_read');
  IF n <> 3 THEN
    RAISE EXCEPTION '0418 — expected 3 policies on document_open, found %', n;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='keystone'
              AND tablename='document_open' AND policyname IN ('tenant_update','tenant_delete')) THEN
    RAISE EXCEPTION '0418 — document_open has an update/delete policy but no update/delete grant (append-only); remove one or the other';
  END IF;

  SELECT count(*) INTO n FROM pg_trigger
   WHERE tgrelid = 'keystone.document_open'::regclass
     AND tgname IN ('document_open_refuse_reference_delete_trg','document_open_refuse_reference_truncate_trg')
     AND tgenabled = 'A';
  IF n <> 2 THEN
    RAISE EXCEPTION '0418 — both refuse_touch_reference_rows triggers must exist and be ENABLE ALWAYS on document_open, found %', n;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
     WHERE polrelid = 'keystone.document_open'::regclass
       AND polname = 'reference_guard_read'
       AND polroles = ARRAY['reference_guard'::regrole::oid]
       AND polcmd = 'r'
       AND polpermissive
  ) THEN
    RAISE EXCEPTION '0418 — reference_guard_read on document_open must be TO reference_guard ONLY, FOR SELECT, PERMISSIVE (CT-F52 point 4b)';
  END IF;

  IF has_function_privilege('app_owner', 'keystone.refuse_touch_reference_rows()', 'EXECUTE') THEN
    RAISE EXCEPTION '0418: app_owner still holds EXECUTE on keystone.refuse_touch_reference_rows() — the lend was not revoked';
  END IF;

  -- ★ Positive controls, in the same block.
  IF NOT has_table_privilege('app_rw', 'keystone.document_open', 'SELECT') THEN
    RAISE EXCEPTION '0418 — app_rw is missing SELECT on document_open';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.document_open', 'INSERT') THEN
    RAISE EXCEPTION '0418 — app_rw is missing INSERT on document_open';
  END IF;
  IF NOT has_table_privilege('reference_guard', 'keystone.document_open', 'SELECT') THEN
    RAISE EXCEPTION '0418 — reference_guard has no SELECT on document_open; its policy would have nothing underneath it';
  END IF;
  IF has_table_privilege('app_rw', 'keystone.document_open', 'UPDATE') THEN
    RAISE EXCEPTION '0418 — app_rw must NOT hold UPDATE on document_open (append-only)';
  END IF;
  IF has_table_privilege('app_rw', 'keystone.document_open', 'DELETE') THEN
    RAISE EXCEPTION '0418 — app_rw must NOT hold DELETE on document_open (append-only)';
  END IF;

  -- ── keystone.document_instance — new columns, shape + grant inheritance ─────────────────────────
  IF (SELECT count(*)
        FROM information_schema.columns
       WHERE table_schema = 'keystone' AND table_name = 'document_instance'
         AND column_name IN ('declined_at','next_reminder_at','reminders_sent')
     ) <> 3 THEN
    RAISE EXCEPTION '0418 — one or more document_instance columns did not get added';
  END IF;
  -- Positive control: the table-level grant (0009) reaches the new column.
  IF NOT has_column_privilege('app_rw', 'keystone.document_instance', 'reminders_sent', 'UPDATE') THEN
    RAISE EXCEPTION '0418 — app_rw cannot UPDATE keystone.document_instance.reminders_sent — the table-level grant did not extend to the new column';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.document_instance', 'SELECT') THEN
    RAISE EXCEPTION '0418 — app_rw lost SELECT on keystone.document_instance';
  END IF;

  -- ── keystone.document_instance — the three new policies exist with the right command ────────────
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'keystone.document_instance'::regclass
                  AND polname = 'signer_marks_executed' AND polcmd = 'w') THEN
    RAISE EXCEPTION '0418 — signer_marks_executed missing (or not FOR UPDATE) on document_instance';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'keystone.document_instance'::regclass
                  AND polname = 'system_reminder_read' AND polcmd = 'r') THEN
    RAISE EXCEPTION '0418 — system_reminder_read missing (or not FOR SELECT) on document_instance';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'keystone.document_instance'::regclass
                  AND polname = 'system_reminder_write' AND polcmd = 'w') THEN
    RAISE EXCEPTION '0418 — system_reminder_write missing (or not FOR UPDATE) on document_instance';
  END IF;
  -- ★ Positive control: the pre-existing signer_marks_partially_signed policy (0119) was NOT touched.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'keystone'
                  AND tablename = 'document_instance' AND policyname = 'signer_marks_partially_signed') THEN
    RAISE EXCEPTION '0418 — signer_marks_partially_signed (0119) is gone; this migration must not touch it';
  END IF;

  -- ── keystone.signature_record — mark_image column ────────────────────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'keystone'
                  AND table_name = 'signature_record' AND column_name = 'mark_image') THEN
    RAISE EXCEPTION '0418 — keystone.signature_record.mark_image was not added';
  END IF;
  -- ★ Positive control: mark_sha256 (0036) is untouched and still present.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'keystone'
                  AND table_name = 'signature_record' AND column_name = 'mark_sha256') THEN
    RAISE EXCEPTION '0418 — keystone.signature_record.mark_sha256 (0036) is gone; this migration must not touch it';
  END IF;

  -- ── keystone.signer_order_for — the 12 configurations, and a bogus input returns NULL ──────────
  IF to_regprocedure('keystone.signer_order_for(text)') IS NULL THEN
    RAISE EXCEPTION '0418 — keystone.signer_order_for(text) was not created';
  END IF;
  v_arr := keystone.signer_order_for('CLIENT_ONLY');
  IF v_arr IS DISTINCT FROM ARRAY['client'] THEN
    RAISE EXCEPTION '0418 — signer_order_for(CLIENT_ONLY) = %, expected {client}', v_arr;
  END IF;
  v_arr := keystone.signer_order_for('CLIENT_AND_PARENT');
  IF v_arr IS DISTINCT FROM ARRAY['client','parent'] THEN
    RAISE EXCEPTION '0418 — signer_order_for(CLIENT_AND_PARENT) = %, expected {client,parent}', v_arr;
  END IF;
  v_arr := keystone.signer_order_for('PIR_PARENT_COACH');
  IF v_arr IS DISTINCT FROM ARRAY['parent','pir','coach'] THEN
    RAISE EXCEPTION '0418 — signer_order_for(PIR_PARENT_COACH) = %, expected {parent,pir,coach}', v_arr;
  END IF;
  -- ★ Positive control: a real config returns a non-null array (the negative below is meaningful only
  --   because a real one is proven to work first).
  IF keystone.signer_order_for('bogus-not-a-config') IS NOT NULL THEN
    RAISE EXCEPTION '0418 — signer_order_for(bogus) should be NULL for an unrecognised config';
  END IF;
END
$ct_f52_self_check$;

-- Written, not applied.
