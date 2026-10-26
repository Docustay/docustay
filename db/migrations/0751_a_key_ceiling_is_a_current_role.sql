-- 0751 · A developer key's rank ceiling named a role that no longer exists.
--
-- ★★★ MEASURED 15 Oct 2026: keystone_auth.api_token.rank_ceiling was CHECKed to ('owner','admin','coach') (0199) and is
--   handed straight to keystone.role_may(p_role_key, …), which matches keystone.role.key. The built-in roles are now
--   owner / admin / member (staff rank 'coach' was retired), so
--     · a MEMBER creating an API key was refused (createApiToken rejects a ceiling outside the list; the route passes the
--       minter's own staff_role, 'member') — the lowest rank on a team could not make a key at all; and
--     · every existing key with the old ceiling 'coach' matched NO role, so it failed closed on every ladder route.
--   Fix: the ceiling vocabulary is the current role keys. Existing 'coach' keys become 'member' (the same lowest rank, which is
--   all 'coach' ever meant here); the column DEFAULT stays the lowest rank so a row that arrives without a ceiling still gets
--   the least authority. Additive in effect: no key gains authority (coach was the lowest rank; so is member).
SET LOCAL ROLE auth_owner;

ALTER TABLE keystone_auth.api_token DROP CONSTRAINT IF EXISTS api_token_rank_ceiling_check;
UPDATE keystone_auth.api_token SET rank_ceiling = 'member' WHERE rank_ceiling = 'coach';
ALTER TABLE keystone_auth.api_token ALTER COLUMN rank_ceiling SET DEFAULT 'member';
ALTER TABLE keystone_auth.api_token
  ADD CONSTRAINT api_token_rank_ceiling_check CHECK (rank_ceiling IN ('owner','admin','member'));

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM keystone_auth.api_token WHERE rank_ceiling NOT IN ('owner','admin','member')) THEN
    RAISE EXCEPTION '0751: a key still carries a ceiling outside owner/admin/member';
  END IF;
END $$;

SET ROLE app_owner;   -- ★ F482: hand the role back explicitly. NEVER `RESET ROLE`.

DO $$ BEGIN
  IF current_user <> 'app_owner' THEN RAISE EXCEPTION '0751 finished as % — it must hand back to app_owner', current_user; END IF;
END $$;
