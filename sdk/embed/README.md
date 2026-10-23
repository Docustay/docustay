# @docustay2026/embed

`<docustay-sign>` shows a Docustay signing form inside your own page. No dependencies, no build step. MIT.

1. In Settings → Developers → Embedding, list the website that will show the form (for example `https://app.example.com`).
2. On YOUR server, send the document with the seat marked embedded, then ask for a session. The API key never goes to a browser:

```js
const { id } = await docustay.sendDocument({ templateId, embedded: ["signer_1"], parties });
const { url } = await docustay._request("POST", `/api/v1/documents/${id}/embed-session`, { body: { seat: "signer_1", origin: "https://app.example.com" } });
```

3. In the page:

```html
<script type="module">import "@docustay2026/embed";</script>
<docustay-sign url="…the url from step 2…" height="720"></docustay-sign>
<script>document.querySelector("docustay-sign").addEventListener("completed", (e) => console.log("signed", e.detail.documentId));</script>
```

Events (each carries `documentId`): `ready`, `waiting`, `completed`, `declined`, `error`, `resize`; `docustay` carries all of them as `{ type, … }`. Add `auto-height` to follow the form's height. The link works for one hour. The form accepts being framed only by the websites you listed, and the element only listens to that form.
Wrappers: `@docustay2026/react`, `@docustay2026/vue`, `@docustay2026/angular`.
