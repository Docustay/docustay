# Settings reference

Every setting you can give a self-hosted Docustay, as environment variables in `.env` (the compose file reads it). `./init.sh` fills in the secrets. Anything not listed in the first tables is internal or belongs to the hosted service and should stay unset.

## Secrets (init.sh makes them)

| Setting | Required | Default | What it does |
|---|---|---|---|
| `KEYSTONE_DB_PASSWORD` | yes | `(generated)` | The password of the bundled Postgres. Used by compose to build the database URL. |
| `KEYSTONE_TOKEN_PEPPER` | yes | `(generated)` | A secret mixed into every API key and session digest. Changing it signs everyone out and invalidates every API key. |
| `KEYSTONE_LOCAL_AUTH_SECRET` | yes | `(generated)` | Signs the built-in sign-in tokens. Changing it signs everyone out. |
| `KEYSTONE_SETUP_TOKEN` | first run | `(generated)` | The one-time key that lets you create the owner account at /setup. Unused after setup. |
| `KEYSTONE_MASTER_KEY` | yes (production) | `(generated)` | Wraps the keys that seal stored secrets (webhook secrets, SMTP passwords, two-step secrets) and each workspace's key for its stored document files. Back it up with the database: without it sealed secrets and the stored files cannot be opened. |
| `DOCUSTAY_REFUSE_PLAINTEXT_FILES` | no | `off` | Set to on once `scripts/file-keys.mjs status` shows every workspace as all files sealed: a stored file that is not sealed is then refused instead of served. Leave it off until then; files stored before encryption existed are served as they are until the worker's sealing pass has been through them. |

## Where things are

| Setting | Required | Default | What it does |
|---|---|---|---|
| `KEYSTONE_PUBLIC_URL` | yes behind a domain | `http://localhost:8080` | The address people open Docustay at, without a path. Every signing link, reset link and email starts with it. |
| `KEYSTONE_DOCUSTAY_APP_URL` | no | `= KEYSTONE_PUBLIC_URL` | The address of the signed-in app, when it differs from the signing address. |
| `KEYSTONE_DOCUSTAY_SIGN_URL` | no | `= KEYSTONE_PUBLIC_URL` | The address signing links start with. |
| `DOCUSTAY_PORT` | no | `8080` | The port on this machine the web app listens on. |
| `PORT` | no | `8080` | The port the API process listens on inside its container. |
| `KEYSTONE_TRUSTED_PROXY_HOPS` | behind a proxy | `0` | How many reverse proxies sit in front. With 0 every visitor looks like the proxy and shares one rate limit; set 1 behind one proxy. |

## Database and files

| Setting | Required | Default | What it does |
|---|---|---|---|
| `KEYSTONE_DB_SUPERUSER_URL` | yes | `(compose)` | Connection string the migration runner uses. It creates the application roles on first run. |
| `KEYSTONE_DATABASE_URL` | no | `(derived)` | Connection string for the application role, when you run the database yourself. |
| `KEYSTONE_DB_SSL` | no | `on` | Set to off for a database in the same private network without TLS (the bundled compose does). |
| `KEYSTONE_PG_POOL_MAX` | no | `10` | Largest number of database connections the API keeps. |
| `KEYSTONE_S3_ENDPOINT` | yes | `(compose)` | Address of the S3-compatible store that keeps signed PDFs. |
| `KEYSTONE_S3_BUCKET` | yes | `docustay` | The bucket (created for you by the bundled store). |
| `KEYSTONE_S3_ACCESS_KEY_ID` | yes | `(generated)` | Access key for the file store. |
| `KEYSTONE_S3_SECRET_ACCESS_KEY` | yes | `(generated)` | Secret key for the file store. |
| `KEYSTONE_S3_REGION` | no | `us-east-1` | Region name some S3 providers require. |
| `KEYSTONE_GOTENBERG_URL` | yes | `(compose)` | Address of the PDF converter (Gotenberg) that prints documents. |

## Email

| Setting | Required | Default | What it does |
|---|---|---|---|
| `RESEND_API_KEY` | one of Resend or SMTP |  | Your own Resend API key. Leave empty to use your own SMTP server (Settings → Email). |
| `KEYSTONE_MAIL_SENDER` | no |  | The From address used until you verify your own domain. |
| `KEYSTONE_MAIL_DAILY_LIMIT` | no | `(none)` | Hard cap on emails sent per day by this install. |
| `KEYSTONE_EMAIL_ALLOWLIST` | no | `(off)` | Comma list of addresses/domains mail may go to. Everything else is dropped. Use it on a test install. |

## Sign-in

