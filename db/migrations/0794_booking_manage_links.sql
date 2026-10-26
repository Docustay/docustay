-- 0794 — CHANGE-OR-CANCEL LINKS FOR A BOOKING (Ty, 22 Oct 2026; plan §3 and §4, spec BOOKING-EVERYWHERE §7).
-- A new link-token purpose `booking_manage` (subject: the booking). Minted when a booking is made, read with peekLinkToken
-- (never spent by reading), valid until the booking starts, revoked when it is cancelled. Reuses src/auth/linkToken.mjs —
-- so no new token scheme and no jose (spec conflict 7).
-- ★ WIDENED FROM THE LIVE DEFINITION, never restated by hand (other branches append purposes too).

DO $widen$
DECLARE v_def text; v_vals text[];
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO v_def FROM pg_constraint c
   WHERE c.conrelid = 'keystone.link_token'::regclass AND c.conname = 'link_token_purpose_check';
  IF v_def IS NULL THEN RAISE EXCEPTION '0794: link_token_purpose_check does not exist'; END IF;
  SELECT array_agg(m[1] ORDER BY ord) INTO v_vals FROM regexp_matches(v_def, '''([^'']+)''', 'g') WITH ORDINALITY AS t(m, ord);
  IF coalesce(array_length(v_vals, 1), 0) < 3 THEN RAISE EXCEPTION '0794: could not read the current purposes: %', v_def; END IF;
  IF NOT 'booking_manage' = ANY (v_vals) THEN v_vals := v_vals || 'booking_manage'::text; END IF;
  ALTER TABLE keystone.link_token DROP CONSTRAINT link_token_purpose_check;
  EXECUTE format('ALTER TABLE keystone.link_token ADD CONSTRAINT link_token_purpose_check CHECK (purpose = ANY (%L::text[]))', v_vals);
END
$widen$;
