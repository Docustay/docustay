-- 0687 · Live screens, second batch (same message as 0686: tenant id + kind, no row data). Additive.
DO $m$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES ('keystone.document_ai_action','ai'), ('keystone.document_ai_job','ai'), ('keystone.embed_submission','documents'), ('keystone.docustay_license','billing'), ('keystone.docustay_install','billing'), ('keystone.custom_domain','email')) v(tbl, kind) LOOP
    IF to_regclass(r.tbl) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS ks_notify_change ON %s', r.tbl);
      EXECUTE format('CREATE TRIGGER ks_notify_change AFTER INSERT OR UPDATE OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION keystone.ks_notify_change(%L)', r.tbl, r.kind);
    END IF;
  END LOOP;
END $m$;
