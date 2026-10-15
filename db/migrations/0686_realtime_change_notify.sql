-- 0686 · Live screens (Final Push, 7 Oct 2026). Additive. Any change to a tenant's settings, templates, documents, people, teams, keys, webhooks or email posts ONE tiny message on the
-- Postgres channel `ks_change` — { t: tenant id, k: kind } and nothing else (no row data, so nothing private can leak through the channel). The app listens on that channel and tells
-- every open screen of that workspace which kind of thing changed; the screen reloads just that. Postgres folds identical messages inside one transaction into one.
CREATE OR REPLACE FUNCTION keystone.ks_notify_change() RETURNS trigger LANGUAGE plpgsql AS $f$
DECLARE tid uuid; kind text := TG_ARGV[0];
BEGIN
  IF TG_OP = 'DELETE' THEN tid := (to_jsonb(OLD) ->> 'tenant_id')::uuid; ELSE tid := (to_jsonb(NEW) ->> 'tenant_id')::uuid; END IF;
  IF kind = 'event' AND TG_OP <> 'INSERT' THEN RETURN NULL; END IF;
  IF kind = 'event' THEN   -- the event log tells us about things whose own table this role cannot reach (API keys live in keystone_auth)
    kind := CASE WHEN COALESCE(NEW.topic, '') LIKE 'developer.api_key%' THEN 'keys' WHEN COALESCE(NEW.topic, '') LIKE 'developer.webhook%' THEN 'webhooks' ELSE NULL END;
    IF kind IS NULL THEN RETURN NULL; END IF;
  END IF;
  IF tid IS NOT NULL THEN PERFORM pg_notify('ks_change', json_build_object('t', tid, 'k', kind)::text); END IF;
  RETURN NULL;
END $f$;

DO $m$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('keystone.document_setting','settings'), ('keystone.tenant_setting','settings'),
    ('keystone.document_template','templates'), ('keystone.document_category','templates'), ('keystone.document_clause','templates'), ('keystone.document_type','templates'),
    ('keystone.document_instance','documents'), ('keystone.document_party','documents'), ('keystone.document_field_value','documents'), ('keystone.document_send_approval','documents'), ('keystone.document_audit_event','documents'),
    ('keystone.document_contact','people'),
    ('keystone.document_play','plays'), ('keystone.document_play_version','plays'), ('keystone.document_playbook','plays'),
    ('keystone.document_team','team'), ('keystone.document_team_member','team'), ('keystone.app_user','team'), ('keystone.invite','team'),
    ('keystone.event','event'), ('keystone.document_key_policy','keys'),
    ('keystone.webhook_endpoint','webhooks'), ('keystone.webhook_delivery','webhooks'),
    ('keystone.document_email_log','email'), ('keystone.document_email_guard','email'), ('keystone.mail_domain','email'), ('keystone.email_template','email'), ('keystone.mail_identity','email'),
    ('keystone.api_call_log','apilog'),
    ('keystone.entitlement','billing'), ('keystone.workbench_subscription','billing'), ('keystone.payment','billing'), ('keystone.invoice','billing')
  ) v(tbl, kind) LOOP
    IF to_regclass(r.tbl) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS ks_notify_change ON %s', r.tbl);
      EXECUTE format('CREATE TRIGGER ks_notify_change AFTER INSERT OR UPDATE OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION keystone.ks_notify_change(%L)', r.tbl, r.kind);
    END IF;
  END LOOP;
END $m$;
