-- 0415_gift_card — Stage 14 task 14.8 · §0.4 A
--
-- keystone.gift_card: an issued balance whose code is never stored in clear — only a peppered
-- code_hash. keystone.gift_card_entry: the append-only ledger that IS the balance (running
-- SUM(delta_minor)), never a stored counter column, so a race between two concurrent redemptions
-- cannot both read a stale total and both pass — see the trigger below, which takes a transaction-
-- scoped advisory lock on the gift card BEFORE reading the running sum, the same idiom
-- `src/money/invoiceNumbers.mjs` uses to serialise invoice-number allocation per tenant
-- (`lockKeyFor`/`nextInvoiceNumber`, `invoiceNumbers.mjs:35,120`), keyed here on the gift card
-- rather than the tenant.
--
-- Shape follows CT-F52 in full, copied from the two most recent complete precedents
-- (`0402_booking_block.sql`, `0382_staff_shift_and_time_off.sql`) for BOTH tables: ENABLE+FORCE RLS,
-- tenant policies, the reference-guard read policy, the refuse_touch_reference_rows triggers
-- (ENABLE ALWAYS, with the temporary EXECUTE lend — 0402's header: not optional), tenant-leading
-- unique indexes, the grants, and a closing self-check DO block with positive controls.
--
-- Field 4 literally: `voided_by`, `gift_card_entry.invoice_id` and `gift_card_entry.created_by`
-- carry NO foreign-key annotation in the plan text (unlike `buyer_user_id`/`holder_user_id`, each
-- explicitly "(app_user FK)", and `purchased_invoice_id`, explicitly "plain FK → invoice(id)") — so
-- those three are plain, unconstrained uuid columns here, built exactly as named and no further.

CREATE TABLE keystone.gift_card (
  id                   uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id            uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  number               integer     NOT NULL,                    -- rendered "GC-0001" by the route
  -- ★★ THE CODE IS NEVER STORED IN CLEAR. Peppered hash only; there is no plaintext `code` column.
  code_hash            bytea       NOT NULL,

  buyer_user_id        uuid        NULL,
  holder_email         text        NULL,
  holder_user_id       uuid        NULL,

  issued_minor         integer     NOT NULL CHECK (issued_minor > 0),
  currency             text        NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),

  expires_at           timestamptz NULL,
  voided_at            timestamptz NULL,
  voided_by            uuid        NULL,                        -- no FK named in field 4

  purchased_invoice_id uuid        NULL REFERENCES keystone.invoice(id) ON DELETE SET NULL,

  opened_at            timestamptz NULL,
  nudged_at            timestamptz NULL,

  CONSTRAINT gift_card_buyer_user_fkey
    FOREIGN KEY (tenant_id, buyer_user_id) REFERENCES keystone.app_user (tenant_id, id)
    ON DELETE SET NULL (buyer_user_id),
  CONSTRAINT gift_card_holder_user_fkey
    FOREIGN KEY (tenant_id, holder_user_id) REFERENCES keystone.app_user (tenant_id, id)
    ON DELETE SET NULL (holder_user_id)
);

-- so keystone.gift_card_entry can use a composite FK (§0.4 A).
CREATE UNIQUE INDEX gift_card_tenant_id_key      ON keystone.gift_card (tenant_id, id);
CREATE UNIQUE INDEX gift_card_tenant_number_key  ON keystone.gift_card (tenant_id, number);
CREATE UNIQUE INDEX gift_card_tenant_code_hash_key ON keystone.gift_card (tenant_id, code_hash);

ALTER TABLE keystone.gift_card ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.gift_card FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON keystone.gift_card USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert    ON keystone.gift_card FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update    ON keystone.gift_card FOR UPDATE
  USING (tenant_id = keystone.current_tenant_id()) WITH CHECK (tenant_id = keystone.require_tenant_id());

-- No tenant_delete: a gift card is voided (voided_at/voided_by), never deleted.
GRANT SELECT, INSERT, UPDATE ON keystone.gift_card TO app_rw;

