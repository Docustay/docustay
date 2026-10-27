<script>
  
  // THE DEVELOPERS HUB (BUILD-BLUEPRINT §5.2): 15 sections. Facts come from facts.gen.json, plans.js, packages.js, the changelog and docustay/docs; every capability sentence carries its feature marker.
  import DeskHead from "$lib/site/desk/DeskHead.svelte";
  import Faq from "$lib/site/desk/Faq.svelte";
  import { feat } from "$lib/site/desk/feat.js";
  import { reveal } from "$lib/site/desk/reveal.js";
  import CodeWindow from "$lib/site/ui/CodeWindow.svelte";
  import Terminal from "$lib/site/ui/Terminal.svelte";
  import EventTimeline from "$lib/site/ui/EventTimeline.svelte";
  import SectionHeading from "$lib/site/ui/SectionHeading.svelte";
  import Tile from "$lib/site/ui/Tile.svelte";
  import Callout from "$lib/site/ui/Callout.svelte";
  import BorderBeam from "$lib/site/ui/BorderBeam.svelte";
  import { SEND_TABS, SEND_RESPONSE, VERIFY_NODE, VERIFY_PY } from "$lib/site/home-code.js";
  import { CHANGES } from "$lib/site/changelog.js";
  import facts from "$lib/site/facts.gen.json";
  import { dollars, SELFHOST_PRO_YEARLY_MINOR, AI_CREDITS, LIMITS } from "$lib/site/plans.js";
  let { data } = $props();
  const p = $derived(data.plans);
  let cur = $state(0);
  const T = (s) => feat(s);
  const I = { code: "M9 7l-6 6 6 6M17 7l6 6-6 6M14.5 5l-3 16", shield: "M13 3l8 3v6c0 5-3.5 8.5-8 11-4.5-2.5-8-6-8-11V6l8-3zM9 13l3 3 5-6", server: "M5 4h16a2 2 0 012 2v3a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2zM5 15h16a2 2 0 012 2v3a2 2 0 01-2 2H5a2 2 0 01-2-2v-3a2 2 0 012-2z", file: "M6 3h9l5 5v15H6zM15 3v5h5M9 13h8M9 17h8", bolt: "M13 2L4 14h7l-1 8 9-12h-7z", cert: "M12 3l2.5 2 3.2-.3.9 3.1 2.8 1.6-1 3.1 1 3.1-2.8 1.6-.9 3.1-3.2-.3L12 22l-2.5-2-3.2.3-.9-3.1L2.6 15.6l1-3.1-1-3.1 2.8-1.6.9-3.1 3.2.3zM9 12l2 2 4-4", agent: "M12 3v3M5 9h14v9H5zM9 13h.01M15 13h.01M9 21v-3M15 21v-3", book: "M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2zM4 19V5M9 8h6", plug: "M9 3v5M15 3v5M6 8h12v4a6 6 0 01-12 0zM12 18v3", term: "M4 5h16v14H4zM8 10l3 2-3 2M13 15h4", key: "M14 4a6 6 0 11-3.2 11L8 18H5v-3l3-3 .1-.2A6 6 0 0114 4zM16 8h.01" };
  const WHY = $derived([
    { k: "A1", i: "book", h: "One file says what the API does.", p: `${facts.operations} operations in a single OpenAPI 3.1 file. The reference pages and the generated clients are built from it, so they cannot drift apart. {{F-API}}` },
    { k: "A3", i: "shield", h: "A test key is safe by construction.", p: "A key that starts dsk_test_ emails only you, stamps every page TEST, and its documents never count toward a limit. {{F-TESTMODE}}" },
    { k: "A2", i: "bolt", h: "Retries that cannot double-send.", p: "Every create takes an Idempotency-Key of 8 to 200 characters. Repeat the request with the same key and you get the same answer, not a second email. {{F-API}}" },
    { k: "A6", i: "cert", h: "Webhooks you verify, not trust.", p: "Deliveries carry the Standard Webhooks headers and an HMAC signature over the raw body, and the SDKs refuse a changed body, a wrong secret or an old timestamp. {{F-WEBHOOKS}}" },
    { k: "A3", i: "agent", h: "A draft-only key for agents.", p: "The drafts:write scope makes drafts and nothing else, so an assistant can prepare a document that a person then sends. {{F-DRAFTKEYS}}" },
    { k: "A5", i: "server", h: "Run the same code yourself.", p: "The server, the app and the signing page are AGPL-3.0, and the clients are MIT. Self-host in three commands, and your documents stay on your server. {{F-SELFHOST}}" },
    { k: "A4", i: "key", h: "Keys that can only do one job.", p: "Scopes are ticked per key, from the broad documents:read to one-job scopes such as templates:read, and a request without the scope gets the same plain 401 as a wrong key. {{F-API}}" },
    { k: "A2", i: "file", h: "Templates you can write as text.", p: "Write a template as HTML or a PDF with text tags such as {{Sign here;type=signature;role=Partner}} and the fields place themselves. {{F-TEMPLATES}}" },
    { k: "A1", i: "plug", h: "No per-call API fee.", p: "There is no per-call or per-API-document fee on any plan. The limit is 600 requests a minute for each key. {{F-API}}" },
  ]);
  const clients = [["JavaScript", "By hand, no dependencies. Idempotency keys, retries, typed errors and webhook verification.", "/docs/sdks", "A1"], ["TypeScript", "The same package with its types.", "/docs/sdks", "A1"], ["Python", "By hand, standard library only. The same behaviour.", "/docs/sdks", "A1"], ["Go", "Generated from the OpenAPI file.", "/docs/sdks", "A6"], ["PHP", "Generated from the OpenAPI file.", "/docs/sdks", "A6"], ["C#", "Generated from the OpenAPI file.", "/docs/sdks", "A6"]];
  const scopesNow = [["documents:read", "List and read documents and templates, read the audit log, download signed copies."], ["documents:write", "Send documents, make templates, remind, void, start an embedded signing session."], ["templates:write", "Make and change templates, their defaults and the wording of your emails."], ["webhooks:write", "Add, change, test and remove webhook addresses, and make a new signing secret."], ["drafts:write", "Make drafts only. Nothing in it sends a document."], ["account:read", "Read plan usage, payment status and teams, and nothing else."]];
  const faq = $derived([
    ["Is there a free tier for building?", `Yes. The Free plan includes the API, webhooks and test mode inside ${p.free.docsPerMonth} documents and ${p.free.templatesPerMonth} new templates a month, and test documents never count. {{F-FREEPLAN}}`],
    ["How do I authenticate?", "Send Authorization: Bearer with a key made in Developers, then API keys. A key carries only the scopes you ticked, is shown once, and can be revoked at any time. {{F-API}}"],
    ["Are the SDKs on npm and PyPI?", "Not yet. Until the packages are published you install the clients from a clone of the repository, and one switch turns the short install commands on the day they are. {{F-SDK}}"],
    ["What does the API return when a request fails?", "Every error is an object with a kind, a message, a requestId and a retryable flag. The kind is one of invalid, unauthenticated, forbidden, not_found, conflict, rate_limited, dependency or timeout. {{F-API}}"],
    ["Can an AI assistant send documents?", "Only if you let it. The MCP server previews a send and acts on a second, confirmed call, a read-only switch removes every tool that changes anything, and a draft-only key cannot send at all. {{F-MCP}}"],
    ["Can I run it on my own servers?", `Yes. The Community edition is free under the AGPL-3.0, and Self-host Pro is ${dollars(SELFHOST_PRO_YEARLY_MINOR)} a year for each install. {{F-SELFHOST}}`],
  ]);
  const ld = $derived(JSON.stringify({ "@context": "https://schema.org", "@type": "TechArticle", headline: "The Docustay developer hub", about: facts.tagline.headline, author: { "@type": "Organization", name: "Docustay" }, url: "https://docustay.app/developers" }));
