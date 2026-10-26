-- 0011_document_axes_and_visibility
-- P6.2–P6.6 — SEVEN AXES · per-TYPE visibility · categories that are DATA, not code
--
-- ══ ★★★ WHAT D1 AND D2 ACTUALLY ARE, AND WHY THIS MIGRATION RETIRES THE WHOLE CLASS ══
--
-- D1 [MEAS, firestore.rules:648-650]: `allow list` on a client's own documents carries NO
-- condition beyond ownership — not `deleted`, not `draft`, not signer, no field projection. A
-- client issuing a raw SDK read receives EVERY document under their uid, full bodies, including
-- `templateSnapshot` and `instanceBilling`.
-- D2 [MEAS, useUnifiedDocuments.ts:149-151]: the parent path is weaker still, and its comment
-- claiming the rules filter `assignedTo` is false for its own path and cites stale line numbers.
--
-- ★★★ THE ROOT CAUSE IS NOT A MISSING CONDITION. IT IS TWO ENFORCEMENT PATHS.
-- [MEAS, E1 §6.3] the app enforces four conditions and the rules enforce one, and they were
-- written on different days by people solving different problems. E1's own table shows three of
-- the four are "application policy, not security policy". ★ Any product with an app path AND a
-- rules path will drift, because nothing forces them to be the same sentence.
--
-- ★★ KEYSTONE HAS ONE PATH. The predicate below IS the query — RLS is evaluated by Postgres on
-- every statement, from every client, including a raw `psql`. There is no "app path" to disagree
-- with it, because there is no second place to write the rule. That is the fix: not a tighter
-- condition, but a shape in which the defect cannot be expressed.

-- ─────────────────────────────────────────────────────────────────────────────
-- ★★ THE VIEWER'S IDENTITY, ALONGSIDE THE TENANT
-- ─────────────────────────────────────────────────────────────────────────────
-- ★ Until now the only request context was `keystone.tenant_id`. A per-TYPE visibility rule has
-- to know WHO is asking, so the request also carries the acting user. Same mechanism, same
-- transaction-local lifetime (`set_config(..., true)`), set by the same `withTenant()`.
CREATE OR REPLACE FUNCTION keystone.current_user_id()
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('keystone.user_id', true), '')::uuid
$$;

COMMENT ON FUNCTION keystone.current_user_id() IS
  'P6 — the ACTING USER for this transaction. STABLE, never IMMUTABLE: IMMUTABLE would let the planner fold an identity into a cached plan and serve one user''s rows to another.';

-- ─────────────────────────────────────────────────────────────────────────────
-- P6.6 — CATEGORIES ARE DATA. Adding one is an INSERT, not a deploy.
-- ─────────────────────────────────────────────────────────────────────────────
-- ★★ [MEAS, E1 §2.1 + §3.1] in the legacy system a tenant CANNOT add a category without a code
-- change: it takes edits in five files across three deploy targets. ★ And [MEAS, E1 §1.2] the
-- category enum has FOUR independent declarations that do not match, while the drift guard stays
-- green because it never reads two of them.
-- ★★★ A row in a table has exactly one definition. That is the entire fix for axis 1.
CREATE TABLE keystone.document_category (
  id          uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id   uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  -- ★ `key` is bucket C — an IDENTIFIER, never renamed, never translated.
  key         text        NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]*$'),
  -- ★ `label` is bucket A — what the tenant calls it. Changing it is a rename, not a migration.
  label       text        NOT NULL,
  sort_order  integer     NOT NULL DEFAULT 100,
  active      boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, key)
);
CREATE INDEX document_category_tenant_idx ON keystone.document_category (tenant_id);

COMMENT ON TABLE keystone.document_category IS
  'P6.6 / AXIS 1 — where a document sits in the client''s journey (THE TAB). DATA, not code: adding a category is an INSERT. The legacy enum had four conflicting declarations across five files.';

