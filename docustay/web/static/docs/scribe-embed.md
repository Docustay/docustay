# Scribe in your own app

`<docustay-scribe>` shows Scribe inside your own page. The person picks a document from a list, says who signs, answers a few clickable questions and gets a **draft**. Nothing is emailed: asking to send files an approval that a person decides in Docustay.

1. **On your server**, with a key that has `embedded:write`:

   ```
   POST /api/v1/embedded/scribe-session
   { "origin": "https://app.example.com" }
   ```

   The answer is a `url` that works for one hour. The website must be on your allowed list (Settings → Developers → Embedding), else the answer is 409.
2. **In your page:**

   ```html
   <script type="module" src="https://docustay.app/embed/index.js"></script>
   <docustay-scribe url="…the url…" height="720"></docustay-scribe>
   ```

The script address above is the hosted one. On a self-hosted install or the sandbox, use your own address instead: your install's web address followed by `/embed/index.js`.


3. **Listen** for `ready`, `drafted` (`{ documentId, title }`), `send_requested` (`{ documentId }`), `error` and `resize`.

The key inside the link is made for this session only, sits in the `#fragment` so no server log sees it, is **draft-only** (a direct send through it files an approval and sends nothing), allows 50 drafts a day and ends in an hour. The link names the one website that may frame it and is signed: change the website and it will not frame anywhere. Plays are part of Pro.

## What the person sees

The element draws one panel: a list of your documents, a place to say who signs, and a few clickable questions. Each answer is a button, not a typed reply, so a person never needs to know what to ask. At the end there is a draft with its fields placed, and two choices: change it, or ask for it to be sent.

## What stays under your control

The session key your server makes is draft-only: it can read documents and templates and prepare drafts, and it cannot send. It lasts an hour, it is limited to fifty drafts a day, and it only works from the websites you list as allowed. A request to send files an approval inside Docustay that one of your people decides; nothing is emailed until they do.

## When it does not load

If the panel says it cannot start, check three things in order: the session address on your server answered with a token (a key without `embedded:write` gets a refusal), the page's address is on the allowed-sites list under Settings → Developers → Embedding, and the key is a draft-only one. The browser console names the first one that fails.
