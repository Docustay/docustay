-- 0057 — RUN. P20.5 (three grant tables) · P20.6 (run_reading + the clock) · P20.6a (run_metric).
-- ADDENDUM 4 §A4.5, which it titles ``0021``; see 0055's header for why the NUMBER in ADDENDUM 4 is a
-- position in a plan and not an instruction.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ WHY `account_grant` ALONE CANNOT WORK. A Google consent is granted by a GOOGLE ACCOUNT, not by
--     one of ours, and it covers a SET of resources discovered afterwards. One consent serves many of
--     our accounts; one of our accounts routinely needs TWO consents — Ads from the agency's manager
--     login, Business Profile from the owner's personal login, because GBP ownership does not
--     transfer. And there was nowhere to put the Google-side identifier at all: without the site URL,
--     the GA4 property, the Ads customer id or the GBP location, the worker cannot build ONE request
--     URL. The schema as ADD3-2 gave it cannot run a single pull.
--   ★★ AND DUPLICATING THE TOKEN PER ACCOUNT IS ACTIVELY DANGEROUS. [DOC
--      developers.google.com/identity/protocols/oauth2] Google caps a Google Account at 100 live
--      refresh tokens per OAuth client ID and EVICTS THE OLDEST WITHOUT WARNING — so duplication
--      kills the longest-running, most-billed client first. That is not a tidiness argument.
--   ★ THEREFORE THREE TABLES: `google_identity` (one consent, one token) · `google_resource` (what it
--     can see, DISCOVERED) · `account_grant` (a BINDING). The last keeps its name because the phases
--     use it; its SHAPE is a binding.
--
-- ★★★ AND THE RECURRING PRINCIPLE ACROSS ALL SIX TABLES: THREE DIFFERENT FACTS, THREE DIFFERENT
--     COLUMNS, BECAUSE ONE COLUMN MAKES THE SCREEN LIE.
--       · Google refusing the token      → google_identity.grant_state
--       · Google dropping the property    → google_resource.disappeared_at
--       · WE revoked the binding          → account_grant.revoked_at
--     Collapsing any two loses the ability to say which happened, and "which happened" is the whole
--     content of the Run screen.

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 1 · google_identity — ONE CONSENT, ONE REFRESH TOKEN, ONE ROW.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE keystone.google_identity (
  id uuid PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,

  -- ★★ THE OIDC `sub`, NOT THE EMAIL. It is stable and never reused, and it is the axis the 100-token
  --    cap is enforced on. An email can be renamed; keying on it would silently split one identity in
  --    two and walk straight into the eviction this table exists to avoid.
  google_subject text NOT NULL,
  google_email text NOT NULL,          -- ★ for the screen only; never a key

  -- ★ Stored SORTED, so the UNIQUE below means something: {a,b} and {b,a} are the same consent, and a
  --   unique over an unsorted array would let the same grant exist twice.
  scopes text[] NOT NULL CONSTRAINT google_identity_scopes_nonempty CHECK (cardinality(scopes) > 0),

  -- ★★ THE ENVELOPE RECORD ITSELF — there is no second store to "ref".
  refresh_envelope jsonb NOT NULL,
  -- ★★★ P19.7a. `envelope.mjs` returns `v:1`, which is a FORMAT version, not a KEY version. Without
  --     this column the advertised KEK rotation is unperformable: you cannot tell which rows are
  --     still wrapped under the old key. Same pattern as 0047's webhook_endpoint.
  kek_version smallint NOT NULL DEFAULT 1 CONSTRAINT google_identity_kek_version_check
    CHECK (kek_version >= 1),
  -- ★ `envelope.fingerprint` is a sha256 prefix of the PLAINTEXT, so it is stable across tenants and
  --   is therefore the correct key for "have we stored this same token twice under two identities?" —
  --   which is exactly how a 100-token eviction sneaks up.
  token_fingerprint text NOT NULL,

  granted_at timestamptz NOT NULL DEFAULT now(),
  last_refresh_ok_at timestamptz,
  last_refresh_try_at timestamptz,

  -- ★★★ `grant_state` MAY NEVER SAY "revoked", AND THIS IS THE MOST IMPORTANT WORD IN THE MIGRATION.
  --     [DOC] `invalid_grant` covers AT LEAST SIX causes: the user revoked · six months idle · the
  --     7-day expiry that applies while publishing status is Testing · the 100-token eviction · a
  --     Workspace admin restricting the service · a Google security heuristic. **The only claim true
  --     of all six is `reconsent_required`.** Saying "revoked" would tell an operator to go argue with
  --     a client who did nothing.
  grant_state text NOT NULL DEFAULT 'usable' CONSTRAINT google_identity_grant_state_check
    CHECK (grant_state IN ('usable','reconsent_required','withdrawn')),
  grant_error text,                     -- ★ verbatim `error_description`, NEVER parsed
  grant_failed_at timestamptz,
  withdrawn_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, google_subject, scopes),

  CONSTRAINT google_identity_state_shape CHECK (
    (grant_state = 'usable'             AND grant_failed_at IS NULL     AND withdrawn_at IS NULL) OR
    (grant_state = 'reconsent_required' AND grant_failed_at IS NOT NULL AND withdrawn_at IS NULL) OR
    (grant_state = 'withdrawn'          AND withdrawn_at IS NOT NULL))
);

