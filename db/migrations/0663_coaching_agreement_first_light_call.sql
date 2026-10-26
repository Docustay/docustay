-- 0663 — THE COACHING AGREEMENT SAYS "First Light Call" (Ty, 7 Oct 2026). The one sentence "A free discovery call is available." becomes "A free First Light Call is available."
-- As a NEW VERSION of the template, the way publish does it (src/documents/publish.mjs publishTemplate): a new row (version + 1, previous_version_id = the old row), published and active; the OLD row is retired, never edited
-- or deleted, so every agreement already sent or signed still points at the exact text it was signed under. Item requirements on the old version are repointed (publish does the same).
-- Idempotent: acts only while the ACTIVE version still contains the old sentence. Self-check: with the new sentence turned back into the old one, the two bodies are byte-identical — the rest of the agreement is word for word unchanged.
DO $$
DECLARE
  v_t uuid; old_t record; v_new uuid := keystone.uuid_generate_v7();
  v_old_s constant text := 'A free discovery call is available.';
  v_new_s constant text := 'A free First Light Call is available.';
  v_body jsonb; n int;
BEGIN
  SELECT keystone.resolve_tenant_by_slug('glc') INTO v_t;
  IF v_t IS NULL THEN RETURN; END IF;
  PERFORM set_config('keystone.tenant_id', v_t::text, true);
  SELECT * INTO old_t FROM keystone.document_template WHERE tenant_id = v_t AND name = 'Coaching Agreement' AND active ORDER BY version DESC LIMIT 1;
  IF NOT FOUND OR position(v_old_s IN old_t.body::text) = 0 THEN RETURN; END IF;
  n := (length(old_t.body::text) - length(replace(old_t.body::text, v_old_s, ''))) / length(v_old_s);
  IF n <> 1 THEN RAISE EXCEPTION '0663: expected exactly one "%" in the Coaching Agreement, found %', v_old_s, n; END IF;
  v_body := replace(old_t.body::text, v_old_s, v_new_s)::jsonb;
  IF replace(v_body::text, v_new_s, v_old_s) <> old_t.body::text THEN RAISE EXCEPTION '0663: the new body differs from the old one by more than the one sentence'; END IF;

  CREATE TEMP TABLE _tpl ON COMMIT DROP AS SELECT * FROM keystone.document_template WHERE id = old_t.id;
  UPDATE _tpl SET id = v_new, version = old_t.version + 1, body = v_body, previous_version_id = old_t.id, published_at = now(), retired_at = NULL, active = true,
                  self_serve_enabled = false, self_serve_slug = NULL, created_at = now(), updated_at = now(),
                  change_note = 'The discovery call is now called the First Light Call.';
  UPDATE keystone.document_template SET active = false, retired_at = now(), self_serve_enabled = false, self_serve_slug = NULL, updated_at = now() WHERE id = old_t.id;
  INSERT INTO keystone.document_template SELECT * FROM _tpl;
  UPDATE keystone.item_agreement_requirement SET template_id = v_new WHERE tenant_id = v_t AND template_id = old_t.id;
END $$;
