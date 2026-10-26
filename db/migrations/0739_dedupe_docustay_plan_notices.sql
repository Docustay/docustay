-- 0739_dedupe_docustay_plan_notices — the $1 live test (13 Oct 2026) showed five identical "Your workspace is on Pro" bell notices for one purchase: the plan event used to be emitted on every call, not
-- only on a real change (fixed in src/billing/webhook.mjs). This removes the duplicates the bug already made: for a Docustay workspace, a plan notice (topic settings.subscription.updated) that repeats the
-- title and body of an earlier notice to the same person within an hour is a duplicate; the earliest is kept, the rest (and their delivery rows) go. Test-workspace data only: nothing else is touched, and a
-- real later notice (a different title, or another hour) is never a duplicate. Idempotent: a second run finds nothing.
ALTER TABLE keystone.notification NO FORCE ROW LEVEL SECURITY;
ALTER TABLE keystone.notification_delivery NO FORCE ROW LEVEL SECURITY;

CREATE TEMP TABLE _dup_plan_notice ON COMMIT DROP AS
SELECT n.id
  FROM keystone.notification n
  JOIN keystone.tenant t ON t.id = n.tenant_id AND t.product = 'docustay'
 WHERE n.topic = 'settings.subscription.updated'
   AND EXISTS (SELECT 1 FROM keystone.notification k
                WHERE k.tenant_id = n.tenant_id AND k.recipient_id = n.recipient_id AND k.topic = n.topic
                  AND k.title = n.title AND k.body IS NOT DISTINCT FROM n.body
                  AND n.created_at - k.created_at < interval '1 hour'
                  AND (k.created_at < n.created_at OR (k.created_at = n.created_at AND k.id < n.id)));

DELETE FROM keystone.notification_delivery d USING _dup_plan_notice x WHERE d.notification_id = x.id;
DELETE FROM keystone.notification n USING _dup_plan_notice x WHERE n.id = x.id;

ALTER TABLE keystone.notification FORCE ROW LEVEL SECURITY;
ALTER TABLE keystone.notification_delivery FORCE ROW LEVEL SECURITY;

DO $dedupe_check$
BEGIN
  IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'keystone.notification'::regclass) OR NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'keystone.notification_delivery'::regclass) THEN
    RAISE EXCEPTION '0739: row-level security is no longer forced after the clean-up';
  END IF;
END
$dedupe_check$;
