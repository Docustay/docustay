-- 0405_waitlist_offered_host
-- Stage 13, found in-flight 25 Sep 2026 while closing the offer→claim wire. Not a planned task;
-- recorded in DECISIONS-MADE-FOR-TY.md and RUN-TRACKER.md.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE DEFECT THIS CLOSES: A FLEXIBLE WAITER COULD NOT CLAIM THE OFFER THEY WERE SENT.
--
--     `offerFreedSlot`/`offerTime` (`src/booking/waitlist.mjs`) put the offered host into the
--     `booking.waitlist.offered` EVENT PAYLOAD and nowhere else. `claimOffer` then read the host
--     back off the ENTRY — `entry.host_id` — and passed it to `createPublicBooking`, whose first
--     guard is:
--
--         if (!hostId) throw invalid("a coach or coachSlug is required");   -- publicBooking.mjs:436
--
--     ★★ `host_id` IS NULL FOR EXACTLY THE PEOPLE A WAITLIST EXISTS TO SERVE. It records the host
--        this person ASKED for, and NULL means "anyone" — the `flexible` preference kind. So the
--        flexible waiter received an email saying a time had come up, clicked "Take it", and was
--        refused with a message about a coach they were never asked to choose. MEASURED against
--        `preferenceMatches` (`waitlist.mjs:67`), which reads NULL as "no host constraint".
--
-- ★★★ WHY A NEW COLUMN AND NOT `host_id = COALESCE(host_id, $offered)`. That was the first fix and
--     it is wrong. `host_id` is a PREFERENCE; the offered host is a fact about ONE TRANSIENT OFFER.
--     Writing the offer into the preference permanently pins a flexible waiter to whichever coach
--     happened to free a slot — and because the taken / declined / expired paths all put the entry
--     back to `waiting`, that pin SURVIVES a refused offer and silently narrows every future match
--     through `preferenceMatches`. The person asked for anyone and would quietly stop being offered
--     anyone. ★ A transient fact belongs in the transient group.
--
-- ★★ SO IT JOINS THE OFFER GROUP — `offered_starts_at` · `offered_ends_at` · `offer_expires_at` —
--    set together in both offer functions and cleared together in all four places that release an
--    offer (`claimOffer`'s SlotTaken path and its sibling-release, `declineOffer`, and the
--    `waitlist_offer_expiry` job in `src/queue/tasks.mjs`). Same lifetime, same clearing, same row.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

ALTER TABLE keystone.booking_waitlist_entry
  ADD COLUMN offered_host_id uuid NULL REFERENCES keystone.app_user(id) ON DELETE SET NULL;

