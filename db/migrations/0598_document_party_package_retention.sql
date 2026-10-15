-- 0598 · PARTY SNAPSHOTS, PACKAGES, AND A SIGNED RECORD THAT OUTLIVES ITS PERSON (QUEUE §23 Part 3: 23.3.2, 23.3.6, 23.4.15). See specs/proofs/part-3/AUDIT.md §4 for every decision here.
--
--  1. `document_party` — the island's OWN snapshot of each person on a send (name, email, role, order, per-person expiry, consent facts), written at send, so a signed record stands alone.
--     `external_ref` is the host's person id, kept as an OPAQUE value with NO foreign key.
--  2. A PACKAGE (several documents in one send) is the LEAD instance plus members: `package_lead_id` + `package_position` on `document_instance` (NULL on every existing one-document send).
--     `custom_values` carries per-send merge values supplied by the API or a CSV (`custom.<key>` fields).
--  3. `document_instance.subject_user_id` ON DELETE CASCADE → SET NULL: deleting a person can no longer delete a signed document. (Unsigned documents of that person are deleted by the island's own
--     prepare step in the same transaction; signed ones are detached and keep their party snapshot.)
--  4. THE RETENTION GUARD, at the database: an EXECUTED instrument cannot be deleted while it is inside its retention window — retention unset means indefinite — EVEN WITH the audited
--     `record_delete_reason`. After the window the audited reason still works. A person's detach (subject_user_id → NULL) is the one change an executed instrument accepts, and only under that reason.
-- ★ Additive except the one FK action. Row-level security FORCED; the backfill runs one practice at a time (0543 / 0592 / 0595 pattern).

