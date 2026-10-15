-- ★★★ 07 §5 WORKER HEARTBEAT. The watcher runs inside the worker and cannot report the worker's own death
--     (watch.mjs:10-15). The worker writes a beat every 30 s; the APP serves its age at /healthz/worker; an
--     outside monitor (UptimeRobot) calls that address. Three processes, so no single death is silent.
-- ★★ app_worker keeps ZERO table rights (p21a_role_matrix): it beats through a SECURITY DEFINER function.
--    app_rw may only READ, so a web process cannot forge a beat and quiet its own alarm (0114's reasoning).
CREATE TABLE IF NOT EXISTS keystone_meta.worker_heartbeat (
  worker   text        PRIMARY KEY,
  beat_at  timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON keystone_meta.worker_heartbeat FROM PUBLIC;
GRANT SELECT ON keystone_meta.worker_heartbeat TO app_rw;

CREATE OR REPLACE FUNCTION keystone_meta.worker_beat(p_worker text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, keystone_meta AS $$
  INSERT INTO keystone_meta.worker_heartbeat (worker, beat_at) VALUES (p_worker, now())
  ON CONFLICT (worker) DO UPDATE SET beat_at = excluded.beat_at;
$$;
REVOKE ALL ON FUNCTION keystone_meta.worker_beat(text) FROM PUBLIC;
GRANT USAGE ON SCHEMA keystone_meta TO app_worker;
GRANT EXECUTE ON FUNCTION keystone_meta.worker_beat(text) TO app_worker;
