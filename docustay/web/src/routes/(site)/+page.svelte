<script>
  import DeskHead from "$lib/site/desk/DeskHead.svelte";
  import HeroSheets from "$lib/site/desk/HeroSheets.svelte";
  import Figure from "$lib/site/desk/Figure.svelte";
  import Flow from "$lib/site/desk/Flow.svelte";
  import AreaFig from "$lib/site/desk/AreaFig.svelte";
  import BarsFig from "$lib/site/desk/BarsFig.svelte";
  import Sec from "$lib/site/desk/Sec.svelte";
  import Paper from "$lib/site/desk/Paper.svelte";
  import Stamp from "$lib/site/desk/Stamp.svelte";
  import Spec from "$lib/site/desk/Spec.svelte";
  import Faq from "$lib/site/desk/Faq.svelte";
  import Closing from "$lib/site/desk/Closing.svelte";
  import SiteIcon from "$lib/site/desk/SiteIcon.svelte";
  import HomeBlocks from "$lib/site/desk/HomeBlocks.svelte";
  import { homeDescribe, homeOrder, homeBuild } from "$lib/site/pages/pass3-home.js";
  import { reveal } from "$lib/site/desk/reveal.js";
  import { dollars, SELFHOST_PRO_YEARLY_MINOR } from "$lib/site/plans.js";
  import { SEND } from "$lib/site/pages/snippets.js";
  let { data } = $props();
  const p = $derived(data.plans);
  /** voice V1 Helper. Every capability sentence ends with its feature id (features.json). */
  const FAQ = $derived([
    ["Does the person signing need an account?", "No. They open the link on a phone or a computer, fill in their fields, tick that they agree to sign electronically and press finish. {{F-SIGN}}"],
    ["What do I get at the end?", "A sealed PDF and a certificate of completion that lists who signed and when and carries a hash. Anyone can check the PDF on the verify page, with no account. {{F-CERT}} {{F-VERIFY}}"],
    ["What does it cost?", `The Free plan is ${p.free.docsPerMonth} documents and ${p.free.templatesPerMonth} new templates a month for one person, the owner, with forms and Scribe included. Pro is ${dollars(p.pro.monthlyMinor)} a month for the whole workspace, with unlimited documents and unlimited users. {{F-FREEPLAN}} {{F-PRO}}`],
    ["Is a Docustay signature legal?", "In the United States, federal and state law generally treat an electronic signature as acceptable for many documents. A Docustay signature is a simple electronic signature with a strong record and a digital seal. We do not make qualified signatures and we do not give legal advice. {{F-VERIFYDOC}}"],
    ["Can I run it myself?", `Yes. Docustay is open source under the AGPL-3.0, so the Community edition is free to self-host. Self-host Pro is ${dollars(SELFHOST_PRO_YEARLY_MINOR)} a year for each install. {{F-SELFHOST}} {{F-LICENCE}}`],
  ]);
  const steps = [["1 / 3", "Pick it", "A template from the 24, or a file from your computer."], ["2 / 3", "Say who signs", "Add names and emails, and the order if it matters."], ["3 / 3", "Send it", "Everyone gets the signed copy and its certificate."]];
  const spec = $derived([
    ["PRICE", `Free: ${p.free.docsPerMonth} documents and ${p.free.templatesPerMonth} new templates a month. Pro: ${dollars(p.pro.monthlyMinor)} a month, flat. {{F-FREEPLAN}}`.replace(/\s*\{\{[^}]+\}\}/g, "")],
    ["LICENCE", "AGPL-3.0. Free to self-host. A commercial licence if you ship it inside a product."],
    ["TEST MODE", "Test keys never email anyone but you. Send a test document before you go live."],
    ["TEMPLATES", "54 built-in templates, in 14 languages."],
    ["PROOF", "A sealed PDF and a certificate of completion with every signed copy."],
  ]);
