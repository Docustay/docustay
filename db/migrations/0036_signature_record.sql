-- 0036_signature_record
-- P15C.7 — ★★★ THERE IS NO SIGNATURE TABLE AMONG THE 41. `partially_signed` IS A STATE WITH NOTHING
--              BEHIND IT.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- [MEASURED] `document_instance.state` includes `partially_signed` (0009) and **no table records who
-- signed what.** `recordSignature` (P15B.8) moves the state and emits an event whose payload says
-- `signature_record_stored: false`, because there was nowhere to store one.
--   ★★ So "partially signed" meant: somebody told the database that somebody signed. **WHICH party,
--      WHEN, in what ORDER, and against which words — none of it existed.** That is not a partial
--      signature; it is a rumour with a state column.
--   ★ And signing ORDER lived only in JS arrays (`SIGNER_CONFIGS`, vocabulary.mjs) — so out-of-order
--     countersigning could not be refused by anything that a bypassed module could not route around.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ ONE ROW PER PARTY, CARRYING THE PREVIOUS ROW'S HASH. A CHAIN, NOT A LIST.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Each row hashes (instrument, role, order, signer, time, mark digest, PREVIOUS row's hash). So the
-- signatures on one instrument form a chain whose tail cannot be recomputed without every link.
--   ★★ WHY A CHAIN AND NOT JUST TIMESTAMPS: a set of independent rows can be reordered, back-dated or
--      have one silently removed, and nothing in the data disagrees. With a chain, removing row 2
--      makes row 3's `prev_hash` reference a row that is not there, and altering row 2 makes row 3's
--      hash wrong. **The evidence checks itself.**
--   ★ This is the same discipline as §Z4's price supersede and 0032's acceptance store: on an object
--     that settles a legal question, the record is append-only and self-describing.
--
-- ★★ WHAT THIS TABLE IS NOT: it is not the MARK. The per-block marks live in the instrument's stored
--    values (see src/documents/storedSignatures.mjs — one signer applies their mark to every block they
--    own, each an individual acknowledgment). This table is the authority for **WHO, WHEN and IN WHAT
--    ORDER**, and it carries a DIGEST of the mark rather than the mark itself, so the two cannot drift
--    without detection while the bytes stay in one place.

