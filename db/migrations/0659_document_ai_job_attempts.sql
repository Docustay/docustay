-- B8 (AI reliability): how many times a worker has claimed an AI job, so a job whose worker died mid-draft is put back in the queue a few times and then failed in plain words, never left "running" forever. Additive.
ALTER TABLE keystone.document_ai_job ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
