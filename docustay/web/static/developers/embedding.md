---
title: Embedded e-signature
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

## Let your people build templates inside your page.

The same editor Docustay uses, in a frame on your website. Your server asks for a session.

```
POST /api/v1/embedded/builder-session
{ "origin": "https://app.example.com", "name": "Services agreement" }
```

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
