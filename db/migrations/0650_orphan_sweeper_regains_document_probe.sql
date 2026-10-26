-- 0650 · D-029 (6 Oct 2026): the orphan-task sweeper failed for EVERY workspace (pg 42501 permission denied for table document_instance,
-- raised inside keystone.document_exists_in_practice). Cause: 0632 ran `REVOKE SELECT ON keystone.document_instance FROM auth_owner`, and a
-- table-level REVOKE also removes the COLUMN grants 0157 had given the existence check (id, tenant_id). The policy task_subject_probe_read
-- (tenant-scoped, SELECT, auth_owner only) is intact. Restore exactly 0157's grant: two columns, nothing else; the platform list still does
-- not count documents (0632's reason stands, it asked for more than these two columns).
-- Additive and idempotent. Proven on the sandbox in a rolled-back transaction: sweep returned 0|0 instead of the privilege error.
GRANT SELECT (id, tenant_id) ON keystone.document_instance TO auth_owner;
