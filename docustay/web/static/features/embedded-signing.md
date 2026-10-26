---
title: Embedded e-signature for your app | Docustay
description: Embedded e-signature: put the signer, the document builder and Scribe inside your own product as components, on the websites you allow.
---

# Signing inside your app.

Embedded e-signature shows the signing page, the builder and Scribe inside your own product. The signer never leaves your site, and you hear about it the moment they finish.

## The signer, the builder and Scribe.

**The signer.** Your page asks for a short-lived session for one seat and shows the signing page inside it.

**The builder.** Let your people build templates inside your own page, in the same editor Docustay uses. The session is made on your server and cannot send a document.

**Scribe.** Offer the document assistant as part of your own screens.

## From your server to a signed document.

1. **Your server**: Asks for a session
2. **Docustay**: Returns a short-lived address
3. **Your page**: Shows the signer
4. **Event**: completed reaches your code

## Only the websites you list.

Add the websites that may show the signer. Any other origin is refused, so nobody can frame your signing pages somewhere you did not agree to.

- An allow list under Developers, then Embedding.
- A framed page on an unlisted site shows a refusal, not the document.

## Six events, one handler.

```
<docustay-sign url="SESSION_URL"></docustay-sign>
<script>
  document.querySelector("docustay-sign").addEventListener("completed", (e) => console.log("signed", e.detail));
</script>
```

## What your page hears.

| Event | When it fires | What you do |
| --- | --- | --- |
| ready | The form has loaded inside your page | Hide your loading state |
| waiting | It is not this person's turn yet | Show a message that someone else signs first |
| completed | The signer finished | Treat it as a prompt, then confirm on your server that the state is executed |
| declined | The signer declined | Record it and tell the sender |
| error | The link was refused: expired, wrong, or your website is not on the list | Ask your server for a fresh session |
| resize | The form's height changed | Resize the frame if you do not use auto-height |

## Plain HTML, React, Vue and Angular.

**A custom element.** Drop in the docustay-sign element and give it the session address. It works on any page with a script tag.

**Framework components.** React, Vue and Angular wrappers around the same element, each raising the same events.

**Your server.** The session is created on your server with a key, so no secret reaches the browser. The address is the only thing the page sees.

## What you do and what Docustay does.

- **Settings**: List the websites that may show the form, for example your app's address
- **Send**: Mark the seat as embedded so nobody is emailed for it
- **Server**: Ask for a session for one seat and one origin
- **Page**: Show the element and listen for completed

- **Session**: Returns an address that works for an hour for that seat
- **Frame**: Lets only the websites you listed show the form
- **Events**: Sends events to your page only on your listed website
- **Seal**: Seals the document and calls your webhook

## Let your people build templates in your own page.

The builder is the same editor Docustay uses, shown in a frame on your website. Your server asks for a builder session, your page shows it, and your code gets a template id when the person saves.

- The session key lives in the address fragment, so no server log sees it, and expires in an hour.
- It can read and write templates and nothing else. It cannot send a document.

## A refused frame cannot speak, so the element does.

Docustay sends a frame-ancestors header naming exactly the websites you listed, and only for a link made for an embedded seat. An ordinary emailed link can never be framed, even if someone adds embed=1 to it.

If nothing arrives from the frame after fifteen seconds, the element raises an error itself, because a refused frame cannot report that it was refused. Your page can then ask for a new session or show a plain message.

## Questions

**Which frameworks are supported?**

Plain HTML, plus React, Vue and Angular components.

**Can the signer need an account on my site?**

No. The signer needs only the session address your server asked for.

**What happens on a site I did not list?**

The page refuses to show the document.

**Does it work on a self-hosted install?**

Yes. Use your own address for the embed script, which is your install's web address followed by /embed/index.js.

**How long does a session last?**

An hour. Ask again each time the page loads. The five newest links for a seat keep working until their hour is up, so a page that reloads does not break a form that is already open.


## Keep reading

- [Test mode](/features/test-mode)
- [Your brand](/features/white-label)
- [Developers](/developers)
