-- 0012_assigned_to_gate
-- P6.3 — ★★★ `assignedTo` IS A GATE, NOT A LABEL.
--
-- [MEAS] it is "the only per-document gate the rules actually read, and named in no plan
-- document" — and [MEAS, E1 §6.4] the parent path's own comment claiming the rules filter it is
-- FALSE for its path and cites stale line numbers. ★ Simultaneously the only real gate and the one
-- nobody had written down correctly.
--
-- ★★ AUDIENCE AND ASSIGNED-TO ARE DIFFERENT QUESTIONS AND BOTH MUST PASS:
--   · `audience`   — ORG POLICY, set once per TYPE: "may a parent EVER see a consent form?"
--   · `assignedTo` — THIS DOCUMENT's parties: "is this particular instrument for them?"
-- ★ Collapsing them loses one or the other. Per-type alone would show a client every other
-- client's agreement of the same type; per-document alone is the hand-set visibility that P6.4
-- rejects because it does not survive a second tenant.

CREATE OR REPLACE FUNCTION keystone.document_is_visible(
  p_instance keystone.document_instance
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_viewer record;
  v_type   record;
  v_party  text;
BEGIN
  -- ★★ FAIL CLOSED. No acting user means no documents — not "all of them".
  SELECT u.id, u.role, u.staff_role INTO v_viewer
    FROM keystone.app_user u
   WHERE u.id = keystone.current_user_id()
     AND u.tenant_id = p_instance.tenant_id;
  IF NOT FOUND THEN RETURN false; END IF;

  -- ★ Soft-deleted is invisible to everyone on the read path. [MEAS, D1] the legacy rules
  -- enforced this on `get` but NOT on `list`, deliberately, because a Firestore `!=` condition on
  -- list fails the whole query. ★ A Postgres predicate NARROWS a result set; it does not reject.
  IF p_instance.deleted THEN RETURN false; END IF;

  -- ★ Staff see their tenant's documents; RLS has already constrained this to one tenant.
  IF v_viewer.role = 'staff' THEN RETURN true; END IF;

  -- ★★ A DRAFT IS NOT VISIBLE TO A NON-STAFF VIEWER. [MEAS, D1] enforced NOWHERE in the legacy
  -- rules, so a raw read returned un-sent coach drafts.
  IF p_instance.state = 'draft' THEN RETURN false; END IF;

  -- ★ Only ever about a person the viewer is entitled to. A parent link is not modelled yet, so
  -- a parent reaching another person's document is refused — fail closed, not "probably fine".
  IF p_instance.subject_user_id IS DISTINCT FROM v_viewer.id THEN RETURN false; END IF;

  SELECT t.audience, t.is_session_note INTO v_type
    FROM keystone.document_type t WHERE t.id = p_instance.type_id;

  -- ★★★ AN UNTYPED INSTANCE IS INVISIBLE. A document whose visibility rule cannot be resolved
  -- must not default to visible — that default IS D1.
  IF NOT FOUND THEN RETURN false; END IF;

  -- ★★★ SESSION NOTES, NEVER, TO A PARENT. The TYPE constraint makes the data unrepresentable;
  -- this is the second lock, because a constraint added today does not clean rows written
  -- yesterday — and Phase 11 MIGRATES INTO this database.
  IF v_type.is_session_note AND v_viewer.role = 'parent' THEN RETURN false; END IF;

  -- ★★★ GATE 1 — ORG POLICY. The axis E1 measured that NOTHING reads today.
  IF NOT (v_viewer.role = ANY(v_type.audience)) THEN RETURN false; END IF;

  -- ★★★ GATE 2 — THIS DOCUMENT'S PARTIES. `assignedTo`, finally read as a gate.
  -- ★ Map the viewer's PARTY role. NEVER FALL BACK FROM ONE PARTY TO ANOTHER (§2.7): an unmapped
  -- role returns NULL and is refused rather than borrowing `client`, which is the exact defect
  -- that once put a tech client's signature under a badge reading "PIR".
  v_party := CASE v_viewer.role
               WHEN 'adult_client'      THEN 'pir'
               WHEN 'adolescent_client' THEN 'pir'
               WHEN 'parent'            THEN 'parent'
               ELSE NULL
             END;
  IF v_party IS NULL THEN RETURN false; END IF;

  -- ★ An EMPTY assignedTo admits nobody. [MEAS] the default is '{}', so a document created
  -- without stating its parties is invisible to clients until someone says who it is for.
  -- Fail closed on the field whose whole job is to say who may have it.
  IF p_instance.assigned_to = '{}'::text[] THEN RETURN false; END IF;

  RETURN 'both' = ANY(p_instance.assigned_to) OR v_party = ANY(p_instance.assigned_to);
END $$;

COMMENT ON FUNCTION keystone.document_is_visible(keystone.document_instance) IS
  'P6.3/P6.5 — the ONE visibility predicate. TWO gates: audience (org policy, per TYPE) AND assignedTo (this document''s parties). Legacy isClientVisible() was, in full, "deleted !== true".';
