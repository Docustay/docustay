-- 0772 — a removed webhook gives its address back (R13-D330, 23 Oct 2026).
-- DELETE /api/v1/webhooks/{id} keeps the row (status 'disabled', disabled_reason 'removed') so its past deliveries stay in the record, but the
-- unique (tenant_id, lower(url)) index from 0047 still counted it, so a new webhook at the same address answered 409 webhook_url_taken for an
-- endpoint the developer can no longer see or edit. The index now covers every endpoint except removed ones; a paused or auto-disabled one still holds its address.
DROP INDEX IF EXISTS keystone.webhook_endpoint_tenant_url_key;
CREATE UNIQUE INDEX webhook_endpoint_tenant_url_key
  ON keystone.webhook_endpoint (tenant_id, lower(url))
  WHERE NOT (status = 'disabled' AND disabled_reason = 'removed');