-- ─────────────────────────────────────────────────────────────────────────────
-- ★★★ THE DOCUMENT TYPE — WHERE ALL SEVEN AXES LIVE, AND WHERE VISIBILITY IS SET
-- ─────────────────────────────────────────────────────────────────────────────
-- ★★ P6.4: "Visibility is per document TYPE, set by the org — NEVER per document by hand."
-- Hand-set visibility does not survive a second tenant: it is a decision re-made, correctly or
-- not, on every single document, by whoever happens to be creating it.
CREATE TABLE keystone.document_type (
  id           uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id    uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  key          text        NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]*$'),
  label        text        NOT NULL,

  -- ══ THE SEVEN AXES ══════════════════════════════════════════════════════
  -- ★ AXIS 1 — where it sits in the client's journey → THE TAB.
  -- [MEAS, vocabulary.cjs:686-720] `tabForCategory()` carries an explicit instruction that axis 1
  -- must NEVER consult axis 2 ("if you are tempted to add `if (subCategory === …)` — that is the
  -- bug"). Keeping them as two columns on one row preserves that separation by construction.
  category_id  uuid        NOT NULL REFERENCES keystone.document_category(id) ON DELETE RESTRICT,

  -- ★ AXIS 2 — what KIND of instrument it is → a tag. [MEAS, E1 §1.4] this axis is the one that
  -- did NOT drift, because it has a compile-time link between its runtime list and its type union.
  sub_category text        NOT NULL,

  -- ★ AXIS 3 — who signs, and IN WHAT ORDER. [MEAS, E1 §4.1] there are ELEVEN values, not eight;
  -- the legacy doc comment says "eight" in five places above a list of eleven. All eleven here.
  signer_config text      NOT NULL CHECK (signer_config IN (
    'PIR_ONLY','COACH_ONLY','CO_SIGNED','PARENT_ONLY','PARENT_AND_COACH','PIR_PARENT_COACH',
    'CLIENT_ONLY','CLIENT_AND_CONSULTANT','FAMILY_MEMBER_ONLY','RECIPIENT_ONLY','RECIPIENT_AND_COACH'
  )),

  -- ★★★ AXIS 4 — AUDIENCE. THE VISIBILITY GATE, AND IT IS THE POINT OF THIS MIGRATION.
  -- [MEAS, E1 §6.1] the legacy `isClientVisible(doc)` is, in full, `return doc.deleted !== true`.
  -- No category, no type, no status, no signer, no assignedTo. ★★ So a COACH_ONLY note is hidden
  -- from a client ONLY as a SIDE EFFECT of the client not being a required signer — the axis that
  -- names the intent is read by nothing. Here it is read by the POLICY.
  audience     text[]      NOT NULL DEFAULT '{}' CHECK (
                 audience <@ ARRAY['staff','adult_client','adolescent_client','parent']::text[]),

  -- ★ AXIS 5 — which division of the business owns it.
  division     text        NOT NULL DEFAULT 'recovery' CHECK (division IN ('recovery','tech')),

  -- ★ AXIS 6 — which kind of person the type is FOR (distinct from who may SEE it).
  applies_to   text[]      NOT NULL DEFAULT '{}' CHECK (
                 applies_to <@ ARRAY['adult_client','adolescent_client','parent','staff']::text[]),

  -- ★★ AXIS 7 — assignedTo. [MEAS] "the only per-document gate the rules actually read, and named
  -- in no plan document." It is the DEFAULT here; the instance carries the actual value.
  default_assigned_to text[] NOT NULL DEFAULT '{}' CHECK (
                 default_assigned_to <@ ARRAY['pir','parent','coach','client','consultant',
                                              'familyMember','recipient','both']::text[]),

  -- ★★★ SESSION NOTES. Part D, verbatim: "Parent visibility is unchanged and not up for
  -- discussion: money, documents, attendance YES; session notes NEVER." A flag on the TYPE, so
  -- the rule is stated once per type rather than re-decided per note.
  is_session_note boolean  NOT NULL DEFAULT false,

  active       boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, key),

  -- ★★★ THE NON-NEGOTIABLE, MADE UNREPRESENTABLE.
  -- A session-note TYPE may not list `parent` in its audience. Not "should not" — cannot.
  CONSTRAINT session_notes_never_to_parents CHECK (
    NOT (is_session_note AND 'parent' = ANY(audience))
  )
);
CREATE INDEX document_type_tenant_idx ON keystone.document_type (tenant_id);

COMMENT ON COLUMN keystone.document_type.audience IS
  'P6.4 — ★★★ THE VISIBILITY GATE. Set per TYPE by the org, never per document by hand. Read by the RLS policy on document_instance, which is the ONLY enforcement path.';
COMMENT ON CONSTRAINT session_notes_never_to_parents ON keystone.document_type IS
  'Part D: "session notes NEVER" to parents. A CHECK, not a convention.';

-- ─────────────────────────────────────────────────────────────────────────────
-- The instance grows its type link and its own assignedTo
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE keystone.document_instance
  ADD COLUMN type_id     uuid REFERENCES keystone.document_type(id) ON DELETE RESTRICT,
  ADD COLUMN assigned_to text[] NOT NULL DEFAULT '{}' CHECK (
    assigned_to <@ ARRAY['pir','parent','coach','client','consultant',
                         'familyMember','recipient','both']::text[]),
  ADD COLUMN deleted     boolean NOT NULL DEFAULT false;

CREATE INDEX document_instance_type_idx ON keystone.document_instance (tenant_id, type_id);
CREATE INDEX document_instance_subject_idx
  ON keystone.document_instance (tenant_id, subject_user_id) WHERE NOT deleted;

