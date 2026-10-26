-- 0022_record_page
-- P15.2a (F12) · P15.2b (F13) · P15.2 (F14, U3) · P15.5 read paths
--
-- ★★★ THIS MIGRATION EXISTS BECAUSE THREE OF THE SEVEN RECORD DESCRIPTORS WERE MEASURED BROKEN
-- AGAINST A REAL ROW, AND EVERY ONE OF THEM PASSES A SOURCE-TEXT CHECK. BUILD-UI.md Part 0:
-- "Every item below is a defect in code that is already written, already gated, and already
-- green. None of them was found by a gate."
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 1 · F12 / P15.2a — `document_instance` HAS NO COLUMN THAT CAN TITLE A DOCUMENT.
-- ─────────────────────────────────────────────────────────────────────────────
-- [MEAS 2026-09-13, information_schema] document_instance's columns are id, tenant_id,
-- template_id, builder, subject_user_id, state, template_snapshot, sent_at, executed_at,
-- created_at, updated_at, type_id, assigned_to, deleted. `RECORD_TYPES.document.header.title`
-- is 'name'. THERE IS NO `name`. Every document record page renders a NULL TITLE.
--
-- ★★★ THE TWO ALTERNATIVES BUILD-UI.md OFFERS WERE BOTH MEASURED AND BOTH FAIL — recorded here
-- because the item says "decide and implement", and the decision is the content:
--
--   (a) "point the descriptor at the TEMPLATE's name through a join".
--       [MEAS] `document_instance.template_id` IS NULLABLE (is_nullable=YES). A LEFT JOIN
--       therefore returns NULL for any instance with no template — which is F12 again, moved
--       one table to the left and harder to see.
--       ★★★ AND IT BREAKS HARD LIMIT 3. `document_template.name` is an ordinary editable
--       column with no freeze. Renaming a template would RETITLE EVERY ALREADY-EXECUTED
--       INSTRUMENT SIGNED AGAINST IT. "Nothing changed on any signed instrument" is not
--       satisfied by a change that arrives through a join instead of an UPDATE.
--
--   (b) read `template_snapshot->>'name'`.
--       [MEAS] `template_snapshot` IS NULLABLE, and `executed_shape` (0009) only forces it
--       NOT NULL once state = 'executed'. So every draft, sent and partially_signed document —
--       i.e. everything on the Pipeline screen, which is the screen that exists to show work in
--       motion — would title as NULL. The defect would survive exactly where it is most visible.
--
-- ★★ THEREFORE: A COLUMN, NOT NULL, WRITTEN AT CREATION AND NEVER RECOMPUTED. The title is a
-- fact about the instrument at the moment it was raised, in the same family as
-- `line_item.name_snapshot` (0015) and `subscription.snapshot_amount_minor` — both of which
-- already exist in this schema for the identical reason. This is the house pattern, not a new
-- idea.
--
-- ★ BACKFILL HONESTY: [MEAS 2026-09-13] `SELECT count(*) FROM keystone.document_instance` = 0.
--   There is nothing to backfill and the statement below touches zero rows FOR THAT REASON, not
--   because FORCE RLS silently swallowed it (0010:42-74 records that happening once already).
--   The UPDATE is written anyway, and it runs as app_owner with no tenant GUC set — so if this
--   migration is ever replayed against a populated database it must be re-examined, which is
--   what the ★ on the ALTER … SET NOT NULL is for: it will REFUSE rather than invent a title.

ALTER TABLE keystone.document_instance ADD COLUMN title text;

-- ★ Best-effort backfill from the template for any pre-existing row. Deliberately NOT coalesced
--   to a literal like 'Untitled': a document with no discoverable title must stop this migration
--   and be looked at, not be given a plausible-looking name by a machine.
UPDATE keystone.document_instance di
   SET title = t.name
  FROM keystone.document_template t
 WHERE t.id = di.template_id
   AND di.title IS NULL;

-- ★★ THIS IS THE GUARD, NOT A FORMALITY. If any row survived the backfill with a NULL title the
--    next statement raises and the whole migration rolls back.
ALTER TABLE keystone.document_instance ALTER COLUMN title SET NOT NULL;

ALTER TABLE keystone.document_instance
  ADD CONSTRAINT document_instance_title_nonblank CHECK (btrim(title) <> '');

COMMENT ON COLUMN keystone.document_instance.title IS
  'The instrument''s own title, frozen at creation from the template name. NOT a join to '
  'document_template: template_id is nullable and a template rename would retitle an already '
  'EXECUTED instrument, which hard limit 3 forbids. Same family as line_item.name_snapshot.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2 · P15.5 — THE PER-PERSON BOOKING LOOKUP HAS NO INDEX.
-- ─────────────────────────────────────────────────────────────────────────────
-- [MEAS] booking_participant carries `booking_participant_booking (tenant_id, booking_id)` and
-- a uniqueness index on (tenant_id, booking_id, party, display_name). NOTHING indexes
-- app_user_id. U3's "next session" and "engagement" highlights both ask the opposite question —
-- "which bookings does THIS PERSON have" — and every person record page asks it.
-- ★ Partial on app_user_id IS NOT NULL: a participant row may name an off-platform invitee by
--   display_name and email with no app_user row, and those never match this predicate.
CREATE INDEX booking_participant_person
  ON keystone.booking_participant (tenant_id, app_user_id)
  WHERE app_user_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3 · F13 / P15.2b — THE ACTIVITY FEED POINTS AT A TABLE THAT DOES NOT EXIST.
-- ─────────────────────────────────────────────────────────────────────────────
-- [MEAS] `buildRecordShell` appends `activity: { … of: 'audit_event' }` (shell.mjs:171) and
-- `audit_event` has ONE hit in the entire project — that line. The real table is `keystone.event`,
-- which already carries (subject_type, subject_id) and already has `event_subject` indexing
-- exactly that pair. ★ NO SCHEMA CHANGE IS NEEDED and none is made here: the fix is in
-- shell.mjs and in the read query. This block exists so that a reader of the migrations can see
-- WHY there is no migration for F13, rather than concluding it was forgotten.
--
-- ★★ What IS needed is that the feed reads something. A region pointing at a real table with no
--    query behind it is the same silent-empty failure, one layer down. src/records/queries.mjs
--    supplies the read and db/gates/p15_crm_screens.mjs asserts a seeded event reaches the DOM.

-- ─────────────────────────────────────────────────────────────────────────────
-- 4 · B2.1 / P15.5a — SERVICE AND PLAN PRICES.
-- ─────────────────────────────────────────────────────────────────────────────
-- [MEAS] `price_lookup (tenant_id, subject_type, subject_id, effective_from DESC)` ALREADY
-- EXISTS (0015). The repoint is a query change, not a schema change, and `price_minor` is
-- DELIBERATELY LEFT IN PLACE — dropping it is the contract half of an expand/contract and is
-- not this phase's business (B2.1 says so in those words).
--
-- ★★ THE RULE THE QUERY MUST EXPRESS, FROM §Z4: a thing is SELLABLE only when its definition is
--    active AND an active price row covers now(). Two conditions, not one. A service with
--    active=true and no live price row is not sellable, and the screen must not imply it is.
