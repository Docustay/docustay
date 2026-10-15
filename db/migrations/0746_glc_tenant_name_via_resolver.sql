-- 0744 and 0745 renamed nothing (MEASURED in the sandbox, 14 Oct 2026): keystone.tenant is under FORCED row-level security and the migration role cannot read the row without the
-- practice's tenant context, so a bare SELECT/UPDATE is a silent no-op (the same trap 0661/0666 documented). The id comes from keystone.resolve_tenant_by_slug, as 0666 does.
-- the maintainer, 14 Oct 2026: every email a coaching lead or client gets must say "an example organisation" (F657, the email half). ~30 code paths read keystone.tenant.name (invoices, receipts,
-- booking pages, gift cards, the lead consent line ...); renaming the row makes all of them say the brand. "an example organisation" is the d/b/a of an example organisation Recovery Services LLC.
-- Idempotent; only slug 'glc', only while it still carries the old name.
SELECT set_config('keystone.tenant_id', keystone.resolve_tenant_by_slug('glc')::text, true)
 WHERE keystone.resolve_tenant_by_slug('glc') IS NOT NULL;
UPDATE keystone.tenant SET name = 'Example Practice Coaching' WHERE slug = 'glc' AND name = 'Example Practice Recovery Services';
