-- 0570_document_created_by_system_lookup
--
-- Documents wall-gate repair (queue item, specs/WORKLOG.md's own last line before this session
-- picked it up). db/gates/documents_wall.mjs's SQL-clause check (Ty, 29 Sep 2026 — added
-- specifically because "booking was reading the document tables directly 7 times") caught
-- `src/queue/recipientResolvers.mjs`'s "document" recipient lookup: a raw `tx.query` on
-- `keystone.document_instance`, no import at all. Fixed the wall crossing by routing it through a
-- new door function (`instanceCreatedBy`, src/documents/api.mjs) — but a real end-to-end test
-- against a real local document row (not assumed, not mocked) found the ACTUAL defect this was
-- about to ship with: wrapping the lookup in `asPracticeOwner` (the same fix F854 used for
-- invoice/subscription/payment/estimate) does NOT work here, because `document_instance`'s own RLS
-- (`document_is_visible()`, migration 0537) is not a simple "owner sees everything" check the way
-- those four money tables are — for a STAFF viewer it resolves to
-- `keystone.user_may(viewer, 'document', 'view'|'delete', <the SUBJECT's own assigned coach>)`, a
-- per-GRANT check keyed on the document's subject's OWN owner_user_id. MEASURED directly: a real
-- document whose subject has no coach assigned was invisible even to the tenant's real 'owner'
-- staff member — `document_is_visible()` returned `false` for that exact combination. Wrapping in
-- asPracticeOwner would have silently resolved to `null` in production for any document on an
-- unassigned-coach client, the SAME "passes the wall gate, still silently fails" shape F854 was
-- itself written to avoid.
--
-- The actual need here is not "can this viewer see the document's contents" — it is "who created
-- this record," a plain metadata fact a worker job needs to route a notification, with no viewer
-- at all. That is exactly the shape `keystone.resolve_tenant_by_slug` and
-- `keystone.platform_list_tenants` already exist for elsewhere in this schema: a narrow, named,
-- SECURITY DEFINER bypass for one specific, legitimate system need, never a general content-read.

CREATE OR REPLACE FUNCTION keystone.document_created_by(p_tenant_id uuid, p_instance_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT created_by FROM keystone.document_instance
   WHERE tenant_id = p_tenant_id AND id = p_instance_id
$$;

REVOKE ALL ON FUNCTION keystone.document_created_by(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.document_created_by(uuid, uuid) TO app_rw, app_owner;

COMMENT ON FUNCTION keystone.document_created_by(uuid, uuid) IS
  'Who created a document instance — a plain metadata fact for system/notification routing (the
   worker dispatcher runs with no viewer at all), never a content read. Deliberately bypasses
   document_is_visible() the same way resolve_tenant_by_slug()/platform_list_tenants() bypass their
   own tables'' RLS for other narrow system needs — NOT a general-purpose document accessor.';

-- ── Self-check ──────────────────────────────────────────────────────────────────────────────
DO $check$
DECLARE
  v_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'keystone' AND p.proname = 'document_created_by'
  ) INTO v_exists;
  IF NOT v_exists THEN
    RAISE EXCEPTION '0570 self-check: keystone.document_created_by was not created';
  END IF;
  RAISE NOTICE '0570: keystone.document_created_by created';
END
$check$;
