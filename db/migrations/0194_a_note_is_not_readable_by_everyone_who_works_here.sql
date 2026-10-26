-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0194 — A NOTE IS NOT READABLE BY EVERYONE WHO WORKS HERE. (Stage 7 task 7.14, F591's ruling.)
--
-- ★★★ WHAT THIS FIXES [F471]. `keystone.document_is_visible()` (0120:47-49) short-circuits on
--     `v_viewer.role = 'staff'` BEFORE the archived check, the draft check, the guardian edge and
--     the session-note rule even run — so today EVERY staff member reads EVERY document in the
--     practice, including a session note written by a coach about somebody else's caseload. 05 §6
--     is unambiguous that this is wrong: *"the writer, the client's assigned coach, the Owner …
--     Admins lose note access unless they wrote it or are the assigned coach."*
--
-- ★★ THE FIX, IN TWO SECTIONS THAT MUST APPLY TOGETHER (see the F591 ruling block in
--    STAGE-7-PLAN.md, task 7.14, for why one number and not two):
--      §A — `document_instance.created_by`, the column the writer disjunct reads. It never existed
--           (F591's own defect) — added here, copied statement-for-statement from `archived_by`'s
--           identical shape on this same table (0088:44-50).
--      §B — `document_is_visible()` rewritten: the staff short-circuit is gone. Staff now ask a
--           real permission question — archived (a `document`/`delete` grant, preserving restore),
--           session note (writer OR assigned coach OR a `note` view/everything grant — the Owner),
--           everything else (`document`/`view` on the instance's indirect owner). The guardian edge
--           and the client/parent branches below it are UNCHANGED, verbatim from 0120.
--
-- ★ WHO SUPPLIES THE CONDITION. `keystone.current_user_id()` reads the `keystone.user_id` GUC the
--   application sets at `src/db/index.mjs:115` on every request. A worker or webhook path passes no
--   user and sees nothing — `scope_allows` (0070:181-183) already takes this position; unchanged.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- ── §a · PRECONDITIONS ──────────────────────────────────────────────────────────────────────────
DO $preconditions$
BEGIN
  IF current_user <> 'app_owner' THEN
    RAISE EXCEPTION '0194: must run as app_owner (db/migrate.mjs:317 sets it), running as %', current_user;
  END IF;

  IF to_regclass('keystone.document_instance') IS NULL THEN
    RAISE EXCEPTION '0194: keystone.document_instance does not exist';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'keystone' AND table_name = 'document_instance'
                AND column_name = 'created_by') THEN
    RAISE EXCEPTION '0194: keystone.document_instance.created_by already exists — changed by hand? refusing to guess';
  END IF;
END
$preconditions$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ §A — THE COLUMN THE WRITER DISJUNCT READS. It did not exist (F591) and it is created here,
--     copied statement-for-statement from the constraint already on THIS SAME TABLE
--     (`db/migrations/0088_archive_not_delete.sql:44-50`, which gave `document_instance` its
--     `archived_by` by exactly this pattern) — no new pattern is invented.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
ALTER TABLE keystone.document_instance ADD COLUMN created_by uuid;

ALTER TABLE keystone.document_instance
  ADD CONSTRAINT document_instance_created_by_fkey
  FOREIGN KEY (tenant_id, created_by) REFERENCES keystone.app_user (tenant_id, id)
  ON DELETE SET NULL (created_by);

COMMENT ON COLUMN keystone.document_instance.created_by IS
  '05 §6 / §2b.2 — WHO WROTE IT. The writer disjunct of keystone.document_is_visible reads this and '
  'nothing else. Filled by src/documents/writes.mjs createInstance from the actorUserId that '
  'src/routes/writes.mjs:324 stamps AFTER spreading the body, so a request body can never name a '
  'writer. NULL = written before 0194 (no backfill is possible — nothing recorded it at the time); '
  'such a note is still reachable by the assigned coach and the Owner, which is fail-closed and '
  'agrees with 05 §6. ★ AUTHORSHIP IS NOT OWNERSHIP: this is NOT an ownerColumn for any entry in '
  'src/permissions/ownership.mjs — document is owned INDIRECTLY through subject_user_id (0071) and '
  'note is ownable:false (F584). db/gates/p1_ownership.mjs §8 asserts that, see 7.14 field 8(f).';

-- ★ DATA (step-7 obligation, recorded here rather than executed by this migration — a migration
--   does not query row counts as a side effect, and this builder holds no database URL to read the
--   deployed database with; the count belongs to whichever step actually runs this migration
--   against real data, per BUILD-PROCESS.md step 3). `ADD COLUMN` of a nullable `uuid` with no
--   default rewrites nothing and changes no row; the composite FK validates instantly against an
--   all-NULL column. **No backfill** — nobody recorded who wrote the existing rows, and inventing
--   one would be a false authorship claim. Whoever applies this migration should record, READ-ONLY
--   inside `BEGIN READ ONLY`: the production `keystone.document_instance` row count, and the count
--   of rows whose `type_id` names an `is_session_note` type — that number is how many notes lose
--   the writer disjunct (they keep the assigned coach and the Owner).

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §B — THE PREDICATE. THE STAFF SHORT-CIRCUIT IS GONE.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION keystone.document_is_visible(p_instance keystone.document_instance)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_viewer    record;
  v_type      record;
  v_party     text;
  v_via_guard boolean := false;
  v_owner     uuid;
BEGIN
  SELECT u.id, u.role, u.staff_role INTO v_viewer
    FROM keystone.app_user u
   WHERE u.id = keystone.current_user_id()
     AND u.tenant_id = p_instance.tenant_id;
  IF NOT FOUND THEN RETURN false; END IF;

  -- ═════════════════════════════════════════════════════════════════════════════════════════
  -- ★★★ F471 / F591 / F584 — THE STAFF SHORT-CIRCUIT ("IF role = 'staff' THEN RETURN true") IS
  --     GONE. It occupied this exact position (0120:47-49) and skipped EVERY check below —
  --     archived, draft, the guardian edge and the session-note rule — because none of those
  --     describe a staff question. They still do not: archived and session-note visibility for
  --     STAFF are answered here, by a real grant or a real relationship, never by role alone.
  --     The draft check and the guardian edge below remain exactly 0120's, verbatim, because
  --     they answer a CLIENT/PARENT question staff never asks.
  -- ═════════════════════════════════════════════════════════════════════════════════════════
  IF v_viewer.role = 'staff' THEN
    -- the subject's assigned coach — the SAME indirect join src/permissions/ownership.mjs:61's
    -- `ownerVia` describes for the `document` permission object (subject_user_id →
    -- app_user.owner_user_id). A plpgsql function cannot import that map, so it is restated here,
    -- exactly as 0195's keystone.reason_is_visible restates the same join for 'document'.
    SELECT su.owner_user_id INTO v_owner
      FROM keystone.app_user su WHERE su.id = p_instance.subject_user_id;

    -- ── archived → a GRANT, not "any staff" (preserves 0120's own reason for the old line: a
    --    document must still be restorable) ──────────────────────────────────────────────────
    IF p_instance.archived_at IS NOT NULL THEN
      RETURN keystone.user_may(v_viewer.id, 'document', 'delete', v_owner);
    END IF;

    SELECT t.is_session_note INTO v_type
      FROM keystone.document_type t WHERE t.id = p_instance.type_id;
    -- ★ an instance whose type cannot be resolved is invisible — the same fail-closed answer
    --   0011 gives a client for an untyped document, now asked of staff too.
    IF NOT FOUND THEN RETURN false; END IF;

    IF v_type.is_session_note THEN
      -- ★★★ 05 §6 — THE WRITER, THE ASSIGNED COACH, OR A `note` view/everything GRANT (the
      --     Owner). Admins are excluded because their `note` grant is `none` (7.9's matrix) and
      --     they satisfy neither of the first two disjuncts unless they wrote it or are the
      --     assigned coach — 05 §6, word for word. The Coach's `note` grant is ALSO `none`
      --     (F584): a Coach's real access arrives through the second disjunct alone, never the
      --     third, so a Coach never reads a colleague's note through this branch.
      RETURN (p_instance.created_by IS NOT NULL AND p_instance.created_by = v_viewer.id)
          OR (v_owner IS NOT NULL AND v_owner = v_viewer.id)
          OR keystone.user_may(v_viewer.id, 'note', 'view', NULL);
    END IF;

    -- ── every other document → the real grant on the instance's indirect owner ───────────────
    RETURN keystone.user_may(v_viewer.id, 'document', 'view', v_owner);
  END IF;

  -- ═════════════════════════════════════════════════════════════════════════════════════════
  -- EVERYTHING BELOW THIS LINE IS 0120's BODY, VERBATIM, FOR THE NON-STAFF VIEWER (client,
  -- adolescent client, parent). Field 5 of 7.14 names this unchanged; it is character-for-
  -- character 0120:51-93 except for the removed staff branch above it.
  -- ═════════════════════════════════════════════════════════════════════════════════════════

  -- ★★★ AND NOBODY ELSE DOES. A retired document is not a client's to read. [MEASURED] with this
  --     line absent, a client saw `client_agreement/sent/archived` in their own list.
  IF p_instance.archived_at IS NOT NULL THEN RETURN false; END IF;

  IF p_instance.state = 'draft' THEN RETURN false; END IF;

  -- ★ Reaching the document AT ALL: it is the viewer's own, or they are a guardian of its subject.
  --   ★★ `v_via_guard` REMEMBERS WHICH, and that memory is the whole fix of 0012 — the old code
  --      discarded it and then asked about the viewer's role instead.
  IF p_instance.subject_user_id IS DISTINCT FROM v_viewer.id THEN
    v_via_guard := keystone.is_guardian_of(v_viewer.id, p_instance.subject_user_id);
    IF NOT v_via_guard THEN RETURN false; END IF;
  END IF;

  SELECT t.audience, t.is_session_note, t.division INTO v_type
    FROM keystone.document_type t WHERE t.id = p_instance.type_id;
  IF NOT FOUND THEN RETURN false; END IF;

  -- ★★★ THE RULE, ASKED CORRECTLY. Not "is this viewer a parent" but **"is this somebody else's
  --     session note?"** Keyed on the EDGE the viewer travelled, so no role — existing or invented
  --     — and no audience an operator configures can get round it.
  IF v_type.is_session_note AND (v_via_guard OR v_viewer.role = 'parent') THEN RETURN false; END IF;

  IF NOT (v_viewer.role = ANY(v_type.audience)) THEN RETURN false; END IF;

  -- ═══════════════════════════════════════════════════════════════════════════════════════════
  -- ★★★ P10.1 — THE ONE LINE THAT CHANGED. THE PARTY DEPENDS ON THE DIVISION.
  --     A person receiving the service is a `pir` on a recovery instrument and a `client` on a tech
  --     one. Mapping every client role to `pir` made every tech document assigned to `client`
  --     invisible to its own subject — measured, not theorised; see this file's header.
  --   ★ `parent` is a `parent` in both divisions, so it does not branch.
  -- ═══════════════════════════════════════════════════════════════════════════════════════════
  v_party := CASE
               WHEN v_viewer.role IN ('adult_client', 'adolescent_client')
                 THEN CASE v_type.division WHEN 'tech' THEN 'client' ELSE 'pir' END
               WHEN v_viewer.role = 'parent' THEN 'parent'
               ELSE NULL
             END;
  IF v_party IS NULL THEN RETURN false; END IF;

  IF p_instance.assigned_to = '{}'::text[] THEN RETURN false; END IF;

  RETURN 'both' = ANY(p_instance.assigned_to) OR v_party = ANY(p_instance.assigned_to);
END
$$;

COMMENT ON FUNCTION keystone.document_is_visible(keystone.document_instance) IS
  '0194 (Stage 7 task 7.14, F591/F584/F471) — the staff short-circuit ("IF role=''staff'' THEN '
  'RETURN true", 0120:47-49) is gone. Staff now ask a real question: archived requires document/ '
  'delete; a session note is the writer''s, the assigned coach''s, or a note view/everything '
  'grant''s (the Owner); every other document requires document/view on the instance''s indirect '
  'owner. The guardian edge, the draft check and the client/parent party mapping below are 0120''s, '
  'unchanged. Still SECURITY DEFINER with an empty search_path (0120''s own fix, preserved).';

-- ── §c · SELF-CHECK, PART 1 — THE SHAPE THIS FILE CLAIMS ───────────────────────────────────────
DO $shape_check$
DECLARE
  r record;
BEGIN
  SELECT p.prosecdef,
         (p.proconfig IS NOT NULL AND EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE left(c, 12) = 'search_path=')) AS has_search_path
    INTO r
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'keystone' AND p.proname = 'document_is_visible';
  IF NOT FOUND THEN
    RAISE EXCEPTION '0194: keystone.document_is_visible does not exist after CREATE OR REPLACE';
  END IF;
  IF NOT r.prosecdef THEN
    RAISE EXCEPTION '0194: keystone.document_is_visible is not SECURITY DEFINER';
  END IF;
  IF NOT r.has_search_path THEN
    RAISE EXCEPTION '0194: keystone.document_is_visible has no pinned search_path — hijackable (0120''s lesson)';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'keystone' AND table_name = 'document_instance'
                    AND column_name = 'created_by' AND data_type = 'uuid' AND is_nullable = 'YES') THEN
    RAISE EXCEPTION '0194: keystone.document_instance.created_by is not the nullable uuid §A claims';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                  WHERE conname = 'document_instance_created_by_fkey'
                    AND conrelid = 'keystone.document_instance'::regclass) THEN
    RAISE EXCEPTION '0194: document_instance_created_by_fkey does not exist';
  END IF;

  RAISE NOTICE '0194: keystone.document_is_visible is SECURITY DEFINER, search_path pinned; document_instance.created_by is a nullable uuid with its composite foreign key.';
