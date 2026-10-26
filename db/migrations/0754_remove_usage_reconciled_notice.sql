-- 0754_remove_usage_reconciled_notice — Ty, 15 Oct 2026 (G1): the "Usage was reconciled for this billing period" email and bell notice are gone for good, for every workspace in every environment.
-- The code no longer emits the event or maps it to a notice (src/billing/usageReconcile.mjs now logs a line); this removes what already exists: the notice rows (and their delivery rows) that
-- earlier reconcile runs created. The nightly reconcile itself is untouched. Same pattern as 0739 (row-level security is lifted for the clean-up and forced again, and checked). Idempotent: a second run finds nothing.
ALTER TABLE keystone.notification NO FORCE ROW LEVEL SECURITY;
ALTER TABLE keystone.notification_delivery NO FORCE ROW LEVEL SECURITY;

DELETE FROM keystone.notification_delivery d USING keystone.notification n WHERE d.notification_id = n.id AND n.topic = 'settings.usage.reconciled';
DELETE FROM keystone.notification WHERE topic = 'settings.usage.reconciled';

ALTER TABLE keystone.notification FORCE ROW LEVEL SECURITY;
ALTER TABLE keystone.notification_delivery FORCE ROW LEVEL SECURITY;

DO $g1_check$
BEGIN
  IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'keystone.notification'::regclass) OR NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'keystone.notification_delivery'::regclass) THEN
    RAISE EXCEPTION '0754: row-level security is no longer forced after the clean-up';
  END IF;
END
$g1_check$;
