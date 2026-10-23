---
title: What it takes to run Docustay yourself
description: What it takes to run Docustay on your own machine: about 1 GB of memory to run, more than 3.8 GB to build, and what is not measured yet.
---

# What you need to run it.

Six containers, one machine and Docker. A running install idles at about one gibibyte of memory with almost no CPU. Building the web image from source needs more than 3.8 GB.

## The numbers we have, and where they come from.

One real install, running for 44 hours with two documents in it, on a virtual machine with 3.8 GiB.

- **≈1.0 GiB** Memory, idle: All six containers together.
- **0 to 0.5%** CPU, idle: Measured across the same six containers.
- **>3.8 GB** Memory to build: The web image build was killed for lack of memory at 3.8 GB.
- **6** Containers: Database, file store, converter, app, worker and web.

## Where the memory goes.

| Container | What it does | Idle memory |
| --- | --- | --- |
| app | The API and the business logic | about 271 MiB |
| worker | Sends email and reminders | about 254 MiB |
| storage | The file store for signed PDFs, S3-compatible | about 176 MiB |
| gotenberg | Draws template pages to PDF | about 188 MiB |
| db | PostgreSQL 16 with row-level security | about 76 MiB |
| web | The app, the signing page and this kind of page | about 45 MiB |

## Two different jobs.

- **Memory**: About one gibibyte at idle
- **CPU**: Close to nothing at idle
- **Ports**: Only the web container publishes a port; the rest talk on Compose's private network
- **Address**: Put HTTPS in front and set the public address

- **Memory**: More than 3.8 GB: the web build was killed at 3.8 GB
- **Time**: The build that failed ran for about three minutes first
- **Advice**: Build on a bigger machine, or use a prebuilt image when one is published
- **Not measured**: The exact minimum to build

## We say so rather than guess.

**Load.** Memory and CPU with ten signers at once, or with the worker busy, have not been measured. The idle numbers are the lower bound.

**Disk.** Disk use depends on how many documents you keep. A signed PDF is small, and the database and file store sit in two named Docker volumes.

**Other platforms.** A Helm chart ships with requests of 256 Mi for the app and worker and 128 Mi for web. It has not been run on a cluster yet.

## A handful of lines in one file.

| Setting | What it does |
| --- | --- |
| KEYSTONE_PUBLIC_URL | The address people use. It goes into the links in emails, and the provider sends people back to it for single sign-on. |
| KEYSTONE_MASTER_KEY | Seals stored secrets and each workspace's file key. init.sh writes it. Lose it and sealed files cannot be opened. |
| RESEND_API_KEY | Your own mail provider key. Leave it empty to use your own SMTP server in Settings, Email. |
| KEYSTONE_MAIL_SENDER | The default From address until you verify your own domain. |
| KEYSTONE_TRUSTED_PROXY_HOPS | How many proxies sit in front, so the real address of a visitor is read correctly. |
| DOCUSTAY_TELEMETRY | Set to off to stop the one anonymous daily ping. |

## Four things to have ready.

**Docker with Compose.** Any machine that runs Docker and Docker Compose. The install is a folder of files in the repository.

**A name and HTTPS.** A domain you control and a reverse proxy with a certificate in front of the web container. Caddy, nginx and Traefik are covered in the docs.

**Mail.** A provider key, or your own SMTP server including Amazon SES, so signers get their emails. Without one Docustay says email is not set up.

**A place for backups.** Somewhere that is not this machine. The backup folder holds secrets, so keep it as private as the install itself.

## One anonymous ping a day, and you can turn it off.

Once a day an install sends a random install id, its version and five counts, never content. Set DOCUSTAY_TELEMETRY=off to stop it, or send the report by hand. A Pro licence is checked the same way and keeps working up to 30 days offline.

- Nothing of ours is inside the install: every key and certificate is made on your machine.
- It is an honour system, not copy protection.

## Questions

**Can I run it on a small server?**

A running install idles at about one gibibyte, so a machine with 2 GB can run it. Building the web image needs more than 3.8 GB, so build elsewhere or use a prebuilt image.

**Does it need the internet?**

It needs outbound access for email and for the licence check if you run Pro, and a Pro licence keeps working up to 30 days offline. The Community edition needs no licence check.

**Which database does it use?**

PostgreSQL 16, in its own container, with row-level security on every table that holds workspace data.

**Where do I read the full steps?**

In the documentation: the install, the reverse proxy guide, backups, upgrades, single sign-on and hardening each have a page.

**Does a self-hosted install send my documents anywhere?**

No. Documents, files and keys stay on your machine, and the only thing the install sends us is the optional anonymous daily ping of a random id, the version and five counts.


## Keep reading

- [Backups and upgrades](/self-host/backups-and-upgrades)
- [SSO and hardening](/self-host/sso-and-hardening)
- [Licensing](/licensing)
