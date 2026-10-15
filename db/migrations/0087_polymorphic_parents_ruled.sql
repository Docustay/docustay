-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- P2.7 — THE POLYMORPHIC PARENT, RULED ONCE, AND APPLIED TO BOTH TABLES THAT HAVE ONE.
--
-- ★★★ THE MEASURED STATE. `line_item` attaches by `parent_type`/`parent_id` with a CHECK on the TYPE
--     and **NO FOREIGN KEY ON `parent_id`**. Nothing prevents an orphan: a line item can name an
--     invoice that never existed, or one that has since been deleted, and the database is content.
--     The same is true of `source_type`/`source_id`, which the item does not mention and which has
--     the identical defect.
--
-- ★★★ AND TWO OF THE FOUR PERMITTED PARENT TYPES NAME TABLES THAT DO NOT EXIST.
--     [MEASURED] `line_item_parent_type_check` permits `booking | invoice | contract | quote`.
--     `to_regclass('keystone.contract')` → NULL. `to_regclass('keystone.quote')` → NULL.
--   ★★ **A CHECK CONSTRAINT ENUMERATING STATES NOTHING CAN EVER REACH** — recon sweep #13. It reads
--      as a specification of a feature and is a promise the database is making on behalf of code
--      nobody wrote. `contract` was a real concept under a wrong name (a contract IS a
--      `document_instance`); `quote` is not in this schema at all.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE RULING, AND ITS BOUNDARY — BOTH BRANCHES, BECAUSE THE ANSWER IS NOT THE SAME EVERYWHERE
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
--
--   A · FEW, KNOWN, STABLE PARENT TYPES (two or three)  →  **AN EXCLUSIVE ARC OF REAL FOREIGN KEYS.**
--       One nullable column per type, each a genuine composite FK, plus a CHECK that exactly one is
--       set. Postgres then enforces existence AND cascade behaviour itself, with no trigger to
--       maintain and nothing to forget. Adding a type costs a migration — **which is correct**,
--       because a new parent type also needs a cascade decision and a screen.
--       → `line_item`, both of its arcs.
--
--   B · MANY, OPEN-ENDED TYPES (a registry that grows with the product)  →  **A TRIGGER.**
--       `custom_field_value.record_id` refers to whatever `record_type` says, and that set is the
--       RECORD-TYPE REGISTRY — seven today and one more with every descriptor. An exclusive arc of
--       seven nullable columns, growing forever, is worse than the problem: every new record type
--       would require a migration to gain a custom field, which is the opposite of what a custom
--       field is for.
--       → `custom_field_value`, carried as debt since P2.2 precisely so this item would sweep it.
--
-- ★★ AND THE TRIGGER'S LIMIT IS STATED RATHER THAN GLOSSED. It enforces existence AT WRITE TIME. It
--    does NOT stop a later DELETE of the parent from orphaning the value — that would need a trigger
--    on each of the seven parent tables, which is the maintenance burden branch B exists to avoid.
--    **P2.9's archive-not-delete ruling is what actually bounds that**, and until it lands the
--    exposure is real and small: an orphaned custom value renders nowhere, because every read joins
--    through a record that has to exist to be on screen.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- ── A · line_item — THE PARENT ARC ──────────────────────────────────────────────────────────────
-- ★ `document_instance` is the table a "contract" actually is. Naming the column after the table,
--   not the concept, is what stops the next reader looking for `keystone.contract` again.
ALTER TABLE keystone.line_item ADD COLUMN booking_id  uuid;
ALTER TABLE keystone.line_item ADD COLUMN invoice_id  uuid;
ALTER TABLE keystone.line_item ADD COLUMN document_id uuid;

-- ★★ The backfill is a no-op and that is MEASURED, not assumed: `SELECT parent_type, count(*) FROM
--    line_item GROUP BY 1` returned ZERO ROWS before this migration was written. It is written
--    anyway, because a migration that only works on an empty table is one that fails the first time
--    it meets a populated one.
UPDATE keystone.line_item SET booking_id  = parent_id WHERE parent_type = 'booking';
UPDATE keystone.line_item SET invoice_id  = parent_id WHERE parent_type = 'invoice';
UPDATE keystone.line_item SET document_id = parent_id WHERE parent_type = 'contract';

