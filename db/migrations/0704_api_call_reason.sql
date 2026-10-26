-- 0704 · THE API LOG SAYS WHY A KEY WAS REFUSED (Run 6, R2-8). Additive: one nullable column.
-- The caller still gets the same plain 401 for every credential failure (no oracle for a stranger); the workspace's own log row now carries a short reason code the owner can read.
ALTER TABLE keystone.api_call_log ADD COLUMN IF NOT EXISTS reason text;
DO $r6$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'keystone.api_call_log'::regclass AND conname = 'api_call_log_reason_short') THEN
    ALTER TABLE keystone.api_call_log ADD CONSTRAINT api_call_log_reason_short CHECK (reason IS NULL OR length(reason) <= 40);
  END IF;
END $r6$;
