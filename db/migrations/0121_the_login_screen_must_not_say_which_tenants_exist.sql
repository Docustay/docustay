-- 0121_the_login_screen_must_not_say_which_tenants_exist
-- MS-18.2 — RESOLVE A TENANT'S *BRANDING* FROM ITS SUBDOMAIN, BEFORE ANYONE HAS SIGNED IN.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THIS FUNCTION IS REACHED BY AN UNAUTHENTICATED REQUEST AND THAT IS NOT AN OVERSIGHT.
--     The login screen is drawn BEFORE a session exists — that is what a login screen is — so the
--     branding it draws has to be readable with no credential. The consequence is stated rather
--     than discovered: **this tells the internet which subdomains are live practices.** That was
--     ruled acceptable deliberately, and it is bounded by the return type below.
--
-- ★★★ THE RETURN TYPE IS THE SAFETY ARGUMENT — the same argument `account_seat_counts` (0007/0008)
--     and `tenant_timezones_for_health` (0017) make in their own comments. THREE PRESENTATION
--     STRINGS. No id, no slug, no counts, no people, no status, nothing about the practice's
--     business. A future body cannot leak a client list through a signature that cannot carry one.
--   ★ `slug` is deliberately NOT returned even though the caller passed it in. A function that
--     echoes its argument invites a caller to treat the echo as confirmation the tenant EXISTS,
--     which is precisely the fact this file works to withhold.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE ORACLE THIS FILE EXISTS TO CLOSE: "NO SUCH TENANT" AND "TENANT SUSPENDED" MUST BE THE
--     SAME ANSWER. A login screen that renders plain for an unknown name but says "suspended" —
--     or merely takes a different code path — for a real one hands an outsider a directory of
--     every practice on the platform AND their account standing. `unknown` is a fact about
--     nothing; `suspended` is a fact about a customer's billing.
--
-- ★★ SO THE STATUS FILTER IS *INSIDE THE SAME WHERE CLAUSE AS THE SLUG MATCH*, not a second
--    statement and not a check in JavaScript. One query, one code path, zero rows for BOTH cases.
--    Written as `SELECT … WHERE slug = $1` followed by `if (row.status !== 'active')` the two
--    cases differ in timing and in every log line they touch, and the oracle is back while the
--    code still "looks like" it refuses. This is the shape `resolve_tenant_by_slug` (0020:197)
--    already chose for the same reason, and it is copied on purpose.
--  ★ 'provisioning' and 'closed' collapse into the same silence, and they must: a half-built
--    tenant and a shut one are also facts about a customer.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ SECURITY DEFINER IS NOT A BYPASS — D-17.27, AND THIS IS THE FOURTH TIME. 0031 records the
--     measurement in full: two definers, same schema, same search_path, OPPOSITE results, because
--     `keystone.app_user` is FORCE RLS and **only a policy naming the definer's OWNER buys an
--     exemption**. `keystone.tenant_setting` is FORCE RLS too (0065), so this function needs:
--        · to be owned by `auth_owner` — the established owner of credential-path definers, and
--        · a policy on `tenant_setting` NAMING auth_owner, because it inherits none.
--     `keystone.tenant` already carries `tenant_health_read` (0017:56, SELECT TO auth_owner), which
--     is why the tenant half needs nothing new.
--   ★ Owned by auth_owner rather than app_owner for 0031's stated reason: two resolvers on ONE code
--     path owned by two roles with two policy sets is the asymmetry that produced that bug.

-- ── the branding read, and NOTHING wider ────────────────────────────────────────────────────────
-- ★★ NOT `USING (true)`. The credential path only ever asks for the three strings a login screen
--    paints, so the policy admits ONLY those three keys. `terminology.overrides`, the billing tier
--    and every other catalogued key in this store stay invisible to auth_owner entirely — a role
--    that cannot see a row cannot leak it, whatever a future body does. Same reasoning, and the
--    same shape, as `credential_uid_lookup` (0031:40).
-- ★ SELECT only. auth_owner gets no INSERT/UPDATE/DELETE here, so the login path can never write a
--   setting.
CREATE POLICY credential_branding_lookup ON keystone.tenant_setting
  FOR SELECT TO auth_owner
  USING (key IN ('practice.name', 'branding.logo_url', 'branding.primary_colour'));

