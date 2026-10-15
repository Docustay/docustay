-- 0001_platform_skeleton
-- P1.5 tenant table + UUIDv7 · P1.6 withTenant() GUC contract · P1.7 RLS ENABLE *and* FORCE
--
-- ★★★ THE ISOLATION BOUNDARY IS THIS FILE. §P1: "The isolation boundary is the database, and
-- that is the entire content of the recommendation." §K3: one bundle serves staff and clients,
-- so CLIENT-SIDE ROLE GATING IS NOT A SECURITY BOUNDARY — the server decides, every request,
-- and this is where the server decides.

-- ─────────────────────────────────────────────────────────────────────────────
-- UUIDv7
-- ─────────────────────────────────────────────────────────────────────────────
-- ★ v7, not v4: the first 48 bits are a millisecond timestamp, so keys are time-ordered and
-- B-tree inserts land at the right-hand edge instead of scattering across the index. v4 primary
-- keys on a busy table cause write amplification that only shows up once the table is large.
-- Postgres 16 has no built-in uuidv7() (that arrives in 18), so it is implemented here.
--
-- ★★ `volatile`, NOT immutable or stable — it must return a different value on every call.
-- Mislabelling THIS one lets the planner compute it once and reuse the same key for every row
-- in a multi-row INSERT. (The tenant-context helpers below are the opposite case and are STABLE.)
CREATE OR REPLACE FUNCTION keystone.uuid_generate_v7()
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  unix_ms bigint;
  uuid_bytes bytea;
BEGIN
  unix_ms := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  -- 48-bit big-endian timestamp, then 10 random bytes.
  uuid_bytes := set_byte(set_byte(set_byte(set_byte(set_byte(set_byte(
      gen_random_bytes(16),
      0, ((unix_ms >> 40) & 255)::int),
      1, ((unix_ms >> 32) & 255)::int),
      2, ((unix_ms >> 24) & 255)::int),
      3, ((unix_ms >> 16) & 255)::int),
      4, ((unix_ms >>  8) & 255)::int),
      5, ( unix_ms        & 255)::int);
  -- version 7 in the high nibble of byte 6
  uuid_bytes := set_byte(uuid_bytes, 6, ((get_byte(uuid_bytes, 6) & 15) | 112));
  -- RFC 4122 variant (10xx) in the high bits of byte 8
  uuid_bytes := set_byte(uuid_bytes, 8, ((get_byte(uuid_bytes, 8) & 63) | 128));
  RETURN encode(uuid_bytes, 'hex')::uuid;
END $$;

COMMENT ON FUNCTION keystone.uuid_generate_v7() IS
  'UUIDv7. VOLATILE on purpose — a STABLE/IMMUTABLE mislabel would reuse one key for every row of a multi-row INSERT.';

-- ─────────────────────────────────────────────────────────────────────────────
-- P1.6 — THE TENANT CONTEXT GUC. This is withTenant()'s half of the contract.
-- ─────────────────────────────────────────────────────────────────────────────
-- The application sets `keystone.tenant_id` with SET LOCAL inside a transaction. SET LOCAL ties
-- the value's lifetime to the transaction, which is exactly the interval the pooled connection
-- is leased for — so by construction there is no window in which a connection carries one
-- tenant's context into another tenant's request. A plain SET would leak across the pool.
--
-- ★★★ `STABLE`, NEVER `IMMUTABLE`. §P1 names this specifically: an IMMUTABLE mislabel lets the
-- planner fold the tenant id into a CACHED PLAN and serve it to another tenant. One word, no
-- error, no log line, cross-tenant data disclosure. STABLE means "constant within a single
-- statement", which is true and is all the planner may assume.
CREATE OR REPLACE FUNCTION keystone.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(current_setting('keystone.tenant_id', true), '')::uuid
$$;

COMMENT ON FUNCTION keystone.current_tenant_id() IS
  'Tenant from the transaction-local GUC. STABLE, never IMMUTABLE — IMMUTABLE would let the planner cache one tenant''s id into a plan reused for another tenant.';

-- ★ `true` as the second argument to current_setting means "return NULL if unset" rather than
-- raising. That is deliberate and it is the SAFE direction: unset → NULL → the policies below
-- match ZERO rows. If it raised instead, an unset context would surface as a 500 rather than as
-- an empty result, and the Y1 gates are written to assert ZERO ROWS.

CREATE OR REPLACE FUNCTION keystone.require_tenant_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
AS $$
DECLARE t uuid;
BEGIN
  t := keystone.current_tenant_id();
  IF t IS NULL THEN
    RAISE EXCEPTION 'no tenant context: keystone.tenant_id is not set'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN t;
END $$;

COMMENT ON FUNCTION keystone.require_tenant_id() IS
  'For writes: raises when there is no tenant context. Reads rely on the RLS predicate returning zero rows instead.';

