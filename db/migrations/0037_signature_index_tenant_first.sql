-- 0037_signature_index_tenant_first
-- P15C.7 — ★★★ 0036'S TWO UNIQUE INDEXES LED WITH `instance_id`, AND THAT LEAKS ACROSS TENANTS.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE PRE-EXISTING `catalog-conformance` GATE CAUGHT THIS, NOT A REVIEW. Verbatim:
--     "UNIQUE index does not lead with tenant_id (leads with instance_id) — uniqueness checks bypass
--      RLS, so this leaks cross-tenant existence via the violation message."
--
-- ★★ WHY IT IS A REAL LEAK AND NOT A STYLE RULE. **A UNIQUE INDEX IS CHECKED BY THE INDEX, NOT BY A
--    QUERY — so row-level security does not apply to it.** A caller who inserts a row that collides
--    with ANOTHER TENANT'S row gets a uniqueness violation naming the index. They cannot read the other
--    row, but they have just learned it EXISTS. Repeat with guessed ids and the existence of another
--    practice's instruments becomes enumerable.
--   ★ Leading with `tenant_id` means a collision can only ever be with the caller's OWN row, so the
--     violation tells them nothing they did not already have the right to know.
--
-- ★ The uniqueness SEMANTICS are unchanged: `instance_id` already implies exactly one tenant through
--   its foreign key, so (tenant_id, instance_id, role) constrains precisely what (instance_id, role)
--   did. Nothing becomes permitted that was forbidden; only the leak closes.
--
-- ★★ AND THE ORDER TRIGGER'S SUBQUERIES GAIN `tenant_id` TOO. They run as the invoker, so RLS does
--    apply — but a guard that is correct only because of a policy somewhere else is a guard that breaks
--    quietly when the policy changes. Naming the tenant makes it correct on its own terms.

DROP INDEX keystone.signature_record_one_per_party;
DROP INDEX keystone.signature_record_one_per_position;

-- ★★★ ONE SIGNATURE PER PARTY PER INSTRUMENT — now tenant-scoped so a collision cannot be with a row
--     the caller may not see.
CREATE UNIQUE INDEX signature_record_one_per_party
  ON keystone.signature_record (tenant_id, instance_id, role);

-- ★★ AND ONE PARTY PER ORDER POSITION. Two parties both claiming position 2 makes "who signed second"
--    unanswerable, which is the question an order dispute turns on.
CREATE UNIQUE INDEX signature_record_one_per_position
  ON keystone.signature_record (tenant_id, instance_id, signer_order);

-- ═════════════════════════════════════════════════════════════════════════════
-- The order/chain trigger, restated with the tenant named in every read.
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION keystone.signature_record_in_order()
  RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $fn$
DECLARE
  expected  integer;
  last_hash text;
BEGIN
  -- ★ `tenant_id` in the predicate, not relied upon from a policy. Same discipline as every other
  --   tenant-scoped read in this schema.
  SELECT COALESCE(max(signer_order), 0) + 1 INTO expected
    FROM keystone.signature_record
   WHERE tenant_id = NEW.tenant_id AND instance_id = NEW.instance_id;

  IF NEW.signer_order <> expected THEN
    RAISE EXCEPTION
      'this instrument expects signature position % next and this row claims position % — signing out '
      'of order is refused. A countersignature before the client''s signature is not a countersignature; '
      'it is a staff member agreeing with nobody.',
      expected, NEW.signer_order
      USING ERRCODE = 'check_violation';
  END IF;

  IF expected = 1 THEN
    IF NEW.prev_hash IS NOT NULL THEN
      RAISE EXCEPTION 'the FIRST signature on an instrument has no predecessor, so prev_hash must be NULL'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    SELECT row_hash INTO last_hash
      FROM keystone.signature_record
     WHERE tenant_id = NEW.tenant_id AND instance_id = NEW.instance_id
     ORDER BY signer_order DESC LIMIT 1;

    IF NEW.prev_hash IS DISTINCT FROM last_hash THEN
      RAISE EXCEPTION
        'prev_hash does not match the current last signature on this instrument. The chain is what '
        'makes the order provable — a link that does not join is a signature built from a stale read, '
        'or an attempt to insert one behind another.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

COMMENT ON INDEX keystone.signature_record_one_per_party IS
  'P15C.7 / 0037. Tenant-FIRST, because a UNIQUE index is enforced by the index and therefore BYPASSES '
  'RLS: an instance_id-leading version let a caller learn that another tenant''s row existed from the '
  'violation message alone. The uniqueness semantics are identical (instance_id already implies one '
  'tenant via its FK); only the cross-tenant existence leak closes.';
