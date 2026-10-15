---
title: Signing order for documents
description: Signing order decides who signs first. Send to one person at a time or to everyone at once, and see who is signing now. Free on every plan.
---

# Signing order: who signs first.

Choose whether people sign one after another or all together. The next person is told only when it is their turn.

## A lease addendum.

**One at a time.** The tenant signs first, then the co-tenant, then the landlord. Nobody signs a page the others have not seen.

**All at once.** A permission slip goes to both parents together. Whoever signs first is no faster than the second.

**Change it later.** If the order was wrong, fix it before the next person's turn. Anyone who has signed keeps their signature.

## Say the order when you make the document.

Each person is a name, an email, a role, an action and an order.

```
curl -X POST https://app.docustay.app/api/v1/documents \
  -H "Authorization: Bearer $DOCUSTAY_KEY" \
  -H "Idempotency-Key: $(uuidgen)" -H "Content-Type: application/json" \
  -d '{
    "title": "Lease addendum",
    "source": { "type": "doc", "content": [ /* the words */ ] },
    "people": [
      { "name": "Dana Tenant", "email": "tess@example.com", "role": "Tenant", "order": 1 },
      { "name": "Lou Landlord", "email": "lou@example.com", "role": "Landlord", "order": 2 }
    ]
  }'
```

## Questions

**Can some people sign together and others after?**

A package can hold several documents, and each document can have its own order.

**What if the first person never signs?**

Set an expiry so an old request cannot be signed months later, and use reminders to nudge them.

**Does the order show on the certificate?**

Yes. The certificate lists each signature with its time, so the order is part of the proof.


## Keep reading

- [Sending](/product/sending)
- [Lease addendum template](/templates/lease-addendum-template)
- [Real estate](/use-cases/real-estate)