-- ★★ `purpose` IS DELIBERATELY ABSENT AS A COLUMN. `envelope.mjs:92-95` requires `tenantId` and
--    `purpose` to come from the CALLER'S CONTEXT, never from the stored record — reading them back
--    makes the AAD self-certifying and therefore useless, because an attacker who moved the row would
--    move the claimed tenant with it. Callers derive purpose='google_refresh_token' from the fact
--    that this is THIS table.

CREATE INDEX google_identity_fingerprint ON keystone.google_identity (token_fingerprint);
CREATE INDEX google_identity_due ON keystone.google_identity (tenant_id, last_refresh_try_at)
  WHERE grant_state = 'usable';

CREATE TRIGGER google_identity_touch BEFORE UPDATE ON keystone.google_identity
  FOR EACH ROW EXECUTE FUNCTION keystone.touch_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 2 · google_resource — WHAT THAT IDENTITY CAN ACTUALLY SEE. DISCOVERED, NEVER TYPED IN.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE keystone.google_resource (
  id uuid PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  identity_id uuid NOT NULL REFERENCES keystone.google_identity(id) ON DELETE CASCADE,

  service text NOT NULL CONSTRAINT google_resource_service_check
    CHECK (service IN ('search_console','google_ads','analytics','business_profile')),
  external_id text NOT NULL,
  display_name text,

  -- ★ ADS ONLY — the manager CID sent as the `login-customer-id` header. Without it, an account
  --   reachable only through an MCC is unreachable, and the failure is a 403 that reads like a
  --   permissions problem rather than a missing header.
  login_customer_id text,
  -- ★ GBP ONLY — reviews and posts live under `accounts/{a}/locations/{l}` on the LEGACY v4 host, so
  --   the parent is required to build the path at all.
  parent_account_id text,

  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  -- ★★★ THE DISCRIMINATOR FOR "GRANT VALID BUT THE PROPERTY WAS REMOVED". The token still refreshes
  --     and this resource simply stops coming back from discovery. ABSENCE OF A RE-SIGHTING IS THE
  --     SIGNAL — which is why discovery must run on a cadence, not once at connect time.
  disappeared_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- ★★ FOUR SERVICES, FOUR IDENTIFIER SHAPES, MADE UNREPRESENTABLE RATHER THAN MERELY DISCOURAGED.
  --    A malformed property id otherwise fails at 3am in a worker log, which is precisely the
  --    silent-failure class this project keeps meeting.
  CONSTRAINT google_resource_id_shape CHECK (
    (service = 'search_console'   AND (external_id LIKE 'sc-domain:%' OR external_id LIKE 'http%')) OR
    (service = 'analytics'        AND external_id ~ '^properties/[0-9]+$') OR
    (service = 'google_ads'       AND external_id ~ '^[0-9]{10}$') OR
    (service = 'business_profile' AND external_id ~ '^locations/[0-9]+$'
                                  AND parent_account_id IS NOT NULL)),

  UNIQUE (tenant_id, identity_id, service, external_id)
);

CREATE INDEX google_resource_live ON keystone.google_resource (tenant_id, identity_id)
  WHERE disappeared_at IS NULL;

