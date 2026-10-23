# Docustay

Docustay is document signing you can run yourself. Upload a PDF or write a document, place the fields, send it by email or sign in person, and receive one sealed copy with a certificate and an audit trail.

Everything runs on your machine: your database, your file store, your email. **Nothing here belongs to anyone else.** There is no key, certificate or password of ours inside; every secret is created on your machine the first time it starts.

## Five-minute quickstart

You need [Docker](https://docs.docker.com/get-docker/) with the Compose plugin.

```sh
git clone https://github.com/<owner>/docustay.git
cd docustay
sh quickstart.sh
```

`quickstart.sh` creates a `.env` file with fresh random secrets, builds and starts the containers, waits until the app answers, and then prints two lines:

```
Docustay is running: http://localhost:8080/setup
Setup token (needed once, at /setup): <a random token>
```

The first start builds the database and the images, which takes a few minutes. Once it prints, do this:

1. Open **http://localhost:8080/setup**.
2. Enter the setup token it printed and create your owner account. `/setup` works once and cannot be run again.
3. Sign in at `/login`. Set up email (next section), send a test, then send your first document.

If it takes longer than expected, `docker compose ps` and `docker compose logs --tail 50` (run inside the `docustay` folder that holds `docker-compose.yml`) show what is happening.

## Email: set this up before you invite anyone

Until email works Docustay shows **"Email isn't set up"** and refuses to send a document, so nothing disappears silently. Pick one:

* **Resend**: put your own API key in `docustay/.env` as `RESEND_API_KEY` (and a From address in `KEYSTONE_MAIL_SENDER`), then run `docker compose up -d` in `docustay/`.
* **Your own SMTP server**: sign in, open **Settings → Email**, set **Send from** to "Your own mail server (SMTP)", then fill in the From address, SMTP server, port, user name and security, and save the password.

Then press **Send test** and check your inbox. Documents can be sent once the test arrives.

Set `KEYSTONE_PUBLIC_URL` in `docustay/.env` (for example `https://sign.example.com`) to the address people reach Docustay at: it is the start of every signing link and every password-reset link in an email. It defaults to `http://localhost:8080`, which only works on the machine itself. Put Docustay behind HTTPS (a reverse proxy such as Caddy or nginx) before you use it with real signers; see [the reverse-proxy guide](docustay/docs/self-host-reverse-proxy.md).

## What is running

| Container | What it is |
|---|---|
| `db` | Postgres 16: your documents' records |
| `storage` | SeaweedFS: your signed PDFs (S3-compatible) |
| `gotenberg` | prints documents written in the editor to PDF (uploads are PDF only, nothing is converted) |
| `app` | the API (not reachable from outside the install) |
| `web` | the web app: every screen, and the only container that publishes a port (8080 by default; set `DOCUSTAY_PORT`) |
| `worker` | sends reminders, webhooks and scheduled sends |

Data lives in three Docker volumes: `dbdata`, `filedata`, `appdata`. The last holds this install's own signing certificate and master key. **Back all three up**; without `appdata` you cannot open the secrets you stored ([backup guide](docustay/docs/self-host-backup.md)).

The worker sends one anonymous usage ping a day (a random install id, the version and five counts; never a document, a name or an email). Turn it off with `DOCUSTAY_TELEMETRY=off` in `.env`.

**What a PDF reader shows for your seal.** Every signed copy is sealed with this install's own certificate, made on its first start, and carries a timestamp from DigiCert's public timestamp service. A PDF reader such as Adobe Acrobat shows the seal as intact and the timestamp as trusted, but shows the sealing certificate itself as not trusted, because no public authority issued it. Anyone can check a copy at `/verify` on your install: the check runs in their browser and the file is not uploaded.

## Upgrade

```sh
git pull
cd docustay
docker compose build
docker compose up -d
```

Migrations run on start. See [the upgrade guide](docustay/docs/self-host-upgrade.md).

## Uninstall

Take a backup first if you may want your documents again ([Back up and restore](docustay/docs/self-host-backup.md)). Then, in the `docustay` folder:

```sh
docker compose down --volumes --rmi local   # stops the six containers, deletes the database, the signed files and the images built here
cd ../.. && rm -rf docustay                 # the cloned folder, including .env and its secrets
```

Without `--volumes` the containers go but your data stays in Docker volumes, ready for a later `docker compose up -d`. `docker volume ls` lists what is left.

## What this edition does not do (yet)

* One organisation per install, with its owner. Inviting teammates uses the hosted product's sign-in; on a self-hosted install add people by sharing the owner login for now.
* No hosted plans or billing: there are no limits.
* Sign-ups are closed: `/setup` creates the owner once and cannot be run again.

## Documentation

* [Developer documentation](docustay/docs/index.md): REST API, SDKs, embedded signing, webhooks, the MCP server.
* [Quickstart for the API](docustay/docs/quickstart.md), [authentication and keys](docustay/docs/authentication.md), [webhooks](docustay/docs/webhooks.md).
* Self-hosting: [hardening](docustay/docs/self-host-hardening.md), [reverse proxy](docustay/docs/self-host-reverse-proxy.md), [backup](docustay/docs/self-host-backup.md), [upgrade](docustay/docs/self-host-upgrade.md), [single sign-on](docustay/docs/self-host-sso.md).
* [Security policy](SECURITY.md): how to report a vulnerability privately.
* [Contributing](CONTRIBUTING.md) and the [code of conduct](CODE_OF_CONDUCT.md).

## Licence

The server, worker, migrations and web app are licensed under the **GNU Affero General Public License, version 3 or later** (see [LICENSE](LICENSE)). The pieces you put inside your own software are licensed under the **MIT licence**: the SDKs (`sdk/js`, `sdk/python`), the `<docustay-sign>` element and its React, Vue and Angular wrappers (`sdk/embed`, `sdk/react`, `sdk/vue`, `sdk/angular`), the command line (`sdk/cli`), the MCP server (`sdk/mcp`) and the Claude Code plugin (`sdk/claude-plugin`). Each package carries its own `LICENSE`. Calling the API or using the SDKs does not make your application AGPL. [Licensing in plain words](docustay/docs/licensing.md); that page is general information, not legal advice.

Docustay is a product of GLRS LLC. The name and logo are marks of GLRS LLC; the licences give you the right to use the code, not the name or the logo.