-- ★★★ REFUSE TO PROCEED IF ANY ROW WOULD BE STRANDED. A row whose parent_type is `quote` has no
--     column to move to, and silently leaving it with three NULLs would fail the CHECK below with a
--     message about the CHECK rather than about the data. Fail here, where the reason is legible.
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM keystone.line_item
   WHERE booking_id IS NULL AND invoice_id IS NULL AND document_id IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION 'refusing to convert line_item: % row(s) have a parent_type this migration has '
      'nowhere to put (most likely ''quote'', which names no table). Decide what they belong to '
      'before running this.', n;
  END IF;
END $$;

ALTER TABLE keystone.line_item
  ADD CONSTRAINT line_item_booking_fkey
  FOREIGN KEY (tenant_id, booking_id) REFERENCES keystone.booking (tenant_id, id)
  ON DELETE CASCADE;

-- ★ An invoice needs a unique (tenant_id, id) to be pointed at, same as booking and app_user before
--   it. The primary key is on `id` alone.
CREATE UNIQUE INDEX invoice_tenant_id_id_key ON keystone.invoice (tenant_id, id);

ALTER TABLE keystone.line_item
  ADD CONSTRAINT line_item_invoice_fkey
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES keystone.invoice (tenant_id, id)
  ON DELETE CASCADE;

CREATE UNIQUE INDEX document_instance_tenant_id_id_key
  ON keystone.document_instance (tenant_id, id);

-- ★★★ CASCADE, AND IT IS A DECISION. A line item has no meaning apart from the thing it itemises:
--     an invoice's lines are part of the invoice, not records in their own right. Deleting the
--     parent and keeping the lines would leave money attached to nothing.
--   ★★ AND IT IS SAFE **BECAUSE** OF WHAT P2.6 AND P2.9 DO, not in spite of it: an invoice that has
--      been sent is VOIDED, never deleted, and P2.9 makes that the rule for every object carrying a
--      signature or a payment. A cascade that can only fire on a record nobody may delete is a
--      cascade that cannot lose anything.
ALTER TABLE keystone.line_item
  ADD CONSTRAINT line_item_document_fkey
  FOREIGN KEY (tenant_id, document_id) REFERENCES keystone.document_instance (tenant_id, id)
  ON DELETE CASCADE;

-- ★★★ EXACTLY ONE PARENT. §Z3.15 already says a line item is never shared — "copy it instead" — and
--     until now that was a sentence in a writer. This is the sentence as a constraint: the arc
--     cannot be empty (an orphan) and cannot be double (a line on two invoices).
ALTER TABLE keystone.line_item
  ADD CONSTRAINT line_item_exactly_one_parent
  CHECK ((booking_id IS NOT NULL)::int + (invoice_id IS NOT NULL)::int
       + (document_id IS NOT NULL)::int = 1);

CREATE INDEX line_item_invoice_idx  ON keystone.line_item (tenant_id, invoice_id)  WHERE invoice_id  IS NOT NULL;
CREATE INDEX line_item_booking_idx  ON keystone.line_item (tenant_id, booking_id)  WHERE booking_id  IS NOT NULL;
CREATE INDEX line_item_document_idx ON keystone.line_item (tenant_id, document_id) WHERE document_id IS NOT NULL;

-- ★★★ AND THE OLD PAIR GOES. Keeping `parent_type`/`parent_id` beside the arc would be two
--     representations of one fact — the DUPLICATE-TRUTH class this register has recorded four times —
--     and the unconstrained one is always the one that drifts. **`quote` disappears with them**,
--     which is the honest way to remove a state nothing could ever set: not by editing the CHECK to
--     pretend it was never offered, but by replacing the mechanism that offered it.
ALTER TABLE keystone.line_item DROP CONSTRAINT line_item_parent_type_check;
ALTER TABLE keystone.line_item DROP COLUMN parent_type;
ALTER TABLE keystone.line_item DROP COLUMN parent_id;

