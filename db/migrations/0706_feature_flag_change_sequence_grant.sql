-- 0706 · THE FEATURE-FLAG CHANGE LOG COULD NEVER BE WRITTEN (Run 6, part 7). Additive and idempotent.
-- Found by measurement, not by reading: test/kill_switches.test.mjs failed every flag flip with "permission denied for sequence feature_flag_change_id_seq".
-- 0213 made keystone.feature_flag_change with `id bigserial` and granted app_rw SELECT + INSERT on the TABLE, but a bigserial default calls nextval() on its own SEQUENCE
-- and the sequence got no grant: it is the only sequence in schema keystone, owner-only. So setFlagForPractice() — which appends a history row in the same transaction as the
-- override — could not complete as app_rw: a practice's kill switch (stripe_enabled, resend_enabled, n8n_send, s3_enabled, turnstile_enabled …) could not be changed at runtime.
-- USAGE is what nextval needs; SELECT (currval/last_value) is not given — nothing reads it. No UPDATE/DELETE on the table changes, so the log stays append-only.
GRANT USAGE ON SEQUENCE keystone.feature_flag_change_id_seq TO app_rw;

DO $check$
BEGIN
  IF NOT pg_catalog.has_sequence_privilege('app_rw', 'keystone.feature_flag_change_id_seq', 'USAGE') THEN
    RAISE EXCEPTION '0706: app_rw still cannot use keystone.feature_flag_change_id_seq — the change log is unwritable';
  END IF;
  IF pg_catalog.has_table_privilege('app_rw', 'keystone.feature_flag_change', 'UPDATE') OR pg_catalog.has_table_privilege('app_rw', 'keystone.feature_flag_change', 'DELETE') THEN
    RAISE EXCEPTION '0706: app_rw holds UPDATE or DELETE on keystone.feature_flag_change — the log must stay append-only';
  END IF;
END
$check$;
