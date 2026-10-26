-- 0500_real_client_rows_are_read_only
--
-- Ty, 25 Sep 2026: "Michael Young is a real client with $1,900 owed. Once his records are in Mainstay:
-- no test writes against them, no destructive-mode operation, no harness clicking refund, archive or
-- merge on his rows. Mark them so that is enforced rather than remembered."
--
-- §1  A PERSON OR INVOICE CAN BE MARKED A PROTECTED REAL-CLIENT ROW, and the database refuses to
--     change or remove it unless the transaction names why (`keystone.protected_write_reason`).
--     ★ The flag lives ON the protected row, so the guard reads OLD — never a lookup that another
--       tenant context or a missing GUC could make return nothing and wave a write through.
--     ★ Stripe is the money record: a verified Stripe webhook names `stripe_mirror`
--       (src/routes/webhooks.mjs), so a payment Michael makes still marks his invoice paid.
--     ★ app_rw holds table-wide UPDATE on both tables, so a grant cannot protect the flag; the guard
--       does: any UPDATE of a protected person (clearing the flag included) and any change to an
--       invoice's flag is refused without a reason. Setting the flag on is always allowed.
--     Refused without a reason:  app_user  — any UPDATE or DELETE of a protected row
--                                invoice   — DELETE; a change to void/uncollectible; archiving; the flag
--                                line_item — UPDATE or DELETE of a line on a protected invoice
--
-- §2  0490's `UNIQUE NULLS NOT DISTINCT (tenant_id, stripe_invoice_id)` allowed ONE invoice per practice
--     without a Stripe id — the second draft anyone started failed as a duplicate. [MEASURED: 0490:32.]
--     Replaced by a partial unique index over the Stripe ids that exist. No code names the constraint.

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §2 · the invoice Stripe-id uniqueness
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★ 0490 is applied (immutable) — a database that could not apply it because it already held two
--   local invoices is rebuilt fresh (scripts/prepare-fresh-database.mjs), never by editing 0490.
ALTER TABLE keystone.invoice DROP CONSTRAINT IF EXISTS stripe_invoice_id_per_tenant;
CREATE UNIQUE INDEX IF NOT EXISTS invoice_stripe_invoice_id_per_tenant
  ON keystone.invoice (tenant_id, stripe_invoice_id) WHERE stripe_invoice_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §1 · protected real-client rows
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
ALTER TABLE keystone.app_user ADD COLUMN protected_real_client boolean NOT NULL DEFAULT false;
ALTER TABLE keystone.invoice  ADD COLUMN protected_real_client boolean NOT NULL DEFAULT false;

CREATE FUNCTION keystone.refuse_protected_real_client_write() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $fn$
DECLARE
  v_reason text := nullif(btrim(coalesce(current_setting('keystone.protected_write_reason', true), '')), '');
  v_hit    boolean := false;
BEGIN
  IF v_reason IS NOT NULL THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_TABLE_NAME = 'app_user' THEN
    v_hit := OLD.protected_real_client;
  ELSIF TG_TABLE_NAME = 'invoice' THEN
    IF TG_OP = 'DELETE' THEN
      v_hit := OLD.protected_real_client;
    ELSE
      v_hit := OLD.protected_real_client AND (
                 NEW.protected_real_client IS DISTINCT FROM OLD.protected_real_client
              OR (NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('void', 'uncollectible'))
              OR (NEW.archived_at IS NOT NULL AND OLD.archived_at IS NULL));
    END IF;
  ELSIF TG_TABLE_NAME = 'line_item' THEN
    IF OLD.invoice_id IS NOT NULL THEN
      SELECT i.protected_real_client INTO v_hit FROM keystone.invoice i WHERE i.id = OLD.invoice_id;
    END IF;
  END IF;

  IF coalesce(v_hit, false) THEN
    RAISE EXCEPTION 'this is a real client''s record and is read-only (% on keystone.%); a deliberate change must set keystone.protected_write_reason', TG_OP, TG_TABLE_NAME
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$fn$;

