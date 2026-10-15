-- 0313_booking_link_redirect
-- Spec 03b task 3b.1 · CT-106 (booking-link system). MOCKUPS §10: "Old links redirect forever."
--
-- ★★★ A REDIRECT ROW IS NEVER USED TO DISCOVER A TENANT, ONLY TO FIND WHERE A KNOWN TENANT'S DEAD
--    SLUG NOW POINTS. Unlike keystone.link_token's credential lookup (genuinely tenant-less — the
--    row IS how the tenant is discovered), the coach-slug segment on `/book/:coachSlug` is read only
--    AFTER the practice's Host header has already resolved a tenant (CT-117, spec 03b §4.2 step 1).
--    So the read policy below is `USING (true)` — SAME SHAPE as `link_token_credential_read` (0169) —
--    but granted to `app_rw`, not `auth_owner`: this lookup runs directly in ordinary app-level route
--    code (EngPublicCoach resolving a dead slug), not only inside a SECURITY DEFINER function. RLS
--    being unconditional here does not widen anything: the caller always filters
--    `WHERE tenant_id = $alreadyResolvedTenantId`, the identical "the real boundary is the value the
--    caller already trust-verified, not the policy" argument link_token_credential_read's own comment
--    makes (0169:69-72).
--
-- ★★ WRITES ARE THE OPPOSITE: tenant-scoped and auth_owner-only. `record_booking_slug_redirect`
--    below is the ONLY writer — app_rw holds no INSERT/UPDATE/DELETE grant on this table at all —
--    called when a coach edits their own `booking_slug` (0312) or is offboarded (spec 01's
--    TeamRemove, wired by spec 01's own task per spec 03b §10 item 4, not built here).
--
-- ★ NEVER DELETED. MOCKUPS §10: "Old links redirect forever." No DELETE grant, no FOR DELETE policy,
--   anywhere in this migration — same discipline `keystone.invite` (0202) already uses.

-- ★ SYNTAX NOTE: spec 03b §3 describes the uniqueness as an inline `UNIQUE (tenant_id, subject_type,
--   lower(old_slug))` table constraint — not valid Postgres (a table-level UNIQUE constraint accepts
--   only column names, never an expression like lower(...); an expression uniqueness requires a
--   UNIQUE INDEX). Built below as `booking_link_redirect_slug_key`, the same construct every other
--   case-insensitive-unique column in this schema already uses (e.g. `invite_one_open_per_email_idx`,
--   0202; `service_tenant_name_key`, 0009; `app_user_booking_slug_key`, 0312) — same fact, the only
--   syntax that expresses it.
CREATE TABLE keystone.booking_link_redirect (
  id                       uuid PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id                uuid NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  old_slug                 text NOT NULL,
  subject_type             text NOT NULL CHECK (subject_type IN ('practice', 'coach')),
  redirect_to_app_user_id  uuid NULL REFERENCES keystone.app_user(id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX booking_link_redirect_slug_key
  ON keystone.booking_link_redirect (tenant_id, subject_type, lower(old_slug));

ALTER TABLE keystone.booking_link_redirect ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.booking_link_redirect FORCE  ROW LEVEL SECURITY;

-- ── app_rw: THE REDIRECT LOOKUP ITSELF — USING (true), same shape as link_token_credential_read ──
CREATE POLICY booking_link_redirect_read ON keystone.booking_link_redirect
  AS PERMISSIVE FOR SELECT TO app_rw USING (true);

GRANT SELECT ON keystone.booking_link_redirect TO app_rw;
-- ★ No INSERT, UPDATE or DELETE grant to app_rw — every write goes through the SECURITY DEFINER
--   function below, owned by auth_owner.

-- ── auth_owner: tenant-scoped, for record_booking_slug_redirect's own internal work ───────────────
CREATE POLICY booking_link_redirect_owner_isolation ON keystone.booking_link_redirect
  AS PERMISSIVE FOR SELECT TO auth_owner USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY booking_link_redirect_owner_insert ON keystone.booking_link_redirect
  AS PERMISSIVE FOR INSERT TO auth_owner WITH CHECK (tenant_id = keystone.current_tenant_id());
CREATE POLICY booking_link_redirect_owner_update ON keystone.booking_link_redirect
  AS PERMISSIVE FOR UPDATE TO auth_owner
  USING (tenant_id = keystone.current_tenant_id())
  WITH CHECK (tenant_id = keystone.current_tenant_id());

GRANT SELECT, INSERT, UPDATE ON keystone.booking_link_redirect TO auth_owner;  -- no DELETE, ever.

COMMENT ON TABLE keystone.booking_link_redirect IS
  'Spec 03b / 0313 (CT-106). "Old links redirect forever" (MOCKUPS §10). A coach or practice slug
   that changed, or a coach who was offboarded, leaves a row here pointing the old slug at its new
   target (redirect_to_app_user_id NULL = the practice page; set = that coach''s current page).
   Written only by keystone.record_booking_slug_redirect. Read is USING (true) to app_rw because the
   tenant is already known by the time this table is read (Host-resolved, CT-117) — this table is
   never used to discover a tenant, only to find where a known tenant''s dead slug now points. Never
   deleted.';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- record_booking_slug_redirect — THE ONLY WRITER.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
SET LOCAL ROLE auth_owner;

-- ★ Same "asserts p_tenant = current_tenant_id() and RAISES otherwise" discipline as
--   keystone.mint_link_token (0170) — a SECURITY DEFINER write must never take a tenant id on
--   trust. IS DISTINCT FROM, not <>, for the same reason 0170 uses it: with no tenant context
--   current_tenant_id() is NULL, and a plain <> comparison against NULL is NULL (not TRUE), which
--   would let a contextless call through.
-- ★ ON CONFLICT DO UPDATE: idempotent, safe to call twice for the same (tenant, subject_type,
--   old_slug) — e.g. re-running a coach-offboarding step must not raise a duplicate-key error.
CREATE FUNCTION keystone.record_booking_slug_redirect(
  p_tenant uuid,
  p_old_slug text,
  p_subject_type text,
  p_redirect_to_app_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_tenant IS DISTINCT FROM keystone.current_tenant_id() THEN
    RAISE EXCEPTION
      'record_booking_slug_redirect: p_tenant is not the current practice. A SECURITY DEFINER write must never take a tenant id on trust, so this is refused rather than recorded against the practice the caller named.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO keystone.booking_link_redirect
    (tenant_id, old_slug, subject_type, redirect_to_app_user_id)
  VALUES
    (p_tenant, p_old_slug, p_subject_type, p_redirect_to_app_user_id)
  ON CONFLICT (tenant_id, subject_type, lower(old_slug)) DO UPDATE
    SET redirect_to_app_user_id = EXCLUDED.redirect_to_app_user_id
  RETURNING id INTO v_id;

  RETURN v_id;
END
$$;

-- ★★★ FIX [MEASURED 23 Sep 2026, Group A deploy] — THE REVOKE/GRANT/COMMENT BELOW RUN AS auth_owner,
--    NOT app_owner, AND THE ORDER OF THESE TWO BLOCKS IS THE WHOLE POINT.
--    This file previously did `SET LOCAL ROLE app_owner` HERE, before the three statements below.
--    All three act on `record_booking_slug_redirect`, which was created under `SET LOCAL ROLE
--    auth_owner` above and is therefore OWNED BY auth_owner. `app_owner` is a MEMBER of auth_owner
--    but **NOINHERIT since the F484 repair** (0339:25-27 records exactly this), so under
--    `SET LOCAL ROLE app_owner` it does NOT hold auth_owner's privileges: REVOKE and GRANT degrade
--    to WARNINGs ("no privileges could be revoked/granted") and `COMMENT ON FUNCTION` fails outright
--    with `must be owner of function keystone.record_booking_slug_redirect`, rolling the migration
--    back. [EXECUTED: that is the exact error this migration produced on its first-ever application.]
--    0170 — the migration this file's own comments cite as the pattern — does the opposite and is
--    correct: it REVOKEs, GRANTs and COMMENTs on each function while STILL auth_owner (0170:72-75,
--    110-113, 145-148, 182-185) and only then switches to app_owner (0170:194). 0339 does the same.
--    So the three statements stay where they are and the role switch moves BELOW them.
REVOKE ALL ON FUNCTION
  keystone.record_booking_slug_redirect(uuid, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  keystone.record_booking_slug_redirect(uuid, text, text, uuid) TO app_rw;

COMMENT ON FUNCTION keystone.record_booking_slug_redirect(uuid, text, text, uuid) IS
  'Spec 03b / 0313 (CT-106). The ONLY writer of keystone.booking_link_redirect. Called when a coach
   edits their own booking_slug (0312) or is offboarded (spec 01''s TeamRemove wires this call — spec
   03b §10 item 4). Raises insufficient_privilege unless p_tenant is the current practice. Idempotent:
   a second call for the same (tenant, subject_type, old_slug) updates the target rather than erroring.';

-- ★★★ SET LOCAL ROLE app_owner, NEVER RESET ROLE — RESET ROLE returns to the SESSION role, which
--    db/migrate.mjs establishes from a SUPERUSER connection, so RESET ROLE would silently leave the
--    rest of this migration running as superuser (0170's own header measures this trap, 0017:107-112).
--    Nothing follows, but the role is still unwound explicitly, exactly as 0170:194 and 0339:57 do.
SET LOCAL ROLE app_owner;
