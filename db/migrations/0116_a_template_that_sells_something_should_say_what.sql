-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- P9.4 — WHAT A TEMPLATE SELLS. THE JOIN THAT WAS NEVER THERE.
--
-- ★★★ [EXECUTED 2026-09-15] `document_template` has NINE columns — id · tenant_id · builder · name ·
--     version · active · created_at · updated_at · body — and not one of them says what the
--     agreement is FOR. So **the price on every agreement this system has ever sent was typed by a
--     human and checked against nothing.** A coach writing "$250 per session" into the prose of a
--     contract was the entire pricing control.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ KEYSTONE'S CATALOGUE IS THE SOURCE OF TRUTH; STRIPE MIRRORS IT (KS-12.0). So `sells_id`
--     REFERENCES this database, and a template can never point at a Stripe object.
--
--     A template picking from a Stripe price list would put the authority **outside the tenant
--     boundary, outside RLS and outside §Z4's price law** — the same defect this project already
--     refused for Novu, OpenFGA and Listmonk. It would also mean an agreement's price could change
--     because somebody edited a product in a dashboard, with no version, no window and no record.
--
-- ★★★ POLYMORPHIC, AND THE FK IS THE PART THAT CANNOT BE SKIPPED. `sells_type` names which
--     catalogue table `sells_id` points into — service, package or plan — and Postgres cannot write
--     a foreign key across three tables. So `sells_target_exists` (a trigger) does what the FK
--     would: it refuses an id that is not in the named table, IN THIS TENANT. Without it, a typo'd
--     uuid is a template that will refuse to send and nobody will know why until a coach tries.
--   ★ `line_item` already carries the same polymorphic shape and the same problem (P2.7). This is
--     that pattern, applied where the money is DECIDED rather than where it is recorded.
--
-- ★★ `none` IS A REAL AND COMMON ANSWER, AND IT IS THE DEFAULT. A consent form, a disclosure, a
--    session note — most documents sell nothing, and a template that had to name a product would
--    make somebody invent one. `none` with a null id is the shape those keep.
--
-- ★★★ AND THE PRICE IS **NOT** COPIED ONTO THE TEMPLATE. It resolves at SEND from the active price
--     row and freezes at EXECUTE. A price stored here would be `price_minor` all over again — the
--     exact defect retired one phase ago (`F76`), where two numbers claimed to be the price and the
--     stale one was on the thing a person reads.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

ALTER TABLE keystone.document_template
  ADD COLUMN IF NOT EXISTS sells_type text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS sells_id   uuid;

ALTER TABLE keystone.document_template
  ADD CONSTRAINT document_template_sells_type_check
  CHECK (sells_type IN ('none', 'service', 'package', 'plan'));

-- ★★★ THE PAIR MUST AGREE. `none` with an id is a template pointing at a product it claims not to
--     sell; a product type with no id is a template that sells "a service" and cannot say which.
--     Both are unrepresentable rather than merely discouraged.
ALTER TABLE keystone.document_template
  ADD CONSTRAINT sells_pair_agrees
  CHECK ((sells_type = 'none' AND sells_id IS NULL)
         OR (sells_type <> 'none' AND sells_id IS NOT NULL));

CREATE OR REPLACE FUNCTION keystone.sells_target_exists()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  found boolean;
BEGIN
  IF NEW.sells_type = 'none' THEN RETURN NEW; END IF;

  -- ★★ TENANT-SCOPED, AND THAT IS NOT A DETAIL. Without `tenant_id = NEW.tenant_id` a template could
  --    name another practice's service — the id would resolve, the price would come from somebody
  --    else's catalogue, and RLS would never see it because this runs inside the trigger.
  EXECUTE format(
    'SELECT EXISTS (SELECT 1 FROM keystone.%I WHERE id = $1 AND tenant_id = $2)', NEW.sells_type)
    INTO found USING NEW.sells_id, NEW.tenant_id;

  IF NOT found THEN
    RAISE EXCEPTION
      'this template says it sells the % %, and no such % exists in this practice. A template '
      'pointing at nothing refuses to send, and the coach who hits that has no way to tell why.',
      NEW.sells_type, NEW.sells_id, NEW.sells_type
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION keystone.sells_target_exists() IS
  'P9.4. The foreign key Postgres cannot express: sells_id must exist in the table sells_type names, IN THIS TENANT. Without it a typo is a template that fails at send with no explanation.';

DROP TRIGGER IF EXISTS sells_target_exists ON keystone.document_template;
CREATE TRIGGER sells_target_exists
  BEFORE INSERT OR UPDATE ON keystone.document_template
  FOR EACH ROW
  WHEN (NEW.sells_type <> 'none')
  EXECUTE FUNCTION keystone.sells_target_exists();

COMMENT ON COLUMN keystone.document_template.sells_type IS
  'P9.4. none (default) · service · package · plan. What this agreement is FOR. The PRICE is not stored here — it resolves at send from the active price row (§Z4) and freezes at execute.';
