-- 0404 — REVOKE A LINK TOKEN BY ITS PRIMARY KEY, NOT BY ITS PUBLIC TOKEN ID.
--
-- ★★★ WHY THIS EXISTS: A REVOKE THAT SILENTLY DID NOTHING. [MEASURED 25 Sep 2026, B-29]
--     `keystone.revoke_link_token(p_token_id text, p_reason text)` (0170:168-180) matches on
--     `t.token_id` — the PUBLIC token identifier a person presents in a link. But
--     `booking_waitlist_entry.claim_token_id` (0398) is declared
--     `uuid NULL REFERENCES keystone.link_token (id)` — the table's PRIMARY KEY, a different
--     column entirely.
--   ★★ So the waitlist offer-expiry job passed a primary key where a public token id was
--      expected, matched no row, and the function returned NULL. `revokeLinkToken` reports that
--      as `{ revoked: false }` and RAISES NOTHING. The job logged success. Nothing anywhere said
--      the token was still live.
--   ★★★ CONSEQUENCE WHILE IT STOOD: a person whose waitlist offer had EXPIRED still held a
--        working claim link until the token's own TTL ran out — they could take a slot that
--        should have passed to the next person on the list. Single-redemption (`redeemed_at`)
--        still held, so it could not be spent twice; the hole was the window between expiry and
--        TTL.
--
-- ★★ WHY A NEW FUNCTION AND NOT A FIX TO THE CALLER: `app_rw` deliberately has NO SELECT on
--    `token_id` (0169:47-50, CCR-16 — the column-level grant excludes `token_id` and
--    `secret_hash` so the lookup id never reaches app_rw). The job therefore CANNOT look the
--    public token id up from the row it holds. It has the primary key and nothing else, so the
--    primary key is what the function must take.
--  ★ And NOT a change to `revoke_link_token` itself: `src/auth/invite.mjs:282` passes a real
--    `token_id` and is correct. Two callers, two different identifiers, two functions — rather
--    than one function guessing which it was handed.
--
-- ★ SECURITY DEFINER, exactly like its 0170 sibling, so `token_id` and `secret_hash` still never
--   reach `app_rw`. Same tenant predicate, same "not already spent, not already revoked" guard,
--   same `RETURNING t.id` shape, so the JS wrapper's `{ revoked: Boolean(id) }` is unchanged.

CREATE FUNCTION keystone.revoke_link_token_by_id(p_id uuid, p_reason text)
RETURNS uuid
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path TO ''
AS $$
  UPDATE keystone.link_token t
     SET revoked_at = now(), revoked_reason = p_reason
   WHERE t.id          = p_id
     AND t.tenant_id   = keystone.current_tenant_id()
     AND t.revoked_at  IS NULL
     AND t.redeemed_at IS NULL
  RETURNING t.id
$$;

REVOKE ALL ON FUNCTION keystone.revoke_link_token_by_id(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.revoke_link_token_by_id(uuid, text) TO app_rw;

COMMENT ON FUNCTION keystone.revoke_link_token_by_id(uuid, text) IS
  '0404 (B-29). Kills an unspent link token by its PRIMARY KEY, in the current practice only, and
   returns its id or nothing. The sibling of revoke_link_token(text,text), which keys on the public
   token_id. This one exists because booking_waitlist_entry.claim_token_id stores link_token.id and
   app_rw has no SELECT on token_id (CCR-16), so a caller holding the row cannot derive the public
   id. Passing a uuid to the text-keyed function matched nothing and revoked nothing, silently.';

-- ★★ SELF-CHECK — a migration that claims to add a function proves it did. Same discipline the
--    Stage 13 migrations use: fail loudly here rather than at the first call site in production.
DO $$
BEGIN
  IF to_regprocedure('keystone.revoke_link_token_by_id(uuid, text)') IS NULL THEN
    RAISE EXCEPTION '0404 — keystone.revoke_link_token_by_id(uuid, text) was not created';
  END IF;
  IF NOT has_function_privilege('app_rw', 'keystone.revoke_link_token_by_id(uuid, text)', 'EXECUTE')
  THEN
    RAISE EXCEPTION '0404 — app_rw cannot EXECUTE revoke_link_token_by_id; the expiry job would fail closed';
  END IF;
  -- ★ The sibling must still exist and still be keyed on text: this migration ADDS a path, it does
  --   not replace one, and invite.mjs still depends on the original.
  IF to_regprocedure('keystone.revoke_link_token(text, text)') IS NULL THEN
    RAISE EXCEPTION '0404 — keystone.revoke_link_token(text, text) is missing; 0170 must run first';
  END IF;
END $$;