-- ─────────────────────────────────────────────────────────────────────────────
-- ★★★ THE PREDICATE. THIS IS THE WHOLE OF D1 AND D2.
-- ─────────────────────────────────────────────────────────────────────────────
-- ★ It is a function so that it has ONE definition and can be read, tested and mutated on its
-- own. It is STABLE, not IMMUTABLE — it depends on the request's identity.
CREATE OR REPLACE FUNCTION keystone.document_is_visible(
  p_instance keystone.document_instance
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_viewer   record;
  v_type     record;
BEGIN
  -- ★★ FAIL CLOSED. No acting user means no documents — not "all of them".
  SELECT u.id, u.role, u.staff_role INTO v_viewer
    FROM keystone.app_user u
   WHERE u.id = keystone.current_user_id()
     AND u.tenant_id = p_instance.tenant_id;
  IF NOT FOUND THEN RETURN false; END IF;

  -- ★ Soft-deleted is invisible to EVERYONE on the read path. [MEAS, D1] the legacy rules
  -- enforced this on `get` but NOT on `list`, and E1 records that the asymmetry was deliberate
  -- (a `!=` condition on list fails the whole query). ★ Postgres has no such limitation: a
  -- predicate NARROWS a result set here, it does not reject the query.
  IF p_instance.deleted THEN RETURN false; END IF;

  -- ★ Staff see their tenant's documents. RLS has already constrained this to one tenant.
  IF v_viewer.role = 'staff' THEN RETURN true; END IF;

  -- ★★ A DRAFT IS NOT VISIBLE TO A NON-STAFF VIEWER. [MEAS, D1] the legacy rules did not enforce
  -- this AT ALL, so a raw read returned un-sent coach drafts.
  IF p_instance.state = 'draft' THEN RETURN false; END IF;

  -- ★ A client or parent may only ever reach documents about a person they are entitled to.
  -- For a client that is themselves; a parent link is out of scope until it is modelled, and
  -- until then a parent reaching another person's document is refused — fail closed.
  IF p_instance.subject_user_id IS DISTINCT FROM v_viewer.id THEN RETURN false; END IF;

  SELECT t.audience, t.is_session_note INTO v_type
    FROM keystone.document_type t WHERE t.id = p_instance.type_id;

  -- ★★★ AN INSTANCE WITH NO TYPE IS INVISIBLE TO A CLIENT. A document whose visibility rule
  -- cannot be resolved must not default to visible; that default is exactly how D1 happened.
  IF NOT FOUND THEN RETURN false; END IF;

  -- ★★★ SESSION NOTES, NEVER, TO A PARENT. The TYPE constraint already makes the data
  -- unrepresentable; this is the second lock, because a constraint added later does not
  -- retroactively clean rows written before it.
  IF v_type.is_session_note AND v_viewer.role = 'parent' THEN RETURN false; END IF;

  -- ★★★ AND HERE IS THE AXIS BEING READ — the thing E1 measured NOTHING reads today.
  RETURN v_viewer.role = ANY(v_type.audience);
END $$;

COMMENT ON FUNCTION keystone.document_is_visible(keystone.document_instance) IS
  'P6.5 — ★★★ the ONE visibility predicate, read by the RLS policy. Legacy isClientVisible() was, in full, "deleted !== true"; the axis naming the intent was read by nothing. This reads it.';

-- ★★ REPLACE the blanket tenant policy on document_instance with the real one.
DROP POLICY IF EXISTS tenant_isolation ON keystone.document_instance;

CREATE POLICY tenant_isolation ON keystone.document_instance
  FOR SELECT
  USING (
    tenant_id = keystone.current_tenant_id()
    AND keystone.document_is_visible(document_instance)
  );

-- ★ Writes remain staff-only and tenant-scoped. A client may not create or alter a document.
CREATE POLICY staff_write ON keystone.document_instance
  FOR UPDATE
  USING (tenant_id = keystone.current_tenant_id()
         AND EXISTS (SELECT 1 FROM keystone.app_user u
                      WHERE u.id = keystone.current_user_id() AND u.role = 'staff'));
CREATE POLICY staff_delete ON keystone.document_instance
  FOR DELETE
  USING (tenant_id = keystone.current_tenant_id()
         AND EXISTS (SELECT 1 FROM keystone.app_user u
                      WHERE u.id = keystone.current_user_id() AND u.role = 'staff'));

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS on the two new tables
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['document_category','document_type'] LOOP
    EXECUTE format('ALTER TABLE keystone.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE keystone.%I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format($f$CREATE POLICY tenant_isolation ON keystone.%I
                      USING (tenant_id = keystone.current_tenant_id())$f$, t);
    EXECUTE format($f$CREATE POLICY tenant_insert ON keystone.%I
                      FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id())$f$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.%I TO app_rw', t);
  END LOOP;
END $$;

CREATE TRIGGER document_type_touch BEFORE UPDATE ON keystone.document_type
  FOR EACH ROW EXECUTE FUNCTION keystone.touch_updated_at();
