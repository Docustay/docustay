-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0140 — A REASON IS KEPT ON THE RECORD, NOT IN THE EVENT (Stage 3 Task 3, fix round 1, ruling R46).
--
-- ★★★ WHY THIS TABLE EXISTS. Spec 02 §2 rule 4 (ruled 17 Sep 2026): an event payload carries ids and
--     safe facts ONLY — never typed text. Task 3 enforced that inside `emit()`, and in doing so DROPPED
--     three typed reasons that had only ever lived in the event payload:
--       · archive      — `records/archive.mjs` archiveRecord      (ArchiveControl: "Why are you archiving this?")
--       · decline      — `documents/writes.mjs` declineInstance   (MOCKUPS: "Declined: reason captured")
--       · stage_change — `people/writes.mjs` setLifecycleStatus    (PersonActions: the stage reason)
--     The served staff app still ASKS for all three. An input that writes nothing is a defect in this
--     project, so the reason moves here: a row beside the event, joined on `event_id`, read back only
--     by STAFF surfaces (History, the audit log) — never by `/api/app/*`, and never delivered to an
--     outbound webhook, because it is not in the payload.
--
-- ★★ APPEND-ONLY BY PRIVILEGE. app_rw gets SELECT and INSERT and nothing else: a reason records why
--    somebody did something at a moment, and editing or deleting it afterwards would rewrite that
--    moment. The same privilege-layer rule `p21a_role_matrix` asserts for signature_record.
--
-- ★ `created_by` is the SESSION actor (routes/writes.mjs stamps `actorUserId` after spreading the
--   body — F494), never a body field. NULL only for a system actor.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS keystone.record_reason (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  -- ★★ RESTRICT, NEVER CASCADE (controller ruling, fix round 2 — the never-delete rule). A reason is the
  --    record of a staff decision (why a client was archived, why a document was declined). Stage 4 plans
  --    pruning of processed events; a cascade would silently delete these records the day that ships.
  --    An event that carries a reason cannot be deleted; fixture cleanup deletes its OWN reasons first.
  event_id     uuid        NOT NULL REFERENCES keystone.event(id) ON DELETE RESTRICT,
  subject_type text        NOT NULL,
  subject_id   uuid        NOT NULL,
  kind         text        NOT NULL CHECK (kind IN ('archive', 'decline', 'stage_change')),
  reason       text        NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 500),
  created_by   uuid        REFERENCES keystone.app_user(id) ON DELETE SET NULL,   -- same as guardian.created_by (0074)
  created_at   timestamptz NOT NULL DEFAULT now(),
  -- ★ One reason per event. LEADS WITH tenant_id (catalog-conformance): a uniqueness check bypasses
  --   RLS, so an index led by event_id alone would leak another practice's event ids via the violation.
  CONSTRAINT record_reason_one_per_event UNIQUE (tenant_id, event_id)
);

CREATE INDEX IF NOT EXISTS record_reason_subject_idx
  ON keystone.record_reason (tenant_id, subject_type, subject_id);

COMMENT ON TABLE keystone.record_reason IS
  'Stage 3 Task 3 fix 1 (R46). The typed reason a staff member gave for an archive, a document decline or a '
  'stage change. Kept here, joined to keystone.event on event_id, because §2.4 forbids typed text in event '
  'payloads. Staff-only reads (History, audit log); never returned by /api/app/*. Append-only: app_rw may '
  'SELECT and INSERT, never UPDATE or DELETE.';

ALTER TABLE keystone.record_reason ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.record_reason FORCE  ROW LEVEL SECURITY;

-- ★ The full tenant set, copied from keystone.task (tenant_isolation · tenant_insert · tenant_update).
--   tenant_update is present so the table carries the same three policies as every other tenant table;
--   it is inert for app_rw, which is not granted UPDATE.
CREATE POLICY tenant_isolation ON keystone.record_reason
  USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert ON keystone.record_reason
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update ON keystone.record_reason
  FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
             WITH CHECK (tenant_id = keystone.require_tenant_id());

-- ★★ SELECT and INSERT only. No UPDATE, no DELETE — see the header.
GRANT SELECT, INSERT ON keystone.record_reason TO app_rw;

-- ★ Self-check: the shape this file claims is the shape the catalog now holds.
DO $record_reason_check$
DECLARE
  v_rls   boolean;
  v_force boolean;
  v_owner text;
BEGIN
  SELECT c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner)
    INTO v_rls, v_force, v_owner
    FROM pg_class c WHERE c.oid = 'keystone.record_reason'::regclass;
  IF NOT (v_rls AND v_force) THEN
    RAISE EXCEPTION '0140: record_reason must have RLS enabled AND forced (rls=%, force=%)', v_rls, v_force;
  END IF;
  IF v_owner <> 'app_owner' THEN
    RAISE EXCEPTION '0140: record_reason must be owned by app_owner, got %', v_owner;
  END IF;
  IF has_table_privilege('app_rw', 'keystone.record_reason', 'UPDATE')
     OR has_table_privilege('app_rw', 'keystone.record_reason', 'DELETE') THEN
    RAISE EXCEPTION '0140: app_rw must not hold UPDATE or DELETE on record_reason';
  END IF;
  IF NOT (has_table_privilege('app_rw', 'keystone.record_reason', 'SELECT')
          AND has_table_privilege('app_rw', 'keystone.record_reason', 'INSERT')) THEN
    RAISE EXCEPTION '0140: app_rw must hold SELECT and INSERT on record_reason';
  END IF;
END
$record_reason_check$;
