-- 0645 · PART 31 FOLLOW-UP — "Suggest a better translation". A person reading Docustay in another language can propose a better sentence from any screen, the signing page or the language menu. The rows live in the PLATFORM organisation (like docustay_install) and only the named Docustay viewers
-- (`keystone.docustay_may_view()`, the setting `platform.docustay_viewers`) can read or review them. The request address is never stored: `abuse_key` is a one-way hash of (address, day) used only to cap how many one address can send in a day.
CREATE TABLE IF NOT EXISTS keystone.docustay_translation_suggestion (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  lang           text        NOT NULL CHECK (lang ~ '^[a-z]{2}$'),
  surface        text        NOT NULL CHECK (surface IN ('app','signing','language_menu','other')),
  source_key     text        NOT NULL CHECK (char_length(source_key) BETWEEN 1 AND 1000),
  current_text   text        NOT NULL CHECK (char_length(current_text) <= 2000),
  suggested_text text        NOT NULL CHECK (char_length(suggested_text) BETWEEN 1 AND 2000),
  note           text        CHECK (note IS NULL OR char_length(note) <= 1000),
  email          text        CHECK (email IS NULL OR char_length(email) <= 254),
  fingerprint    text        NOT NULL,
  abuse_key      text        NOT NULL,
  status         text        NOT NULL DEFAULT 'new' CHECK (status IN ('new','approved','rejected','applied')),
  review_note    text        CHECK (review_note IS NULL OR char_length(review_note) <= 1000),
  reviewed_by    uuid        REFERENCES keystone.app_user(id) ON DELETE SET NULL,
  reviewed_at    timestamptz,
  applied_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT dts_one_per_text UNIQUE (tenant_id, fingerprint)
);
CREATE INDEX IF NOT EXISTS dts_queue ON keystone.docustay_translation_suggestion (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS dts_abuse ON keystone.docustay_translation_suggestion (tenant_id, abuse_key, created_at);
ALTER TABLE keystone.docustay_translation_suggestion ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.docustay_translation_suggestion FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON keystone.docustay_translation_suggestion;
CREATE POLICY tenant_isolation ON keystone.docustay_translation_suggestion USING (tenant_id = keystone.current_tenant_id()) WITH CHECK (tenant_id = keystone.current_tenant_id());
-- reading and reviewing is for the named viewers only; the public door only inserts (a request with no signed-in person is the public door: it can write, and the route never reads)
DROP POLICY IF EXISTS viewers_only ON keystone.docustay_translation_suggestion;
CREATE POLICY viewers_only ON keystone.docustay_translation_suggestion AS RESTRICTIVE FOR SELECT USING (keystone.docustay_may_view());
DROP POLICY IF EXISTS viewers_update ON keystone.docustay_translation_suggestion;
CREATE POLICY viewers_update ON keystone.docustay_translation_suggestion AS RESTRICTIVE FOR UPDATE USING (keystone.docustay_may_view()) WITH CHECK (keystone.docustay_may_view());
GRANT SELECT, INSERT, UPDATE ON keystone.docustay_translation_suggestion TO app_rw, app_worker;