CREATE TABLE keystone.signature_record (
  id            uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id     uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  instance_id   uuid        NOT NULL REFERENCES keystone.document_instance(id) ON DELETE RESTRICT,

  -- ★★★ THE PARTY, BY NAME. The same closed vocabulary as everywhere else, and `both` IS NOT IN IT:
  --     "either side may act" is an assignment, not a signer. A row saying `both` signed would name
  --     nobody. (CLAUDE.md §2.7 — name the party you mean, never borrow another's.)
  role          text        NOT NULL CHECK (role IN
                  ('pir','parent','coach','client','consultant','familyMember','recipient')),

  -- ★ WHERE THIS PARTY SITS IN THE ORDER, 1-based. Comes from SIGNER_CONFIGS' array position, which is
  --   exposed FROM THE SERVER — the front end must not re-declare it (P4.10 measured what a second
  --   declaration costs).
  signer_order  integer     NOT NULL CHECK (signer_order >= 1),

  -- ★★ WHO, as a real person. NULL is permitted for one reason only, stated: an in-person signing on
  --    shared staff hardware where the signer has no account yet. `signer_name` is then the record of
  --    who it was, and it is NOT NULL — a signature attributable to nobody at all is not evidence.
  signer_uid    uuid        REFERENCES keystone.app_user(id) ON DELETE RESTRICT,
  signer_name   text        NOT NULL CHECK (length(btrim(signer_name)) > 0),

  -- ★★★ TWO TIMES, AND THEY ARE DIFFERENT CLAIMS.
  --   · `signed_at`         — when the SERVER recorded it. Authoritative, monotonic, ours.
  --   · `signed_local_date` — the date on the SIGNER'S OWN DEVICE, as a plain date, plus their zone.
  --     A person in Los Angeles signing at 5pm on the 1st must not see "Aug 2" on their own agreement
  --     because the server is in UTC. §B4 STEP 3's discipline: the zone is part of the fact.
  --   ★ `signed_local_date` is TEXT `YYYY-MM-DD` on purpose — it is a WALL-CLOCK DATE with no instant
  --     behind it, and storing it as a timestamp would invent a midnight that then shifts by zone.
  signed_at         timestamptz NOT NULL DEFAULT now(),
  signed_local_date text        CHECK (signed_local_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  signer_timezone   text,

  -- ★ Evidence of the medium, as for the disclosure (0032): 15 U.S.C. 7001(c)(1) element (g).
  user_agent    text,
  signer_ip     text,

  -- ★★ A DIGEST OF THE MARK, not the mark. sha256 hex. Lets a reader prove the mark on screen is the
  --    mark that was signed, without a second copy of the bytes to drift from the first.
  mark_sha256   text        CHECK (mark_sha256 IS NULL OR mark_sha256 ~ '^[0-9a-f]{64}$'),

  -- ★★★ THE CHAIN. `prev_hash` is NULL for the FIRST signature on an instrument and is the previous
  --     row's `row_hash` thereafter; `row_hash` covers this row's facts AND `prev_hash`.
  prev_hash     text        CHECK (prev_hash IS NULL OR prev_hash ~ '^[0-9a-f]{64}$'),
  row_hash      text        NOT NULL CHECK (row_hash ~ '^[0-9a-f]{64}$'),

  created_at    timestamptz NOT NULL DEFAULT now(),

  -- ★ A zoneless local date is a date nobody can place. If one is given, the zone comes with it.
  CONSTRAINT local_date_carries_its_zone
    CHECK ((signed_local_date IS NULL) = (signer_timezone IS NULL))
);

-- ★★★ ONE SIGNATURE PER PARTY PER INSTRUMENT. A re-sign SUPERSEDES by being refused and re-issued, not
--     by stacking two rows that disagree about when the party signed.
CREATE UNIQUE INDEX signature_record_one_per_party
  ON keystone.signature_record (instance_id, role);

-- ★★ AND THE ORDER POSITION IS UNIQUE TOO. Two parties both claiming position 2 makes "who signed
--    second" unanswerable, which is exactly the question an order dispute turns on.
CREATE UNIQUE INDEX signature_record_one_per_position
  ON keystone.signature_record (instance_id, signer_order);

CREATE INDEX signature_record_tenant_idx ON keystone.signature_record (tenant_id);
CREATE INDEX signature_record_instance_idx
  ON keystone.signature_record (instance_id, signer_order);

-- ═════════════════════════════════════════════════════════════════════════════
-- ★★★ APPEND-ONLY, AND THE DATABASE ENFORCES IT — NOT THE MODULE.
-- ═════════════════════════════════════════════════════════════════════════════
-- A signature that can be edited is not a signature. Same shape as `price_is_append_only` (0024) and
-- `esign_acceptance_is_append_only` (0032), for the same reason: these three tables are the ones whose
-- rows settle a question about the past.
CREATE OR REPLACE FUNCTION keystone.signature_record_is_immutable()
  RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $fn$
BEGIN
  RAISE EXCEPTION
    'a signature record is evidence and is never % — it states who signed, when, and in what order, '
    'and an instrument already executed quotes it. To correct one, void the instrument and issue a '
    'new one.', CASE TG_OP WHEN 'DELETE' THEN 'deleted' ELSE 'changed' END
    USING ERRCODE = 'check_violation';
END;
$fn$;

CREATE TRIGGER signature_record_no_update
  BEFORE UPDATE ON keystone.signature_record
  FOR EACH ROW EXECUTE FUNCTION keystone.signature_record_is_immutable();

CREATE TRIGGER signature_record_no_delete
  BEFORE DELETE ON keystone.signature_record
  FOR EACH ROW EXECUTE FUNCTION keystone.signature_record_is_immutable();

-- ═════════════════════════════════════════════════════════════════════════════
-- ★★★ THE ORDER IS ENFORCED IN THE DATABASE, NOT ONLY IN THE MODULE.
-- ═════════════════════════════════════════════════════════════════════════════
-- [MEASURED] signing order lived ONLY in `SIGNER_CONFIGS`' JS arrays. A module can be bypassed; a
-- trigger cannot. ★ Position N may only be signed once positions 1..N-1 exist for this instrument.
CREATE OR REPLACE FUNCTION keystone.signature_record_in_order()
  RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $fn$
DECLARE
  expected integer;
BEGIN
  SELECT COALESCE(max(signer_order), 0) + 1 INTO expected
    FROM keystone.signature_record WHERE instance_id = NEW.instance_id;

  IF NEW.signer_order <> expected THEN
    RAISE EXCEPTION
      'this instrument expects signature position % next and this row claims position % — signing out '
      'of order is refused. A countersignature before the client''s signature is not a countersignature; '
      'it is a staff member agreeing with nobody.',
      expected, NEW.signer_order
      USING ERRCODE = 'check_violation';
  END IF;

  -- ★★ AND THE CHAIN MUST BE CONTINUOUS. The first signature has no predecessor; every later one must
  --    carry the CURRENT tail's hash. A row whose prev_hash points at something else is either
  --    back-dated or built from a stale read, and both make the chain unverifiable.
  IF expected = 1 THEN
    IF NEW.prev_hash IS NOT NULL THEN
      RAISE EXCEPTION 'the FIRST signature on an instrument has no predecessor, so prev_hash must be NULL'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF NEW.prev_hash IS DISTINCT FROM (
      SELECT row_hash FROM keystone.signature_record
        WHERE instance_id = NEW.instance_id ORDER BY signer_order DESC LIMIT 1)
    THEN
      RAISE EXCEPTION
        'prev_hash does not match the current last signature on this instrument. The chain is what '
        'makes the order provable — a link that does not join is a signature built from a stale read, '
        'or an attempt to insert one behind another.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

CREATE TRIGGER signature_record_order
  BEFORE INSERT ON keystone.signature_record
  FOR EACH ROW EXECUTE FUNCTION keystone.signature_record_in_order();

-- ═════════════════════════════════════════════════════════════════════════════
-- RLS — the same regime as every other tenant table.
-- ═════════════════════════════════════════════════════════════════════════════
ALTER TABLE keystone.signature_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.signature_record FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON keystone.signature_record
  USING (tenant_id = keystone.current_tenant_id())
  WITH CHECK (tenant_id = keystone.require_tenant_id());

-- ★ INSERT and SELECT only. No UPDATE, no DELETE — the triggers refuse them anyway, and a grant that
--   implies otherwise invites code that expects to succeed.
GRANT SELECT, INSERT ON keystone.signature_record TO app_rw;

COMMENT ON TABLE keystone.signature_record IS
  'P15C.7. One row per party per instrument: role, 1-based signer_order, who, when (server instant AND '
  'the signer''s own local date with its zone), a DIGEST of the mark, and the previous row''s hash. '
  'Before this table `partially_signed` was a state with nothing behind it — the event payload said '
  'signature_record_stored:false because there was nowhere to store one. Append-only and in-order by '
  'TRIGGER, not by convention: signing order previously existed only in JS arrays, and a module can be '
  'bypassed.';
