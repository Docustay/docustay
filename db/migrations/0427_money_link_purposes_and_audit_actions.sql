-- 0427_money_link_purposes_and_audit_actions.sql — Stage 15 task 15.4 (F08-money.md, CT-F40/CT-F41).
--
-- Two independent widenings in one migration, per the plan's own bracket:
--   (1) keystone.link_token.purpose's CHECK gains three money purposes.
--   (2) keystone.audit_action gains three money audit actions, seeded with 0249's exact bracket.
--
-- ★★★ (1) — THE CURRENT CHECK WAS READ FROM MIGRATION HISTORY, NOT A LIVE DATABASE. No local
--    database URL was available to this build agent (KEYSTONE_ADMIN_URL / KEYSTONE_DATABASE_URL are
--    unset here; the only *_PG_URL present, KEYSTONE_DEPLOYED_SUPERUSER_PG_URL, is the DEPLOYED
--    database and this task's own hard limits forbid connecting to it). Source used instead: EVERY
--    migration file was grepped for `link_token_purpose_check` (`grep -rl link_token_purpose_check
--    db/migrations/`), which returns exactly three hits up through 0423 (the highest migration number
--    on disk at build time) — 0169 (seeds 'document_signature'), 0203 (widens to +'invite',
--    +'client_invite'; its own header records the MEASURED live-database read that did this at the
--    time, `pg_get_constraintdef = CHECK ((purpose = 'document_signature'::text))` before the widen),
--    and 0315 (widens to +'waitlist_claim', header re-confirms by the same grep that 0203 is the only
--    earlier migration to touch it). No migration after 0315 and up to 0423 touches it. So the CHECK
--    this migration widens FROM, as measured by migration-file history: 'document_signature',
--    'invite', 'client_invite', 'waitlist_claim' — all four carried forward unchanged below; only the
--    three money purposes are new.
--
-- ★ (1), role handling — MEASURED DISCREPANCY, reported plainly rather than guessed past. This
--    task's own field 6 says to read `pg_class.relowner` and add `SET LOCAL ROLE <owner>` / back
--    "exactly as 0315 did". Read in full (db/migrations/0315_link_token_waitlist_claim_purpose.sql),
--    0315 contains NO relowner read and NO SET LOCAL ROLE anywhere in the file — nor does 0203, the
--    other migration that widened this exact same constraint on this exact same table. Both are
--    plain `DROP CONSTRAINT` / `ADD CONSTRAINT` with no role switch, and both already sit below the
--    current migration head (0423) without incident. Absent database access to read
--    `pg_class.relowner` myself, this migration follows what 0203 and 0315 ACTUALLY did (the real,
--    twice-repeated, already-applied precedent for this table) rather than the plan's citation of
--    0315, which does not match the file. Flagged for opus-tester / Ty: if step 3 shows the
--    migration-runner role does not in fact own keystone.link_token, that is new information neither
--    the plan's citation nor this migration's own reading of history predicted.
--
-- ★★ (2) — same bracket idiom as 0249_staff_viewed_as_audit_action.sql (itself citing
--    0218_feature_flag_seed.sql): keystone.audit_action is ENABLE+FORCE with exactly one policy
--    (`audit_action_read`, SELECT only, 0183:101-107) and no INSERT policy/grant for `app_owner` (the
--    role every migration runs as), so FORCE is suspended, the three rows are seeded
--    ON CONFLICT DO NOTHING, and FORCE is restored and proven back on before this migration ends.
--
-- Written during BUILD. NOT APPLIED — the migration runner applies this at step 3 (TEST), never here.
-- ★ No BEGIN/COMMIT here: db/migrate.mjs:328,336 wraps every migration file in its own BEGIN/COMMIT
--   before `client.query(m.sql)` runs it — the same idiom 0249 and 0315 both follow (neither has its
--   own BEGIN/COMMIT either).

-- ── (1) three new link-token purposes ─────────────────────────────────────────────────────────────
ALTER TABLE keystone.link_token DROP CONSTRAINT link_token_purpose_check;
ALTER TABLE keystone.link_token ADD CONSTRAINT link_token_purpose_check
  CHECK (purpose IN ('document_signature', 'invite', 'client_invite', 'waitlist_claim',
                      'invoice_view', 'estimate_accept', 'card_update'));
--                   ^^^^^^^^^^^^^^^^^^^^ ^^^^^^^^ ^^^^^^^^^^^^^^^ ^^^^^^^^^^^^^^^ 0169/0203/0315's
--                   four existing values, carried forward unchanged. The last three are new:
--                   'invoice_view' (subject_type "invoice"), 'estimate_accept' (subject_type
--                   "estimate"), 'card_update' (subject_type "person" — the payer whose card is
--                   updated, not a payment method).

COMMENT ON CONSTRAINT link_token_purpose_check ON keystone.link_token IS
  'Stage 15 / 0427 (CT-F40/CT-F41). Widened from 0315''s four values to add invoice_view,
   estimate_accept, card_update: money-flow purposes minted at email time (15.37) and redeemed by
   15.34. PURPOSE_SUBJECT_TYPE (src/auth/linkToken.mjs) gets the matching three entries in this same
   task, not a later one.';

-- ── (2) three new audit actions, 0249's exact bracket ───────────────────────────────────────────────
ALTER TABLE keystone.audit_action NO FORCE ROW LEVEL SECURITY;

INSERT INTO keystone.audit_action (key) VALUES
  ('invoice.voided'),
  ('payment.recorded_offline'),
  ('dispute.evidence_sent')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE keystone.audit_action FORCE ROW LEVEL SECURITY;

-- ★★ PROVE FORCE IS BACK ON, and the three rows are readably present — 0249's own two assertions,
--    mirrored for three keys instead of one.
DO $$
DECLARE forced boolean;
BEGIN
  SELECT relforcerowsecurity INTO forced FROM pg_class WHERE oid = 'keystone.audit_action'::regclass;
  IF NOT forced THEN
    RAISE EXCEPTION '0427: FORCE ROW LEVEL SECURITY was not restored on keystone.audit_action';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM keystone.audit_action WHERE key = 'invoice.voided') THEN
    RAISE EXCEPTION '0427: invoice.voided was not seeded into keystone.audit_action';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM keystone.audit_action WHERE key = 'payment.recorded_offline') THEN
    RAISE EXCEPTION '0427: payment.recorded_offline was not seeded into keystone.audit_action';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM keystone.audit_action WHERE key = 'dispute.evidence_sent') THEN
    RAISE EXCEPTION '0427: dispute.evidence_sent was not seeded into keystone.audit_action';
  END IF;
END $$;
