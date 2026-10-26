<script>
  // THE HOME PAGE (BUILD-BLUEPRINT §5.1): 15 sections, every number from claims.json / facts.gen.json / plans.js, every code tab in the first HTML, every capability sentence carries its feature marker for the features gate.
  import DeskHead from "$lib/site/desk/DeskHead.svelte";
  import Faq from "$lib/site/desk/Faq.svelte";
  import Closing from "$lib/site/desk/Closing.svelte";
  import { feat } from "$lib/site/desk/feat.js";
  import { reveal } from "$lib/site/desk/reveal.js";
  import Backdrop from "$lib/site/ui/Backdrop.svelte";
  import Scene3D from "$lib/site/desk/Scene3D.svelte";
  import Visual from "$lib/site/visuals/Visual.svelte"; import Still from "$lib/site/visuals/Still.svelte";
  import CodeWindow from "$lib/site/ui/CodeWindow.svelte";
  import Terminal from "$lib/site/ui/Terminal.svelte";
  import EventTimeline from "$lib/site/ui/EventTimeline.svelte";
  import SectionHeading from "$lib/site/ui/SectionHeading.svelte";
  import Tile from "$lib/site/ui/Tile.svelte";
  import Frame from "$lib/site/ui/Frame.svelte";
  import Callout from "$lib/site/ui/Callout.svelte";
  import BorderBeam from "$lib/site/ui/BorderBeam.svelte";
  import { SEND_TABS, SEND_RESPONSE, VERIFY_NODE, VERIFY_PY } from "$lib/site/home-code.js";
  import facts from "$lib/site/facts.gen.json";
  import starters from "$lib/site/starters.index.json";
  import { TEMPLATES } from "$lib/site/pages/templates.js";
  import { dollars, SELFHOST_PRO_YEARLY_MINOR, COMMERCIAL_FROM_MINOR, proShown, AI_CREDITS, LIMITS } from "$lib/site/plans.js";
  const cents = (m) => (m % 100 === 0 ? dollars(m) : `$${(m / 100).toFixed(2)}`);
  let { data } = $props();
  const p = $derived(data.plans), shown = $derived(proShown(p));
  let cur = $state(0);
  const T = (s) => feat(s);   // a capability sentence: text + its feature ids
  const icon = { code: "M9 7l-6 6 6 6M17 7l6 6-6 6M14.5 5l-3 16", shield: "M13 3l8 3v6c0 5-3.5 8.5-8 11-4.5-2.5-8-6-8-11V6l8-3zM9 13l3 3 5-6", server: "M5 4h16a2 2 0 012 2v3a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2zM5 15h16a2 2 0 012 2v3a2 2 0 01-2 2H5a2 2 0 01-2-2v-3a2 2 0 012-2z", file: "M6 3h9l5 5v15H6zM15 3v5h5M9 13h8M9 17h8", bolt: "M13 2L4 14h7l-1 8 9-12h-7z", cert: "M12 3l2.5 2 3.2-.3.9 3.1 2.8 1.6-1 3.1 1 3.1-2.8 1.6-.9 3.1-3.2-.3L12 22l-2.5-2-3.2.3-.9-3.1L2.6 15.6l1-3.1-1-3.1 2.8-1.6.9-3.1 3.2.3zM9 12l2 2 4-4", card: "M3 6h18v12H3zM3 10h18M7 15h4", agent: "M12 3v3M5 9h14v9H5zM9 13h.01M15 13h.01M9 21v-3M15 21v-3", flat: "M12 3v18M7 7h7a3 3 0 010 6H9a3 3 0 000 6h8", book: "M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2zM4 19V5M9 8h6", plug: "M9 3v5M15 3v5M6 8h12v4a6 6 0 01-12 0zM12 18v3", pen: "M5 21l3-1 12-12-2-2L6 18l-1 3zM15 7l2 2", term: "M4 5h16v14H4zM8 10l3 2-3 2M13 15h4" };
  // the nine why-cards (board 3). Each claim has its proof; a number comes from facts.gen.json, claims.json or plans.js, never from here.
  const WHY = $derived([
    { k: "A2", i: "book", h: "You can read it.", p: "The whole product is open source under the AGPL-3.0: the server, the app and the signing page.", proof: "The licence file sits at the root of the repository.", f: "F-LICENCE" },
    { k: "A5", i: "server", h: "You can run it.", p: "Three commands start your own copy, and your documents stay on your server.", proof: "The compose file and the setup script ship in the repository.", f: "F-SELFHOST" },
    { k: "A3", i: "shield", h: "Safe to build against.", p: "A test key signs watermarked documents and emails only you. Test documents never count toward a limit.", proof: "Test mode is on every plan, including Free.", f: "F-TESTMODE" },
    { k: "A1", i: "code", h: "Written down, not promised.", p: `One OpenAPI 3.1 file with ${facts.operations} operations. The reference and the clients are generated from it.`, proof: "Download it at /openapi.json.", f: "F-API" },
    { k: "A3", i: "agent", h: "Made for agents.", p: `An MCP server with ${facts.mcpTools} tools and a Claude plugin. A draft-only key can prepare documents but cannot send them.`, proof: "The MCP server shows a preview first and acts only on a second, confirmed call.", f: "F-MCP" },
    { k: "A2", i: "pen", h: "AI that stays in its lane.", p: "Scribe drafts from plain words and checks a document before it goes. A person approves every send.", proof: `${AI_CREDITS.free} AI drafts a month on Free, ${AI_CREDITS.pro} on Pro.`, f: "F-SCRIBE" },
    { k: "A6", i: "card", h: "Money inside signing.", p: "The signer can pay as part of signing, into your own Stripe account.", proof: `The fee is ${p.free.feeBps / 100}% on Free and Pay as you go and ${p.pro.feeBps / 100}% on Pro, on top of Stripe's own.`, f: "F-PAYMENTS" },
    { k: "A2", i: "cert", h: "Proof you can check without us.", p: "Every signed PDF carries a certificate of completion with a hash, and anyone can check it on the verify page.", proof: "No account is needed to verify a PDF.", f: "F-VERIFY" },
    { k: "A4", i: "flat", h: "Pay for what you use.", p: `Free is ${p.free.docsPerMonth} documents a month. Pay as you go is ${dollars(p.payg.personMonthlyMinor)} a person. Pro is ${dollars(p.pro.monthlyMinor)} for the whole workspace.`, proof: "Every number on this page is bound to the code that enforces it.", f: "F-PRO" },
  ]);
  const compare = $derived([
    ["Documents a month", `${p.free.docsPerMonth}`, `${p.payg.docsIncluded} free, then ${cents(p.payg.docOverMinor)} each`, "Unlimited"],
    ["AI drafts a month", `${p.free.draftsPerMonth}`, `${p.payg.draftsIncluded} free, then ${cents(p.payg.draftOverMinor)} each`, `${p.pro.draftsIncluded}, then ${cents(p.pro.draftOverMinor)} each`],
    ["Team members who can send", "One, the owner", `${dollars(p.payg.personMonthlyMinor)} per team member a month`, "Everyone, at no extra charge"],
    ["API, webhooks and test mode", "Included", "Included", "Included"], ["Reminders and send to a list", "Included", "Included", "Included"], ["Emails a day", `${LIMITS.freeEmailsPerDay}`, `${LIMITS.freeEmailsPerDay}`, `${LIMITS.proEmailsPerDay}`], ["Upload size", `${LIMITS.freeUploadMb} MB`, `${LIMITS.freeUploadMb} MB`, `${LIMITS.proUploadMb} MB`],
    ["Fee on payments taken while signing", `${p.free.feeBps / 100}%`, `${p.payg.feeBps / 100}%`, `${p.pro.feeBps / 100}%`],
  ]);
  const FEATURES = [
    { h: "How it works", v: "track-steps", href: "/features/how-it-works", p: "Create, send, sign, get paid and prove, in one flow that works the same in the app and from your API.", ids: "F-SEND", link: "See the whole flow" },
    { h: "Scribe", v: "sentence-page", href: "/features/scribe", p: "Describe a document in plain words. Scribe asks a few questions, builds it with every field placed, and a person sends it.", ids: "F-SCRIBE", link: "Meet Scribe" },
    { h: "Payments", v: "payment-card", href: "/features/payments", p: "The signer pays as part of signing, into your own Stripe account. Docustay never holds the money.", ids: "F-PAYMENTS", link: "How payments work" },
    { h: "Proof and verify", v: "exploded", href: "/features/proof", p: "Every sealed PDF carries a certificate of completion and a hash, and anyone can check a copy without an account.", ids: "F-VERIFY", link: "What a sealed copy carries" },
    { h: "Built into your product", v: "browser-embed", href: "/features/embedded-signing", p: "Embed the signer, test with a full sandbox, hand work to an agent and put your logo and colour on it.", ids: "F-EMBED", link: "Embedded signing" },
  ];
  const pageFor = (slug) => { const t = TEMPLATES.find((m) => m.old === slug); return t ? `/templates/${t.slug}` : "/free-templates"; };   // starters without their own page go to the template hub
  const marquee = starters.slice(0, 10).map((x) => [x.title, pageFor(x.slug)]);
  const chips = [["Contracts", "/use-cases/contracts"], ["NDAs", "/use-cases/ndas"], ["HR and onboarding", "/use-cases/hr-and-onboarding"], ["Leases and rentals", "/use-cases/real-estate"], ["Waivers and consent", "/use-cases/waivers-and-consent"]];
  const uses = [["Property managers", "Lease addenda, rental applications and move-in checklists."], ["Hiring and onboarding", "Offer letters, new-hire paperwork and policy acknowledgements."], ["Contractors and agencies", "Statements of work, change orders and mutual NDAs."], ["Events and waivers", "Liability waivers, photo releases and registration paperwork."], ["Schools and clubs", "Permission slips, volunteer agreements and membership applications."], ["Sales and agreements", "Service agreements, order forms and deposit agreements."]];
  const faq = $derived([
    ["What is Docustay?", "Docustay is an AGPL-3.0 open-source e-signature API and app that you can self-host: send documents from your code, get them signed on any device, and keep a sealed PDF with a certificate of completion. {{F-SEND}}"],
    ["Is it really open source?", "Yes. The server, the app and the signing page are released under the AGPL-3.0, and the clients are MIT. A commercial licence is there if you want to ship it inside a product that cannot be AGPL. {{F-LICENCE}}"],
    ["Can I self-host it for free?", `Yes. The Community edition is free under the AGPL-3.0. Self-host Pro is ${dollars(SELFHOST_PRO_YEARLY_MINOR)} a year for each install, for your own business. {{F-SELFHOST}}`],
    ["How do I test without sending anything?", "Use a test key. Everything it sends is a practice run: emailed only to you, stamped TEST, and never counted toward a limit. You can also try the demo with no sign-up. {{F-TESTMODE}}"],
    ["Is there an API?", `Yes. One OpenAPI 3.1 file describes ${facts.operations} operations, with clients for JavaScript, TypeScript and Python, generated clients for Go, PHP and C#, a command line and an MCP server. {{F-API}}`],
    ["Do e-signatures hold up in law?", "Electronic signatures are recognised under laws such as the US ESIGN Act and UETA. Whether a particular document holds up depends on the document and the place, so this is not legal advice. Docustay keeps the audit trail and the certificate of completion. {{F-CERT}}"],
    ["What does it cost?", `Free is ${p.free.docsPerMonth} documents a month. Pay as you go is ${dollars(p.payg.personMonthlyMinor)} per team member a month plus ${cents(p.payg.docOverMinor)} for each document past ${p.payg.docsIncluded}, with a monthly budget so the bill never surprises you. Pro is ${dollars(shown.monthlyMinor)} a month for the whole workspace. Payments taken while signing carry a ${p.free.feeBps / 100}% fee on Free and Pay as you go and ${p.pro.feeBps / 100}% on Pro, on top of Stripe's. {{F-PRO}}`],
    ["Does AI send documents on its own?", "No. Scribe drafts and checks, and a person approves each send. A draft-only API key can make drafts but cannot send. {{F-DRAFTKEYS}}"],
    ["Can I use it for health data?", "Docustay is not for protected health information yet."],
  ]);
  const ld = $derived(JSON.stringify([
    { "@context": "https://schema.org", "@type": "Organization", name: "Docustay", url: "https://docustay.app", logo: "https://docustay.app/brand/docustay-wordmark-violet.svg", description: `${facts.tagline.headline} ${facts.tagline.support}` },
    { "@context": "https://schema.org", "@type": "WebSite", name: "Docustay", url: "https://docustay.app" },
    { "@context": "https://schema.org", "@type": "VideoObject", name: "Try Docustay: a tour of the demo workspace", description: "A 90-second tour: open the demo workspace, follow a document, sign it on a phone-sized page and ask Scribe for a draft. Nothing is emailed in the demo.", thumbnailUrl: "https://docustay.app/media/launch.poster.jpg", uploadDate: "2026-10-13", duration: "PT1M28S", contentUrl: "https://docustay.app/media/launch.mp4" },
  ]));
