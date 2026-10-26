-- 0397_app_user_bio_and_photo — Stage 13 task 13.2 · G19 · CT-F06
--
-- staff rows can carry a public bio and photo pointer. Written in My settings (Stage 17, F12
-- §2.13); read by public booking cards (13.20) and the practice-name chooser. R-13.2 (STAGE-13-PLAN
-- §"Rulings applied in this plan"): "Add app_user.bio + app_user.photo_url … Tasks 13.2, 13.20,
-- 13.38 as written." Built exactly to that SQL.
--
-- ★ NOTE FOR THE NEXT READER (flagged, not resolved here — 13.2 does not own CONTRACTS.md): the
-- photo_url shape below accepts BOTH 'ks-object:' and 'https://'. CONTRACTS.md CT-F06's ruling R-B
-- says "a staff photo holds a ks-object: pointer only, never an external https:// URL … Stage 17's
-- rule wins over Stage 13's" — narrower than this CHECK. This migration is built to STAGE-13-PLAN.md
-- §13.2's literal "Replace with" SQL per R-13.2 ("as written"); the https:// vs ks-object:-only
-- shape conflict between R-13.2 and CT-F06 R-B is unresolved and reported, not silently picked.
ALTER TABLE keystone.app_user
  ADD COLUMN bio text NULL
    CONSTRAINT app_user_bio_length CHECK (bio IS NULL OR char_length(bio) <= 600),
  ADD COLUMN photo_url text NULL
    CONSTRAINT app_user_photo_url_shape CHECK (photo_url IS NULL OR
      (char_length(photo_url) <= 500 AND photo_url ~ '^(ks-object:|https://)')),
  ADD CONSTRAINT app_user_bio_photo_staff_only CHECK ((bio IS NULL AND photo_url IS NULL) OR role = 'staff');

COMMENT ON COLUMN keystone.app_user.bio IS
  'G19/CT-F06. Staff-only free-text bio, <=600 chars, nullable. Read by public booking cards (13.20).';
COMMENT ON COLUMN keystone.app_user.photo_url IS
  'G19/CT-F06. Staff-only photo pointer, <=500 chars, ks-object: or https:// only. Read by public booking cards (13.20) and (once built) GET /api/settings/mine/photo/:userId.';

-- Existing FORCED RLS policies on keystone.app_user (0001) already cover these new columns; app_rw
-- already holds table-level UPDATE on keystone.app_user (0001) — no grant change here (MEASURED).
