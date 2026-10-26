# Security

Found a security problem in Docustay? Please tell us privately first.

- Email **security@docustay.app** with what you found, how to reproduce it, and what you think it could do. This is the same address as in `/.well-known/security.txt` on the website.
- Or use this repository's private reporting: **Security tab → Report a vulnerability**. Either route reaches the maintainers only.
- Please do not open a public issue for it, and do not test against other people's accounts or data. Use your own self-hosted install, or a test account on your own workspace.
- We will reply within three working days, tell you whether we agree it is a problem, and keep you updated until it is fixed.
- When it is fixed we are glad to credit you, if you want that.

## Which versions get fixes

The latest release and the `main` branch. To pick up a fix on a self-hosted install: `git pull`, then `docker compose build` (on a prebuilt install: `docker compose pull app worker web` and `docker compose build storage`) and `docker compose up -d` inside the `docustay` folder (migrations run on start). Older versions are not patched separately.

## What is in scope

The Docustay app, API, signing pages, the SDKs and command line under `sdk/`, and the self-hosted release in this repository.

## What is not

Other people's software we link to, social engineering of staff, physical attacks, reports that need a stolen device or an already-compromised mail account, and denial-of-service or volume tests.

## Secrets

This repository contains no key, certificate or password of ours. Every secret on a self-hosted install is generated on that machine the first time it starts (`docustay/init.sh` and the first-run entrypoint). If you ever find something in this repository that looks like a live credential, report it the same way and do not use it.

Details of how Docustay protects documents, keys and signatures are on the Security page of the website. Docustay is a product of GLRS LLC.
