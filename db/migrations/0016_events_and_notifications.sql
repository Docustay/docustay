-- 0016_events_and_notifications
-- P9.2–P9.9 — the OUTBOX, the notification fan-out, and the five FCM token rules.
--
-- ══ ★★★ §X4's ONE MECHANISM ═══════════════════════════════════════════════
-- "Sections NEVER call each other. Documents does not call Notifications. Documents emits
--  `document.signed` and whoever cares subscribes. ★ This is what keeps the six objects from
--  tangling, and why adding a section later does not require touching the others."
--
-- ★★ And the rule that makes it trustworthy: **"Every state change writes a row to an `event`
-- table IN THE SAME TRANSACTION as the change itself."** The outbox pattern, and both halves
-- matter equally:
--   · an event cannot be LOST — it commits with the change,
--   · and it cannot fire for a change that ROLLED BACK — it dies with it.
-- ★ A publisher that emits after committing loses events on a crash; one that emits before
-- committing fires for changes that never happened. Only "in the same transaction" avoids both.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1 · event — the OUTBOX
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE keystone.event (
  id            uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id     uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,

  -- ★★ `section.thing.past_tense` — the name IS the contract. A subscriber matches on this
  -- string and on nothing else, which is what makes the emitter and the consumer independent.
  topic         text        NOT NULL CHECK (topic ~ '^[a-z]+\.[a-z_]+\.[a-z_]+$'),

  -- ★ WHICH SECTION EMITTED IT. Not decoration: P9.4's guard reads this to prove that a
  -- section's events are named for that section and nothing else.
  emitted_by    text        NOT NULL CHECK (emitted_by IN (
                  'documents','booking','money','people','accounts','items','growth','tasks',
                  'platform','provisioning')),

  subject_type  text,
  subject_id    uuid,
  payload       jsonb       NOT NULL DEFAULT '{}'::jsonb,

  -- ★★★ THE CONSUMPTION STATE. n8n LISTENS; it does not STORE (§X4.2). So the record of what has
  -- been consumed lives HERE, in our Postgres with RLS, not in n8n's own database — otherwise
  -- "has this been processed?" would be a question only n8n could answer, and n8n is the thing
  -- most likely to have been restarted.
  status        text        NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','claimed','processed','failed','dead')),
  claimed_at    timestamptz,
  processed_at  timestamptz,
  attempts      integer     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error    text,
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT event_status_shape CHECK (
    (status = 'pending'   AND claimed_at IS NULL     AND processed_at IS NULL) OR
    (status = 'claimed'   AND claimed_at IS NOT NULL AND processed_at IS NULL) OR
    (status = 'processed' AND processed_at IS NOT NULL) OR
    (status IN ('failed','dead'))
  )
);
-- ★ The consumer's query: oldest pending first, per tenant.
CREATE INDEX event_pending ON keystone.event (tenant_id, created_at)
  WHERE status IN ('pending', 'failed');
CREATE INDEX event_topic ON keystone.event (tenant_id, topic, created_at DESC);
CREATE INDEX event_subject ON keystone.event (tenant_id, subject_type, subject_id);

COMMENT ON TABLE keystone.event IS
  '§X4 — THE OUTBOX. Written in the SAME TRANSACTION as the state change, so an event can neither be lost nor fire for a rollback. n8n LISTENS to this; it never stores it.';

-- ★★ Claim events for processing. `FOR UPDATE SKIP LOCKED` so two workers take DIFFERENT rows —
-- plain `FOR UPDATE` makes the second wait and then reprocess what the first already took.
CREATE OR REPLACE FUNCTION keystone.claim_events(p_limit integer DEFAULT 100)
RETURNS SETOF keystone.event
LANGUAGE sql VOLATILE AS $$
  UPDATE keystone.event e
     SET status = 'claimed', claimed_at = now(), attempts = e.attempts + 1
   WHERE e.id IN (
     SELECT id FROM keystone.event
      WHERE tenant_id = keystone.current_tenant_id()
        AND status IN ('pending','failed')
      ORDER BY created_at
      FOR UPDATE SKIP LOCKED
      LIMIT p_limit)
  RETURNING *;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2 · notification — IN-APP, IN OUR POSTGRES
