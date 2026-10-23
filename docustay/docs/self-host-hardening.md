---
title: Harden a self-hosted install
description: A checklist for running Docustay on your own servers when the documents are sensitive. What to switch on, what to keep private, and what to check.
order: 17
---

# Harden a self-hosted install

Run Docustay on your own servers and you choose every provider that touches your documents. This page is the checklist for an install that holds sensitive documents. Work through it top to bottom after [installing](/self-host) and before the first real document.

Docustay is not for protected health information yet, on our hosted service or on your own servers. This page is not legal advice.

## 1. Set the workspace's security settings

In **Settings → Account → Security**, an owner or admin can set these for everyone in the workspace (other team members see only their own password, two-step and passkeys there):

| What | Setting |
|---|---|
| Two-step sign-in | Offered to everyone. Tick **Require two-step sign-in for every team member** to make it required; set it up for yourself first |
| Idle sign-out | Off by default. Choose 15, 30 or 60 minutes, or 4 or 8 hours |
| Access log | Always on: every view, download and export by your team, with a CSV |
| Signed copies | Attached to the completion email (Docustay sends the copy itself, not a download link) |

## 2. Keep the inside private

- **Only the web container listens.** In the bundled `docker-compose.yml` only `web` publishes a port. The database, the file store and the PDF converter talk on Compose's private network. Do not add `ports:` to `db`, `storage` or `gotenberg`.
- **Put HTTPS in front.** Use a reverse proxy with TLS ([reverse proxy guide](/docs/self-host-reverse-proxy)). Set `KEYSTONE_PUBLIC_URL` to the `https://` address and `KEYSTONE_TRUSTED_PROXY_HOPS` to the number of proxies in front. Docustay sends HSTS on every HTTPS answer.
- **Firewall the host.** Allow 443 (and 80 for the certificate check) in; nothing else from outside.

## 3. Encrypt what is stored

- **Disks.** Put the Docker volumes (`dbdata`, `filedata`, `appdata`) on an encrypted disk: LUKS on Linux, or your cloud provider's encrypted volumes.
- **Secrets and files.** The app makes the install's master key on its first start and keeps it in the `appdata` volume (`/data/master.key`, readable only by the app). It seals stored secrets (two-step secrets, SMTP passwords, webhook secrets) and each workspace's file key; every stored document file is encrypted under its workspace's own key (see [Back up and restore](/docs/self-host-backup)). The database and the disks are not encrypted by Docustay, so the disk advice above still applies. Keep `.env` readable only by the account that runs Docker (`chmod 600 .env`).
- **Backups.** Encrypt each backup before it leaves the machine (for example `age` or `gpg`), and keep the key apart from the backup. See [Back up and restore](/docs/self-host-backup).

```bash
# once: install age (brew install age · apt install age) and make the key pair; keep the .key file OFF this machine
[ -f ~/.docustay-backup.pub ] || { age-keygen -o ~/.docustay-backup.key && age-keygen -y ~/.docustay-backup.key > ~/.docustay-backup.pub; }
# each night, in the folder your backups are written to: encrypt the newest backup for that key, then copy only the .age file off the machine
d=$(ls -d backup-* | tail -1)
tar czf - "$d" | age -r "$(cat ~/.docustay-backup.pub)" > "$d.tgz.age"
```

## 4. Choose your providers

Everything that sends, stores or reads your documents is a provider you choose.

- **Email.** Set `RESEND_API_KEY`, or use your own SMTP server in Settings → Email.
- **Sign-in.** The built-in sign-in (`KEYSTONE_LOCAL_AUTH`) keeps identities in your own database. Or connect your own OpenID Connect provider (`DOCUSTAY_OIDC_ISSUER`, see [single sign-on](/docs/self-host-sso)).
- **AI.** Leave `ANTHROPIC_API_KEY` empty if documents must not leave your servers for drafting.
- **Hosting.** Your server or cloud provider holds the disks.

## 5. Sign-in and sessions

- Two-step sign-in is offered to everyone; an owner can require it for the whole team.
- Turn on passkeys (`KEYSTONE_PASSKEYS=1` and `KEYSTONE_PASSKEY_ORIGINS`) so people can use a device instead of a code.
- Settings → Security lists where each person is signed in and ends any session.
- When someone leaves, remove them from the team the same day: their sessions end at once.

## 6. Logs and monitoring

- Server and worker logs leave out email addresses and credentials. Keep that on (it is unless `KEYSTONE_LOG_REDACTION=off`).
- Send logs to a store you control, kept as long as your policy says.
- Set `KEYSTONE_ALERT_EMAIL` so a failing backup or a paused sender reaches someone.
- `DOCUSTAY_TELEMETRY=off` stops the one anonymous daily usage ping (it never carries document content).

## 7. Keep it current

- Upgrade when a release comes out ([upgrade guide](/docs/self-host-upgrade)). Release notes say when a fix is about security.
- Run `docker compose pull` and rebuild at least monthly, so the operating system packages in each image stay patched.
- Report a problem to security@docustay.app.

## 8. Check it

Before the first real document:

1. Open `https://your-address/` and confirm the padlock, then `curl -sI https://your-address/ | grep -i strict-transport` shows HSTS.
2. From outside the host, confirm the database port (5432) and the file store port (8333) do not answer.

```bash
# run from ANOTHER machine; every line must say "closed" (nc exits non-zero when nothing answers)
HOST=sign.example.com   # your install's public address
# Linux:
for p in 5432 8333 3000; do nc -z -w 3 "$HOST" "$p" && echo "$p OPEN: close it" || echo "$p closed"; done
# macOS (its nc needs -G for a connect time limit):
for p in 5432 8333 3000; do nc -z -G 3 "$HOST" "$p" && echo "$p OPEN: close it" || echo "$p closed"; done
```

3. With two-step required, sign in as a team member without it: Docustay shows one page with a Set up button.
4. With idle sign-out set, leave a session idle past the limit: the next click asks you to sign in again.
5. Open a document, then check Settings → Security → Access log shows it.
6. Restore last night's backup onto a spare machine and open a signed PDF. Write down how long it took.
