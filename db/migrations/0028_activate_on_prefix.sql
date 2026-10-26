-- 0028_activate_on_prefix
-- P17.9 — D-17.21. ★★★ A WORKSPACE CREATED THROUGH THE REAL FLOW COULD NEVER BE LOGGED INTO.
--
-- ★★★ THE MEASUREMENT. [EXECUTED 2026-09-13, against the DEPLOYED database]
--       keystone.resolve_tenant_by_slug('<the tenant signup had just created>')  →  NULL
--       keystone.resolve_tenant_by_slug('y1-alpha')  (an active fixture)         →  a uuid
--     Both directions. The resolver admits ONLY `status = 'active'`; `runCriticalPrefix` inserts
--     the literal `'provisioning'`; and [MEASURED by grepping all of src/ and db/migrations/]
--     ★★ NOTHING IN THE ENTIRE CODEBASE EVER SETS A TENANT TO 'active'. The two tenants that are
--        active were inserted that way by a seed fixture. Activation was "the suffix's job" and the
--        suffix has no producer (F5), so the state was unreachable — permanently, not slowly.
--     ★ So signup succeeded, the claim was set, the person's row was correct, and `login()` then
--       returned `invalid credential` — a message that names the credential when the credential was
--       fine. P17.9's real failure, three layers below where it appeared.
--
-- ★★★ WHY THIS IS A DEFINER FUNCTION AND NOT A WIDER RESOLVER OR A WIDER POLICY.
--   · REJECTED — widen `resolve_tenant_by_slug` to admit 'provisioning'. That weakens the exact
--     boundary whose own comment explains itself: "A SUSPENDED OR DELETED TENANT MUST NOT RESOLVE."
--     It would also make 'provisioning' a fourth loginable state that nobody decided on. ★ Never
--     loosen an assertion to make something pass.
--   · REJECTED — give `app_signup` an UPDATE policy on `keystone.tenant`. It would need a SELECT
--     policy too (an UPDATE must FIND its row — D-17.19) and it would hold standing write access to
--     the tenant table forever, to perform one transition once.
--   · CHOSEN — one SECURITY DEFINER function with the transition welded into its WHERE clause. It
--     can move a tenant from 'provisioning' to 'active' and it can do NOTHING ELSE: it cannot
--     revive a 'suspended' tenant, cannot reopen a 'closed' one, and cannot touch any other column.
--     `app_signup` gains one verb, not a surface.
--
-- ★ `search_path = ''` and every name schema-qualified — P21A.6 asserts that of every definer here,
--   and an unpinned search_path on a definer is a privilege-escalation primitive.

CREATE OR REPLACE FUNCTION keystone.activate_provisioning_tenant(p_tenant_id uuid)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
AS $fn$
DECLARE
  v_rows integer;
BEGIN
  -- ★★ THE PREDICATE IS THE WHOLE SECURITY PROPERTY. `status = 'provisioning'` in the WHERE clause
  --    means a wrong or malicious argument cannot change any other tenant's state: a uuid naming an
  --    active, suspended or closed tenant matches zero rows and returns false.
  UPDATE keystone.tenant
     SET status = 'active'
   WHERE id = p_tenant_id
     AND status = 'provisioning';
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  -- ★★★ AND IT RAISES RATHER THAN RETURNING FALSE QUIETLY WHEN IT CHANGED NOTHING.
  --     This project's signature failure is the silent zero-row write (D-17.19): three UPDATEs
  --     matched nothing, raised nothing, and the caller reported success. The prefix calls this as
  --     its LAST act and a false here means the workspace is un-enterable — precisely the condition
  --     this migration exists to end. So it must abort the transaction, not return a boolean nobody
  --     is obliged to read.
  IF v_rows <> 1 THEN
    RAISE EXCEPTION
      'activate_provisioning_tenant matched % row(s) for %; a tenant can only be activated from status ''provisioning''',
      v_rows, p_tenant_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN true;
END;
$fn$;

COMMENT ON FUNCTION keystone.activate_provisioning_tenant(uuid) IS
  'P17.9 / D-17.21. Moves a tenant from provisioning to active and nothing else — the transition is '
  'in the WHERE clause, so it cannot revive a suspended or closed tenant. Called by '
  'runCriticalPrefix as its last act inside the signup transaction, because resolve_tenant_by_slug '
  'admits only active tenants and NOTHING in the codebase otherwise ever set that status: every '
  'workspace created through the real signup flow was un-loginable. Raises on zero rows rather than '
  'returning false, because a silent no-op write is this project''s recorded failure mode.';

-- ★ `app_signup` runs the prefix. `app_rw` is granted too so a future platform/admin path (and the
--   provisioning suffix, when it gains a producer) can activate a tenant that was left provisioning
--   by a crashed run, without needing a superuser.
GRANT EXECUTE ON FUNCTION keystone.activate_provisioning_tenant(uuid) TO app_signup, app_rw;
