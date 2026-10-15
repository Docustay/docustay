-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- A9.3 / A10.3 — `sender_identity` AND `sender_routing`. **WHO A PRACTICE'S MAIL COMES FROM.**
--
-- ★★★ THE POINT OF THE WHOLE THING: a session reminder should leave THE COACH'S mailbox, not ours.
--     Today `src/email/send.mjs` reads ONE `KEYSTONE_EMAIL_FROM` for the entire platform, so every
--     practice's clients receive mail from the same address — which is the thing these two tables
--     exist to end.
--
-- ★★★ AND THE PLAN SAID THIS WAS GREENFIELD. **IT IS NOT, AND THAT MATTERS.** The OAuth half already
--     exists and is good (`0057_run.sql`): `google_identity` holds ONE consent per Google account,
--     the refresh token ENVELOPE-SEALED with a `kek_version`, keyed on the OIDC `sub` and never the
--     email, with `grant_state IN ('usable','reconsent_required','withdrawn')` and the provider's
--     own error stored verbatim. **None of that is rebuilt here.** `sender_identity` REFERENCES it.
--
-- ★★ WHY TWO TABLES AND NOT ONE COLUMN ON `google_identity`:
--     · a single consent can send from SEVERAL addresses (aliases, groups) — `sendAs` enumerates
--       them, and each is a separate sender;
--     · and the same address may serve SEVERAL purposes, or none.
--    Folding either into the identity would make "which mailbox" and "which address" one fact, and
--    they are two.
--
-- ★★★ `grant_state` IS DELIBERATELY NOT COPIED HERE. It lives on `google_identity` and is read
--     THROUGH the reference. A mirrored copy would be two systems holding one fact — and the one
--     that goes stale is the one that says a dead mailbox is fine.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- ── sender_identity — one ADDRESS this practice can send from ─────────────────────────────────
CREATE TABLE keystone.sender_identity (
  id uuid PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,

  -- ★★★ THE MAILBOX THIS ADDRESS SENDS THROUGH. `ON DELETE RESTRICT`, deliberately: deleting an
  --     identity that routing still points at must be refused, not cascaded into silence. A routing
  --     row whose sender vanished would fall back to the platform address — which is exactly the
  --     "a practice's clients receive mail from a stranger" failure.
  --   ★ NULLABLE, because the PLATFORM SHARED address is a legitimate sender with no Google consent
  --     behind it. `google_identity_id IS NULL` means "sent by the platform, with the practice's name".
  google_identity_id uuid REFERENCES keystone.google_identity(id) ON DELETE RESTRICT,

  email text NOT NULL,
  display_name text,

  -- ★★ HOW THIS ADDRESS CAME TO BE HERE, because the two providers differ and the UI must not
  --    pretend parity. `enumerated` = Google's `sendAs.list` returned it. `typed` = somebody entered
  --    it, which is the ONLY route available for Microsoft: *"It's not currently possible to use
  --    Microsoft Graph to query which mailboxes the authenticated user has permissions for."*
  --    `platform` = the platform's own shared address.
  origin text NOT NULL DEFAULT 'enumerated' CONSTRAINT sender_identity_origin_check
    CHECK (origin IN ('enumerated','typed','platform')),

  -- ★★★ VERIFIED MEANS **WE HAVE SEEN IT WORK**, NOT "the provider listed it". Enumeration finds only
  --     what is already configured: *"Aliases don't automatically enable sending. Users must manually
  --     configure them in Gmail by setting up a custom From address."* A group needs
  --     `membersCanPostAsTheGroup` AND a send-as entry — membership alone puts nothing in the list.
  --     So a TYPED Microsoft address is verified by ATTEMPTING A SEND, and this column records the
  --     outcome rather than an assumption.
  verified_at timestamptz,

  -- ★★ THE DURABILITY FACT, STORED BECAUSE THE SCREEN HAS TO STATE IT. *"An alias dies with the user
  --    account. A group survives the owner leaving. The difference shows up on a last day."*
  kind text NOT NULL DEFAULT 'alias' CONSTRAINT sender_identity_kind_check
    CHECK (kind IN ('primary','alias','group','platform')),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- ★ One row per address per practice. The same address in two tenants is fine and normal.
  CONSTRAINT sender_identity_unique_email UNIQUE (tenant_id, email),

  -- ★★★ A PLATFORM SENDER HAS NO CONSENT AND A CONSENT-BACKED SENDER IS NOT THE PLATFORM'S. Stating
  --     it as a CHECK means the impossible combination cannot be stored, rather than being
  --     something every reader has to remember to exclude.
  CONSTRAINT sender_identity_platform_shape CHECK (
    (origin = 'platform' AND google_identity_id IS NULL AND kind = 'platform') OR
    (origin <> 'platform' AND kind <> 'platform')
  )
);

-- ── sender_routing — WHICH address sends WHICH kind of mail ───────────────────────────────────
CREATE TABLE keystone.sender_routing (
  id uuid PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,

  -- ★★★ THE PURPOSE. A CLOSED SET, because `resolveSender(tenant, purpose)` is a lookup and an
  --     unknown purpose must be a refusal rather than a miss that falls through to the platform.
  --   ★★ AND **`auth` IS NOT IN IT, ON PURPOSE.** A sign-in link is a CREDENTIAL, and auth mail never
  --      passes through a mailbox the tenant controls: if the mailbox is broken and password resets
  --      go through it, NOBODY CAN GET IN TO FIX IT. Resend sends auth mail, always, with no toggle
  --      — so there is no row shape here that could route it, not merely a rule saying not to.
  --   ★ `campaign` is absent for a different reason: Gmail and Outlook cap daily sends and flag
  --     bulk, and a campaign sharing a domain with password resets can take them down. Campaigns go
  --     through listmonk, which is not a sender identity.
  purpose text NOT NULL CONSTRAINT sender_routing_purpose_check
    CHECK (purpose IN ('reminders','documents','invoices','receipts')),

  sender_identity_id uuid NOT NULL REFERENCES keystone.sender_identity(id) ON DELETE RESTRICT,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- ★★ ONE ROUTE PER PURPOSE PER PRACTICE. Two rows for one purpose would make "which address sends
  --    invoices" a question with two answers, and the resolver would have to pick — which is a
  --    decision no code should be making at send time.
  CONSTRAINT sender_routing_one_per_purpose UNIQUE (tenant_id, purpose)
);

CREATE INDEX sender_identity_by_tenant ON keystone.sender_identity (tenant_id);
CREATE INDEX sender_identity_by_google ON keystone.sender_identity (google_identity_id)
  WHERE google_identity_id IS NOT NULL;
CREATE INDEX sender_routing_by_identity ON keystone.sender_routing (sender_identity_id);

-- ── RLS, the same shape every tenant-scoped table in this schema uses ─────────────────────────
-- ★★★ FORCED, so even the owner obeys it, and the tenant comes from the GUC rather than from any
--     caller. This is not re-litigated per table; it is the one pattern.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sender_identity','sender_routing']
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

COMMENT ON TABLE keystone.sender_identity IS
  'One address this practice can send from. References google_identity for the mailbox behind it; '
  'NULL means the platform shared address. grant_state is NOT mirrored here — it is read through '
  'the reference, because two systems holding one fact is how a dead mailbox gets called usable.';

COMMENT ON TABLE keystone.sender_routing IS
  'Which sender address serves which purpose. auth is deliberately NOT a purpose: a sign-in link is '
  'a credential and never leaves a tenant-controlled mailbox, because a broken mailbox would lock '
  'everybody out of the thing that fixes it.';
