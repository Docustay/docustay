-- 0428_estimates — Stage 15 (F08), task 15.9 — STAGE-15-PLAN.md §15.9 (line 880).
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ WHAT THIS BUILDS. `keystone.estimate` — its own `EST-` numbered object, sent, opened, accepted
--     or declined before any money moves — and a line item may now belong to one (D9). This is the
--     first time §Z3.15's arc has grown since `0087_polymorphic_parents_ruled.sql` created it: a
--     fourth exclusive-arc column, `estimate_id`, joins `booking_id`/`invoice_id`/`document_id`.
--
-- ★★ CT-F52 SHAPE, copied from the two most recent complete precedents for the checklist itself
--    (`0415_gift_card.sql`, `0402_booking_block.sql`): tenant_id FK · ENABLE *and* FORCE RLS · the
--    tenant policies · a `reference_guard_read` policy and its grant · both guard triggers ENABLE
--    ALWAYS (with the temporary EXECUTE lend — 0402's header: not optional) · tenant-leading unique
--    indexes · an `app_rw` grant limited to SELECT, INSERT, UPDATE — NO DELETE (an estimate is
--    archived, `archived_at`/`archived_by`, never deleted) · and a closing self-check DO block
--    asserting positively what IS true, not merely what is absent.
--
-- ★★ SELECT SHAPE — the 0196 shape, copied verbatim from `0196_money_is_not_a_coachs_business_
--    unless_it_is.sql:99-107` (the `invoice` policy) with the person column renamed to
--    `recipient_user_id`: the recipient can see their own estimate without an `invoice` grant of
--    their own, and a coach holding `invoice: view/…` can see it too.
--
-- ★★★ §Z3.15's ARC GAINS A FOURTH TERM. `line_item_exactly_one_parent`'s definition was read from
--     `pg_constraint` (MEASURED, and this migration is written from that read — see the module's own
--     report for the command and result) rather than retyped from memory, precisely because a CHECK
--     that has drifted since 0087 would make a hand-retyped version a silent rewrite. It had not
--     drifted: the two migrations that touch `line_item` after 0087
--     (`0411_modifier_and_line_item_widening.sql`, `0412_custom_field_booking_options.sql`) both
--     widen OTHER columns and never touch this constraint, confirmed by grep across every migration
--     for the constraint's name — 0087 (create) and this file (drop + re-add) are its only two
--     appearances. DROP + ADD (not ALTER … VALIDATE): a CHECK cannot be altered in place, and this
--     one is re-added `VALID` (not `NOT VALID`) because the data is safe — production `line_item` 0
--     rows (planning-phase EXECUTED read, `STAGE-15-PLAN.md` §15.9 field 6); this module could not
--     independently confirm that count itself (BUILD role: no database connection permitted) and
--     states that plainly here rather than re-asserting an EXECUTED claim it did not itself execute.
--
-- DATA: `estimate` — new table, no backfill. `line_item`/`invoice` — new nullable column each, no
--   backfill; the re-added CHECK is stated safe by the plan's own EXECUTED read (see above).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

CREATE TABLE keystone.estimate (
  id                     uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id              uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,

  recipient_user_id      uuid        NOT NULL,
  estimate_number        text        NOT NULL CHECK (estimate_number ~ '^EST-[0-9]{6,}$'),

  title                  text        NULL CHECK (title IS NULL OR char_length(title) <= 120),
  message                text        NULL CHECK (message IS NULL OR char_length(message) <= 2000),

  status                 text        NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','sent','opened','accepted','declined','expired','converted')),

  currency               text        NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  subtotal_minor         integer     NOT NULL DEFAULT 0 CHECK (subtotal_minor >= 0),
  discount_minor         integer     NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  tax_minor              integer     NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
  amount_minor           integer     NOT NULL DEFAULT 0 CHECK (amount_minor >= 0),

  good_for_days          integer     NOT NULL DEFAULT 30 CHECK (good_for_days BETWEEN 1 AND 365),
  expires_at             timestamptz NULL,

  sent_at                timestamptz NULL,
  opened_at              timestamptz NULL,
  view_count             integer     NOT NULL DEFAULT 0,

  accepted_at            timestamptz NULL,
  declined_at            timestamptz NULL,
  decline_reason         text        NULL CHECK (decline_reason IS NULL OR char_length(decline_reason) <= 1000),

  converted_invoice_id   uuid        NULL,
  on_accept_invoice      boolean     NOT NULL DEFAULT true,
  on_accept_record       boolean     NOT NULL DEFAULT false,

  document_template_id   uuid        NULL REFERENCES keystone.document_template(id) ON DELETE RESTRICT,
  expiring_told_at       timestamptz NULL,

  created_by             uuid        NULL,
  archived_at            timestamptz NULL,
  archived_by            uuid        NULL,

  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, estimate_number),
  FOREIGN KEY (tenant_id, recipient_user_id)    REFERENCES keystone.app_user (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, converted_invoice_id) REFERENCES keystone.invoice (tenant_id, id)  ON DELETE RESTRICT,

  CHECK ((status IN ('declined')) = (declined_at IS NOT NULL)),
  CHECK ((status IN ('accepted','converted')) <= (accepted_at IS NOT NULL))
);

