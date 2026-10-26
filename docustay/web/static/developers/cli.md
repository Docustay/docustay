---
title: E-signature command line
description: Sign in, send a test document, forward real signed webhooks to localhost, verify a PDF and read your logs, all from the command line. MIT licensed.
---

# Command line

Log in, send a test document, forward signed webhooks to your laptop, verify a PDF, read the logs.

```
$ npx docustay login
$ npx docustay send --test
$ npx docustay listen --forward-to http://localhost:3000/webhooks
$ npx docustay verify signed.pdf
$ npx docustay logs
```

## Five commands.

- **login**: Store a key for this machine
- **send --test**: Send a practice document to yourself
- **listen**: Forward real signed events to a local URL and print the secret

- **verify**: Check a signed PDF
- **logs**: Read recent API calls

## Send, then read the logs.

**Safe by default.** send --test refuses a live key unless you also say --live.

**Machine-readable.** Add --json to any command.

## What each one does.

| Command | What it does |
| --- | --- |
| docustay login | Save your API key for this machine, readable only by you |
| docustay whoami | Check the saved key |
| docustay send --test | Send a test document from a template |
| docustay listen | Forward signed webhooks to your own computer |
| docustay trigger | Send a test event to the listen webhook |
| docustay verify | Check a webhook's signature the way your server should |
| docustay logs | Recent email log, or a webhook's recent deliveries |

MIT licensed. Node 18 or newer.

## Keys come from the environment.

DOCUSTAY_API_KEY and DOCUSTAY_URL override the saved ones.

```
export DOCUSTAY_API_KEY=dsk_test_…
export DOCUSTAY_URL=https://sign.example.com   # only for a self-hosted install
npx docustay send --test TEMPLATE_ID --party signer_1="Pat Example <pat@example.com>" --json
```

## Build a receiver without a public address.

listen makes a relay webhook once and fetches its signed deliveries to your computer. The signature your code checks is the real one.

```
npx docustay login
npx docustay listen --forward-to http://localhost:3000/webhooks --events documents.document.executed
```

## The rest of what docustay does.

| Command | What it does |
| --- | --- |
| detect <file.pdf> | Find the fields on a PDF; nothing is stored |
| templates [library / customize <slug>] | List the built-in templates; customize <slug> makes your own copy |
| search <words> | Documents, templates and people, best first |
| documents [list / show / remind / void] | Your documents, one document's people and events, a reminder, or cancel one that is out for signature |
| webhooks [list / create / test / rotate / delete / deliveries] | Where Docustay posts events; the signing secret is shown once |
| payments [list / refund <id>] | Payments taken while signing; a refund never runs without --yes |
| playbooks [list / on / off] | Switch a playbook on or off |
| ai usage | AI drafts used, left, and when they reset |

Add --json to any command for machine-readable output.

## Where it keeps things.

| Topic | Detail |
| --- | --- |
| The saved key | login keeps your key in ~/.config/docustay/config.json, readable only by you. DOCUSTAY_API_KEY and DOCUSTAY_URL override it, which is what CI should use. |
| Same code as the SDK | verify uses the SDK's own check: pass the secret, the webhook id, timestamp and signature, and a body file or - for standard input. |
| Built from source | MIT licensed, Node 18 or newer. Install it with npm install -g docustay, or run any command with npx docustay; the source is in sdk/cli in the repository. |

## The flags that change what a command does.

| Flag or variable | Effect |
| --- | --- |
| --json | Machine-readable output from any command |
| --live | Lets send use a live key; without it send --test refuses one |
| --yes | Required for payments refund to run without a typed yes |
| --rotate | With listen, makes a new signing secret |
| --events a,b | With listen, forward only those event names |
| DOCUSTAY_API_KEY, DOCUSTAY_URL | Override the saved key and server address; use them in CI and for a self-hosted install |



## Use it in a shell script.

```
export DOCUSTAY_API_KEY=dsk_test_…
npx docustay templates library --json > templates.json
npx docustay search "services agreement" --per 3 --json
npx docustay documents list --state completed --json
```

## Nothing opens to the internet.

| Part | What happens |
| --- | --- |
| First run | listen makes a relay webhook once (relay: true on POST /api/v1/webhooks) and prints its signing secret a single time |
| Delivery | It fetches the signed deliveries from Docustay and forwards each to your --forward-to address, so your receiver sees the real signature |
| Sample events | trigger sends a sample event of the topic you name, default documents.document.executed |
| After the fact | logs --webhook WEBHOOK_ID shows that webhook's recent deliveries |



## Verify a saved body.

verify takes the secret, the three header values and the raw body from a file, or - for standard input.

```
npx docustay verify --secret whsec_… --id msg_1 --timestamp 1790000000 --signature "v1,…" --body body.json
```

## Where to go from here.

| Next | Why | Page |
| --- | --- | --- |
| Understand the events | Which seven events exist and what each payload carries. | Webhooks: /developers/webhooks |
| Practise safely | Why send --test refuses a live key. | Test mode: /developers/test-mode |
| Call it from code | The SDKs wrap the same routes the commands use. | SDKs: /developers/sdks |

## The commands, as the command line itself lists them.

Run docustay help for the full text and flags.

**Sign in and check.** login saves your API key, readable only by you, and whoami checks it. DOCUSTAY_API_KEY and DOCUSTAY_URL override what is saved.

**Send and listen.** send --test sends a test document from a template, listen forwards webhooks to your computer, trigger sends a test event and verify checks a signature.

**Look things up.** search finds documents, templates and people, best first. documents lists, shows, reminds and voids. logs shows the recent email log or a webhook's deliveries.

**Templates and playbooks.** templates library lists the built-in templates and templates customize makes your own copy of one. playbooks lists what is on and switches a playbook on or off.

**Payments.** payments lists payments taken while signing and can refund one with a reason.

**Fields and AI.** detect finds the fields on a PDF without storing anything, and ai usage shows the AI drafts used, the drafts left and when they reset.

## Questions

**Why use listen?**

Endpoints must be public https addresses, and listen forwards signed events to localhost so you can build a receiver.

**Does it print my key?**

No. A key is stored for the machine and never printed.


## Keep reading

- [Webhooks](/developers/webhooks)
- [Test mode](/developers/test-mode)
- [REST API](/developers/api)