-- ── A2 · line_item — THE SOURCE ARC, WHICH THE ITEM DOES NOT MENTION AND WHICH HAS THE SAME DEFECT ─
-- ★★ `source_type`/`source_id` names the catalogue entry a line came from — service, package or plan
--    — and carries NO foreign key either. Fixing the parent and leaving this is fixing the instance
--    rather than the class, in the same table, in the same migration.
--  ★★★ BUT THE CASCADE IS THE OPPOSITE WAY ROUND, and that is the whole reason it needs its own
--      thought rather than a copy-paste. A line item is NOT part of its source: `name_snapshot`
--      exists precisely so the line still reads correctly "even after the catalogue entry is renamed
--      or retired". **SET NULL, never CASCADE** — retiring a service must not delete the history of
--      having sold it.
ALTER TABLE keystone.line_item ADD COLUMN service_id uuid;
ALTER TABLE keystone.line_item ADD COLUMN package_id uuid;
ALTER TABLE keystone.line_item ADD COLUMN plan_id    uuid;

UPDATE keystone.line_item SET service_id = source_id WHERE source_type = 'service';
UPDATE keystone.line_item SET package_id = source_id WHERE source_type = 'package';
UPDATE keystone.line_item SET plan_id    = source_id WHERE source_type = 'plan';

CREATE UNIQUE INDEX service_tenant_id_id_key ON keystone.service (tenant_id, id);
CREATE UNIQUE INDEX package_tenant_id_id_key ON keystone.package (tenant_id, id);
CREATE UNIQUE INDEX plan_tenant_id_id_key    ON keystone.plan    (tenant_id, id);

ALTER TABLE keystone.line_item
  ADD CONSTRAINT line_item_service_fkey
  FOREIGN KEY (tenant_id, service_id) REFERENCES keystone.service (tenant_id, id)
  ON DELETE SET NULL (service_id);

ALTER TABLE keystone.line_item
  ADD CONSTRAINT line_item_package_fkey
  FOREIGN KEY (tenant_id, package_id) REFERENCES keystone.package (tenant_id, id)
  ON DELETE SET NULL (package_id);

ALTER TABLE keystone.line_item
  ADD CONSTRAINT line_item_plan_fkey
  FOREIGN KEY (tenant_id, plan_id) REFERENCES keystone.plan (tenant_id, id)
  ON DELETE SET NULL (plan_id);

-- ★★ AT MOST ONE, NOT EXACTLY ONE — the asymmetry with the parent arc is deliberate. `SET NULL`
--    means a line whose catalogue entry has been deleted legitimately ends up with all three null,
--    and `name_snapshot` is what keeps it readable. Requiring exactly one would make the SET NULL
--    it is paired with impossible to perform.
ALTER TABLE keystone.line_item
  ADD CONSTRAINT line_item_at_most_one_source
  CHECK ((service_id IS NOT NULL)::int + (package_id IS NOT NULL)::int
       + (plan_id IS NOT NULL)::int <= 1);

ALTER TABLE keystone.line_item DROP CONSTRAINT line_item_source_type_check;
ALTER TABLE keystone.line_item DROP COLUMN source_type;
ALTER TABLE keystone.line_item DROP COLUMN source_id;

-- ── B · custom_field_value — THE TRIGGER BRANCH ─────────────────────────────────────────────────
-- ★★★ WHY NOT AN ARC HERE: `record_type` is the RECORD-TYPE REGISTRY, seven entries today and one
--     more with every descriptor P2.8 and P6 add. An arc would mean a migration before any new
--     record type could hold a custom field — the opposite of what a custom field is for.
--   ★ SECURITY DEFINER with an empty search_path, and REVOKEd from PUBLIC in the same migration
--     (F155: the default function ACL is EXECUTE TO PUBLIC and it is silent).
CREATE OR REPLACE FUNCTION keystone.custom_field_value_record_exists()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_exists boolean;
  v_type   text;
