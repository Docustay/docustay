-- 0024_price_supersede_law
-- P15B.7 · §Z4 · §P7 — THE OLD PRICE ROW IS NEVER EDITED.
--
-- ★★★ §Z4: "the DEFINITION carries no price. A new price row SETS effective_to on the old one and
-- INSERTS a new one. THE OLD ROW IS NEVER EDITED (§P7)."
--
-- ★★ READ THAT CAREFULLY, BECAUSE IT LOOKS SELF-CONTRADICTORY AND IS NOT. Setting `effective_to`
-- IS an UPDATE of the old row — it is the supersede itself. What "never edited" forbids is changing
-- what that row SAYS THE PRICE WAS: `amount_minor`, `currency`, or which thing it priced. Closing a
-- validity window is a statement about WHEN a price applied; changing the amount is a statement
-- that it was always a different number. The first is history; the second is falsifying history.
--
-- ★★★ WHY A TRIGGER AND NOT AN `if` IN THE WRITE MODULE. The same argument P19.8 makes for the
-- embed grant: "an application-code `if` is one refactor away from absent." And the stakes here are
-- higher than they look, because `price` is what an INVOICE was computed from. An UPDATE to
-- `amount_minor` on a superseded row silently rewrites what a client was charged — it changes the
-- past, in the money table, with no trace. ★ P15B.7's red-first says the write must be "refused and
-- the guard NAMES the supersede rule", and only the database can refuse it on every path: a route,
-- a migration, a console, a future admin tool, or `psql`.
--
-- ★ IT IS NOT `readOnlyWhen`. U25 records that a UI flag computed in `buildRecordShell` is "a flag,
--   not a refusal". This is the refusal.

CREATE OR REPLACE FUNCTION keystone.price_is_append_only()
RETURNS trigger
LANGUAGE plpgsql
-- ★★ SET search_path = '' — P21A.6 asserts every function pins it, and an unpinned search_path on a
--    trigger is how a shadowed `keystone` schema would change what this function means.
SET search_path = ''
AS $$
BEGIN
  -- ★ THE PRICE ITSELF IS IMMUTABLE. Each column is named, not diffed as a whole row, so the error
  --   can say WHICH field was being rewritten — a message that names the rule and the column is
  --   actionable; "update refused" is not.
  IF NEW.amount_minor IS DISTINCT FROM OLD.amount_minor THEN
    RAISE EXCEPTION
      'price.amount_minor is append-only (§Z4 supersede rule): a price is never edited. '
      'Close this row by setting effective_to, then INSERT a new price row. '
      'Editing it would silently change what an already-issued invoice was computed from.'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.currency IS DISTINCT FROM OLD.currency THEN
    RAISE EXCEPTION
      'price.currency is append-only (§Z4 supersede rule): supersede with a new row instead. '
      'An amount with a changed currency is a different price, not a corrected one.'
      USING ERRCODE = 'restrict_violation';
  END IF;
  -- ★★ AND WHAT IT PRICED CANNOT MOVE. Re-pointing subject_id would silently transfer a price
  --    history from one service to another — and every invoice that cited it would now be
  --    attributable to the wrong product.
  IF NEW.subject_type IS DISTINCT FROM OLD.subject_type
     OR NEW.subject_id IS DISTINCT FROM OLD.subject_id THEN
    RAISE EXCEPTION
      'price.subject_type/subject_id are append-only (§Z4 supersede rule): a price row belongs to '
      'the thing it priced, permanently. Create a new price row against the other subject.'
      USING ERRCODE = 'restrict_violation';
  END IF;
  -- ★ effective_FROM is also history. Moving it would retroactively change which invoices this row
  --   was live for.
  IF NEW.effective_from IS DISTINCT FROM OLD.effective_from THEN
    RAISE EXCEPTION
      'price.effective_from is append-only (§Z4 supersede rule): it records when this price began.'
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- ★★★ effective_TO MAY BE SET — THAT IS THE SUPERSEDE — BUT ONLY ONCE, AND ONLY FROM NULL.
  --     A row whose window has already been closed is settled. Re-opening it (to NULL) or moving
  --     the close date would make two prices live at once, or retroactively extend one over
  --     invoices the next price covered. ★ This is the OVER-CORRECTION direction of the guard:
  --     without this branch the rule would block nothing, since effective_to is the one column a
  --     supersede touches.
  IF OLD.effective_to IS NOT NULL AND NEW.effective_to IS DISTINCT FROM OLD.effective_to THEN
    RAISE EXCEPTION
      'price.effective_to is already set (%): a superseded price row is settled and its window '
      'cannot be moved or reopened (§Z4 supersede rule).', OLD.effective_to
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END $$;

-- ★ BEFORE UPDATE, so it refuses before any constraint or index work happens, and the message the
--   caller sees is this one rather than a downstream consequence.
CREATE TRIGGER price_append_only
  BEFORE UPDATE ON keystone.price
  FOR EACH ROW EXECUTE FUNCTION keystone.price_is_append_only();

COMMENT ON TRIGGER price_append_only ON keystone.price IS
  '§Z4 / §P7 (P15B.7). amount_minor, currency, subject_type, subject_id and effective_from are '
  'append-only; effective_to may be set ONCE, from NULL, which IS the supersede. Enforced here '
  'rather than in a write module because `price` is what an invoice was computed from, and an '
  'application-code check is one refactor away from absent.';