</script>
<!-- claim-until-proven: Scribe lines are on the page now and stay marked until the claims ledger proves them (the maintainer, 8 Oct) -->
<DeskHead title="Free e-signatures, templates and an API" description="Send a document, get it signed on any device and keep the proof. Free to start, open source under the AGPL-3.0, 24 templates and a REST API with test mode built in." software={{ "@type": "Offer", price: "0", priceCurrency: "USD" }} />

<section class="hero d-wrap">
  <div>
    <span class="d-chip">OPEN SOURCE · AGPL-3.0 · FREE TO START</span>
    <h1 class="d-h1" style="margin-top:26px">Send it.<br />Get it signed.<br />Keep the <span class="d-under">proof.</span></h1>
    <p class="d-sub" style="font-size:19px;max-width:520px">Free to start and open source (AGPL-3.0). Your team signs from a screen. Your product signs from code.</p>
    <div class="d-actions"><a class="d-btn main" href="/signup" data-feature="F-FREEPLAN">Get started free</a><a class="d-btn alt" href="/docs">Read the docs</a></div>
    <p class="d-fine">Free plan · AGPL-3.0 · Test mode built in</p>
  </div>
  <HeroSheets />
</section>

<Sec eyebrow="How it works" title="From a file to a sealed copy, in five steps.">
  <Figure caption="FIG. 01 · THE LIFE OF ONE DOCUMENT">
    <Flow nodes={[{ label: "Draft", sub: "Template or PDF" }, { label: "Send", sub: "Email + reminders" }, { label: "Sign", sub: "Any device", red: true }, { label: "Seal", sub: "PDF + certificate" }, { label: "Verify", sub: "Check anywhere" }]} />
    <p class="fig-note" style="margin-top:22px">Every step is recorded on the document's own timeline. The sealed copy and its certificate go to everyone.</p>
  </Figure>
</Sec>

<Sec eyebrow="Reports" title="See what is signed, and what is stuck." sub="Documents sent, completion rate and time to finish, by day and by template. Download it as CSV." tight>
  <div class="grid gap-4 lg:grid-cols-[1.6fr_1fr]" data-feature="F-AUDIT">
    <Figure caption="FIG. 02 · REPORTS YOU CAN READ AT A GLANCE" note="DOCUMENTS SIGNED PER DAY · SAMPLE DATA FOR ILLUSTRATION"><AreaFig points={[3, 5, 4, 7, 6, 9, 8, 11, 9, 12, 14, 13, 16, 19]} /></Figure>
    <Figure caption="FIG. 03 · COMPLETION BY TEMPLATE" note="SAMPLE DATA FOR ILLUSTRATION"><BarsFig rows={[["Contractor agreement", 64], ["Offer letter", 72], ["Photo release", 81], ["Permission slip", 93]]} /></Figure>
  </div>
</Sec>

<Sec eyebrow="Two ways in" title="Use it with your team, or build it into your product.">
  <div class="d-grid d-g2">
    <div class="d-paper-card" data-feature="F-TEMPLATES"><p class="pm" style="font:500 11px/1 var(--font-mono);letter-spacing:.12em;color:#6f6b63">I NEED DOCUMENTS SIGNED</p><h3 class="d-h3" style="font-size:1.7rem;margin-top:14px">Pick a template. Send it today.</h3>
      <p style="color:#4a4740;line-height:1.6;margin:12px 0 0">54 built-in templates, a free plan and reminders that stop once everyone has signed.</p>
      <ul class="ways"><li>Templates</li><li>Forms</li><li>Reminders</li><li>Payments inside a document</li></ul><a class="d-btn ink" href="/signup">Start free</a></div>
    <div class="d-card" data-feature="F-API"><p style="font:500 11px/1 var(--font-mono);letter-spacing:.12em;color:#9a958b;margin:0">I'M BUILDING A PRODUCT</p><h3 class="d-h3" style="font-size:1.7rem;margin-top:14px">Send from your code.</h3>
      <div class="d-code" style="margin-top:16px"><pre tabindex="0"><code>{SEND.javascript}</code></pre></div>
      <a class="d-btn alt" style="margin-top:18px" href="/developers">Read the API docs</a></div>
  </div>
</Sec>

