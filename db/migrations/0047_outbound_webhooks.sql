-- 0047 — OUTBOUND webhooks: keystone.webhook_endpoint + keystone.webhook_delivery.
-- Implements P19.6, P19.7 (per-endpoint HMAC secret, sealed) and P19.7a (kek_version).
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THESE ARE **INSIDE** THE TENANT RLS REGIME, AND THAT IS THE WHOLE DIFFERENCE FROM 0045.
--     `keystone_auth.api_token` and `keystone_auth.webhook_source` sit outside it because they are
--     read BEFORE a tenant exists — they are what DECIDE the tenant. These two have no such
--     chicken-and-egg: **a tenant creates an endpoint while already inside its own context**, and the
--     worker re-establishes context per job before it delivers anything. So they get the ordinary
--     treatment: ENABLE + FORCE + isolation + insert + **tenant_update**.
--   ★ A4.2 is explicit that 0016 omitted `tenant_update` on all five of its tables while 0001 and
--     0003 have it — "INCLUDE IT; do not copy the most recent file." It is included below.
--
-- ★★★ ONE ROW PER ATTEMPT. NEVER INFER DELIVERY FROM THE ABSENCE OF AN ERROR.
--     A single mutable row per (endpoint, event) cannot answer "how many times did we try, and what
--     did they say?" — and that is the only question worth asking when a receiver claims they never
--     got it. So `attempt` is part of the identity, and the row is written BEFORE the HTTP call with
--     status `attempted`.
--
-- ★★★ THE DELIVERY ROW STORES THE URL **AS SENT**, AND IS NEVER JOINED BACK TO THE ENDPOINT.
--     `webhook_endpoint.url` is editable. A log that resolved the URL by join would, the moment a
--     tenant corrected a typo, retroactively claim every historical payload went to the NEW address.
--     That is a log that lies about the past, which is worse than no log.

SET LOCAL ROLE app_owner;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 1 · keystone.webhook_endpoint
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE keystone.webhook_endpoint (
  id            uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id     uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  -- ★★ PLAINTEXT DELIVERY OF A SIGNED PAYLOAD IS REFUSED BY THE **SCHEMA**, not by the client. An
  --    HMAC proves who sent a payload; it does not hide it. Over http:// the body — which carries
  --    client names and amounts — is readable by anything on the path.
  url           text        NOT NULL CHECK (url ~ '^https://'),
  name          text        NOT NULL CHECK (btrim(name) <> ''),
  event_types   text[]      NOT NULL
                  CONSTRAINT webhook_endpoint_event_types_nonempty CHECK (cardinality(event_types) > 0)
                  CONSTRAINT webhook_endpoint_event_types_shape
                    CHECK (array_to_string(event_types, ',') ~ '^[a-z]+\.[a-z_]+\.[a-z_]+(,[a-z]+\.[a-z_]+\.[a-z_]+)*$'),
  -- ★★★ THE SIGNING SECRET IS A SEALED ENVELOPE, NEVER BARE TEXT. Sealed via sealSecret() with AAD
  --     on tenant_id + purpose='webhook_hmac', so an envelope lifted from one tenant's row cannot be
  --     opened in another's context even by code holding the master key.
  secret_envelope   jsonb   NOT NULL,
  -- ★ A fingerprint so a human can confirm "the secret I hold is the secret you hold" WITHOUT either
  --   side revealing it, and so a rotation is visible in the UI.
  secret_fingerprint text   NOT NULL CHECK (char_length(secret_fingerprint) BETWEEN 8 AND 64),
  -- ★★★ P19.7a — kek_version, AND WITHOUT IT THE ADVERTISED KEY ROTATION IS UNPERFORMABLE.
  --     `secrets/envelope.mjs`'s own header sells the design on "rotating the KEK means re-wrapping N
  --     small DEKs", but the record it returns carries `v:1` — a FORMAT version — and **no KEK
  --     identifier**. After rotating KEYSTONE_MASTER_KEY you could not tell an old envelope from a new
  --     one except by trying to open it, and `SecretOpenError` is DELIBERATELY undifferentiated so you
  --     cannot probe either. ★ Nobody would discover that until they were mid-incident.
  kek_version   smallint    NOT NULL DEFAULT 1 CHECK (kek_version >= 1),
  secret_rotated_at timestamptz,
  status        text        NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','paused','disabled')),
  disabled_reason text,
  -- ★ A counter, so a receiver that has been failing for a week can be disabled automatically with a
  --   reason a human can read, rather than silently retried forever.
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- ★★ A disabled endpoint MUST say why. "Disabled" with no reason is a support ticket in waiting.
  CONSTRAINT webhook_endpoint_disabled_shape
    CHECK (status <> 'disabled' OR disabled_reason IS NOT NULL)
);

CREATE TRIGGER webhook_endpoint_touch BEFORE UPDATE ON keystone.webhook_endpoint
  FOR EACH ROW EXECUTE FUNCTION keystone.touch_updated_at();

-- ★★ §Y4'S MEASURED INCIDENT, TURNED INTO A CONSTRAINT: "two duplicate Resend endpoints pointed at
--    the same URL; deleting one fixed delivery." Every payload was being sent twice, and the symptom
--    was not an error — it was a receiver complaining about duplicates.
--  ★ lower(url) because https://Example.com/hook and https://example.com/hook are the same host.
CREATE UNIQUE INDEX webhook_endpoint_tenant_url_key
  ON keystone.webhook_endpoint (tenant_id, lower(url));