-- ─────────────────────────────────────────────────────────────────────────────
-- P1.5 — the tenant table
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE keystone.tenant (
  id           uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  slug         text        NOT NULL,
  name         text        NOT NULL,
  status       text        NOT NULL DEFAULT 'provisioning'
                 CHECK (status IN ('provisioning','active','suspended','closed')),
  -- ★ Not nullable and no default. P1.17 asserts at startup that every tenant has a real
  -- timezone: a booking system with an unset timezone silently books the wrong hour, and a
  -- default of 'UTC' would be indistinguishable from a genuine choice of UTC.
  timezone     text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- ★ The tenant table is the ROOT of the hierarchy: its own key IS the tenant id, so its natural
-- key is globally unique rather than (tenant_id, …). Every OTHER table follows the
-- UNIQUE (tenant_id, …) rule below.
CREATE UNIQUE INDEX tenant_slug_key ON keystone.tenant (lower(slug));

COMMENT ON TABLE keystone.tenant IS 'Root of the tenancy hierarchy. Its id is the tenant id every other table references.';

-- ─────────────────────────────────────────────────────────────────────────────
-- A first tenant-scoped table, so the Y1 gates have something real to run against.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE keystone.app_user (
  id           uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id    uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  email        text        NOT NULL,
  display_name text        NOT NULL,
  -- §K2: four portals, one app. The portal a person sees is derived from this, but the ROLE is
  -- never the security boundary on its own — RLS below is. §K3.
  role         text        NOT NULL
                 CHECK (role IN ('staff','adult_client','adolescent_client','parent')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- ★★★ EVERY NATURAL KEY IS UNIQUE (tenant_id, …). §P1 states why and it is not obvious:
-- REFERENTIAL-INTEGRITY AND UNIQUENESS CHECKS BYPASS RLS. A bare `UNIQUE (email)` would let
-- tenant A discover that tenant B has a given user, because inserting that email returns a
-- uniqueness violation naming the constraint. The tenant-scoped index leaks nothing and is
-- also the correct semantics: two different practices may both have a client with one address.
CREATE UNIQUE INDEX app_user_tenant_email_key ON keystone.app_user (tenant_id, lower(email));
CREATE INDEX app_user_tenant_idx ON keystone.app_user (tenant_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- P1.7 — RLS: ENABLE *and* FORCE, on every tenant table
-- ─────────────────────────────────────────────────────────────────────────────
-- ★ ENABLE alone does NOT apply to the table's OWNER. app_owner owns these tables, so without
-- FORCE any migration or maintenance connection would silently see every tenant's rows. FORCE
-- closes that. P1.8's catalog query asserts BOTH flags on every table, forever.
ALTER TABLE keystone.tenant   ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.tenant   FORCE  ROW LEVEL SECURITY;
ALTER TABLE keystone.app_user ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.app_user FORCE  ROW LEVEL SECURITY;

-- The predicate. `current_tenant_id()` returns NULL when the GUC is unset, and `id = NULL` is
-- NULL, which is not TRUE — so NO ROWS MATCH. That is the Y1 gate's whole mechanism: absence of
-- context produces an empty result set, never a full one.
CREATE POLICY tenant_isolation ON keystone.tenant
  USING (id = keystone.current_tenant_id());

CREATE POLICY tenant_isolation ON keystone.app_user
  USING (tenant_id = keystone.current_tenant_id());

-- ★ Separate WITH CHECK policies for writes. USING governs what you can SEE; WITH CHECK governs
-- what you may WRITE. A policy with only USING lets a caller INSERT a row belonging to another
-- tenant — it simply cannot read it back afterwards. Silent cross-tenant writes are worse than
-- cross-tenant reads.
CREATE POLICY tenant_insert ON keystone.app_user
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());

CREATE POLICY tenant_update ON keystone.app_user
  FOR UPDATE USING  (tenant_id = keystone.current_tenant_id())
             WITH CHECK (tenant_id = keystone.require_tenant_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- updated_at maintenance
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION keystone.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

CREATE TRIGGER tenant_touch   BEFORE UPDATE ON keystone.tenant
  FOR EACH ROW EXECUTE FUNCTION keystone.touch_updated_at();
CREATE TRIGGER app_user_touch BEFORE UPDATE ON keystone.app_user
  FOR EACH ROW EXECUTE FUNCTION keystone.touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- Grants. app_rw gets DML only. DDL stays with app_owner — see P1.3.
-- ─────────────────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.tenant   TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.app_user TO app_rw;
GRANT EXECUTE ON FUNCTION keystone.uuid_generate_v7()   TO app_rw;
GRANT EXECUTE ON FUNCTION keystone.current_tenant_id()  TO app_rw;
GRANT EXECUTE ON FUNCTION keystone.require_tenant_id()  TO app_rw;