CREATE TRIGGER google_resource_touch BEFORE UPDATE ON keystone.google_resource
  FOR EACH ROW EXECUTE FUNCTION keystone.touch_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 3 · account_grant — A BINDING. The name is kept because the phases use it.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE keystone.account_grant (
  id uuid PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  account_id uuid NOT NULL REFERENCES keystone.account(id) ON DELETE CASCADE,
  -- ★ RESTRICT: deleting a resource must not silently unbind every account that was reading it.
  resource_id uuid NOT NULL REFERENCES keystone.google_resource(id) ON DELETE RESTRICT,
  service text NOT NULL CONSTRAINT account_grant_service_check
    CHECK (service IN ('search_console','google_ads','analytics','business_profile')),

  granted_at timestamptz NOT NULL DEFAULT now(),
  -- ★★ `revoked_at` HERE MEANS **WE** REVOKED IT. Google refusing the token is
  --    google_identity.grant_state; Google dropping the property is google_resource.disappeared_at.
  revoked_at timestamptz,
  revoked_reason text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, account_id, resource_id),
  CONSTRAINT account_grant_revoked_shape
    CHECK ((revoked_at IS NULL AND revoked_reason IS NULL) OR revoked_at IS NOT NULL)
);

-- ★★ THE QUERY THAT DECIDES BILLING (P20.9): is there a live grant for this account and service?
CREATE INDEX account_grant_live ON keystone.account_grant (tenant_id, account_id, service)
  WHERE revoked_at IS NULL;

CREATE TRIGGER account_grant_touch BEFORE UPDATE ON keystone.account_grant
  FOR EACH ROW EXECUTE FUNCTION keystone.touch_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 4 · run_reading — THE CACHE, AND THE EVIDENCE THAT WE READ AT ALL. P20.6.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE keystone.run_reading (
  id uuid PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  account_id uuid NOT NULL REFERENCES keystone.account(id) ON DELETE CASCADE,
  -- ★ RESTRICT: deleting a resource must not delete the evidence that we once read it.
  resource_id uuid NOT NULL REFERENCES keystone.google_resource(id) ON DELETE RESTRICT,
  service text NOT NULL CONSTRAINT run_reading_service_check
    CHECK (service IN ('search_console','google_ads','analytics','business_profile','monitoring')),

  -- ★★ ADD3-2 HAD NO `item`, and without it "queries" and "pages" (both Search Console) and
  --    "reviews", "posts" and "hours" (THREE DIFFERENT HOSTS at TWO API versions) all collide — so
  --    "the newest row for this service" returns whichever ran last, which is a chart that changes
  --    meaning depending on scheduling luck.
  item text NOT NULL CONSTRAINT run_reading_item_shape CHECK (item ~ '^[a-z][a-z0-9_]*$'),

  fetched_at timestamptz NOT NULL DEFAULT now(),
  ok boolean NOT NULL,

  -- ★★★ `ok` IS TWO PROBES COLLAPSED INTO ONE BIT, AND THAT IS WHY THE SCREEN WOULD LIE (P20.9a).
  --     These four columns are what make the difference sayable.
  failure_class text CONSTRAINT run_reading_failure_class_check
    CHECK (failure_class IN ('grant_unusable','resource_forbidden','rate_limited','quota_exhausted',
                             'provider_error','malformed_response','internal')),
  http_status integer CONSTRAINT run_reading_http_status_check
    CHECK (http_status BETWEEN 100 AND 599),
  error text,
  provider_response jsonb,             -- ★ the provider's own words, verbatim, never parsed
  duration_ms integer CONSTRAINT run_reading_duration_check CHECK (duration_ms >= 0),

  payload jsonb,
  -- ★★ `payload_bytes` AND `payload_pruned_at` EXIST SO RETENTION IS A FACT, NOT AN INFERENCE.
  --    Without them, a NULL payload on an old ok=true row and a NULL payload on a fresh ok=false row
  --    are indistinguishable — the same wrong-place-not-wrong-value error this project has already
  --    made twice.
  payload_bytes integer CONSTRAINT run_reading_payload_bytes_check CHECK (payload_bytes >= 0),
  payload_pruned_at timestamptz,

  -- ★★ `row_count` EXISTS BECAUSE ok=true WITH ZERO ROWS IS NOT A FAILURE AND A CHART CANNOT TELL
  --    THE DIFFERENCE. A brand-new GA4 property renders identically to a broken pull.
  row_count integer CONSTRAINT run_reading_row_count_check CHECK (row_count >= 0),

  CONSTRAINT run_reading_ok_shape CHECK (
    (ok = true  AND failure_class IS NULL     AND error IS NULL) OR
    (ok = false AND failure_class IS NOT NULL AND payload IS NULL)),
  -- ★ A pruned row must be a SUCCESS with its bytes gone. Pruning a failure would destroy the only
  --   record of what went wrong, and a "pruned" row that still has a payload is a lie about retention.
  CONSTRAINT run_reading_prune_shape CHECK (
    payload_pruned_at IS NULL OR (payload IS NULL AND ok = true))
);

