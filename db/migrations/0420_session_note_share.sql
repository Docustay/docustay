-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0420 — SHARE A SESSION NOTE WITH ITS OWN CLIENT. (Stage 14 task 14.13, G29, CT-F07/CT-F26.)
--
-- ★★★ THIS IS A DISCLOSURE BOUNDARY, NOT A FEATURE FLAG. A session note is written by a coach
--     ABOUT a client. Today (0194/0388) the client's own copy of `document_is_visible` never grants
--     a client access to their own session note at all — the non-staff branch's session-note line
--     (`0194:175`, unchanged by 0388) unconditionally refuses a guardian or a parent, and every
--     OTHER non-staff viewer falls through to the ordinary audience/assigned_to check exactly like
--     any other document type. This migration adds the missing case: the note's own SUBJECT, once a
--     staff member has explicitly shared THAT note with them. Nothing else changes.
--
--     Sharing is EXPLICIT, PER NOTE, and RECORDED — never a blanket setting, never default-on, never
--     retroactive: `shared_with_client_at` / `shared_by` are new NULLABLE columns, so every note
--     written before this migration (and every note nobody has shared) stays exactly as invisible to
--     its subject as it was under 0194/0388. There is no tenant_setting here and no default value —
--     a coach must write to the two new columns, per row, before a subject can read a session note
--     about themselves.
--
-- ★★★ CC-36 / CT-F26 — COPY 0388's BODY, NOT 0194's. Stage 12's 12.15 (`0388_team_wide_notes_
--     visibility.sql`) landed FIRST in this run and added the `people.team_wide_notes` disjunct to
--     the STAFF branch of `keystone.document_is_visible`. This migration changes only the NON-STAFF
--     branch — verbatim `0194:175`/0388's identical copy of it — and must start from 0388's current
--     body so that disjunct survives. The precondition block below refuses to run if it cannot find
--     0388's text already in place, rather than silently reverting it.
--
-- ★ WHO SUPPLIES THE CONDITION. `p_instance.shared_with_client_at` is a column on the row itself,
--   written by the application's share/unshare route (`POST /api/documents/:id/share` /
--   `.../unshare`, CT-F07) when a staff member acts — never a GUC, never something only a test sets.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- ── §a · PRECONDITIONS ──────────────────────────────────────────────────────────────────────────
DO $preconditions$
BEGIN
  IF current_user <> 'app_owner' THEN
    RAISE EXCEPTION '0420: must run as app_owner (db/migrate.mjs:317 sets it), running as %', current_user;
  END IF;

  IF to_regclass('keystone.document_instance') IS NULL THEN
    RAISE EXCEPTION '0420: keystone.document_instance does not exist';
  END IF;

  IF to_regprocedure('keystone.document_is_visible(keystone.document_instance)') IS NULL THEN
    RAISE EXCEPTION '0420: keystone.document_is_visible does not exist — 0194/0388 must apply first';
  END IF;

  -- ★★★ CC-36's GUARD, MADE EXECUTABLE. If 0388's team_wide_notes disjunct is not already in the
  --     function's text, either 0388 has not applied yet or something started this migration from
  --     0194's stale body by hand — either way, applying 0420 here would silently revert 12.15.
  IF position('team_wide_notes' IN
              pg_get_functiondef('keystone.document_is_visible(keystone.document_instance)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '0420: keystone.document_is_visible does not contain 0388''s team_wide_notes disjunct — 0388 (Stage 12 task 12.15) must apply before 0420 (CT-F26/CC-36)';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'keystone' AND table_name = 'document_instance'
                AND column_name IN ('shared_with_client_at', 'shared_by')) THEN
    RAISE EXCEPTION '0420: keystone.document_instance already has a shared_with_client_at/shared_by column — changed by hand? refusing to guess';
  END IF;
END
$preconditions$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §A — THE TWO COLUMNS THE SHARE ROUTE WRITES. CT-F07's exact names, types and CHECK.
--     Table-wide `GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.document_instance TO app_rw`
--     (`0009:186`) is not column-level, so these new columns need no separate grant — MEASURED,
--     `grep -n "document_instance" db/migrations/*.sql | grep -iE "GRANT|app_rw"` shows the only
--     column-level grant on this table is `GRANT SELECT (id, tenant_id) ... TO auth_owner`
--     (`0157:89`), which these columns are not part of and auth_owner has no reason to read.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
ALTER TABLE keystone.document_instance ADD COLUMN shared_with_client_at timestamptz;
ALTER TABLE keystone.document_instance ADD COLUMN shared_by uuid;

ALTER TABLE keystone.document_instance
  ADD CONSTRAINT document_instance_shared_by_fkey
  FOREIGN KEY (tenant_id, shared_by) REFERENCES keystone.app_user (tenant_id, id)
  ON DELETE SET NULL (shared_by);

ALTER TABLE keystone.document_instance
  ADD CONSTRAINT share_pair
  CHECK ((shared_with_client_at IS NULL) = (shared_by IS NULL));

COMMENT ON COLUMN keystone.document_instance.shared_with_client_at IS
  '14.13 / G29 / CT-F07 — WHEN a staff member shared this note with its own subject. NULL = never
  shared (the default for every existing row and every new one until a staff member acts). Read by
  keystone.document_is_visible''s non-staff branch, which is the ONLY thing that gates a client
  reading a session note about themselves.';
COMMENT ON COLUMN keystone.document_instance.shared_by IS
  '14.13 / G29 / CT-F07 — WHO shared it. NULL exactly when shared_with_client_at is NULL (share_pair
  CHECK). Filled by the share route from the acting staff user, never from the request body.';
COMMENT ON CONSTRAINT share_pair ON keystone.document_instance IS
  '14.13 / G29 — both share columns are NULL or both are NOT NULL; there is no half-shared row.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §B — THE PREDICATE. COPIED FROM 0388's BODY, VERBATIM, EXCEPT THE ONE NON-STAFF SESSION-NOTE
--     LINE (0194:175 / 0388's identical copy of it). THE STAFF BRANCH — INCLUDING 0388's
--     team_wide_notes DISJUNCT — IS NOT TOUCHED.
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
  -- 0388's STAFF BRANCH — UNCHANGED, verbatim, including the people.team_wide_notes disjunct
  -- (Stage 12 task 12.15, CT-F26). 14.13 does not touch this branch at all.
  -- ═════════════════════════════════════════════════════════════════════════════════════════
  IF v_viewer.role = 'staff' THEN
    SELECT su.owner_user_id INTO v_owner
      FROM keystone.app_user su WHERE su.id = p_instance.subject_user_id;

    IF p_instance.archived_at IS NOT NULL THEN
      RETURN keystone.user_may(v_viewer.id, 'document', 'delete', v_owner);
    END IF;

    SELECT t.is_session_note INTO v_type
      FROM keystone.document_type t WHERE t.id = p_instance.type_id;
    IF NOT FOUND THEN RETURN false; END IF;

    IF v_type.is_session_note THEN
      -- ★★★ 05 §6 — the writer, the assigned coach, a `note` view/everything grant (the Owner), OR
      --     (12.15 / OQ-12.10, CT-F26) a COACH — never an Admin, whose `note` grant is `none`, see
      --     0388's header — reading under the team-wide-notes practice setting, and ONLY when that
      --     same coach already holds `person`/`view` on this note's subject. This is 0388's ONE
      --     added disjunct; the first three are 0194's, unchanged.
      RETURN (p_instance.created_by IS NOT NULL AND p_instance.created_by = v_viewer.id)
          OR (v_owner IS NOT NULL AND v_owner = v_viewer.id)
          OR keystone.user_may(v_viewer.id, 'note', 'view', NULL)
          OR (v_viewer.staff_role = 'coach'
              AND EXISTS (SELECT 1 FROM keystone.tenant_setting ts
                           WHERE ts.tenant_id = p_instance.tenant_id
                             AND ts.key = 'people.team_wide_notes'
                             AND ts.value = 'true'::jsonb)
              AND keystone.user_may(v_viewer.id, 'person', 'view', v_owner));
    END IF;

    -- ── every other document → the real grant on the instance's indirect owner ───────────────
    RETURN keystone.user_may(v_viewer.id, 'document', 'view', v_owner);
  END IF;

  -- ═════════════════════════════════════════════════════════════════════════════════════════
  -- EVERYTHING BELOW THIS LINE IS 0194's/0388's BODY, VERBATIM, FOR THE NON-STAFF VIEWER
  -- (client, adolescent client, parent), EXCEPT THE ONE SESSION-NOTE LINE 14.13 CHANGES.
  -- ═════════════════════════════════════════════════════════════════════════════════════════
  IF p_instance.archived_at IS NOT NULL THEN RETURN false; END IF;

  IF p_instance.state = 'draft' THEN RETURN false; END IF;

  IF p_instance.subject_user_id IS DISTINCT FROM v_viewer.id THEN
    v_via_guard := keystone.is_guardian_of(v_viewer.id, p_instance.subject_user_id);
    IF NOT v_via_guard THEN RETURN false; END IF;
  END IF;

  SELECT t.audience, t.is_session_note, t.division INTO v_type
    FROM keystone.document_type t WHERE t.id = p_instance.type_id;
  IF NOT FOUND THEN RETURN false; END IF;

  -- ★★★ 14.13 / G29 — THE ONE LINE THAT CHANGES. Reached only when v_via_guard is false, i.e. the
  --     viewer IS the subject (`0194:162-166`). A guardian or a parent is refused exactly as
  --     before, unconditionally — sharing never widens who besides the subject may read a note.
  --     For the subject, the old unconditional refusal (which then fell through to the ordinary
  --     audience/assigned_to check below, same as any other document type) is replaced by the
  --     share flag: the subject reads their own session note if, and only if, a staff member has
  --     shared it.
  IF v_type.is_session_note THEN
    IF v_via_guard OR v_viewer.role = 'parent' THEN RETURN false; END IF;
    RETURN p_instance.shared_with_client_at IS NOT NULL;   -- G29: the subject only, and only once shared
  END IF;

  IF NOT (v_viewer.role = ANY(v_type.audience)) THEN RETURN false; END IF;

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
  '0420 (Stage 14 task 14.13, G29, CT-F07/CT-F26) — copies 0388''s body (Stage 12 task 12.15''s
  team_wide_notes staff disjunct, UNCHANGED here) and changes ONE line in the non-staff branch: a
  session note''s own SUBJECT (never a guardian, never a parent — unchanged) now reads it only when
  shared_with_client_at IS NOT NULL, written per-row by a staff member via the share/unshare route.
  Default NULL on every row, so nothing written before this migration or never explicitly shared
  becomes visible. Still SECURITY DEFINER with an empty search_path.';

-- ── §c · SELF-CHECK, PART 1 — THE SHAPE THIS FILE CLAIMS ───────────────────────────────────────
DO $shape_check$
DECLARE
  r    record;
  fdef text;
BEGIN
  SELECT p.prosecdef,
         (p.proconfig IS NOT NULL AND EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE left(c, 12) = 'search_path=')) AS has_search_path
    INTO r
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'keystone' AND p.proname = 'document_is_visible';
  IF NOT FOUND THEN
    RAISE EXCEPTION '0420: keystone.document_is_visible does not exist after CREATE OR REPLACE';
  END IF;
  IF NOT r.prosecdef THEN
    RAISE EXCEPTION '0420: keystone.document_is_visible is not SECURITY DEFINER';
  END IF;
  IF NOT r.has_search_path THEN
    RAISE EXCEPTION '0420: keystone.document_is_visible has no pinned search_path — hijackable (0120''s lesson)';
  END IF;

  -- ★★★ THE POSITIVE CONTROL FOR "COPY 0388's BODY, NOT 0194's" — checked on the FUNCTION'S OWN
  --     TEXT, not just asserted by comment. If this ever goes missing, 0420 quietly reverted 12.15.
  fdef := pg_get_functiondef('keystone.document_is_visible(keystone.document_instance)'::regprocedure);
  IF position('team_wide_notes' IN fdef) = 0 THEN
    RAISE EXCEPTION '0420: keystone.document_is_visible no longer contains 0388''s team_wide_notes disjunct — started from the wrong body';
  END IF;
  IF position('shared_with_client_at' IN fdef) = 0 THEN
    RAISE EXCEPTION '0420: keystone.document_is_visible does not read shared_with_client_at — the share line was not applied';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'keystone' AND table_name = 'document_instance'
                    AND column_name = 'shared_with_client_at' AND data_type = 'timestamp with time zone'
                    AND is_nullable = 'YES') THEN
    RAISE EXCEPTION '0420: keystone.document_instance.shared_with_client_at is not the nullable timestamptz §A claims';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'keystone' AND table_name = 'document_instance'
                    AND column_name = 'shared_by' AND data_type = 'uuid' AND is_nullable = 'YES') THEN
    RAISE EXCEPTION '0420: keystone.document_instance.shared_by is not the nullable uuid §A claims';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                  WHERE conname = 'document_instance_shared_by_fkey'
                    AND conrelid = 'keystone.document_instance'::regclass) THEN
    RAISE EXCEPTION '0420: document_instance_shared_by_fkey does not exist';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                  WHERE conname = 'share_pair'
                    AND conrelid = 'keystone.document_instance'::regclass
                    AND contype = 'c') THEN
    RAISE EXCEPTION '0420: share_pair CHECK constraint does not exist';
  END IF;

  RAISE NOTICE '0420: keystone.document_is_visible is SECURITY DEFINER, search_path pinned, still carries 0388''s team_wide_notes disjunct, and now reads shared_with_client_at; document_instance carries shared_with_client_at/shared_by with their FK and share_pair CHECK.';
END
$shape_check$;

-- ── §d · SELF-CHECK, PART 2 — A FABRICATED PRACTICE, WITH POSITIVE CONTROLS ────────────────────
-- ★★★ FIVE ASSERTIONS, IN ONE PROBE TENANT: (1) the subject sees NOTHING of an unshared note
--     (negative). (2) POSITIVE CONTROL, same note, same subject: once a staff member (the writer)
--     shares it, the subject sees it. (3) the subject's GUARDIAN, even with the SAME note SHARED,
--     sees NOTHING — proving sharing never widens who besides the subject reads it; its positive
--     control is (2) in this same test. (4) NEGATIVE CONTROL for CC-36: a second coach, holding a
--     real person/view/everything grant but NO note grant and not the writer or assigned coach of a
--     SECOND fabricated note, sees nothing while tenant_setting people.team_wide_notes is absent.
--     (5) POSITIVE CONTROL for CC-36 — "0388's body survived 0420": the SAME coach, the SAME note,
--     once people.team_wide_notes = true is set, sees it. Everything fabricated here is deleted at
--     the end of the block; nothing survives the migration.
--
-- ★★ F490 BRACKET [`0018:113-120,169-179`'s house pattern, copied by 0194 §d]: `keystone.tenant` is
--    FORCE RLS with no INSERT policy `app_owner` (NOBYPASSRLS) can satisfy — suspend FORCE for the
--    bootstrap, act, restore it IN THE SAME TRANSACTION, and ASSERT it came back.
ALTER TABLE keystone.tenant NO FORCE ROW LEVEL SECURITY;

DO $note_share_check$
DECLARE
  v_tenant       uuid;
  v_cat          uuid;
  v_type         uuid;

  -- ── block 1: the subject/guardian pair, one note ──────────────────────────────────────────
  v_writer1      uuid;  -- staff coach who writes and later shares note1
  v_subject1     uuid;  -- the note's own subject — the client
  v_guardian1    uuid;  -- v_subject1's guardian — must NEVER see a session note, shared or not
  v_note1        uuid;

  -- ── block 2: CC-36's positive/negative control for "0388 survived" ───────────────────────
  v_owner2       uuid;  -- subject2's real assigned coach (owner_user_id)
  v_writer2      uuid;  -- writes note2, never the viewer under test
  v_viewer2      uuid;  -- the coach under test: not writer2, not owner2
  v_subject2     uuid;
  v_note2        uuid;
  v_role_id      uuid;

  v_seen         integer;
BEGIN
  INSERT INTO keystone.tenant (slug, name, timezone, status)
  VALUES ('m0420-probe', 'M0420 probe', 'UTC', 'active') RETURNING id INTO v_tenant;

  PERFORM set_config('keystone.tenant_id', v_tenant::text, true);
  IF keystone.current_tenant_id() IS DISTINCT FROM v_tenant THEN
    RAISE EXCEPTION '0420: the tenant context did not take effect for the probe tenant';
  END IF;

  INSERT INTO keystone.document_category (tenant_id, key, label)
  VALUES (v_tenant, 'm0420_cat', 'M0420 cat') RETURNING id INTO v_cat;

  INSERT INTO keystone.document_type
    (tenant_id, key, label, category_id, sub_category, signer_config, audience, division,
     applies_to, default_assigned_to, is_session_note)
  VALUES (v_tenant, 'm0420_note', 'M0420 Note', v_cat, 'notes', 'COACH_ONLY',
          ARRAY['adult_client','staff'], 'recovery', ARRAY['adult_client'], ARRAY['coach'], true)
  RETURNING id INTO v_type;

  -- ═══════════════════════════════════════════════════════════════════════════════════════
  -- BLOCK 1 — unshared → nothing; shared → the subject only; the guardian never, even shared.
  -- ═══════════════════════════════════════════════════════════════════════════════════════
  INSERT INTO keystone.app_user (tenant_id, email, display_name, role, staff_role)
  VALUES (v_tenant, 'm0420-writer1@example.invalid', 'M0420 writer1', 'staff', 'coach')
  RETURNING id INTO v_writer1;

  INSERT INTO keystone.app_user (tenant_id, email, display_name, role)
  VALUES (v_tenant, 'm0420-subject1@example.invalid', 'M0420 subject1', 'adult_client')
  RETURNING id INTO v_subject1;

  INSERT INTO keystone.app_user (tenant_id, email, display_name, role)
  VALUES (v_tenant, 'm0420-guardian1@example.invalid', 'M0420 guardian1', 'parent')
  RETURNING id INTO v_guardian1;

  INSERT INTO keystone.guardian (tenant_id, guardian_user_id, child_user_id)
  VALUES (v_tenant, v_guardian1, v_subject1);

  v_note1 := keystone.uuid_generate_v7();
  INSERT INTO keystone.document_instance
    (id, tenant_id, builder, title, type_id, subject_user_id, created_by, assigned_to, state, sent_at)
  VALUES (v_note1, v_tenant, 'form', 'M0420 probe note (shareable)', v_type, v_subject1, v_writer1,
          ARRAY['client'], 'sent', now());

  -- ── (1) UNSHARED — the subject sees NOTHING ─────────────────────────────────────────────
  PERFORM set_config('keystone.user_id', v_subject1::text, true);
  SELECT count(*) INTO v_seen FROM keystone.document_instance WHERE id = v_note1;
  IF v_seen <> 0 THEN
    RAISE EXCEPTION '0420: the subject saw % row(s) of their own UNSHARED session note, expected 0', v_seen;
  END IF;

  -- ── share it, as the writer (a staff viewer who already sees the note via the writer
  --    disjunct, so the UPDATE's target row is visible to the actor performing it) ─────────
  PERFORM set_config('keystone.user_id', v_writer1::text, true);
  UPDATE keystone.document_instance
     SET shared_with_client_at = now(), shared_by = v_writer1
   WHERE id = v_note1;

  -- ── (2) POSITIVE CONTROL — the SAME note, SAME subject, now SHARED: visible ────────────
  PERFORM set_config('keystone.user_id', v_subject1::text, true);
  SELECT count(*) INTO v_seen FROM keystone.document_instance WHERE id = v_note1;
  IF v_seen <> 1 THEN
    RAISE EXCEPTION '0420: the subject saw % row(s) of their own SHARED session note, expected 1 (positive control)', v_seen;
  END IF;

  -- ── (3) THE GUARDIAN — same note, SHARED, sees NOTHING (its positive control is (2) above) ─
  PERFORM set_config('keystone.user_id', v_guardian1::text, true);
  SELECT count(*) INTO v_seen FROM keystone.document_instance WHERE id = v_note1;
  IF v_seen <> 0 THEN
    RAISE EXCEPTION '0420: the subject''s guardian saw % row(s) of a SHARED session note, expected 0 — sharing widened who besides the subject may read it', v_seen;
  END IF;

  -- ═══════════════════════════════════════════════════════════════════════════════════════
  -- BLOCK 2 — CC-36's control: 0388's team_wide_notes disjunct must survive 0420's CREATE OR
  -- REPLACE. Entirely within the STAFF branch, which 0420 does not touch.
  -- ═══════════════════════════════════════════════════════════════════════════════════════
  INSERT INTO keystone.app_user (tenant_id, email, display_name, role, staff_role)
  VALUES (v_tenant, 'm0420-owner2@example.invalid', 'M0420 owner2', 'staff', 'coach')
  RETURNING id INTO v_owner2;

  INSERT INTO keystone.app_user (tenant_id, email, display_name, role, staff_role)
  VALUES (v_tenant, 'm0420-writer2@example.invalid', 'M0420 writer2', 'staff', 'coach')
  RETURNING id INTO v_writer2;

  INSERT INTO keystone.app_user (tenant_id, email, display_name, role, staff_role)
  VALUES (v_tenant, 'm0420-viewer2@example.invalid', 'M0420 viewer2', 'staff', 'coach')
  RETURNING id INTO v_viewer2;

  INSERT INTO keystone.app_user (tenant_id, email, display_name, role, owner_user_id)
  VALUES (v_tenant, 'm0420-subject2@example.invalid', 'M0420 subject2', 'adult_client', v_owner2)
  RETURNING id INTO v_subject2;

  v_note2 := keystone.uuid_generate_v7();
  INSERT INTO keystone.document_instance
    (id, tenant_id, builder, title, type_id, subject_user_id, created_by, assigned_to, state, sent_at)
  VALUES (v_note2, v_tenant, 'form', 'M0420 probe note (team-wide)', v_type, v_subject2, v_writer2,
          ARRAY['coach'], 'sent', now());

  -- v_viewer2 holds a real person/view/everything grant — never a note grant — exactly the shape
  -- CC-36's header requires: the team-wide disjunct is what carries this coach, nothing else.
  INSERT INTO keystone.role (tenant_id, key, label, is_builtin)
  VALUES (v_tenant, 'm0420_probe_role', 'M0420 probe role', false) RETURNING id INTO v_role_id;
  INSERT INTO keystone.role_permission (tenant_id, role_id, object, verb, scope)
  VALUES (v_tenant, v_role_id, 'person', 'view', 'everything');
  INSERT INTO keystone.user_role (tenant_id, user_id, role_id, granted_by)
  VALUES (v_tenant, v_viewer2, v_role_id, v_viewer2);

  -- ── (4) NEGATIVE CONTROL — the setting is ABSENT: the grant alone is not enough ──────────
  PERFORM set_config('keystone.user_id', v_viewer2::text, true);
  SELECT count(*) INTO v_seen FROM keystone.document_instance WHERE id = v_note2;
  IF v_seen <> 0 THEN
    RAISE EXCEPTION '0420: a coach with person/view/everything but no note grant, not the writer, not the assigned coach, saw % row(s) of a colleague''s session note with people.team_wide_notes ABSENT, expected 0', v_seen;
  END IF;

  INSERT INTO keystone.tenant_setting (tenant_id, key, value)
  VALUES (v_tenant, 'people.team_wide_notes', 'true'::jsonb);

  -- ── (5) POSITIVE CONTROL — CC-36's whole point: 0388's disjunct survived 0420's CREATE OR
  --    REPLACE. Same viewer, same grant, same note — now visible because the setting is on. ──
  SELECT count(*) INTO v_seen FROM keystone.document_instance WHERE id = v_note2;
  IF v_seen <> 1 THEN
    RAISE EXCEPTION '0420: the SAME coach, holding person/view/everything, saw % row(s) of a colleague''s session note with people.team_wide_notes = true, expected 1 — 0388''s team_wide_notes disjunct did not survive 0420 (CC-36)', v_seen;
  END IF;

  -- ── cleanup — delete each document_instance row under an identity the DELETE policy admits,
  --    then drop everything else with no viewer context ────────────────────────────────────
  -- ★★★ REHEARSAL FIX (25 Sep 2026, MEASURED against a copy of production). The first draft deleted
  --     v_note1 as v_subject1 and v_note2 as v_owner2 — identities that can SEE the rows. But
  --     visibility is the SELECT policy; the ONLY delete policy on document_instance is
  --     `staff_delete`, whose USING requires the current user's app_user.role = 'staff'. A client
  --     subject matched ZERO rows, silently, and the later document_type delete then failed on
  --     document_instance_type_id_fkey. Each note is deleted as its own staff writer, and
  --     each delete must remove exactly one row — a silent no-op is worse than a failure.
  DECLARE v_gone integer;
  BEGIN
    PERFORM set_config('keystone.user_id', v_writer1::text, true);
    DELETE FROM keystone.document_instance WHERE id = v_note1;
    GET DIAGNOSTICS v_gone = ROW_COUNT;
    IF v_gone <> 1 THEN RAISE EXCEPTION '0420 cleanup: deleting probe note1 removed % rows, expected 1', v_gone; END IF;
    -- ★ note2 is invisible to v_writer1 (DELETE needs the SELECT policy too) — its own writer,
    --   v_writer2 (role 'staff'), both sees it and passes staff_delete.
    PERFORM set_config('keystone.user_id', v_writer2::text, true);
    DELETE FROM keystone.document_instance WHERE id = v_note2;
    GET DIAGNOSTICS v_gone = ROW_COUNT;
    IF v_gone <> 1 THEN RAISE EXCEPTION '0420 cleanup: deleting probe note2 removed % rows, expected 1', v_gone; END IF;
  END;

  PERFORM set_config('keystone.user_id', '', true);
  DELETE FROM keystone.tenant_setting WHERE tenant_id = v_tenant;
  DELETE FROM keystone.user_role WHERE tenant_id = v_tenant;
  DELETE FROM keystone.role_permission WHERE tenant_id = v_tenant;
  DELETE FROM keystone.role WHERE tenant_id = v_tenant;
  DELETE FROM keystone.guardian WHERE tenant_id = v_tenant;
  DELETE FROM keystone.document_type WHERE tenant_id = v_tenant;
  DELETE FROM keystone.document_category WHERE tenant_id = v_tenant;
  DELETE FROM keystone.app_user WHERE tenant_id = v_tenant;
  PERFORM set_config('keystone.tenant_id', '', true);
  DELETE FROM keystone.tenant WHERE id = v_tenant;

  RAISE NOTICE '0420: unshared session note invisible to its subject (0); the SAME note, shared, visible to the subject (1, positive control); the subject''s guardian, same shared note, invisible (0); a coach with person/view/everything, no note grant, saw a colleague''s session note only once people.team_wide_notes = true was set (0 then 1, CC-36''s control that 0388''s disjunct survived). Probe tenant % removed.', v_tenant;
END
$note_share_check$;

ALTER TABLE keystone.tenant FORCE ROW LEVEL SECURITY;

-- ★★ PROVE FORCE IS BACK ON — 0018's own reasoning, verbatim: leaving it off would silently disable
--    tenant isolation on the root table of the whole schema, and every later migration and gate
--    would still pass.
DO $$
DECLARE forced boolean;
BEGIN
  SELECT relforcerowsecurity INTO forced FROM pg_class WHERE oid = 'keystone.tenant'::regclass;
  IF NOT forced THEN
    RAISE EXCEPTION '0420: FORCE ROW LEVEL SECURITY was not restored on keystone.tenant';
  END IF;
END $$;
