-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0511 · B-3 — ONE REQUIREMENT MECHANISM. specs/de-code/CONTRACTS.md §1:
-- `item_agreement_requirement.kind text NOT NULL DEFAULT 'agreement' CHECK (kind IN ('agreement',
-- 'intake'))`; UNIQUE becomes `(tenant_id, item_type, item_id, kind)`; every `service.
-- intake_form_id IS NOT NULL` copied in as a `kind='intake'` row with `hold_until_signed = true`;
-- `document_template.material boolean NOT NULL DEFAULT false`.
--
-- ★★★ WHY THIS TABLE GROWS A SECOND KIND INSTEAD OF A SECOND TABLE. `service.intake_form_id`
--     (0410) is its OWN, separate "does this service need a form" flag, read by nothing that also
--     reads `item_agreement_requirement` — two mechanisms answering the same shape of question
--     ("does buying/booking this item require a document first") for the same service, which is
--     exactly the two-places-the-same-fact-can-drift shape CLAUDE.md's failure #3 warns about.
--     Folding `intake_form_id` in as a `kind='intake'` row means `src/booking/requirements.mjs`'s
--     `requirementsFor` is the ONE reader either fact goes through from here on.
-- ★★ `kind` DEFAULTS `'agreement'` so every existing row (created before this column existed) reads
--    exactly as it always has — nothing is reclassified.
-- ★ The UNIQUE constraint being widened is `item_agreement_requirement_tenant_id_item_type_item_id_
--   key` (0269:17's own inline, unnamed `UNIQUE (tenant_id, item_type, item_id)` — Postgres auto-
--   names it `<table>_<cols>_key`, the same rule 0147:47 and 0309's own header both measure for an
--   identical shape). Widening it (rather than leaving it alone) is what LETS a service carry both
--   an `agreement` row and a folded `intake` row at once, which the fold below immediately needs.
-- ★ `document_template.material` — 15C shipped versioning with no way to say a new version is a
--   REQUIRED re-sign, not an edit nobody has to act on. `false` by default: publishing a new version
--   does not, by itself, force anyone already signed to sign again.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- §a · item_agreement_requirement.kind
ALTER TABLE keystone.item_agreement_requirement
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'agreement'
    CONSTRAINT item_agreement_requirement_kind_check CHECK (kind IN ('agreement', 'intake'));

-- §b · widen the UNIQUE constraint so (tenant_id, item_type, item_id) may carry one row per kind.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'keystone.item_agreement_requirement'::regclass
       AND conname  = 'item_agreement_requirement_tenant_id_item_type_item_id_key'
  ) THEN
    ALTER TABLE keystone.item_agreement_requirement
      DROP CONSTRAINT item_agreement_requirement_tenant_id_item_type_item_id_key;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'keystone.item_agreement_requirement'::regclass
       AND conname  = 'item_agreement_requirement_kind_unique'
  ) THEN
    ALTER TABLE keystone.item_agreement_requirement
      ADD CONSTRAINT item_agreement_requirement_kind_unique
      UNIQUE (tenant_id, item_type, item_id, kind);
  END IF;
END
$$;

-- §c · fold every service.intake_form_id into a kind='intake' row, hold_until_signed = true.
-- ON CONFLICT against the now-widened unique constraint makes this safe to re-run (a duplicate run,
-- or a service that already got an intake row some other way, inserts nothing a second time).
INSERT INTO keystone.item_agreement_requirement
  (tenant_id, item_type, item_id, template_id, kind, hold_until_signed)
SELECT s.tenant_id, 'service', s.id, s.intake_form_id, 'intake', true
  FROM keystone.service s
 WHERE s.intake_form_id IS NOT NULL
ON CONFLICT ON CONSTRAINT item_agreement_requirement_kind_unique DO NOTHING;

-- §d · document_template.material
ALTER TABLE keystone.document_template
  ADD COLUMN IF NOT EXISTS material boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN keystone.item_agreement_requirement.kind IS
  'B-3 (F793) — agreement (the original, presence-based requirement) | intake (folded in from
   service.intake_form_id by 0511, so requirementsFor is the one reader of either fact).';
COMMENT ON COLUMN keystone.document_template.material IS
  'B-3 (F793) — a material new version forces a re-sign: src/booking/requirements.mjs
   currentExecutedInstance treats the newest material=true version of a lineage as the floor an
   executed instance''s own version must meet or beat. false by default — most new versions are not.';

-- §e · shape check.
DO $$
DECLARE
  v_missing_intake int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'keystone' AND table_name = 'item_agreement_requirement' AND column_name = 'kind'
  ) THEN
    RAISE EXCEPTION '0511: item_agreement_requirement.kind missing after ALTER';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'keystone' AND table_name = 'document_template' AND column_name = 'material'
  ) THEN
    RAISE EXCEPTION '0511: document_template.material missing after ALTER';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'keystone.item_agreement_requirement'::regclass
       AND conname  = 'item_agreement_requirement_kind_unique'
       AND contype  = 'u'
  ) THEN
    RAISE EXCEPTION '0511: item_agreement_requirement_kind_unique does not exist';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'keystone.item_agreement_requirement'::regclass
       AND conname  = 'item_agreement_requirement_tenant_id_item_type_item_id_key'
  ) THEN
    RAISE EXCEPTION '0511: the old, narrower UNIQUE constraint is still present';
  END IF;

  -- ★ Positive control alongside the negative: every service with an intake_form_id DOES now have a
  --   matching kind='intake' row — the fold actually ran, not merely "the column exists".
  SELECT count(*) INTO v_missing_intake
    FROM keystone.service s
   WHERE s.intake_form_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM keystone.item_agreement_requirement r
        WHERE r.tenant_id = s.tenant_id AND r.item_type = 'service' AND r.item_id = s.id
          AND r.kind = 'intake' AND r.template_id = s.intake_form_id
     );
  IF v_missing_intake > 0 THEN
    RAISE EXCEPTION '0511: % service(s) with intake_form_id have no folded kind=intake row', v_missing_intake;
  END IF;

  RAISE NOTICE '0511: item_agreement_requirement.kind + widened UNIQUE + intake fold, document_template.material — all present.';
END
$$;