CREATE TRIGGER app_user_protected_real_client BEFORE UPDATE OR DELETE ON keystone.app_user
  FOR EACH ROW EXECUTE FUNCTION keystone.refuse_protected_real_client_write();
CREATE TRIGGER invoice_protected_real_client BEFORE UPDATE OR DELETE ON keystone.invoice
  FOR EACH ROW EXECUTE FUNCTION keystone.refuse_protected_real_client_write();
CREATE TRIGGER line_item_protected_real_client BEFORE UPDATE OR DELETE ON keystone.line_item
  FOR EACH ROW EXECUTE FUNCTION keystone.refuse_protected_real_client_write();
ALTER TABLE keystone.app_user  ENABLE ALWAYS TRIGGER app_user_protected_real_client;
ALTER TABLE keystone.invoice   ENABLE ALWAYS TRIGGER invoice_protected_real_client;
ALTER TABLE keystone.line_item ENABLE ALWAYS TRIGGER line_item_protected_real_client;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Self-check — shape, then behaviour with a positive control, on a real tenant, rolled back.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $check$
DECLARE
  v_tenant uuid;
  v_user   uuid;
  v_refused boolean;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stripe_invoice_id_per_tenant') THEN
    RAISE EXCEPTION '0500: the NULLS NOT DISTINCT constraint is still there';
  END IF;
  IF (SELECT count(*) FROM pg_trigger
       WHERE tgname IN ('app_user_protected_real_client','invoice_protected_real_client','line_item_protected_real_client')
         AND tgenabled = 'A') <> 3 THEN
    RAISE EXCEPTION '0500: the three guards are not all ENABLE ALWAYS';
  END IF;

  -- Behaviour, only where a practice with a person exists (the local shared database has many).
  SELECT u.tenant_id, u.id INTO v_tenant, v_user
    FROM keystone.app_user u WHERE u.role <> 'staff' AND NOT u.protected_real_client LIMIT 1;
  IF v_user IS NULL THEN
    RAISE NOTICE '0500: no client row to exercise — guard shape proved, behaviour proved on the next database with one';
    RETURN;
  END IF;

  BEGIN
    PERFORM set_config('keystone.tenant_id', v_tenant::text, true);
    ALTER TABLE keystone.app_user NO FORCE ROW LEVEL SECURITY;

    -- positive control: an unprotected row updates
    UPDATE keystone.app_user SET notes = coalesce(notes, '') WHERE id = v_user;
    IF NOT FOUND THEN RAISE EXCEPTION '0500: positive control — an unprotected row did not update'; END IF;

    UPDATE keystone.app_user SET protected_real_client = true WHERE id = v_user;
    v_refused := false;
    BEGIN
      UPDATE keystone.app_user SET notes = coalesce(notes, '') WHERE id = v_user;
    EXCEPTION WHEN insufficient_privilege THEN v_refused := true;
    END;
    IF NOT v_refused THEN RAISE EXCEPTION '0500: a protected person was updated without a reason'; END IF;

    PERFORM set_config('keystone.protected_write_reason', '0500 self-check', true);
    UPDATE keystone.app_user SET protected_real_client = false WHERE id = v_user;
    IF NOT FOUND THEN RAISE EXCEPTION '0500: a named reason did not let the write through'; END IF;
    PERFORM set_config('keystone.protected_write_reason', '', true);

    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = '0500-rollback';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> '0500-rollback' THEN RAISE; END IF;
  END;
  RAISE NOTICE '0500: guards proved — unprotected row writable, protected row refused, named reason admitted';
END
$check$;

-- The sub-block's rollback undid the NO FORCE with everything else; prove FORCE is intact.
DO $$ BEGIN
  IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'keystone.app_user'::regclass) THEN
    RAISE EXCEPTION '0500: FORCE ROW LEVEL SECURITY is not on keystone.app_user';
  END IF;
END $$;
