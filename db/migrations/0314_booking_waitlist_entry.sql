-- 0314_booking_waitlist_entry
-- Spec 03b task 3b.1. The single-file waitlist queue (`EngWaitlist`, task 3b.4), automatic offering
-- with a 2-hour claim window (§7's `waitlist_offer_expiry` job).
--
-- ★★ NEVER DELETED, ONLY TRANSITIONED. Spec 03b §3: "booking_waitlist_entry rows are never deleted,
--    only transitioned to expired/removed/claimed (History and the EngWaitlist 'since' column both
--    need the full life of an entry)." No DELETE grant, no FOR DELETE policy — same discipline
--    `keystone.invite` (0202) already uses for the identical reason.
--
-- ★ Standard tenant-isolation shape (SELECT + tenant-scoped INSERT + tenant-scoped UPDATE), copied
--   verbatim from `keystone.invite` (0202) / `keystone.feature_flag_practice` (0213) — no delete.

CREATE TABLE keystone.booking_waitlist_entry (
  id                 uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id          uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  -- ★ 'slot' = a specific coach/service slot that just freed up; 'coach_request' = a coach manually
  --   added someone to the queue for a service, not yet tied to a specific freed slot.
  kind               text        NOT NULL CHECK (kind IN ('slot', 'coach_request')),
  service_id         uuid        NOT NULL REFERENCES keystone.service(id) ON DELETE RESTRICT,
  host_id            uuid        NULL REFERENCES keystone.app_user(id) ON DELETE SET NULL,
  client_user_id     uuid        NULL REFERENCES keystone.app_user(id) ON DELETE SET NULL,
  display_name       text        NOT NULL,
  email              text        NOT NULL,
  phone              text        NULL,
  position           integer     NOT NULL,
  status             text        NOT NULL DEFAULT 'waiting'
                        CHECK (status IN ('waiting', 'offered', 'claimed', 'expired', 'removed')),
  offered_starts_at  timestamptz NULL,
  offered_ends_at    timestamptz NULL,
  offer_expires_at   timestamptz NULL,
  source_tag         text        NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  -- ★★ An 'offered' entry must carry the shape of an offer — the slot it was offered and when the
  --    offer lapses. Every other status carries neither (not enforced further here: the job/route
  --    layer, task 3b.4, is what actually clears these columns on expiry/claim/removal).
  CONSTRAINT waitlist_offer_shape CHECK (
    status <> 'offered' OR (offered_starts_at IS NOT NULL AND offer_expires_at IS NOT NULL)
  )
);

-- ★ EngWaitlist's own read shape: per host+service queue, ordered by position, filterable by status
--   (spec 03b §2.3's `GET /api/records/booking-waitlist` filters: coach, status, tab).
CREATE INDEX booking_waitlist_entry_queue_idx
  ON keystone.booking_waitlist_entry (tenant_id, service_id, host_id, status, position);

ALTER TABLE keystone.booking_waitlist_entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.booking_waitlist_entry FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON keystone.booking_waitlist_entry
  USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert ON keystone.booking_waitlist_entry
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update ON keystone.booking_waitlist_entry
  FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
          WITH CHECK (tenant_id = keystone.require_tenant_id());

-- No DELETE grant and no FOR DELETE policy: an entry is transitioned, never removed (spec 03b §3).
GRANT SELECT, INSERT, UPDATE ON keystone.booking_waitlist_entry TO app_rw;

COMMENT ON TABLE keystone.booking_waitlist_entry IS
  'Spec 03b / 0314. The waitlist queue behind EngWaitlist (task 3b.4). kind=slot is generated when a
   booked slot is requested and none is free; kind=coach_request is a coach manually adding someone
   (spec 03b §2.3, POST /api/engagements/waitlist). A freed slot offers the next waiting entry
   (status→offered, offer_expires_at set, waitlist_claim link_token minted, 0315) for a 2-hour window
   (waitlist_offer_expiry job, spec 03b §7); unclaimed, it advances to the next entry. Never deleted
   — only transitioned to expired/removed/claimed, so History and the "since" column can show the
   full life of an entry.';