ALTER TABLE keystone.estimate ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.estimate FORCE  ROW LEVEL SECURITY;

-- ★★ 0196 shape, copied verbatim (0196:99-107) with the person column renamed to recipient_user_id.
CREATE POLICY tenant_isolation ON keystone.estimate
  FOR SELECT USING (
    tenant_id = keystone.current_tenant_id()
    AND (
      keystone.user_may(keystone.current_user_id(), 'invoice', 'view',
        (SELECT ao.owner_user_id FROM keystone.app_user ao WHERE ao.id = estimate.recipient_user_id))
      OR recipient_user_id = keystone.current_user_id()
    )
  );

CREATE POLICY tenant_insert ON keystone.estimate
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());

CREATE POLICY tenant_update ON keystone.estimate
  FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
             WITH CHECK (tenant_id = keystone.require_tenant_id());

-- No tenant_delete: an estimate is archived (archived_at/archived_by), never deleted.
GRANT SELECT, INSERT, UPDATE ON keystone.estimate TO app_rw;

-- ═══ CT-F52 §3.2 points (3)(4)(5) — THE REFERENCE-PRACTICE GUARD HALF ═══════════════════════════
-- ★★★ THE EXECUTE LEND IS NOT OPTIONAL. `keystone.refuse_touch_reference_rows()` is owned by
--     `reference_guard` (0144:245) and 0099:83 revoked ALL on it FROM PUBLIC. 0151:91-110 verbatim.
SET LOCAL ROLE reference_guard;
GRANT EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() TO app_owner;
SET LOCAL ROLE app_owner;

CREATE TRIGGER estimate_refuse_reference_delete_trg AFTER DELETE ON keystone.estimate
  REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT
  EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.estimate ENABLE ALWAYS TRIGGER estimate_refuse_reference_delete_trg;
CREATE TRIGGER estimate_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.estimate
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.estimate ENABLE ALWAYS TRIGGER estimate_refuse_reference_truncate_trg;

SET LOCAL ROLE reference_guard;
REVOKE EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() FROM app_owner;
SET LOCAL ROLE app_owner;

GRANT SELECT ON keystone.estimate TO reference_guard;
CREATE POLICY reference_guard_read ON keystone.estimate FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §Z3.15's ARC GAINS A FOURTH TERM — `estimate_id` joins the exclusive arc on `line_item`, and an
-- estimate may be converted into an invoice (`invoice.estimate_id`, plain FK, not part of the arc —
-- an invoice HAS an originating estimate, it does not itemise one).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
ALTER TABLE keystone.line_item ADD COLUMN estimate_id uuid NULL;
ALTER TABLE keystone.line_item ADD CONSTRAINT line_item_estimate_fkey
  FOREIGN KEY (tenant_id, estimate_id) REFERENCES keystone.estimate (tenant_id, id) ON DELETE CASCADE;

CREATE INDEX line_item_estimate_idx ON keystone.line_item (tenant_id, estimate_id) WHERE estimate_id IS NOT NULL;

-- ★★★ DROP + RE-ADD, VALID. `line_item_exactly_one_parent`'s CURRENT definition (0087:107-110,
--     re-confirmed unchanged by this file's own header) — the same three terms, plus estimate_id.
ALTER TABLE keystone.line_item DROP CONSTRAINT line_item_exactly_one_parent;
ALTER TABLE keystone.line_item ADD CONSTRAINT line_item_exactly_one_parent
  CHECK ((booking_id IS NOT NULL)::int + (invoice_id IS NOT NULL)::int
       + (document_id IS NOT NULL)::int + (estimate_id IS NOT NULL)::int = 1);