-- ─────────────────────────────────────────────────────────────────────────────
-- ★★★ [DOC, §N2/§X6] Novu is out because it requires MongoDB and Redis. Notification records
-- would live in MongoDB **where `FORCE ROW LEVEL SECURITY` does not exist**, so tenant isolation
-- for notifications would sit in APPLICATION CODE — "the exact defect class that killed Twenty,
-- reintroduced for the one subsystem that touches every tenant's users."
-- ★ So it lives here, under the same FORCE policy as everything else.
CREATE TABLE keystone.notification (
  id            uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id     uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  recipient_id  uuid        NOT NULL REFERENCES keystone.app_user(id) ON DELETE CASCADE,
  -- ★ The event that caused it, so a notification can always explain itself.
  event_id      uuid        REFERENCES keystone.event(id) ON DELETE SET NULL,
  topic         text        NOT NULL,
  title         text        NOT NULL,
  body          text,
  deep_link     text,
  read_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notification_inbox ON keystone.notification (tenant_id, recipient_id, created_at DESC);
CREATE INDEX notification_unread ON keystone.notification (tenant_id, recipient_id)
  WHERE read_at IS NULL;

-- ★ Per-user, per-topic, per-channel preferences. Absence means "send" — a preference row is an
-- opt-OUT, so a topic added later reaches people rather than silently reaching nobody.
CREATE TABLE keystone.notification_preference (
  id            uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id     uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  app_user_id   uuid        NOT NULL REFERENCES keystone.app_user(id) ON DELETE CASCADE,
  topic         text        NOT NULL,
  channel       text        NOT NULL CHECK (channel IN ('in_app','email','push')),
  enabled       boolean     NOT NULL DEFAULT true,
  UNIQUE (tenant_id, app_user_id, topic, channel)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3 · ★★★ notification_delivery — SO "DID IT ACTUALLY SEND" IS ANSWERABLE
-- ─────────────────────────────────────────────────────────────────────────────
-- ★★ §X6: "ONE `notification` row, plus ONE `notification_delivery` row PER CHANNEL carrying the
-- provider response. ★ NEVER INFER DELIVERY FROM THE ABSENCE OF AN ERROR."
-- ★ That sentence is the whole table. "No error was logged" is compatible with: the send was
-- never attempted · it was attempted and the process died · the provider accepted and dropped it.
-- A row per channel with the provider's own response distinguishes all three.
CREATE TABLE keystone.notification_delivery (
  id              uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id       uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  notification_id uuid        NOT NULL REFERENCES keystone.notification(id) ON DELETE CASCADE,
  channel         text        NOT NULL CHECK (channel IN ('in_app','email','push')),
  -- ★★ `attempted` is the DEFAULT and it is deliberate: a row is written BEFORE the provider is
  -- called. If the process dies mid-send the row survives saying "attempted", which is the truth.
  -- A row written only on success would leave no trace of a send that vanished.
  status          text        NOT NULL DEFAULT 'attempted'
                    CHECK (status IN ('attempted','sent','delivered','failed','skipped')),
  provider        text,
  provider_message_id text,
  provider_response   jsonb,
  error           text,
  attempted_at    timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  UNIQUE (tenant_id, notification_id, channel)
);
CREATE INDEX notification_delivery_lookup
  ON keystone.notification_delivery (tenant_id, notification_id);

COMMENT ON TABLE keystone.notification_delivery IS
  '§X6 — ONE ROW PER CHANNEL with the provider''s own response. ★ NEVER infer delivery from the absence of an error: "no error" is equally consistent with never-attempted, died-mid-send, and accepted-then-dropped.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4 · ★★★ device_token — THE FIVE RULES, IN THE SCHEMA
-- ─────────────────────────────────────────────────────────────────────────────
-- ★★★ §X6: "THE FCM TOKEN BUG WAS OURS, NOT NOVU'S — AND NOVU NEVER FIXED IT … the live system
-- still hit **83% token duplication** and a stale-token outage while running Novu."
-- ★ Novu stored the token and relayed it; deletion-on-rejection, the upsert key and the refresh
-- cadence were always ours to write. Changing vendor could never have fixed it.
CREATE TABLE keystone.device_token (
  id            uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id     uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  app_user_id   uuid        NOT NULL REFERENCES keystone.app_user(id) ON DELETE CASCADE,
  platform      text        NOT NULL CHECK (platform IN ('ios','android','web')),
  token         text        NOT NULL,

  -- ★★ RULE 3: "Update the registration timestamp on every upload." [DOC] Firebase's own
  -- guidance — it is the signal that the app opened and synced, and it is what makes RULE 4's
  -- pruning possible at all.
  registered_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),

  -- ★★★ RULE 1: ONE DEVICE, ONE ROW, keyed on (user, platform, token). UPSERT, NEVER INSERT.
  -- ★ This single constraint is what turns RULE 5's churn — reinstall, device restore, cleared
  -- app data, OS update — from a duplication problem into a no-op. 83% duplication was a missing
  -- unique key, not a vendor failing.
  UNIQUE (tenant_id, app_user_id, platform, token)
);
CREATE INDEX device_token_user ON keystone.device_token (tenant_id, app_user_id);
-- ★ RULE 4: [DOC] Android registrations are garbage-collected after 270 days of inactivity and
-- FCM then rejects sends. iOS has no equivalent expiry, so it is pruned proactively too.
CREATE INDEX device_token_stale ON keystone.device_token (last_seen_at);

COMMENT ON TABLE keystone.device_token IS
  '§X6 — ★★★ ONE DEVICE, ONE ROW. The 83% duplication in the live system was a missing UNIQUE key, not Novu. Rules: upsert never insert · delete on rejection · timestamp every upload · prune at 270 days · churn is then harmless.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5 · RLS
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['event','notification','notification_preference',
                           'notification_delivery','device_token'] LOOP
    EXECUTE format('ALTER TABLE keystone.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE keystone.%I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format($f$CREATE POLICY tenant_isolation ON keystone.%I
                      USING (tenant_id = keystone.current_tenant_id())$f$, t);
    EXECUTE format($f$CREATE POLICY tenant_insert ON keystone.%I
                      FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id())$f$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.%I TO app_rw', t);
  END LOOP;
END $$;
