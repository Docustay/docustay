-- 0074 — P1.6 · THE GUARDIAN RELATION, AND THE RULE THAT STOPS HOLDING VACUOUSLY.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ `db/migrations/0012_assigned_to_gate.sql` SAID THIS GAP OUT LOUD IN ITS OWN BODY:
--       *"A parent link is not modelled yet, so a parent reaching another person's document is
--        refused — fail closed, not 'probably fine'."*
--     [MEASURED] 25 foreign keys reference `app_user` and **not one was `app_user → app_user`**
--     until P1.4 added `app_user_owner_fkey`. There was no guardian column anywhere.
--
-- ★★★ SO R4's PARENT RULE HAS BEEN HOLDING **VACUOUSLY** — the safe answer for the wrong reason.
--     "A parent cannot see another person's documents" is trivially true of a system where a parent
--     is connected to nobody. The e2e suite records this honestly, in a spec titled *"⊘ the
--     parent↔child half cannot be tested — there is no link in the schema"*. **This migration is
--     that spec's stated clearing condition**, and the moment it lands the rule becomes falsifiable
--     for the first time — which is the only state in which it is worth anything.
--
-- ★★ ONE HOP, NOT A HIERARCHY. Unlike `team` (0070) this relation is deliberately NOT recursive: a
--    guardian's guardian is not a guardian. Grandparent access is a real request and it will be a
--    second ROW, stated explicitly, never an inferred edge — because an inferred edge here would
--    quietly widen who can read a child's paperwork.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

CREATE TABLE keystone.guardian (
  tenant_id uuid NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  guardian_user_id uuid NOT NULL,
  child_user_id uuid NOT NULL,

  -- ★ What kind of guardian. Free text over an enum on purpose: the legal vocabulary varies by
  --   jurisdiction, nothing BRANCHES on this value, and a CHECK here would be a list somebody has
  --   to maintain for a field that is only ever displayed.
  relationship text NOT NULL DEFAULT 'parent'
    CONSTRAINT guardian_relationship_present CHECK (btrim(relationship) <> ''),

  created_by uuid REFERENCES keystone.app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant_id, guardian_user_id, child_user_id),

  -- ★★ Nobody is their own guardian. Cheap, and it removes the only self-edge that could make a
  --    future `WHERE guardian = child` read as a real relationship.
  CONSTRAINT guardian_not_self CHECK (guardian_user_id <> child_user_id),

  -- ★★★ COMPOSITE, BOTH SIDES. Same argument as every other cross-row FK added in P1: RLS does not
  --     police foreign keys — the check runs as the table owner — so without `tenant_id` in the key
  --     a guardian in tenant A could be linked to a child in tenant B, and **both rows would pass
  --     their own policy**. On this table that is not a data-quality issue; it is one practice's
  --     parent reading another practice's child's paperwork.
  CONSTRAINT guardian_guardian_fkey
    FOREIGN KEY (tenant_id, guardian_user_id) REFERENCES keystone.app_user (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT guardian_child_fkey
    FOREIGN KEY (tenant_id, child_user_id) REFERENCES keystone.app_user (tenant_id, id) ON DELETE CASCADE
);

