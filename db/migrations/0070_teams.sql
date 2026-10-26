-- 0070 — P1.3 · `team` · `team_member`, AND WHAT FINALLY MAKES "TEAM ONLY" MEAN SOMETHING.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE WORD IS ALREADY IN THE PRODUCT AND HAS NOTHING BEHIND IT. [EXECUTED, RECON 2]
--     `'/tasks/team' in LIST_VIEWS === false` — a nav row using the noun with no concept under it —
--     and the only list view that does use it, `/people/team`, filters `u.role = 'staff'`
--     (`src/records/lists.mjs:110-114`). **"Team" currently means `app_user.role = 'staff'` and
--     nothing else**, which is to say it means "not a client".
--
-- ★★★ AND WITHOUT THIS TABLE THE SCOPE AXIS HAS A HOLE IN THE MIDDLE. 0066 shipped four scopes and
--     `keystone.scope_allows()` resolved `'team'` **as `'owned'`**, deliberately and with a comment
--     saying so: narrower than its name, never wider, because a "Team only" role that silently meant
--     the whole tenant would be wrong in the dangerous direction and invisible. That was the right
--     placeholder and this is the migration that retires it.
--
-- ★★ THE HIERARCHY IS THE POINT, NOT DECORATION. A practice with two locations and a lead coach at
--    each needs "the lead sees their location; the owner sees both". Flat groups cannot say that —
--    they force either one big team (Everything by another name) or manual duplicate membership.
--   ★ DIRECTION, RULED HERE AND ASSERTED BY THE GATE: **a parent team's members see DOWN into child
--     teams. A child's members do NOT see UP, and siblings never see each other.** Visibility flows
--     from the root toward the leaves, the same direction authority does.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

CREATE TABLE keystone.team (
  id uuid PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,

  -- ★ Same identifier/label split as `role` (0066), for the same reason: code compares `key`, the
  --   practice renames `name`, and a configurable word must never stand in for an identifier.
  key text NOT NULL
    CONSTRAINT team_key_shape CHECK (key ~ '^[a-z][a-z0-9_]*$'),
  name text NOT NULL
    CONSTRAINT team_name_present CHECK (btrim(name) <> ''),

  parent_team_id uuid,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- ★★ A team cannot be its own parent. The cheap half of cycle prevention, done as a CHECK so it
  --    costs nothing; the expensive half — longer loops — is the trigger below.
  CONSTRAINT team_not_own_parent CHECK (parent_team_id IS DISTINCT FROM id)
);

CREATE UNIQUE INDEX team_tenant_key_key ON keystone.team (tenant_id, key);
CREATE UNIQUE INDEX team_tenant_id_key  ON keystone.team (tenant_id, id);
CREATE INDEX team_parent_idx ON keystone.team (tenant_id, parent_team_id);

-- ★★ COMPOSITE SELF-REFERENCE. Same argument as `role_permission_role_fkey` (0066): RLS does not
--    police foreign keys — the FK check runs as the table owner — so without `tenant_id` in the key
--    a team in tenant A could be parented to a team in tenant B and both rows would still pass
--    their own policy.
--  ★ ADDED AFTER THE INDEX, NOT INLINE IN THE CREATE TABLE, and the reason is mechanical rather
--    than stylistic: a composite FK needs a UNIQUE constraint on its target columns to already
--    exist, and a SELF-reference declared inline is checked before this file has created one.
--    [EXECUTED] the inline version failed with
--      "there is no unique constraint matching given keys for referenced table \"team\"".
ALTER TABLE keystone.team ADD CONSTRAINT team_parent_fkey
  FOREIGN KEY (tenant_id, parent_team_id) REFERENCES keystone.team (tenant_id, id) ON DELETE RESTRICT;

