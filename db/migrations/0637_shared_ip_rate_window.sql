-- 0637 · PART 30 item 14 — A SHARED (Postgres) PER-ADDRESS LIMIT FOR THE ROUTES THAT MATTER MOST: sign-in, public signing, signed-copy download links, public verification.
-- The global per-IP limit stays in process (a limiter that asks the database about every request is an amplifier). Those four are low-volume and high-value to an attacker, and with two app
-- instances an in-process counter allows double the limit — so they also count here, shared by every instance.
-- ★ The address is stored only as a SHA-256 hash. Windows older than an hour are swept by the bump itself (1 call in 50), so the table never grows without bound.
-- ★ Row-level security FORCED, like every table; the one policy admits only the limiter's own function (it sets keystone.limiter for its own statement) — an application query cannot read or write the counters.
CREATE TABLE keystone.ip_rate_window (
  bucket       text        NOT NULL CHECK (bucket IN ('sign_in','public_signing','public_download','public_verify')),
  key_hash     text        NOT NULL CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  window_start timestamptz NOT NULL,
  count        integer     NOT NULL CHECK (count > 0),
  PRIMARY KEY (bucket, key_hash, window_start)
);
CREATE INDEX ip_rate_window_by_start ON keystone.ip_rate_window (window_start);
ALTER TABLE keystone.ip_rate_window ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.ip_rate_window FORCE  ROW LEVEL SECURITY;
CREATE POLICY limiter_only ON keystone.ip_rate_window USING (coalesce(current_setting('keystone.limiter', true), '') = 'on') WITH CHECK (coalesce(current_setting('keystone.limiter', true), '') = 'on');
GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.ip_rate_window TO app_rw;

CREATE FUNCTION keystone.bump_ip_rate_window(p_bucket text, p_key_hash text, p_window_start timestamptz) RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_count integer;
BEGIN
  -- on the limiter's own connection only, never inside a tenant transaction (the lock it would hold is the one this design avoids)
  IF coalesce(pg_catalog.current_setting('keystone.tenant_id', true), '') <> '' THEN
    RAISE EXCEPTION 'keystone.bump_ip_rate_window must run on a limiter connection (withLimiterConnection)' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  PERFORM pg_catalog.set_config('keystone.limiter', 'on', true);
  INSERT INTO keystone.ip_rate_window (bucket, key_hash, window_start, count) VALUES (p_bucket, p_key_hash, p_window_start, 1)
  ON CONFLICT (bucket, key_hash, window_start) DO UPDATE SET count = keystone.ip_rate_window.count + 1
  RETURNING count INTO v_count;
  IF pg_catalog.random() < 0.02 THEN
    DELETE FROM keystone.ip_rate_window WHERE window_start < p_window_start - interval '1 hour';
  END IF;
  RETURN v_count;
END $$;
GRANT EXECUTE ON FUNCTION keystone.bump_ip_rate_window(text, text, timestamptz) TO app_rw;