BEGIN
  -- ★★★ THE RECORD TYPE IS ON THE FIELD, NOT ON THE VALUE — which is better than it first looks and
  --     is why this reads it rather than trusting a column on NEW. `custom_field` declares what it is
  --     a field OF; the value only names which field and which record. **So the type cannot disagree
  --     with itself**, and there is nothing to keep in step. [MEASURED: `custom_field_value` is
  --     (tenant_id, field_id, record_id, value, updated_by, updated_at) — no record_type at all, and
  --     the first draft of this trigger assumed there was one.]
  SELECT f.record_type INTO v_type
    FROM keystone.custom_field f
   WHERE f.id = NEW.field_id AND f.tenant_id = NEW.tenant_id;

  IF v_type IS NULL THEN
    -- ★ The composite FK on (tenant_id, field_id) already refuses this, so reaching here means the
    --   FK was dropped. Fail loudly rather than waving the row through on the assumption that some
    --   other constraint is still doing its job.
    RAISE EXCEPTION
      'custom field % does not exist in this practice, so there is nothing to attach a value to',
      NEW.field_id USING ERRCODE = '23503';
  END IF;

  -- ★★ ONE BRANCH PER RECORD TYPE, AND AN `ELSE` THAT REFUSES. A record type this function does not
  --    know is not waved through: that is how a registry grows past its enforcement and nobody
  --    notices. Adding a descriptor means adding a line here, and the gate asserts both directions.
  CASE v_type
    WHEN 'person'        THEN SELECT EXISTS(SELECT 1 FROM keystone.app_user          WHERE id = NEW.record_id AND tenant_id = NEW.tenant_id) INTO v_exists;
    WHEN 'account'       THEN SELECT EXISTS(SELECT 1 FROM keystone.account           WHERE id = NEW.record_id AND tenant_id = NEW.tenant_id) INTO v_exists;
    WHEN 'network_party' THEN SELECT EXISTS(SELECT 1 FROM keystone.network_party     WHERE id = NEW.record_id AND tenant_id = NEW.tenant_id) INTO v_exists;
    WHEN 'document'      THEN SELECT EXISTS(SELECT 1 FROM keystone.document_instance WHERE id = NEW.record_id AND tenant_id = NEW.tenant_id) INTO v_exists;
    WHEN 'service'       THEN SELECT EXISTS(SELECT 1 FROM keystone.service           WHERE id = NEW.record_id AND tenant_id = NEW.tenant_id) INTO v_exists;
    WHEN 'plan'          THEN SELECT EXISTS(SELECT 1 FROM keystone.plan              WHERE id = NEW.record_id AND tenant_id = NEW.tenant_id) INTO v_exists;
    WHEN 'subscription'  THEN SELECT EXISTS(SELECT 1 FROM keystone.subscription      WHERE id = NEW.record_id AND tenant_id = NEW.tenant_id) INTO v_exists;
    ELSE
      RAISE EXCEPTION
        'custom field values cannot be stored against a "%" — this trigger knows person, account, '
        'network_party, document, service, plan and subscription. A new record type needs a branch '
        'here, deliberately, rather than being accepted against a table nobody checked.',
        v_type
        USING ERRCODE = '23514';
  END CASE;

  IF NOT v_exists THEN
    RAISE EXCEPTION
      'there is no % with id % in this practice, so a custom field value cannot be attached to it',
      v_type, NEW.record_id
      USING ERRCODE = '23503';
  END IF;

  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION keystone.custom_field_value_record_exists() FROM PUBLIC;

CREATE TRIGGER custom_field_value_record_exists_trg
  BEFORE INSERT OR UPDATE OF field_id, record_id ON keystone.custom_field_value
  FOR EACH ROW EXECUTE FUNCTION keystone.custom_field_value_record_exists();

COMMENT ON CONSTRAINT line_item_exactly_one_parent ON keystone.line_item IS
  'P2.7 — §Z3.15 says a line item is never shared, "copy it instead". This is that sentence as a '
  'constraint: the arc cannot be empty (an orphan) and cannot be double (one line on two invoices). '
  '★ Replaces parent_type/parent_id, which had a CHECK on the TYPE and no foreign key at all — and '
  'which permitted two types, contract and quote, naming tables that do not exist.';

COMMENT ON CONSTRAINT line_item_at_most_one_source ON keystone.line_item IS
  'P2.7 — AT MOST one, deliberately unlike the parent arc. The source FKs are ON DELETE SET NULL '
  'because a line item is not part of its catalogue entry: name_snapshot exists so the line still '
  'reads correctly after the service is renamed or retired. Requiring exactly one would make that '
  'SET NULL impossible to perform.';
