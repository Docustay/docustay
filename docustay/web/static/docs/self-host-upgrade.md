# Upgrade a self-hosted install

An upgrade replaces the app, worker and web containers. Your documents and settings stay in the database and the file store, so they are not touched. The database moves forward by itself: every start applies the migrations it has not had yet, before the app begins to answer.

## Before you upgrade

1. **Take a backup** of the database, the file store and the `appdata` volume. The steps are in [Back up and restore](/docs/self-host-backup). Do this every time; it is the only way back.
2. Read the [changelog](/changelog) for the versions between yours and the new one.
3. Check that nobody is in the middle of signing. A signing session in progress survives an upgrade, but the page reloads once.

## Upgrade

```bash
git pull
docker compose build
docker compose up -d
```

`up -d` recreates only the containers whose image changed. The database and the converter keep running. The file store's image is built here too, so it restarts when it was rebuilt; for about twenty seconds after that, `/readyz` answers `not_ready` with `storage` failing, then `ready`.

Then delete the old images, which take several gigabytes and are no longer used:

```bash
docker image prune -f
```

## Check that it worked

```bash
docker compose ps
docker compose exec -T app node -e "fetch('http://localhost:8080/readyz').then(r=>r.text()).then(console.log)"
```

The app's own `/readyz` check (it is not reachable from outside, which is intended) lists the number of migrations applied. It answers `"status":"ready"` once the database, the file store and the signing certificate are all reachable. Then open the app, send yourself a test document and sign it.

## If something looks wrong

Look at the logs first:

```bash
docker compose logs --tail 100 app worker
```

A migration that cannot apply stops the new app from starting, and the log says which one. Do not keep retrying: restore the backup you took (see [Back up and restore](/docs/self-host-backup)), go back to the version you had, and report the log.

```bash
PREVIOUS_VERSION="v0.1.1"   # the version you had before the upgrade (git tag)
git checkout "$PREVIOUS_VERSION"
docker compose build && docker compose up -d
```

Migrations are written to only add things, but the supported way back is the backup, not running an older version on a newer database.

## The built-in templates

The 54 built-in templates are seeded by the worker: on install it prints every one for each workspace, and on an upgrade that changes a template it makes a new version of that template's read-only master, so a document that uses it follows. Nothing you customized is touched, and nothing here counts toward any limit. The worker logs `seed_template_library` with how many masters it printed.

## Keep your secrets

Never delete `.env` or the `appdata` volume during an upgrade. The first holds the secrets that protect sign-in tokens; the second holds the certificate that seals your signed PDFs and the key that protects stored passwords.

## Uninstall

Back up first if you may want the documents again. In the `docustay` folder, `docker compose down --volumes --rmi local` stops the containers and deletes the database, the signed files and the images built there; then delete the cloned folder (it holds `.env` and its secrets). Leave out `--volumes` to keep the data in Docker volumes for a later `docker compose up -d`.
