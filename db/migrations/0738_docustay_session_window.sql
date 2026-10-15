-- 0738_docustay_session_window — the maintainer, 13 Oct 2026: "stay signed in after upgrading". A Docustay sign-in used to last a fixed 12 hours from the moment of sign-in (createSession ttlHours = 12), so a
-- person who signed in in the morning was signed out in the evening, in the middle of paying. The industry pattern is: stay signed in while active, an idle limit, a longer absolute maximum, and a fresh
-- sign-in only for risky acts (deleting a workspace or account already asks for one: src/product/deletion.mjs REAUTH_MINUTES).
--   * ABSOLUTE MAXIMUM: 30 days from sign-in, for a Docustay workspace's browser session only. Written here, in one place, as the session becomes an 'app' session (a direct sign-in, or the
--     two-step 'partial' -> 'app' upgrade), so every sign-in path is covered without editing each caller.
--   * IDLE LIMIT: 7 days without a request, enforced on the request path (src/auth/idleSignOut.mjs; the workspace's own `security.idle_minutes` still wins when an owner sets one).
--   * PLATFORM IS UNTOUCHED: the trigger does nothing for any tenant whose product is not 'docustay' (they keep 12 hours), an operator, client, partial or handoff session.
-- Additive and idempotent: one function, one trigger.
SET LOCAL ROLE auth_owner;

CREATE OR REPLACE FUNCTION keystone_auth.docustay_session_window()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.kind = 'app' AND NEW.tenant_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.kind IS DISTINCT FROM 'app')
     AND EXISTS (SELECT 1 FROM keystone.tenant t WHERE t.id = NEW.tenant_id AND t.product = 'docustay') THEN
    NEW.expires_at := pg_catalog.now() + interval '30 days';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION keystone_auth.docustay_session_window() FROM PUBLIC;

DROP TRIGGER IF EXISTS docustay_session_window ON keystone_auth.session;
CREATE TRIGGER docustay_session_window BEFORE INSERT OR UPDATE OF kind ON keystone_auth.session
  FOR EACH ROW EXECUTE FUNCTION keystone_auth.docustay_session_window();

COMMENT ON FUNCTION keystone_auth.docustay_session_window() IS
  '0738 (the maintainer, 13 Oct 2026): a Docustay workspace''s browser session lasts up to 30 days (was a fixed 12 hours); idle sign-out after 7 days is enforced on the request path. No other product is affected.';

RESET ROLE;

-- ── SELF-CHECK ──
DO $session_window_check$
DECLARE v_owner text; v_secdef boolean;
BEGIN
  SELECT pg_get_userbyid(p.proowner), p.prosecdef INTO v_owner, v_secdef FROM pg_proc p WHERE p.oid = 'keystone_auth.docustay_session_window()'::regprocedure;
  IF v_owner IS DISTINCT FROM 'auth_owner' OR NOT v_secdef THEN RAISE EXCEPTION '0738: docustay_session_window must be SECURITY DEFINER owned by auth_owner (got % / %)', v_owner, v_secdef; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'docustay_session_window' AND tgrelid = 'keystone_auth.session'::regclass AND NOT tgisinternal) THEN
    RAISE EXCEPTION '0738: the trigger is missing';
  END IF;
END
$session_window_check$;
