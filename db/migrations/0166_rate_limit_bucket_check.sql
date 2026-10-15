-- 0166_rate_limit_bucket_check
-- Stage 5 task 5.2 · CT-009 · F477.
--
-- The bucket vocabulary is closed. A name the application cannot produce must not be storable.
-- The eleven names are src/http/rateLimit.mjs RATE_BUCKETS, in the same order. Ten are literal
-- `bucket: "…"` arguments in src/ (46 call sites); `api` is runTenantScoped's default parameter
-- (src/http/app.mjs) and is never written as a literal.
--
-- Two statements on purpose: NOT VALID takes a short lock and always succeeds; VALIDATE scans the
-- table and is the statement that fails loudly if a database holds a legacy bucket name.
-- No new table, so no new policy: the FORCED RLS from 0003 already covers keystone.rate_limit_window.

ALTER TABLE keystone.rate_limit_window
  ADD CONSTRAINT rate_limit_window_bucket_known
  CHECK (bucket IN (
    'api',
    'app',
    'documents',
    'engagements',
    'home',
    'list',
    'nav',
    'platform',
    'records',
    'settings',
    'write'
  ))
  NOT VALID;

ALTER TABLE keystone.rate_limit_window
  VALIDATE CONSTRAINT rate_limit_window_bucket_known;