-- ★ `ON DELETE SET NULL`, matching `host_id` and `client_user_id` on this table (0314:20-21): a
--   retired coach must not block the row, and the entry is never deleted (0314's own rule — "never
--   deleted, only transitioned"). A NULLed offer then behaves as a lapsed one, which is correct:
--   the coach who was going to take it no longer exists.

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE SHAPE CHECK IS TIGHTENED, NOT REPLACED. 0314's `waitlist_offer_shape` said an 'offered'
--     row must carry `offered_starts_at` and `offer_expires_at`. It could not mention a column that
--     did not exist. ★★ The whole defect above was an 'offered' row with NO HOST ON IT that the
--     database was happy to store — so the database now refuses it, and `claimOffer` can no longer
--     be handed a null by any path, including one written later by someone who has not read this.
--   ★ NOT WEAKENED: every conjunct of the original survives verbatim; one is added.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- Existing 'offered' rows predate the column and would fail the tightened check. There is no real
-- client data (CLAUDE.md, production state 22 Sep 2026: Docustay and test practices only), but this is
-- written to be correct anywhere: an offer that cannot name its host is a lapsed offer, and the
-- entry goes back to `waiting` exactly as the expiry job would have put it.
UPDATE keystone.booking_waitlist_entry
   SET status = 'waiting', offered_starts_at = NULL, offered_ends_at = NULL,
       offer_expires_at = NULL, offered_host_id = NULL, updated_at = now()
 WHERE status = 'offered' AND offered_host_id IS NULL;

ALTER TABLE keystone.booking_waitlist_entry
  DROP CONSTRAINT waitlist_offer_shape;

ALTER TABLE keystone.booking_waitlist_entry
  ADD CONSTRAINT waitlist_offer_shape CHECK (
    status <> 'offered' OR (offered_starts_at IS NOT NULL
                            AND offer_expires_at IS NOT NULL
                            AND offered_host_id  IS NOT NULL)
  );

-- ★★ NO NEW GRANT AND NO NEW POLICY. This is a column on an existing table whose RLS is already
--    ENABLE + FORCE (0314:48-49) with the standard tenant-scoped SELECT/INSERT/UPDATE set and no
--    DELETE. A column inherits the table's policies; `app_rw` holds table-level UPDATE here, so
--    nothing is regranted. (Contrast `keystone.link_token`, where the grant IS column-level and a
--    new column would need a decision — CCR-16.)

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- SELF-CHECK — the migration proves its own effect rather than trusting that it ran.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_col    boolean;
  v_check  text;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'keystone' AND table_name = 'booking_waitlist_entry'
       AND column_name = 'offered_host_id' AND is_nullable = 'YES'
  ) INTO v_col;
  IF NOT v_col THEN
    RAISE EXCEPTION '0405: offered_host_id is missing or not nullable';
  END IF;

  SELECT pg_get_constraintdef(oid) INTO v_check
    FROM pg_constraint
   WHERE conname = 'waitlist_offer_shape'
     AND conrelid = 'keystone.booking_waitlist_entry'::regclass;
  IF v_check IS NULL THEN
    RAISE EXCEPTION '0405: waitlist_offer_shape did not survive the rebuild';
  END IF;
  -- ★ All three conjuncts, named individually: a check that mentions only the new column would
  --   pass while having silently dropped the two 0314 required.
  IF v_check NOT LIKE '%offered_host_id%'
     OR v_check NOT LIKE '%offered_starts_at%'
     OR v_check NOT LIKE '%offer_expires_at%' THEN
    RAISE EXCEPTION '0405: waitlist_offer_shape lost a conjunct: %', v_check;
  END IF;

  -- ★★ POSITIVE CONTROL for the constraint — the negative case ("an offered row with no host is
  --    refused") is worthless unless the SAME block proves a COMPLETE offered row is ACCEPTED. A
  --    check that refuses everything would sail through a negative-only probe.
  --
  -- ★★★ NEITHER PROBE ROW IS DELETED — IT IS ROLLED BACK. 0314 gives this table NO DELETE grant and
  --     NO `FOR DELETE` policy, on purpose ("never deleted, only transitioned"), and its RLS is
  --     ENABLE **and FORCE**, which binds the table owner too. A `DELETE` here would therefore fail
  --     for any runner that is not a superuser — cleanup that only works by accident of who ran it.
  --     Instead each probe INSERT lives in its own plpgsql sub-transaction that is ALWAYS unwound by
  --     an exception, so no row ever survives the block on any path. ★ plpgsql variables are not
  --     transactional, so the outcome recorded before the unwind still reads correctly afterwards.
  DECLARE
    v_tenant  uuid;
    v_service uuid;
    v_host    uuid;
    v_refused boolean := false;
    v_allowed boolean := false;
  BEGIN
    SELECT t.id INTO v_tenant FROM keystone.tenant t LIMIT 1;
    IF v_tenant IS NULL THEN
      RAISE NOTICE '0405: no tenant in this database — constraint behaviour unproven here';
      RETURN;
    END IF;
    SELECT s.id INTO v_service FROM keystone.service s WHERE s.tenant_id = v_tenant LIMIT 1;
    SELECT u.id INTO v_host    FROM keystone.app_user u WHERE u.tenant_id = v_tenant LIMIT 1;
    IF v_service IS NULL OR v_host IS NULL THEN
      RAISE NOTICE '0405: no service/app_user to build a probe row — constraint behaviour unproven here';
      RETURN;
    END IF;

    -- NEGATIVE: an 'offered' row with no host must be refused by `waitlist_offer_shape`.
    BEGIN
      INSERT INTO keystone.booking_waitlist_entry
        (tenant_id, kind, service_id, display_name, email, position, status,
         offered_starts_at, offer_expires_at, offered_host_id)
      VALUES (v_tenant, 'slot', v_service, '0405 probe', 'probe@example.invalid', 2147483600, 'offered',
              now(), now() + interval '1 hour', NULL);
      v_refused := false;
      RAISE EXCEPTION 'KEYSTONE_0405_UNWIND';   -- it was accepted; unwind, then fail loudly below
    EXCEPTION
      WHEN check_violation THEN v_refused := true;
      WHEN raise_exception THEN NULL;           -- our own unwind; v_refused stays false
    END;
    IF NOT v_refused THEN
      RAISE EXCEPTION '0405: an offered row with NO offered_host_id was ACCEPTED — the check is not doing its job';
    END IF;

    -- POSITIVE CONTROL: the same row WITH a host must be accepted. Unwound the same way.
    BEGIN
      INSERT INTO keystone.booking_waitlist_entry
        (tenant_id, kind, service_id, display_name, email, position, status,
         offered_starts_at, offer_expires_at, offered_host_id)
      VALUES (v_tenant, 'slot', v_service, '0405 probe', 'probe@example.invalid', 2147483601, 'offered',
              now(), now() + interval '1 hour', v_host);
      v_allowed := true;
      RAISE EXCEPTION 'KEYSTONE_0405_UNWIND';
    EXCEPTION
      WHEN check_violation THEN v_allowed := false;
      WHEN raise_exception THEN NULL;           -- our own unwind; v_allowed stays true
    END;
    IF NOT v_allowed THEN
      RAISE EXCEPTION '0405: a COMPLETE offered row was refused — the check is too strict';
    END IF;
  END;
END $$;