</script>
<DeskHead title={facts.tagline.siteTitle} description={facts.tagline.about} />
<svelte:head>{@html `<script type="application/ld+json">${ld}</script>`}</svelte:head>

<!-- claim-until-proven: F-MCP, F-DRAFTKEYS and F-SCRIBE stay marked PENDING PROOF until they are driven in the sandbox, as the features list says -->
<div class="home" data-req="code,why-grid,faq,table">

<!-- 1 · FIRST SCREEN -->
<section class="hero" aria-labelledby="h1">
  <Backdrop kind="C1" />
  <div class="hero-d" aria-hidden="true"><Scene3D kind="hero" soft /></div>
  <div class="hero-in">
    <span class="d-chip">FREE TO START · OPEN SOURCE (AGPL-3.0) · SELF-HOST IF YOU LIKE</span>
    <h1 id="h1" class="d-h1">{facts.tagline.headline}</h1>
    <p class="d-sub c">{facts.tagline.support}</p>
    <div class="d-actions c"><a class="d-btn main" href="/demo" data-umami-event="cta_click" data-umami-event-location="hero" data-umami-event-target="demo">Try the demo</a><a class="d-btn alt" href="/signup" data-umami-event="cta_click" data-umami-event-location="hero" data-umami-event-target="signup">Start free</a></div>
    <p class="d-fine">No sign-up for the demo. Nothing is ever sent.</p>
  </div>
  <div class="stage">
    <Frame src="/proof/document.webp" alt="A document page showing who has been sent the lease and who has signed" width={1600} height={740} title="Lease addendum" class="st-code" />
    <EventTimeline class="st-tl" rows={[{ s: "Sent to jordan@example.com", t: "10:02" }, { s: "Opened on iPhone", t: "10:07" }, { s: "Signed", t: "10:09" }, { s: "Sealed, certificate added", t: "10:09", tone: "ok" }]} hook="webhook documents.document.executed → 200 OK" />
  </div>
  <ul class="proof" aria-label="At a glance"><li>{p.free.docsPerMonth} documents a month free</li><li>No account for the signer</li><li>{facts.operations} API operations</li><li>Self-host in three commands</li></ul>