END
$shape_check$;

-- ── §d · SELF-CHECK, PART 2 — A FABRICATED STAFF VIEWER, WITH TWO POSITIVE CONTROLS ────────────
-- ★★★ (1) a staff viewer with NO note grant, who did not write the note and is not the assigned
--     coach, sees NOTHING. (2) POSITIVE CONTROL: the SAME identity, holding note:view:everything,
--     sees it. (3) SECOND POSITIVE CONTROL, for §A's column alone: the grant is removed again, and
--     the SAME note's `created_by` is set to that SAME viewer — visible with NO grant at all. That
--     third step is the only thing that proves §A's column is actually READ by §B's body, rather
--     than merely present in the table. Everything fabricated here is deleted at the end of this
--     block; nothing survives the migration. Modelled on 0195's own probe-tenant-and-delete shape.
--
-- ★★ F490 FIX [MEASURED 22 Sep 2026]: `keystone.tenant` is FORCE RLS (`0001:151-152`) with no
--    INSERT policy `app_owner` (NOBYPASSRLS — `scripts/bootstrap-roles.mjs:247`) can satisfy — the
--    bare `INSERT INTO keystone.tenant` below was refused with "new row violates row-level security
--    policy for table tenant" on EVERY execution, not just a locally-dirty database; `0195`'s
--    identically-shaped probe (which this block is modelled on) had the same bug, unexercised until
--    now. `0018:113-120,169-179` established the house pattern for exactly this — suspend FORCE for
--    the bootstrap, act, restore it IN THE SAME TRANSACTION, and ASSERT it came back — so this probe
--    now brackets itself the same way, rather than inventing a second pattern.
ALTER TABLE keystone.tenant NO FORCE ROW LEVEL SECURITY;

