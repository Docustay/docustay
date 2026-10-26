---
name: docustay-text-tags
description: Use when writing or fixing a Docustay template from HTML or a PDF with text tags such as {{Tenant signature;type=signature;role=Tenant}}.
---

# Docustay text tags

A text tag is written in the document where a field should go: `{{Label;type=signature;role=Tenant}}`.

- First part: the name. A tag needs at least one `key=value` after it; `{{signer.name}}` with no `key=value` is a merge field, not a tag.
- `type=` one of `signature`, `initials`, `date_signed`, `stamp`, `text` (the default), `number`, `date`, `email`, `phone`, `zip`, `checkbox`, `dropdown` (or `select`), `multiselect`, `image`, `file`, `payment`.
- `role=` who fills it in, any words ("Buyer", "Landlord"). The first role written is the first signer; each distinct role becomes a seat (`signer_1`, `signer_2`, …).
- Other keys: `required=true|false` (default true), `default=` (not on signature, initials, date_signed or stamp), `options=Monthly,Yearly` (a comma list, for dropdown and multiselect), `label=` (the caption the signer sees), `width=` and `height=` in points, `max_length=`, and for payments `amount=150.00 currency=usd`.
- `payment` fields take exactly ONE of `amount=150.00`, `formula=qty*price*(1+tax/100)` (other fields' names, + - * / and brackets only), `price=price_1…` (a one-time Stripe price) or `link=https://buy.stripe.com/…`. The signer pays on Stripe's page; the money goes to the customer's own Stripe account; Docustay's fee is 2% on Free and 0% on Pro plus Stripe's fees. Never put an amount in anything the browser sends — the server works it out. `get_document` lists `payments` with status, receipt and fee.
- A value containing a semicolon or an equals sign goes in double quotes: `default="Smith; Jones"`.

Make a template with `create_template_from_html` (pass HTML containing the tags) or by uploading a PDF that has the tags written in it. Scripts, forms, frames and remote addresses in HTML are removed; pictures must be `data:` addresses.

After creating a template, run `get_template` and check the seat list matches what you meant. A tag that cannot be read comes back as a warning naming that tag: fix the tag, do not delete the warning.
