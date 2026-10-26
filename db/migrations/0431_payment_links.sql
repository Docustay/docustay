-- 0431_payment_links — Stage 15 task 15.10 · CT-F40/CT-F41
--
-- keystone.payment_link — a reusable, shareable link a practice sends a client to collect money
-- without a bespoke invoice: plain (fixed price, one item), sign_first (a document must be signed
-- before paying), book_with (bundled with a booking), or pick_amount (the payer names the amount,
-- e.g. a donation or tip). This migration builds the TABLE ONLY (field 4) — the writer routes are
-- task 15.23.
--
-- ★★★ THE THREE SHAPE CHECKS ARE BICONDITIONALS, NOT ONE-WAY GUARDS (field 7/8). Each is
--     `(variant = 'x') = (column IS NOT NULL / IS NULL)` — it refuses the variant WITHOUT its
--     required column AND refuses every OTHER variant WITH that column populated:
--       · `(variant = 'pick_amount') = (amount_minor IS NULL)` — a pick_amount link MUST have a
--         NULL amount_minor (the payer names it), and a NON-pick_amount link MUST have one set.
--       · `(variant = 'sign_first') = (document_template_id IS NOT NULL)` — sign_first MUST name a
--         template; every other variant MUST NOT.
--       · `(variant = 'book_with') = (service_id IS NOT NULL)` — book_with MUST name a service;
--         every other variant MUST NOT.
--
-- ★★ THE SELECT POLICY IS NOT TENANT-ONLY (unlike INSERT/UPDATE below) — a payment link is money
--    data (it carries pricing and a running `taken_minor` total), so it follows the same shape
--    `keystone.invoice`'s `tenant_isolation` policy already uses (0196:99-107, MEASURED): tenant
--    conjunct AND `keystone.user_may(..., 'invoice', 'view', NULL)` — no owning-coach argument,
--    because a payment link is not owned by one client's coach the way an invoice row is by its
--    payer's; visibility is the practice-wide `invoice.view` grant.
--
-- ★ `service_id` reaches `keystone.service` through the composite `(tenant_id, id)` unique index —
--   confirmed via the MIGRATION SOURCE (no database reached tonight; UNKNOWN by direct pg_constraint
--   query, MEASURED instead from the file): `db/migrations/0087_polymorphic_parents_ruled.sql:142`
--   creates `CREATE UNIQUE INDEX service_tenant_id_id_key ON keystone.service (tenant_id, id);` and
--   `:147-148` already builds a composite FK against it (`line_item_service_fkey`), so the same
--   composite target this table's `FOREIGN KEY (tenant_id, service_id) …` uses is proven reachable
--   by an existing, working reference — not a fresh assumption.
--
-- ★ `document_template_id` is a PLAIN (non-composite) FK to `keystone.document_template(id)` — that
--   table's `id` is its own PRIMARY KEY (`0009_catalogue_and_documents.sql:125`, MEASURED), so a
--   single-column FK is a valid target with no composite index needed.
--
-- Shape follows CT-F52 in full, copied from the two most recent complete precedents
-- (`0415_gift_card.sql`, `0402_booking_block.sql`): ENABLE+FORCE RLS, tenant policies (SELECT
-- money-gated as above, tenant-only INSERT/UPDATE, no DELETE — a link is deactivated via `state`,
-- never removed), the reference-guard read policy, the refuse_touch_reference_rows triggers
-- (ENABLE ALWAYS, with the temporary EXECUTE lend — 0402's header: not optional), tenant-leading
-- unique indexes (inline `UNIQUE (tenant_id, id)` / `UNIQUE (tenant_id, slug)`, field 6's own
-- shape), the grants (SELECT, INSERT, UPDATE to app_rw — no DELETE, field 6), and a closing
-- self-check DO block with positive controls.

CREATE TABLE keystone.payment_link (
  id                    uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id             uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,

  title                 text        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  variant               text        NOT NULL CHECK (variant IN ('plain','sign_first','book_with','pick_amount')),

  amount_minor          integer     NULL CHECK (amount_minor IS NULL OR amount_minor > 0),
  min_amount_minor      integer     NULL CHECK (min_amount_minor IS NULL OR min_amount_minor > 0),
  currency              text        NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),

  document_template_id  uuid        NULL REFERENCES keystone.document_template(id) ON DELETE RESTRICT,
  service_id            uuid        NULL,

  slug                  text        NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{2,40}$'),

  stripe_payment_link_id text       NULL,
  stripe_url            text        NULL,

  state                 text        NOT NULL DEFAULT 'active' CHECK (state IN ('active','inactive')),
  uses                  integer     NOT NULL DEFAULT 0 CHECK (uses >= 0),
  taken_minor           bigint      NOT NULL DEFAULT 0 CHECK (taken_minor >= 0),
  last_used_at          timestamptz NULL,

  created_by            uuid        NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  archived_at           timestamptz NULL,

  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, slug),

  FOREIGN KEY (tenant_id, service_id) REFERENCES keystone.service (tenant_id, id) ON DELETE RESTRICT,

  -- ★★★ THE THREE BICONDITIONALS — see header. Each refuses BOTH the missing-required-column case
  --     AND the wrong-variant-has-it case.
  CONSTRAINT payment_link_pick_amount_shape
    CHECK ((variant = 'pick_amount') = (amount_minor IS NULL)),
  CONSTRAINT payment_link_sign_first_shape
    CHECK ((variant = 'sign_first') = (document_template_id IS NOT NULL)),
  CONSTRAINT payment_link_book_with_shape
    CHECK ((variant = 'book_with') = (service_id IS NOT NULL))
);

