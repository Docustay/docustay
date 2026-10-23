---
title: Back up and upgrade a self-hosted Docustay
description: Four files make a whole backup. Restore on a new machine, test it once, and upgrade with three commands after every backup.
---

# Back up first. Then upgrade.

One script writes a dated folder with the database, the file store, the app data and your settings. Upgrading is three commands, and a backup comes before every one.

## Four files, all needed.

| File | What is in it | Why it matters |
| --- | --- | --- |
| db.dump | The database as one consistent file | Every workspace, document record and setting |
| filedata.tgz | The file store volume | The signed PDFs and uploads, which are sealed |
| appdata.tgz | The app data volume | Keys and certificates made on your machine |
| env | Your settings file | The master key that opens the sealed files |

## One script, one dated folder.

Run it from the docustay folder. It checks that every file exists and is not empty, and says so if one is missing.

```
d="backup-$(date +%Y%m%d-%H%M)"; mkdir -p "$d"
docker compose exec -T db pg_dump -U docustay -Fc docustay > "$d/db.dump"
# then the two volumes as archives and a copy of .env, as in the backup guide
ls -l "$d"
```

## Why the four files go together.

**Files are sealed.** Every stored document file is encrypted under a key for its workspace, and that key is sealed by the master key in your settings file. A copy of the file store without the database cannot be opened.

**Same moment.** Take the database dump and the file archive at the same time, which the script does, so every file has the key that opens it.

**Check after a restore.** A short command reads up to 20 stored files for one workspace and prints whether each opens. It changes nothing.

## Seven steps on a new machine.

Do it once on a spare machine before you need it.

**Install and get the folder.** Install Docker and get the Docustay folder.

**Put the settings back.** Copy the saved env file back as .env so the master key is the same.

**Start once, then stop writers.** Let the install make its roles and tables, then stop everything that writes, and the file store as well.

**Load the database.** Empty what the first start created and load the dump.

**Load the volumes.** Unpack the two archives into their volumes.

**Start and check.** Start everything, check that every service is up and the app says healthy, and open a signed document.

## Carry out the deletions again.

A restore rewinds the database, so a person or a workspace deleted after the backup comes back with it. Every deletion Docustay carries out leaves one small entry in a ledger in the file store: a hash of the email address or the workspace id, the date and a request id, never a name.

- Run the replay script once to list what would be deleted again, then run it with apply to do it.
- It is safe to run twice: whatever is already gone is skipped.

## Three commands, then check.

Take a backup first. It is the only way back.

```
git pull
docker compose build
docker compose up -d
```

## What changes and what stays.

- **Database**: Keeps running; migrations apply on start
- **File store**: Restarts if its image changed; about twenty seconds not ready
- **Signing sessions**: A session in progress survives, and the page reloads once
- **Old images**: Remove them afterwards, they take several gigabytes

- **Back up**: Database, file store, app data and settings
- **Read**: The changelog for the versions in between
- **Keep**: Your secrets and your master key
- **Test**: Restore on a spare machine now and then

## Questions

**How often should I back up?**

Daily is a good start for the database. The file store changes only when documents are made or signed, so the same schedule is enough. Keep at least the last seven.

**What if I lose the settings file?**

The master key in it opens the sealed files, and a restore with a different key cannot open them. Keep the settings file in your backup and apart from the database dump if you encrypt it.

**Is there a way back from a bad upgrade?**

Yes: the backup you took first. Restore it, and the install is as it was.

**Can I test a restore without risking my live install?**

Yes, and you should. Do the restore on a spare machine, open a signed document and check that its files open, then do it again after a major upgrade. A backup you have not restored is a guess.

**Do I need to stop signing while I upgrade?**

No. A signing session in progress survives an upgrade, but the page reloads once, so it is kind to pick a quiet moment.

**What do I do after I restore?**

Check that the files open with the verify command, then replay the deletion ledger so that anyone deleted after the backup stays deleted. Open a signed document as a last check.


## Keep reading

- [Requirements](/self-host/requirements)
- [SSO and hardening](/self-host/sso-and-hardening)
- [Self-host](/self-host)
