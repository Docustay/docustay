-- 0809 (26 Oct 2026, Ty): after a Docustay workspace is renamed (Settings, Branding writes the setting practice.name) the /verify page, the invite page and several emails still read keystone.tenant.name and showed the old name.
-- ONE TRUTH for a Docustay workspace: whenever practice.name is written, keystone.tenant.name follows it, so every reader (pages, emails, PDFs, certificates, the typed name that confirms a deletion) shows the current name. Only Docustay workspaces: a Mainstay organisation's display-name override stays a display setting.
CREATE OR REPLACE FUNCTION keystone.sync_workspace_name() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE v text;
BEGIN
  IF NEW.key <> 'practice.name' THEN RETURN NEW; END IF;
  v := btrim(coalesce(NEW.value #>> '{}', ''));
  IF v = '' THEN RETURN NEW; END IF;
  UPDATE keystone.tenant SET name = left(v, 120) WHERE id = NEW.tenant_id AND product = 'docustay' AND name IS DISTINCT FROM left(v, 120);
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION keystone.sync_workspace_name() FROM PUBLIC;
DROP TRIGGER IF EXISTS tenant_setting_workspace_name ON keystone.tenant_setting;
CREATE TRIGGER tenant_setting_workspace_name AFTER INSERT OR UPDATE OF value ON keystone.tenant_setting FOR EACH ROW WHEN (NEW.key = 'practice.name') EXECUTE FUNCTION keystone.sync_workspace_name();
-- the ones already renamed
UPDATE keystone.tenant t SET name = left(btrim(s.value #>> '{}'), 120) FROM keystone.tenant_setting s
 WHERE s.tenant_id = t.id AND s.key = 'practice.name' AND t.product = 'docustay' AND btrim(coalesce(s.value #>> '{}', '')) <> '' AND t.name IS DISTINCT FROM left(btrim(s.value #>> '{}'), 120);