ALTER TABLE keystone.payment_link ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.payment_link FORCE  ROW LEVEL SECURITY;

-- ★★ SELECT is money-gated, not tenant-only — same shape as keystone.invoice's tenant_isolation
--    (0196:99-107). No owning-coach argument: a payment link isn't owned by one client's coach.
CREATE POLICY tenant_isolation ON keystone.payment_link
  FOR SELECT USING (
    tenant_id = keystone.current_tenant_id()
    AND keystone.user_may(keystone.current_user_id(), 'invoice', 'view', NULL)
  );

CREATE POLICY tenant_insert ON keystone.payment_link
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());

CREATE POLICY tenant_update ON keystone.payment_link
  FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
             WITH CHECK (tenant_id = keystone.require_tenant_id());

-- No tenant_delete: a link is deactivated (state = 'inactive'), never deleted (field 6: no DELETE grant).
GRANT SELECT, INSERT, UPDATE ON keystone.payment_link TO app_rw;

CREATE TRIGGER payment_link_touch BEFORE UPDATE ON keystone.payment_link
  FOR EACH ROW EXECUTE FUNCTION keystone.touch_updated_at();

-- ═══ CT-F52 §3.2 points (3)(4)(5) — THE REFERENCE-PRACTICE GUARD HALF ═══════════════════════════
-- ★★★ THE EXECUTE LEND IS NOT OPTIONAL. `keystone.refuse_touch_reference_rows()` is owned by
--     `reference_guard` (0144:245) and 0099:83 revoked ALL on it FROM PUBLIC. 0151:91-110 verbatim.
SET LOCAL ROLE reference_guard;
GRANT EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() TO app_owner;
SET LOCAL ROLE app_owner;

CREATE TRIGGER payment_link_refuse_reference_delete_trg AFTER DELETE ON keystone.payment_link
  REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT
  EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.payment_link ENABLE ALWAYS TRIGGER payment_link_refuse_reference_delete_trg;
CREATE TRIGGER payment_link_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.payment_link
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.payment_link ENABLE ALWAYS TRIGGER payment_link_refuse_reference_truncate_trg;

