-- 0585 · "RUNNING LOW" IS LEVEL-TRIGGERED (QUEUE §12.3, specs/CREDITS-PIPELINE.md defect 15).
-- The old rule fired only at the exact moment `remaining === threshold` (edge-triggered): a missed run, a credit that went back up and down,
-- or a threshold set to a value already passed, and the warning never came. Now a sweep warns once per entitlement while remaining is at or
-- under the practice's threshold, and the warning RE-ARMS when remaining climbs back above it. The ledger of "we warned" is the existing
-- `entitlement_warned`, which gets a second kind.
ALTER TABLE keystone.entitlement_warned DROP CONSTRAINT IF EXISTS entitlement_warned_kind_check;
ALTER TABLE keystone.entitlement_warned ADD CONSTRAINT entitlement_warned_kind_check CHECK (kind IN ('expiring', 'running_low'));
GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.entitlement_warned TO app_rw, app_worker;