-- ★ Both directions are read: "whose guardian is this person" (the child's record page) and "who are
--   this child's guardians" (the notification recipient list). The PK covers the first.
CREATE INDEX guardian_child_idx ON keystone.guardian (tenant_id, child_user_id);

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- ★★ THE PREDICATE. One hop, one place.
-- ───────────────────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION keystone.is_guardian_of(p_guardian_id uuid, p_child_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  -- ★ NULL on either side is false, never true. `document_is_visible` calls this with
  --   `current_user_id()`, which is NULL on the webhook and worker paths (0001) — and a question
  --   about a viewer has no answer when there is no viewer.
  SELECT p_guardian_id IS NOT NULL AND p_child_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM keystone.guardian g
     WHERE g.guardian_user_id = p_guardian_id AND g.child_user_id = p_child_id);
$$;

COMMENT ON FUNCTION keystone.is_guardian_of(uuid, uuid) IS
  'P1.6 — is this person a guardian of that one? ★★ ONE HOP, deliberately not recursive: a '
  'guardian''s guardian is not a guardian. Grandparent access is a second ROW, stated explicitly, '
  'never an inferred edge — an inferred edge would quietly widen who can read a child''s paperwork.';

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- ★★★ AND `document_is_visible` CONSULTS IT — ONE LINE CHANGES, AND ONLY ONE.
-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- ★★ THE ORDER OF THE CHECKS BELOW IS LOad-BEARING AND IS NOT TOUCHED. The session-note refusal
--    (`is_session_note AND role = 'parent'`) sits AFTER the subject check, so widening the subject
--    check to admit guardians lets a parent REACH their child's documents and then be refused the
--    session notes by the very next gate. ★ Reordering these two would silently hand a parent their
--    child's session notes, which is the single most sensitive thing this function protects.
CREATE OR REPLACE FUNCTION keystone.document_is_visible(p_instance keystone.document_instance)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
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

  IF p_instance.deleted THEN RETURN false; END IF;
  IF v_viewer.role = 'staff' THEN RETURN true; END IF;
  IF p_instance.state = 'draft' THEN RETURN false; END IF;

  -- ★★★ P1.6 — THE ONE LINE THIS MIGRATION CHANGES. It used to read:
  --       IF p_instance.subject_user_id IS DISTINCT FROM v_viewer.id THEN RETURN false; END IF;
  --     with a comment saying a parent link "is not modelled yet". It is now.
  --   ★★ A GUARDIAN REACHES THEIR CHILD'S DOCUMENTS **AND NOBODY ELSE'S** — `is_guardian_of` is an
  --      EXISTS on one explicit row, so a parent with no linked child is exactly as refused as
  --      before, and the fail-closed property is unchanged for everyone else.
  IF p_instance.subject_user_id IS DISTINCT FROM v_viewer.id
     AND NOT keystone.is_guardian_of(v_viewer.id, p_instance.subject_user_id) THEN
    RETURN false;
  END IF;

  SELECT t.audience, t.is_session_note INTO v_type
    FROM keystone.document_type t WHERE t.id = p_instance.type_id;
  IF NOT FOUND THEN RETURN false; END IF;

  -- ★★★ SESSION NOTES, NEVER, TO A PARENT — AND THIS GATE IS NOW LOAD-BEARING FOR THE FIRST TIME.
  --     Until 0074 a parent could not reach a child's document at all, so this line never fired on
  --     a real pairing; it was the second lock on a door nobody could get to. **It is now the only
  --     thing standing between a guardian and their child's session notes.**
  IF v_type.is_session_note AND v_viewer.role = 'parent' THEN RETURN false; END IF;

  IF NOT (v_viewer.role = ANY(v_type.audience)) THEN RETURN false; END IF;

  -- ★ Map the viewer's PARTY role. NEVER FALL BACK FROM ONE PARTY TO ANOTHER (§2.7): an unmapped
  -- role returns NULL and is refused rather than borrowing `client`.
  v_party := CASE v_viewer.role
               WHEN 'adult_client'      THEN 'pir'
               WHEN 'adolescent_client' THEN 'pir'
               WHEN 'parent'            THEN 'parent'
               ELSE NULL
             END;
  IF v_party IS NULL THEN RETURN false; END IF;

  IF p_instance.assigned_to = '{}'::text[] THEN RETURN false; END IF;

  RETURN 'both' = ANY(p_instance.assigned_to) OR v_party = ANY(p_instance.assigned_to);
END $function$;

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- RLS — ENABLE **AND** FORCE.
-- ───────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE keystone.guardian ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.guardian FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON keystone.guardian
  USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert ON keystone.guardian
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update ON keystone.guardian
  FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
          WITH CHECK (tenant_id = keystone.require_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.guardian TO app_rw;

COMMENT ON TABLE keystone.guardian IS
  'P1.6 — who may act for a child. ★★★ Before 0074 there was NO app_user → app_user link of any '
  'kind, so R4''s parent rule held VACUOUSLY: "a parent cannot see another person''s documents" is '
  'trivially true when a parent is connected to nobody. ★ The e2e spec titled "⊘ the parent↔child '
  'half cannot be tested" named this migration as its clearing condition. ★★ ONE HOP: a guardian''s '
  'guardian is not a guardian.';