<Sec eyebrow="Three steps" title="Three pages, one signature.">
  <div class="three">{#each steps as [n, h, t], i}<Paper tilt={[-1.2, 0.8, -0.6][i]} class="step"><div class="pm">{n}</div><div class="pt" style="font-size:22px;margin-top:10px">{h}</div><p>{t}</p></Paper>{/each}</div>
</Sec>

<Sec eyebrow="Scribe" title="Or just describe it." sub="Tell Scribe what you need. It writes the document, places every field and sets the payment terms. You review it before anything is sent.">
  <div class="scribe" data-feature="F-SCRIBE"><SiteIcon name="scribe" size={30} /><div class="steps"><span>You describe</span><span>Scribe builds</span><span class="r">You review</span><span>Send</span></div><a class="d-btn alt sm" href="/product/scribe">See how Scribe works</a></div>
</Sec>

<HomeBlocks blocks={homeDescribe()} />

<Sec>
  <div class="d-split" data-feature="F-CERT">
    <div><p class="d-eyebrow">The certificate</p><h2 class="d-h2">A certificate with every signed copy.</h2><p class="d-sub">It lists who signed and when, and carries a hash of the sealed file. Check any PDF on the verify page. No account needed.</p><div class="d-actions"><a class="d-btn alt" href="/verify" data-feature="F-VERIFY">Verify a PDF</a><a class="d-btn alt" href="/product/proof">See what is recorded</a></div></div>
    <div class="certwrap"><Paper tilt={1.2} class="cert"><div class="pm">Certificate of completion</div><div class="pt" style="margin-top:8px">Services Agreement</div><div class="pl" style="width:80%;margin-top:14px"></div><div class="pl" style="width:66%"></div><div class="pm" style="margin-top:20px">sha-256 · 9f2c8a…41ab</div><span class="cs"><Stamp text="SEALED" /></span></Paper></div>
  </div>
</Sec>

<HomeBlocks blocks={homeOrder()} />
<HomeBlocks blocks={homeBuild(p)} />
<Sec eyebrow="Built to be checked" title="The facts, in one table."><Spec rows={spec} /></Sec>
<Sec eyebrow="Questions" title="Quick answers." tight><Faq items={FAQ} /></Sec>
<Closing title="Documents, signed." keep={[["How it works", "/product"], ["Templates", "/document-templates"], ["Pricing", "/pricing"]]} />

<style>
  .hero { display: grid; grid-template-columns: 1.02fr 1fr; gap: 30px; align-items: center; padding-top: 84px; padding-bottom: 40px; }
  @media (max-width: 900px) { .hero { grid-template-columns: 1fr; padding-top: 44px; } }
  .ways { list-style: none; padding: 0; margin: 18px 0 22px; display: flex; flex-wrap: wrap; gap: 8px; } .ways li { font: 500 12px/1 var(--font-mono); border: 1px solid #bdb8ab; border-radius: 4px; padding: 7px 10px; color: #4a4740; }
  .three { display: grid; grid-template-columns: repeat(3, 1fr); gap: 22px; } :global(.step) { padding: 26px; } :global(.step) p { color: #4a4740; margin: 10px 0 0; line-height: 1.55; } @media (max-width: 800px) { .three { grid-template-columns: 1fr; } }
  .scribe { display: flex; flex-wrap: wrap; align-items: center; gap: 18px 26px; border: 1px solid #2a2a2c; background: #131315; padding: 22px 26px; } .steps { display: flex; flex-wrap: wrap; gap: 8px; flex: 1; } .steps span { font: 500 12px/1 var(--font-mono); letter-spacing: .08em; text-transform: uppercase; border: 1px solid rgb(244 242 236 / .6); padding: 9px 12px; } .steps span.r { border-color: #8585fd; background: rgb(133 133 253 / .1); }
  .certwrap { display: grid; place-items: center; padding: 20px 0; } :global(.cert) { width: min(340px, 90%); padding: 26px; min-height: 230px; } .cs { position: absolute; right: 18px; bottom: 20px; }
</style>
