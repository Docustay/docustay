-- 0571_document_worker_safe_lookups
--
-- Two more SECURITY DEFINER lookups, same reasoning as F875/migration 0570's
-- `document_created_by()`, found by a systematic sweep for every OTHER worker-context read of a
-- viewer-gated table (dispatched after finding the same hazard twice in one evening — F854, F875).
--
-- First: `documents.document.declined` (src/queue/tasks.mjs) has the IDENTICAL
-- unwrapped `document_instance` read `documents.document.expired` (the handler two cases above it)
-- also has — but `expired`'s read is only safe BY COINCIDENCE: by delivery time the document's
-- state is 'expired', which matches `document_instance`'s own `system_expiry_read` carve-out.
-- 'declined' matches NONE of the three existing carve-outs (sent/expired, executed, sent/
-- partially_signed) — MEASURED directly: the SELECT returns zero rows for a real declined
-- document, `row` is undefined, and the handler throws unconditionally. The notification telling
-- staff "a signer declined" has never been created, ever, for any real decline.
--
-- `keystone.document_created_by()` (migration 0570) only returns `created_by`; this handler also
-- needs `title` for the notification body. Rather than widen 0570's own return type (a scalar uuid
-- other real callers already depend on) this adds a second, purpose-built function — same
-- reasoning as 0570's own: a plain metadata fact for notification routing, not a content read, so
-- it deliberately bypasses `document_is_visible()` the same way `resolve_tenant_by_slug()`/
-- `platform_list_tenants()`/`document_created_by()` already do for their own narrow system needs.

CREATE OR REPLACE FUNCTION keystone.document_notification_facts(p_tenant_id uuid, p_instance_id uuid)
RETURNS TABLE (id uuid, title text, created_by uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT id, title, created_by FROM keystone.document_instance
   WHERE tenant_id = p_tenant_id AND id = p_instance_id
$$;

REVOKE ALL ON FUNCTION keystone.document_notification_facts(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.document_notification_facts(uuid, uuid) TO app_rw, app_owner;

COMMENT ON FUNCTION keystone.document_notification_facts(uuid, uuid) IS
  'id/title/created_by for a worker notification — plain metadata, no viewer required, same
   reasoning as document_created_by() (migration 0570). Used by documents.document.declined
   (src/queue/tasks.mjs), which needs title alongside created_by.';

-- ★ THIRD BUG FROM THE SAME SWEEP — `sweepLeadScore` (src/queue/tasks.mjs, ~line 6019) checks
--   "does this person have any non-draft document from the last 90 days" as one EXISTS clause
--   inside a larger candidates query, with no viewer. Because `document_is_visible()` is per-record
--   (the SUBJECT's own assigned coach, not a blanket tenant/owner rule), that EXISTS was only ever
--   true by coincidence — for the narrow set of (state, timing) combinations that happen to match
--   one of the table's three no-viewer RLS carve-outs. A real `executed`, `partially_signed`
--   (reminder not yet due), `declined` or `void` document — the much larger remaining set of
--   non-draft states — was invisible, so a person whose ONLY growth-engagement signal is a
--   document was silently excluded from lead scoring. This never threw (unlike the `declined`
--   bug above), so it degraded a growth/marketing signal quietly rather than failing loudly —
--   lower severity than the first two fixes in this migration, same root cause.
CREATE OR REPLACE FUNCTION keystone.person_has_recent_document(
  p_tenant_id uuid, p_subject_user_id uuid, p_since timestamptz
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM keystone.document_instance
     WHERE tenant_id = p_tenant_id AND subject_user_id = p_subject_user_id
       AND state <> 'draft' AND created_at > p_since
  )
$$;

REVOKE ALL ON FUNCTION keystone.person_has_recent_document(uuid, uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.person_has_recent_document(uuid, uuid, timestamptz) TO app_rw, app_owner;

COMMENT ON FUNCTION keystone.person_has_recent_document(uuid, uuid, timestamptz) IS
  'Does this person have any non-draft document created since the given time — a plain existence
   fact for lead scoring (sweep_lead_score), no viewer required, same reasoning as
   document_created_by()/document_notification_facts() above.';

-- ★ THE SET-BASED FORM `sweepLeadScore` actually needs — its candidates query gathers everyone
--   matching ANY of five growth-engagement signals in one pass; checking documents one person at a
--   time would mean querying every tenant person individually. Same bypass, same reasoning, as a
--   table-returning function instead of a per-person boolean.
CREATE OR REPLACE FUNCTION keystone.people_with_recent_documents(p_tenant_id uuid, p_since timestamptz)
RETURNS TABLE (subject_user_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT DISTINCT subject_user_id FROM keystone.document_instance
   WHERE tenant_id = p_tenant_id AND state <> 'draft' AND created_at > p_since
     AND subject_user_id IS NOT NULL
$$;

REVOKE ALL ON FUNCTION keystone.people_with_recent_documents(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.people_with_recent_documents(uuid, timestamptz) TO app_rw, app_owner;

COMMENT ON FUNCTION keystone.people_with_recent_documents(uuid, timestamptz) IS
  'Every person with a non-draft document since the given time, set-based — the bulk form
   sweep_lead_score actually uses; person_has_recent_document() above is kept for any single-person
   caller, both backed by the same no-viewer reasoning.';

-- ── Self-check ──────────────────────────────────────────────────────────────────────────────
DO $check$
DECLARE
  v_exists boolean;
  v_exists2 boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'keystone' AND p.proname = 'document_notification_facts'
  ) INTO v_exists;
  IF NOT v_exists THEN
    RAISE EXCEPTION '0571 self-check: keystone.document_notification_facts was not created';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'keystone' AND p.proname = 'person_has_recent_document'
  ) INTO v_exists2;
  IF NOT v_exists2 THEN
    RAISE EXCEPTION '0571 self-check: keystone.person_has_recent_document was not created';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'keystone' AND p.proname = 'people_with_recent_documents'
  ) THEN
    RAISE EXCEPTION '0571 self-check: keystone.people_with_recent_documents was not created';
  END IF;

  RAISE NOTICE '0571: document_notification_facts, person_has_recent_document and people_with_recent_documents created';
END
$check$;
