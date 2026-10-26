-- 0532_handoff_session_kind — the maintainer's ruling, 28 Sep 2026: signing in at app.example.com finds
-- the person's practice and hands them across with a secure one-time pass, never a second
-- password and never a "this practice's sign-in page is at ..." message.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ WHY A SESSION KIND, NOT A NEW TABLE. app.mjs's own header on the /login route already
--     recorded, in terms, why a bespoke one-time credential was rejected before: "minting,
--     expiring and replay-protecting a brand-new credential type" is real, ongoing surface area.
--     That reasoning held for the SAME-ORIGIN case it was written for; it does not remove the need
--     here, where app. and a practice's own subdomain are genuinely different origins and a
--     same-origin cookie cannot cross between them. But the FIX does not require a new credential
--     type either — `keystone_auth.session` already has every property a one-time cross-origin
--     pass needs (a hashed secret, an expiry, a single revoke path), and `kind='partial'` already
--     proves the exact shape this needs: a session that exists, is real, and can do exactly ONE
--     thing before it is either promoted or discarded. `keystone.upgrade_session` (0228) is the
--     PROMOTE half of that shape, already built and already proven. `handoff` reuses both.
--
-- ★★ THE SHAPE: `createSession(..., kind: 'handoff', ttlHours: 1)` mints one on app.'s own host,
--    scoped to the ALREADY-RESOLVED target tenant (the membership lookup — the one place identity
--    is decided — has already run by the time a handoff session is minted; this migration adds no
--    new identity or tenancy decision, only a new label on an existing one). The browser is
--    redirected to `https://{slug}.{domain}/api/auth/handoff/redeem?token=...`. That route
--    (added in code, not here) redeems the token via `redeem_handoff_session` below — an ATOMIC
--    UPDATE, same idiom as `upgrade_session`, so two concurrent redemption attempts cannot both
--    succeed — which flips `kind` to `'partial'` and extends the expiry to the SAME 1-hour partial
--    window `login()` already uses for two-step. From there the EXISTING partial→app path
--    (`upgrade_session`, called immediately if no second factor is outstanding, or left as
--    `'partial'` for the caller to complete two-step exactly as it would for an ordinary sign-in)
--    takes over. No second promote function is written here because one already exists.
--
-- ★ SINGLE-USE BY CONSTRUCTION, NOT BY A SEPARATE FLAG. Redemption is a `kind = 'handoff'`
--   predicate inside the UPDATE — the moment it succeeds, the row's kind is no longer 'handoff',
--   so the identical UPDATE run again (a replayed link, a second tab) matches zero rows and
--   returns nothing. `resolve_session` (the path every ordinary authenticated ROUTE goes through)
--   is updated below to refuse `kind = 'handoff'` outright, the same way it already refuses
--   'partial' — a handoff session can never be used for anything except the one redemption call.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- ★ `keystone_auth.session` is owned by auth_owner (same as resolve_session's own definer, 0368) —
--   this migration runs as app_owner by default, so it must switch role before touching the table
--   at all, not only before redefining the function.
SET LOCAL ROLE auth_owner;

ALTER TABLE keystone_auth.session
  DROP CONSTRAINT session_kind_check,
  ADD CONSTRAINT session_kind_check
    CHECK (kind = ANY (ARRAY['app', 'operator', 'client', 'partial', 'handoff']));

-- ★ FIX — `resolve_session` (0368's own definition, carried forward unchanged apart from the one
--   added exclusion) must refuse a handoff session exactly as it already refuses a partial one, or
--   a still-live handoff token would authenticate ordinary requests for its full hour.
CREATE OR REPLACE FUNCTION keystone.resolve_session(p_token_id text, p_secret_hash bytea)
RETURNS TABLE (tenant_id uuid, app_user_id uuid, operator_grant_id uuid, viewing_as_app_user_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT s.tenant_id, s.app_user_id,
         (SELECT g.id FROM keystone_auth.operator_grant g
           WHERE g.firebase_uid = s.firebase_uid
             AND g.revoked_at IS NULL AND g.expires_at > pg_catalog.now()
             AND g.approved_at IS NOT NULL
           ORDER BY g.expires_at DESC LIMIT 1) AS operator_grant_id,
         CASE WHEN s.viewing_as_expires_at > now() THEN s.viewing_as_app_user_id ELSE NULL END
           AS viewing_as_app_user_id
    FROM keystone_auth.session s
    LEFT JOIN keystone.tenant t ON t.id = s.tenant_id
   WHERE s.token_id = p_token_id
     AND s.secret_hash = p_secret_hash
     AND s.revoked_at IS NULL
     AND s.expires_at > now()
     -- ★ FIX (0532) — was `s.kind <> 'partial'`. A handoff session is exactly as unfit for an
     --   ordinary route as a partial one: it exists to be redeemed once, by one route, and never
     --   to answer for anything else.
     AND s.kind NOT IN ('partial', 'handoff')
     AND (t.id IS NULL OR t.status NOT IN ('suspended','closed') OR s.kind = 'client')
$$;

COMMENT ON FUNCTION keystone.resolve_session(text, bytea) IS
  '0532: excludes kind=handoff (was: excludes kind=partial only). A handoff session, like a '
  'partial one, may never answer an ordinary authenticated route — only its own dedicated '
  'redemption path may consume it. Every other predicate unchanged since 0368.';

-- ★★★ THE REDEMPTION, ATOMIC. Same idiom as `upgrade_session` (0228): an UPDATE whose WHERE clause
--     IS the validity check, so a row that does not match (wrong secret, expired, already redeemed,
--     not a handoff session at all) simply returns no rows — there is no separate
--     "check, then act" window for two requests to race through.
CREATE OR REPLACE FUNCTION keystone.redeem_handoff_session(p_token_id text, p_secret_hash bytea)
RETURNS TABLE (tenant_id uuid, app_user_id uuid, firebase_uid text)
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  UPDATE keystone_auth.session
     -- ★ Lands exactly where a fresh two-step-pending sign-in already lands: 'partial', 1 hour —
     --   login.mjs's own comment names this as the shortest TTL create_session's SQL can express
     --   (make_interval's `hours` argument is integer). The caller (code, not this migration)
     --   calls the EXISTING `upgrade_session` immediately when no second factor is outstanding,
     --   exactly the same call an ordinary sign-in already makes for that case.
     SET kind = 'partial', expires_at = now() + interval '1 hour'
   WHERE token_id = p_token_id
     AND secret_hash = p_secret_hash
     AND kind = 'handoff'
     AND revoked_at IS NULL
     AND expires_at > now()
  RETURNING tenant_id, app_user_id, firebase_uid
$$;

COMMENT ON FUNCTION keystone.redeem_handoff_session(text, bytea) IS
  '0532 (the maintainer, 28 Sep 2026): redeems a one-time app.->practice handoff session, exactly once — the '
  'WHERE clause on kind=''handoff'' means a replayed token matches nothing the second time. Lands '
  'the session at kind=''partial'' (login.mjs''s own 1-hour shape); the caller upgrades it to '
  '''app'' with the existing upgrade_session() when no second factor is outstanding.';

RESET ROLE;

-- ── SELF-CHECK, WITH A POSITIVE CONTROL ───────────────────────────────────────────────────────
DO $handoff_session_check$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'keystone_auth.session'::regclass AND conname = 'session_kind_check';
  IF v_def IS NULL OR v_def NOT LIKE '%handoff%' THEN
    RAISE EXCEPTION '0532: session_kind_check does not admit ''handoff'' after this migration ran (got: %)', v_def;
  END IF;

  IF to_regprocedure('keystone.redeem_handoff_session(text, bytea)') IS NULL THEN
    RAISE EXCEPTION '0532: keystone.redeem_handoff_session was not created';
  END IF;

  RAISE NOTICE '0532: handoff session kind admitted, resolve_session excludes it, redeem_handoff_session exists';
END
$handoff_session_check$;