CREATE TRIGGER gift_card_touch BEFORE UPDATE ON keystone.gift_card
  FOR EACH ROW EXECUTE FUNCTION keystone.touch_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- keystone.gift_card_entry — APPEND-ONLY LEDGER. Balance is the running SUM(delta_minor), never a
-- stored column. No touch trigger (field 4: "no touch"); app_rw gets SELECT, INSERT ONLY — a ledger
-- that can be rewritten is not a ledger.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE keystone.gift_card_entry (
  id            uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id     uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  created_at    timestamptz NOT NULL DEFAULT now(),

  gift_card_id  uuid        NOT NULL,
  delta_minor   integer     NOT NULL CHECK (delta_minor <> 0),
  kind          text        NOT NULL CHECK (kind IN ('issue', 'redeem', 'void')),
  invoice_id    uuid        NULL,                                -- no FK named in field 4
  created_by    uuid        NULL,                                -- no FK named in field 4

  CONSTRAINT gift_card_entry_card_fkey
    FOREIGN KEY (tenant_id, gift_card_id) REFERENCES keystone.gift_card (tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX gift_card_entry_card_idx ON keystone.gift_card_entry (tenant_id, gift_card_id);

ALTER TABLE keystone.gift_card_entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.gift_card_entry FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON keystone.gift_card_entry USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert    ON keystone.gift_card_entry FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());

-- No tenant_update, no tenant_delete: append-only.
GRANT SELECT, INSERT ON keystone.gift_card_entry TO app_rw;   -- SELECT, INSERT only — no UPDATE, no DELETE

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- gift_card_never_overdrawn — BEFORE INSERT. Raises in MINOR UNITS; the route formats dollars, this
-- migration never formats currency. NOT SECURITY DEFINER: app_rw already holds SELECT on
-- keystone.gift_card_entry (above), so the invoking role's own privilege reaches every row this
-- query needs, scoped by tenant_isolation exactly as everywhere else — no second, hand-written
-- tenant_id filter here either, for the same reason `invoiceNumbers.mjs:132-133` gives: a second
-- isolation mechanism is the one that drifts.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE FUNCTION keystone.gift_card_never_overdrawn()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_balance_before integer;
BEGIN
  -- ★★★ Serialise concurrent redemptions of THIS gift card before reading its balance — the same
  --     idiom as `nextInvoiceNumber` (`src/money/invoiceNumbers.mjs:35` lockKeyFor, `:120`
  --     pg_advisory_xact_lock), keyed on the gift card id instead of the tenant id. Transaction-
  --     scoped: released at COMMIT or ROLLBACK, no unlock call to strand.
  PERFORM pg_advisory_xact_lock(
    ('x' || substr(replace(NEW.gift_card_id::text, '-', ''), 1, 15))::bit(60)::bigint
  );

  SELECT COALESCE(sum(delta_minor), 0) INTO v_balance_before
    FROM keystone.gift_card_entry
   WHERE gift_card_id = NEW.gift_card_id;

  IF v_balance_before + NEW.delta_minor < 0 THEN
    RAISE EXCEPTION 'Only % left on it.', v_balance_before
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER gift_card_never_overdrawn BEFORE INSERT ON keystone.gift_card_entry
  FOR EACH ROW EXECUTE FUNCTION keystone.gift_card_never_overdrawn();
-- ★ REHEARSAL FIX (25 Sep 2026): the self-check below requires tgenabled='A' and a plain CREATE
-- TRIGGER lands as 'O' — MEASURED against a copy of production. The check encodes the intent (the
-- overdraw guard fires under every session_replication_role); the DDL forgot the ALTER.
ALTER TABLE keystone.gift_card_entry ENABLE ALWAYS TRIGGER gift_card_never_overdrawn;

-- ═══ CT-F52 §3.2 points (3)(4)(5) — THE REFERENCE-PRACTICE GUARD HALF, BOTH TABLES ══════════════
-- ★★★ THE EXECUTE LEND IS NOT OPTIONAL. `keystone.refuse_touch_reference_rows()` is owned by
--     `reference_guard` (0144:245) and 0099:83 revoked ALL on it FROM PUBLIC. 0151:91-110 verbatim.
SET LOCAL ROLE reference_guard;
GRANT EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() TO app_owner;
SET LOCAL ROLE app_owner;

CREATE TRIGGER gift_card_refuse_reference_delete_trg AFTER DELETE ON keystone.gift_card
  REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT
  EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.gift_card ENABLE ALWAYS TRIGGER gift_card_refuse_reference_delete_trg;
CREATE TRIGGER gift_card_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.gift_card
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.gift_card ENABLE ALWAYS TRIGGER gift_card_refuse_reference_truncate_trg;

CREATE TRIGGER gift_card_entry_refuse_reference_delete_trg AFTER DELETE ON keystone.gift_card_entry
  REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT
  EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.gift_card_entry ENABLE ALWAYS TRIGGER gift_card_entry_refuse_reference_delete_trg;
CREATE TRIGGER gift_card_entry_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.gift_card_entry
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.gift_card_entry ENABLE ALWAYS TRIGGER gift_card_entry_refuse_reference_truncate_trg;

SET LOCAL ROLE reference_guard;
REVOKE EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() FROM app_owner;
SET LOCAL ROLE app_owner;

GRANT SELECT ON keystone.gift_card TO reference_guard;
CREATE POLICY reference_guard_read ON keystone.gift_card FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));

