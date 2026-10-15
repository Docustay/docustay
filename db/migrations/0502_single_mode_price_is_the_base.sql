-- 0502_single_mode_price_is_the_base
--
-- A service sold in exactly ONE delivery mode whose only open price row carries that same mode has no
-- base price, so `current_price('service', id)` — asked with no mode, as the online-booking summary,
-- the items list and the record queries ask — finds nothing and falls back to the legacy
-- `service.price_minor`. The row IS the base price; the mode on it is redundant. [MEASURED 25 Sep 2026:
-- the Docustay import wrote the Stripe product's type onto its price — 10 of 13 services, all 17 plans.]
--
-- `delivery_mode` is not append-only (`price_is_append_only` locks amount, currency, subject,
-- effective_from and a set effective_to), so clearing it changes no amount and no issued invoice.
-- Every other shape — a second mode, a location variation, an existing base row — is left alone.
-- ★ price and service are FORCE RLS: without NO FORCE the migration role sees no tenant's rows and the
--   UPDATE matches zero rows silently (it did, on the first rehearsal). The 0249/0433 pattern.

ALTER TABLE keystone.price   NO FORCE ROW LEVEL SECURITY;
ALTER TABLE keystone.service NO FORCE ROW LEVEL SECURITY;

UPDATE keystone.price p
   SET delivery_mode = NULL
  FROM keystone.service s
 WHERE p.subject_type = 'service'
   AND p.subject_id = s.id
   AND p.tenant_id = s.tenant_id
   AND p.effective_to IS NULL
   AND p.location_id IS NULL
   AND cardinality(s.delivery_modes) = 1
   AND p.delivery_mode = s.delivery_modes[1]
   AND NOT EXISTS (
     SELECT 1 FROM keystone.price o
      WHERE o.tenant_id = p.tenant_id AND o.subject_type = 'service' AND o.subject_id = p.subject_id
        AND o.effective_to IS NULL AND o.id <> p.id);

-- A plan has no delivery_modes of its own; a plan whose ONLY open price carries a mode has no base
-- either (the 17 Docustay packages — each is already one mode by name). Its only price is the base.
UPDATE keystone.price p
   SET delivery_mode = NULL
 WHERE p.subject_type = 'plan'
   AND p.effective_to IS NULL
   AND p.location_id IS NULL
   AND p.delivery_mode IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM keystone.price o
      WHERE o.tenant_id = p.tenant_id AND o.subject_type = 'plan' AND o.subject_id = p.subject_id
        AND o.effective_to IS NULL AND o.id <> p.id);

DO $check$
DECLARE n int;
BEGIN
  -- positive control: the check can see price rows at all (a database with none proves nothing here)
  SELECT count(*) INTO n FROM keystone.price;
  RAISE NOTICE '0502: % price row(s) visible to the check', n;
  IF EXISTS (
    SELECT 1 FROM keystone.price p JOIN keystone.service s ON s.id = p.subject_id AND s.tenant_id = p.tenant_id
     WHERE p.subject_type = 'service' AND p.effective_to IS NULL AND p.location_id IS NULL
       AND cardinality(s.delivery_modes) = 1 AND p.delivery_mode = s.delivery_modes[1]
       AND NOT EXISTS (SELECT 1 FROM keystone.price o
                        WHERE o.tenant_id = p.tenant_id AND o.subject_type = 'service'
                          AND o.subject_id = p.subject_id AND o.effective_to IS NULL AND o.id <> p.id)
  ) THEN
    RAISE EXCEPTION '0502: a single-mode service still has only a mode-specific open price';
  END IF;
  IF EXISTS (SELECT 1 FROM keystone.price p
              WHERE p.subject_type = 'plan' AND p.effective_to IS NULL AND p.location_id IS NULL
                AND p.delivery_mode IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM keystone.price o WHERE o.tenant_id = p.tenant_id
                                  AND o.subject_type = 'plan' AND o.subject_id = p.subject_id
                                  AND o.effective_to IS NULL AND o.id <> p.id)) THEN
    RAISE EXCEPTION '0502: a plan still has only a mode-specific open price';
  END IF;
END
$check$;

ALTER TABLE keystone.price   FORCE ROW LEVEL SECURITY;
ALTER TABLE keystone.service FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'keystone.price'::regclass)
     OR NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'keystone.service'::regclass) THEN
    RAISE EXCEPTION '0502: FORCE ROW LEVEL SECURITY was not restored';
  END IF;
END $$;
