-- 0529 — D7 (RECONCILE de-code, 27 Sep 2026): phone verification via Twilio Verify, OFF by default
-- practice-wide, with a per-template override. Same tri-state pattern requiresParentUnder18 already
-- uses on document_template (0417) — NULL means "follow the practice default", so a template can opt
-- OUT of a practice's ON default as well as opt IN to it.
ALTER TABLE keystone.document_template
  ADD COLUMN requires_phone_verification boolean NULL;
