-- 0002_uuidv7_no_pgcrypto
--
-- Replaces keystone.uuid_generate_v7() so it no longer depends on pgcrypto.
--
-- ★ WHY THIS IS A NEW MIGRATION RATHER THAN AN EDIT TO 0001: 0001 is already applied, and the
-- runner refuses to proceed when an applied migration's checksum no longer matches its file.
-- That refusal is correct — an edited applied migration means the database and the repo disagree
-- about what the schema is, and every later reasoning step inherits the confusion. Forward-only.
--
-- ★ WHY IT BROKE: `gen_random_bytes()` lives in the **pgcrypto** extension, which is not
-- installed. `gen_random_uuid()` is DIFFERENT — it has been core Postgres since 13 and needs no
-- extension. The two names look related and are not. The failure only surfaced at INSERT time,
-- because CREATE FUNCTION does not resolve function bodies at definition time for plpgsql.
--
-- This version takes 16 random bytes from the built-in gen_random_uuid() and overwrites the
-- first 6 with the timestamp, then re-stamps the version and variant nibbles. Same output
-- shape, same ordering property, no extension.

CREATE OR REPLACE FUNCTION keystone.uuid_generate_v7()
RETURNS uuid
LANGUAGE plpgsql
VOLATILE            -- ★ still VOLATILE: one key per row, never folded to a constant
AS $$
DECLARE
  unix_ms bigint;
  b bytea;
BEGIN
  unix_ms := (extract(epoch from clock_timestamp()) * 1000)::bigint;

  -- 16 random bytes, courtesy of the CORE gen_random_uuid() (no pgcrypto).
  b := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');

  -- Overwrite bytes 0..5 with the 48-bit big-endian millisecond timestamp.
  b := set_byte(b, 0, ((unix_ms >> 40) & 255)::int);
  b := set_byte(b, 1, ((unix_ms >> 32) & 255)::int);
  b := set_byte(b, 2, ((unix_ms >> 24) & 255)::int);
  b := set_byte(b, 3, ((unix_ms >> 16) & 255)::int);
  b := set_byte(b, 4, ((unix_ms >>  8) & 255)::int);
  b := set_byte(b, 5, ( unix_ms        & 255)::int);

  -- version 7 in the high nibble of byte 6
  b := set_byte(b, 6, ((get_byte(b, 6) & 15) | 112));
  -- RFC 4122 variant (10xx) in the high bits of byte 8
  b := set_byte(b, 8, ((get_byte(b, 8) & 63) | 128));

  RETURN encode(b, 'hex')::uuid;
END $$;

COMMENT ON FUNCTION keystone.uuid_generate_v7() IS
  'UUIDv7 built on core gen_random_uuid() — NOT pgcrypto''s gen_random_bytes(). VOLATILE on purpose.';

GRANT EXECUTE ON FUNCTION keystone.uuid_generate_v7() TO app_rw;