CREATE INDEX webhook_endpoint_active_idx
  ON keystone.webhook_endpoint (tenant_id) WHERE status = 'active';

COMMENT ON TABLE keystone.webhook_endpoint IS
  'OUTBOUND webhook endpoints, one row per URL a tenant wants events delivered to. Inside the tenant '
  'RLS regime because a tenant creates one while already in its own context — unlike '
  'keystone_auth.webhook_source, which is read to DISCOVER the tenant. The signing secret is a sealed '
  'envelope with AAD on tenant_id, and kek_version exists so the advertised KEK rotation is actually '
  'performable.';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 2 · keystone.webhook_delivery — ONE ROW PER ATTEMPT
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE keystone.webhook_delivery (
  id            uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id     uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  endpoint_id   uuid        NOT NULL REFERENCES keystone.webhook_endpoint(id) ON DELETE CASCADE,
  -- ★★★ RESTRICT, NOT CASCADE. The delivery log IS the audit record; deleting the event would
  --     silently delete the evidence that we ever tried to deliver it.
  event_id      uuid        NOT NULL REFERENCES keystone.event(id) ON DELETE RESTRICT,
  attempt       integer     NOT NULL CHECK (attempt >= 1),
  -- ★★★ THE URL AS SENT. Copied at attempt time, never joined back — see the header.
  request_url   text        NOT NULL CHECK (request_url ~ '^https://'),
  request_signature text    NOT NULL,
  -- ★ Proves WHAT was signed without storing a second copy of a payload that may contain client data.
  request_body_sha256 bytea NOT NULL CHECK (octet_length(request_body_sha256) = 32),
  status        text        NOT NULL DEFAULT 'attempted'
                  CHECK (status IN ('attempted','delivered','failed','timed_out','skipped')),
  response_status  integer  CHECK (response_status IS NULL OR response_status BETWEEN 100 AND 599),
  response_headers jsonb,
  -- ★ BOUNDED. A receiver returning a 40 MB HTML error page must not bloat our log one row at a time.
  response_body_excerpt text CHECK (response_body_excerpt IS NULL OR char_length(response_body_excerpt) <= 4096),
  error         text,
  attempted_at  timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz,
  duration_ms   integer     CHECK (duration_ms IS NULL OR duration_ms >= 0),
  next_retry_at timestamptz,

  -- ★★★ MAKE THE ILLEGAL STATES UNREPRESENTABLE. `delivered` with no completion time, or with a 500,
  --     is the shape in which a dashboard reports success over a failure.
  CONSTRAINT webhook_delivery_status_shape CHECK (
    (status = 'attempted' AND completed_at IS NULL AND response_status IS NULL) OR
    (status = 'delivered' AND completed_at IS NOT NULL AND response_status BETWEEN 200 AND 299) OR
    (status IN ('failed','timed_out','skipped'))
  )
);

-- ★★ THE ONLY THING THAT IS ATOMIC. A "have I already sent attempt 3?" read-then-write loses to two
--    concurrent workers — both read "no". The unique index does not.
CREATE UNIQUE INDEX webhook_delivery_attempt_key
  ON keystone.webhook_delivery (tenant_id, endpoint_id, event_id, attempt);
CREATE INDEX webhook_delivery_log_idx
  ON keystone.webhook_delivery (tenant_id, endpoint_id, attempted_at DESC);
CREATE INDEX webhook_delivery_retry_idx ON keystone.webhook_delivery (tenant_id, next_retry_at)
  WHERE status IN ('failed','timed_out');

COMMENT ON TABLE keystone.webhook_delivery IS
  'ONE ROW PER ATTEMPT. Written BEFORE the HTTP call with status=attempted, then updated with the '
  'outcome — so a crash mid-delivery leaves evidence that we tried, which is the opposite of '
  'inferring delivery from the absence of an error. request_url is the URL AS SENT and is never '
  'joined back to webhook_endpoint, because that URL is editable and a joined log would retroactively '
  'lie about where a payload went.';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 3 · RLS — the full 0001:149-172 treatment, tenant_update INCLUDED (A4.2 item ★)
-- ─────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['webhook_endpoint','webhook_delivery'] LOOP
    EXECUTE format('ALTER TABLE keystone.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE keystone.%I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format($f$CREATE POLICY tenant_isolation ON keystone.%I
                      USING (tenant_id = keystone.current_tenant_id())$f$, t);
    EXECUTE format($f$CREATE POLICY tenant_insert ON keystone.%I
                      FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id())$f$, t);
    -- ★★ tenant_update — the one 0016 forgot on all five of its tables. Without it an UPDATE is
    --    filtered by tenant_isolation on the OLD row but has no WITH CHECK on the NEW one, so a
    --    statement could move a row to another tenant_id and the policy set would not object.
    EXECUTE format($f$CREATE POLICY tenant_update ON keystone.%I
                      FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
                              WITH CHECK (tenant_id = keystone.current_tenant_id())$f$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.%I TO app_rw', t);
  END LOOP;
END $$;

RESET ROLE;
