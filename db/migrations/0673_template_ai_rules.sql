-- 0673 · House rules for the assistant on ONE template (Ty, 7 Oct 2026). Additive. Plain sentences the writer follows when it works on this template or a document made from it;
-- they sit beside the workspace rules (ai.house_rules) and, like them, cannot make it send, charge or sign.
ALTER TABLE keystone.document_template
  ADD COLUMN IF NOT EXISTS ai_rules text NULL CHECK (ai_rules IS NULL OR char_length(ai_rules) <= 1500);