COMMENT ON POLICY credential_branding_lookup ON keystone.tenant_setting IS
  'MS-18.2. Lets the auth_owner-owned branding resolver read the three presentation strings a login '
  'screen paints, and NOTHING else: SELECT only, and only those three keys, so terminology '
  'overrides and the billing tier are invisible to the credential path. Required because '
  'tenant_setting is FORCE RLS (0065) — SECURITY DEFINER alone grants no exemption, only a policy '
  'naming the owner does (D-17.27, measured in 0031).';

-- ★ Column-level privilege, not table-wide: the body reads exactly these three.
GRANT SELECT (tenant_id, key, value) ON keystone.tenant_setting TO auth_owner;

-- ── the resolver ────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION keystone.resolve_login_branding_by_slug(p_slug text)
RETURNS TABLE (display_name text, logo_url text, primary_colour text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT
    -- ★ The practice's own name when it has set one, the tenant row's name otherwise. KS-5.6
    --   (src/settings/keys.mjs:169) rules that a tenant with no logo falls back to their NAME in
    --   text and that Keystone's mark is NEVER substituted for a tenant's — so a name must always
    --   come back for an active tenant, even when both settings are unset.
    COALESCE(NULLIF(pn.value #>> '{}', ''), t.name) AS display_name,
    NULLIF(lo.value #>> '{}', '')                   AS logo_url,
    NULLIF(pc.value #>> '{}', '')                   AS primary_colour
  FROM keystone.tenant t
  LEFT JOIN keystone.tenant_setting pn
         ON pn.tenant_id = t.id AND pn.key = 'practice.name'
  LEFT JOIN keystone.tenant_setting lo
         ON lo.tenant_id = t.id AND lo.key = 'branding.logo_url'
  LEFT JOIN keystone.tenant_setting pc
         ON pc.tenant_id = t.id AND pc.key = 'branding.primary_colour'
  -- ★★★ THE TWO CONDITIONS ARE ONE WHERE CLAUSE. See the header. Do not split them.
  WHERE lower(t.slug) = lower(p_slug)
    AND t.status = 'active'
$$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE OWNER CHANGE MUST COME FIRST **AND** THE GRANTS MUST BE MADE BY THE NEW OWNER.
--     Two separate traps, both measured here on 2026-09-15, and getting either wrong fails QUIETLY.
--
--   ★★ TRAP 1 — `app_owner` IS **NOINHERIT** (`\du app_owner` → "No inheritance"). Migrations run
--      as app_owner (db/migrate.mjs:93). It is a MEMBER of auth_owner, which is why
--      `ALTER … OWNER TO auth_owner` is permitted at all — that check uses membership. But COMMENT,
--      REVOKE and GRANT require OWNERSHIP, and a NOINHERIT member does not wield the target role's
--      rights without an explicit `SET ROLE`. The instant ownership moves, app_owner is a stranger
--      to its own function: [EXECUTED] `must be owner of function` at the COMMENT, while the
--      REVOKE and GRANT before it degraded to mere WARNINGS (`no privileges could be revoked` /
--      `no privileges were granted`) that psql does NOT treat as errors. The function would have
--      been left PUBLIC-executable with a transcript reading `REVOKE` and `GRANT`.
--
--   ★★★ TRAP 2 — AND IT IS THE ONE THAT ALREADY BIT THIS SCHEMA: **`ALTER FUNCTION … OWNER TO`
--        REWRITES THE ACL, SILENTLY DROPPING THE OLD OWNER'S EXPLICIT GRANT.** [EXECUTED]
--             before:  app_owner=X/app_owner | app_rw=X/app_owner
--             after:   auth_owner=X/auth_owner | app_rw=X/auth_owner      ← app_owner is GONE
--        Postgres moves the owner's own ACL entry to the new owner instead of preserving the old
--        owner as a third-party grantee. A third party (`app_rw`) survives; the outgoing owner
--        does not. So "grant before the owner change" does NOT work either.
--      ★ THE PROOF THAT THIS IS NOT THEORETICAL: `resolve_tenants_by_firebase_uid` — created by
--        0030 and re-owned by 0031 — carries `auth_owner=X | app_rw=X` and **NO app_owner entry**,
--        while its siblings created directly as auth_owner (`resolve_tenant_by_slug`,
--        `tenant_timezones_for_health`) all carry `app_owner=X/auth_owner`. 0031 erased a grant it
--        appeared to make, and nothing noticed because the production path uses app_rw.
--
--   ★ SO: change the owner FIRST, then `SET LOCAL ROLE auth_owner` and issue the REVOKE/GRANT/
--     COMMENT *as the new owner*. That reaches byte-for-byte the ACL the established resolvers
--     have (`app_owner=X/auth_owner` — grantor auth_owner), and it needs only MEMBERSHIP, never
--     `CREATE` on the schema, so it does not depend on a bootstrap grant that may differ between
--     this machine and the deployed database.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
ALTER FUNCTION keystone.resolve_login_branding_by_slug(text) OWNER TO auth_owner;

SET LOCAL ROLE auth_owner;

REVOKE ALL ON FUNCTION keystone.resolve_login_branding_by_slug(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.resolve_login_branding_by_slug(text) TO app_rw, app_owner;

COMMENT ON FUNCTION keystone.resolve_login_branding_by_slug(text) IS
  'MS-18.2 — subdomain to the three strings a branded login screen paints, for the one moment '
  'before any session exists. RETURNS display_name, logo_url and primary_colour and NOTHING else: '
  'the return type IS the safety argument. ★ Returns ZERO ROWS for an unknown slug AND for a '
  'suspended, provisioning or closed one, from a single WHERE clause, because distinguishing them '
  'to an unauthenticated caller is a directory of every practice on the platform and its account '
  'standing. Owned by auth_owner so tenant_health_read (0017) and credential_branding_lookup apply '
  'instead of the forced tenant_isolation policy — SECURITY DEFINER alone buys nothing (D-17.27).';

-- ★ Back to the role the runner established, explicitly. `RESET ROLE` would land on the SESSION
--   user (keystone_admin), not app_owner, and every later statement in this file would then create
--   objects under the wrong owner.
SET LOCAL ROLE app_owner;

-- ★★ ASSERT THE ACL SURVIVED — this is TRAP 2's guard, and it is the whole reason the grant is
--    issued after the owner change rather than before. Without this the migration would apply
--    cleanly with a function app_owner cannot call, exactly as 0031 did.
DO $$
BEGIN
  IF NOT has_function_privilege('app_rw', 'keystone.resolve_login_branding_by_slug(text)', 'EXECUTE') THEN
    RAISE EXCEPTION
      'app_rw cannot EXECUTE the branding resolver — withCredentialLookup runs as app_rw, so every '
      'login screen would fail to resolve its tenant';
  END IF;
  IF NOT has_function_privilege('app_owner', 'keystone.resolve_login_branding_by_slug(text)', 'EXECUTE') THEN
    RAISE EXCEPTION
      'app_owner lost EXECUTE — the ALTER … OWNER ACL rewrite (TRAP 2) erased the grant again';
  END IF;
  IF has_function_privilege('public', 'keystone.resolve_login_branding_by_slug(text)', 'EXECUTE') THEN
    RAISE EXCEPTION
      'PUBLIC can EXECUTE the branding resolver — the REVOKE degraded to a warning (TRAP 1)';
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE MIGRATION PROVES ITS OWN CLAIM BEFORE IT COMMITS.
--     0020:283-305 sets the precedent: a resolver whose absence breaks every login is asserted
--     here, in the transaction that creates it, rather than trusted. The property asserted is the
--     one the header is about — ACTIVE resolves, and SUSPENDED is indistinguishable from ABSENT.
--   ★ And the POSITIVE CONTROL runs first. A test that only proves "suspended returns nothing"
--     passes just as well when the function returns nothing for EVERYTHING, which would be a
--     broken login screen rather than a working guard.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★ THE 0019/0010 RITUAL. `tenant` and `tenant_setting` are FORCE RLS and a migration sets no
--    tenant GUC, so even the owner cannot seed a fixture through the policies. FORCE comes off for
--    the fixture and goes back on immediately after, and that it came back is ASSERTED below —
--    leaving it off would disable tenant isolation on the root of the hierarchy while every later
--    migration and gate still passed.
ALTER TABLE keystone.tenant         NO FORCE ROW LEVEL SECURITY;
ALTER TABLE keystone.tenant_setting NO FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  t_live          uuid;
  t_susp          uuid;
  v_active_rows   int;
  v_name          text;
  v_logo          text;
  v_suspended     int;
  v_absent        int;
BEGIN
  INSERT INTO keystone.tenant (slug, name, timezone, status)
  VALUES ('m0121-live', 'Willowbank Therapy LLC', 'UTC', 'active'),
         ('m0121-susp', 'Harrowgate Counselling',  'UTC', 'suspended');
  SELECT id INTO t_live FROM keystone.tenant WHERE slug = 'm0121-live';
  SELECT id INTO t_susp FROM keystone.tenant WHERE slug = 'm0121-susp';

  -- ★ The settings the join is supposed to pick up. Without these the positive control would only
  --   ever exercise the `tenant.name` fallback, and a broken LEFT JOIN would still look correct.
  INSERT INTO keystone.tenant_setting (tenant_id, key, value) VALUES
    (t_live, 'practice.name',     '"Willowbank Therapy"'::jsonb),
    (t_live, 'branding.logo_url', '"https://cdn.example.invalid/willowbank.svg"'::jsonb);
  -- ★ The suspended tenant gets branding too, so the negative below is refused by STATUS and not
  --   merely by having nothing to return.
  INSERT INTO keystone.tenant_setting (tenant_id, key, value) VALUES
    (t_susp, 'practice.name', '"Harrowgate"'::jsonb);

  -- ── POSITIVE CONTROL FIRST. ──
  SELECT count(*), max(display_name), max(logo_url)
    INTO v_active_rows, v_name, v_logo
    FROM keystone.resolve_login_branding_by_slug('m0121-live');

  IF v_active_rows <> 1 THEN
    RAISE EXCEPTION
      'POSITIVE CONTROL FAILED: an ACTIVE tenant resolved % rows, expected 1 — the login screen '
      'would render unbranded for every practice, and the negative assertions below would pass '
      'vacuously', v_active_rows;
  END IF;

  -- ★ `practice.name` must WIN over `tenant.name`. If the COALESCE were backwards this returns
  --   'Willowbank Therapy LLC' — the legal entity — on a customer-facing sign-in screen.
  IF v_name IS DISTINCT FROM 'Willowbank Therapy' THEN
    RAISE EXCEPTION
      'POSITIVE CONTROL FAILED: display_name was % — expected the practice.name setting to win '
      'over the tenant row''s legal name', COALESCE(v_name, '<null>');
  END IF;

  IF v_logo IS DISTINCT FROM 'https://cdn.example.invalid/willowbank.svg' THEN
    RAISE EXCEPTION
      'POSITIVE CONTROL FAILED: logo_url was % — the branding.logo_url join returned nothing, so a '
      'tenant that HAS uploaded a mark would be drawn without it', COALESCE(v_logo, '<null>');
  END IF;

  -- ── THE ORACLE: suspended and absent must be THE SAME ANSWER. ──
  SELECT count(*) INTO v_suspended
    FROM keystone.resolve_login_branding_by_slug('m0121-susp');
  SELECT count(*) INTO v_absent
    FROM keystone.resolve_login_branding_by_slug('m0121-no-such-tenant-anywhere');

  IF v_suspended <> 0 THEN
    RAISE EXCEPTION
      'ORACLE: a SUSPENDED tenant resolved % rows. An unauthenticated caller can now tell a real '
      'practice from an unknown name, and read its account standing', v_suspended;
  END IF;

  IF v_absent <> 0 THEN
    RAISE EXCEPTION 'an ABSENT slug resolved % rows', v_absent;
  END IF;

  IF v_suspended <> v_absent THEN
    RAISE EXCEPTION
      'ORACLE: suspended returned % rows and absent returned % — they must be indistinguishable',
      v_suspended, v_absent;
  END IF;

  DELETE FROM keystone.tenant_setting WHERE tenant_id IN (t_live, t_susp);
  DELETE FROM keystone.tenant         WHERE id        IN (t_live, t_susp);
END $$;

ALTER TABLE keystone.tenant         FORCE ROW LEVEL SECURITY;
ALTER TABLE keystone.tenant_setting FORCE ROW LEVEL SECURITY;

-- ★★ PROVE FORCE CAME BACK. 0010 established this ritual and 0019:113-123 repeats it; the reason
--    is that nothing else in the suite would notice if it had not.
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO bad
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'keystone'
     AND c.relname IN ('tenant', 'tenant_setting')
     AND NOT c.relforcerowsecurity;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'FORCE ROW LEVEL SECURITY was not restored on: %', bad;
  END IF;
END $$;