| Setting | Required | Default | What it does |
|---|---|---|---|
| `KEYSTONE_LOCAL_AUTH` | yes (self-host) | `1` | Uses the built-in sign-in (email and password). Firebase is for the hosted service only. |
| `KEYSTONE_PASSKEYS` | no | `off` | Set to 1 to let people sign in with passkeys. Needs KEYSTONE_PASSKEY_ORIGINS. |
| `KEYSTONE_PASSKEY_ORIGINS` | with passkeys | `= KEYSTONE_DOCUSTAY_APP_URL` | Comma list of web addresses a passkey may be used from. A passkey is tied to the address's host name. |
| `DOCUSTAY_OIDC_ISSUER` | no | `(off)` | The address of your OpenID Connect provider (Keycloak, Authentik, Entra, Okta…), for example https://sso.example.com/realms/main. Setting this, the client id and the client secret turns on single sign-on. |
| `DOCUSTAY_OIDC_CLIENT_ID` | no | `(none)` | The client id you made for Docustay at your provider. |
| `DOCUSTAY_OIDC_CLIENT_SECRET` | no | `(none)` | The client secret for that client. Keep it as private as the other secrets in `.env`. |
| `DOCUSTAY_OIDC_LABEL` | no | `your identity provider` | The name on the sign-in button: “Sign in with …”. |
| `DOCUSTAY_OIDC_SCOPES` | no | `openid email profile` | What to ask the provider for. It must include `openid` and `email`. |

## Signing certificate and timestamps

| Setting | Required | Default | What it does |
|---|---|---|---|
| `KEYSTONE_SIGNING_CERT_PEM` | no | `(made at first run)` | The certificate that seals finished documents. By default Docustay makes one for this install; set your own to use a certificate from a trusted authority. |
| `KEYSTONE_SIGNING_CERT_PATH` | no |  | Path to a PEM file instead of the value itself. |
| `DOCUMENT_TSA_URL` | no | `(none)` | A trusted timestamp authority; when set, finished documents carry a trusted timestamp. |

## Operations

| Setting | Required | Default | What it does |
|---|---|---|---|
| `KEYSTONE_METRICS_TOKEN` | no | `(metrics off)` | Turns on GET /metrics (Prometheus). Callers send Authorization: Bearer TOKEN, where TOKEN is this value. At least 16 characters. |
| `KEYSTONE_LOG_REDACTION` | no | `on` | Server and worker logs leave out email addresses and credentials. off turns that off (only for debugging a test install). |
| `DOCUSTAY_TELEMETRY` | no | `on` | off stops the one anonymous daily usage ping (a random install id, the version, five counts). |
| `DOCUSTAY_LICENSE_KEY` | no |  | A Pro licence key. With it the worker checks the licence daily and unlocks Pro features. |
| `KEYSTONE_ENVIRONMENT` | no | `production` | staging for a test install: live Stripe keys are refused and email goes only to the allowlist. |
| `KEYSTONE_ALERT_EMAIL` | no |  | Where the install sends operational alerts (a failing backup, a paused sender). |
| `KEYSTONE_SELF_HOST` | set by compose | `1` | Marks this as a self-hosted install: hides hosted-only screens such as billing. |

## Payments (optional)

| Setting | Required | Default | What it does |
|---|---|---|---|
| `KEYSTONE_STRIPE_SECRET_KEY` | for payment fields |  | Your own Stripe secret key for collecting payments at signing. |
| `KEYSTONE_STRIPE_PUBLISHABLE_KEY` | for payment fields |  | The matching publishable key. With it the signer pays inside the signing page as its last step; without it they pay on Stripe's own page and come back. |
| `KEYSTONE_STRIPE_CHARGES_ENABLED` | no | `off` | A safety switch: live charges stay refused until this is on. |

## AI (optional)

| Setting | Required | Default | What it does |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | for AI features |  | Your own Anthropic key. Without it the AI drafting, reviewing and chat features are hidden. |
| `KEYSTONE_AI_DEFAULT_MODEL` | no | `(a current model)` | The model used for drafting. |

## Advanced settings

