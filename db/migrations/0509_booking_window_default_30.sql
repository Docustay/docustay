-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0509 · the default booking window is 30 days, not 60 (B-6, R-71).
--
-- 0013 created keystone.booking_policy.booking_window_days with DEFAULT 60. R-71 rules the default
-- for a NEW service's booking policy should be 30 days ahead, not 60. This only changes the column
-- DEFAULT applied on future inserts that omit the value — every already-saved policy row keeps
-- whatever booking_window_days it was given (60, or any other value an Owner/Admin has since set).
-- Idempotent: ALTER COLUMN ... SET DEFAULT is a no-op to re-run.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

ALTER TABLE keystone.booking_policy ALTER COLUMN booking_window_days SET DEFAULT 30;

