-- 0066 — P1.2 · ROLES, OBJECT ACCESS AND **SCOPE**.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ WHAT THIS REPLACES, AND WHY A COLUMN WAS NOT ENOUGH. [EXECUTED against the deployed catalog,
--     RECON 2] there is no `role`, `role_permission`, `user_role`, `team` or `team_member` table in
--     this project. The whole of authorisation is `app_user.staff_role` — a hardcoded four-value
--     CHECK (`super_admin_1 · super_admin · admin · coach`) that gates **WHICH NAV SECTIONS OPEN**
--     and never **WHICH ROWS COME BACK**.
--   ★★ So the measured state is the documented HubSpot failure verbatim: *"granting tool access and
--      forgetting object visibility, so every user sees every record."* A coach today opens fewer
--      sections than an admin and, inside any section they can open, **sees the entire tenant**.
--
-- ★★★ THE MODEL IS HUBSPOT'S, AND THE POINT OF IT IS THAT SCOPE IS A **SEPARATE AXIS**:
--       ROLES (reusable named bundles) × OBJECT (view/edit/delete) × SCOPE (Everything / Team only /
--       Owned only / None).
--     A verb answers *what may they do*. A scope answers *to whose rows*. Collapsing them into one
--     ladder — the "admin > coach" shape this system has today — cannot express "a coach may edit,
--     but only their own caseload", which is the single most common rule in an appointment business.
--
-- ★★★ `scope` IS **NOT NULL**, AND THAT IS THE WHOLE POINT OF THE TABLE. A nullable scope means a
--     permission row can be written that grants a verb and says nothing about reach — and the thing
--     that happens next is that the reader defaults it, invisibly, to everything. NOT NULL forces the
--     question to be answered at the moment the grant is made, by the person making it.
--
-- ★★ WHAT THIS MIGRATION DOES **NOT** DO: it does not change a single existing read. Wiring the
--    predicate into every list query is P1.7, and the owner columns most objects still lack are P1.4.
--    ★ This migration ships `keystone.scope_allows()` and proves it end-to-end on `booking.host_id`,
--      which is an owner column that ALREADY EXISTS — so the predicate is proven against a real
--      table today rather than asserted as a pure function and wired up later on trust.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- 1 · ROLE — a reusable named bundle.
-- ───────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE keystone.role (
  id uuid PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,

  -- ★★★ TWO NAMES, DELIBERATELY, AND THE SPLIT IS THE TERMINOLOGY RULE IN A TABLE:
  --     *"labels configurable · role literals a migration · IDENTIFIERS NEVER."*
  --   · `key`   is the identifier. Code compares against it. It is never renamed, never shown.
  --   · `label` is what the practice calls it, and P1.5/P6.62 let them change it freely.
  --   ★★ Without the split, renaming "Coach" to "Practitioner" in a settings screen would silently
  --      rewrite what every permission lookup in the system matches on. That is the exact class of
  --      defect that got the legacy terminology layer deleted next door: a configurable word
  --      standing in for an identifier.
  key text NOT NULL
    CONSTRAINT role_key_shape CHECK (key ~ '^[a-z][a-z0-9_]*$'),
  label text NOT NULL
    CONSTRAINT role_label_present CHECK (btrim(label) <> ''),
  description text,

  -- ★★ "SHIPPED", NOT "FIXED" (KS-11). The four defaults are a STARTING POINT: every one of them is
  --    editable and deletable by the tenant. This flag exists only so a settings screen can say
  --    "this one came with Keystone" and so re-seeding is idempotent — never to refuse an edit.
  is_builtin boolean NOT NULL DEFAULT false,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ★ Leads with tenant_id because uniqueness checks BYPASS RLS (0001:135-139).
CREATE UNIQUE INDEX role_tenant_key_key ON keystone.role (tenant_id, key);

-- ★★ THE COMPOSITE TARGET THAT MAKES A CROSS-TENANT FOREIGN KEY IMPOSSIBLE. Without it, a
--    `role_permission` row in tenant A could reference a `role` in tenant B: both rows pass their own
--    RLS policy, the FK is satisfied, and the grant is invisible from either side. ★ RLS does not
--    police foreign keys — the FK check runs as the table owner. The shape has to do it.
CREATE UNIQUE INDEX role_tenant_id_key ON keystone.role (tenant_id, id);

CREATE TRIGGER role_touch BEFORE UPDATE ON keystone.role
  FOR EACH ROW EXECUTE FUNCTION keystone.touch_updated_at();

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- 2 · ROLE_PERMISSION — one row per (role, object). The verb and the scope.
-- ───────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE keystone.role_permission (
  id uuid PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  role_id uuid NOT NULL,

  -- ★★★ THE OBJECT SET IS ENUMERATED HERE, NOT SHAPE-CHECKED, AND THAT IS ON PURPOSE. It is the
  --     TOPIC pattern, not the SETTING pattern: adding an object is a contract change that every
  --     read query and every role must answer for, so it is a MIGRATION. Adding a setting is a code
  --     edit because nothing else in the system has to react.
  --   ★★ `note` IS ITS OWN OBJECT [TY, RULED — Q7]. Session notes are the thing a practice most
  --      often wants scoped differently from the client record itself — "every coach sees every
  --      client, only the coach who ran the session sees the note" is a real configuration, and it
  --      is unsayable if a note inherits the person's permission.
  --   ★ `platform` IS DELIBERATELY ABSENT. Platform is its own namespace, checked server-side against
  --      the tenant's own `is_platform` flag — never a permission a tenant could grant itself.
  object text NOT NULL
    CONSTRAINT role_permission_object_check CHECK (object IN (
      'person', 'account', 'network_party', 'engagement', 'item',
      'document', 'invoice', 'task', 'note', 'report', 'setting')),

  -- The verb ladder. `none` is a real value, not an absence — see the coherence CHECK below.
  verb text NOT NULL
    CONSTRAINT role_permission_verb_check CHECK (verb IN ('none', 'view', 'edit', 'delete')),

  -- ★★★ NOT NULL. See the header. This column is the reason the table exists.
  scope text NOT NULL
    CONSTRAINT role_permission_scope_check CHECK (scope IN ('none', 'owned', 'team', 'everything')),

  -- ★★ THE TWO AXES MUST AGREE ABOUT NOTHING. `verb='view', scope='none'` grants a verb that can
  --    never return a row — a menu item that opens an empty screen forever, which is the "dead
  --    control" defect wearing a permission's clothes. `verb='none', scope='everything'` is its
  --    mirror and says nothing at all. Either is a mistake at the moment it is typed, so it is
  --    refused at the moment it is typed.
  CONSTRAINT role_permission_coherent CHECK ((verb = 'none') = (scope = 'none')),

  -- ★ A SETTING HAS NO OWNER. Tenant configuration is not a record with a coach attached, so
  --   "practice settings, owned only" resolves to nothing and would read as a lockout with no
  --   explanation. Constrained narrowly to `setting` ALONE — `report`, `item` and the rest are
  --   legitimately scopable ("a coach's report covers a coach's caseload").
  CONSTRAINT role_permission_setting_scope
    CHECK (object <> 'setting' OR scope IN ('none', 'everything')),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT role_permission_role_fkey
    FOREIGN KEY (tenant_id, role_id) REFERENCES keystone.role (tenant_id, id) ON DELETE CASCADE
);

-- ★★ ONE ROW PER OBJECT PER ROLE. Without this, "the" permission for a role on an object is
--    whichever row the query returned first — and two rows disagreeing is indistinguishable from a
--    deliberate grant. Same argument as 0065's one-row-per-key.
CREATE UNIQUE INDEX role_permission_role_object_key
  ON keystone.role_permission (tenant_id, role_id, object);

CREATE TRIGGER role_permission_touch BEFORE UPDATE ON keystone.role_permission
  FOR EACH ROW EXECUTE FUNCTION keystone.touch_updated_at();

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- 3 · USER_ROLE — who holds which role. Many-to-many on purpose.
-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- ★★ `app_user` HAS ONLY A SINGLE-COLUMN PRIMARY KEY, so a composite FK into it has nothing to
--    reference. This index is what makes `(tenant_id, user_id)` a legal target — and it is worth
--    having on its own account: it is the covering index for every "this tenant's people" read.
--  ★ It cannot change the meaning of `app_user`: `id` is already unique, so adding `tenant_id`
--    in front of it constrains nothing new. It only gives the FK a key to point at.
CREATE UNIQUE INDEX app_user_tenant_id_id_key ON keystone.app_user (tenant_id, id);

-- ★ A person can hold more than one role (the front-desk manager who also coaches). The resolver
--   takes the strongest verb and the widest scope across every role held — see
--   src/permissions/resolve.mjs, which states that rule and its reason in one place.
CREATE TABLE keystone.user_role (
  tenant_id uuid NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL,
  role_id uuid NOT NULL,
  granted_by uuid REFERENCES keystone.app_user(id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant_id, user_id, role_id),

  -- Both FKs composite, for the reason given on `role_tenant_id_key`.
  CONSTRAINT user_role_user_fkey
    FOREIGN KEY (tenant_id, user_id) REFERENCES keystone.app_user (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT user_role_role_fkey
    FOREIGN KEY (tenant_id, role_id) REFERENCES keystone.role (tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX user_role_role_idx ON keystone.user_role (tenant_id, role_id);

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- 4 · ★★★ THE SCOPE PREDICATE. One function, in the database, so a route cannot forget it.
-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- ★★★ WHY IN SQL AND NOT IN JS. A scope enforced in a route is enforced in the routes somebody
--     remembered. [MEASURED, RECON 2] this system has 49 write routes and 29 list views; a rule
--     that has to be repeated 78 times is a rule with 78 chances to be omitted, and the omission
--     looks exactly like working software. In SQL it is one expression, callable from a policy.
--
-- ★★ `ownerId` IS NULLABLE AND AN UNOWNED ROW IS **VISIBLE ONLY AT `everything`**. A lead nobody
--    owns must not silently belong to whoever looks at it — but it must also not become invisible
--    to the whole practice, which is why P1.4 owes an explicit "unassigned" view.
--
-- ★ `team` RESOLVES TO `owned` UNTIL P1.3 EXISTS, and it says so rather than quietly widening.
--   Returning `true` for team today would mean a role configured "Team only" saw the WHOLE TENANT
--   until teams shipped — a permission that is wrong in the dangerous direction, invisibly.
CREATE FUNCTION keystone.scope_allows(p_scope text, p_owner_id uuid, p_viewer_id uuid)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_scope
    WHEN 'everything' THEN true
    WHEN 'none'       THEN false
    -- ★ NULL viewer → false, never true. The webhook and worker paths pass no user (0001), and a
    --   predicate about a viewer must refuse rather than invent one.
    WHEN 'owned'      THEN p_owner_id IS NOT NULL AND p_viewer_id IS NOT NULL AND p_owner_id = p_viewer_id
    WHEN 'team'       THEN p_owner_id IS NOT NULL AND p_viewer_id IS NOT NULL AND p_owner_id = p_viewer_id
    ELSE false
  END
$$;

COMMENT ON FUNCTION keystone.scope_allows(text, uuid, uuid) IS
  'P1.2 — the scope axis as one expression. ★★ ''team'' DELIBERATELY BEHAVES AS ''owned'' until '
  'P1.3 ships team/team_member. Widening it to true would make every "Team only" role see the whole '
  'tenant — wrong in the dangerous direction, and silent. When P1.3 lands, this function is the ONE '
  'place that changes and db/gates/p1_scope_axis.mjs is the test that proves it changed.';

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- 5 · RLS — ENABLE **AND** FORCE on all three, same three policies as every tenant-scoped table.
-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- ★★ A permissions table that leaked across tenants would let one practice read — or worse, write —
--    another's access rules. FORCE is what stops the table owner path from doing it by accident.
ALTER TABLE keystone.role            ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.role            FORCE  ROW LEVEL SECURITY;
ALTER TABLE keystone.role_permission ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.role_permission FORCE  ROW LEVEL SECURITY;
ALTER TABLE keystone.user_role       ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.user_role       FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON keystone.role
  USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert ON keystone.role
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update ON keystone.role
  FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
          WITH CHECK (tenant_id = keystone.require_tenant_id());

CREATE POLICY tenant_isolation ON keystone.role_permission
  USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert ON keystone.role_permission
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update ON keystone.role_permission
  FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
          WITH CHECK (tenant_id = keystone.require_tenant_id());

CREATE POLICY tenant_isolation ON keystone.user_role
  USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert ON keystone.user_role
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update ON keystone.user_role
  FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
          WITH CHECK (tenant_id = keystone.require_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.role            TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.role_permission TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.user_role       TO app_rw;

COMMENT ON TABLE keystone.role IS
  'P1.2 — HubSpot''s reusable named bundle. ★ `key` is the identifier and never changes; `label` is '
  'the word the practice uses and is freely renameable. ★★ `is_builtin` marks the four shipped '
  'defaults (KS-11: a STARTING POINT, not a fixed set) — it exists for the settings screen and for '
  'idempotent seeding, and it NEVER refuses an edit.';

COMMENT ON COLUMN keystone.role_permission.scope IS
  'NOT NULL, and that is the reason this table exists. ★★★ The documented HubSpot failure is '
  '"granting tool access and forgetting object visibility, so every user sees every record" — which '
  'is the MEASURED state of this system before 0066: staff_role gates which nav sections open and '
  'never which rows come back. A nullable scope would be defaulted by the reader, invisibly, to '
  'everything. NOT NULL forces the question to be answered by the person making the grant.';