CREATE TABLE keystone.document_party (
  id            uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id     uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  instance_id   uuid        NOT NULL REFERENCES keystone.document_instance(id) ON DELETE CASCADE,   -- the LEAD instance of the send
  role          text        NOT NULL CHECK (role IN ('pir','parent','coach','client','consultant','familyMember','recipient')),
  action_role   text        NOT NULL DEFAULT 'signer' CHECK (action_role IN ('signer','approver','viewer','cc','assistant')),
  position      integer     NOT NULL DEFAULT 1 CHECK (position >= 1),          -- recipients may SHARE a position and act in parallel
  name          text        NOT NULL CHECK (length(btrim(name)) > 0),
  email         text        NULL,
  phone         text        NULL,
  external_ref  uuid        NULL,                                              -- the host's person id: opaque, no foreign key
  expires_at    timestamptz NULL,                                              -- per-recipient deadline (5B); NULL = the document's own
  reminder_days integer[]   NULL,                                              -- per-recipient reminder schedule (5B); NULL = the practice's
  consent_version    text        NULL,
  consented_at       timestamptz NULL,
  consent_ip         text        NULL,
  consent_user_agent text        NULL,
  status        text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','viewed','signed','approved','rejected','declined','bounced')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX document_party_by_instance ON keystone.document_party (tenant_id, instance_id, position);
CREATE INDEX document_party_by_ref ON keystone.document_party (tenant_id, external_ref) WHERE external_ref IS NOT NULL;
ALTER TABLE keystone.document_party ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.document_party FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keystone.document_party USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert    ON keystone.document_party FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update    ON keystone.document_party FOR UPDATE USING (tenant_id = keystone.current_tenant_id()) WITH CHECK (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_delete    ON keystone.document_party FOR DELETE USING (tenant_id = keystone.current_tenant_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.document_party TO app_rw;
GRANT SELECT ON keystone.document_party TO app_worker;

-- who a party IS cannot change once the document is executed (status, consent and expiry facts may still be recorded)
CREATE FUNCTION keystone.document_party_identity_is_frozen() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF (NEW.name IS DISTINCT FROM OLD.name OR NEW.email IS DISTINCT FROM OLD.email OR NEW.phone IS DISTINCT FROM OLD.phone OR NEW.role IS DISTINCT FROM OLD.role
      OR NEW.action_role IS DISTINCT FROM OLD.action_role OR NEW.position IS DISTINCT FROM OLD.position OR NEW.external_ref IS DISTINCT FROM OLD.external_ref OR NEW.instance_id IS DISTINCT FROM OLD.instance_id)
     AND EXISTS (SELECT 1 FROM keystone.document_instance i WHERE i.id = OLD.instance_id AND i.state IN ('executed','declined')) THEN
    RAISE EXCEPTION 'a party on an executed or declined document cannot be changed — the name, email and role are what the record says about who signed (U25)' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER document_party_identity_frozen BEFORE UPDATE ON keystone.document_party FOR EACH ROW EXECUTE FUNCTION keystone.document_party_identity_is_frozen();

-- packages + per-send custom values
ALTER TABLE keystone.document_instance
  ADD COLUMN package_lead_id  uuid    NULL REFERENCES keystone.document_instance(id),
  ADD COLUMN package_position integer NULL,
  ADD COLUMN custom_values    jsonb   NULL CHECK (custom_values IS NULL OR jsonb_typeof(custom_values) = 'object'),
  ADD CONSTRAINT document_instance_package_shape CHECK ((package_lead_id IS NULL) = (package_position IS NULL) AND (package_position IS NULL OR package_position >= 2));
CREATE INDEX document_instance_by_package_lead ON keystone.document_instance (tenant_id, package_lead_id) WHERE package_lead_id IS NOT NULL;

-- a person's delete detaches their signed documents instead of deleting them
ALTER TABLE keystone.document_instance DROP CONSTRAINT document_instance_subject_user_id_fkey;
ALTER TABLE keystone.document_instance ADD CONSTRAINT document_instance_subject_user_id_fkey
  FOREIGN KEY (subject_user_id) REFERENCES keystone.app_user(id) ON DELETE SET NULL;

-- is an executed instrument still inside its retention window? (unset retention = indefinite = always)
CREATE FUNCTION keystone.document_is_retained(p_tenant uuid, p_state text, p_executed_at timestamptz) RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT p_state = 'executed' AND (
    (SELECT nullif(value #>> '{}', '')::int FROM keystone.document_setting WHERE tenant_id = p_tenant AND key = 'retention_years') IS NULL
    OR p_executed_at + ((SELECT nullif(value #>> '{}', '')::int FROM keystone.document_setting WHERE tenant_id = p_tenant AND key = 'retention_years') * interval '1 year') > now())
$$;
GRANT EXECUTE ON FUNCTION keystone.document_is_retained(uuid, text, timestamptz) TO app_rw, app_worker;

CREATE OR REPLACE FUNCTION keystone.document_instance_terminal_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
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
END $$;

-- the one change an executed/declined instrument accepts: a person's detach (subject_user_id → NULL), and only under the audited delete reason
CREATE OR REPLACE FUNCTION keystone.document_instance_terminal_is_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  changed text[] := ARRAY[]::text[];
  detaching boolean := (OLD.subject_user_id IS NOT NULL AND NEW.subject_user_id IS NULL
                        AND nullif(btrim(coalesce(current_setting('keystone.record_delete_reason', true), '')), '') IS NOT NULL);
BEGIN
  IF OLD.state NOT IN ('executed', 'declined') THEN RETURN NEW; END IF;
  IF NEW.template_snapshot::text IS DISTINCT FROM OLD.template_snapshot::text THEN changed := changed || 'template_snapshot'::text; END IF;
  IF NEW.executed_at     IS DISTINCT FROM OLD.executed_at     THEN changed := changed || 'executed_at'::text; END IF;
  IF NEW.state           IS DISTINCT FROM OLD.state           THEN changed := changed || 'state'::text; END IF;
  IF NEW.builder         IS DISTINCT FROM OLD.builder         THEN changed := changed || 'builder'::text; END IF;
  IF NEW.title           IS DISTINCT FROM OLD.title           THEN changed := changed || 'title'::text; END IF;
  IF NEW.type_id         IS DISTINCT FROM OLD.type_id         THEN changed := changed || 'type_id'::text; END IF;
  IF NEW.template_id     IS DISTINCT FROM OLD.template_id     THEN changed := changed || 'template_id'::text; END IF;
  IF NEW.subject_user_id IS DISTINCT FROM OLD.subject_user_id AND NOT detaching THEN changed := changed || 'subject_user_id'::text; END IF;
  IF NEW.sent_at         IS DISTINCT FROM OLD.sent_at         THEN changed := changed || 'sent_at'::text; END IF;
  IF NEW.assigned_to     IS DISTINCT FROM OLD.assigned_to     THEN changed := changed || 'assigned_to'::text; END IF;
  IF NEW.archived_at     IS DISTINCT FROM OLD.archived_at     THEN changed := changed || 'archived_at'::text; END IF;
  IF NEW.package_lead_id IS DISTINCT FROM OLD.package_lead_id THEN changed := changed || 'package_lead_id'::text; END IF;
  IF array_length(changed, 1) > 0 THEN
    RAISE EXCEPTION 'this instrument is % and cannot be changed (U25). Attempted to alter: %. The snapshot exists so that what a person signed cannot change afterwards — a mutable snapshot is no snapshot at all. To correct an executed instrument, VOID it and issue a new one; to withdraw one, void it rather than flagging it deleted.', OLD.state, array_to_string(changed, ', ') USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- backfill: every signature on file gets a party snapshot (name from the signature, email from the person row at migration time) — so the executed documents that exist today stand alone too
DO $backfill$
DECLARE
  v_ids uuid[]; v_id uuid; i integer;
BEGIN
  SET LOCAL ROLE auth_owner;
  SELECT coalesce(array_agg(id), '{}') INTO v_ids FROM keystone.tenant;
  SET LOCAL ROLE app_owner;
  FOR i IN 1 .. coalesce(array_length(v_ids, 1), 0) LOOP
    v_id := v_ids[i];
    PERFORM set_config('keystone.tenant_id', v_id::text, true);
    INSERT INTO keystone.document_party (tenant_id, instance_id, role, position, name, email, external_ref, status, consent_version, consented_at, consent_ip, consent_user_agent)
    SELECT sr.tenant_id, sr.instance_id, sr.role, sr.signer_order, sr.signer_name, pd.email, sr.signer_uid, 'signed',
           acc.version, acc.accepted_at, acc.accepted_ip, acc.user_agent
      FROM keystone.signature_record sr
      LEFT JOIN keystone.app_user pd ON pd.id = sr.signer_uid
      LEFT JOIN LATERAL (SELECT a.version, a.accepted_at, a.accepted_ip, a.user_agent FROM keystone.esign_disclosure_acceptance a
                          WHERE a.app_user_id = sr.signer_uid AND a.accepted_at <= sr.signed_at ORDER BY a.accepted_at DESC LIMIT 1) acc ON true
     WHERE sr.tenant_id = v_id;
  END LOOP;
  PERFORM set_config('keystone.tenant_id', '', true);
END $backfill$;