CREATE TRIGGER team_touch BEFORE UPDATE ON keystone.team
  FOR EACH ROW EXECUTE FUNCTION keystone.touch_updated_at();

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- ★★★ CYCLE PREVENTION. A LOOP HERE IS NOT A DATA-QUALITY PROBLEM, IT IS AN OUTAGE.
-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- Every visibility question walks this tree with a recursive CTE. `A → B → A` makes that walk
-- non-terminating, so the first coach to open a list after somebody re-parented a team would hang a
-- connection — and the next, and the next. ★ `UNION` (not `UNION ALL`) in the walk below dedupes and
-- would in fact terminate, but relying on that means the guarantee lives in the spelling of one
-- keyword in one query, and every future query has to remember it. **Refuse the cycle at the write.**
CREATE FUNCTION keystone.team_no_cycles()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_ancestor uuid := NEW.parent_team_id;
  v_hops     integer := 0;
BEGIN
  WHILE v_ancestor IS NOT NULL LOOP
    IF v_ancestor = NEW.id THEN
      RAISE EXCEPTION
        'team "%" cannot be parented to % — that closes a loop, and every visibility query walks '
        'this tree', NEW.key, NEW.parent_team_id
        USING ERRCODE = 'check_violation';
    END IF;
    v_hops := v_hops + 1;
    -- ★★ A BELT FOR THE CASE THE WALK ITSELF IS THE THING THAT IS BROKEN. If a cycle somehow already
    --    exists — restored from a dump, or written before this trigger — the loop above would spin
    --    forever inside the guard meant to prevent spinning forever. 64 is far beyond any real
    --    org chart and far below anything that hurts.
    IF v_hops > 64 THEN
      RAISE EXCEPTION
        'team parent chain exceeded 64 levels starting at "%" — this is a loop or a corrupt tree',
        NEW.key USING ERRCODE = 'check_violation';
    END IF;
    SELECT parent_team_id INTO v_ancestor FROM keystone.team WHERE id = v_ancestor;
  END LOOP;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER team_no_cycles_trg
  BEFORE INSERT OR UPDATE OF parent_team_id ON keystone.team
  FOR EACH ROW WHEN (NEW.parent_team_id IS NOT NULL)
  EXECUTE FUNCTION keystone.team_no_cycles();

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- TEAM MEMBERSHIP
-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- ★ Many-to-many on purpose: a person can sit in more than one team, and the visibility union below
--   handles it without anybody having to choose a "primary" team.
CREATE TABLE keystone.team_member (
  tenant_id uuid NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  team_id uuid NOT NULL,
  user_id uuid NOT NULL,
  added_by uuid REFERENCES keystone.app_user(id) ON DELETE SET NULL,
  added_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant_id, team_id, user_id),
  CONSTRAINT team_member_team_fkey
    FOREIGN KEY (tenant_id, team_id) REFERENCES keystone.team (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT team_member_user_fkey
    FOREIGN KEY (tenant_id, user_id) REFERENCES keystone.app_user (tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX team_member_user_idx ON keystone.team_member (tenant_id, user_id);

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- ★★★ THE TEAM PREDICATE — DOWNWARD ONLY, AND IT IS ONE FUNCTION SO EVERY READ ASKS IT THE SAME WAY
-- ───────────────────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION keystone.team_sees(p_owner_id uuid, p_viewer_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  WITH RECURSIVE subtree AS (
    -- ★ THE VIEWER'S OWN TEAMS ARE THE ROOTS. "Team only" includes the viewer's own team, not just
    --   the teams beneath it — otherwise a lead coach could see every report but their own.
    SELECT t.id
      FROM keystone.team t
      JOIN keystone.team_member m ON m.team_id = t.id
     WHERE m.user_id = p_viewer_id
    UNION
    -- ★★ DOWNWARD. `c.parent_team_id = s.id` walks from parent to child; reversing these two
    --    columns would walk UP and silently grant a junior coach sight of the whole practice —
    --    which is why the gate asserts the sibling case and the upward case SEPARATELY.
    SELECT c.id
      FROM keystone.team c
      JOIN subtree s ON c.parent_team_id = s.id
  )
  SELECT EXISTS (
    SELECT 1 FROM keystone.team_member m
     WHERE m.user_id = p_owner_id
       AND m.team_id IN (SELECT id FROM subtree));
$$;

COMMENT ON FUNCTION keystone.team_sees(uuid, uuid) IS
  'P1.3 — is the owner inside the subtree rooted at any team the viewer belongs to? ★★ DOWNWARD '
  'ONLY: a parent team''s members see into child teams; a child''s members do NOT see up, and '
  'siblings never see each other. Reversing the join in the recursive arm would walk UP and grant a '
  'junior coach sight of the whole practice — asserted separately by db/gates/p1_teams.mjs so the '
  'two directions cannot pass on one another''s evidence.';

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- ★★★ AND `scope_allows` STOPS PRETENDING. `'team'` NOW MEANS TEAM.
-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- ★★ THE VOLATILITY CHANGES, AND IT HAS TO. 0066 declared this IMMUTABLE, which was true then — it
--    was pure arithmetic on three arguments. It now READS TABLES, and an IMMUTABLE function that
--    reads tables is a live bug, not a style point: the planner is entitled to fold it to a constant,
--    cache it across rows, and evaluate it at plan time. **A stale `true` there is a permission leak
--    that no test would reproduce, because it depends on the plan.** STABLE is the correct marker.
CREATE OR REPLACE FUNCTION keystone.scope_allows(p_scope text, p_owner_id uuid, p_viewer_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT CASE p_scope
    WHEN 'everything' THEN true
    WHEN 'none'       THEN false
    -- ★ NULL viewer → false, never true. The webhook and worker paths pass no user (0001), and a
    --   predicate about a viewer must refuse rather than invent one.
    WHEN 'owned'      THEN p_owner_id IS NOT NULL AND p_viewer_id IS NOT NULL AND p_owner_id = p_viewer_id
    -- ★★ `team` INCLUDES `owned`. A person always sees their own rows; team membership only ever
    --    ADDS. Without the first disjunct, a coach in no team at all would lose sight of their own
    --    caseload the moment their role was moved from "Owned only" to "Team only" — a widening
    --    that narrows, which is the most confusing possible outcome for the person configuring it.
    WHEN 'team'       THEN p_owner_id IS NOT NULL AND p_viewer_id IS NOT NULL
                           AND (p_owner_id = p_viewer_id OR keystone.team_sees(p_owner_id, p_viewer_id))
    ELSE false
  END
$$;

COMMENT ON FUNCTION keystone.scope_allows(text, uuid, uuid) IS
  'P1.2/P1.3 — the scope axis as one expression. ★★ `team` resolved as `owned` from 0066 until 0070 '
  'gave the word a table to mean something against; it is now `owned` OR inside the viewer''s team '
  'subtree. ★★★ STABLE, not IMMUTABLE — it reads tables now, and an IMMUTABLE function that reads '
  'tables may be folded to a constant by the planner, which would be a permission leak that depends '
  'on the plan and so reproduces in no test.';

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- RLS — ENABLE **AND** FORCE, three policies each.
-- ───────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE keystone.team        ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.team        FORCE  ROW LEVEL SECURITY;
ALTER TABLE keystone.team_member ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.team_member FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON keystone.team
  USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert ON keystone.team
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update ON keystone.team
  FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
          WITH CHECK (tenant_id = keystone.require_tenant_id());

CREATE POLICY tenant_isolation ON keystone.team_member
  USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert ON keystone.team_member
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update ON keystone.team_member
  FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
          WITH CHECK (tenant_id = keystone.require_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.team        TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.team_member TO app_rw;

COMMENT ON TABLE keystone.team IS
  'P1.3 — parent/child groups, and what makes the `team` scope resolvable. ★★ Before 0070 the word '
  '"team" appeared in TWO places in the product with no concept behind it: the /tasks/team nav row '
  '(which has no list view at all) and /people/team (which filters app_user.role = ''staff'', i.e. '
  '"not a client"). ★ `team_no_cycles_trg` refuses a loop at the write because every visibility '
  'question walks this tree recursively, and a loop would hang a connection per reader.';
