# Back up and restore

A self-hosted Docustay keeps its state in three places. Back up all three, together, or the backup may not restore.

| What | Where | Why it matters |
|---|---|---|
| The database | the `db` container (volume `dbdata`) | People, templates, documents, settings, the audit trail. |
| The file store | the `storage` container (volume `filedata`) | Uploaded files and signed PDFs, each sealed with its workspace's own key (see below). |
| The app data volume and `.env` | volume `appdata` and the file `docustay/.env` | The certificate that seals signed PDFs, the key that protects stored passwords, and the secrets behind sign-in. Without them a restored copy cannot open what it stored. |

## Back up

Run this from the `docustay` folder. It writes one dated folder.

```bash
set -eu
d="backup-$(date +%Y%m%d-%H%M)"; mkdir -p "$d"
# 1. the database, as one consistent file
docker compose exec -T db pg_dump -U docustay -Fc docustay > "$d/db.dump"
# 2. the file store and the app data volume, as archives
# the volumes are named after the Compose project (docustay_filedata for a standard install); a wrong name would silently back up an empty volume, so ask the running database container which project it belongs to, then check the volumes exist
pj=$(docker inspect "$(docker compose ps -q db)" --format '{{ index .Config.Labels "com.docker.compose.project" }}')
for v in filedata appdata; do
  docker volume inspect "${pj}_$v" >/dev/null || { echo "no volume ${pj}_$v: run this from the install folder" >&2; exit 1; }
  docker run --rm -v "${pj}_$v:/v:ro" -v "$PWD/$d:/out" alpine tar czf "/out/$v.tgz" -C /v .
done
# 3. the settings file
cp .env "$d/env"; chmod 600 "$d/env"
# 4. check the folder is whole: every file exists and is not empty
for f in db.dump filedata.tgz appdata.tgz env; do
  [ -s "$d/$f" ] || { echo "BACKUP INCOMPLETE: $d/$f is missing or empty" >&2; exit 1; }
done
ls -l "$d"
echo "backed up to $d"
```

Copy the folder somewhere that is not this machine. The folder holds secrets, so keep it as private as the install itself.

## Restore on a new machine

The database dump holds the tables but not the database's logins (the roles the app and the worker connect as). Those are created the first time the install starts, so a restore starts the install once on an empty database first. Restoring into a database that has no roles leaves the worker without access to its own tables and the install crash-loops with "permission denied for schema graphile_worker".

1. Install Docker and get the Docustay folder (`git clone`, then `cd docustay`).
2. Put the saved settings file back: `cp backup-…/env .env`
3. Start the install once on its empty database so it creates its roles and tables, and wait until `app` says `(healthy)`:

```bash
docker compose up -d
docker compose ps
```

4. Stop everything that writes, and the file store as well, keeping only the database running (the file store reads its files when it starts, so if it keeps running while its volume is replaced it carries on serving the empty volume it had, and every signed copy answers 502):

```bash
docker compose stop app worker web storage
```

5. Empty the database of what the first start created, then load the dump. The first start made the tables of the version you have checked out, and an older backup does not contain every one of them, so loading over them with `--clean` is refused ("cannot drop … because other objects depend on it"). Dropping the five application schemas first works for a backup from any older version, and the install brings the restored database up to date the next time it starts:

```bash
docker compose exec -T db psql -U docustay -d docustay -v ON_ERROR_STOP=1 -c "DROP SCHEMA IF EXISTS keystone, keystone_auth, keystone_meta, graphile_worker, stripe, metrics CASCADE; DROP FUNCTION IF EXISTS public.set_updated_at() CASCADE;"
docker compose exec -T db pg_restore -U docustay -d docustay < backup-…/db.dump
```

`pg_restore` should print nothing and finish without an error. If it prints errors, stop and do not go on to step 6.

6. Load the two volumes:

```bash
pj=$(docker inspect "$(docker compose ps -q db)" --format '{{ index .Config.Labels "com.docker.compose.project" }}')
for v in filedata appdata; do
  docker run --rm -v "${pj}_$v:/v" -v "$PWD/backup-…:/in:ro" alpine sh -c "cd /v && tar xzf /in/$v.tgz"
done
```

7. Start everything, the file store included, and check it: `docker compose up -d`, then run `docker compose ps` and open the app. Every service should be `Up`, and `app` should say `(healthy)`. The app's own `/readyz` check (see [Upgrade](/docs/self-host-upgrade.md)) says `not_ready` for about ten seconds while the file store loads its files, then `ready`; it lists the migrations applied, which will be more than the old install's if you restored an older backup, because the start brings the database up to date.

## Your files are sealed: what that means for a backup

Docustay encrypts every file it stores (uploads, signed copies, certificates, printed templates) before it reaches the file store, with a data key that belongs to the workspace alone. The data key is kept in the database, sealed under `KEYSTONE_MASTER_KEY` from your `.env`. So a file opens only when **all three** are present: the file store, the database, and the `.env` key.

- A copy of the file store without the database cannot be opened. A database without the file store has no files. A restored database and file store with a **different** `KEYSTONE_MASTER_KEY` cannot be opened either, so keep the `.env` backup, apart from the others, as carefully as the key itself.
- Take the database dump and the file-store archive at the same time (the backup script above does). A workspace key is never deleted while the workspace exists, so a dump taken after a file was stored always holds the key that opens it; a dump older than a key rotation does not hold the newer key, and files moved onto it afterwards will not open from that older dump.
- After a restore, check that the files open. This reads up to 20 stored files for one workspace and prints whether each opens; it changes nothing. The workspace id is the first column of `docker compose exec app node docustay/entrypoint.mjs run scripts/file-keys.mjs status`:

```bash
WORKSPACE_ID="paste-a-workspace-id"   # the first column of the status command above
docker compose exec app node docustay/entrypoint.mjs run scripts/file-keys.mjs verify "$WORKSPACE_ID"
```

`status` lists every workspace's keys. `rotate <workspace id>` makes a new key active and moves that workspace's files onto it; `seal` runs the same pass the worker runs at every start (it seals any file stored before encryption was switched on, and does nothing when there is nothing to do). Once every workspace shows "all files sealed", you can set `DOCUSTAY_REFUSE_PLAINTEXT_FILES=on` in `.env` so a file in the store that is not sealed is refused instead of served.

## After a restore: carry out the deletions again

A restore rewinds the database, so a person or a workspace that was deleted after the backup was taken comes back with it. Every deletion Docustay carries out leaves one small entry in a deletion ledger in the file store (under `_platform_ledger/deletion/`): a SHA-256 of the lower-cased email address or the workspace id, the date and a request id, never a name. After the restore, and once the install is up again, run the replay script. The first command only lists what would be deleted again; the second does it:

```bash
docker compose exec app node docustay/entrypoint.mjs run scripts/replay-deletions.mjs
docker compose exec app node docustay/entrypoint.mjs run scripts/replay-deletions.mjs --apply
```

It is safe to run twice: whatever is already gone is skipped. The ledger lives in the file store, so it only holds deletions the file store you are using has seen. If you also restore the file store from the same backup, deletions made after that backup are not in the ledger and cannot be replayed; in that case, if you know whose details were deleted, delete them again by hand.

## Test the restore

A backup you have not restored is a guess. Once, on a spare machine, do the restore above and open a signed document. Do it again after a major upgrade.

## How often

Daily is a good start for the database. The file store changes only when documents are made or signed, so the same schedule is enough. Keep at least the last seven.
