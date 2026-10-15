-- 0219 — keystone.n8n_delivery: the outbox → n8n sink's delivery bookkeeping.
-- Task 9.14 (CT-096, from Stage 9 CC-8). Mirrors keystone.webhook_delivery's shape
-- (db/migrations/0047_outbound_webhooks.sql), read and copied, not invented.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ ONE ROW PER ATTEMPT, WRITTEN BEFORE THE SEND. NEVER INFER DELIVERY FROM THE ABSENCE OF AN
--     ERROR — same reasoning as 0047's own header, copied here rather than re-derived: a single
--     mutable row per (tenant, event) cannot answer "did we try, and what happened?" after a crash
--     mid-send, and that is the only question worth asking when n8n is unreachable.
--
-- ★★★ THE SINK STARTS FROM NOW. IT DOES NOT REPLAY HISTORY. MEASURED (21 Sep 2026): keystone.event
--     holds 68 rows on production. Every one of them predates this table. If a freshly connected n8n
--     instance were handed all 68 on its first sync, it would fire 68 automations for bookings,
--     documents and payments that already happened — cancellation emails for cancellations from
--     months ago, reminder workflows for appointments long since kept or missed. This table's first
--     read (`src/events/outbox.mjs`'s `sinkEventToN8n`, `sinceUtc` parameter, default "now") is
--     bounded by ITS OWN creation time, never by `keystone.event`'s. No backfill, no bulk insert of
--     historical rows — this migration inserts nothing.
--   ★ F384 (the n8n cluster): the prior n8n install's own data was destroyed on 10 July 2026 — there
--     is nothing to export or migrate from the other side either.
--
-- ★ This migration does NOT store the n8n service credential. CT-096 places that credential in a
--   CT-061 envelope held in a Railway service variable (`KEYSTONE_N8N_SERVICE_ENVELOPE`,
--   `src/automations/n8n.mjs`) — a single, platform-wide secret with no per-request tenant
--   transaction to open it inside, unlike every other sealed secret in this schema. There is
--   deliberately no table here for it.
--
-- ★ This migration does NOT seed or touch `keystone.feature_flag`'s `n8n_send` row — that is 9.13's
--   migration (0218), which ships it OFF (Q9-6: no n8n instance exists to deliver to yet).
--
-- Written during BUILD, NOT applied (BUILD-PROCESS.md:171).

SET LOCAL ROLE app_owner;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 1 · keystone.n8n_delivery
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE keystone.n8n_delivery (
  id            uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id     uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  -- ★★★ RESTRICT, NOT CASCADE — same reasoning as webhook_delivery: this IS the audit record of
  --     "did we tell n8n", and deleting the event must not silently delete the evidence that we
  --     tried (or didn't).
  event_id      uuid        NOT NULL REFERENCES keystone.event(id) ON DELETE RESTRICT,
  attempt       integer     NOT NULL CHECK (attempt >= 1),
  status        text        NOT NULL DEFAULT 'attempted'
                  CHECK (status IN ('attempted','sent','failed')),
  last_error    text        CHECK (last_error IS NULL OR char_length(last_error) <= 500),
  attempted_at  timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz,

  -- ★★ MAKE THE ILLEGAL STATES UNREPRESENTABLE — same discipline as webhook_delivery_status_shape.
  CONSTRAINT n8n_delivery_status_shape CHECK (
    (status = 'attempted' AND completed_at IS NULL) OR
    (status IN ('sent','failed') AND completed_at IS NOT NULL)
  )
);

-- ★★ THE ONLY THING THAT IS ATOMIC. A read-then-write "what's the next attempt number" loses to two
--    concurrent workers — this unique index does not.
CREATE UNIQUE INDEX n8n_delivery_attempt_key
  ON keystone.n8n_delivery (tenant_id, event_id, attempt);
CREATE INDEX n8n_delivery_log_idx
  ON keystone.n8n_delivery (tenant_id, event_id, attempted_at DESC);

COMMENT ON TABLE keystone.n8n_delivery IS
  'ONE ROW PER ATTEMPT of the outbox -> n8n sink (task 9.14, CT-096). Written BEFORE the send with '
  'status=attempted, then updated with the outcome. The sink never replays history — see the '
  'sinceUtc parameter on src/events/outbox.mjs''s sinkEventToN8n and this file''s own header.';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 2 · RLS — the standard per-tenant policy, copied verbatim from 0047's own DO block
-- ─────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['n8n_delivery'] LOOP
    EXECUTE format('ALTER TABLE keystone.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE keystone.%I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format($f$CREATE POLICY tenant_isolation ON keystone.%I
                      USING (tenant_id = keystone.current_tenant_id())$f$, t);
    EXECUTE format($f$CREATE POLICY tenant_insert ON keystone.%I
                      FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id())$f$, t);
    -- ★★ tenant_update — required so an UPDATE's WITH CHECK, not only its USING, is enforced on the
    --    NEW row (0016's omission, A4.2 item ★, already fixed in every table built since 0047).
    EXECUTE format($f$CREATE POLICY tenant_update ON keystone.%I
                      FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
                              WITH CHECK (tenant_id = keystone.current_tenant_id())$f$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.%I TO app_rw', t);
  END LOOP;
END $$;

RESET ROLE;