DO $note_visibility_check$
DECLARE
  v_tenant      uuid;
  v_cat         uuid;
  v_type        uuid;
  v_viewer      uuid;  -- staff coach: no grant, not the writer, not the assigned coach
  v_other_owner uuid;  -- the client's REAL assigned coach — never v_viewer
  v_client      uuid;
  v_role_id     uuid;
  v_doc         uuid;
  v_seen        integer;
BEGIN
  INSERT INTO keystone.tenant (slug, name, timezone, status)
  VALUES ('m0194-probe', 'M0194 probe', 'UTC', 'active') RETURNING id INTO v_tenant;

  PERFORM set_config('keystone.tenant_id', v_tenant::text, true);
  IF keystone.current_tenant_id() IS DISTINCT FROM v_tenant THEN
    RAISE EXCEPTION '0194: the tenant context did not take effect for the probe tenant';
  END IF;

  INSERT INTO keystone.app_user (tenant_id, email, display_name, role, staff_role)
  VALUES (v_tenant, 'm0194-viewer@example.invalid', 'M0194 viewer', 'staff', 'coach')
  RETURNING id INTO v_viewer;

  INSERT INTO keystone.app_user (tenant_id, email, display_name, role, staff_role)
  VALUES (v_tenant, 'm0194-otherowner@example.invalid', 'M0194 other owner', 'staff', 'coach')
  RETURNING id INTO v_other_owner;

  -- the subject: owned by SOMEBODY ELSE, never v_viewer — v_viewer is not the assigned coach.
  INSERT INTO keystone.app_user (tenant_id, email, display_name, role, owner_user_id)
  VALUES (v_tenant, 'm0194-client@example.invalid', 'M0194 client', 'adult_client', v_other_owner)
  RETURNING id INTO v_client;

  INSERT INTO keystone.document_category (tenant_id, key, label)
  VALUES (v_tenant, 'm0194_cat', 'M0194 cat') RETURNING id INTO v_cat;

  INSERT INTO keystone.document_type
    (tenant_id, key, label, category_id, sub_category, signer_config, audience, division,
     applies_to, default_assigned_to, is_session_note)
  VALUES (v_tenant, 'm0194_note', 'M0194 Note', v_cat, 'notes', 'COACH_ONLY', ARRAY['staff'],
          'recovery', ARRAY['adult_client'], ARRAY['coach'], true)
  RETURNING id INTO v_type;

  -- a session note nobody has written yet (created_by NULL — the honest answer §A's own comment
  -- describes) about a client v_viewer neither writes for nor is assigned to.
  --
  -- ★★ F490-ADJACENT FIX [MEASURED 22 Sep 2026]: this INSERT used to say `RETURNING id INTO v_doc`.
  --    `document_instance`'s SELECT policy (`tenant_isolation`, `0011`) is `tenant_id =
  --    current_tenant_id() AND document_is_visible(document_instance.*)` — and `INSERT ... RETURNING`
  --    makes Postgres check the just-inserted row against that SAME SELECT policy before it can hand
  --    the id back, exactly as `UPDATE ... RETURNING` and `DELETE ... RETURNING` already do. At this
  --    point in the probe `keystone.user_id` is deliberately still unset (nobody is meant to be
  --    looking yet), so `current_user_id()` is NULL, `document_is_visible` finds no viewer and
  --    returns false, and the row — genuinely inserted, satisfying `tenant_insert`'s WITH CHECK —
  --    cannot be RETURNED: "new row violates row-level security policy for table document_instance".
  --    [MEASURED] a manual reproduction confirmed the identical INSERT with no RETURNING clause
  --    succeeds every time; adding RETURNING is what fails, and only after §B's document_is_visible
  --    is in place (the old staff short-circuit masked this — 0120's version still required a FOUND
  --    viewer row, but nothing before 0194 exercised this exact probe shape). The fix: generate the
  --    id client-side with `keystone.uuid_generate_v7()` — the column's own DEFAULT expression
  --    (`0001:99,123`) — and INSERT it explicitly, so nothing needs to read the row back.
  v_doc := keystone.uuid_generate_v7();
  INSERT INTO keystone.document_instance
    (id, tenant_id, builder, title, type_id, subject_user_id, assigned_to, state)
  VALUES (v_doc, v_tenant, 'form', 'M0194 probe note', v_type, v_client, ARRAY['coach'], 'draft');

  -- ── (1) NO note grant, not the writer, not the assigned coach → NOTHING ─────────────────────
  PERFORM set_config('keystone.user_id', v_viewer::text, true);
  SELECT count(*) INTO v_seen FROM keystone.document_instance WHERE id = v_doc;
  IF v_seen <> 0 THEN
    RAISE EXCEPTION '0194: a staff viewer with no note grant, who did not write the note and is not the assigned coach, saw % row(s), expected 0', v_seen;
  END IF;

  -- ── (2) POSITIVE CONTROL — the SAME viewer, now holding note:view:everything ────────────────
  INSERT INTO keystone.role (tenant_id, key, label, is_builtin)
  VALUES (v_tenant, 'm0194_probe_role', 'M0194 probe role', false) RETURNING id INTO v_role_id;
  INSERT INTO keystone.role_permission (tenant_id, role_id, object, verb, scope)
  VALUES (v_tenant, v_role_id, 'note', 'view', 'everything');
  INSERT INTO keystone.user_role (tenant_id, user_id, role_id, granted_by)
  VALUES (v_tenant, v_viewer, v_role_id, v_viewer);

  SELECT count(*) INTO v_seen FROM keystone.document_instance WHERE id = v_doc;
  IF v_seen <> 1 THEN
    RAISE EXCEPTION '0194: the same viewer, holding note:view:everything, saw % row(s) of the note, expected 1 (positive control)', v_seen;
  END IF;

  -- ── (3) SECOND POSITIVE CONTROL, FOR §A's COLUMN — remove the grant, confirm the row goes dark
  --    again, THEN make the viewer the WRITER, with no grant at all ───────────────────────────
  DELETE FROM keystone.user_role WHERE tenant_id = v_tenant AND user_id = v_viewer;

  SELECT count(*) INTO v_seen FROM keystone.document_instance WHERE id = v_doc;
  IF v_seen <> 0 THEN
    RAISE EXCEPTION '0194: removing the grant did not remove visibility — saw % row(s); step (2)''s 1 was not actually gated by the grant', v_seen;
  END IF;

  -- ★★ F490-ADJACENT FIX [MEASURED 22 Sep 2026]: this UPDATE used to run as v_viewer (unchanged
  --    from the line above) and silently affected 0 rows — no error, `rowCount = 0`. Postgres
  --    requires an UPDATE's target row to pass BOTH the applicable UPDATE policy's USING (here,
  --    `staff_write`, which v_viewer satisfies — confirmed [MEASURED] standalone) AND the table's
  --    SELECT policy's USING (`tenant_isolation`, i.e. `document_is_visible`) to even be scanned as
  --    a candidate row for UPDATE — see "Row Security Policies" in the PostgreSQL documentation:
  --    UPDATE/DELETE implicitly require SELECT visibility to locate the row, on top of their own
  --    policy. At this exact point v_viewer has JUST been proven (the assertion two lines above) to
  --    see 0 rows of this note — so v_viewer can never be the one to set its own `created_by`; that
  --    would need to already be visible to become visible, which is circular. Before 0194 this could
  --    not surface: the OLD `document_is_visible` short-circuited to `true` for every staff viewer,
  --    so v_viewer could always find the row. The fix: perform the UPDATE as v_other_owner — the
  --    client's real assigned coach, who already sees this note today through the "assigned coach"
  --    disjunct (`v_owner = v_viewer.id` inside §B's function) — then switch back to v_viewer for
  --    the assertion that follows, unchanged.
  PERFORM set_config('keystone.user_id', v_other_owner::text, true);
  UPDATE keystone.document_instance SET created_by = v_viewer WHERE id = v_doc;
  PERFORM set_config('keystone.user_id', v_viewer::text, true);

  SELECT count(*) INTO v_seen FROM keystone.document_instance WHERE id = v_doc;
  IF v_seen <> 1 THEN
    RAISE EXCEPTION '0194: the note''s own writer, holding NO grant at all, saw % row(s), expected 1 — §A''s created_by column is not being read by §B''s body', v_seen;
  END IF;

  -- ── cleanup — v_viewer can still see the row it wrote; delete under that identity, then drop
  --    the rest with no viewer context ────────────────────────────────────────────────────────
  DELETE FROM keystone.document_instance WHERE tenant_id = v_tenant;
  PERFORM set_config('keystone.user_id', '', true);
  DELETE FROM keystone.role_permission WHERE tenant_id = v_tenant;
  DELETE FROM keystone.role WHERE tenant_id = v_tenant;
  DELETE FROM keystone.document_type WHERE tenant_id = v_tenant;
  DELETE FROM keystone.document_category WHERE tenant_id = v_tenant;
  DELETE FROM keystone.app_user WHERE tenant_id = v_tenant;
  PERFORM set_config('keystone.tenant_id', '', true);
  DELETE FROM keystone.tenant WHERE id = v_tenant;

  RAISE NOTICE '0194: a staff viewer with no note grant, not the writer, not the assigned coach saw 0 row(s) of a fabricated note; the same identity holding note:view:everything saw 1 (positive control); with the grant removed and created_by set to that same viewer, still 1 (second positive control — §A''s column is read by §B''s body). Probe tenant % removed.', v_tenant;
END
$note_visibility_check$;

ALTER TABLE keystone.tenant FORCE ROW LEVEL SECURITY;

-- ★★ PROVE FORCE IS BACK ON — 0018's own reasoning, verbatim: leaving it off would silently disable
--    tenant isolation on the root table of the whole schema, and every later migration and gate
--    would still pass.
DO $$
DECLARE forced boolean;
BEGIN
  SELECT relforcerowsecurity INTO forced FROM pg_class WHERE oid = 'keystone.tenant'::regclass;
  IF NOT forced THEN
    RAISE EXCEPTION '0194: FORCE ROW LEVEL SECURITY was not restored on keystone.tenant';
  END IF;
END $$;