</section>

<!-- 1b · TWO PATHS (V1 decision 49: the page welcomes everyone) -->
<section class="sec paths" aria-labelledby="s-paths">
  <SectionHeading id="s-paths" align="center" eyebrow="START HERE" title="Two ways in, *one* product." lead="Use it by clicking, or build it into your own software. It is the same documents and the same proof either way." />
  <div class="two">
    <article class="card3 path" data-reveal {@attach reveal}><h3 class="d-h3">For teams and people</h3>
      <p data-feature="F-SEND F-FREEPLAN">Send it, sign it, keep the proof. Pick a template or describe one, say who signs and press send. The people you send to sign on any device with no account.</p>
      <ul class="ticks"><li>{p.free.docsPerMonth} documents a month free, no card</li><li>More than 50 templates, and Scribe writes the rest</li><li>Payments inside the signature, into your Stripe</li></ul>
      <div class="d-actions"><a class="d-btn main" href="/demo" data-umami-event="cta_click" data-umami-event-location="paths" data-umami-event-target="demo">Try the demo</a><a class="d-btn alt" href="/signup" data-umami-event="cta_click" data-umami-event-location="paths" data-umami-event-target="signup">Start free</a></div></article>
    <article class="card3 path" data-reveal {@attach reveal}><h3 class="d-h3">For developers</h3>
      <p data-feature="F-API">One REST API, six clients, signed webhooks, a command line and an MCP server. Start with a test key that emails only you.</p>
      <div class="pcode"><CodeWindow tabs={SEND_TABS} bind:cur title="send-a-document" page="home-paths" label="Developer language" /></div>
      <div class="d-actions"><a class="d-btn main" href="/docs" data-umami-event="cta_click" data-umami-event-location="paths" data-umami-event-target="docs">Read the docs</a><a class="d-btn alt" href="/signup" data-umami-event="cta_click" data-umami-event-location="paths" data-umami-event-target="apikey">Get an API key</a></div></article>
  </div>
</section>

<!-- 1c · HOW IT WORKS, FOR EVERYONE -->
<section class="sec" aria-labelledby="s-how4">
  <SectionHeading id="s-how4" align="center" eyebrow="HOW IT WORKS" title="Four steps, from a file to a *sealed* copy." lead="The same four steps in the app, from your code and through an assistant." />
  <ol class="how4">
    <li data-reveal {@attach reveal}><b>1</b><h3 class="d-h3">Pick or write it.</h3><p data-feature="F-TEMPLATES F-SCRIBE">Start from a template, upload a PDF, or tell Scribe what you need.</p></li>
    <li data-reveal {@attach reveal}><b>2</b><h3 class="d-h3">Say who signs.</h3><p data-feature="F-SEND">Add names and emails, choose the order and press send. Nothing goes out until you do.</p></li>
    <li data-reveal {@attach reveal}><b>3</b><h3 class="d-h3">They sign anywhere.</h3><p data-feature="F-SIGN">On any phone or computer, with no account, and with a payment on the same page if you ask for one.</p></li>
    <li data-reveal {@attach reveal}><b>4</b><h3 class="d-h3">Keep the proof.</h3><p data-feature="F-CERT">Everyone gets the sealed PDF and its certificate, and anyone can check a copy with no account.</p></li>
  </ol>
  <p class="more"><a class="d-btn alt sm" href="/features/how-it-works">See the whole flow</a></p>
</section>

<!-- 2 · INTEGRATE THIS AFTERNOON -->
<section class="sec" aria-labelledby="s-int">
  <SectionHeading id="s-int" align="center" eyebrow="THE QUICKSTART" title="Integrate this *afternoon*." lead="Make a test key, post a template and one signer, and listen for one webhook. Every language tab below is real code that was run against the API's own rules." />
  <div class="int">
    <ol class="steps" data-reveal {@attach reveal}>
      <li><b>1</b><div><h3 class="d-h3">Make a test key.</h3><p>In the app open Developers, then API keys, and tick <code>documents:read</code> and <code>documents:write</code>. A key that starts <code>dsk_test_</code> only does practice runs. {@html ""}</p></div></li>
      <li><b>2</b><div><h3 class="d-h3">Send a template.</h3><p>Post the template's id and who signs. The seat names come from the template, and a repeated request with the same <code>Idempotency-Key</code> never sends twice.</p></div></li>
      <li><b>3</b><div><h3 class="d-h3">Listen for the result.</h3><p>Register an endpoint and Docustay posts a signed JSON event each time something happens. Answer fast and fetch the sealed PDF when the document is executed.</p></div></li>
    </ol>
    <div class="int-code" data-reveal {@attach reveal}>
      <CodeWindow tabs={SEND_TABS} bind:cur title="send-a-document" response={SEND_RESPONSE} page="home-quickstart" label="Quickstart language" />
      <CodeWindow tabs={[{ label: "Node", code: VERIFY_NODE }, { label: "Python", code: VERIFY_PY }]} title="receive-the-webhook" page="home-webhook" label="Webhook language" />
    </div>
  </div>
  <p class="more"><a class="d-btn alt sm" href="/docs/quickstart">Read the quickstart</a><span>About ten minutes from a key to a signed document.</span></p>
</section>