The code also reads the variables below. They tune limits and connections you will rarely need to change. Another 64 variables (plan prices and limits, and the hosted service's own accounts for Stripe Connect, Firebase, Cloudflare, domains and the like) belong to the hosted service only; a self-hosted install ignores them.

- `ANTHROPIC_WORKSPACE_ID`
- `DOCUMENT_SIGNING_CERT_P12`
- `DOCUMENT_SIGNING_CERT_PASSPHRASE`
- `DOCUSTAY_ADDON_DIR`
- `DOCUSTAY_API_KEY`
- `DOCUSTAY_CORE_SRC`
- `DOCUSTAY_DELETION_GRACE_DAYS`
- `DOCUSTAY_GOOGLE_SIGNIN_CLIENT_ID`
- `DOCUSTAY_INSTANCE_ROLE`
- `DOCUSTAY_INVOICE_SELLER`
- `DOCUSTAY_LICENSE_PUBLIC_KEY`
- `DOCUSTAY_LICENSE_PUBLIC_KEY_FILE`
- `DOCUSTAY_POSTAL_ADDRESS`
- `DOCUSTAY_PUBLIC_URL`
- `FAULT_INJECT`
- `GOOGLE_CALENDAR_API_BASE`
- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `GOOGLE_TOKEN_URL`
- `INDEXABLE_HOSTS`
- `KEYSTONE_ADDON_S3_ENDPOINT`
- `KEYSTONE_AI_ALLOW_FAKE`
- `KEYSTONE_AI_CREDITS_CHECK`
- `KEYSTONE_AI_CREDITS_DETECT_PAGE`
- `KEYSTONE_AI_CREDITS_DRAFT`
- `KEYSTONE_AI_CREDITS_EDIT`
- `KEYSTONE_AI_CREDITS_FILE_READ`
- `KEYSTONE_AI_CREDITS_PLAY`
- `KEYSTONE_AI_EFFORT`
- `KEYSTONE_AI_FILE_MB`
- `KEYSTONE_AI_FILE_PAGES`
- `KEYSTONE_AI_INPUT_TOKENS`
- `KEYSTONE_AI_INTERNAL_MODEL`
- `KEYSTONE_AI_MAX_QUEUED`
- `KEYSTONE_AI_OUTPUT_TOKENS`
- `KEYSTONE_AI_PER_HOUR`
- `KEYSTONE_AI_PER_MINUTE`
- `KEYSTONE_AI_SUMMARISE_AFTER`
- `KEYSTONE_AI_TOOL_TURNS`
- `KEYSTONE_APP_URL`
- `KEYSTONE_CONTACT_ALERTS`
- `KEYSTONE_DATA_DIR`
- `KEYSTONE_DEMO_AI_PROMPTS`
- `KEYSTONE_DEMO_ENABLED`
- `KEYSTONE_DEMO_HOURS`
- `KEYSTONE_DEMO_MAX_ACTIVE`
- `KEYSTONE_DEMO_PER_IP_HOUR`
- `KEYSTONE_DEMO_SECRET`
- `KEYSTONE_DEMO_UPLOADS`
- `KEYSTONE_DEMO_UPLOAD_BYTES`
- `KEYSTONE_DETECT`
- `KEYSTONE_DETECT_AI_MAX_PAGES`
- `KEYSTONE_DETECT_AI_MAX_USD_MICRO`
- `KEYSTONE_DETECT_DEBUG`
- `KEYSTONE_DOCUSTAY_MAIL_SENDER`
- `KEYSTONE_DOCUSTAY_NEW_LIMITS_FROM`
- `KEYSTONE_DOCUSTAY_PAYG_TEMPLATES_PER_MONTH`
- `KEYSTONE_DOCUSTAY_PM_CONFIG`
- `KEYSTONE_DOCUSTAY_STRIPE_SECRET_KEY`
- `KEYSTONE_DOCUSTAY_TAX_ON`
- `KEYSTONE_DRAIN_MS`
- `KEYSTONE_EMAIL_FROM`
- `KEYSTONE_IDEMPOTENCY_WAIT_MS`
- `KEYSTONE_LIMITER_POOL_MAX`
- `KEYSTONE_MAIL_ALERT_TO`
- `KEYSTONE_MAIL_CAPTURE_SMTP`
- `KEYSTONE_OCR_LANG_PATH`
- `KEYSTONE_PG_IDLE_TX_MS`
- `KEYSTONE_PG_LOCK_WAIT_MS`
- `KEYSTONE_PG_NESTED_RESERVE`
- `KEYSTONE_PRODUCT`
- `KEYSTONE_RUN_SCREENS`
- `KEYSTONE_SESSION_SECRET`
- `KEYSTONE_TEST_IP_LIMIT_MULTIPLIER`
- `KEYSTONE_UMAMI_HOSTNAME`
- `KEYSTONE_UMAMI_URL`
- `KEYSTONE_UMAMI_WEBSITE_ID`
- `KEYSTONE_UNSUBSCRIBE_SECRET`
- `KEYSTONE_VERSION`
- `KEYSTONE_WORKER_DATABASE_URL`
- `KEYSTONE_WORKER_LOG`
- `KEYSTONE_WORKER_RESERVED_SLOTS`
- `MICROSOFT_GRAPH_OAUTH_CLIENT_ID`
- `MICROSOFT_GRAPH_OAUTH_CLIENT_SECRET`
- `POSTHOG_HOST`
- `POSTHOG_PROJECT_TOKEN`

## An example `.env`

`init.sh` writes the secrets for you. Everything else is yours to set in the same file; a small install behind its own address needs only these lines on top of the generated ones:

```bash
KEYSTONE_PUBLIC_URL=https://sign.example.com
KEYSTONE_TRUSTED_PROXY_HOPS=1
KEYSTONE_MAIL_SENDER=Example Co <documents@example.com>
KEYSTONE_MAIL_DAILY_LIMIT=500
```

Apply a change by recreating the containers, then check the install is up and sees the new address:

```bash
docker compose up -d
curl -s https://sign.example.com/readyz
```
