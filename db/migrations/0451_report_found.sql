-- 0451_report_found — Stage 16 task 16.10
--
-- Adds keystone.report_found(p_tenant uuid, p_range daterange, p_compare daterange, p_viewer uuid)
-- RETURNS jsonb — a "how people find you" report showing enquiry-to-client conversion metrics
-- and breakdown by source.
--
-- Definitions:
--   - An "enquiry" = an app_user row created in p_range whose role is a client role
--     (adult_client or adolescent_client) and whose lifecycle_status is 'lead' (created as lead).
--   - enquiries_compare = same count for p_compare.
--   - became_clients = count of enquiries whose lifecycle_status is now one of active|paused|former.
--   - conversion_pct = became_clients / enquiries * 100 (0 if enquiries = 0).
--   - days_to_first_session_median = median days between app_user.created_at and their first
--     completed booking's starts_at, for those who became clients.
--   - sources = enquiries grouped by app_user.source, each with its own became_clients count.
--   - didnt = enquiries that did NOT become clients, with reason_class computed as:
--     'our_fault' when there is an OPEN task with topic 'forms.form.submitted' whose subject
--     is that person AND the task is older than 7 days (created_at < now() - interval '7 days'
--     and closed_at IS NULL); otherwise 'unknown'.
--
-- Ad spend per source is NOT included (no ads reads in this stage — RULED 16.13).
--
-- GRANT EXECUTE ON FUNCTION keystone.report_found TO app_rw; REVOKE FROM PUBLIC.
--
-- Written during BUILD. NOT APPLIED — the migration runner applies this at step 3 (TEST).
-- (REHEARSAL FIX 25 Sep 2026: explicit BEGIN removed — db/migrate.mjs wraps every file in its own transaction; an inner COMMIT would commit half a migration and orphan the runner's bookkeeping.)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §a · PRECONDITIONS
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $preconditions$
BEGIN
  IF current_user <> 'app_owner' THEN
    RAISE EXCEPTION '0451: must run as app_owner (db/migrate.mjs), running as %', current_user;
  END IF;

  -- Verify source tables exist
  IF to_regclass('keystone.app_user') IS NULL THEN
    RAISE EXCEPTION '0451: keystone.app_user does not exist';
  END IF;
  IF to_regclass('keystone.task') IS NULL THEN
    RAISE EXCEPTION '0451: keystone.task does not exist';
  END IF;
  IF to_regclass('keystone.booking') IS NULL THEN
    RAISE EXCEPTION '0451: keystone.booking does not exist';
  END IF;
  IF to_regclass('keystone.booking_participant') IS NULL THEN
    RAISE EXCEPTION '0451: keystone.booking_participant does not exist';
  END IF;

  -- Verify keystone.user_may exists with correct signature
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
     WHERE proname = 'user_may' AND pronamespace = 'keystone'::regnamespace
       AND pronargs = 4
  ) THEN
    RAISE EXCEPTION '0451: keystone.user_may(uuid, text, text, uuid) does not exist';
  END IF;

  -- Verify keystone.report_enough_data exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
     WHERE proname = 'report_enough_data' AND pronamespace = 'keystone'::regnamespace
       AND pronargs = 1
  ) THEN
    RAISE EXCEPTION '0451: keystone.report_enough_data(uuid) does not exist';
  END IF;
