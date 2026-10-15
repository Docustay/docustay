# Search, contracts, payments and automations

These calls do what the app's own screens do: the search box, the Contracts view of Documents, the Payments tab of Billing and the Automations canvas. Each one calls the same code as the screen, so the API and the app always give the same answer.

| You want to | Call | Scope |
|---|---|---|
| Find documents, templates, forms and people | `GET /api/v1/search?q=…` | `documents:read` |
| List signed contracts with their key dates | `GET /api/v1/contracts` | `documents:read` |
| Correct one key date by hand | `POST /api/v1/contracts/{id}/dates` | `documents:write` |
| List payments taken while signing | `GET /api/v1/payments` | `documents:read` |
| Refund a payment, in full or in part | `POST /api/v1/payments/{id}/refund` | `documents:write` |
| List the automations built on the canvas | `GET /api/v1/automations` | `plays:read` |
| Switch an automation on or off | `POST /api/v1/automations/{id}/enable` | `plays:write` |

A key without the scope gets `401`, the same answer as a wrong key. Another workspace's document, payment or automation is `404`: a key never learns that it exists.

## Search

`q` is the words to look for. `per` is how many of each kind come back (1 to 20, default 6). The answer is grouped into `documents`, `templates` (forms are in here too, with `kind: "form"`) and `people`, best match first.

```js
const r = await docustay.search("Deposit", { per: 5 });
for (const d of r.groups.documents) console.log(d.id, d.state, d.title);
```

## Contracts and key dates

When a document is signed, Docustay reads its start, end, notice and renewal dates and its value from the boxes the signers filled in. `GET /api/v1/contracts` lists every signed document with those dates. Each date says where it came from in `source`: a box on the document, or a person's correction. `q` filters by title, person or amount. The `summary` counts every signed contract, and the ones with a renewal, end or notice date in the next 30 days.

A date read wrongly can be corrected. The signed PDF never changes. The correction is kept as the person's, and renewal reminders follow it. Send `date: null` to clear one.

```js
await docustay.setContractDate(contractId, { kind: "end", date: "2027-01-31" });
```

## Payments

A payment box on a document takes the money while the person signs. `GET /api/v1/payments` lists them newest first, with this month's figures in `month`. Each payment has its `status`:

| Status | Means |
|---|---|
| `paid` | Stripe took the money |
| `waiting` | signed, and the signature is kept while they pay (for up to 7 days) |
| `started` | they opened the payment and did not finish it |
| `refunded` / `partially_refunded` | some or all of it was given back |
| `disputed` | the payer's bank opened a dispute; answer it in Stripe |

In `month`, `stripeFee` is Stripe's own fees on this month's payments, and `stripeFeePending` counts the payments Stripe has not settled yet (that can take a few minutes). Page through with `before`, using `next` from the previous page.

### Refunds

A refund goes through Stripe on your workspace's own Stripe account. Leave out `amountMinor` to refund the rest of the payment, or give it in the smallest unit of the currency (`500` is 5.00). `reason` is required: the payer sees it on their receipt, and it goes in the document's audit trail. The signed document stays signed.

A refund moves money, so it needs an `Idempotency-Key`. Send the same key again and you get the first answer back, with no second refund. The SDKs add a key for you and reuse it when they retry.

```js
const r = await docustay.refundPayment(paymentId, { amountMinor: 500, reason: "Charged twice" });
console.log(r.status, r.refundedLabel);   // "partially_refunded", "$5.00"
```

```python
docustay.refund_payment(payment_id, reason="Charged twice")   # the rest of the payment
```

From the command line, `docustay payments refund <id> --reason "…" --yes` does the same. It never runs without `--yes`, or a typed yes at the prompt.

## Automations

An automation built on the canvas starts when a document from a chosen template or form is signed, then runs its steps: wait, check an answer, send the next document. `GET /api/v1/automations` lists them with whether each is on, how many times it ran and when it last ran. (`GET /api/v1/playbooks` lists playbooks: packs of templates and skills. See [the template library](/docs/template-library.md).)

`POST /api/v1/automations/{id}/enable` with `{ "on": true }` switches one on, which needs Pro. From then on, each matching signed document starts a run. `{ "on": false }` stops new runs. A run that is already waiting stops when its wait ends, without sending anything.

```js
await docustay.setAutomationOn(automationId, true);
```

## From an AI assistant

The MCP server has `search_documents`, `list_contracts`, `set_contract_date`, `list_payments` and `list_automations`. It has no tool to refund a payment or to switch an automation on: those move money or start sending documents to people, so a person does them in the app, from the command line or from their own code.
