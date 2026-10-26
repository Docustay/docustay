-- 0756_metrics_views_read_through_document_policies — PH1 fix (Dashboard, 17 Oct 2026), found on the sandbox before production.
-- ★★★ WHAT WAS WRONG. metrics.document_daily reads keystone.document_instance. That table also carries the product's own PUBLIC
--     policies (tenant_isolation, the system_* reads), and Postgres evaluates every applicable policy, including their subqueries and
--     the SECURITY DEFINER predicate keystone.document_is_visible, for any role that reads the table. So reading the view failed with
--     "permission denied for table document_audit_event" (then "for function document_is_visible"). 0755's local test schema had no
--     such policies, so it passed there.
-- ★★ THE FIX, AND WHY IT OPENS NOTHING.
--     - metrics_owner (NOLOGIN, owns the views) gets SELECT on the four tables those policy subqueries name. No view reads them, and
--       their own policies admit no row to a role with no tenant set, so nothing new becomes readable.
--     - metrics_owner and posthog_reader get EXECUTE on document_is_visible. It answers only "may the signed-in user see this
--       document"; for these roles no user is signed in, so it answers false. It returns a boolean, never data.
--     The Docustay-only policies of 0755 are unchanged, so a Mainstay row still cannot appear through any view.
GRANT SELECT ON keystone.document_audit_event, keystone.document_party, keystone.document_payment, keystone.document_pdf TO metrics_owner;
GRANT EXECUTE ON FUNCTION keystone.document_is_visible(keystone.document_instance) TO metrics_owner, posthog_reader;