END
$preconditions$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- § A · keystone.report_found(p_tenant uuid, p_range daterange, p_compare daterange, p_viewer uuid)
--       RETURNS jsonb
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE FUNCTION keystone.report_found(
  p_tenant uuid,
  p_range daterange,
  p_compare daterange,
  p_viewer uuid
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = keystone, pg_temp
AS $$
DECLARE
  v_enquiries integer;
  v_enquiries_compare integer;
  v_became_clients integer;
  v_conversion_pct numeric;
  v_days_to_first_session_median numeric;
  v_sources jsonb;
  v_didnt jsonb;
  v_enough_data jsonb;
BEGIN
  -- ★ Tenant mismatch guard: first statement after function entry.
  IF p_tenant IS DISTINCT FROM keystone.current_tenant_id() THEN
    RAISE EXCEPTION 'report: tenant mismatch' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ★ Scope check: viewer must have 'person' 'view' permission
  IF NOT keystone.user_may(p_viewer, 'person', 'view', NULL) THEN
    RAISE EXCEPTION 'report_found: not permitted' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Count enquiries in the range (created as leads)
  SELECT COUNT(*) INTO v_enquiries
    FROM keystone.app_user
   WHERE tenant_id = p_tenant
     AND role IN ('adult_client', 'adolescent_client')
     AND lifecycle_status = 'lead'
     AND created_at::date <@ p_range;

  -- Count enquiries in compare range
  SELECT COUNT(*) INTO v_enquiries_compare
    FROM keystone.app_user
   WHERE tenant_id = p_tenant
     AND role IN ('adult_client', 'adolescent_client')
     AND lifecycle_status = 'lead'
     AND created_at::date <@ p_compare;

  -- Count became_clients (enquiries whose lifecycle_status is now active|paused|former)
  SELECT COUNT(*) INTO v_became_clients
    FROM keystone.app_user
   WHERE tenant_id = p_tenant
     AND role IN ('adult_client', 'adolescent_client')
     AND lifecycle_status IN ('active', 'paused', 'former')
     AND created_at::date <@ p_range;

  -- Calculate conversion percentage
  v_conversion_pct := CASE
    WHEN v_enquiries = 0 THEN 0
    ELSE (v_became_clients::numeric / v_enquiries * 100)
  END;

  -- Calculate median days to first session for those who became clients
  WITH first_bookings AS (
    SELECT DISTINCT
      au.id,
      EXTRACT(DAY FROM (b.starts_at - au.created_at))::integer AS days_diff
    FROM keystone.app_user au
    LEFT JOIN keystone.booking_participant bp
      ON bp.tenant_id = au.tenant_id
      AND bp.app_user_id = au.id
    LEFT JOIN keystone.booking b
      ON b.tenant_id = bp.tenant_id
      AND b.id = bp.booking_id
   WHERE au.tenant_id = p_tenant
     AND au.role IN ('adult_client', 'adolescent_client')
     AND au.lifecycle_status IN ('active', 'paused', 'former')
     AND au.created_at::date <@ p_range
     AND b.state = 'completed'
     -- Get only the first completed booking per person
     AND b.id = (
       SELECT bp2.booking_id
         FROM keystone.booking_participant bp2
         JOIN keystone.booking b2 ON b2.id = bp2.booking_id
        WHERE bp2.tenant_id = au.tenant_id
          AND bp2.app_user_id = au.id
          AND b2.state = 'completed'
        ORDER BY b2.starts_at ASC
        LIMIT 1
     )
  )
  SELECT COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY days_diff), NULL) INTO v_days_to_first_session_median
    FROM first_bookings;

  -- Sources: enquiries grouped by app_user.source with became_clients per source
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'source', COALESCE(source, 'unknown'),
      'enquiries', source_enquiries,
      'became_clients', source_became_clients
    )
    ORDER BY source_enquiries DESC
  ), '[]'::jsonb) INTO v_sources
    FROM (
      SELECT
        au.source,
        COUNT(*) AS source_enquiries,
        SUM(CASE WHEN au.lifecycle_status IN ('active', 'paused', 'former') THEN 1 ELSE 0 END) AS source_became_clients
        FROM keystone.app_user au
       WHERE au.tenant_id = p_tenant
         AND au.role IN ('adult_client', 'adolescent_client')
         AND au.lifecycle_status = 'lead'
         AND au.created_at::date <@ p_range
       GROUP BY au.source
    ) sources_grouped;

  -- Didnt: enquiries that did NOT become clients, with reason_class
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'person_id', au.id,
      'display_name', au.display_name,
      'reason_class', CASE
        WHEN EXISTS (
          SELECT 1
            FROM keystone.task t
           WHERE t.tenant_id = p_tenant
             AND t.topic = 'forms.form.submitted'
             AND t.subject_type = 'person'
             AND t.subject_id = au.id
             AND t.closed_at IS NULL
             AND t.created_at < now() - interval '7 days'
        ) THEN 'our_fault'
        ELSE 'unknown'
      END
    )
  ), '[]'::jsonb) INTO v_didnt
    FROM keystone.app_user au
   WHERE au.tenant_id = p_tenant
     AND au.role IN ('adult_client', 'adolescent_client')
     AND au.lifecycle_status = 'lead'
     AND au.created_at::date <@ p_range;

  -- Get enough_data from helper
  v_enough_data := keystone.report_enough_data(p_tenant);

  -- Return the complete report object
  RETURN jsonb_build_object(
    'range', p_range::text,
    'compare', p_compare::text,
    'enough_data', v_enough_data,
    'enquiries', v_enquiries,
    'enquiries_compare', v_enquiries_compare,
    'became_clients', v_became_clients,
    'conversion_pct', v_conversion_pct,
    'days_to_first_session_median', v_days_to_first_session_median,
    'sources', v_sources,
    'didnt', v_didnt
  );
END
$$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- § B · GRANTS
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
GRANT EXECUTE ON FUNCTION keystone.report_found(uuid, daterange, daterange, uuid) TO app_rw;
REVOKE EXECUTE ON FUNCTION keystone.report_found(uuid, daterange, daterange, uuid) FROM PUBLIC;
-- (REHEARSAL FIX 25 Sep 2026: explicit COMMIT removed — the runner commits.)
-- Written, not applied.