<!-- 3 · WHY DEVELOPERS CHOOSE DOCUSTAY -->
<section class="sec why" aria-labelledby="s-why" data-why>
  <Backdrop kind="C6" bloom={false} grain={false} />
  <div class="why-in">
    <SectionHeading id="s-why" align="center" eyebrow="WHY DOCUSTAY" title="Why people choose *Docustay*." lead="Plenty of tools can sign a document. Here is what is different about this one, and the proof for each point." />
    <ul class="wgrid">
      {#each WHY as w}{@const c = T(w.p + " {{" + w.f + "}}")}
        <li class="wcard" data-reveal {@attach reveal}><Tile kind={w.k} size={64}><svg viewBox="0 0 26 26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d={icon[w.i]} /></svg></Tile>
          <h3 class="d-h3">{w.h}</h3><p data-feature={c.ids}>{c.text}</p><p class="pf"><b>Proof:</b> {w.proof}</p></li>
      {/each}
    </ul>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div class="cmp" tabindex="0" role="region" aria-label="Free, Pay as you go and Pro compared" data-reveal {@attach reveal}>
      <h3 class="d-h3">What you get, in plain words.</h3>
      <table><thead><tr><th scope="col"><span class="sr-only">What</span></th><th scope="col">Free</th><th scope="col">Pay as you go</th><th scope="col">Pro</th></tr></thead><tbody>{#each compare as [a, b, c, d]}<tr><th scope="row">{a}</th><td>{b}</td><td>{c}</td><td>{d}</td></tr>{/each}</tbody></table>
      <p class="note">Self-hosting is free under the AGPL-3.0. Self-host Pro is {dollars(SELFHOST_PRO_YEARLY_MINOR)} a year for each install, and a commercial licence starts from about {dollars(COMMERCIAL_FROM_MINOR)} a year.</p>
    </div>
  </div>
</section>

<!-- 4 · FOLLOW A DOCUMENT FROM SEND TO SEAL -->
<section class="sec split" aria-labelledby="s-follow">
  <div class="sp-l"><SectionHeading id="s-follow" eyebrow="FROM SEND TO SEAL" title="Follow a document from send to *seal*." lead="Every document has its own timeline, and every step is an event your code can hear." />
    <p class="body" data-feature="F-WEBHOOKS">Each event carries the topic and the document's id. The ones most receivers want are sent, opened, signed, executed, declined and expired. Executed means everyone has signed and the sealed copy exists.</p>
    <p class="body" data-feature="F-CERT">The sealed PDF ends with a certificate of completion that lists who signed and when, and carries a hash. Fetch it with one call, or check any signed PDF on the verify page.</p>
    <p class="more2"><a class="d-btn alt sm" href="/docs/webhooks">Webhook events</a><a class="d-btn alt sm" href="/verify">Verify a PDF</a></p></div>
  <div class="sp-r" data-reveal {@attach reveal}>
    <div class="still-tile slim" aria-hidden="true"><Still name="seal" max={250} /></div>
    <Terminal title="your laptop" lines={[{ t: "cmd", s: "npx docustay send --test TEMPLATE_ID --party 'signer_1=Pat Example <pat@example.com>'" }, { t: "ok", s: "✔ sent — document 11111111-2222-4333-8444-555555555555 (test), 1 email sent" }, { t: "cmd", s: "npx docustay listen --forward-to http://localhost:3000/webhooks" }]} />
  </div>
</section>

<!-- 5 · TEST MODE AND WEBHOOKS -->
<section class="sec" aria-labelledby="s-test">
  <SectionHeading id="s-test" align="center" eyebrow="TEST MODE AND WEBHOOKS" title="Safe to try. Safe to *trust*." lead="Build the whole flow before a real person ever gets an email." />
  <div class="two">
    <article class="card3" data-reveal {@attach reveal}><Tile kind="A3" size={56}><svg viewBox="0 0 26 26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d={icon.shield} /></svg></Tile><h3 class="d-h3">A test key never reaches a stranger.</h3>
      <p data-feature="F-TESTMODE">Everything a test key sends is emailed only to you and stamped TEST. Its documents carry a watermark and never count toward your monthly limit.</p><ul class="ticks"><li>Starts with <code>dsk_test_</code></li><li>Works in any workspace</li><li>Sign a test document yourself with one call</li></ul></article>
    <article class="card3" data-reveal {@attach reveal}><Tile kind="A1" size={56}><svg viewBox="0 0 26 26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d={icon.bolt} /></svg></Tile><h3 class="d-h3">Webhooks you can check.</h3>
      <p data-feature="F-WEBHOOKS">Deliveries use the Standard Webhooks headers and a signature over the raw body. A failed delivery is tried again up to six times, and every attempt is in a log where you can send it again.</p><ul class="ticks"><li>Retries after 1 minute, 5 minutes, 30 minutes, 2 hours and 12 hours</li><li>Replay any delivery from the log</li><li>A changed body, a wrong secret or an old timestamp is refused</li></ul></article>
  </div>
  <div class="log2">
  <div class="still-tile" aria-hidden="true"><Still name="envelope" max={420} /></div>
  <div class="log" data-reveal {@attach reveal}>
    <EventTimeline title="Delivery log" note="sample data" rows={[{ s: "Try 1 · 200 OK · 84 ms", t: "10:09:07", tone: "ok" }, { s: "documents.document.signed · 200 OK", t: "10:09:02", tone: "ok" }, { s: "documents.document.opened · 200 OK", t: "10:07:40", tone: "ok" }, { s: "documents.document.sent · 200 OK", t: "10:02:11", tone: "ok" }]} hook="webhook-id: msg_[ID] · signature v1 checked" />
  </div>
  </div>
</section>

<!-- 6 · EMBEDDED SIGNING -->
<section class="band" aria-labelledby="s-embed">
  <Backdrop kind="C4" />
  <div class="band-in">
    <SectionHeading id="s-embed" align="center" eyebrow="EMBEDDED SIGNING" title="Put signing inside your *own* product." lead="Your page, your brand. The signer never leaves your site, and you hear about it the moment they finish." />
    <div class="embed" data-reveal {@attach reveal}>
      <Frame src="/proof/sign.webp" alt="The Docustay signing page: a lease addendum with the fields highlighted and a bar to finish and sign" width={1600} height={740} title="your-product.example/tenants/sign" class="sign-fr" />
      <ol class="e3"><li><b>List your site</b><span>Add the website that may show the signer under Developers, then Embedding.</span></li><li><b>Ask for a session</b><span>One call returns a short-lived address for one seat.</span></li><li><b>Show it</b><span>Drop in the <code>&lt;docustay-sign&gt;</code> element and listen for the completed event.</span></li></ol>
    </div>
    <p class="more"><a class="d-btn alt sm" href="/developers/embedding">Embedding guide</a></p>
  </div>
</section>

<!-- 7 · EVERYTHING TO BUILD ON IT -->
<section class="sec" aria-labelledby="s-tools">
  <SectionHeading id="s-tools" align="center" eyebrow="BUILD ON IT" title="Everything to build on it, in *one* place." lead="Use whichever door fits your stack. They all call the same API." />
  <ul class="tgrid">
    <li data-reveal {@attach reveal}><Tile kind="A1" size={56}><svg viewBox="0 0 26 26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d={icon.book} /></svg></Tile><h3 class="d-h3">OpenAPI file</h3><p data-feature="F-API">{facts.operations} operations in one OpenAPI 3.1 file. The reference pages and every client are generated from it.</p><a href="/openapi.json">Download openapi.json</a></li>
    <li data-reveal {@attach reveal}><Tile kind="A1" size={56}><svg viewBox="0 0 26 26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d={icon.code} /></svg></Tile><h3 class="d-h3">Clients</h3><p data-feature="F-SDK">JavaScript, TypeScript and Python by hand. Go, PHP and C# generated from the same file. No dependencies in the hand-written ones.</p><a href="/developers/sdks">All the clients</a></li>
    <li data-reveal {@attach reveal}><Tile kind="A3" size={56}><svg viewBox="0 0 26 26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d={icon.term} /></svg></Tile><h3 class="d-h3">Command line</h3><p data-feature="F-CLI">Send a test document, forward real signed webhooks to your laptop and verify a signature without opening a port.</p><a href="/developers/cli">The CLI</a></li>
    <li data-reveal {@attach reveal}><Tile kind="A3" size={56}><svg viewBox="0 0 26 26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d={icon.agent} /></svg></Tile><h3 class="d-h3">MCP server</h3><p data-feature="F-MCP">{facts.mcpTools} tools for an AI assistant. A send shows a preview first and acts only when you confirm. A read-only switch removes every tool that changes anything.</p><a href="/developers/agents">AI agents and MCP</a></li>
    <li data-reveal {@attach reveal}><Tile kind="A3" size={56}><svg viewBox="0 0 26 26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d={icon.plug} /></svg></Tile><h3 class="d-h3">Claude plugin</h3><p data-feature="F-MCP">The plugin bundles the server and five skills: sending for signature, text tags, embedded signing, webhooks and agent safety.</p><a href="/docs/mcp-and-skills">Skills and plugin</a></li>
    <li data-reveal {@attach reveal}><Tile kind="A6" size={56}><svg viewBox="0 0 26 26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d={icon.file} /></svg></Tile><h3 class="d-h3">Text tags</h3><p data-feature="F-TEMPLATES">Write a template as HTML or a PDF with tags such as <code>{"{{"}Sign here;type=signature;role=Partner{"}}"}</code> and the fields place themselves.</p><a href="/docs/templates-and-text-tags">Templates and text tags</a></li>
  </ul>
</section>

<!-- 8 · RUN IT YOURSELF -->
<section class="sec split" aria-labelledby="s-host">
  <div class="sp-l"><SectionHeading id="s-host" eyebrow="SELF-HOST" title="Run it *yourself*." lead="The same code that runs the hosted service runs on a machine you control." />
    <ul class="lic"><li><b>Community</b><span>Free under the AGPL-3.0. Unlimited documents and templates, with no monthly limit.</span></li><li><b>Self-host Pro</b><span>{dollars(SELFHOST_PRO_YEARLY_MINOR)} a year for each install, for your own business. Unlocks the Pro features.</span></li><li><b>Commercial licence</b><span>From about {dollars(COMMERCIAL_FROM_MINOR)} a year, for embedding, white-label, resale or a private fork.</span></li></ul>
    <p class="body" data-feature="F-SELFHOST">A pulled image idles at about one gibibyte of memory in our measurement. Building the image yourself needs more than 3.8 GB, so use the published image or a bigger build machine.</p>
    <p class="more2"><a class="d-btn alt sm" href="/self-host">Self-host guide</a><a class="d-btn alt sm" href="/licensing">Which licence?</a></p></div>
  <div class="sp-r" data-reveal {@attach reveal}>
    <Terminal title="your-server" lines={[{ t: "cmd", s: "./init.sh" }, { t: "cmd", s: "docker compose up -d" }, { t: "cmd", s: "open http://localhost:8080/setup" }]} />
    <div class="cubecard" aria-hidden="true"><Still name="containers" max={230} /></div>
  </div>
</section>

<!-- 9 · FEATURES AT A GLANCE (V1: five live tiles) -->
<section class="sec" aria-labelledby="s-feat">
  <SectionHeading id="s-feat" align="center" eyebrow="FEATURES AT A GLANCE" title="Everything from file to *sealed* copy." lead="Five parts of the product, each with its own page. They work in the app and from your code." />
  <ul class="fgrid">
    {#each FEATURES as f}
      <li data-reveal {@attach reveal}><a href={f.href} data-umami-event="cta_click" data-umami-event-location="why" data-umami-event-target={f.href}><span class="ftile" aria-hidden="true"><span class="fv"><Visual id={f.v} area="home" /></span></span><h3 class="d-h3">{f.h}</h3><p data-feature={f.ids}>{f.p}</p><span class="lk">{f.link}</span></a></li>
    {/each}
  </ul>
  <div class="shots">
    <Frame src="/proof/scribe.webp" alt="The Docustay documents list with the Scribe assistant open on the right" width={1600} height={740} title="Documents · Scribe" caption="Scribe sits beside your documents and asks before it writes." tilt={4} />
    <Frame src="/proof/document.webp" alt="A document page showing who has been sent the lease and who has signed" width={1600} height={740} title="Lease addendum" caption="Who has it, who has signed, and when." tilt={-4} />
  </div>
  <div class="trio">
    <div data-reveal {@attach reveal}><h3 class="d-h3">A person approves every send.</h3><p data-feature="F-DRAFTKEYS">An assistant can draft from your templates and ask the questions it needs. It cannot send: you read the draft and press the button.</p></div>
    <div data-reveal {@attach reveal}><h3 class="d-h3">Payment is the last step.</h3><p data-feature="F-PAYLAST">A payment field collects money after the signer has agreed, through your own Stripe account. Docustay never holds the money.</p></div>
    <div data-reveal {@attach reveal}><h3 class="d-h3">Checked before it goes.</h3><p data-feature="F-SCRIBE">Scribe reads a document for missing fields, a signer with no email and terms that contradict each other, and tells you what it found.</p></div>
  </div>
</section>

<!-- 10 · TEMPLATES, FORMS -->
<section class="sec tpl" aria-labelledby="s-tpl">
  <Backdrop kind="C3" bloom={false} grain={false} />
  <div class="tpl-in">
    <SectionHeading id="s-tpl" align="center" eyebrow="TEMPLATES" title="More than 50 ready-made *templates*." lead="Pick one, change it if you like, and send. Every page of every template is real, and each shows its fields and who signs." />
    <div class="marq" aria-label="Some of the templates">
      <ul class="track">{#each [...marquee, ...marquee] as [n, h], i}<li aria-hidden={i >= marquee.length ? "true" : undefined}><a class="pc2" href={h} tabindex={i >= marquee.length ? -1 : undefined}><i></i><i></i><i style="width:60%"></i><b>{n}</b></a></li>{/each}</ul>
    </div>
    <div class="one">
      <article class="card3" data-reveal {@attach reveal}><h3 class="d-h3">Ready to send</h3><p data-feature="F-TEMPLATES">Contracts, NDAs, waivers, HR paperwork, leases, school paperwork and sign-ins, in plain words. Built-in templates are read-only, and you customise your own copy.</p><a href="/free-templates">Browse the templates</a></article>
    </div>
    <p class="body c" data-feature="F-REMIND">Reminders and sending to a list run for you on every plan, so a document that nobody opened gets a nudge without a task on your list.</p>
  </div>
</section>

<!-- 11 · WHAT IT COSTS -->
<section class="sec" aria-labelledby="s-cost">
  <SectionHeading id="s-cost" align="center" eyebrow="WHAT IT COSTS" title="Pay for what you *use*, or get everything." lead="Start free. Set a monthly budget and the bill never surprises you. The API is on every plan." />
  <dl class="nums">
    <div><dt>Free</dt><dd><b>{p.free.docsPerMonth}</b><span>documents a month to up to {p.free.signersPerMonth} different signers, with test mode, the API and webhooks</span></dd></div>
    <div><dt>Pay as you go</dt><dd><b>{dollars(p.payg.personMonthlyMinor)}</b><span>per team member a month, then {cents(p.payg.docOverMinor)} for each document past {p.payg.docsIncluded}</span></dd></div>
    <div><dt>Pro</dt><dd><b>{dollars(shown.monthlyMinor)}</b><span>a month for the whole workspace</span></dd></div>
    <div><dt>Lifetime</dt><dd><b>{dollars(p.lifetime.oneTimeMinor)}</b><span>once, for any workspace</span></dd></div>
  </dl>
  <p class="body c" data-feature="F-FEE F-PAYG">Payments taken while signing carry a {p.free.feeBps / 100}% fee on Free and Pay as you go and {p.pro.feeBps / 100}% on Pro and Lifetime, on top of Stripe's own fees. Self-host Pro is {dollars(SELFHOST_PRO_YEARLY_MINOR)} a year for each install, and the Community edition is free.</p>
  <p class="more"><BorderBeam radius={999}><a class="d-btn alt" href="/pricing" data-umami-event="plan_cta" data-umami-event-plan="pro" data-umami-event-page="home">See pricing</a></BorderBeam></p>
</section>

<!-- 12 · NOT WRITING CODE? START FROM A TEMPLATE (V2 board 31) -->
<section class="paper" aria-labelledby="s-nocode">
  <div class="paper-in">
    <p class="eb">NOT WRITING CODE?</p>
    <h2 id="s-nocode">Start from a <em>template</em>.</h2>
    <p class="lead">Pick a template, say who signs, and send. The people you send to sign on any device with no account, and you both keep the sealed copy.</p>
    <ul class="pchips">{#each chips as [h, l]}<li><a href={l} data-umami-event="cta_click" data-umami-event-location="why" data-umami-event-target={l}>{h}</a></li>{/each}</ul>
    <ul class="uses">{#each uses as [h, t]}<li><b>{h}</b><span>{t}</span></li>{/each}</ul>
    <div class="pact"><a class="pbtn" href="/free-templates" data-umami-event="cta_click" data-umami-event-location="why" data-umami-event-target="templates">Browse templates</a><a class="pbtn ghost" href="/demo" data-umami-event="cta_click" data-umami-event-location="why" data-umami-event-target="demo">Try the demo</a></div>
  </div>
</section>

<!-- 13 · QUESTIONS -->
<section class="sec" aria-labelledby="s-faq">
  <SectionHeading id="s-faq" align="center" eyebrow="QUESTIONS" title="Quick *answers*." lead="The short version of what people ask before they try it." />
  <div class="faq"><Faq items={faq} id="home-faq" /></div>
</section>

<!-- the launch video: a real tour of the demo, with its words in the page -->
<section class="sec vid" aria-labelledby="s-video">
  <SectionHeading id="s-video" align="center" eyebrow="SEE IT" title="A ninety-second tour of the *demo*." lead="Recorded in the real demo workspace. Nothing is mocked up." />
  <div class="video" data-reveal {@attach reveal}>
    <!-- svelte-ignore a11y_media_has_caption -->
    <video controls preload="none" poster="/media/launch.poster.jpg" width="1920" height="1080" playsinline><source src="/media/launch.webm" type="video/webm" /><source src="/media/launch.mp4" type="video/mp4" />Your browser cannot play the video. The words are below.</video>
  </div>
  <details class="tr"><summary>Read what the video says</summary><p>Try Docustay. No account, no card. A real workspace, built for you in seconds. Maple Street Property Management has leases and applications already waiting. Every document shows where it stands. You can see who has seen it, who has signed, and a sealed copy when everyone has. Nothing is emailed in a demo: every message lands in the demo inbox. Open the signing page and sign as the tenant. This is what your signer sees, with no account, on any phone. Draw your signature with a finger or a mouse, agree, and finish. Ask Scribe for a document in plain words, and Scribe drafts it. You review and send. Like it? Keep your work with one email and a code. Free to start, and your workspace becomes yours.</p></details>
</section>

<!-- 14 · CLOSING LINE -->
<section class="close" aria-labelledby="s-close">
  <Backdrop kind="C1" />
  <div class="close-in"><h2 id="s-close">Documents, <em>signed.</em></h2><p>Try the demo with no sign-up, or run your own copy in three commands.</p>
    <div class="d-actions c"><BorderBeam radius={999}><a class="d-btn main" href="/demo" data-umami-event="cta_click" data-umami-event-location="closing" data-umami-event-target="demo">Try the demo</a></BorderBeam><a class="d-btn alt" href="/docs" data-umami-event="cta_click" data-umami-event-location="closing" data-umami-event-target="docs">Read the docs</a></div></div>
</section>
</div>

<style>
  .home { overflow-x: clip; } .home p, .home li, .home code { overflow-wrap: anywhere; } .steps li > div { min-width: 0; }
  .home :global(.d-sub.c), .c { text-align: center; margin-left: auto; margin-right: auto; } .home :global(.d-actions.c) { justify-content: center; }
  .sec { position: relative; max-width: 1180px; margin: 0 auto; padding: 88px var(--gutter) 0; } .sec > :global(.sh) { margin-bottom: 40px; }
  .hero-d { position: absolute; z-index: 1; right: max(28px, 4.5vw); top: 150px; width: 250px; } @media (max-width: 1180px) { .hero-d { display: none; } }
  .hero { position: relative; padding: 150px var(--gutter) 40px; text-align: center; overflow: hidden; } .hero-in { position: relative; z-index: 1; display: flex; flex-direction: column; align-items: center; }
  .hero :global(h1.d-h1) { max-width: 1120px; margin: 26px auto 0; font-size: clamp(3rem, 7.4vw, 5.75rem); } .hero :global(.d-sub) { max-width: 640px; }
  .stage { position: relative; z-index: 1; max-width: 1180px; height: 430px; margin: 46px auto 0; text-align: left; } .stage :global(.st-code) { position: absolute; left: 14px; top: 40px; width: 470px; } .stage :global(.st-tl) { position: absolute; right: 14px; top: 36px; width: 320px; transform: perspective(1400px) rotateY(-12deg) rotateX(3deg); }
  .proof { position: relative; z-index: 1; list-style: none; margin: 30px auto 0; padding: 0 28px; max-width: 980px; min-height: 46px; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 24px; border-radius: 999px; border: 1px solid var(--ln-1); background: rgb(255 255 255 / 0.85); font: 12.5px var(--f-mono); color: var(--tx-2); } .proof li { padding: 8px 0; }
  .int { display: grid; grid-template-columns: minmax(0, .8fr) minmax(0, 1.2fr); gap: 40px; align-items: start; } .steps { list-style: none; margin: 0; padding: 0; display: grid; gap: 30px; } .steps li { display: grid; grid-template-columns: 44px 1fr; gap: 16px; } .steps b { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 50%; border: 1px solid var(--ln-v); font: 500 15px var(--f-mono); color: var(--v-300); background: rgb(90 58 193 / 0.05); } .steps p { margin: 8px 0 0; color: var(--tx-2); line-height: 1.6; } .steps code, .ticks code, .e3 code { font: 13.5px var(--f-mono); color: var(--v-300); background: rgb(90 58 193 / 0.05); padding: 1px 6px; border-radius: 6px; }
  .int-code { display: grid; gap: 20px; min-width: 0; } .more { margin: 36px 0 0; display: flex; align-items: center; gap: 18px; flex-wrap: wrap; justify-content: center; } .more span { color: var(--tx-3); font-size: 15px; }
  .why { max-width: none; } .why-in { position: relative; z-index: 1; max-width: 1180px; margin: 0 auto; } .why > :global(.bd) { opacity: .9; }
  .wgrid { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; } .wcard { padding: 26px; border-radius: 20px; border: 1px solid var(--ln-2); background: #ffffff; box-shadow: inset 0 1px 0 rgb(255 255 255 / .07); display: flex; flex-direction: column; gap: 12px; } .wcard p { margin: 0; color: var(--tx-2); font-size: 15.5px; line-height: 1.6; } .wcard .pf { margin-top: auto; padding-top: 12px; border-top: 1px solid var(--ln-1); font-size: 14px; color: var(--tx-3); } .wcard .pf b { color: var(--v-300); font-weight: 500; }
  .cmp { margin-top: 64px; padding: 30px 34px; border-radius: 24px; border: 1px solid var(--ln-2); background: #ffffff; } .cmp table { width: 100%; border-collapse: collapse; margin-top: 18px; font-size: 15.5px; } .cmp th, .cmp td { text-align: left; padding: 13px 14px; border-top: 1px solid var(--ln-1); } .cmp thead th { color: var(--tx-3); font: 500 12px var(--f-mono); letter-spacing: .08em; text-transform: uppercase; border-top: 0; } .cmp tbody th { font-weight: 400; color: var(--tx-1); } .cmp td { color: var(--tx-2); } .cmp .note { margin: 18px 0 0; color: var(--tx-3); font-size: 14.5px; }
  .split { display: grid; grid-template-columns: minmax(0, .9fr) minmax(0, 1.1fr); gap: 56px; align-items: center; } .split > :global(*) { min-width: 0; } .sp-l :global(.sh) { margin-bottom: 26px; } .body { color: var(--tx-2); line-height: 1.65; font-size: 16.5px; margin: 14px 0 0; max-width: 560px; } .more2 { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 26px; } .sp-r { position: relative; }
  .one { display: grid; grid-template-columns: minmax(0, 1fr); } .path .pcode { width: 100%; min-width: 0; } .how4 { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 20px; } .how4 li { padding: 26px; border-radius: 22px; border: 1px solid var(--ln-2); background: #ffffff; display: flex; flex-direction: column; gap: 10px; } .how4 b { font: 600 13px var(--f-mono); color: var(--v-700); letter-spacing: .08em; } .how4 p { margin: 0; color: var(--tx-2); line-height: 1.6; }
  .two { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; } .card3 { padding: 30px; border-radius: 22px; border: 1px solid var(--ln-2); background: #ffffff; display: flex; flex-direction: column; gap: 14px; align-items: flex-start; } .card3 p { margin: 0; color: var(--tx-2); line-height: 1.65; } .card3 a { color: var(--v-300); text-underline-offset: 3px; } .ticks { margin: 0; padding: 0; list-style: none; display: grid; gap: 8px; color: var(--tx-2); font-size: 15px; } .ticks li { padding-left: 22px; position: relative; } .ticks li::before { content: ""; position: absolute; left: 2px; top: .6em; width: 9px; height: 5px; border-left: 2px solid var(--ok); border-bottom: 2px solid var(--ok); transform: rotate(-45deg); }
  .log { max-width: 620px; margin: 28px auto 0; }
  .band { position: relative; margin-top: 88px; padding: 90px var(--gutter); overflow: hidden; background: none; border-block: 1px solid var(--hairline); } .band-in { position: relative; z-index: 1; max-width: 1080px; margin: 0 auto; } .band :global(.sh) { margin-bottom: 52px; } .embed { display: grid; gap: 30px; } .e3 { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; } .e3 li { padding: 18px 20px; border-radius: 16px; border: 1px solid var(--ln-2); background: rgb(22 22 29 / 0.03); display: grid; gap: 6px; } .e3 b { font-weight: 500; } .e3 span { color: var(--tx-2); font-size: 15px; line-height: 1.55; }
  .tgrid { list-style: none; margin: 0 0 32px; padding: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; } .tgrid li { padding: 26px; border-radius: 20px; border: 1px solid var(--ln-2); background: #ffffff; display: flex; flex-direction: column; gap: 10px; align-items: flex-start; } .tgrid p { margin: 0; color: var(--tx-2); font-size: 15.5px; line-height: 1.6; } .tgrid a { margin-top: auto; color: var(--v-300); text-underline-offset: 3px; padding-top: 6px; }
  .lic { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; } .lic li { display: grid; gap: 2px; padding: 14px 18px; border-radius: 14px; border: 1px solid var(--ln-1); background: rgb(22 22 29 / 0.03); } .lic b { font-weight: 500; } .lic span { color: var(--tx-2); font-size: 15px; line-height: 1.5; }
  .embed :global(.sign-fr) { max-width: 840px; margin-inline: auto; }
  .shots { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 28px; } .trio { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 26px; margin-top: 56px; } .trio p { color: var(--tx-2); line-height: 1.65; margin: 10px 0 0; }
  .fgrid { list-style: none; margin: 0 0 56px; padding: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; } .fgrid a { display: flex; flex-direction: column; gap: 10px; height: 100%; padding: 14px 14px 22px; border-radius: 22px; border: 1px solid var(--ln-2); background: #ffffff; color: inherit; text-decoration: none; box-shadow: inset 0 1px 0 rgb(255 255 255 / .07); transition: border-color var(--d-base), transform var(--d-base) var(--e-out); } .fgrid a:hover { border-color: var(--v-300); transform: translateY(-3px); } .fgrid h3, .fgrid p, .fgrid .lk { margin-left: 8px; margin-right: 8px; } .fgrid p { margin-top: 0; margin-bottom: 0; color: var(--tx-2); font-size: 15.5px; line-height: 1.6; } .fgrid .lk { margin-top: auto; padding-top: 6px; color: var(--v-300); font-size: 15px; } .ftile { display: block; border-radius: 14px; overflow: hidden; }
  .ftile { display: grid; place-items: center; height: 212px; overflow: hidden; border: 1px solid var(--ln-1); border-radius: 14px; background: #ffffff; } .fv { zoom: .62; }
  .still-tile { display: grid; justify-items: center; } .still-tile.slim { margin-bottom: 8px; } .log2 { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 24px; align-items: center; margin-top: 28px; } .log2 .log { margin: 0; max-width: none; }
  .cubecard { position: absolute; right: -14px; bottom: -64px; width: 230px; }
  .marq { overflow: hidden; margin: 0 calc(var(--gutter) * -1) 48px; -webkit-mask-image: linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent); mask-image: linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent); } .track { display: flex; gap: 22px; list-style: none; margin: 0; padding: 18px 0 30px; width: max-content; animation: mq 60s linear infinite; } .marq:hover .track { animation-play-state: paused; } @keyframes mq { to { transform: translateX(-50%); } }
  .pc2 { position: relative; display: block; width: 150px; height: 190px; border-radius: 6px; background: var(--doc-paper); box-shadow: 0 24px 50px rgb(60 40 140 / 0.248); padding: 18px 14px; box-sizing: border-box; text-decoration: none; transition: transform var(--d-base) var(--e-out); } .pc2:hover { transform: translateY(-8px) rotate(-2deg); } .pc2 i { display: block; height: 5px; border-radius: 3px; background: var(--doc-line); margin-top: 9px; } .pc2 b { position: absolute; left: 14px; right: 10px; bottom: 14px; font: 400 17px/1.1 var(--f-display); color: var(--doc-ink); }
  .pchips { list-style: none; margin: 34px 0 0; padding: 0; display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; } .pchips a { display: inline-flex; align-items: center; min-height: 44px; padding: 0 20px; border-radius: 999px; border: 1px solid var(--doc-line); background: #fff; color: var(--doc-ink); text-decoration: none; font-size: 15.5px; } .pchips a:hover { border-color: var(--v-700); color: var(--v-700); } .pact { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; } .pbtn.ghost { background: transparent; color: var(--v-700); border: 1px solid var(--v-700); }
  .tpl { max-width: none; overflow: hidden; } .tpl-in { position: relative; z-index: 1; max-width: 1180px; margin: 0 auto; }
  .nums { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); margin: 0; border-radius: 22px; border: 1px solid var(--ln-2); background: #ffffff; overflow: hidden; } .nums > div { padding: 30px 26px; border-right: 1px solid var(--ln-1); } .nums > div:last-child { border-right: 0; } .nums dt { font: 500 12px var(--f-mono); letter-spacing: .08em; text-transform: uppercase; color: var(--tx-3); } .nums dd { margin: 14px 0 0; display: grid; gap: 8px; } .nums b { font: 400 64px/1 var(--f-display); letter-spacing: -.02em; } .nums span { color: var(--tx-2); font-size: 15px; line-height: 1.5; }
  .paper { margin-top: 88px; background: var(--doc-paper); color: var(--doc-ink); padding: 110px var(--gutter); } .paper-in { max-width: 1000px; margin: 0 auto; text-align: center; } .eb { font: 12.5px var(--f-mono); letter-spacing: .08em; color: var(--v-700); margin: 0 0 16px; } .paper h2 { font: 400 clamp(2.3rem, 4.6vw, 3.75rem)/1 var(--f-display); letter-spacing: -.02em; max-width: 820px; margin: 0 auto; } .paper h2 em { color: var(--v-700); -webkit-text-fill-color: var(--v-700); } .lead { max-width: 640px; margin: 22px auto 0; font-size: 19px; line-height: 1.55; color: #4a473f; }
  .uses { list-style: none; margin: 48px 0 40px; padding: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; text-align: left; } .uses li { padding: 22px; border-radius: 14px; background: #fff; border: 1px solid var(--doc-line); display: grid; gap: 6px; } .uses b { font-weight: 500; } .uses span { color: #5a574d; font-size: 15px; line-height: 1.5; } .pbtn { display: inline-flex; align-items: center; min-height: 52px; padding: 0 30px; border-radius: 999px; background: var(--v-700); color: #fff; font-weight: 500; text-decoration: none; } .pbtn:hover { background: var(--v-800); }
  .faq { max-width: 860px; margin: 0 auto; } .vid { padding-bottom: 0; } .video { max-width: 960px; margin: 0 auto; border-radius: 20px; overflow: hidden; border: 1px solid var(--ln-2); box-shadow: var(--sh-2), 0 0 80px rgb(90 58 193 / .25); } .video video { display: block; width: 100%; height: auto; background: #16161d; aspect-ratio: 16 / 9; } .tr { max-width: 860px; margin: 22px auto 0; color: var(--tx-2); } .tr summary { cursor: pointer; min-height: 44px; display: flex; align-items: center; } .tr p { line-height: 1.7; margin: 8px 0 0; }
  .close { position: relative; margin-top: 88px; padding: 150px var(--gutter) 90px; text-align: center; overflow: hidden; } .close-in { position: relative; z-index: 1; } .close h2 { font: 400 clamp(3.4rem, 9vw, 6.5rem)/1 var(--f-display); letter-spacing: -.03em; margin: 0; background: var(--grad-title); -webkit-background-clip: text; background-clip: text; color: transparent; } .close h2 em { -webkit-text-fill-color: var(--v-400); } .close p { max-width: 600px; margin: 22px auto 0; font-size: 19px; line-height: 1.5; color: var(--tx-2); }
  @media (max-width: 1000px) { .how4 { grid-template-columns: 1fr 1fr; } .fgrid { grid-template-columns: 1fr 1fr; } .log2 { grid-template-columns: 1fr; } .wgrid, .tgrid, .trio, .e3 { grid-template-columns: 1fr 1fr; } .nums { grid-template-columns: 1fr 1fr; } .nums > div:nth-child(2) { border-right: 0; } .nums > div:nth-child(-n+2) { border-bottom: 1px solid var(--ln-1); } .int, .split { grid-template-columns: 1fr; } .uses { grid-template-columns: 1fr 1fr; } .stage { height: auto; display: grid; grid-template-columns: minmax(0, 1fr); gap: 24px; padding: 0 14px; } .stage :global(.st-code), .stage :global(.st-tl) { position: static; width: auto; transform: none; } }
  @media (max-width: 700px) { .how4 { grid-template-columns: 1fr; } .fgrid { grid-template-columns: 1fr; } .cubecard { display: none; } .hero { overflow: clip; } .stage > :global(*) { min-width: 0; max-width: 100%; } .stage { padding: 0; } .stage :global(.st-tl) { max-width: 100%; min-width: 0; } .sec { padding-top: 84px; } .hero { padding-top: 112px; } .wgrid, .tgrid, .trio, .e3, .two, .shots, .uses, .nums { grid-template-columns: 1fr; } .nums > div { border-right: 0; border-bottom: 1px solid var(--ln-1); } .nums > div:last-child { border-bottom: 0; } .nums b { font-size: 52px; } .cmp { padding: 20px 14px; overflow-x: auto; } .cmp table { min-width: 460px; } .band, .paper { padding: 80px var(--gutter); margin-top: 84px; } .close { padding-top: 100px; margin-top: 84px; } .proof { border-radius: 24px; justify-content: center; } }
  @media (prefers-reduced-motion: reduce) { .track { animation: none; } .stage :global(.st-tl) { transform: none; } }
</style>
