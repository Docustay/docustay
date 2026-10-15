-- 0019_app_user_firebase_uid
-- P13.0 — app_user gains a Firebase uid column.
-- ★ BUILD-UI.md calls this "migration 0017a". It takes 0019 because P12.6 and P12.12 needed
--   0017 and 0018 first, and db/migrate.mjs:52-55 applies files in lexicographic order.
--
-- ★★★ WHY THIS IS A MIGRATION AND NOT A LINE OF CODE. §D2 justified keeping Firebase as the
-- identity provider on the grounds that "app_user is keyed on Firebase UIDs already".
-- [MEAS] THAT IS FALSE. app_user is
--     (id, tenant_id, email, display_name, role, created_at, updated_at, staff_role)
-- There is no uid column and no migration ever added one. The RULING survives on two other
-- grounds — the accounts and password hashes live in Firebase Auth and there is no migration off
-- them that does not force a re-auth event for every user, and the maintainer ruled it in session — but the
-- CONSEQUENCE of the false reason is concrete:
--
-- ★★ P13.4 SAYS "MATCH BY UID, NEVER BY NAME" (hard limit 2) AND THAT WAS UNIMPLEMENTABLE.
-- The only identity key available was `UNIQUE (tenant_id, lower(email))`, and an email is a
-- MUTABLE, USER-SUPPLIED, REASSIGNABLE HANDLE. Matching a token to a person by email IS the
-- hard-limit-2 defect, not a shortcut around it: change an address in Firebase and the lookup
-- silently finds nobody, or — worse — finds the NEXT person to be given that address.
--
-- ★ A Firebase uid, by contrast, is opaque, assigned by Google, and never reused.

ALTER TABLE keystone.app_user ADD COLUMN firebase_uid text;

-- ★★★ TENANT-SCOPED, NEVER A BARE UNIQUE (firebase_uid) — AND A GLOBALLY UNIQUE VALUE IS EXACTLY
-- WHY THE TEMPTATION EXISTS. A Firebase uid IS globally unique, so `UNIQUE (firebase_uid)` looks
-- not merely acceptable but more correct. It is not, and 0001:135-139 gives the reason:
--     "REFERENTIAL-INTEGRITY AND UNIQUENESS CHECKS BYPASS RLS. A bare UNIQUE (email) would let
--      tenant A discover that tenant B has a given user."
-- A bare unique index here would make an INSERT fail with a message NAMING THE CONSTRAINT when
-- the uid already exists in ANOTHER tenant — disclosing "this person is a customer of one of your
-- competitors" to anyone who can provoke an insert. The check runs beneath the policy, so no
-- policy can stop it.
-- ★ The cost of scoping it per tenant is that ONE Firebase account may be a person in two
--   tenants. That is correct and intended: a coach who is also a client of another practice is
--   two people as far as tenancy is concerned, and collapsing them would be the leak.
CREATE UNIQUE INDEX app_user_tenant_firebase_uid_key
  ON keystone.app_user (tenant_id, firebase_uid) WHERE firebase_uid IS NOT NULL;

COMMENT ON COLUMN keystone.app_user.firebase_uid IS
  'P13.0 — the Firebase Auth uid. THE identity key for token->person matching (hard limit 2: match by uid, never by name or email). NULL for a person who has never signed in. Tenant-scoped unique, never bare: uniqueness violations bypass RLS and name the constraint (0001:135-139).';

-- ─────────────────────────────────────────────────────────────────────────────
-- ★★ THE BACKFILL, AND WHY IT IS DELIBERATELY EMPTY.
-- ─────────────────────────────────────────────────────────────────────────────
-- 0010:42-74 records a backfill that MATCHED ZERO ROWS and then died on ADD CONSTRAINT, because
-- app_user is FORCE ROW LEVEL SECURITY and a migration sets no tenant GUC — so even the owner
-- sees nothing. ★ There is nothing to backfill here regardless: no uid exists anywhere in the
-- database to copy from. But the column is left NULLABLE for the same reason the backfill would
-- have had to reckon with, and that is worth stating rather than leaving as an absence:
--
-- ★★★ THE COLUMN IS NULLABLE ON PURPOSE, AND IT IS NOT LAZINESS.
--   · A person can exist before they can sign in — P13's whole point is that a lead is screened
--     and a record created BEFORE any account exists.
--   · `NOT NULL` would make every existing row unmigratable and every staff-created person
--     impossible until Firebase had seen them.
-- ★ The safety property is therefore NOT "every row has a uid". It is "NO TWO ROWS IN A TENANT
--   SHARE ONE", which the partial unique index gives, plus the lookup refusing a NULL — a query
--   written `WHERE firebase_uid = $1` can never match a NULL row, because NULL = anything is
--   NULL, not TRUE. The nullable column cannot produce a false match.

