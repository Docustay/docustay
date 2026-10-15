# docustay — the Docustay command line

```
npx docustay login            # paste a key from Settings → Developers
npx docustay send --test <templateId> --party signer_1="Pat Example <pat@example.com>"
npx docustay listen --forward-to http://localhost:3000/webhooks
npx docustay verify --secret whsec_… --id … --timestamp … --signature "v1,…" --body body.json
```

- **forms** `list | templates | show <id> | responses <id>` lists your forms (link, open or closed, response count), the thirty ready-made form templates, one form's link and settings, and its responses (each one is a document: `docustay` commands that take a document id work on it). Add `--json` for the raw answer.
- **search** `<words>` finds documents, templates, forms and people, best first, the same search as ⌘K in the app.
- **contracts** `list [--q …]` shows your signed contracts with their key dates and the count renewing or ending in the next 30 days; `date <id> --kind end --date 2027-01-31` (or `--clear`) corrects one date by hand. The signed PDF never changes; the correction is kept as yours.
- **payments** `list` shows what was paid while signing, newest first, with this month's figures. `refund <id> --reason "…" [--amount-minor 500]` refunds through Stripe (leave out the amount for the rest of the payment) and never runs without `--yes`, or a typed yes at the prompt.
- **playbooks** `list | on <id> | off <id>` lists the playbooks built on the canvas and switches one on (Pro) or off.
- **login** keeps your key in `~/.config/docustay/config.json` (mode 600). `DOCUSTAY_API_KEY` and `DOCUSTAY_URL` override it (use them in CI).
- **send --test** refuses a live key unless you also say `--live`, so a script cannot send real documents by accident.
- **listen** makes a *relay* webhook (once) and fetches its signed deliveries to your computer: nothing is opened to the internet, the signature your code checks is the real one, and the signing secret is printed once. `docustay trigger` sends a sample event; `--rotate` makes a new secret.
- **verify** is the check your server should do, with the same code as the SDK.
- **documents** lists your documents, shows one (its people and events), sends a reminder, or cancels one (`void <id> --reason "…" --yes`; it never runs without `--yes`).
- **webhooks** lists, creates (`create --url https://… --events a,b`), tests, rotates and deletes (`delete <id> --yes`) the places Docustay posts events; the signing secret is shown once.
- **logs** shows the email log, or `--webhook <id>` a webhook's recent deliveries; add `--json` to any command for machine-readable output.

MIT licence. Node 18 or newer. Built from `sdk/cli` in the Docustay repository.