</script>
<DeskHead crumbs={[["Developers", "/developers"]]} title={facts.tagline.siteTitle} description={facts.tagline.about} />
<svelte:head>{@html `<script type="application/ld+json">${ld}</script>`}</svelte:head>

<!-- claim-until-proven: F-MCP and F-DRAFTKEYS stay marked PENDING PROOF until they are driven in the sandbox, as the features list says -->
<div class="hub" data-req="code,why-grid,faq">

<!-- 1 · HERO -->
<section class="hero" aria-labelledby="h1">
  
  <div class="hero-in">
    <span class="d-chip">DEVELOPERS · REST · WEBHOOKS · MCP</span>
    <h1 id="h1" class="d-h1">{facts.tagline.headline}</h1>
    <p class="d-sub c">{facts.tagline.support} {facts.operations} operations in one OpenAPI file, test mode on from the first call, signed webhooks, six clients, a command line and an MCP server.</p>
    <div class="d-actions c"><a class="d-btn main" href="/docs/quickstart" data-umami-event="cta_click" data-umami-event-location="dev-hero" data-umami-event-target="quickstart">Open the quickstart</a><a class="d-btn alt" href="/demo" data-umami-event="cta_click" data-umami-event-location="dev-hero" data-umami-event-target="demo">Try the demo</a></div>
    <p class="d-fine">Free to start. No card for the demo.</p>
  </div>
  <div class="hero-code" data-hero="d-hub" data-area="developers"><CodeWindow tabs={SEND_TABS} bind:cur title="send-a-document" response={SEND_RESPONSE} page="dev-hero" label="Hero language" tilt /></div>
