-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- P8.10 — THE ROW THAT MAKES A MISSING BACKUP VISIBLE.
--
-- ★★★ `scripts/backup.sh` IS GOOD AND HAS NEVER RUN, AND THOSE TWO FACTS LOOK IDENTICAL FROM
--     INSIDE THE SYSTEM. [MEASURED] the script is 4,871 bytes, dumps the database, dumps the roles
--     separately (they are cluster-wide and NOT in a `pg_dump`), records checksums, **restores into
--     a scratch database and diffs the object inventory** — the verification step nearly everyone
--     skips — and exits non-zero unless the restore matches. [EXECUTED] it has **zero references
--     anywhere**: no cron, no Railway task, no worker job.
--
-- ★★★ SO THE MISSING PIECE IS NOT A BACKUP MECHANISM. IT IS THE ABILITY TO NOTICE. A system whose
--     backups silently stopped six weeks ago is indistinguishable from one backing up nightly,
--     because nothing anywhere records that a backup happened. This table is that record, and
--     `src/health/watch.mjs` is what reads it and goes amber, then red, as it ages.
--   ★★ THE ROW IS WRITTEN ONLY AFTER THE RESTORE VERIFIES. `verified` exists so an unverified dump
--      cannot quiet the alarm — *"a backup that has never been restored is not a backup"*, and
--      ERPNext was deleted with no backups on exactly that kind of promise. A failed verification
--      still writes a row, with `verified = false`, because "it ran and failed" and "it never ran"
--      are different facts and only one of them means somebody needs to look at the script.
--
-- ★ IT LIVES IN `keystone_meta`, BESIDE `schema_migrations`, AND IS NOT TENANT-SCOPED. A backup is
--   of the whole database — there is no tenant whose backup this is, and putting it in `keystone`
--   would mean inventing a tenant_id for a fact that has none, then exempting it from RLS.
--
-- ★★ AND THE DESTINATION IS STILL A BLOCKER, RECORDED RATHER THAN QUIETLY DROPPED. The script
--    writes to a local directory. A backup of a production database sitting on the same laptop that
--    might die is half a backup, and `KEYSTONE_S3_*` is unset (`src/storage/s3.mjs` refuses to
--    default an endpoint, deliberately). The clearing command is in HANDOFF.md as D-18.4. **This
--    table makes the gap loud instead of silent; it does not close it.**
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS keystone_meta.backup_run (
  id            bigserial   PRIMARY KEY,
  started_at    timestamptz NOT NULL,
  finished_at   timestamptz NOT NULL DEFAULT now(),
  -- ★ Which database this was a backup OF. One script, several targets (local and deployed), and a
  --   row that did not say which would let a local dump silence an alarm about production.
  target        text        NOT NULL,
  dump_bytes    bigint      NOT NULL CHECK (dump_bytes >= 0),
  object_count  integer     NOT NULL CHECK (object_count >= 0),
  verified      boolean     NOT NULL,
  destination   text,       -- ★ NULL = local only. Non-null once it is shipped off-platform.
  note          text
);

COMMENT ON TABLE keystone_meta.backup_run IS
  'P8.10. One row per backup attempt, written by scripts/backup.sh AFTER its restore check. Exists so that "backups stopped six weeks ago" is visible instead of identical to "backups are fine".';
COMMENT ON COLUMN keystone_meta.backup_run.verified IS
  'true only when the dump was restored into a scratch database and its object inventory matched the source. An unverified dump must never quiet the alarm.';
COMMENT ON COLUMN keystone_meta.backup_run.destination IS
  'Where the dump was shipped. NULL means it is only on the machine that made it — half a backup. See HANDOFF.md D-18.4.';

CREATE INDEX IF NOT EXISTS backup_run_recent ON keystone_meta.backup_run (target, finished_at DESC);

-- ★ The app role READS this (the health check) and does not write it: the writer is a shell script
--   connecting as an administrator, and a web process that could forge a backup record could quiet
--   its own alarm.
GRANT SELECT ON keystone_meta.backup_run TO app_rw;