SET LOCAL ROLE reference_guard;
REVOKE EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() FROM app_owner;
SET LOCAL ROLE app_owner;

GRANT SELECT ON keystone.payment_link TO reference_guard;
CREATE POLICY reference_guard_read ON keystone.payment_link FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));

-- ═══ CT-F52 §3.2 point (6) — THE SELF-CHECK, WITH POSITIVE CONTROLS ══════════════════════════════
DO $ct_f52_self_check$
DECLARE n int;
BEGIN
  IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'keystone.payment_link'::regclass) THEN
    RAISE EXCEPTION '0431 — keystone.payment_link is not FORCE ROW LEVEL SECURITY';
  END IF;

  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'keystone' AND tablename = 'payment_link'
     AND policyname IN ('tenant_isolation','tenant_insert','tenant_update','reference_guard_read');
  IF n <> 4 THEN
    RAISE EXCEPTION '0431 — expected 4 policies on payment_link, found %', n;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='keystone'
              AND tablename='payment_link' AND policyname='tenant_delete') THEN
    RAISE EXCEPTION '0431 — payment_link has a tenant_delete policy but no delete path; remove one or the other';
  END IF;

  -- ★ the SELECT policy must be money-gated, not bare tenant_id — the whole point of this table's
  --   access shape (field 6). A qual that lost `user_may` would silently widen visibility to every
  --   tenant member regardless of the invoice.view grant.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'keystone' AND tablename = 'payment_link' AND policyname = 'tenant_isolation'
       AND qual LIKE '%user_may%' AND qual LIKE '%current_tenant_id%'
  ) THEN
    RAISE EXCEPTION '0431 — tenant_isolation on payment_link must read both current_tenant_id() and user_may(...)';
  END IF;

  SELECT count(*) INTO n FROM pg_trigger
   WHERE tgrelid = 'keystone.payment_link'::regclass
     AND tgname IN ('payment_link_refuse_reference_delete_trg','payment_link_refuse_reference_truncate_trg')
     AND tgenabled = 'A';
  IF n <> 2 THEN
    RAISE EXCEPTION '0431 — both refuse_touch_reference_rows triggers must exist and be ENABLE ALWAYS on payment_link, found %', n;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
     WHERE polrelid = 'keystone.payment_link'::regclass
       AND polname = 'reference_guard_read'
       AND polroles = ARRAY['reference_guard'::regrole::oid]
       AND polcmd = 'r'
       AND polpermissive
  ) THEN
    RAISE EXCEPTION '0431 — reference_guard_read on payment_link must be TO reference_guard ONLY, FOR SELECT, PERMISSIVE (CT-F52 point 4b)';
  END IF;

  -- ★ Positive controls, in the same block — assert what SHOULD be true, not merely what should be
  --   absent (the 0409 lesson: a check that only forbids things can forbid the very path it's
  --   testing for).
  IF NOT has_table_privilege('app_rw', 'keystone.payment_link', 'SELECT') THEN
    RAISE EXCEPTION '0431 — app_rw is missing SELECT on payment_link';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.payment_link', 'INSERT') THEN
    RAISE EXCEPTION '0431 — app_rw is missing INSERT on payment_link';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.payment_link', 'UPDATE') THEN
    RAISE EXCEPTION '0431 — app_rw lost UPDATE on payment_link; this check is not merely asserting absences';
  END IF;
  IF NOT has_table_privilege('reference_guard', 'keystone.payment_link', 'SELECT') THEN
    RAISE EXCEPTION '0431 — reference_guard has no SELECT on payment_link; its policy would have nothing underneath it';
  END IF;
  IF has_table_privilege('app_rw', 'keystone.payment_link', 'DELETE') THEN
    RAISE EXCEPTION '0431 — app_rw must NOT hold DELETE on payment_link (a link is deactivated, never deleted)';
  END IF;
END $ct_f52_self_check$;

-- Written, not applied.
