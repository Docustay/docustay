-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- P8.8 — THE DUE SWEEP COULD NOT SEE A SINGLE DOCUMENT, AND WOULD HAVE SAID NOTHING ABOUT IT.
--
-- ★★★ MEASURED 2026-09-15, BEFORE THIS MIGRATION, ON A REAL TENANT WITH TWO INSTRUMENTS IN IT:
--
--       [EXECUTED as the superuser]  SELECT count(*) FROM keystone.document_instance  →  2
--       [EXECUTED through withTenant(tenantId) with NO userId]      same query        →  0
--
--     `document_instance` has exactly two read/write policies and BOTH require a person:
--       · `tenant_isolation` — USING (tenant_id = current_tenant_id() AND document_is_visible(row))
--       · `staff_write`      — USING (… AND EXISTS (app_user u WHERE u.id = current_user_id()
--                                                              AND u.role = 'staff'))
--     A WORKER HAS NO USER. `src/db/index.mjs:115` sets `keystone.user_id` to the empty string on
--     every no-viewer path — webhook, worker, API token — and its own comment calls that CORRECT:
--     *"a predicate about a viewer must refuse rather than invent one."* It is correct. It also
--     means the lapse sweep would have found zero rows, updated zero rows, logged "nothing was due",
--     and been **indistinguishable from a system where nothing was overdue** — forever.
--
--   ★★ THAT IS THIS PROJECT'S SIGNATURE FAILURE ARRIVING FROM A NEW DIRECTION. `F143`: a migration
--      that could not see the rows it was written to update, and said ok. This is the same shape in
--      the worker instead of the migration, and it would have been invisible to any test that ran
--      the sweep as a logged-in staff member — which is what a gate naturally does.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE FIX IS THE NARROWEST POSSIBLE WIDENING, AND ITS NARROWNESS IS THE WHOLE POINT.
--
--     The tempting fixes are both wrong. A SECURITY DEFINER function owned by `app_owner` does NOT
--     help: FORCE ROW LEVEL SECURITY applies to the table owner, so the definer is subject to the
--     same two policies. Giving the worker a service user would put a fake person on the audit trail
--     of instruments — the exact thing `src/db/index.mjs` refuses to invent.
--
--   ★★ SO THE SCHEMA STATES, DECLARATIVELY, THE ONE THING A CALLER WITH NO VIEWER MAY DO: turn a
--      SENT instrument whose OWN DEADLINE HAS PASSED into an EXPIRED one. Nothing else. The USING
--      clauses below are not "the worker may touch documents" — they are a description of a single
--      row shape, and a row that is not overdue, not sent, or archived is invisible and untouchable
--      through them.
--
--   ★★★ READ THE CONDITIONS AS A LIST OF THINGS THIS CANNOT BE USED FOR:
--        `current_user_id() IS NULL`      → a request can never take this path. Every browser and
--                                           API-token path has a user, so this widens nothing that
--                                           a person can reach.
--        `state = 'sent'`                 → a signed, executed, declined or void instrument is not
--                                           visible through it AT ALL, which is the standing limit
--                                           (nothing changes on a signed instrument) enforced twice:
--                                           here, and in `expired_shape` from 0110.
--        `expires_at <= now()`            → a document with no deadline, or one still live, cannot
--                                           be read or written by an unviewered caller.
--        WITH CHECK `state = 'expired'`   → the ONLY value the row may be left in. This path cannot
--                                           void, execute, retitle or reassign anything.
--
--   ★ AND THE SELECT POLICY IS SEPARATE AND EQUALLY NARROW, because the sweep must find the rows
--     before it can update them and PostgreSQL's UPDATE does not imply a readable row. It exposes
--     overdue sent instruments to an unviewered caller and nothing else — not a person's documents,
--     not a list, not a count of anything a viewer would be refused.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

CREATE POLICY system_expiry_read ON keystone.document_instance
  FOR SELECT
  USING (tenant_id = keystone.current_tenant_id()
         AND keystone.current_user_id() IS NULL
         AND state = 'sent'
         AND expires_at IS NOT NULL
         AND expires_at <= now()
         AND archived_at IS NULL);

CREATE POLICY system_expiry ON keystone.document_instance
  FOR UPDATE
  USING (tenant_id = keystone.current_tenant_id()
         AND keystone.current_user_id() IS NULL
         AND state = 'sent'
         AND expires_at IS NOT NULL
         AND expires_at <= now()
         AND archived_at IS NULL)
  WITH CHECK (tenant_id = keystone.current_tenant_id()
              AND state = 'expired');

COMMENT ON POLICY system_expiry ON keystone.document_instance IS
  'P8.8. The ONLY write an unviewered caller (the due sweep) may make: sent + overdue -> expired. A signed, executed, declined or void instrument is not visible through this policy at all.';