-- ─────────────────────────────────────────────────────────────────────────────
-- ★★ PROVE IT. The index must actually refuse a duplicate WITHIN a tenant and must actually
--    PERMIT the same uid in two different tenants. A unique index nobody has seen refuse, and
--    nobody has seen permit, is two assumptions.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE keystone.app_user NO FORCE ROW LEVEL SECURITY;
ALTER TABLE keystone.tenant   NO FORCE ROW LEVEL SECURITY;

DO $$
DECLARE t1 uuid; t2 uuid; refused boolean := false; nulls_ok boolean := false;
BEGIN
  INSERT INTO keystone.tenant (slug,name,timezone,status)
  VALUES ('m0019-a','M0019 A','UTC','active'), ('m0019-b','M0019 B','UTC','active');
  SELECT id INTO t1 FROM keystone.tenant WHERE slug='m0019-a';
  SELECT id INTO t2 FROM keystone.tenant WHERE slug='m0019-b';

  INSERT INTO keystone.app_user (tenant_id,email,display_name,role,firebase_uid)
  VALUES (t1,'a@example.invalid','A','adult_client','uid-shared');

  -- NEGATIVE: the same uid twice in ONE tenant must be refused.
  BEGIN
    INSERT INTO keystone.app_user (tenant_id,email,display_name,role,firebase_uid)
    VALUES (t1,'a2@example.invalid','A2','adult_client','uid-shared');
  EXCEPTION WHEN unique_violation THEN refused := true;
  END;
  IF NOT refused THEN
    RAISE EXCEPTION 'app_user_tenant_firebase_uid_key did NOT refuse a duplicate uid within one tenant — two people in a practice could share one identity';
  END IF;

  -- ★ POSITIVE: the SAME uid in a DIFFERENT tenant must be PERMITTED. If this were refused the
  --   index would be behaving as a bare global unique, which is the leak this migration avoids —
  --   and it would be invisible until a real person joined a second practice.
  INSERT INTO keystone.app_user (tenant_id,email,display_name,role,firebase_uid)
  VALUES (t2,'a@example.invalid','A in B','adult_client','uid-shared');

  -- ★ AND: two NULL uids in one tenant must be permitted, or every pre-signin person collides.
  INSERT INTO keystone.app_user (tenant_id,email,display_name,role)
  VALUES (t1,'n1@example.invalid','No uid 1','adult_client'),
         (t1,'n2@example.invalid','No uid 2','adult_client');
  nulls_ok := true;

  RAISE NOTICE 'firebase_uid index: duplicate-in-tenant REFUSED, same-uid-across-tenants PERMITTED, multiple NULLs permitted=%', nulls_ok;

  DELETE FROM keystone.app_user WHERE tenant_id IN (t1,t2);
  DELETE FROM keystone.tenant   WHERE id IN (t1,t2);
END $$;

ALTER TABLE keystone.app_user FORCE ROW LEVEL SECURITY;
ALTER TABLE keystone.tenant   FORCE ROW LEVEL SECURITY;

-- ★★ PROVE FORCE CAME BACK ON BOTH TABLES. 0010 established this ritual; leaving FORCE off on
--    app_user would disable tenant isolation on the most sensitive table in the schema and every
--    later migration and gate would still pass.
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO bad
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname='keystone' AND c.relname IN ('app_user','tenant') AND NOT c.relforcerowsecurity;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'FORCE ROW LEVEL SECURITY was not restored on: %', bad;
  END IF;
END $$;