-- ── `invoice.estimate_id` — a plain FK, not part of any arc: an invoice may have originated from
--    an estimate, or may not (a walk-in charge has none). The `invoice_tenant_id_id_key` unique
--    index this composite FK needs already exists (0087:82, EXECUTED).
ALTER TABLE keystone.invoice ADD COLUMN estimate_id uuid NULL;
ALTER TABLE keystone.invoice ADD CONSTRAINT invoice_estimate_fkey
  FOREIGN KEY (tenant_id, estimate_id) REFERENCES keystone.estimate (tenant_id, id) ON DELETE RESTRICT;

-- ═══ CT-F52 §3.2 point (6) — THE SELF-CHECK, WITH POSITIVE CONTROLS ═══════════════════════════
DO $ct_f52_self_check$
DECLARE n int;
BEGIN
  IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'keystone.estimate'::regclass) THEN
    RAISE EXCEPTION '0428 — keystone.estimate is not FORCE ROW LEVEL SECURITY';
  END IF;

  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'keystone' AND tablename = 'estimate'
     AND policyname IN ('tenant_isolation','tenant_insert','tenant_update','reference_guard_read');
  IF n <> 4 THEN
    RAISE EXCEPTION '0428 — expected 4 policies on estimate, found %', n;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='keystone'
              AND tablename='estimate' AND policyname='tenant_delete') THEN
    RAISE EXCEPTION '0428 — estimate has a tenant_delete policy but no delete path; remove one or the other';
  END IF;

  SELECT count(*) INTO n FROM pg_trigger
   WHERE tgrelid = 'keystone.estimate'::regclass
     AND tgname IN ('estimate_refuse_reference_delete_trg','estimate_refuse_reference_truncate_trg')
     AND tgenabled = 'A';
  IF n <> 2 THEN
    RAISE EXCEPTION '0428 — both refuse_touch_reference_rows triggers must exist and be ENABLE ALWAYS on estimate, found %', n;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
     WHERE polrelid = 'keystone.estimate'::regclass
       AND polname = 'reference_guard_read'
       AND polroles = ARRAY['reference_guard'::regrole::oid]
       AND polcmd = 'r'
       AND polpermissive
  ) THEN
    RAISE EXCEPTION '0428 — reference_guard_read on estimate must be TO reference_guard ONLY, FOR SELECT, PERMISSIVE (CT-F52 point 4b)';
  END IF;

  -- ★ Positive controls, in the same block.
  IF NOT has_table_privilege('app_rw', 'keystone.estimate', 'SELECT') THEN
    RAISE EXCEPTION '0428 — app_rw is missing SELECT on estimate';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.estimate', 'INSERT') THEN
    RAISE EXCEPTION '0428 — app_rw is missing INSERT on estimate';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.estimate', 'UPDATE') THEN
    RAISE EXCEPTION '0428 — app_rw lost UPDATE on estimate; this check is not merely asserting absences';
  END IF;
  IF NOT has_table_privilege('reference_guard', 'keystone.estimate', 'SELECT') THEN
    RAISE EXCEPTION '0428 — reference_guard has no SELECT on estimate; its policy would have nothing underneath it';
  END IF;
  IF has_table_privilege('app_rw', 'keystone.estimate', 'DELETE') THEN
    RAISE EXCEPTION '0428 — app_rw must NOT hold DELETE on estimate';
  END IF;

  -- ★★★ FORCE is asserted on `keystone.estimate` above; this closing block ALSO asserts the arc.
  SELECT count(*) INTO n FROM pg_constraint
   WHERE conrelid = 'keystone.line_item'::regclass AND conname = 'line_item_exactly_one_parent';
  IF n <> 1 THEN
    RAISE EXCEPTION '0428 — line_item_exactly_one_parent must exist exactly once, found %', n;
  END IF;
  IF NOT (SELECT convalidated FROM pg_constraint
           WHERE conrelid = 'keystone.line_item'::regclass AND conname = 'line_item_exactly_one_parent') THEN
    RAISE EXCEPTION '0428 — line_item_exactly_one_parent must be VALID, re-added as NOT VALID';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'keystone.line_item'::regclass AND conname = 'line_item_estimate_fkey' AND contype = 'f'
  ) THEN
    RAISE EXCEPTION '0428 — line_item_estimate_fkey is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'keystone.invoice'::regclass AND conname = 'invoice_estimate_fkey' AND contype = 'f'
  ) THEN
    RAISE EXCEPTION '0428 — invoice_estimate_fkey is missing';
  END IF;
END $ct_f52_self_check$;

-- Written, not applied.
