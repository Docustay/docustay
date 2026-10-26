-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0125 — S8. ★★★ `branding.primary_colour` COMES OUT OF THE DATABASE TOO. [TY, RULED]
--
-- ★★★ THE SOURCE CHANGES DO NOT REACH A ROW THAT ALREADY EXISTS. Removing the key from
--     `src/settings/keys.mjs` stops the next WRITE. It does nothing about a value stored last
--     month, which `resolve_login_branding_by_slug` would go on returning to an unauthenticated
--     caller forever. That gap is SUPERSEDED-STILL-READ, and it is the single most common class in
--     this project's findings register. This migration is the contract half of the expand/contract.
--
-- ★★★ WHY DROP AND NOT `CREATE OR REPLACE`: **REPLACE CANNOT CHANGE A RETURN TYPE.** Postgres
--     refuses with "cannot change return type of existing function", so a migration written the
--     obvious way fails loudly — which is the good case. The bad case is the one where somebody
--     "fixes" that error by leaving the third column in place and returning NULL, and the product
--     keeps a dead column in its most exposed read because a DDL verb was inconvenient.
--
-- ★★ THE ORDER IS LOAD-BEARING AND IT IS 0121's, NOT A NEW INVENTION:
--       1. drop the dependent function FIRST — the policy can be altered while it exists, but the
--          function's return type is what the API contract is;
--       2. recreate it AS auth_owner, so `tenant_health_read` + `credential_branding_lookup` apply
--          rather than the forced `tenant_isolation` policy. SECURITY DEFINER alone buys nothing
--          (D-17.27, measured in 0031);
--       3. narrow the policy's key list;
--       4. only then DELETE the stored rows.
--     ★ Deleting the rows first would leave a live function reading a key its policy still names,
--       which works but records the wrong intent for the next reader.
--
-- ★ `practice.name` and `branding.logo_url` STAY. KS-5.6: a tenant with no logo falls back to their
--   NAME in text, and Keystone's mark is NEVER substituted for a tenant's. This migration removes a
--   colour, not a branding system.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1 · the resolver loses its third column ─────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS keystone.resolve_login_branding_by_slug(text);

SET LOCAL ROLE auth_owner;

CREATE FUNCTION keystone.resolve_login_branding_by_slug(p_slug text)
RETURNS TABLE (display_name text, logo_url text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT
    -- ★ Unchanged from 0121: the practice's own name when set, the tenant row's name otherwise.
    COALESCE(NULLIF(pn.value #>> '{}', ''), t.name) AS display_name,
    NULLIF(lo.value #>> '{}', '')                   AS logo_url
  FROM keystone.tenant t
  LEFT JOIN keystone.tenant_setting pn
         ON pn.tenant_id = t.id AND pn.key = 'practice.name'
  LEFT JOIN keystone.tenant_setting lo
         ON lo.tenant_id = t.id AND lo.key = 'branding.logo_url'
  -- ★★★ THE TWO CONDITIONS ARE ONE WHERE CLAUSE. An unknown slug and a suspended one must be
  --     indistinguishable to an unauthenticated caller. Do not split them.
  WHERE lower(t.slug) = lower(p_slug)
    AND t.status = 'active'
$$;

REVOKE ALL ON FUNCTION keystone.resolve_login_branding_by_slug(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.resolve_login_branding_by_slug(text) TO app_rw, app_owner;

COMMENT ON FUNCTION keystone.resolve_login_branding_by_slug(text) IS
  'MS-18.2 / S8 — subdomain to the TWO strings a branded login screen paints, for the one moment '
  'before any session exists. RETURNS display_name and logo_url and NOTHING else: the return type '
  'IS the safety argument, and as of S8 it no longer carries a tenant colour, because the product '
  'has two fixed colours and a tenant does not pick them. ★ Returns ZERO ROWS for an unknown slug '
  'AND for a suspended, provisioning or closed one, from a single WHERE clause, because '
  'distinguishing them to an unauthenticated caller is a directory of every practice on the '
  'platform and its account standing. Owned by auth_owner so tenant_health_read (0017) and '
  'credential_branding_lookup apply instead of the forced tenant_isolation policy — SECURITY '
  'DEFINER alone buys nothing (D-17.27).';

RESET ROLE;

-- ── 2 · the policy stops naming a key nothing reads ─────────────────────────────────────────────
-- ★★ A policy that still admits `branding.primary_colour` would let a future function body read it
--    without any further grant. Narrowing the list is what makes the removal structural rather
--    than a matter of nobody happening to SELECT it.
DROP POLICY IF EXISTS credential_branding_lookup ON keystone.tenant_setting;

CREATE POLICY credential_branding_lookup ON keystone.tenant_setting
  FOR SELECT TO auth_owner
  USING (key IN ('practice.name', 'branding.logo_url'));

COMMENT ON POLICY credential_branding_lookup ON keystone.tenant_setting IS
  'MS-18.2 / S8. Lets the auth_owner-owned branding resolver read the TWO presentation strings a '
  'login screen paints, and NOTHING else: SELECT only, and only those two keys, so terminology '
  'overrides and the billing tier are invisible to the credential path. Required because '
  'tenant_setting is FORCE RLS (0065) — SECURITY DEFINER alone grants no exemption, only a policy '
  'naming the owner does (D-17.27, measured in 0031).';

-- ── 3 · the rows that already exist ─────────────────────────────────────────────────────────────
-- ★★★ THIS IS THE ONLY STATEMENT IN THE MIGRATION THAT TOUCHES DATA, AND IT IS THE WHOLE REASON
--     THE MIGRATION EXISTS. Everything above stops the value being read or written; only this
--     removes what is already stored.
DELETE FROM keystone.tenant_setting WHERE key = 'branding.primary_colour';

-- ── 4 · the guard, with its paired positive ─────────────────────────────────────────────────────
-- ★★★ A "must not" alone passes over a database where branding was deleted entirely. The second
--     assertion is what stops this migration certifying that outcome as success.
DO $guard$
DECLARE
  n_colour  int;
  n_logo    int;
  n_cols    int;
BEGIN
  SELECT count(*) INTO n_colour
    FROM keystone.tenant_setting WHERE key = 'branding.primary_colour';
  IF n_colour <> 0 THEN
    RAISE EXCEPTION 'S8: % branding.primary_colour row(s) survived the DELETE', n_colour;
  END IF;

  -- ★★ THE PAIRED POSITIVE: the catalogue key that STAYS must still be readable by the policy.
  SELECT count(*) INTO n_logo
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
   WHERE c.relname = 'tenant_setting'
     AND p.polname = 'credential_branding_lookup'
     AND pg_get_expr(p.polqual, p.polrelid) LIKE '%branding.logo_url%';
  IF n_logo <> 1 THEN
    RAISE EXCEPTION 'S8: credential_branding_lookup no longer admits branding.logo_url — the '
                    'removal took the tenant''s own mark with it (KS-5.6)';
  END IF;

  -- ★★★ AND THE RETURN TYPE IS THE CONTRACT. Two columns, named. A function that still returns
  --     three would mean the DROP silently did not apply.
  SELECT count(*) INTO n_cols
    FROM unnest(string_to_array(
           pg_get_function_result(
             'keystone.resolve_login_branding_by_slug(text)'::regprocedure), ',')) AS x;
  IF n_cols <> 2 THEN
    RAISE EXCEPTION 'S8: resolve_login_branding_by_slug returns % columns, expected 2 '
                    '(display_name, logo_url)', n_cols;
  END IF;
END
$guard$;

COMMIT;
