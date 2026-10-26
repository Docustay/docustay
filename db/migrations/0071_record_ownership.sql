-- 0071 — P1.4 · RECORD OWNERSHIP, AND THE ROW NOBODY OWNS.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ "OWNED ONLY" HAS BEEN A SCOPE WITH ALMOST NOTHING TO SCOPE BY. [MEASURED against the live
--     catalog, confirming RECON 2] exactly TWO ownership-shaped columns exist in this schema —
--       booking.host_id             NOT NULL
--       document_instance.assigned_to NOT NULL
--     — and **ZERO of the RLS policies read either of them**. `app_user` and `account` have no
--     owner column at all, so "a coach sees their own clients" was not a rule that was broken; it
--     was a rule that had nowhere to live.
--   ★ P1.2 could only prove the scope axis end-to-end against `booking.host_id` for exactly this
--     reason. This migration gives the other objects the column, so P1.7 can wire the predicate into
--     every read rather than the one table that happened to have somewhere to put it.
--
-- ★★★ AND THE HALF THAT IS EASY TO FORGET — **A LEAD NOBODY OWNS MUST NOT BECOME INVISIBLE.**
--     `keystone.scope_allows` (0066) already answers FALSE for a NULL owner at every scope except
--     `everything`, deliberately: an unowned row must not silently belong to whoever looks at it.
--     The consequence is that the moment ownership exists, **every unassigned lead disappears from
--     every coach's screen**, and the only person who can see it is an admin who thinks to look.
--     That is how a practice loses enquiries. `keystone.unassigned_count()` and the `owner_user_id
--     IS NULL` predicate exist so the gap is VISIBLE rather than silent, and P6 renders it.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- 1 · PERSON — the assigned coach.
-- ───────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE keystone.app_user ADD COLUMN owner_user_id uuid;

-- ★★ COMPOSITE, AND SELF-REFERENTIAL. `(tenant_id, id)` became a legal FK target at 0066; without
--    the tenant_id in the key a person in tenant A could be assigned to a coach in tenant B and both
--    rows would pass their own RLS policy, because the FK check runs as the table owner.
--  ★ ON DELETE SET NULL, not CASCADE or RESTRICT: when a coach leaves, their clients become
--    UNASSIGNED — which is a true statement about the practice and puts them on the unassigned list
--    where somebody will pick them up. CASCADE would delete the clients; RESTRICT would make
--    offboarding a coach impossible until every client was moved by hand, which is how people end
--    up disabling constraints.
ALTER TABLE keystone.app_user ADD CONSTRAINT app_user_owner_fkey
  FOREIGN KEY (tenant_id, owner_user_id) REFERENCES keystone.app_user (tenant_id, id) ON DELETE SET NULL;

CREATE INDEX app_user_owner_idx ON keystone.app_user (tenant_id, owner_user_id);
-- ★ The unassigned list is a hot, selective read once ownership is real. Partial index, because the
--   rows it serves are exactly the ones the predicate selects.
CREATE INDEX app_user_unassigned_idx ON keystone.app_user (tenant_id)
  WHERE owner_user_id IS NULL;

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- ★★★ 2 · STAFF OWN THEMSELVES, AND THIS IS NOT A CONVENIENCE — IT RESOLVES A REAL CONTRADICTION.
-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- `app_user` holds BOTH the practice's clients and its staff. For a client, "owner" means *the coach
-- assigned to them*. For a staff member, that reading is nonsense — and taking it literally produces
-- a concrete bug: a coach on `person: edit, owned` **could not edit their own profile**, because
-- their row's owner would be null and `scope_allows` correctly refuses a null owner.
--   ★★ The alternative fixes are worse. Special-casing `OR u.id = viewer` in every read puts one
--      object's exception into every query P1.7 writes, and forgetting it in one place is a silent
--      lockout. Setting the column here keeps `owner_user_id` the single answer to "who owns this
--      row", for every row, which is the property the whole scope axis depends on.
CREATE FUNCTION keystone.app_user_staff_owns_self()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  -- ★ Only when it is not already set: an explicit assignment always wins. This fills a gap, it
  --   does not overwrite a decision.
  IF NEW.role = 'staff' AND NEW.owner_user_id IS NULL THEN
    NEW.owner_user_id := NEW.id;
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER app_user_staff_owns_self_trg
  BEFORE INSERT OR UPDATE OF role, owner_user_id ON keystone.app_user
  FOR EACH ROW EXECUTE FUNCTION keystone.app_user_staff_owns_self();

