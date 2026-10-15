SET LOCAL ROLE auth_owner;
CREATE TABLE keystone_auth.operator_prompt_dismissal (
  id                uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  operator_grant_id uuid        NOT NULL,               -- no FK: operator_grant is deny_all (0184:61-63), same as operator_audit_entry
  prompt_key        text        NOT NULL CHECK (prompt_key ~ '^[a-z][a-z0-9_]*$'),
  subject_tenant_id uuid        NULL REFERENCES keystone.tenant(id) ON DELETE CASCADE,  -- which practice the prompt was about; NULL for a prompt about nothing in particular
  dismissed_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX operator_prompt_dismissal_lookup
  ON keystone_auth.operator_prompt_dismissal (operator_grant_id, prompt_key, subject_tenant_id, dismissed_at DESC);
ALTER TABLE keystone_auth.operator_prompt_dismissal ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_all ON keystone_auth.operator_prompt_dismissal USING (false) WITH CHECK (false);
-- No GRANT to app_rw or anyone: reached ONLY through the two definers below (0227's rule, verbatim).

CREATE FUNCTION keystone.dismiss_platform_prompt(p_grant_id uuid, p_key text, p_subject_tenant_id uuid)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE new_id uuid;
BEGIN
  IF NOT keystone.caller_is_platform() THEN
    RAISE EXCEPTION 'only a platform operator may dismiss a platform prompt' USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO keystone_auth.operator_prompt_dismissal (operator_grant_id, prompt_key, subject_tenant_id)
  VALUES (p_grant_id, p_key, p_subject_tenant_id) RETURNING id INTO new_id;
  RETURN new_id;
END $$;

CREATE FUNCTION keystone.platform_list_prompt_dismissals(p_grant_id uuid, p_since timestamptz)
RETURNS TABLE (prompt_key text, subject_tenant_id uuid, dismissed_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT d.prompt_key, d.subject_tenant_id, d.dismissed_at
    FROM keystone_auth.operator_prompt_dismissal d
   WHERE keystone.caller_is_platform()
     AND d.operator_grant_id = p_grant_id
     AND d.dismissed_at >= p_since
$$;

REVOKE ALL ON FUNCTION keystone.dismiss_platform_prompt(uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION keystone.platform_list_prompt_dismissals(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.dismiss_platform_prompt(uuid, text, uuid) TO app_rw;
GRANT EXECUTE ON FUNCTION keystone.platform_list_prompt_dismissals(uuid, timestamptz) TO app_rw;
SET LOCAL ROLE app_owner;
-- self-checks (0363:93-121 shape): both functions owned by auth_owner, prosecdef, proacl NOT NULL,
-- search_path set; the table has RLS enabled with a deny_all policy; app_rw holds NO table
-- privilege on it — positive control in the same block: app_rw HAS EXECUTE on both functions.
