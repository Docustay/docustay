-- 0048 — THE EMBED BOUNDARY, ENFORCED BY A POSTGRES GRANT. P19.8.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE RULE, VERBATIM FROM P19.8: *"ENFORCE IT WITH A POSTGRES GRANT, NOT AN `if`. An
--     application-code `if (token.class === 'publishable') reject` is ONE REFACTOR AWAY FROM ABSENT."*
--     A publishable key is safe in public HTML only because of what it CANNOT do, and "cannot" has to
--     mean the database refuses — not that a branch in a route handler currently returns early.
--
-- ★★★ WHY A DEDICATED TABLE RATHER THAN `GRANT INSERT ON app_user`.
--     The embed's job is lead capture. `app_user` is the person record: it carries roles, staff_role,
--     firebase_uid and the relationships every screen reads. Granting INSERT on it to a role whose
--     credential is PUBLISHED IN A WEB PAGE would mean an anonymous visitor can create rows in the
--     table that decides who is staff.
--   ★ So the embed writes to ONE table — `keystone.embed_submission` — and nothing else in either
--     schema. Staff (or a worker) promote a submission into a person later, inside the normal
--     authenticated path. **The blast radius of a leaked publishable key is one append-only intake
--     table**, which is what makes publishing the key defensible at all.
--   ★★ And "a lead is DERIVED" (F57) stays true: this table is raw intake, not a lead entity.
--
-- ★★★ NO SELECT, ANYWHERE, FOR app_embed — AND THAT MAKES `RETURNING` IMPOSSIBLE.
--     `INSERT ... RETURNING id` requires SELECT privilege on the returned columns. So the embed path
--     physically cannot read back what it wrote. **That is part of the proof, not a limitation to
--     route around**: a key that can read nothing cannot be used to enumerate a tenant's data, and a
--     later "small convenience" adding RETURNING will fail loudly at 42501 rather than quietly
--     widening the boundary.
--
-- ★★ ALTER DEFAULT PRIVILEGES IS THE OTHER HALF. Without it, a table created by a LATER migration
--    inherits whatever the default happens to be, and the embed role's reach would grow silently as
--    the schema grows. The defaults are pinned to grant it nothing.

SET LOCAL ROLE app_owner;

CREATE TABLE keystone.embed_submission (
  id            uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id     uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  -- ★ Which embed produced it, so a tenant can tell its intake form from its booking widget.
  source        text        NOT NULL CHECK (source IN ('lead_form','booking_request','newsletter')),
  -- ★★ THE PAYLOAD IS OPAQUE JSON ON PURPOSE. An embed is public: anything it posts is
  --    attacker-controlled, so it is stored as submitted and validated when a human promotes it.
  --    Typing these columns would mean trusting a public form's shape.
  payload       jsonb       NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  -- ★ Bounded, so a public endpoint cannot be used to fill the disk one submission at a time.
  CONSTRAINT embed_submission_payload_size CHECK (pg_column_size(payload) <= 16384),
  submitted_at  timestamptz NOT NULL DEFAULT now(),
  -- ★ Set by STAFF later, on the authenticated path. app_embed cannot UPDATE, so it can never
  --   mark its own submission as handled.
  promoted_at   timestamptz,
  promoted_to   uuid        REFERENCES keystone.app_user(id) ON DELETE SET NULL,
  CONSTRAINT embed_submission_promotion_shape
    CHECK (promoted_to IS NULL OR promoted_at IS NOT NULL)
);

CREATE INDEX embed_submission_tenant_idx
  ON keystone.embed_submission (tenant_id, submitted_at DESC);
CREATE INDEX embed_submission_unpromoted_idx
  ON keystone.embed_submission (tenant_id) WHERE promoted_at IS NULL;

ALTER TABLE keystone.embed_submission ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.embed_submission FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keystone.embed_submission
  USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert ON keystone.embed_submission
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update ON keystone.embed_submission
  FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
          WITH CHECK (tenant_id = keystone.current_tenant_id());

-- ★ Staff get the normal set.
GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.embed_submission TO app_rw;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- ★★★ THE EMBED ROLE'S ENTIRE REACH. REVOKE FIRST, THEN GRANT EXACTLY ONE VERB ON ONE TABLE.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- ★ REVOKE BEFORE GRANT, always: a previous migration, a restore, or a manual session may have left
--   something behind, and "grant what I want" does not remove what I do not.
REVOKE ALL ON ALL TABLES    IN SCHEMA keystone FROM app_embed;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA keystone FROM app_embed;
REVOKE ALL ON SCHEMA keystone FROM app_embed;
-- ★★★ THERE IS DELIBERATELY **NO** `REVOKE ALL ON ALL FUNCTIONS … FROM app_embed` HERE, AND THE FIRST
--     DRAFT OF THIS MIGRATION HAD ONE. Two things were wrong with it, and the second is the serious one:
--   1 · It FAILED — `permission denied for function resolve_tenants_by_firebase_uid`. The credential
--       resolvers are owned by `auth_owner`, and `app_owner` (who runs migrations) cannot revoke on
--       another role's functions. So the statement could never have worked.
--   2 · ★★★ AND IF IT HAD WORKED IT WOULD HAVE BROKEN THE EMBED PATH. 0045 grants
--       `EXECUTE ON keystone.resolve_publishable_key(text,bytea) TO app_embed` **on purpose** — it is
--       the one function the embed role must be able to call, because it is how a publishable key
--       resolves its tenant. A blanket revoke would have silently removed the single grant this whole
--       feature depends on, and the symptom would have been "embeds stopped working" with no clue why.
--   ★ A blanket REVOKE reads like extra safety and is really an untargeted DELETE of privileges
--     somebody chose deliberately. Grants to this role are enumerated, not swept.

GRANT USAGE  ON SCHEMA keystone TO app_embed;
GRANT INSERT ON keystone.embed_submission TO app_embed;   -- ★ INSERT ONLY. No SELECT ⇒ no RETURNING.

-- ★★★ THE FUTURE, PINNED. Without these two lines a table added by migration 0060 could inherit a
--     default privilege and quietly become readable by the role whose key is published in a web page.
ALTER DEFAULT PRIVILEGES IN SCHEMA keystone REVOKE ALL ON TABLES    FROM app_embed;
ALTER DEFAULT PRIVILEGES IN SCHEMA keystone REVOKE ALL ON SEQUENCES FROM app_embed;
ALTER DEFAULT PRIVILEGES IN SCHEMA keystone REVOKE ALL ON FUNCTIONS FROM app_embed;

COMMENT ON TABLE keystone.embed_submission IS
  'Raw intake from PUBLIC embeds. The ONLY table app_embed may touch, and INSERT is the only verb it '
  'holds — no SELECT anywhere, which also makes INSERT ... RETURNING impossible for that role. A '
  'leaked publishable key therefore reaches one append-only intake table and nothing else. Payload is '
  'opaque jsonb because a public form''s contents are attacker-controlled; promotion to a person '
  'happens later on the authenticated path.';

RESET ROLE;
