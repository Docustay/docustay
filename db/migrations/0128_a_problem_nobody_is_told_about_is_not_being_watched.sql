-- ★★★ 07 §6 — ALERT STATE. Decides whether a health check's state is news: a new problem, a problem due a
--     repeat (at most every p_repeat_minutes), or a recovery. Stored so a worker restart does not re-alert.
--     app_worker writes only through this function (zero table rights, as 0127).
CREATE TABLE IF NOT EXISTS keystone_meta.alert_state (
  key           text        PRIMARY KEY,
  state         text        NOT NULL CHECK (state IN ('ok','problem','unknown')),
  last_sent_at  timestamptz,
  changed_at    timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON keystone_meta.alert_state FROM PUBLIC;
GRANT SELECT ON keystone_meta.alert_state TO app_rw;

CREATE OR REPLACE FUNCTION keystone_meta.alert_transition(p_key text, p_state text, p_repeat_minutes int)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, keystone_meta AS $$
DECLARE prev keystone_meta.alert_state%ROWTYPE;
BEGIN
  SELECT * INTO prev FROM keystone_meta.alert_state WHERE key = p_key FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO keystone_meta.alert_state (key, state, last_sent_at) VALUES
      (p_key, p_state, CASE WHEN p_state = 'problem' THEN now() END);
    RETURN CASE WHEN p_state = 'problem' THEN 'alert' ELSE 'quiet' END;
  END IF;
  IF p_state = 'problem' THEN
    IF prev.state <> 'problem' OR prev.last_sent_at IS NULL
       OR prev.last_sent_at < now() - make_interval(mins => p_repeat_minutes) THEN
      UPDATE keystone_meta.alert_state SET state = 'problem', last_sent_at = now(),
             changed_at = CASE WHEN prev.state <> 'problem' THEN now() ELSE prev.changed_at END
       WHERE key = p_key;
      RETURN 'alert';
    END IF;
    RETURN 'quiet';
  END IF;
  UPDATE keystone_meta.alert_state SET state = p_state, changed_at = now() WHERE key = p_key AND state <> p_state;
  RETURN CASE WHEN prev.state = 'problem' AND p_state = 'ok' THEN 'recovered' ELSE 'quiet' END;
END $$;
REVOKE ALL ON FUNCTION keystone_meta.alert_transition(text, text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone_meta.alert_transition(text, text, int) TO app_worker;
