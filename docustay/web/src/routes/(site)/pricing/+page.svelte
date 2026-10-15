<script>
  import DeskHead from "$lib/site/desk/DeskHead.svelte";
  import Sec from "$lib/site/desk/Sec.svelte";
  import Faq from "$lib/site/desk/Faq.svelte";
  import Closing from "$lib/site/desk/Closing.svelte";
  import Figure from "$lib/site/desk/Figure.svelte";
  import SiteIcon from "$lib/site/desk/SiteIcon.svelte";
  import HomeBlocks from "$lib/site/desk/HomeBlocks.svelte";
  import PriceCalc from "$lib/site/desk/PriceCalc.svelte";
  import { dollars, SELFHOST_PRO_YEARLY_MINOR, COMMERCIAL_FROM_MINOR, proShown, foundersLastDay } from "$lib/site/plans.js";
  import { onMount } from "svelte";
  import { probablySignedIn } from "$lib/starter.js";
  import { AI_PLAN } from "$lib/site/pages/aiPlan.js";
  // claim-until-proven (an internal marker for scripts/features-gate.mjs, never rendered): F-AICREDITS stays PENDING PROOF in features.json until the Stage T customer test. The numbers themselves are checked by the claims gate.
  // Pricing (board Pricing_v3, voice V3 Straight). Every number comes from plans.js, which the claims gate checks; the AI credit numbers come from plans.js through aiPlan.js and are checked the same way.
  let { data } = $props();
  const p = $derived(data.plans);
  const pro = $derived(proShown(p));
  // Run 9 (board W1): Monthly / Yearly — offered only when the billing system sends a yearly price (yearly billing switched on)
  let yearly = $state(false), signedIn = $state(false);
  const canYearly = $derived(Number.isFinite(pro.yearlyMinor));
  onMount(() => { signedIn = probablySignedIn(); });
  // board W3: "Get Pro" remembers the plan — a fresh visitor makes an account first (Pro selected), someone signed in goes straight to checkout
  const getPro = $derived(`${signedIn ? "/upgrade" : "/signup"}?${signedIn ? "" : "plan=pro&"}interval=${yearly && canYearly ? "year" : "month"}`);
  const rows = $derived([
    ["Documents a month (forms count)", `${p.free.docsPerMonth}`, "Unlimited"],
    ["New templates a month", `${p.free.templatesPerMonth}`, "Unlimited"],
    ["Users", "1 (the owner)", "Unlimited"],
    ["Scribe drafts documents and forms", `${AI_PLAN.freeCredits} credits a month`, `${AI_PLAN.proCredits} credits a month`],
    ["Think harder", false, true],
    ["Send to a list, your own skills and playbooks, automations", false, true],
    ["Fee on payments you collect", "2%", "0%"],
    ["Signing links on your own domain", false, true],
    ["API, SDKs, own email domain, logo", true, true],
    ["Upload limit", "25 MB", "100 MB"],
    ["Test mode", true, true],
  ]);
  const counts = $derived([
    "A document is a sent document. A package of several documents counts once. Drafts, signers, reminders, resends and test mode never count. Documents are counted for each UTC calendar month.",
    "Free sends up to 15 documents a month. At that limit sending is blocked with a message about upgrading, and nothing is ever billed for going over.",
    "A form counts as one document the month it is first published, and each signed response counts as one document. Reopening or editing a form never counts again.",
    "Free makes up to 5 new templates a month, documents and forms together, however they are made (written, uploaded, customized from a built-in, Scribe, duplicated or through the API). Sending straight from a built-in template never counts. A new version of a template you already have never counts, and every template you have keeps working. Pro and self-hosted installs have no template limit.",
    "Email limits: Free sends up to 25 emails a day and Pro up to 500 emails a day.",
    "The API allows 600 requests a minute for each key. Past that it answers 429 with a Retry-After header. There are no per-call or per-API-document fees on any plan.",
    "Pro has no monthly document limit. It is for one organisation's own documents. If use is far above normal we contact you first, and there are no automatic overage bills.",
    "Docustay does not give refunds. You can cancel at any time, and Pro stays on until the end of the period you have paid for.",
    "Existing customers get at least 12 months' notice before a price change applies to them. Founders keep their price as long as the subscription stays active.",
    "Cancel from the Billing page (Cancel Pro). Pro stays on to the end of the paid period, the page shows the end date, and Resume Pro undoes it until then. After cancelling you keep read and download access to sent and signed documents on Free, and you can export everything at any time.",
    "Uploads: the app takes files up to 25 MB on Free and 100 MB on Pro. Through the API a request body is limited to 1 MB, which is a file of about 700 KB sent as base64; larger files go in through the app.",
    "Templates are starting points, not legal advice.",
  ]);
  const extra = $derived([
    { t: "screen", kind: "usage", eyebrow: "Know where you stand", h2: "Your usage is on the Billing page, and in the API.", sub: "Documents sent this month, emails sent today and what resets when. Nothing is billed for going over; sending is blocked with a message about upgrading. {{F-FREEPLAN}}", caption: "FIG. 05 · THE USAGE SCREEN", notes: [["Counted", "A sent document. Drafts, resends and test mode never count."], ["From code", "GET /api/v1/usage returns the same numbers. {{F-API}}"]] },
    { t: "strip", eyebrow: "Four numbers", h2: "What the plans come to.", items: [[String(p.free.docsPerMonth), "documents a month, free", "For one person, the owner. {{F-FREEPLAN}}"], [dollars(pro.listMonthlyMinor), "a month, flat", "The whole workspace, unlimited users and documents. {{F-PRO}}"], ["2% / 0%", "platform fee on payments", "Free pays 2% and Pro pays 0%, on top of Stripe's own fees. {{F-FEE}}"], ["600", "API requests a minute", "No per-call fee on any plan. {{F-API}}"]] },
  ]);
  const faq = [
    ["Is Free really free?", "Yes. Signing is never locked away. Plans change volume and extras, not whether it works. Free is for one person; Pro adds your team. {{F-ONEUSER}}"],
    ["What counts as a document?", "A sent document. A package of several documents counts once. Drafts, signers, reminders, resends and test mode never count."],
    ["What happens at the limit?", "Sending is blocked with a message about upgrading. Nothing is ever billed for going over."],
    ["Is there a limit on templates?", `Free makes up to ${p.free.templatesPerMonth} new templates a month, documents and forms together. Editing a template or saving a new version never counts, and everything you have made keeps working. Pro and self-hosted installs have no template limit.`],
    ["What does a payment cost?", "Stripe's fees go to Stripe. Docustay adds 2% on Free and 0% on Pro. {{F-FEE}}"],
    ["What are Scribe credits?", `A credit is about one Scribe draft. Free includes ${AI_PLAN.freeCredits} a month and Pro includes ${AI_PLAN.proCredits}, with Think harder on Pro for a harder request. You can also bring your own AI provider key, and then no credits are used. {{F-AICREDITS}}`],
    ["Is the founders price really for life?", "Yes, for as long as your subscription stays active. If you cancel and Pro ends, the founders price ends with it. {{F-FOUNDERS}}"],
    ["Do you give refunds?", "No. Docustay does not give refunds. You can cancel at any time from the Billing page, and Pro stays on until the end of the period you have paid for; nothing further is charged."],
    ["Can I cancel any time?", "Yes, from the Billing page. Pro stays on until the end of the period you paid for, then the workspace moves to Free."],
    ["Do I pay Stripe's fees too?", "Yes. Stripe charges its own fees to your Stripe account as usual. Docustay adds 2% on Free and 0% on Pro. {{F-FEE}}"],
    ["Can I run it myself?", "Yes. Self-host Community is free under the AGPL-3.0. Self-host Pro adds the paid features for one business. {{F-SELFHOST}}"],
  ];
