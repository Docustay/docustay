-- 0531 — 0530 ALSO DID NOTHING. Same night, same mistake, caught by re-checking rather than trusting
-- the migration runner's own "ok".
--
-- ★★★ 0530 set `NO FORCE ROW LEVEL SECURITY` on `notification_rule` (correct — that table's rows
--     needed writing across every tenant) but its seed INSERT and its own self-check both read FROM
--     `keystone.tenant` DIRECTLY — a table 0530 never touched the RLS of. `keystone.tenant` keeps its
--     own FORCE RLS (deliberately — see 0017/0525's own reasoning), so `app_owner` still saw ZERO
--     tenant rows there. The seed's `CROSS JOIN keystone.tenant` produced zero rows the same way
--     0336's original loop produced zero iterations — a DIFFERENT mechanical shape, the SAME root
--     cause, not actually fixed. WORSE: 0530's own self-check computed `v_tenants` from the same
--     blocked read, got 0, and asserted `v_rows = v_tenants * 63` — 0 = 0, a PASS that checked
--     nothing. MEASURED: `SELECT count(*) FROM keystone.notification_rule` — still 0, after 0530
--     ran and reported "0 notification_rule row(s) seeded across 0 tenant(s)" (printed by 0530's own
--     NOTICE, which said this out loud and should have been read as a failure, not a completion).
--
-- ★ THE ACTUAL FIX: enumerate tenants through `keystone.tenant_timezones_for_health()` — the ONE
--   sanctioned SECURITY DEFINER resolver built for exactly this "a context-free connection needs
--   every tenant id" problem (0017_health_tenant_lister.sql), the same mechanism 0525 (F-BUILD-18)
--   used successfully for the SAME class of bug earlier the same night. `notification_rule` itself
--   still needs its own `NO FORCE` for the INSERT to write across tenants (that part of 0530 was
--   correct) — only the tenant-enumeration side was wrong.
--
-- ★★ THE SELF-CHECK THIS TIME ASSERTS A POSITIVE CONTROL FIRST — `v_tenants > 0` — before trusting
--    the `v_rows = v_tenants * 63` comparison at all, specifically so a second re-introduction of
--    this exact bug cannot pass silently again.

ALTER TABLE keystone.notification_rule NO FORCE ROW LEVEL SECURITY;

INSERT INTO keystone.notification_rule (tenant_id, topic, role, channel, enabled, locked)
SELECT h.id, topics.topic, roles.role, channels.channel,
       (channels.channel <> 'push'),
       topics.locked
  FROM keystone.tenant_timezones_for_health() h
  CROSS JOIN (VALUES
    ('booking.booking.created',   true),
    ('booking.booking.cancelled', true),
    ('documents.document.sent',   true),
    ('money.invoice.paid',        true),
    ('booking.booking.reminder',  false),
    ('documents.document.signed', false),
    ('money.invoice.opened',      false)
  ) AS topics(topic, locked)
  CROSS JOIN (VALUES ('owner_admin'), ('member'), ('client_parent')) AS roles(role)
  CROSS JOIN (VALUES ('in_app'), ('email'), ('push')) AS channels(channel)
ON CONFLICT (tenant_id, topic, role, channel) DO NOTHING;

ALTER TABLE keystone.notification_rule FORCE ROW LEVEL SECURITY;

DO $the_seed_is_actually_real_this_time$
DECLARE
  v_tenants integer;
  v_rows    integer;
  v_coach   integer;
BEGIN
  SELECT count(*) INTO v_tenants FROM keystone.tenant_timezones_for_health();

  ALTER TABLE keystone.notification_rule NO FORCE ROW LEVEL SECURITY;
  SELECT count(*) INTO v_rows FROM keystone.notification_rule;
  SELECT count(*) INTO v_coach FROM keystone.notification_rule WHERE role = 'coach';
  ALTER TABLE keystone.notification_rule FORCE ROW LEVEL SECURITY;

  -- ★★★ POSITIVE CONTROL, ASSERTED FIRST: if this fails, the comparison below would pass vacuously
  --     (0 = 0*63), exactly the way 0530's own self-check silently did.
  IF v_tenants = 0 THEN
    RAISE EXCEPTION '0531: tenant_timezones_for_health() returned 0 tenants — the enumeration itself is broken again, the comparison below cannot be trusted';
  END IF;

  IF v_rows <> v_tenants * 63 THEN
    RAISE EXCEPTION '0531: expected exactly % rows (% tenant(s) × 63), found %', v_tenants * 63, v_tenants, v_rows;
  END IF;
  IF v_coach > 0 THEN
    RAISE EXCEPTION '0531: % notification_rule row(s) still have role = coach', v_coach;
  END IF;

  RAISE NOTICE '0531: % notification_rule row(s) seeded across % real tenant(s), 0 leftover coach rows', v_rows, v_tenants;
END
$the_seed_is_actually_real_this_time$;