-- ★ BACKFILL THE STAFF THAT ALREADY EXIST. [MEASURED] 14 staff rows. Clients are deliberately left
--   NULL — nobody has assigned them, and inventing an owner here would be fabricating a
--   relationship the practice never stated. They land on the unassigned list, which is correct and
--   is the point of §4 below.
UPDATE keystone.app_user SET owner_user_id = id WHERE role = 'staff' AND owner_user_id IS NULL;

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- 3 · ACCOUNT — the same shape.
-- ───────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE keystone.account ADD COLUMN owner_user_id uuid;
ALTER TABLE keystone.account ADD CONSTRAINT account_owner_fkey
  FOREIGN KEY (tenant_id, owner_user_id) REFERENCES keystone.app_user (tenant_id, id) ON DELETE SET NULL;
CREATE INDEX account_owner_idx ON keystone.account (tenant_id, owner_user_id);
CREATE INDEX account_unassigned_idx ON keystone.account (tenant_id) WHERE owner_user_id IS NULL;

-- ★★ `booking` AND `document_instance` GET NOTHING, DELIBERATELY. They already carry `host_id` and
--    `assigned_to`, both NOT NULL. Adding `owner_user_id` beside them would be a SECOND column
--    holding one fact — the `DUPLICATE-TRUTH` class this project has already paid for twice
--    (`package_credit` vs `entitlement_credit`, `price_minor` after 0015). The existing columns ARE
--    the owner; `src/permissions/ownership.mjs` is where that correspondence is written down once,
--    and a gate asserts every entry against this catalog.

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- ★★★ 4 · THE UNASSIGNED COUNT — SO THE GAP IS LOUD.
-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- ★★ THIS IS THE ITEM'S SECOND HALF AND IT IS NOT DECORATION. Ownership plus a scope predicate has
--    a failure mode that looks like nothing at all: an enquiry arrives, nobody is assigned, and it
--    is visible to exactly the people who already have a full caseload and no reason to look — i.e.
--    to nobody. **A practice does not notice the leads it never saw.**
--  ★ A COUNT, not a list, because the list is per-object and belongs to each screen. The count is
--    what a dashboard badge needs, and a number that is not zero is what makes somebody click.
CREATE FUNCTION keystone.unassigned_count(p_object text)
RETURNS integer
LANGUAGE plpgsql
STABLE
AS $fn$
DECLARE v_n integer;
BEGIN
  -- ★★ NO DYNAMIC SQL, AND NO DEFAULT BRANCH THAT RETURNS ZERO. An unknown object must RAISE:
  --    returning 0 for a typo would render a badge saying "nothing is unassigned", which is the
  --    exact false reassurance this function exists to prevent.
  CASE p_object
    WHEN 'person'  THEN SELECT count(*) INTO v_n FROM keystone.app_user
                         WHERE owner_user_id IS NULL AND role <> 'staff';
    WHEN 'account' THEN SELECT count(*) INTO v_n FROM keystone.account WHERE owner_user_id IS NULL;
    ELSE
      RAISE EXCEPTION
        'unassigned_count: "%" is not an ownable object — person and account are the two that can '
        'be unowned (booking.host_id and document_instance.assigned_to are NOT NULL, so they never '
        'can be)', p_object
        USING ERRCODE = 'invalid_parameter_value';
  END CASE;
  RETURN v_n;
END;
$fn$;

COMMENT ON FUNCTION keystone.unassigned_count(text) IS
  'P1.4 — how many rows nobody owns. ★★★ Exists because `scope_allows` correctly refuses a NULL '
  'owner at every scope below `everything`, which means the instant ownership became real every '
  'unassigned lead vanished from every coach''s screen. A practice does not notice the enquiries it '
  'never saw. ★ Raises on an unknown object rather than returning 0 — a badge reading "nothing is '
  'unassigned" is worse than an error.';

COMMENT ON COLUMN keystone.app_user.owner_user_id IS
  'P1.4 — the assigned coach. ★★ For a STAFF row this is the person themselves, set by '
  '`app_user_staff_owns_self_trg`: `app_user` holds clients and staff in one table, and without it a '
  'coach on "person: edit, owned" could not edit their own profile. ★ ON DELETE SET NULL so that '
  'offboarding a coach makes their clients UNASSIGNED — a true statement, and one that puts them '
  'somewhere visible — rather than deleting them or making the coach undeletable.';
