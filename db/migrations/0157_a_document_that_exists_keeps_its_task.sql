-- 0157_a_document_that_exists_keeps_its_task
-- FINDINGS F527 · Stage 4 Task 8b. The orphan-task sweeper must not close tasks for documents that still exist.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE DEFECT [EXECUTED 18 Sep 2026, task-8-report.md §5; red again in test/s4_orphan_tasks.test.mjs].
--     `keystone.close_tasks_with_missing_subjects()` (0056:138) closes every open task whose
--     `task_subject_exists()` answers FALSE. Its `document` branch (0058:57-58) was
--         SELECT EXISTS (SELECT 1 FROM keystone.document_instance i WHERE i.id = p_subject_id)
--     run as app_rw inside the sweeper's `withTenant` — which has NO VIEWER (0112: a worker has no user).
--     `document_instance`'s SELECT policy is `tenant_id = current_tenant_id() AND document_is_visible(…)`,
--     and `document_is_visible()` fails closed with no viewer. The only viewer-less SELECT policy,
--     `system_expiry_read`, admits sent/expired rows only once `expires_at <= now()`. So a draft, sent,
--     partially signed, executed, declined, void or archived document read as ABSENT, and every task about
--     it — chase_signature first (src/tasks/chains.mjs:78) — was closed as `subject_gone` on the next sweep.
--   ★★ 0056's header already named this trap ("the `document_is_visible()` null-viewer case") and then
--      walked into it for the one type where visibility is viewer-dependent. The other five subject
--      tables (app_user, account, booking, entitlement, run_schedule_item) have tenant-only SELECT
--      policies [MEASURED 18 Sep, pg_policies] — their branches were already asking the right question.
--
-- ★★★ THE RULE. "Is the subject gone?" means "the ROW no longer exists in this practice" — never "a viewer
--     cannot see it". The sweeper has no viewer by design and must not be given one: inventing a viewer
--     (setting keystone.user_id to some staff member) would put a fabricated identity into a transaction,
--     and document_is_visible() would still be answering the wrong question.
--
-- ★★ THE SHAPE — why each piece is there:
--   · A SECURITY DEFINER function returning ONE BOOLEAN: `keystone.document_exists_in_practice(uuid)`.
--     Existence and nothing else can leave it — no title, no state, no party.
--   · ★★★ SECURITY DEFINER ALONE BUYS NOTHING HERE (0008:8-16): document_instance is FORCE row-level
--     security, so an app_owner-owned definer is filtered by the same viewer-dependent policy. And a new
--     policy TO app_owner would be F501 again — PERMISSIVE policies OR together, so EVERY app_owner definer
--     (document_is_visible itself included) would gain viewer-less sight of every document.
--   · So the function is OWNED BY auth_owner, and auth_owner is admitted by a policy of its own —
--     `task_subject_probe_read`, SELECT only, `USING (tenant_id = current_tenant_id())` — i.e. the caller's
--     practice and nothing else. This is the 0017/0152 shape (auth_owner crosses a boundary through a named
--     policy, in the catalogue), NARROWER than those: tenant-scoped rather than USING (true).
--   · ★★ AND auth_owner GETS COLUMN-LEVEL SELECT ON (id, tenant_id) ONLY — never table-level SELECT. So
--     even a future auth_owner function that reached for this table could not read a title, a body, a
--     party or a state: Postgres refuses the column. db/gates/catalog-conformance.mjs check 13 pins BOTH
--     halves: the exact column set, and the allow-list of auth_owner functions whose bodies read this
--     table (exactly this one) — so a second reader is a named red, the F501 shape made visible.
--   · EXECUTE is REVOKEd from PUBLIC (functions are PUBLIC-executable by default — 0044's trap) and granted
--     to app_rw ONLY: the sweeper runs as app_rw (src/queue/tasks.mjs close_orphan_tasks → withTenant →
--     KEYSTONE_DATABASE_URL). Not app_worker, app_embed or app_signup.
--   · auth_owner is also granted EXECUTE on `document_is_visible()`. It changes nothing auth_owner can SEE
--     (that function only reads the row handed to it); it is required because the PUBLIC `tenant_isolation`
--     policy is evaluated for every role, auth_owner included, and Postgres checks EXECUTE on a policy's
--     functions even when another permissive policy already admits the row — the exact failure
--     catalog-conformance 10.7 records for reference_guard.
--   · NULL, never FALSE, when there is no tenant context: "I could not look" (0056's three-valued rule).
--     The sweeper leaves NULL tasks alone and reports them.
--
-- ★★ ARCHIVED DOCUMENTS KEEP THEIR TASKS. An archived document EXISTS: MOCKUPS.md:156 — "Archive, never
--    delete … Archived record = read-only banner 'Archived on {date} by {name}. Nothing was deleted' +
--    Restore." A sweeper that treated archived as gone would close a chase task that Restore cannot bring
--    back. The same holds today for every other subject type (an archived person/account/booking row
--    still answers TRUE), so documents now agree with them. Ending a document's work is the CHAIN's job,
--    by event: chase_signature closes on documents.document.executed / .expired (chains.mjs:78-114).
--    Likewise executed/declined/void documents EXIST — the sweeper checks existence only; "finished" is
--    the chain closers' verdict, not an orphan.
--
-- ★ Runs as app_owner (db/migrate.mjs per-file SET ROLE). The one SET LOCAL ROLE auth_owner (the function
--   must be CREATED as its owner — 0017:65's order) hands back to app_owner explicitly. NO `RESET ROLE` (F482).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

DO $precondition$
BEGIN
  IF current_user <> 'app_owner' THEN
    RAISE EXCEPTION '0157: must run as app_owner (db/migrate.mjs), running as %', current_user;
  END IF;
  IF to_regprocedure('keystone.document_exists_in_practice(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION '0157: keystone.document_exists_in_practice(uuid) already exists — changed by hand? refusing to guess';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'keystone.document_instance'::regclass
                                       AND polname = 'task_subject_probe_read') THEN
    RAISE EXCEPTION '0157: policy task_subject_probe_read already exists on keystone.document_instance — refusing to guess';
  END IF;
  -- ★ auth_owner must not ALREADY read this table: if it did, the column-level grant below would not be the
  --   limit it claims to be.
  IF has_table_privilege('auth_owner', 'keystone.document_instance', 'SELECT') THEN
    RAISE EXCEPTION '0157: auth_owner already holds table-level SELECT on keystone.document_instance — refusing to widen it further';
  END IF;
  IF pg_has_role('app_owner', 'auth_owner', 'USAGE') THEN
    RAISE EXCEPTION '0157: app_owner INHERITS auth_owner (F484) — the policy below would then reach every app_owner definer';
  END IF;
END
$precondition$;

-- ── 1 · what auth_owner may see of document_instance: two columns, this practice only ──────────
GRANT SELECT (id, tenant_id) ON keystone.document_instance TO auth_owner;
GRANT EXECUTE ON FUNCTION keystone.document_is_visible(keystone.document_instance) TO auth_owner;

CREATE POLICY task_subject_probe_read ON keystone.document_instance
  AS PERMISSIVE FOR SELECT TO auth_owner
  USING (tenant_id = keystone.current_tenant_id());

COMMENT ON POLICY task_subject_probe_read ON keystone.document_instance IS
  'F527 / 0157 — admits auth_owner, SELECT only, to THIS practice''s rows, so keystone.document_exists_in_practice() '
  'can answer "does this document exist" with no viewer. auth_owner holds SELECT on (id, tenant_id) only, and '
  'catalog-conformance check 13 pins the one auth_owner function allowed to read this table.';

-- ── 2 · the existence check, created AS its owner ──────────────────────────────────────────────
SET LOCAL ROLE auth_owner;

CREATE FUNCTION keystone.document_exists_in_practice(p_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT CASE
           -- ★ No practice context → "I could not look", never "it is gone" (0056's three-valued rule).
           WHEN keystone.current_tenant_id() IS NULL THEN NULL
           ELSE EXISTS (
             SELECT 1 FROM keystone.document_instance i
              WHERE i.tenant_id = keystone.current_tenant_id()
                AND i.id = p_id)
         END
$$;

-- ★★★ REVOKE FIRST (0044): a definer function is PUBLIC-executable until told otherwise.
REVOKE ALL ON FUNCTION keystone.document_exists_in_practice(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.document_exists_in_practice(uuid) TO app_rw;

COMMENT ON FUNCTION keystone.document_exists_in_practice(uuid) IS
  'F527 / 0157 — TRUE if a document_instance row with this id exists in the CURRENT practice, whatever its state '
  'and whether archived; FALSE if not; NULL with no practice context. Viewer-INDEPENDENT on purpose: the orphan-task '
  'sweeper has no viewer, and document_is_visible() failing closed made every existing document read as deleted. '
  'SECURITY DEFINER owned by auth_owner, admitted by task_subject_probe_read (tenant-scoped) with SELECT on (id, '
  'tenant_id) only. Boolean only. EXECUTE to app_rw (the sweeper''s role) only.';

SET LOCAL ROLE app_owner;

-- ── 3 · the sweeper's document branch asks the new question ─────────────────────────────────────
-- ★ Every other branch is unchanged in meaning; each gains an explicit `tenant_id = current_tenant_id()` so the
--   practice scope is stated in the query, not only inherited from the policy.
CREATE OR REPLACE FUNCTION keystone.task_subject_exists(p_subject_type text, p_subject_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE
SET search_path TO ''
AS $$
DECLARE
  v_found boolean;
  v_tenant uuid := keystone.current_tenant_id();
BEGIN
  -- ★★★ THE NULL RETURN IS THE POINT. An unrecognised type is not "missing" — it is unchecked, and
  --     saying so is what stops the sweeper from closing work it never looked at.
  IF NOT (p_subject_type = ANY (keystone.task_subject_checkable_types())) THEN
    RETURN NULL;
  END IF;
  -- ★ No practice context: nothing can be looked at, so nothing is "gone".
  IF v_tenant IS NULL THEN
    RETURN NULL;
  END IF;

  CASE p_subject_type
    WHEN 'person' THEN
      SELECT EXISTS (SELECT 1 FROM keystone.app_user u WHERE u.tenant_id = v_tenant AND u.id = p_subject_id) INTO v_found;
    WHEN 'account' THEN
      SELECT EXISTS (SELECT 1 FROM keystone.account a WHERE a.tenant_id = v_tenant AND a.id = p_subject_id) INTO v_found;
    WHEN 'document' THEN
      -- ★★★ F527 / 0157 — NOT a read of document_instance as the caller: that read is filtered by
      --     document_is_visible(), which fails closed with no viewer and made every document read as deleted.
      v_found := keystone.document_exists_in_practice(p_subject_id);
    WHEN 'booking' THEN
      SELECT EXISTS (SELECT 1 FROM keystone.booking b WHERE b.tenant_id = v_tenant AND b.id = p_subject_id) INTO v_found;
    WHEN 'entitlement' THEN
      SELECT EXISTS (SELECT 1 FROM keystone.entitlement e WHERE e.tenant_id = v_tenant AND e.id = p_subject_id) INTO v_found;
    WHEN 'run_schedule_item' THEN
      SELECT EXISTS (SELECT 1 FROM keystone.run_schedule_item r WHERE r.tenant_id = v_tenant AND r.id = p_subject_id) INTO v_found;
    ELSE
      -- ★ Unreachable while the guard above and the array agree. If they ever disagree, NULL — the safe direction.
      RETURN NULL;
  END CASE;

  RETURN v_found;
END;
$$;

COMMENT ON FUNCTION keystone.task_subject_exists(text, uuid) IS
  'P20.4 — THREE-VALUED on purpose: TRUE it is there, FALSE it is gone, NULL I cannot check (unknown type, or no '
  'practice context). ★ Only FALSE closes a task. ★★ "There" means the ROW exists in this practice — never "a viewer '
  'can see it": the document branch calls keystone.document_exists_in_practice() (0157, F527) because '
  'document_instance''s SELECT policy is viewer-dependent and the sweeper has no viewer. Not SECURITY DEFINER itself.';

-- ── 4 · the promised end state, asserted — and a runtime probe as the sweeper's role ─────────────
DO $assert$
DECLARE
  f record; cols text[]; probe boolean;
BEGIN
  IF current_user <> 'app_owner' THEN
    RAISE EXCEPTION '0157 finished as % — it must hand back to app_owner, never RESET ROLE', current_user;
  END IF;

  SELECT pg_get_userbyid(p.proowner) AS owner, p.prosecdef, p.proconfig,
         has_function_privilege('app_rw', p.oid, 'EXECUTE') AS rw,
         has_function_privilege('app_worker', p.oid, 'EXECUTE') AS worker,
         EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                  WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS public
    INTO f FROM pg_proc p WHERE p.oid = 'keystone.document_exists_in_practice(uuid)'::regprocedure;
  IF f.owner <> 'auth_owner' OR NOT f.prosecdef OR NOT (f.proconfig @> ARRAY['search_path=""']) THEN
    RAISE EXCEPTION '0157: document_exists_in_practice is owner=% definer=% config=%', f.owner, f.prosecdef, f.proconfig;
  END IF;
  IF NOT f.rw OR f.worker OR f.public THEN
    RAISE EXCEPTION '0157: EXECUTE is wrong — app_rw=% app_worker=% PUBLIC=%', f.rw, f.worker, f.public;
  END IF;

  SELECT array_agg(a.attname::text ORDER BY a.attname) INTO cols
    FROM pg_attribute a
   WHERE a.attrelid = 'keystone.document_instance'::regclass AND a.attnum > 0 AND NOT a.attisdropped
     AND has_column_privilege('auth_owner', 'keystone.document_instance', a.attname, 'SELECT');
  IF cols IS DISTINCT FROM ARRAY['id', 'tenant_id'] OR has_table_privilege('auth_owner', 'keystone.document_instance', 'SELECT') THEN
    RAISE EXCEPTION '0157: auth_owner can read document_instance columns % — must be exactly {id,tenant_id}', cols;
  END IF;

  -- ★ RUNTIME PROBE, as the role that will actually call it, with a practice context and NO viewer. A random id
  --   must answer FALSE (looked, not there) — not NULL, and not an error: an error here would mean auth_owner
  --   cannot evaluate this table's policies (e.g. no EXECUTE on document_is_visible), i.e. every sweep would fail.
  PERFORM set_config('keystone.tenant_id', keystone.uuid_generate_v7()::text, true);
  PERFORM set_config('keystone.user_id', '', true);
  SET LOCAL ROLE app_rw;
  probe := keystone.document_exists_in_practice(keystone.uuid_generate_v7());
  SET LOCAL ROLE app_owner;
  PERFORM set_config('keystone.tenant_id', '', true);
  IF probe IS DISTINCT FROM false THEN
    RAISE EXCEPTION '0157: runtime probe as app_rw answered % for a random id — expected false', probe;
  END IF;
END
$assert$;
