-- 0035_snapshot_shape
-- P15C.3 — ★★★ `template_snapshot` HAD ONE CONSTRAINT — `IS NOT NULL` — AND `{}` SATISFIED IT.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- [MEASURED at 0009:158-160] `executed_shape` asserts only that `template_snapshot IS NOT NULL` and
-- `executed_at IS NOT NULL` on an executed row. **"The snapshot is present" and "the snapshot says
-- anything" are different claims, and only the first was ever checked.**
--   ★★ So an executed instrument — the most permanent object in this product — could carry `{}`, and
--      every layer downstream would report it as properly executed. §M0 LAW 3's whole purpose is that
--      an instrument can be read back years later; a snapshot nobody can interpret defeats it while
--      passing every check.
--   ★ `buildTemplateSnapshot` was NAMED IN A COMMENT at 0009:149 and existed nowhere else. The
--     validator now exists (`parseTemplateSnapshot`, src/documents/body.mjs) and refuses before the
--     write — this migration is the layer underneath it, for every path that does not go through it.
--
-- ★★★ THE DATABASE CHECKS THE SKELETON, THE VALIDATOR CHECKS THE SHAPE. Deliberately split:
--   · a CHECK constraint cannot express "the disclosure is one of three discriminated shapes" without
--     becoming unmaintainable, and a half-expressed rule in SQL reads as a complete one;
--   · but it CAN cheaply guarantee the five keys exist and the disclosure names a known status — which
--     is exactly what makes an unreadable snapshot unrepresentable rather than merely unlikely.
--   ★ And `body ? key` FIRST on every clause, per 0034's rule: a CHECK over a missing jsonb key
--     evaluates to NULL, and **NULL is satisfied**. That defect already happened once, one migration
--     ago, in this same phase.

ALTER TABLE keystone.document_instance
  ADD CONSTRAINT snapshot_is_readable
  CHECK (
    template_snapshot IS NULL
    OR (
      -- ★ WHICH RULES IT WAS TAKEN UNDER. Without this a future format change is indistinguishable
      --   from corruption, and a reader has no way to know which interpretation applies.
      template_snapshot ? 'law3_version'
      AND (template_snapshot->>'law3_version') = '1'
      -- ★ WHICH BUILDER — a form snapshot and a contract snapshot are rendered by different programs.
      AND template_snapshot ? 'builder'
      AND template_snapshot->>'builder' IN ('contract','form')
      -- ★ A TITLE, because an instrument nobody can name cannot be found again. (Same defect class as
      --   F12: a pipeline row that rendered as a raw id.)
      AND template_snapshot ? 'title'
      AND length(coalesce(template_snapshot->>'title','')) > 0
      -- ★★★ AND THE DISCLOSURE MUST NAME ONE OF THE THREE STATES. An ABSENT disclosure field is
      --     indistinguishable from "no disclosure applied", and on a signed instrument that
      --     difference is the whole question — which is why the three states exist at all:
      --       CAPTURED           · the version and text the signer saw
      --       NOT_ACCEPTED       · a consumer signed with NO disclosure. **A DEFECT, recorded.**
      --       NO_CONSUMER_SIGNER · internal, staff-only. Nothing was owed and nothing is missing.
      AND template_snapshot ? 'disclosure'
      AND template_snapshot->'disclosure' ? 'status'
      AND template_snapshot->'disclosure'->>'status'
            IN ('CAPTURED','NOT_ACCEPTED','NO_CONSUMER_SIGNER')
    )
  );

COMMENT ON CONSTRAINT snapshot_is_readable ON keystone.document_instance IS
  'P15C.3. The snapshot skeleton: law3_version, builder, a non-empty title, and a disclosure naming '
  'one of the three states. Before this, template_snapshot''s ONLY constraint was IS NOT NULL (via '
  'executed_shape) — so an executed instrument could carry {} and every layer downstream would '
  'report it properly executed. The full shape is enforced by parseTemplateSnapshot on the write '
  'path; this is the guarantee for every path that does not go through it.';