CREATE INDEX run_reading_newest
  ON keystone.run_reading (tenant_id, account_id, service, item, fetched_at DESC);
CREATE INDEX run_reading_failures ON keystone.run_reading (tenant_id, account_id, service,
  fetched_at DESC) WHERE ok = false;
CREATE INDEX run_reading_prunable ON keystone.run_reading (fetched_at) WHERE payload IS NOT NULL;
-- ★★ NO GIN ON payload, DELIBERATELY. Nothing queries into it: the screen reads the newest row and
--    the reports read run_metric. A GIN here would cost more than the table it indexes.

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 5 · run_metric — P20.6a. THE TABLE ADD3-3 NEEDS AND ADD3-2 DID NOT PROVIDE.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ ADD3-3 says the monthly Run report is "a rendering of run_reading". Rendering a month means
--     detoasting ~120 jsonb blobs per account AT REQUEST TIME; a 12-month trend is ~1,460. THAT IS
--     NOT A REPORT, IT IS A SCAN. A narrow typed row of ~50 bytes written AT INGEST is what the
--     reports and charts read.
CREATE TABLE keystone.run_metric (
  id uuid PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  account_id uuid NOT NULL REFERENCES keystone.account(id) ON DELETE CASCADE,
  service text NOT NULL CONSTRAINT run_metric_service_check
    CHECK (service IN ('search_console','google_ads','analytics','business_profile','monitoring')),
  metric text NOT NULL CONSTRAINT run_metric_metric_shape CHECK (metric ~ '^[a-z][a-z0-9_]*$'),
  day date NOT NULL,
  value numeric NOT NULL,
  -- ★ WHICH PULL PRODUCED IT, so a wrong number is traceable to the response that carried it.
  --   RESTRICT, because that traceability is the point.
  reading_id uuid NOT NULL REFERENCES keystone.run_reading(id) ON DELETE RESTRICT,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- ★★ THE UPSERT KEY. Google RESTATES the last 2–4 days (GSC final-vs-preliminary, GA4's 24–48h
  --    processing window, Ads' late-arriving conversions). A re-pull must CORRECT the day, not append
  --    a second one — an insert-only table double-counts every re-pull SILENTLY, and a chart that is
  --    quietly 2× is worse than a chart that is blank.
  UNIQUE (tenant_id, account_id, service, metric, day)
);

CREATE INDEX run_metric_series ON keystone.run_metric (tenant_id, account_id, service, metric, day);

CREATE TRIGGER run_metric_touch BEFORE UPDATE ON keystone.run_metric
  FOR EACH ROW EXECUTE FUNCTION keystone.touch_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 6 · run_schedule_item — THE CLOCK, AND THE BILLING STATE. P20.6 / P20.9 / P20.9a.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE keystone.run_schedule_item (
  id uuid PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  account_id uuid NOT NULL REFERENCES keystone.account(id) ON DELETE CASCADE,
  service text NOT NULL CONSTRAINT run_schedule_item_service_check
    CHECK (service IN ('search_console','google_ads','analytics','business_profile','monitoring',
                       'access','reports')),
  item text NOT NULL CONSTRAINT run_schedule_item_item_shape CHECK (item ~ '^[a-z][a-z0-9_]*$'),
  cadence text NOT NULL CONSTRAINT run_schedule_item_cadence_check
    CHECK (cadence IN ('hourly','daily','weekly','monthly','quarterly')),
  mechanism text NOT NULL CONSTRAINT run_schedule_item_mechanism_check
    CHECK (mechanism IN ('api','webhook','manual')),

  last_run_at timestamptz,
  -- ★★★ ADD3-2 HAD ONLY `last_run_at`, AND YOU CANNOT SCHEDULE FROM IT. Change the cadence and every
  --     item keeps the old rhythm until it next fires; a worker outage makes "overdue" unqueryable.
  --     THE CLOCK HAS TO BE A COLUMN.
  next_run_at timestamptz NOT NULL DEFAULT now(),

  -- ★★★ FIVE STATES, NOT ONE BOOLEAN, OR THE SCREEN WILL LIE (P20.9a). Three distinct
  --     not-deliverable causes, because "we never had access", "Google stopped accepting the token"
  --     and "the property was removed" need three different human actions.
  state text NOT NULL DEFAULT 'pending' CONSTRAINT run_schedule_item_state_check
    CHECK (state IN ('pending','healthy','degraded','not_deliverable_no_grant',
                     'not_deliverable_grant_lost','not_deliverable_resource_lost','paused')),
  blocked_reason text,

  -- ★★ CONSECUTIVE, NOT TOTAL. The threshold is what separates a transient outage from a real loss,
  --    and without a counter the two are indistinguishable at the instant of the first failure —
  --    which is the only instant the screen ever asks.
  consecutive_failures integer NOT NULL DEFAULT 0
    CONSTRAINT run_schedule_item_failures_check CHECK (consecutive_failures >= 0),

  -- ★ SET NULL: the schedule item outlives any single reading. P20.8 degrades to the last good
  --   reading WITH ITS AGE SHOWN, and a cascade here would delete the thing being degraded to.
  last_ok_reading_id uuid REFERENCES keystone.run_reading(id) ON DELETE SET NULL,

  -- ★★★ "BILLED AND NOT DELIVERABLE" POINTS AT THE BILLING ROW AND AT THE TASK IT RAISED. Without
  --     these two it is a WORD ON A SCREEN that nothing can act on, and §M2's "emits into nothing"
  --     failure repeats verbatim.
  line_item_id uuid REFERENCES keystone.line_item(id) ON DELETE SET NULL,
  blocking_task_id uuid REFERENCES keystone.task(id) ON DELETE SET NULL,
  not_deliverable_since timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, account_id, service, item),
  CONSTRAINT run_schedule_item_blocked_shape CHECK (
    (state LIKE 'not_deliverable%' AND blocked_reason IS NOT NULL
                                   AND not_deliverable_since IS NOT NULL) OR
    (state NOT LIKE 'not_deliverable%' AND not_deliverable_since IS NULL))
);