GRANT SELECT ON keystone.gift_card_entry TO reference_guard;
CREATE POLICY reference_guard_read ON keystone.gift_card_entry FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));

-- ═══ CT-F52 §3.2 point (6) — THE SELF-CHECK, BOTH TABLES, WITH POSITIVE CONTROLS ═════════════════
DO $ct_f52_self_check$
DECLARE n int;
BEGIN
  -- ── keystone.gift_card ─────────────────────────────────────────────────────────────────────────
  IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'keystone.gift_card'::regclass) THEN
    RAISE EXCEPTION '0415 — keystone.gift_card is not FORCE ROW LEVEL SECURITY';
  END IF;

  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'keystone' AND tablename = 'gift_card'
     AND policyname IN ('tenant_isolation','tenant_insert','tenant_update','reference_guard_read');
  IF n <> 4 THEN
    RAISE EXCEPTION '0415 — expected 4 policies on gift_card, found %', n;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='keystone'
              AND tablename='gift_card' AND policyname='tenant_delete') THEN
    RAISE EXCEPTION '0415 — gift_card has a tenant_delete policy but no delete path; remove one or the other';
  END IF;

  SELECT count(*) INTO n FROM pg_trigger
   WHERE tgrelid = 'keystone.gift_card'::regclass
     AND tgname IN ('gift_card_refuse_reference_delete_trg','gift_card_refuse_reference_truncate_trg')
     AND tgenabled = 'A';
  IF n <> 2 THEN
    RAISE EXCEPTION '0415 — both refuse_touch_reference_rows triggers must exist and be ENABLE ALWAYS on gift_card, found %', n;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
     WHERE polrelid = 'keystone.gift_card'::regclass
       AND polname = 'reference_guard_read'
       AND polroles = ARRAY['reference_guard'::regrole::oid]
       AND polcmd = 'r'
       AND polpermissive
  ) THEN
    RAISE EXCEPTION '0415 — reference_guard_read on gift_card must be TO reference_guard ONLY, FOR SELECT, PERMISSIVE (CT-F52 point 4b)';
  END IF;

  -- ★ Positive controls, in the same block.
  IF NOT has_table_privilege('app_rw', 'keystone.gift_card', 'SELECT') THEN
    RAISE EXCEPTION '0415 — app_rw is missing SELECT on gift_card';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.gift_card', 'INSERT') THEN
    RAISE EXCEPTION '0415 — app_rw is missing INSERT on gift_card';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.gift_card', 'UPDATE') THEN
    RAISE EXCEPTION '0415 — app_rw lost UPDATE on gift_card; this check is not merely asserting absences';
  END IF;
  IF NOT has_table_privilege('reference_guard', 'keystone.gift_card', 'SELECT') THEN
    RAISE EXCEPTION '0415 — reference_guard has no SELECT on gift_card; its policy would have nothing underneath it';
  END IF;
  IF has_table_privilege('app_rw', 'keystone.gift_card', 'DELETE') THEN
    RAISE EXCEPTION '0415 — app_rw must NOT hold DELETE on gift_card (a card is voided, never deleted)';
  END IF;

  -- ── keystone.gift_card_entry ───────────────────────────────────────────────────────────────────
  IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'keystone.gift_card_entry'::regclass) THEN
    RAISE EXCEPTION '0415 — keystone.gift_card_entry is not FORCE ROW LEVEL SECURITY';
  END IF;

  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'keystone' AND tablename = 'gift_card_entry'
     AND policyname IN ('tenant_isolation','tenant_insert','reference_guard_read');
  IF n <> 3 THEN
    RAISE EXCEPTION '0415 — expected 3 policies on gift_card_entry, found %', n;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='keystone'
              AND tablename='gift_card_entry' AND policyname IN ('tenant_update','tenant_delete')) THEN
    RAISE EXCEPTION '0415 — gift_card_entry must carry no tenant_update/tenant_delete policy — it is append-only';
  END IF;

  SELECT count(*) INTO n FROM pg_trigger
   WHERE tgrelid = 'keystone.gift_card_entry'::regclass
     AND tgname IN ('gift_card_entry_refuse_reference_delete_trg','gift_card_entry_refuse_reference_truncate_trg')
     AND tgenabled = 'A';
  IF n <> 2 THEN
    RAISE EXCEPTION '0415 — both refuse_touch_reference_rows triggers must exist and be ENABLE ALWAYS on gift_card_entry, found %', n;
  END IF;

  SELECT count(*) INTO n FROM pg_trigger
   WHERE tgrelid = 'keystone.gift_card_entry'::regclass
     AND tgname = 'gift_card_never_overdrawn' AND tgenabled = 'A';
  IF n <> 1 THEN
    RAISE EXCEPTION '0415 — gift_card_never_overdrawn (BEFORE INSERT) must be attached and enabled on gift_card_entry, found %', n;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
     WHERE polrelid = 'keystone.gift_card_entry'::regclass
       AND polname = 'reference_guard_read'
       AND polroles = ARRAY['reference_guard'::regrole::oid]
       AND polcmd = 'r'
       AND polpermissive
  ) THEN
    RAISE EXCEPTION '0415 — reference_guard_read on gift_card_entry must be TO reference_guard ONLY, FOR SELECT, PERMISSIVE (CT-F52 point 4b)';
  END IF;

  -- ★ Positive controls, in the same block.
  IF NOT has_table_privilege('app_rw', 'keystone.gift_card_entry', 'SELECT') THEN
    RAISE EXCEPTION '0415 — app_rw is missing SELECT on gift_card_entry';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.gift_card_entry', 'INSERT') THEN
    RAISE EXCEPTION '0415 — app_rw is missing INSERT on gift_card_entry';
  END IF;
  IF NOT has_table_privilege('reference_guard', 'keystone.gift_card_entry', 'SELECT') THEN
    RAISE EXCEPTION '0415 — reference_guard has no SELECT on gift_card_entry; its policy would have nothing underneath it';
  END IF;
  IF has_table_privilege('app_rw', 'keystone.gift_card_entry', 'UPDATE') THEN
    RAISE EXCEPTION '0415 — app_rw must NOT hold UPDATE on gift_card_entry — a ledger you can rewrite is not a ledger';
  END IF;
  IF has_table_privilege('app_rw', 'keystone.gift_card_entry', 'DELETE') THEN
    RAISE EXCEPTION '0415 — app_rw must NOT hold DELETE on gift_card_entry — append-only';
  END IF;
END $ct_f52_self_check$;

-- Written, not applied.