</script>
<DeskHead title="Pricing: a free plan and one flat price" description="Free sends 15 documents and makes 5 new templates a month for one person. Pro is one flat price for the whole workspace with unlimited users. Self-host is free under the AGPL-3.0; Pro is billed per install." crumbs={[["Docustay", "/"], ["Pricing", "/pricing"]]} />
<section class="d-wrap pr" data-page="/pricing" data-voice="V3" data-template="T2">
  {#if pro.founders}<p class="band" data-feature="F-FOUNDERS">FOUNDERS PRICE OPEN UNTIL {foundersLastDay(p).toUpperCase()}</p>{/if}
  <p class="d-eyebrow">PRICING</p>
  <h1 class="d-h1 sm">One flat price for the whole team</h1>
  <p class="d-sub" data-feature="F-FREEPLAN F-PRO">Free to start. Pro unlocks everything, for every user, on one bill. Every price is on this page.</p>
  {#if canYearly}<div class="seg" role="group" aria-label="How often to pay"><button type="button" aria-pressed={!yearly} onclick={() => (yearly = false)}>Monthly</button><button type="button" aria-pressed={yearly} onclick={() => (yearly = true)}>Yearly</button></div>{/if}
  <div class="plans">
    <div class="plan"><p class="pn">FREE</p><p class="pp">$0</p><p class="pl" data-feature="F-FREEPLAN">For one person, the owner.</p><ul><li>{p.free.docsPerMonth} documents a month, forms count</li><li>{p.free.templatesPerMonth} new templates a month</li><li>AI drafting within {AI_PLAN.freeCredits} credits a month</li><li>Your own email domain and logo</li><li>2% fee on payments you collect</li></ul><a class="d-btn alt" href="/signup">Start free</a></div>
    <div class="plan hot" id="pro"><p class="pn">PRO</p>{#if pro.founders}<span class="chip">FOUNDERS</span>{/if}
      <p class="pp">{dollars(yearly && canYearly ? pro.yearlyMinor : pro.monthlyMinor)}<span>{yearly && canYearly ? "a year" : pro.founders ? "a month, for life" : "a month"}</span></p>
      <p class="pl" data-feature="F-PRO F-FOUNDERS">{pro.founders ? `Then ${dollars(pro.listMonthlyMinor)} a month for anyone who joins after ${foundersLastDay(p)} · unlimited users.` : "Flat for the whole workspace · unlimited users."}</p>
      <ul><li>Unlimited documents and templates</li><li>Think harder, send to a list</li><li>Your own skills, playbooks and automations</li><li>Your own signing domain, no footer</li><li>0% fee on payments you collect</li></ul><a class="d-btn main" href={getPro} data-feature="F-PRO" data-testid="pricing-get-pro">Get Pro</a></div>
    <div class="plan"><p class="pn">SELF-HOST</p><p class="pp">$0<span>Community</span></p><p class="pl" data-feature="F-SELFHOST F-SELFHOSTPRO">The same code on your own servers, under the AGPL-3.0.</p><ul><li>Self-host Pro: {dollars(SELFHOST_PRO_YEARLY_MINOR)} a year per install</li><li>Your data stays on your server</li><li>The same API and SDKs</li><li>Commercial licence for embedding and reselling</li></ul><a class="d-btn alt" href="/self-host">Read the self-host guide</a></div>
  </div>
  <p class="d-fine" style="margin-top:22px">The server and app are licensed under the AGPL-3.0 and the SDKs under the MIT licence. Using the API or the SDKs never makes your own software AGPL. <a href="/licensing">Read the licensing page</a>.</p>
</section>
<Sec eyebrow="Try it" title="Which plan fits you?" tight><PriceCalc {p} /></Sec>
<HomeBlocks blocks={[extra[0]]} />
<Sec eyebrow="Two figures" title="What counts, and what costs extra." tight>
  <div class="d-grid d-g2">
    <Figure caption="FIG. 01 · WHAT COUNTS AS A DOCUMENT"><ul class="kv"><li><b>COUNTS</b><span>A sent document. A package of several documents counts once. A form the month it is first published, and each signed response.</span></li><li><b>TEMPLATES</b><span>Free: {p.free.templatesPerMonth} new templates a month. Pro: no limit.</span></li><li><b>NEVER</b><span>Drafts, signers, reminders, resends and test mode.</span></li><li><b>PERIOD</b><span>Each UTC calendar month.</span></li><li><b>AT THE LIMIT</b><span>Sending is blocked with a message about upgrading. Nothing is ever billed for going over.</span></li></ul></Figure>
    <Figure caption="FIG. 02 · PAY-AS-YOU-GO AND ADD-ONS"><ul class="kv"><li><b>PAYMENTS</b><span>2% on Free and 0% on Pro, on top of Stripe's fees. The money goes to your own Stripe account.</span></li><li><b>SCRIBE</b><span>{AI_PLAN.freeCredits} credits a month on Free, {AI_PLAN.proCredits} on Pro and Think harder on Pro. Or bring your own AI key.</span></li><li><b>SELF-HOST PRO</b><span>{dollars(SELFHOST_PRO_YEARLY_MINOR)} a year per install, for your own business.</span></li><li><b>NO PER-CALL FEES</b><span>None on any plan.</span></li></ul></Figure>
  </div>
</Sec>
<HomeBlocks blocks={[extra[1]]} />
<Sec eyebrow="Compare" title="Compare Free and Pro." tight>
  <Figure caption="FIG. 03 · FREE AND PRO"><div class="tbl" role="table" aria-label="Free and Pro compared"><div class="tr th" role="row"><span role="columnheader">Feature</span><span role="columnheader">Free</span><span role="columnheader">Pro</span></div>
    {#each rows as [k, a, b]}<div class="tr" role="row"><span role="rowheader">{k}</span>{#each [a, b] as v}<span role="cell">{#if v === true}<SiteIcon name="check" size={18} /><i class="sr">Yes</i>{:else if v === false}<i class="no">—</i>{:else}{v}{/if}</span>{/each}</div>{/each}</div>
    <ul class="kv" style="margin-top:18px"><li><b>RUN IT YOURSELF</b><span data-feature="F-SELFHOST F-SELFHOSTPRO">Community: free. Self-host Pro: {dollars(SELFHOST_PRO_YEARLY_MINOR)} a year per install, for use in your own business. <a href="/self-host">The self-host guide</a></span></li>
      <li><b>COMMERCIAL LICENCE</b><span data-feature="F-LICENCE">For embedding Docustay in your product, white-labelling or reselling, from about {dollars(COMMERCIAL_FROM_MINOR)} a year. <a href="/contact">Talk to us</a></span></li></ul></Figure>
</Sec>
<Sec eyebrow="Plain text" title="Are you an AI agent?" tight><p class="d-fine" style="margin:0">Read <a href="/pricing.md">pricing.md</a>: the same numbers, no styling.</p></Sec>
<Sec eyebrow="What counts" title="Limits, refunds and notice." tight><ul class="counts">{#each counts as c}<li>{c}</li>{/each}</ul></Sec>
<Sec eyebrow="Questions" title="Plain answers." tight><Faq items={faq} /></Sec>
<Closing title="Start sending this afternoon." label="Get started free" href="/signup" keep={[["Product", "/product"], ["Licensing", "/licensing"], ["Trust", "/trust"]]} />
<style>
  .pr { padding-top: 56px; } .plans { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; margin-top: 32px; align-items: stretch; }
  .seg { display: inline-flex; border: 1px solid #2a2a2c; border-radius: 8px; padding: 3px; margin-top: 28px; gap: 2px; } .seg button { background: none; border: 0; color: #a8a39a; font: 500 14px/1 var(--font-sans); padding: 9px 18px; border-radius: 6px; cursor: pointer; } .seg button[aria-pressed="true"] { background: #faf8f3; color: #1b1b1b; font-weight: 600; }
  .plan { display: flex; flex-direction: column; gap: 12px; background: #faf8f3; color: #1b1b1b; border-radius: 4px; padding: 24px; box-shadow: 0 30px 60px rgb(0 0 0 / .55); position: relative; } .plan.hot { outline: 2px solid #8585fd; }
  .pn { margin: 0; font: 600 11px/1 var(--font-mono); letter-spacing: .12em; color: #6f6b63; } .chip { position: absolute; right: 14px; top: 14px; background: #5a3ac1; color: #faf8f3; padding: 5px 8px; border-radius: 3px; font: 700 10px/1 var(--font-sans); letter-spacing: .1em; transform: rotate(4deg); }
  .pp { margin: 0; font: 600 38px/1.05 var(--font-sans); letter-spacing: -.03em; } .pp span { display: block; font: 500 13px/1.4 var(--font-sans); letter-spacing: 0; color: #6f6b63; margin-top: 4px; } .pl { margin: 0; font-size: 14.5px; line-height: 1.5; color: #4a4740; min-height: 3em; }
  .plan ul { margin: 4px 0 8px; padding: 0 0 0 18px; list-style: disc; display: grid; gap: 7px; font-size: 14.5px; line-height: 1.45; flex: 1; } .plan :global(.d-btn) { align-self: stretch; text-align: center; justify-content: center; } .plan :global(.d-btn.alt) { color: #1b1b1b; border-color: #1b1b1b; }
  .kv { list-style: none; margin: 0; padding: 0; display: grid; } .kv li { display: grid; grid-template-columns: 140px 1fr; gap: 14px; padding: 11px 0; border-top: 1px solid #222224; font-size: 15px; line-height: 1.5; } .kv li:first-child { border-top: 0; } .kv b { font: 500 11px/1.6 var(--font-mono); letter-spacing: .1em; color: #a8a39a; } @media (max-width: 600px) { .kv li { grid-template-columns: 1fr; gap: 3px; } }
  .band { display: inline-block; margin: 0 0 18px; padding: 6px 10px; border-radius: 4px; background: #5a3ac1; color: #faf8f3; font: 600 11px/1 var(--font-mono); letter-spacing: .12em; }
  .tbl { display: grid; } .tr { display: grid; grid-template-columns: 1.7fr 1fr 1fr; gap: 14px; padding: 12px 0; border-top: 1px solid #222224; font-size: 15px; line-height: 1.45; } .tr.th { border-top: 0; font: 600 12px/1 var(--font-mono); letter-spacing: .1em; text-transform: uppercase; color: #a8a39a; } .tr > :first-child { color: #e6e2d8; } .no { font-style: normal; color: #8f8a80; } .sr { position: absolute; left: -9999px; }
  .counts { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; max-width: 78ch; } .counts li { padding-left: 22px; position: relative; color: #c9c5bb; line-height: 1.6; } .counts li::before { content: ""; position: absolute; left: 0; top: .6em; width: 8px; height: 8px; background: #8585fd; }
  @media (max-width: 1100px) { .plans { grid-template-columns: repeat(2, minmax(0, 1fr)); } } @media (max-width: 640px) { .plans { grid-template-columns: 1fr; } .tr { grid-template-columns: 1.3fr 1fr 1fr; font-size: 13px; gap: 6px; } }
</style>
