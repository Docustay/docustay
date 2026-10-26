-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0195 — A REASON FOLLOWS THE RECORD IT IS ABOUT. (Stage 7 task 7.16.)
--
-- ★★★ WHAT THIS FIXES. `keystone.record_reason` (0140:51-66) has exactly one predicate on its
--     `tenant_isolation` policy — the tenant. Carried from Stage 3: "record_reason is protected
--     from clients by routing only — viewer-aware RLS must cover it." [MEASURED] the only two
--     readers are `src/records/queries.mjs:742` (`ACTIVITY_SQL`, the staff record page's History)
--     and `src/audit/queries.mjs:131` (the admin audit log) — both a `LEFT JOIN … ON rr.event_id =
--     activity.id`, and `src/records/queries.mjs:716-719`'s own comment states the protection is
--     ROUTING ("this SQL is read ONLY by the STAFF record route … a client's own activity read
--     does not join this table"), not a boundary. A Coach who can see a client's archive EVENT
--     (the event itself carries no viewer predicate of its own) sees the typed reason for it too,
--     regardless of whether they may see that client at all.
--
-- ★★ THE FIX. `tenant_isolation` gains a second conjunct — `keystone.reason_is_visible(subject_type,
--    subject_id)` — resolving the subject_type through the same object/owner correspondence
--    `src/permissions/ownership.mjs`'s `OWNERSHIP` / `permissionObjectFor` states for the reads, and
--    asking `keystone.user_may()` (0192) whether THIS viewer may `view` that object owned by THAT
--    owner. The nine subject types this table ever holds are exactly `ARCHIVABLE`'s keys
--    (`src/records/archive.mjs:31-40`) — the same nine `ACTIVITY_SUBJECT`
--    (`src/records/queries.mjs:748-753`) reads — and two of them do NOT share their subject_type's
--    own name with the permission object OWNERSHIP files them under:
--      · 'booking' rides on OWNERSHIP['engagement'] (booking is the TABLE, engagement is the OBJECT
--        — `ownerExpr`'s own comment at ownership.mjs:200-213 names this exact confusion).
--      · 'service' rides on OWNERSHIP['item'] (the practice catalogue, un-ownable).
--      · 'subscription' rides on OWNERSHIP['subscription'].ridesOn = 'invoice' (permissionObjectFor
--        resolves it there).
--    A PL/pgSQL function cannot import ownership.mjs, so the CASE below restates that same mapping
--    in SQL — one function reads it, `db/gates/p1_ownership.mjs` (P1.4's own gate) is what keeps
--    the JS side honest against the live catalog, and nothing in THIS migration touches either.
--
-- ★★★ 'plan' HAS NO ENTRY. [MEASURED against src/permissions/ownership.mjs] `OWNERSHIP` has no
--     `plan` key at all — `permissionObjectFor('plan')` would throw in JS. A subject type this
--     function does not recognise returns **false**, not true, and never reaches `user_may()`:
--     `user_may` (0192) RAISES on an object that is not a real `keystone.permission_object` row, so
--     passing it a bogus object string would turn every read of an unmapped reason into a 500,
--     which is the wrong failure for a read path. Returning false directly is the safe direction —
--     a reason nobody can read until somebody maps `plan`, never a reason everybody can read
--     because nobody mapped it — and it is silent, not loud, on purpose: a *reason* going dark on
--     one archived plan is not the kind of gap `user_may`'s typo guard exists to surface loudly.
--
-- ★★ WHO SUPPLIES THE CONDITION. `keystone.current_user_id()` reads the `keystone.user_id` GUC set
--    at `src/db/index.mjs:115` on every request — the application, not a test fixture.
--    `src/events/reasons.mjs:44`'s INSERT runs in the SAME transaction with the SAME GUC, under the
--    SEPARATE `tenant_insert` policy (`FOR INSERT WITH CHECK (tenant_id = require_tenant_id())`,
--    0140:53-54, untouched by this migration) — an INSERT is admitted by tenant_insert's OR-branch
--    alone, so this migration does not touch what a write may do. Stated explicitly because an
--    INSERT policy that silently started failing would lose reasons without an error, and this one
--    does not.
--
-- ★ NOT MARKED `-- keystone:one-way` — reversible by a forward migration that restores the single
--   tenant predicate, same reasoning 0189/0193 give for their own reversible drops.
-- ★ NO SECRET, NO EMAIL, NO DISPLAY NAME IS READ OR PRINTED. NOTICEs carry counts only.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- ── §a · PRECONDITIONS ──────────────────────────────────────────────────────────────────────────
DO $preconditions$
BEGIN
  IF current_user <> 'app_owner' THEN
    RAISE EXCEPTION '0195: must run as app_owner (db/migrate.mjs:317 sets it), running as %', current_user;
  END IF;

  IF to_regclass('keystone.record_reason') IS NULL THEN
    RAISE EXCEPTION '0195: keystone.record_reason does not exist';
  END IF;

  IF to_regprocedure('keystone.reason_is_visible(text, uuid)') IS NOT NULL THEN
    RAISE EXCEPTION '0195: keystone.reason_is_visible(text, uuid) already exists — changed by hand? refusing to guess';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy
                  WHERE polrelid = 'keystone.record_reason'::regclass AND polname = 'tenant_isolation') THEN
    RAISE EXCEPTION '0195: keystone.record_reason carries no tenant_isolation policy to replace';
  END IF;
END
$preconditions$;

-- ── §b · keystone.reason_is_visible(text, uuid) — the viewer-aware predicate ───────────────────
CREATE FUNCTION keystone.reason_is_visible(p_subject_type text, p_subject_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_object text;
  v_owner  uuid;
BEGIN
  -- ★★★ THE SAME NINE KEYS `ARCHIVABLE` (src/records/archive.mjs:31-40) AND `ACTIVITY_SUBJECT`
  --     (src/records/queries.mjs:748-753) EVER WRITE — mapped to the permission OBJECT
  --     `src/permissions/ownership.mjs`'s OWNERSHIP/permissionObjectFor pair resolves each key to,
  --     and to the SQL that reads that object's owner column. See the header for 'booking' →
  --     'engagement', 'service' → 'item', 'subscription' → (rides on) 'invoice'.
  CASE p_subject_type
    WHEN 'person' THEN
      v_object := 'person';
      SELECT u.owner_user_id INTO v_owner FROM keystone.app_user u WHERE u.id = p_subject_id;

    WHEN 'account' THEN
      v_object := 'account';
      SELECT a.owner_user_id INTO v_owner FROM keystone.account a WHERE a.id = p_subject_id;

    WHEN 'network_party' THEN
      -- ★ OWNERSHIP['network_party'].ownable = false — practice-wide; `user_may` only ever admits
      --   `everything` (or refuses) for it, so there is no owner column to read.
      v_object := 'network_party';
      v_owner  := NULL;

    WHEN 'booking' THEN
      -- ★★ OWNERSHIP FILES THIS UNDER 'engagement', NOT 'booking' — 'booking' is the TABLE, and
      --    permissionObjectFor('engagement') resolves to itself. ownerColumn is 'host_id', NOT NULL.
      v_object := 'engagement';
      SELECT b.host_id INTO v_owner FROM keystone.booking b WHERE b.id = p_subject_id;

    WHEN 'invoice' THEN
      -- ★ OWNERSHIP['invoice'].ownerVia: payer_user_id → app_user.owner_user_id.
      v_object := 'invoice';
      SELECT u.owner_user_id INTO v_owner
        FROM keystone.invoice i JOIN keystone.app_user u ON u.id = i.payer_user_id
       WHERE i.id = p_subject_id;

    WHEN 'service' THEN
      -- ★ OWNERSHIP FILES THIS UNDER 'item' (the catalogue, un-ownable) — 'service' is the TABLE.
      v_object := 'item';
      v_owner  := NULL;

    WHEN 'subscription' THEN
      -- ★ OWNERSHIP['subscription'].ridesOn = 'invoice' (permissionObjectFor resolves it there);
      --   ownerVia: app_user_id → app_user.owner_user_id.
      v_object := 'invoice';
      SELECT u.owner_user_id INTO v_owner
        FROM keystone.subscription s JOIN keystone.app_user u ON u.id = s.app_user_id
       WHERE s.id = p_subject_id;

    WHEN 'document' THEN
      -- ★ OWNERSHIP['document'].ownerVia: subject_user_id → app_user.owner_user_id.
      v_object := 'document';
      SELECT u.owner_user_id INTO v_owner
        FROM keystone.document_instance d JOIN keystone.app_user u ON u.id = d.subject_user_id
       WHERE d.id = p_subject_id;

    ELSE
      -- ★★★ AN UNMAPPED SUBJECT TYPE (e.g. 'plan' — OWNERSHIP has no entry for it at all) RETURNS
      --     FALSE, NOT TRUE, AND NEVER REACHES user_may(). Passing it a p_object string that names
      --     no keystone.permission_object row would make user_may (0192) RAISE — the right behaviour
      --     for a typo in application code, the wrong one for a read policy. Fails in the safe
      --     direction: a reason nobody can read until somebody maps it, never a reason everybody can
      --     read because nobody mapped it.
      RETURN false;
  END CASE;

  RETURN keystone.user_may(keystone.current_user_id(), v_object, 'view', v_owner);
END
$fn$;

REVOKE ALL ON FUNCTION keystone.reason_is_visible(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.reason_is_visible(text, uuid) TO app_rw, app_owner;

COMMENT ON FUNCTION keystone.reason_is_visible(text, uuid) IS
  'Stage 7 task 7.16. The viewer-aware half of keystone.record_reason''s tenant_isolation policy. '
  'Maps subject_type (ARCHIVABLE''s nine keys) to the permission object and owner column '
  'src/permissions/ownership.mjs''s OWNERSHIP/permissionObjectFor pair resolves the reads through, '
  'then asks keystone.user_may(current_user_id(), object, ''view'', owner). An unmapped subject_type '
  '(''plan'' — OWNERSHIP has no entry for it) returns false directly, never reaching user_may, which '
  'would RAISE on an unknown object (0192). SECURITY DEFINER + empty search_path, same shape as '
  'keystone.document_is_visible (0120) and keystone.viewer_may_read_audit (0183).';

-- ── §c · THE POLICY — tenant_isolation gains the second conjunct ───────────────────────────────
DROP POLICY tenant_isolation ON keystone.record_reason;

CREATE POLICY tenant_isolation ON keystone.record_reason
  USING (tenant_id = keystone.current_tenant_id()
         AND keystone.reason_is_visible(subject_type, subject_id));

-- ── §d · SELF-CHECK, PART 1 — THE CATALOG SHAPE THIS FILE CLAIMS ───────────────────────────────
DO $shape_check$
DECLARE
  r record;
  n integer;
BEGIN
  SELECT p.prosecdef, pg_catalog.pg_get_userbyid(p.proowner) AS owner,
         (p.proconfig IS NOT NULL AND EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE left(c, 12) = 'search_path=')) AS has_search_path,
         p.proacl IS NULL AS acl_null
    INTO r
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'keystone' AND p.proname = 'reason_is_visible';
  IF NOT FOUND THEN
    RAISE EXCEPTION '0195: keystone.reason_is_visible(text, uuid) was not created';
  END IF;
  IF NOT r.prosecdef THEN
    RAISE EXCEPTION '0195: keystone.reason_is_visible is not SECURITY DEFINER';
  END IF;
  IF NOT r.has_search_path THEN
    RAISE EXCEPTION '0195: keystone.reason_is_visible has no pinned search_path — hijackable (0120''s lesson)';
  END IF;
  IF r.acl_null THEN
    RAISE EXCEPTION '0195: keystone.reason_is_visible has a NULL proacl — that is EXECUTE TO PUBLIC by default (0021''s lesson), not "app_rw/app_owner only"';
  END IF;

  -- ── exactly the three named policies remain, tenant_isolation now referencing the new function ──
  SELECT count(*) INTO n FROM pg_catalog.pg_policies
   WHERE schemaname = 'keystone' AND tablename = 'record_reason';
  IF n <> 3 THEN
    RAISE EXCEPTION '0195: keystone.record_reason carries % policies, not the 3 named (tenant_isolation, tenant_insert, tenant_update)', n;
  END IF;

  SELECT qual INTO r FROM pg_catalog.pg_policies
   WHERE schemaname = 'keystone' AND tablename = 'record_reason' AND policyname = 'tenant_isolation';
  IF r.qual !~ 'reason_is_visible' THEN
    RAISE EXCEPTION '0195: record_reason''s tenant_isolation policy does not mention reason_is_visible: %', r.qual;
  END IF;

  -- ── app_rw's grants are UNCHANGED — still SELECT + INSERT only, never UPDATE/DELETE (0140) ────
  IF NOT (pg_catalog.has_table_privilege('app_rw', 'keystone.record_reason', 'SELECT')
          AND pg_catalog.has_table_privilege('app_rw', 'keystone.record_reason', 'INSERT')) THEN
    RAISE EXCEPTION '0195: app_rw lost SELECT or INSERT on keystone.record_reason';
  END IF;
  IF pg_catalog.has_table_privilege('app_rw', 'keystone.record_reason', 'UPDATE')
     OR pg_catalog.has_table_privilege('app_rw', 'keystone.record_reason', 'DELETE') THEN
    RAISE EXCEPTION '0195: app_rw gained UPDATE or DELETE on keystone.record_reason — it must stay append-only';
  END IF;

  RAISE NOTICE '0195: keystone.reason_is_visible is SECURITY DEFINER, search_path pinned, EXECUTE limited to app_rw/app_owner; record_reason still carries exactly 3 policies, tenant_isolation now reads reason_is_visible; app_rw''s grants are unchanged.';
END
$shape_check$;

-- ── §e · SELF-CHECK, PART 2 — A FABRICATED VIEWER, FUNCTIONALLY, WITH A POSITIVE CONTROL ───────
-- ★★★ A viewer with NO grant on the subject sees 0 rows; the SAME viewer, holding a grant that
--     covers the subject, sees 1 — the positive control this migration must not ship without.
--     Everything fabricated here is deleted at the end of this block; nothing survives the
--     migration. Modelled on 0021:61-82's probe-tenant-and-delete shape.
--
-- ★★ F490 FIX [MEASURED 22 Sep 2026]: `keystone.tenant` is FORCE RLS (`0001:151-152`) with no
--    INSERT policy `app_owner` (NOBYPASSRLS — `scripts/bootstrap-roles.mjs:247`) can satisfy — the
--    bare `INSERT INTO keystone.tenant` below was refused with "new row violates row-level security
--    policy for table tenant" on EVERY execution, unexercised until now. `0018:113-120,169-179`
--    established the house pattern for exactly this — suspend FORCE for the bootstrap, act, restore
--    it IN THE SAME TRANSACTION, and ASSERT it came back — so this probe now brackets itself the
--    same way, rather than inventing a second pattern.
ALTER TABLE keystone.tenant NO FORCE ROW LEVEL SECURITY;

DO $reason_visibility_check$
DECLARE
  v_tenant       uuid;
  v_viewer_none  uuid;  -- staff, holds NO role at all
  v_viewer_grant uuid;  -- staff, holds a role granting person:view:owned, and owns v_person
  v_person       uuid;  -- the fabricated client — the record_reason subject
  v_role_id      uuid;
  v_event        uuid;
  v_seen         integer;
BEGIN
  INSERT INTO keystone.tenant (slug, name, timezone, status)
  VALUES ('m0195-probe', 'M0195 probe', 'UTC', 'active') RETURNING id INTO v_tenant;

  PERFORM set_config('keystone.tenant_id', v_tenant::text, true);
  IF keystone.current_tenant_id() IS DISTINCT FROM v_tenant THEN
    RAISE EXCEPTION '0195: the tenant context did not take effect for the probe tenant';
  END IF;

  INSERT INTO keystone.app_user (tenant_id, email, display_name, role, staff_role)
  VALUES (v_tenant, 'm0195-none@example.invalid', 'M0195 no grant', 'staff', 'coach')
  RETURNING id INTO v_viewer_none;

  INSERT INTO keystone.app_user (tenant_id, email, display_name, role, staff_role)
  VALUES (v_tenant, 'm0195-grant@example.invalid', 'M0195 grant', 'staff', 'coach')
  RETURNING id INTO v_viewer_grant;

  -- ★ The subject: a client owned by v_viewer_grant, NOT by v_viewer_none.
  INSERT INTO keystone.app_user (tenant_id, email, display_name, role, owner_user_id)
  VALUES (v_tenant, 'm0195-client@example.invalid', 'M0195 client', 'adult_client', v_viewer_grant)
  RETURNING id INTO v_person;

  INSERT INTO keystone.role (tenant_id, key, label, is_builtin)
  VALUES (v_tenant, 'm0195_probe_role', 'M0195 probe role', false) RETURNING id INTO v_role_id;

  INSERT INTO keystone.role_permission (tenant_id, role_id, object, verb, scope)
  VALUES (v_tenant, v_role_id, 'person', 'view', 'owned');

  -- ★ v_viewer_grant holds the role; v_viewer_none holds nothing — that is the whole experiment.
  INSERT INTO keystone.user_role (tenant_id, user_id, role_id, granted_by)
  VALUES (v_tenant, v_viewer_grant, v_role_id, v_viewer_grant);

  INSERT INTO keystone.event (tenant_id, topic, emitted_by, subject_type, subject_id, payload)
  VALUES (v_tenant, 'people.person.archived', 'people', 'person', v_person, '{}'::jsonb)
  RETURNING id INTO v_event;

  -- ★ Admitted by tenant_insert (tenant match only) regardless of reason_is_visible — see the header.
  INSERT INTO keystone.record_reason (tenant_id, event_id, subject_type, subject_id, kind, reason, created_by)
  VALUES (v_tenant, v_event, 'person', v_person, 'archive', 'm0195 probe reason', v_viewer_grant);

  -- ── the viewer with NO grant on this subject: 0 rows ─────────────────────────────────────────
  PERFORM set_config('keystone.user_id', v_viewer_none::text, true);
  SELECT count(*) INTO v_seen FROM keystone.record_reason WHERE event_id = v_event;
  IF v_seen <> 0 THEN
    RAISE EXCEPTION '0195: a viewer holding no grant on the subject saw % record_reason row(s), expected 0', v_seen;
  END IF;

  -- ── POSITIVE CONTROL, same viewer identity, now holding person:view:owned AND owning the
  --    subject: 1 row ────────────────────────────────────────────────────────────────────────
  PERFORM set_config('keystone.user_id', v_viewer_grant::text, true);
  SELECT count(*) INTO v_seen FROM keystone.record_reason WHERE event_id = v_event;
  IF v_seen <> 1 THEN
    RAISE EXCEPTION '0195: the viewer holding person:view:owned, and owning the subject, saw % record_reason row(s), expected 1', v_seen;
  END IF;

  -- ── cleanup — v_viewer_grant can still see every row it made, so it does the deleting ────────
  DELETE FROM keystone.record_reason WHERE tenant_id = v_tenant;
  PERFORM set_config('keystone.user_id', '', true);
  DELETE FROM keystone.event WHERE tenant_id = v_tenant;
  DELETE FROM keystone.user_role WHERE tenant_id = v_tenant;
  DELETE FROM keystone.role_permission WHERE tenant_id = v_tenant;
  DELETE FROM keystone.role WHERE tenant_id = v_tenant;
  DELETE FROM keystone.app_user WHERE tenant_id = v_tenant;
  PERFORM set_config('keystone.tenant_id', '', true);
  DELETE FROM keystone.tenant WHERE id = v_tenant;

  RAISE NOTICE '0195: a viewer with no grant on the subject saw 0 record_reason row(s); the same identity, holding person:view:owned and owning the subject, saw 1 (positive control). Probe tenant % removed.', v_tenant;
END
$reason_visibility_check$;

ALTER TABLE keystone.tenant FORCE ROW LEVEL SECURITY;

-- ★★ PROVE FORCE IS BACK ON — 0018's own reasoning, verbatim: leaving it off would silently disable
--    tenant isolation on the root table of the whole schema, and every later migration and gate
--    would still pass.
DO $$
DECLARE forced boolean;
BEGIN
  SELECT relforcerowsecurity INTO forced FROM pg_class WHERE oid = 'keystone.tenant'::regclass;
  IF NOT forced THEN
    RAISE EXCEPTION '0195: FORCE ROW LEVEL SECURITY was not restored on keystone.tenant';
  END IF;
END $$;
