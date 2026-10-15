-- The wizard sends one structured brief (document type, agent kind) before any model call; the job keeps it so the worker writes with the right mindset and the screen can say who wrote it.
-- Additive and idempotent: a nullable column, no default, nothing reads it until the new draft path runs.
ALTER TABLE keystone.document_ai_job ADD COLUMN IF NOT EXISTS brief jsonb;
