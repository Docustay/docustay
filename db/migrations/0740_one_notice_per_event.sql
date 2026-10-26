-- 0740_one_notice_per_event — Launch plan Part 4 (14 Oct 2026): one business event = at most ONE in-app notification per recipient. Enforced by the database for the topics Docustay's inbox shows (documents.*, plan
-- changes, payments): a second row for the same event and the same person cannot be written, so a retried job or a double listener can never make a duplicate bell notice. Mainstay's topics are NOT constrained (some of
-- its events legitimately notify one person more than once). Existing duplicates for these topics are removed first (the earliest row is kept). Additive and idempotent.
ALTER TABLE keystone.notification NO FORCE ROW LEVEL SECURITY;
ALTER TABLE keystone.notification_delivery NO FORCE ROW LEVEL SECURITY;

CREATE TEMP TABLE _dup_event_notice ON COMMIT DROP AS
SELECT n.id FROM keystone.notification n
 WHERE n.event_id IS NOT NULL
   AND (n.topic LIKE 'documents.%' OR n.topic = 'settings.subscription.updated')
   AND EXISTS (SELECT 1 FROM keystone.notification k
                WHERE k.tenant_id = n.tenant_id AND k.recipient_id = n.recipient_id AND k.event_id = n.event_id
                  AND (k.topic LIKE 'documents.%' OR k.topic = 'settings.subscription.updated')
                  AND (k.created_at < n.created_at OR (k.created_at = n.created_at AND k.id < n.id)));
DELETE FROM keystone.notification_delivery d USING _dup_event_notice x WHERE d.notification_id = x.id;
DELETE FROM keystone.notification n USING _dup_event_notice x WHERE n.id = x.id;

CREATE UNIQUE INDEX IF NOT EXISTS notification_one_per_event_docustay
  ON keystone.notification (tenant_id, recipient_id, event_id)
  WHERE event_id IS NOT NULL AND (topic LIKE 'documents.%' OR topic = 'settings.subscription.updated');

ALTER TABLE keystone.notification FORCE ROW LEVEL SECURITY;
ALTER TABLE keystone.notification_delivery FORCE ROW LEVEL SECURITY;

DO $one_notice_check$
BEGIN
  IF to_regclass('keystone.notification_one_per_event_docustay') IS NULL THEN RAISE EXCEPTION '0740: the unique index is missing'; END IF;
  IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'keystone.notification'::regclass) THEN RAISE EXCEPTION '0740: row-level security is no longer forced'; END IF;
END
$one_notice_check$;
