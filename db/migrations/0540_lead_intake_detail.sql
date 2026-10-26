-- 0540 — LEAD INTAKE (Ty's spec, 30 Sep 2026): the public lead form's own facts about a lead.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ [MEASURED, 30 Sep 2026 recon] `keystone.app_user` already carries `lifecycle_status`
--     ('lead'|'active'|'paused'|'former', 0076) and `source` (free text, 0076) — the REAL, already-
--     wired path a lead becomes a client record (`src/routes/public.mjs`'s `/go/:pageSlug/lead`
--     already creates one this way, via `createPerson(..., lifecycleStatus: 'lead', source: ...)`).
--     Nothing existing carries WHICH SERVICE a lead is interested in or WHEN to call them back —
--     the two facts Ty's spec requires the client record to "visibly show" that have no home yet.
--     The free-text note has one already (`app_user.notes`); the consent has one already
--     (`keystone.consent_record`, `consent_type = 'sms_marketing'`, 0489) — neither is duplicated
--     here.
--
-- ★ FOUR NEW COLUMNS, ALL NULLABLE — every existing person has none of these facts, same reasoning
--   0539 gives for its own four nullable columns.
--   · lead_service_id / lead_service_name — a reference into `growth.lead_interests` (a tenant
--     SETTING, keys.mjs, not a real bookable `keystone.service` row — recon found only ONE real
--     bookable service exists for GLRS today, "Single Session (Life Coaching)", not the six the
--     public site lists). `lead_service_name` is a SNAPSHOT (same shape `document_instance.title`
--     already snapshots `document_template.name`) so a later edit to the settings list never
--     rewrites what a past lead was shown choosing.
--   · lead_best_time_date / lead_best_time_window — the weekday + Morning/Afternoon/Evening slot
--     the person asked to be called. `lead_best_time_window` is CHECKed against the three real
--     values the public form offers; NULL means no preference was given (not a fourth value).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

ALTER TABLE keystone.app_user ADD COLUMN IF NOT EXISTS lead_service_id text;
ALTER TABLE keystone.app_user ADD COLUMN IF NOT EXISTS lead_service_name text;
ALTER TABLE keystone.app_user ADD COLUMN IF NOT EXISTS lead_best_time_date date;
ALTER TABLE keystone.app_user ADD COLUMN IF NOT EXISTS lead_best_time_window text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'app_user_lead_best_time_window_check'
  ) THEN
    ALTER TABLE keystone.app_user
      ADD CONSTRAINT app_user_lead_best_time_window_check
      CHECK (lead_best_time_window IS NULL OR lead_best_time_window IN ('morning', 'afternoon', 'evening'));
  END IF;
END $$;