</section>

<!-- 2 · QUICKSTART -->
<section class="sec" aria-labelledby="s-qs">
  <SectionHeading id="s-qs" align="center" eyebrow="QUICKSTART" title="From a key to a signed document in *three* steps." lead="Every tab is the same request in a different language, and each one was run against the API's own rules before it was published." />
  <ol class="steps3" data-reveal {@attach reveal}>
    <li><b>1</b><h3 class="d-h3">Make a test key.</h3><p data-feature="F-TESTMODE">In the app open Developers, then API keys, and tick <code>documents:read</code> and <code>documents:write</code>. A key that starts <code>dsk_test_</code> only does practice runs.</p></li>
    <li><b>2</b><h3 class="d-h3">Send a template.</h3><p data-feature="F-API">Post the template's id and who signs to <code>/api/v1/documents/send</code>. A seat name such as <code>signer_1</code> comes from the template, and the answer is the document's id and its state.</p></li>
    <li><b>3</b><h3 class="d-h3">Hear the result.</h3><p data-feature="F-WEBHOOKS">Register an endpoint and Docustay posts a signed event each time something happens. When the document is executed, fetch the sealed PDF.</p></li>
  </ol>
  <div class="two-code" data-reveal {@attach reveal}>
    <CodeWindow tabs={SEND_TABS} bind:cur title="send-a-document" response={SEND_RESPONSE} page="dev-quickstart" label="Quickstart language" />
    <CodeWindow tabs={[{ label: "cURL", code: "curl https://docustay.app/api/v1/documents/DOCUMENT_ID/signed.pdf \\\n  -H \"Authorization: Bearer $DOCUSTAY_API_KEY\" -o signed.pdf" }]} title="get-the-signed-pdf" page="dev-signed" label="Signed copy" />
  </div>
</section>

