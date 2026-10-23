# Embedded signing

Show the signing form inside your own page, so the signer never leaves your app.

## How it fits together

1. **List your website.** In **Settings → Developers → Embedding** add each website that will show the form, one per line, for example `https://app.example.com`. While developing, add `http://localhost:3000` (or your own port) to the same list: localhost is the one plain `http` address it takes. Nothing else (no path, no other plain `http`) is. An address that is not on the list gets `409` with the address in the message.
2. **Send with embedded seats.** On your server add `embedded: ["signer_1"]` to the send request. Nobody is emailed for those seats.
3. **Ask for a session.** On your server call `POST /api/v1/documents/{id}/embed-session` with `{ "seat": "signer_1", "origin": "https://app.example.com" }`. The answer is `{ url, expiresAt }`. The link works for one hour; ask again each time the page loads. Asking again does not end a session that is already open: the five newest links for a seat keep working until their hour is up, so a page that loads twice or a second tab is fine.
4. **Show it.** Give the `url` to the element.

The API key stays on your server. The `url` is the only thing the browser sees.

## The element

```html
<script type="module" src="https://docustay.app/embed/index.js"></script>
<!-- on your own install, use your own address: https://YOUR-HOST/embed/index.js -->
<docustay-sign url="https://…/sign/pdf?t=…&embed=1&parent=https%3A%2F%2Fapp.example.com" height="720"></docustay-sign>
```

The script address above is the hosted one. On a self-hosted install or the sandbox, use your own address instead: your install's web address followed by `/embed/index.js`.


Attributes: `url`, `height` (pixels or any CSS length), `auto-height` (follow the form's own height), `title`. Events, each with `detail.documentId`:

| Event | When |
|---|---|
| `ready` | the form has loaded |
| `waiting` | it is not this person's turn yet |
| `completed` | the signer finished |
| `declined` | the signer declined |
| `error` | the link was refused (expired, wrong, or the website is not on the list). A refused frame cannot speak, so the element raises this itself when nothing has arrived from the frame after 15 seconds (`detail.message` says the form did not load) |
| `resize` | the form's height changed (`detail.height`) |

The `docustay` event carries all of them as `{ type, … }`. Events do not bubble.

## React, Vue, Angular

Install the wrapper for your framework together with the web component it wraps:

```bash
npm install @docustay2026/react @docustay2026/embed     # React 17 or later
npm install @docustay2026/vue @docustay2026/embed       # Vue 3.3 or later
npm install @docustay2026/angular @docustay2026/embed   # Angular 17 or later
```

```jsx
import { DocustaySign } from "@docustay2026/react";
<DocustaySign url={session.url} onCompleted={({ documentId }) => confirmOnServer(documentId)} />
```

```vue
<DocustaySign :url="session.url" @completed="done" />
```

```html
<docustay-sign-form [url]="session.url" (completed)="done($event)"></docustay-sign-form>
```

## What keeps it safe

- The form can be framed only by the websites you listed. Docustay sends a `frame-ancestors` header naming exactly those, and only for a link made for an embedded seat. An ordinary emailed link is never frameable, even with `embed=1` added.
- The form sends its events to one parent origin, the one in the link, and only if it is on your list. The element accepts a message only from its own frame and the form's own origin.
- Treat `completed` as a prompt, not proof: confirm with `GET /api/v1/documents/{id}` on your server (`state: executed`).

## Let your people build templates inside your own page

The builder is the same editor Docustay uses, in a frame on your website. Your server asks for a session; your page shows it.

1. **On your server** (never in a browser), with a key that has the `embedded:write` scope:

   ```bash
   curl -X POST "${DOCUSTAY_URL:-https://docustay.app}/api/v1/embedded/builder-session" \
     -H "Authorization: Bearer $DOCUSTAY_API_KEY" -H "Content-Type: application/json" \
     -d '{ "origin": "https://app.example.com", "name": "Services agreement" }'
   ```

   The answer is a `url` that works for one hour. The website must already be on your allowed list (Settings → Developers → Embedding); anything else gets a 409.
2. **In your page**, show it:

   ```html
   <script type="module" src="https://docustay.app/embed/index.js"></script>
   <docustay-builder url="…the url…" height="760"></docustay-builder>
   ```

3. **Listen** for `ready`, `saved` (`{ templateId, name, fields }`) and `error`. Use the `templateId` to send documents from your server as usual.

What keeps it safe: the key inside the link is created for this session only, lives in the `#fragment` (so no server log sees it), expires in an hour, and can read and write templates and nothing else — it cannot send a document. The link names the one website that may frame it and is signed; change the website and it will not frame anywhere.
