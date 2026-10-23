---
title: Put the signer in your own page
description: Show the signing form inside your own page with the docustay-sign element. Sessions last one hour, origins are allow-listed, and your key stays on your server.
---

# Embedding the signer

Put the signing form in your own page with one element. Your key stays on your server.

## From your server to the signer.

1. **List the site**: Settings → Developers → Embedding
2. **Send**: embedded: ["signer_1"]
3. **Session**: POST …/embed-session
4. **Show**: <docustay-sign url>

## The element.

- **url**: The session address
- **height**: Pixels or any CSS length
- **auto-height**: Follow the form's own height
- **title**: Accessible name

- **ready**: The form loaded
- **completed**: The signer finished
- **declined**: The signer declined
- **error**: The link was refused
- **resize**: detail.height changed

## One element, or a wrapper for your framework.

Give the session url to the element. The API key stays on your server.

```
<script type="module" src="https://docustay.app/embed/index.js"></script>
<docustay-sign url="https://…/sign/pdf?t=…&embed=1" height="720"></docustay-sign>
```

## Four rules the embed enforces.

| Rule | What it means |
| --- | --- |
| Your sites only | The form can be framed only by the websites you listed; Docustay sends a frame-ancestors header naming exactly those |
| Embedded seats only | An ordinary emailed link is never frameable, even with embed=1 added |
| One parent | The form sends its events to one parent origin, the one in the link |
| One hour | A session link works for an hour; ask again on each page load |



## Let your people build templates inside your page.

The same editor Docustay uses, in a frame on your website. Your server asks for a session.

```
POST /api/v1/embedded/builder-session
{ "origin": "https://app.example.com", "name": "Services agreement" }
```

## How the pieces fit.

| Topic | Detail |
| --- | --- |
| List your website | In Developers, Embedding add each site, one per line, such as https://app.example.com. http://localhost:3000 is allowed while you build; no path and no other plain http. |
| Send embedded seats | Add embedded: ["signer_1"] to the send request on your server. Nobody is emailed for those seats. |
| Ask for a session | Call POST /api/v1/documents/{id}/embed-session with the seat and origin. The answer is url and expiresAt, good for one hour. |
| Show it | Give the url to the docustay-sign element, or to a wrapper for React, Vue or Angular. The browser sees only the url. |

## Send, then ask for the session.

The embed-session call needs an Idempotency-Key and a key with the embedded:write scope (documents:write opens it too). The API key never leaves your server.

```
curl -X POST https://app.docustay.app/api/v1/documents/send \
  -H "Authorization: Bearer $DOCUSTAY_API_KEY" -H "Idempotency-Key: $(uuidgen)" -H "Content-Type: application/json" \
  -d '{ "templateId": "TEMPLATE_ID", "embedded": ["signer_1"], "parties": [{ "seat": "signer_1", "name": "Rosa Alvarez", "email": "rosa@example.com" }] }'
```

## What the element tells your page.

| Event | When |
| --- | --- |
| ready | The form has loaded |
| waiting | It is not this person's turn yet |
| completed | The signer finished |
| declined | The signer declined |
| error | The link was refused: expired, wrong, or the website is not on the list |
| resize | The form's height changed (detail.height) |

Attributes are url, height, auto-height and title. Events do not bubble.

## Treat completed as a prompt.

| Topic | Detail |
| --- | --- |
| Confirm on your server | Treat completed as a prompt, not proof: confirm with GET /api/v1/documents/{id} on your server and look for state executed. |
| Only your listed websites | The signing page can be framed only by the websites you listed under Developers, then Embedding. With no websites listed it cannot be framed anywhere. |

## Let your people build templates in your page.

| Part | Detail |
| --- | --- |
| Server call | POST /api/v1/embedded/builder-session with the origin and a name; the website must already be on your allowed list or you get 409 |
| Element | docustay-builder, with url and height; it fires ready, saved ({ templateId, name, fields }) and error |
| The key inside the link | Made for this session only, kept in the #fragment so no server log sees it, expires in an hour, and can read and write templates and nothing else |
| After saving | Use the templateId to send documents from your server as usual |



## The rules for the website list.

| Entry | Accepted? |
| --- | --- |
| https://app.example.com | Yes: a scheme and a host |
| http://localhost:3000 | Yes, while you develop |
| https://app.example.com/page | No: no path |
| http://app.example.com | No: no plain http outside localhost |

Add them in Developers, Embedding, one per line. A site not on the list makes the element fire error and a builder session answer 409.

## Where to go from here.

| Next | Why | Page |
| --- | --- | --- |
| Make the key | embedded:write is its own scope; give it to one key. | Keys and security: /developers/keys-and-security |
| Practise | Embed a test document and sign it with test-sign. | Test mode: /developers/test-mode |
| Confirm on the server | Read the document state after completed. | REST API: /developers/api |

## Questions

**Is anyone emailed for an embedded seat?**

No. Nobody is emailed for seats you mark embedded.

**Can I develop on localhost?**

Yes. http://localhost:3000 is allowed while you build.

**Which licences?**

The React, Vue and Angular wrappers are MIT.


## Keep reading

- [REST API](/developers/api)
- [Keys and security](/developers/keys-and-security)
- [SDKs](/developers/sdks)
