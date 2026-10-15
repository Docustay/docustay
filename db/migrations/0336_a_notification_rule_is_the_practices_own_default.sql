-- 0336_a_notification_rule_is_the_practices_own_default
-- Spec 06 (Settings) §3, task 6.1.
--
-- keystone.notification_rule is the practice-level default channel matrix per (topic, role,
-- channel) — read as a fallback BENEATH notification_preference (a person's own explicit
-- per-person override), never instead of it (§11, §10 point 7).
--
-- ★★★ SEEDING WAS DEFERRED WHEN THIS MIGRATION WAS FIRST WRITTEN (task 6.1) — NOW DONE, BELOW, BY
--     TASK 6.3, THE TASK THAT BUILT src/notifications/topics.mjs. §3's own text says the per-tenant
--     seed rows (one per topic × role × applicable channel) are seeded "at migration time," but the
--     topic vocabulary did not exist yet when 6.1 wrote this table — task 6.1's own STOP note (kept
--     below, unedited, as the record of that decision) named FOUR of the nine topics as measured-
--     confirmed and left FIVE as plain English requiring a real lookup.
--   ★ TASK 6.3's OWN MEASUREMENT (src/notifications/topics.mjs's own header comment, in full) found
--     SEVEN of the nine resolve to a real, currently-emitted three-segment topic — NOT the same four
--     6.1 guessed at (6.1's `booking.confirmed`/`documents.to_sign`/`money.receipt` are not real
--     topic strings at all: the real vocabulary is three dot-segments, `event_topic_check`, and
--     `booking.booking.confirmed` itself is declared but never emitted) — and TWO (waitlist offer,
--     task assigned) do not exist anywhere in `src/` and are deliberately NOT seeded; see
--     `src/notifications/topics.mjs`'s own closing comment for the full measured reasoning on both.
--   ★ 6.1's original note, for the record:
--     "Four of the nine topics are named exactly (booking.confirmed, booking.cancelled,
--     documents.to_sign, money.receipt); the other five are named only in plain English (booking
--     reminder, waitlist offer, document countersign needed, invoice overdue, task assigned) and
--     must be matched against existing keystone.event topics already emitted by those flows — a
--     lookup this migration cannot perform without either guessing the exact dotted topic strings
--     or reaching into src/notifications/topics.mjs, which does not exist yet."
CREATE TABLE keystone.notification_rule (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  topic    text NOT NULL,
  role     text NOT NULL CHECK (role IN ('owner_admin','coach','client_parent')),
  channel  text NOT NULL CHECK (channel IN ('in_app','email','push')),
  enabled  boolean NOT NULL DEFAULT true,
  locked   boolean NOT NULL DEFAULT false,
  UNIQUE (tenant_id, topic, role, channel)
);

-- ── RLS — ENABLE and FORCE, three tenant policies, same discipline every tenant-scoped table in
--    this codebase uses (0013/0065/0202/0265). ─────────────────────────────────────────────────
ALTER TABLE keystone.notification_rule ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.notification_rule FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON keystone.notification_rule
  USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert ON keystone.notification_rule
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update ON keystone.notification_rule
  FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
          WITH CHECK (tenant_id = keystone.require_tenant_id());

GRANT SELECT, INSERT, UPDATE ON keystone.notification_rule TO app_rw;

COMMENT ON TABLE keystone.notification_rule IS
  'Spec 06 §3 (tasks 6.1/6.3). The practice-level default channel matrix per (topic, role, channel), '
  'read as a fallback beneath notification_preference''s per-person override (fanOut(), spec 06 §11). '
  'Seeded below, one row per topic × role × applicable channel, for every tenant that exists at '
  'migration time (src/notifications/topics.mjs is the source of the seeded topics; two of the nine '
  'plain-English names in §3 resolve to no real emitter and are not seeded — see that file''s header).';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ TASK 6.3 — THE SEED, ONE ROW PER (topic, role, channel) FOR EVERY EXISTING TENANT.
--
-- ★★ WHY A LOOP, NOT A BARE `INSERT … SELECT id FROM keystone.tenant`. `db/migrate.mjs` runs every
--    migration as `app_owner`, and `notification_rule` is ENABLE+FORCE ROW LEVEL SECURITY (above) —
--    FORCE applies to the table owner too. With no `keystone.tenant_id` GUC set,
--    `keystone.require_tenant_id()` (the `tenant_insert` policy's own WITH CHECK) raises, so a bare
--    cross-tenant INSERT would not silently match zero rows here (unlike the `UPDATE` that started
--    0072's own investigation) — it would refuse outright, on the very first row. The loop sets
--    `keystone.tenant_id` per tenant, LOCAL to this transaction (`true`, the same idiom 0072 uses),
--    so this migration inserts exactly as the application itself would, under the same policies.
--
-- ★ SEVEN TOPICS, THREE ROLES, THREE CHANNELS = 63 ROWS PER TENANT. `locked` matches
--   `NOTIFICATION_TOPICS[].alwaysOn` (src/notifications/topics.mjs) exactly — the four rows the
--   frame renders as static "Always on" text, never a control, refused by `setNotificationRule`
--   (src/notifications/writes.mjs) regardless of what a caller requests.
-- ★ `enabled = false` FOR PUSH, EVERY ROW, EVEN THE FOUR ALWAYSON TOPICS — §3's own words, quoted at
--   this file's own top: "enabled=true for everything except push which seeds enabled=false." Push
--   has no working sender today (`src/notifications/send.mjs`'s own header: `PRODUCTION_SENDERS`
--   deliberately excludes it, `device_token` holds zero rows) — seeding it "on" would show a
--   practice a channel promising delivery that cannot happen yet, for a topic it cannot even turn
--   off to stop being told so.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $seed_notification_rule$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT id FROM keystone.tenant LOOP
    PERFORM set_config('keystone.tenant_id', t.id::text, true);

    INSERT INTO keystone.notification_rule (tenant_id, topic, role, channel, enabled, locked)
    SELECT t.id, topics.topic, roles.role, channels.channel,
           (channels.channel <> 'push'),
           topics.locked
      FROM (VALUES
        ('booking.booking.created',   true),
        ('booking.booking.cancelled', true),
        ('documents.document.sent',   true),
        ('money.invoice.paid',        true),
        ('booking.booking.reminder',  false),
        ('documents.document.signed', false),
        ('money.invoice.opened',      false)
      ) AS topics(topic, locked)
      CROSS JOIN (VALUES ('owner_admin'), ('coach'), ('client_parent')) AS roles(role)
      CROSS JOIN (VALUES ('in_app'), ('email'), ('push')) AS channels(channel)
    ON CONFLICT (tenant_id, topic, role, channel) DO NOTHING;
  END LOOP;
END
$seed_notification_rule$;
