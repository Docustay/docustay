-- 0183_an_audit_log_that_cannot_be_edited
-- Stage 7 task 7.3 · CT-041 (keystone.audit_entry) · CT-042 (AUDIT_ACTIONS, 25) ·
-- CT-043 (writeAudit) · CCR-13 (actor_operator_grant_id + the definer trigger) · Q7-7 (per-action
-- field allowlist) · Q7-8 / CCR-8 / conflict C-3 (the nine "viewed"/compliance actions plus the two
-- Stage 9 `secret.*` actions that have no Stage 7 caller and must ship anyway).
--
-- ★★★ ONE TABLE, APPEND-ONLY, AND THE ACTION VOCABULARY IS DATA THE DATABASE CAN ENFORCE, NOT ONLY
--     A JAVASCRIPT ARRAY. keystone.audit_action is the same argument as 0182 (task 7.2's
--     keystone.permission_object): a frozen set that only JavaScript knows is a set nothing outside
--     JavaScript can check, so it is seeded here, and keystone.audit_entry.action carries a foreign
--     key onto it.
--
-- ★★ TWO DEVIATIONS FROM THE PLAN TEXT, BOTH FORCED BY MIGRATION ORDER, BOTH RECORDED HERE AND IN
--    THE BUILD REPORT RATHER THAN SILENTLY RESOLVED:
--
--    (1) CT-041 gives `actor_operator_grant_id` the type "uuid REFERENCES
--        keystone_auth.operator_grant(id)". keystone_auth.operator_grant does not exist yet — it is
--        task 7.4's table, migration 0184, and 0183 necessarily applies BEFORE 0184 (the migration
--        order this stage's own numbering fixes: 0182 → 0183 → 0184 → …). A FOREIGN KEY constraint
--        is validated against the catalog at ALTER/CREATE time, so writing the REFERENCES clause
--        here would make 0183 itself fail to apply ("relation keystone_auth.operator_grant does not
--        exist"). The column is created here, untyped by a foreign key; nothing downstream in this
--        task's tests or "done" criteria needs the constraint, only the column and the trigger.
--
--    (2) The plan's field 4 says the fill trigger, `keystone.audit_fill_operator_uid()`, is "owned
--        by app_owner". Read literally that cannot work: the function has to SELECT
--        keystone_auth.operator_grant, whose access model (task 7.4, copying keystone_auth.session's
--        shape, 0020) is ENABLE-but-not-FORCE RLS with a `deny_all` policy and NO GRANT to app_rw,
--        app_signup, app_worker, or — as far as either task's plan text says — app_owner. app_owner
--        is a NOINHERIT member of auth_owner (0132's header; restated at 0167:2-4), so it does not
--        pick up auth_owner's ownership bypass just by being a member, and nothing grants app_owner
--        a privilege on that table. A definer function owned by app_owner would raise "permission
--        denied for table operator_grant" (or, if unreachable RLS-wise, read a false NULL) the first
--        time an operator action was audited — exactly the class of defect CLAUDE.md calls out
--        (built and wired to something that cannot actually run). So this migration creates the
--        trigger function owned by auth_owner instead — auth_owner is the actual owner of
--        keystone_auth.operator_grant once 0184 lands (the same shape as keystone_auth.session,
--        0020:107-266, whose four resolvers are all auth_owner-owned for exactly this reason), and a
--        non-FORCE table's owner bypasses its own deny_all policy. LANGUAGE plpgsql matters here too:
--        a plpgsql function body is NOT validated against the catalog at CREATE FUNCTION time (unlike
--        a LANGUAGE sql function), so defining it now, before keystone_auth.operator_grant exists, is
--        safe — it is only resolved the first time the trigger actually fires, by which point 0184
--        has applied (both migrations land in the same combined-stage TEST run).
--
-- ★ Everything else below is CT-041/042/043 and the plan's field 4/6 verbatim.

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 1 · THE FROZEN ACTION VOCABULARY — keystone.audit_action, the database half of AUDIT_ACTIONS.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- ★ Global, not tenant-scoped: this is a vocabulary of VERBS, not a practice's data. RLS still
--   applies (every table in schema keystone carries it, without exception) — the policy below is
--   USING (true) because there is no tenant boundary to draw across 25 static strings, the same
--   justification 0169's link_token_credential_read gives for its own USING (true).
CREATE TABLE keystone.audit_action (
  key text PRIMARY KEY
);

-- ★★★ THE 25, IN THE EXACT ORDER src/permissions/audit.mjs's AUDIT_ACTIONS DECLARES THEM.
--     Order has no meaning to Postgres; it is kept identical to the JS array purely so the two are
--     easy to eyeball against each other, and so the closing DO block's ORDER BY key comparison
--     reads the same list a human would get from opening either file.
--   ★ The last two, secret.key_rotated and secret.key_retired, have NO CALLER IN STAGE 7 — Stage 9
--     task 9.12 is their only writer. They are seeded here anyway: audit_entry_action_fkey is
--     ON DELETE RESTRICT, the set is declared frozen the moment 0183 applies, and there is no later
--     migration that can widen it without re-opening a frozen contract (CT-042 / CONTRACTS §0 C-3).
--     Seeding 23 instead of 25 would make Stage 9's first key rotation fail at run time on a
--     foreign-key violation nobody watching Stage 7 would ever see coming.
INSERT INTO keystone.audit_action (key) VALUES
  ('role.granted'),
  ('role.revoked'),
  ('role.permission_changed'),
  ('staff_role.changed'),
  ('operator.grant_requested'),
  ('operator.grant_approved'),
  ('operator.grant_revoked'),
  ('operator.acted_as'),
  ('session.revoked'),
  ('api_key.minted'),
  ('api_key.revoked'),
  ('webhook.secret_rotated'),
  ('record.archived'),
  ('record.restored'),
  ('note.viewed'),
  ('message.viewed'),
  ('goal.viewed'),
  ('checkin.viewed'),
  ('export.performed'),
  ('settings.changed'),
  ('support.page_viewed'),
  ('invoice.refunded'),
  ('approval.granted'),
  ('secret.key_rotated'),
  ('secret.key_retired');

-- RLS is enabled and FORCED only after the seed above: FORCE ROW LEVEL SECURITY applies to the
-- table owner too, and with only a SELECT policy in place an INSERT run afterwards (even as
-- app_owner, which the migration runner SET ROLEs to) is refused by the row security system
-- before any INSERT policy exists to admit it. Enabling+forcing after the seed keeps the same
-- final state (RLS enabled, forced, SELECT-only policy, no write grant) without that ordering trap
-- — same fix as 0182's keystone.permission_object.
ALTER TABLE keystone.audit_action ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.audit_action FORCE  ROW LEVEL SECURITY;

CREATE POLICY audit_action_read ON keystone.audit_action
  AS PERMISSIVE FOR SELECT USING (true);

GRANT SELECT ON keystone.audit_action TO app_rw;
-- ★ No INSERT, UPDATE or DELETE grant to app_rw or anyone but app_owner (the migration role): the
--   set is frozen by the plan, and the only way to add a member is a migration, same as 0182.

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 2 · THE FILL TRIGGER — CCR-13. Reads keystone_auth.operator_grant; owned by auth_owner. See the
--     ★★ note at the top of this file for why app_owner cannot be the owner here.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
SET LOCAL ROLE auth_owner;

-- ★★★ NOT written by the application, ever (CCR-13). writeAudit (src/permissions/audit.mjs) passes
--     only actor_operator_grant_id — a uuid the application actually holds after task 7.6 — and this
--     BEFORE INSERT trigger is what turns that uuid into the durable, human-readable
--     actor_operator_uid column, from inside the database, before the row is ever visible to a
--     SELECT. The uid never travels through app_rw and is never named in application code.
CREATE FUNCTION keystone.audit_fill_operator_uid()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.actor_operator_grant_id IS NOT NULL THEN
    SELECT g.firebase_uid INTO NEW.actor_operator_uid
      FROM keystone_auth.operator_grant g
     WHERE g.id = NEW.actor_operator_grant_id;

    IF NEW.actor_operator_uid IS NULL THEN
      -- ★ A grant id that names no row is a programming error at the call site (task 7.6/8.x),
      --   not a fact about the world worth recording silently as a NULL actor.
      RAISE EXCEPTION
        'audit_fill_operator_uid: keystone_auth.operator_grant has no row for id %', NEW.actor_operator_grant_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

-- ★ REVOKE ALL, and NO direct GRANT EXECUTE to app_rw or app_owner: this function is reachable only
--   as a trigger, never by name from a SELECT. It still needs EXECUTE for app_owner, the role that
--   is about to CREATE TRIGGER referencing it below — Postgres requires EXECUTE on a function to
--   attach it as a trigger, even though nothing checks EXECUTE again once it is firing.
REVOKE ALL ON FUNCTION keystone.audit_fill_operator_uid() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.audit_fill_operator_uid() TO app_owner;

SET LOCAL ROLE app_owner;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 3 · THE READ GATE — keystone.viewer_may_read_audit(). Field 10: until 7.6 lands,
--     keystone.caller_is_platform() is called EXACTLY as it exists today; only its body changes
--     later, so this function's definition is correct either way.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION keystone.viewer_may_read_audit()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT keystone.user_may(keystone.current_user_id(), 'audit', 'view', NULL)
      OR keystone.caller_is_platform()
$$;

REVOKE ALL ON FUNCTION keystone.viewer_may_read_audit() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.viewer_may_read_audit() TO app_rw, app_owner;

COMMENT ON FUNCTION keystone.viewer_may_read_audit() IS
  'Stage 7 / 0183 (CT-041). True for a staff member holding a role with view on the ownerless "audit"
   object (task 7.2 seeds that object), or for an active operator grant via caller_is_platform().
   SECURITY DEFINER so app_rw can call it from the tenant_isolation policy below without a direct
   grant on keystone.role_permission or keystone.user_role.';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 4 · keystone.audit_entry — CT-041's columns, plus actor_operator_grant_id (CCR-13, see note 1
--     above for why it carries no REFERENCES clause here).
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE keystone.audit_entry (
  id                       uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id                uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  at                       timestamptz NOT NULL DEFAULT now(),
  -- ★ null when the actor is an operator.
  actor_user_id            uuid        REFERENCES keystone.app_user(id),
  -- ★★ NOT written by the application (CCR-13) — filled by the trigger below, from
  --    actor_operator_grant_id, inside the database.
  actor_operator_uid       text,
  -- ★ What the application actually passes (CCR-13). No REFERENCES clause: see note (1) at the top
  --   of this file — keystone_auth.operator_grant does not exist until migration 0184.
  actor_operator_grant_id  uuid,
  action                   text        NOT NULL,
  object                   text        NOT NULL,
  subject_id               uuid,
  -- ★ Never a secret, never PHI — enforced by writeAudit's per-action AUDIT_FIELDS allowlist
  --   (Q7-7), not by anything in this table's shape. A gate cannot see into a jsonb column; the
  --   allowlist is the only place this is actually decided.
  before                   jsonb,
  after                    jsonb,
  -- ★ required for an operator action; writeAudit refuses to insert one without it.
  reason                   text,
  request_id               text,

  CONSTRAINT audit_entry_has_an_actor
    CHECK (actor_user_id IS NOT NULL OR actor_operator_uid IS NOT NULL),
  CONSTRAINT audit_entry_action_fkey FOREIGN KEY (action)
    REFERENCES keystone.audit_action(key) ON DELETE RESTRICT
);

CREATE INDEX audit_entry_tenant_at_idx ON keystone.audit_entry (tenant_id, at DESC);
CREATE INDEX audit_entry_subject_idx   ON keystone.audit_entry (tenant_id, object, subject_id, at DESC);

-- ★★★ THE FILL TRIGGER, ATTACHED. BEFORE INSERT so NEW.actor_operator_uid is set before the
--     audit_entry_has_an_actor CHECK evaluates — an operator row with only actor_operator_grant_id
--     set would otherwise fail that CHECK, because the uid column would still be NULL at CHECK time.
CREATE TRIGGER audit_entry_fill_operator_uid_trg
  BEFORE INSERT ON keystone.audit_entry
  FOR EACH ROW EXECUTE FUNCTION keystone.audit_fill_operator_uid();

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 5 · RLS — ENABLE + FORCE, append-only: INSERT and SELECT policies exist; UPDATE and DELETE do
--     not, deliberately, and neither grant exists either (two independent mechanisms, same idiom
--     as keystone_auth.session's deny_all).
-- ─────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE keystone.audit_entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.audit_entry FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON keystone.audit_entry
  FOR SELECT USING (tenant_id = keystone.current_tenant_id() AND keystone.viewer_may_read_audit());

CREATE POLICY tenant_insert ON keystone.audit_entry
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());

-- No UPDATE policy and no DELETE policy, deliberately — this table has no way to be changed once
-- written, at the database layer, regardless of what application code is ever written against it.

GRANT SELECT, INSERT ON keystone.audit_entry TO app_rw;   -- no UPDATE, no DELETE

COMMENT ON TABLE keystone.audit_entry IS
  'Stage 7 / 0183 (CT-041). Append-only: INSERT and SELECT only, enforced by GRANT (no UPDATE/DELETE
   privilege exists) and by having no UPDATE/DELETE policy either. action is a foreign key onto
   keystone.audit_action, the database half of the 25-member frozen AUDIT_ACTIONS
   (src/permissions/audit.mjs, CT-042). actor_operator_uid is filled by
   keystone.audit_fill_operator_uid(), a BEFORE INSERT trigger — never by the application (CCR-13).
   The one writer is writeAudit (CT-043); the read policy additionally requires
   keystone.viewer_may_read_audit().';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- ★★ PROVE THE CATALOG FACTS THIS MIGRATION CAN GET WRONG SILENTLY, AT APPLY TIME (0017:116-118,
--    0170's closing DO block is the template).
-- ─────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  n integer;
  r record;
BEGIN
  -- ── the 25, seeded ──────────────────────────────────────────────────────────────────────────
  SELECT count(*) INTO n FROM keystone.audit_action;
  IF n <> 25 THEN
    RAISE EXCEPTION '0183: keystone.audit_action holds % rows, not 25 — Stage 9 task 9.12''s key rotation will hit audit_entry_action_fkey if this is short', n;
  END IF;

  -- ── audit_entry: ENABLE + FORCE ─────────────────────────────────────────────────────────────
  SELECT relrowsecurity, relforcerowsecurity INTO r
    FROM pg_catalog.pg_class
   WHERE oid = 'keystone.audit_entry'::regclass;
  IF NOT r.relrowsecurity OR NOT r.relforcerowsecurity THEN
    RAISE EXCEPTION '0183: keystone.audit_entry is not ENABLE+FORCE row-level security (enable=%, force=%)', r.relrowsecurity, r.relforcerowsecurity;
  END IF;

  -- ── exactly two policies: tenant_isolation (SELECT), tenant_insert (INSERT) — no UPDATE/DELETE ──
  SELECT count(*) INTO n FROM pg_catalog.pg_policies
   WHERE schemaname = 'keystone' AND tablename = 'audit_entry';
  IF n <> 2 THEN
    RAISE EXCEPTION '0183: keystone.audit_entry carries % policies, not the 2 named (tenant_isolation, tenant_insert) — an UPDATE or DELETE policy here would break "append-only"', n;
  END IF;

  -- ── app_rw: SELECT + INSERT, and — the negative that matters — NOT UPDATE, NOT DELETE ────────
  IF NOT pg_catalog.has_table_privilege('app_rw', 'keystone.audit_entry', 'SELECT') THEN
    RAISE EXCEPTION '0183: app_rw cannot SELECT keystone.audit_entry — the read side is unreachable';
  END IF;
  IF NOT pg_catalog.has_table_privilege('app_rw', 'keystone.audit_entry', 'INSERT') THEN
    RAISE EXCEPTION '0183: app_rw cannot INSERT keystone.audit_entry — writeAudit could never write a row';
  END IF;
  IF pg_catalog.has_table_privilege('app_rw', 'keystone.audit_entry', 'UPDATE') THEN
    RAISE EXCEPTION '0183: app_rw holds UPDATE on keystone.audit_entry — this table must be append-only';
  END IF;
  IF pg_catalog.has_table_privilege('app_rw', 'keystone.audit_entry', 'DELETE') THEN
    RAISE EXCEPTION '0183: app_rw holds DELETE on keystone.audit_entry — this table must be append-only';
  END IF;

  -- ── the trigger: attached, and its function is auth_owner-owned SECURITY DEFINER with a
  --    non-null ACL and a search_path setting (F482's fingerprint, same check as 0170's) ─────────
  SELECT count(*) INTO n FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
   WHERE c.relname = 'audit_entry' AND t.tgname = 'audit_entry_fill_operator_uid_trg' AND NOT t.tgisinternal;
  IF n <> 1 THEN
    RAISE EXCEPTION '0183: audit_entry_fill_operator_uid_trg is not attached to keystone.audit_entry (found %)', n;
  END IF;

  SELECT pg_catalog.pg_get_userbyid(p.proowner) AS owner, p.prosecdef, p.proacl IS NULL AS acl_null,
         (p.proconfig IS NOT NULL AND EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE left(c, 12) = 'search_path=')) AS has_search_path
    INTO r
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'keystone' AND p.proname = 'audit_fill_operator_uid';
  IF r.owner IS DISTINCT FROM 'auth_owner' THEN
    RAISE EXCEPTION '0183: keystone.audit_fill_operator_uid() is owned by %, not auth_owner — it cannot read keystone_auth.operator_grant (see note 2 at the top of this file)', r.owner;
  END IF;
  IF NOT r.prosecdef THEN
    RAISE EXCEPTION '0183: keystone.audit_fill_operator_uid() is not SECURITY DEFINER';
  END IF;
  IF r.acl_null THEN
    RAISE EXCEPTION '0183: keystone.audit_fill_operator_uid() has a NULL proacl — that is EXECUTE TO PUBLIC, not "no access" (F482)';
  END IF;
  IF NOT r.has_search_path THEN
    RAISE EXCEPTION '0183: keystone.audit_fill_operator_uid() has no search_path setting — a SECURITY DEFINER without one is hijackable';
  END IF;

  RAISE NOTICE '0183: 25 audit_action rows seeded; keystone.audit_entry is ENABLE+FORCE with 2 policies (SELECT+INSERT only, no UPDATE/DELETE grant); the fill trigger is attached and owned by auth_owner';
END $$;
