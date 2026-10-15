-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0198 — A PRIVATE READ IS A THING THAT HAPPENED. (Stage 7 task 7.15, F597's resolution.)
--
-- ★★★ WHAT THIS SUPPORTS. Task 7.15's helper `auditPrivateRead` (src/permissions/audit.mjs, a named
--     APPEND onto 7.3's writeAudit — the one-writer invariant is unchanged) writes a
--     `keystone.audit_entry` row every time staff read a private item — today only a session note,
--     called from `src/routes/index.mjs`'s generic `GET /api/records/:type/:id` handler (F597: the
--     one execution point RECORD_QUERIES/RELATED_QUERIES, frozen static SQL-string maps, do not
--     have). This migration adds ONLY the index the audit screen's private-read view reads —
--     "every 'X viewed' row for this subject, newest first" — and nothing else. No new table.
--
-- ★ WHY A PARTIAL INDEX. `action LIKE '%.viewed'` matches exactly the four private-read actions
--   (note.viewed, message.viewed, goal.viewed, checkin.viewed — AUDIT_ACTIONS, src/permissions/
--   audit.mjs) and none of the other 21. Indexing only those rows keeps the index small and keeps
--   it out of the way of every OTHER audit query, which is not filtering on this pattern.
-- ★ NOT MARKED `-- keystone:one-way` — dropping an index is always reversible.
-- ★ NO SECRET, NO EMAIL, NO DISPLAY NAME IS READ OR PRINTED. The self-check below reads only
--   catalog metadata (index names and definitions), never row data.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- ── §a · PRECONDITIONS ──────────────────────────────────────────────────────────────────────────
DO $preconditions$
BEGIN
  IF current_user <> 'app_owner' THEN
    RAISE EXCEPTION '0198: must run as app_owner (db/migrate.mjs:317 sets it), running as %', current_user;
  END IF;

  IF to_regclass('keystone.audit_entry') IS NULL THEN
    RAISE EXCEPTION '0198: keystone.audit_entry does not exist — 7.3/0183 must run first';
  END IF;

  IF to_regclass('keystone.audit_entry_private_reads_idx') IS NOT NULL THEN
    RAISE EXCEPTION '0198: keystone.audit_entry_private_reads_idx already exists — changed by hand? refusing to guess';
  END IF;
END
$preconditions$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- THE INDEX. Field 6, verbatim.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE INDEX audit_entry_private_reads_idx ON keystone.audit_entry (tenant_id, object, subject_id, at DESC)
  WHERE action LIKE '%.viewed';

-- ── §b · SELF-CHECK — THE INDEX EXISTS, WITH THE SHAPE THIS FILE CLAIMS ────────────────────────
-- ★ Checked against pg_index/pg_attribute/pg_get_expr rather than pg_get_indexdef's rendered SQL
--   text — a LIKE predicate's operator spelling (`~~`) can format differently across PG versions,
--   and this only needs to prove "partial, on tenant_id/object/subject_id/at DESC, predicate
--   mentions 'viewed'", not reproduce the exact string this file wrote.
DO $shape_check$
DECLARE
  v_idx      regclass := to_regclass('keystone.audit_entry_private_reads_idx');
  v_indpred  text;
  v_cols     text;
BEGIN
  IF v_idx IS NULL THEN
    RAISE EXCEPTION '0198: keystone.audit_entry_private_reads_idx does not exist after CREATE INDEX';
  END IF;

  SELECT pg_get_expr(i.indpred, i.indrelid) INTO v_indpred
    FROM pg_catalog.pg_index i WHERE i.indexrelid = v_idx;
  IF v_indpred IS NULL OR v_indpred NOT LIKE '%viewed%' THEN
    RAISE EXCEPTION '0198: audit_entry_private_reads_idx is not partial on a ''.viewed'' predicate — got: %', COALESCE(v_indpred, '(not partial)');
  END IF;

  -- ★★ FIX [MEASURED 22 Sep 2026]: `FROM i, unnest(...) AS k JOIN pg_attribute a ON ... i.indrelid`
  --    failed with "invalid reference to FROM-clause entry for table i" — a JOIN binds tighter than
  --    a comma in FROM, so the ON clause of `k JOIN a` cannot see `i`, which sits outside that join
  --    tree. Rewritten so all three are comma-joined and the join condition moves to WHERE, where
  --    every alias is in scope.
  SELECT string_agg(a.attname, ',' ORDER BY k.ordinality) INTO v_cols
    FROM pg_catalog.pg_index i,
         unnest(i.indkey) WITH ORDINALITY AS k(attnum, ordinality),
         pg_catalog.pg_attribute a
   WHERE i.indexrelid = v_idx
     AND a.attrelid = i.indrelid AND a.attnum = k.attnum;
  IF v_cols IS DISTINCT FROM 'tenant_id,object,subject_id,at' THEN
    RAISE EXCEPTION '0198: audit_entry_private_reads_idx columns are (%), not (tenant_id,object,subject_id,at)', v_cols;
  END IF;

  RAISE NOTICE '0198: keystone.audit_entry_private_reads_idx exists — (tenant_id, object, subject_id, at DESC), partial on a ''.viewed'' predicate.';
END
$shape_check$;