CREATE INDEX run_schedule_due ON keystone.run_schedule_item (tenant_id, next_run_at)
  WHERE state IN ('pending','healthy','degraded');
CREATE INDEX run_schedule_blocked ON keystone.run_schedule_item (tenant_id, account_id)
  WHERE state LIKE 'not_deliverable%';

CREATE TRIGGER run_schedule_item_touch BEFORE UPDATE ON keystone.run_schedule_item
  FOR EACH ROW EXECUTE FUNCTION keystone.touch_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- RLS — ENABLE **AND FORCE**, ALL THREE POLICIES, ON ALL SIX. ADDENDUM 4's ★: 0016 omits
-- `tenant_update` on all five of its tables while 0001 and 0003 have it, and says INCLUDE IT.
-- Every one of these six is UPDATEd on its hot path (a refresh, a re-sighting, a revoke, a prune, an
-- upsert, a state change), so a missing tenant_update would expose all six where it matters most.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['google_identity','google_resource','account_grant',
                           'run_reading','run_metric','run_schedule_item']
  LOOP
    EXECUTE format('ALTER TABLE keystone.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE keystone.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON keystone.%I USING (tenant_id = keystone.current_tenant_id())', t);
    EXECUTE format(
      'CREATE POLICY tenant_insert ON keystone.%I FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id())', t);
    EXECUTE format(
      'CREATE POLICY tenant_update ON keystone.%I FOR UPDATE USING (tenant_id = keystone.current_tenant_id()) WITH CHECK (tenant_id = keystone.require_tenant_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.%I TO app_rw', t);
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
COMMENT ON TABLE keystone.google_identity IS
  'P20.5 — ONE Google consent, ONE refresh token, ONE row. ★ Keyed on the OIDC sub, not the email: '
  'the sub is stable and never reused, and it is the axis Google''s 100-live-refresh-token cap is '
  'enforced on. ★★ Duplicating a token per account would evict the OLDEST without warning — killing '
  'the longest-running, most-billed client first. That is why this table is separate from the binding.';