<!-- 3 · WHY -->
<section class="sec why" aria-labelledby="s-why" data-why>
  
  <div class="why-in">
    <SectionHeading id="s-why" align="center" eyebrow="WHY DOCUSTAY" title="What developers get that is *different*." lead="Nine things you can check yourself, each with the page where it is written down." />
    <ul class="wgrid">{#each WHY as w}{@const c = T(w.p)}<li class="wcard" data-reveal {@attach reveal}><Tile kind={w.k} size={56}><svg viewBox="0 0 26 26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d={I[w.i]} /></svg></Tile><h3 class="d-h3">{w.h}</h3><p data-feature={c.ids}>{c.text}</p></li>{/each}</ul>
  </div>
</section>

<!-- 4 · CLIENTS -->
<section class="sec" aria-labelledby="s-sdk">
  <SectionHeading id="s-sdk" align="center" eyebrow="CLIENTS FOR EVERY STACK" title="Six *clients*, a CLI, an MCP server and a plugin." lead="Use whichever door fits. They all call the same API." />
  <ul class="cl">{#each clients as [n, d, h, k]}<li data-reveal {@attach reveal}><Tile kind={k} size={44}><svg viewBox="0 0 26 26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d={I.code} /></svg></Tile><div><h3 class="d-h3">{n}</h3><p data-feature="F-SDK">{d}</p></div></li>{/each}
    <li data-reveal {@attach reveal}><Tile kind="A3" size={44}><svg viewBox="0 0 26 26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d={I.term} /></svg></Tile><div><h3 class="d-h3">Command line</h3><p data-feature="F-CLI">Send a test document, forward real signed webhooks to your laptop and verify a signature.</p></div></li>
    <li data-reveal {@attach reveal}><Tile kind="A3" size={44}><svg viewBox="0 0 26 26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d={I.agent} /></svg></Tile><div><h3 class="d-h3">MCP server</h3><p data-feature="F-MCP">{facts.mcpTools} tools, with a preview before anything is sent.</p></div></li>
    <li data-reveal {@attach reveal}><Tile kind="A3" size={44}><svg viewBox="0 0 26 26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d={I.plug} /></svg></Tile><div><h3 class="d-h3">Claude plugin</h3><p data-feature="F-MCP">The server plus five skills for sending, text tags, embedding, webhooks and agent safety.</p></div></li>
  </ul>
  <div class="two-code" data-reveal {@attach reveal}>
    <Terminal title="your laptop" lines={[{ t: "cmd", s: "npx docustay login" }, { t: "cmd", s: "npx docustay send --test $DOCUSTAY_TEMPLATE_ID --party 'signer_1=Rosa Alvarez <rosa@example.com>'" }, { t: "ok", s: "✔ sent — document 11111111-2222-4333-8444-555555555555 (test), 1 email sent" }, { t: "cmd", s: "npx docustay listen --forward-to http://localhost:3000/webhooks" }]} />
  </div>
  <p class="more"><a class="d-btn alt sm" href="/developers/sdks">SDKs</a><a class="d-btn alt sm" href="/developers/cli">The CLI</a><a class="d-btn alt sm" href="/developers/agents">Agents and MCP</a></p>
</section>

<!-- 5 · AUTH AND SCOPES -->
<section class="sec split" aria-labelledby="s-auth">
  <div class="sp-l"><SectionHeading id="s-auth" eyebrow="AUTHENTICATION AND SCOPES" title="A key can do exactly what you *tick*." lead="Send Authorization: Bearer on every request. Keys are made in the app and shown once." />
    <p class="body" data-feature="F-API">A key carries only the scopes you ticked when you made it, and it can only carry scopes its creator holds. A request without the scope gets the same <code>401</code> as a wrong key, on purpose: nothing tells a guesser which half was right.</p>
    <p class="body" data-feature="F-EMBED">No response contains a signing link or an access code, and a key cannot sign for anyone. The one exception is embedded signing, where a key you marked for it can ask for a one-hour session.</p>
    <p class="more2"><a class="d-btn alt sm" href="/developers/keys-and-security">Keys and security</a><a class="d-btn alt sm" href="/docs/authentication">All the scopes</a></p></div>
  <div class="sp-r" data-reveal {@attach reveal}>
    <div class="tbl"><table><thead><tr><th scope="col">Scope</th><th scope="col">What it lets the key do</th></tr></thead><tbody>{#each scopesNow as [s, d]}<tr><th scope="row"><code>{s}</code></th><td>{d}</td></tr>{/each}</tbody></table><p class="tnote">Six of the 12 scopes. The authentication page lists all of them.</p></div>
  </div>
</section>

<!-- 6 · WEBHOOKS -->
<section class="sec" aria-labelledby="s-wh">
  <SectionHeading id="s-wh" align="center" eyebrow="WEBHOOKS" title="Events you can *verify*." lead="Register an endpoint, choose the events, and Docustay posts a JSON event to it each time one happens." />
  <div class="two-code" data-reveal {@attach reveal}>
    <CodeWindow tabs={[{ label: "Node", code: VERIFY_NODE }, { label: "Python", code: VERIFY_PY }]} title="receive-the-webhook" page="dev-webhook" label="Webhook language" />
    <div class="stack">
      <EventTimeline title="Event order" note="sample data" rows={[{ s: "documents.document.sent", t: "10:02" }, { s: "documents.document.opened", t: "10:07" }, { s: "documents.document.signed", t: "10:09" }, { s: "documents.document.executed", t: "10:09", tone: "ok" }]} hook="webhook-id · webhook-timestamp · webhook-signature" />
    </div>
  </div>
  <ul class="facts4">
    <li data-reveal {@attach reveal}><h3 class="d-h3">Signed.</h3><p data-feature="F-WEBHOOKS">Each delivery carries the Standard Webhooks headers, and the signature is an HMAC-SHA256 over the id, the timestamp and the raw body.</p></li>
    <li data-reveal {@attach reveal}><h3 class="d-h3">Retried.</h3><p data-feature="F-WEBHOOKS">A failed delivery is tried again after 1 minute, 5 minutes, 30 minutes, 2 hours and 12 hours, which is six attempts in all.</p></li>
    <li data-reveal {@attach reveal}><h3 class="d-h3">Replayable.</h3><p data-feature="F-WEBHOOKS">Every attempt is in the delivery log, where a delivery can be sent again without making another document.</p></li>
    <li data-reveal {@attach reveal}><h3 class="d-h3">Safe to repeat.</h3><p data-feature="F-WEBHOOKS">Repeats carry the same <code>webhook-id</code>, so a receiver that remembers the ids it has handled can ignore the rest.</p></li>
  </ul>
  <p class="more"><a class="d-btn alt sm" href="/developers/webhooks">Webhook guide</a></p>
</section>

<!-- 7 · TEST MODE -->
<section class="band" aria-labelledby="s-test">
  
  <div class="band-in">
    <SectionHeading id="s-test" align="center" eyebrow="TEST MODE" title="Build the whole flow before a *real* person gets an email." lead="Test mode is on every plan, including Free, and it is chosen by the key you hold." />
    <div class="three">
      <article class="card3" data-reveal {@attach reveal}><h3 class="d-h3">Nothing reaches a stranger.</h3><p data-feature="F-TESTMODE">Everything a test key sends is emailed only to you. The page carries a TEST stamp, and the sealed PDF carries a watermark.</p></article>
      <article class="card3" data-reveal {@attach reveal}><h3 class="d-h3">Nothing counts.</h3><p data-feature="F-TESTMODE">Test documents never count toward your {p.free.docsPerMonth} documents a month, so you can run the flow as often as you like.</p></article>
      <article class="card3" data-reveal {@attach reveal}><h3 class="d-h3">Sign one yourself.</h3><p data-feature="F-TESTMODE">One call signs a test document so you can see the executed event and the sealed copy without opening your inbox.</p></article>
    </div>
    <p class="more"><a class="d-btn alt sm" href="/developers/test-mode">Test mode in full</a></p>
  </div>
</section>

<!-- 8 · EMBED -->
<section class="sec split" aria-labelledby="s-embed">
  <div class="sp-l"><SectionHeading id="s-embed" eyebrow="EMBEDDED SIGNING" title="Put signing in your *own* page." lead="The signer never leaves your site, and your server hears about it the moment they finish." />
    <ol class="mini"><li><b>List your website</b> under Developers, then Embedding.</li><li><b>Send with embedded seats</b> by adding <code>embedded: ["signer_1"]</code>. Nobody is emailed for those seats.</li><li><b>Ask for a session</b> with <code>POST /api/v1/documents/{"{id}"}/embed-session</code>. The link works for one hour.</li><li><b>Show it</b> with the <code>&lt;docustay-sign&gt;</code> element and listen for <code>completed</code>.</li></ol>
    <p class="more2"><a class="d-btn alt sm" href="/developers/embedding">Embedding guide</a></p></div>
  <div class="sp-r" data-reveal {@attach reveal}>
    <CodeWindow tabs={[{ label: "HTML", code: "<script type=\"module\" src=\"https://docustay.app/embed/index.js\"></script>\n<docustay-sign url=\"SESSION_URL\" height=\"720\"></docustay-sign>" }, { label: "React", code: "import { DocustaySign } from \"@docustay2026/react\";\n\n<DocustaySign url={session.url} onCompleted={({ documentId }) => confirmOnServer(documentId)} />" }]} title="show-the-signer" page="dev-embed" label="Embed language" />
  </div>
</section>

<!-- 9 · OPENAPI -->
<section class="sec" aria-labelledby="s-spec">
  <SectionHeading id="s-spec" align="center" eyebrow="THE OPENAPI FILE" title="One file. The reference and the clients come *from* it." lead="Read it, import it, or generate a client in a language we do not ship." />
  <ul class="facts4">
    <li data-reveal {@attach reveal}><h3 class="d-h3">{facts.operations} operations</h3><p data-feature="F-API">Documents, templates, payments status, webhooks, plays and AI jobs, in one OpenAPI {facts.openapiVersion} file.</p></li>
    <li data-reveal {@attach reveal}><h3 class="d-h3">Postman collection</h3><p data-feature="F-API">Import the collection to try every call with your test key.</p></li>
    <li data-reveal {@attach reveal}><h3 class="d-h3">Generated reference</h3><p data-feature="F-API">Every operation has its own page with the request, the answer and examples.</p></li>
    <li data-reveal {@attach reveal}><h3 class="d-h3">Versioned</h3><p data-feature="F-API">The file says its version, and the changelog says what changed in it.</p></li>
  </ul>
  <p class="more"><a class="d-btn alt sm" href="/openapi.json">Download openapi.json</a><a class="d-btn alt sm" href="/docs/api-reference">Read the reference</a></p>
</section>

<!-- 10 · LIMITS AND ERRORS -->
<section class="sec" aria-labelledby="s-lim">
  <SectionHeading id="s-lim" align="center" eyebrow="LIMITS, ERRORS AND IDEMPOTENCY" title="Retries are *safe*, limits are plain." lead="What happens when a request is too fast, too big or sent twice." />
  <div class="tbl wide" data-reveal {@attach reveal}><table><thead><tr><th scope="col">Status</th><th scope="col">Usually means</th></tr></thead><tbody>
    <tr><th scope="row">400</th><td>A field is not valid. The message says which one and why.</td></tr><tr><th scope="row">401</th><td>The key is missing, wrong, revoked or lacks the scope. It is one answer for all four.</td></tr><tr><th scope="row">403</th><td>The workspace's plan or a setting does not allow this.</td></tr><tr><th scope="row">409</th><td>The request is fine but the state is wrong, for example voiding a finished document.</td></tr><tr><th scope="row">429</th><td>Over {LIMITS.apiRequestsPerMinute} requests a minute. Wait the number of seconds in <code>Retry-After</code>.</td></tr><tr><th scope="row">5xx</th><td>Our side. Safe to retry with the same <code>Idempotency-Key</code>.</td></tr></tbody></table></div>
  <p class="body c" data-feature="F-API">Every error is an object with a kind, a message, a requestId and a retryable flag. Upload size is {LIMITS.freeUploadMb} MB on Free and {LIMITS.proUploadMb} MB on Pro, and email is {LIMITS.freeEmailsPerDay} a day on Free and {LIMITS.proEmailsPerDay} on Pro.</p>
</section>

<!-- 11 · AGENTS -->
<section class="band" aria-labelledby="s-agents">
  
  <div class="band-in">
    <SectionHeading id="s-agents" align="center" eyebrow="AGENTS" title="Draft, never *send*, unless you say so." lead="The MCP server and the Claude plugin are built so a person stays in charge." />
    <div class="three">
      <article class="card3" data-reveal {@attach reveal}><h3 class="d-h3">Preview, then confirm.</h3><p data-feature="F-MCP">A send shows what would happen first and acts only on a second call that says <code>confirm: true</code>.</p></article>
      <article class="card3" data-reveal {@attach reveal}><h3 class="d-h3">Read-only switch.</h3><p data-feature="F-MCP">Set <code>DOCUSTAY_READ_ONLY=1</code> and every tool that changes anything is removed from the list.</p></article>
      <article class="card3" data-reveal {@attach reveal}><h3 class="d-h3">A key that cannot send.</h3><p data-feature="F-DRAFTKEYS">A key with only <code>drafts:write</code> can make drafts, and nothing in it sends a document.</p></article>
    </div>
    <p class="more"><a class="d-btn alt sm" href="/developers/agents">Agents and MCP</a><a class="d-btn alt sm" href="/docs/mcp-and-skills">Skills and plugin</a></p>
  </div>
</section>

<!-- 12 · SELF-HOST AND AGPL-3.0 -->
<section class="sec split" aria-labelledby="s-host">
  <div class="sp-l"><SectionHeading id="s-host" eyebrow="SELF-HOST · OPEN SOURCE · AGPL-3.0" title="Read it, then run it *yourself*." lead="The same code that runs the hosted service runs on a machine you control." />
    <p class="body" data-feature="F-LICENCE">The server, the app and the signing page are released under the AGPL-3.0, and the clients are MIT. A commercial licence is there if you want to ship it inside a product that cannot be AGPL.</p>
    <p class="body" data-feature="F-SELFHOST">The Community edition is free. Self-host Pro is {dollars(SELFHOST_PRO_YEARLY_MINOR)} a year for each install, for your own business.</p>
    <p class="more2"><a class="d-btn alt sm" href="/self-host">Self-host guide</a><a class="d-btn alt sm" href="/open-source">Open source (AGPL-3.0)</a><a class="d-btn alt sm" href="/licensing">Which licence?</a></p></div>
  <div class="sp-r" data-reveal {@attach reveal}><Terminal title="your-server" lines={[{ t: "cmd", s: "./init.sh" }, { t: "cmd", s: "docker compose up -d" }, { t: "cmd", s: "open http://localhost:8080/setup" }]} /></div>
</section>

<!-- 13 · CHANGELOG -->
<section class="sec" aria-labelledby="s-log">
  <SectionHeading id="s-log" align="center" eyebrow="WHAT CHANGED LATELY" title="The *latest* from the changelog." lead="Written from the work itself, newest first." />
  <ul class="three logs">{#each CHANGES.slice(0, 3) as c}<li class="card3" data-reveal {@attach reveal}><p class="when">{c.date}</p><h3 class="d-h3">{c.title}</h3><p>{c.items[0]}</p></li>{/each}</ul>
  <p class="more"><a class="d-btn alt sm" href="/changelog">The whole changelog</a></p>
</section>

<!-- 14 · FAQ -->
<section class="sec" aria-labelledby="s-faq">
  <SectionHeading id="s-faq" align="center" eyebrow="QUESTIONS" title="Quick *answers*." lead="What developers ask before they try it." />
  <div class="faq"><Faq items={faq} id="dev-faq" /></div>
</section>

<!-- 15 · CLOSING -->
<section class="close" aria-labelledby="s-close">
  
  <div class="close-in"><h2 id="s-close">Make a key. <em>Send one.</em></h2><p>Start with a test key on the Free plan, or run your own copy in three commands.</p>
    <div class="d-actions c"><BorderBeam radius={999}><a class="d-btn main" href="/signup" data-umami-event="cta_click" data-umami-event-location="dev-closing" data-umami-event-target="signup">Create an API key</a></BorderBeam><a class="d-btn alt" href="/docs" data-umami-event="cta_click" data-umami-event-location="dev-closing" data-umami-event-target="docs">Read the docs</a></div></div>
</section>
</div>

<style>
  .hub { overflow-x: clip; } .hub p, .hub li, .hub code { overflow-wrap: anywhere; }
  .hub :global(.d-sub.c), .c { text-align: center; margin-left: auto; margin-right: auto; } .hub :global(.d-actions.c) { justify-content: center; }
  .sec { position: relative; max-width: 1180px; margin: 0 auto; padding: 76px var(--gutter) 0; } .sec > :global(.sh) { margin-bottom: 34px; }
  .hero { position: relative; padding: 150px var(--gutter) 40px; text-align: center; overflow: hidden; } .hero-in { position: relative; z-index: 1; display: flex; flex-direction: column; align-items: center; }
  .hero :global(h1.d-h1) { max-width: 1000px; margin: 26px auto 0; font-size: clamp(3rem, 7vw, 5.5rem); } .hero :global(.d-sub) { max-width: 660px; }
  .hero-code { position: relative; z-index: 1; max-width: 760px; margin: 48px auto 0; text-align: left; }
  .steps3 { list-style: none; margin: 0 0 32px; padding: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; } .steps3 li { padding: 26px; border-radius: 20px; border: 1px solid var(--ln-2); background: #ffffff; display: grid; gap: 10px; align-content: start; } .steps3 b { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 50%; border: 1px solid var(--ln-v); font: 500 15px var(--f-mono); color: var(--v-300); background: rgb(90 58 193 / 0.05); } .steps3 p, .card3 p, .wcard p, .cl p, .facts4 p { margin: 0; color: var(--tx-2); font-size: 15.5px; line-height: 1.6; }
  code { font: 13.5px var(--f-mono); color: var(--v-300); background: rgb(90 58 193 / 0.05); padding: 1px 6px; border-radius: 6px; }
  .two-code { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; align-items: start; } .two-code > :global(*) { min-width: 0; } .stack { display: grid; gap: 18px; }
  .more { margin: 36px 0 0; display: flex; gap: 14px; flex-wrap: wrap; justify-content: center; } .more2 { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 26px; }
  .why { max-width: none; } .why-in { position: relative; z-index: 1; max-width: 1180px; margin: 0 auto; }
  .wgrid { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; } .wcard { padding: 26px; border-radius: 20px; border: 1px solid var(--ln-2); background: #ffffff; box-shadow: inset 0 1px 0 rgb(255 255 255 / .07); display: flex; flex-direction: column; gap: 12px; }
  .cl { list-style: none; margin: 0 0 32px; padding: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; } .cl li { display: grid; grid-template-columns: 44px 1fr; gap: 16px; padding: 20px 22px; border-radius: 18px; border: 1px solid var(--ln-2); background: #ffffff; align-items: start; }
  .split { display: grid; grid-template-columns: minmax(0, .9fr) minmax(0, 1.1fr); gap: 56px; align-items: center; } .split > :global(*) { min-width: 0; } .sp-l :global(.sh) { margin-bottom: 26px; } .body { color: var(--tx-2); line-height: 1.65; font-size: 16.5px; margin: 14px 0 0; max-width: 560px; }
  .tbl { border-radius: 20px; border: 1px solid var(--ln-2); background: #ffffff; overflow: hidden; } .tbl.wide { max-width: 900px; margin: 0 auto; } .tbl table { width: 100%; border-collapse: collapse; font-size: 15px; } .tbl th, .tbl td { text-align: left; padding: 13px 18px; border-top: 1px solid var(--ln-1); vertical-align: top; } .tbl thead th { border-top: 0; color: var(--tx-3); font: 500 12px var(--f-mono); letter-spacing: .08em; text-transform: uppercase; } .tbl tbody th { font-weight: 400; white-space: nowrap; } .tbl td { color: var(--tx-2); line-height: 1.5; } .tnote { margin: 0; padding: 12px 18px; color: var(--tx-3); font-size: 14px; border-top: 1px solid var(--ln-1); }
  .facts4 { list-style: none; margin: 32px 0 0; padding: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; } .facts4 li { padding: 22px; border-radius: 18px; border: 1px solid var(--ln-2); background: #ffffff; display: grid; gap: 8px; align-content: start; }
  .band { position: relative; margin-top: 88px; padding: 90px var(--gutter); overflow: hidden; background: linear-gradient(180deg, #ffffff, #ffffff 50%, #ffffff); border-block: 1px solid var(--ln-v); } .band-in { position: relative; z-index: 1; max-width: 1080px; margin: 0 auto; } .band :global(.sh) { margin-bottom: 44px; }
  .three { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; list-style: none; margin: 0; padding: 0; } .card3 { padding: 26px; border-radius: 20px; border: 1px solid var(--ln-2); background: #ffffff; display: flex; flex-direction: column; gap: 12px; align-items: flex-start; } .when { font: 12.5px var(--f-mono); color: var(--tx-3); letter-spacing: .06em; text-transform: uppercase; }
  .mini { margin: 0; padding: 0 0 0 20px; display: grid; gap: 12px; color: var(--tx-2); line-height: 1.6; font-size: 16px; } .mini b { color: var(--tx-1); font-weight: 500; }
  .faq { max-width: 860px; margin: 0 auto; }
  .close { position: relative; margin-top: 88px; padding: 150px var(--gutter) 90px; text-align: center; overflow: hidden; } .close-in { position: relative; z-index: 1; } .close h2 { font: 400 clamp(3.2rem, 8.5vw, 6.2rem)/1 var(--f-display); letter-spacing: -.03em; margin: 0; background: var(--grad-title); -webkit-background-clip: text; background-clip: text; color: transparent; } .close h2 em { -webkit-text-fill-color: var(--v-400); } .close p { max-width: 600px; margin: 22px auto 0; font-size: 19px; line-height: 1.5; color: var(--tx-2); }
  @media (max-width: 1000px) { .wgrid, .steps3, .three { grid-template-columns: 1fr 1fr; } .facts4 { grid-template-columns: 1fr 1fr; } .two-code, .split { grid-template-columns: 1fr; } }
  @media (max-width: 700px) { .sec { padding-top: 72px; } .hero { padding-top: 112px; } .wgrid, .steps3, .three, .cl, .facts4 { grid-template-columns: 1fr; } .band { padding: 72px var(--gutter); margin-top: 72px; } .close { padding-top: 100px; margin-top: 72px; } .tbl { overflow-x: auto; } }
</style>