COMMENT ON COLUMN keystone.google_identity.grant_state IS
  'usable · reconsent_required · withdrawn. ★★★ IT MAY NEVER SAY "revoked": invalid_grant covers at '
  'least SIX causes (user revoked, six months idle, the 7-day Testing expiry, the 100-token eviction, '
  'a Workspace admin restriction, a Google security heuristic) and the only claim true of all six is '
  'reconsent_required. Saying "revoked" sends an operator to argue with a client who did nothing.';

COMMENT ON COLUMN keystone.google_resource.disappeared_at IS
  'P20.5 — the discriminator for "the grant is fine but the property was removed". The token still '
  'refreshes; this resource simply stops coming back from discovery. ★ ABSENCE OF A RE-SIGHTING IS '
  'THE SIGNAL, which is why discovery runs on a cadence rather than once at connect time.';

COMMENT ON COLUMN keystone.account_grant.revoked_at IS
  'P20.5 — ★ this means **WE** revoked the binding. Google refusing the token is '
  'google_identity.grant_state; Google dropping the property is google_resource.disappeared_at. '
  'Three different facts, three different columns, because one column makes the screen lie.';

COMMENT ON COLUMN keystone.run_reading.item IS
  'P20.6 — ADD3-2 had no item column, so "queries" and "pages" (both Search Console) and "reviews", '
  '"posts" and "hours" (three different hosts at two API versions) all collided, and "the newest row '
  'for this service" returned whichever ran last — a chart whose meaning depended on scheduling luck.';

COMMENT ON COLUMN keystone.run_reading.row_count IS
  'P20.6 — exists because ok=true WITH ZERO ROWS IS NOT A FAILURE and a chart cannot tell the '
  'difference: a brand-new GA4 property renders identically to a broken pull.';

COMMENT ON TABLE keystone.run_reading IS
  'P20.6 — the cache AND the evidence that we read at all. ★★★ RETENTION: NULL the payload at 90 '
  'days and KEEP THE ROW FOREVER. NEVER DELETE a run_reading row — deleting it destroys exactly the '
  'missing-row-vs-failed-row distinction the table exists for. ★ Range-partition by month on '
  'fetched_at above ~200 accounts so the prune is a DETACH rather than a multi-gigabyte UPDATE '
  '[INFER, ~200 KB/reading blended: 50 accounts ~15 GB/yr, 200 ~58 GB/yr, 1,000 ~292 GB/yr].';

COMMENT ON TABLE keystone.run_metric IS
  'P20.6a — the narrow typed series the reports and charts read, written AT INGEST. ★ ADD3-3 called '
  'the monthly report "a rendering of run_reading", but that means detoasting ~120 jsonb blobs per '
  'account per month at request time (~1,460 for a 12-month trend) — a scan, not a report. '
  '★★ UPSERT on (tenant, account, service, metric, day): Google RESTATES the last 2-4 days, so a '
  're-pull must CORRECT the day. Insert-only would double-count every re-pull silently.';

COMMENT ON COLUMN keystone.run_schedule_item.next_run_at IS
  'P20.6 — ★★★ ADD3-2 had only last_run_at and you cannot schedule from it: change the cadence and '
  'every item keeps the old rhythm until it next fires, and a worker outage makes "overdue" '
  'unqueryable. The clock has to be a column.';

COMMENT ON COLUMN keystone.run_schedule_item.state IS
  'P20.9a — FIVE states plus paused, not one boolean. ★ THREE distinct not_deliverable causes because '
  '"we never had access", "Google stopped accepting the token" and "the property was removed" need '
  'three different human actions. ★★ `degraded` exists so ONE 503 cannot flip an account to '
  'not-deliverable: a checker that cries wolf is worse than none.';

COMMENT ON COLUMN keystone.run_schedule_item.consecutive_failures IS
  'CONSECUTIVE, not total. ★ The threshold is what separates a transient outage from a real loss, and '
  'without a counter the two are indistinguishable at the instant of the first failure — which is the '
  'only instant the screen ever asks.';

COMMENT ON COLUMN keystone.run_schedule_item.line_item_id IS
  'P20.9 — ★★★ "billed and not deliverable" must point at the BILLING ROW (and blocking_task_id at '
  'the TASK it raised). Without them it is a word on a screen that nothing can act on, and §M2''s '
  '"emits into nothing" failure repeats verbatim.';
