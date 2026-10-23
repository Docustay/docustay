<script>
  import DeskHead from "$lib/site/desk/DeskHead.svelte";
  import Sec from "$lib/site/desk/Sec.svelte";
  import Faq from "$lib/site/desk/Faq.svelte";
  import Closing from "$lib/site/desk/Closing.svelte";
  import Figure from "$lib/site/desk/Figure.svelte";
  import SiteIcon from "$lib/site/desk/SiteIcon.svelte";
  import Blocks from "$lib/site/desk/Blocks.svelte";
  import SceneHero from "$lib/site/desk/SceneHero.svelte";
  import PriceCalc from "$lib/site/desk/PriceCalc.svelte";
  import { WORDS, dollars, SELFHOST_PRO_YEARLY_MINOR, COMMERCIAL_FROM_MINOR, proShown, foundersLastDay } from "$lib/site/plans.js";
  import { onMount } from "svelte";
  import { probablySignedIn } from "$lib/starter.js";
  // Pricing (SIGNWITH 5.19, the maintainer 17 Oct 2026). Every number comes from plans.js, which reads prices.json, generated from the server's one price list (src/product/docustayPrices.mjs); the claims gate checks them.
  let { data } = $props();
  const p = $derived(data.plans);
  const pro = $derived(proShown(p));
  let signedIn = $state(false);
  onMount(() => { signedIn = probablySignedIn(); });
  const go = (plan) => `${signedIn ? "/upgrade" : "/signup"}?plan=${plan}${signedIn ? "" : "&interval=month"}`;
  const cents = (m) => (m % 100 === 0 ? dollars(m) : `$${(m / 100).toFixed(2)}`);
  const word = (cell) => (cell === "Yes" ? true : cell === "No" ? false : cell);
  const compareRow = (k) => { const w = WORDS.compare.find((x) => x.key === k); return [w.label, word(w.cells.free), word(w.cells.payg), word(w.cells.pro), word(w.cells.lifetime)]; };
  const rows = $derived([
    ["grp", "Compared on the same rows as the app's Billing page"],
    ...["price", "team", "signers", "documents", "ai", "templates", "fee", "plays"].map(compareRow),
    ["grp", "Also included"],
    ["Send to a list", `Up to ${p.free.bulkCap} at a time`, true, true, true],
    ["Upload limit", "25 MB", "25 MB", "100 MB", "100 MB"],
    ["API, SDKs, your own email domain and logo", true, true, true, true],
    ["Test mode", true, true, true, true],
  ]);
  const counts = $derived([
    "A document counts when it is sent. A package of several documents counts once. Drafts, signers, reminders, resends and test mode never count. Documents are counted per workspace. On Free the count follows the UTC calendar month. On Pay as you go, Pro and Lifetime it follows your billing month: it starts the day you subscribe (or buy Lifetime) and resets on the same day each month, the same dates Stripe invoices.",
    `Free sends up to ${p.free.docsPerMonth} documents a month. At that limit sending stops with a message that points to Pay as you go. Nothing is ever billed on Free.`,
    `An AI draft counts when it works. A failed or empty draft is never charged. Free stops at ${p.free.draftsPerMonth} drafts a month; the paid plans go past their allowance at ${cents(p.payg.draftOverMinor)} a draft, and the price is shown before you use it.`,
    `Free sends to up to ${p.free.signersPerMonth} different signers a month. A signer is counted once a month by email address, however many documents they get. Sending to your own team never counts, sending again to someone you already sent to this month is always allowed, and the sixteenth new person asks you to choose a plan. Pay as you go, Pro and Lifetime have no signer limit.`,
    `Free makes up to ${p.free.templatesPerMonth} new templates a month and Pay as you go ${p.payg.templatesPerMonth}, however they are made (written, uploaded, customized from a built-in, drafted by AI, duplicated or through the API). Sending straight from a built-in template never counts. A new version of a template you already have never counts, and every template you have keeps working. Past the limit you can choose Pro; there is no charge for each template.`,
    "The signer and template limits start on 1 November 2026. A workspace already past either number keeps everything it has, and the limit applies to new signers and new templates from that date.",
    "Email limits: Free sends up to 25 emails a day and Pro up to 500 emails a day.",
    "The API allows 600 requests a minute for each key. Past that it answers 429 with a Retry-After header. There are no per-call or per-API-document fees on any plan.",
    `Your budget is ${dollars(p.budget.defaultMinor)} for each billing month unless you change it. You get an email at 50%, 80% and 100%. At 100% sending and AI drafting pause with a clear message, nothing is deleted, and raising the budget resumes them. Bulk sends and any action over ${dollars(p.budget.confirmOverMinor)} ask you to confirm first.`,
    `Pay as you go is billed monthly in arrears, plus an early invoice when about ${dollars(p.budget.earlyInvoiceMinor)} has built up. Team members who join mid-month are charged for the days they have. If a payment fails we try again for ${p.budget.failedPaymentPauseDays} days, then the workspace falls back to the Free limits. Documents are never deleted.`,
    "Docustay does not give refunds. You can cancel at any time, and a paid plan stays on until the end of the period you have paid for.",
    "Existing customers get at least 12 months' notice before a price change applies to them. Founders keep their price as long as the subscription stays active.",
    "Uploads: the app takes files up to 25 MB on Free and Pay as you go, and 100 MB on Pro and Lifetime. Through the API a request body is limited to 1 MB, which is a file of about 700 KB sent as base64; larger files go in through the app.",
    "Templates are starting points, not legal advice.",
  ]);
  const faq = [
    ["Is Free really free?", "Yes. Signing is never locked away. Plans change volume and extras, not whether it works. Free is for one team member, and each person gets one Free workspace; Pay as you go and Pro add your team. {{F-ONEUSER}}"],
    ["What counts as a document?", "A document counts when it is sent. A package of several documents counts once. Drafts, signers, reminders, resends and test mode never count. {{F-PAYG}}"],
    ["What happens at the limit?", "On Free, sending stops with a message that points to Pay as you go. On the paid plans, sending carries on and you pay for what you use, up to your budget for the billing month. {{F-BUDGET}}"],
    ["When does my allowance reset?", `On Free, on the 1st of each month (UTC). On Pay as you go, Pro and Lifetime, on your billing date: if you start on Oct 19 you get ${p.payg.docsIncluded} free documents and ${p.payg.draftsIncluded} free AI drafts from Oct 19 to Nov 19, and everything starts again on Nov 19. Stripe invoices the same window. Billing shows the date as "Resets Nov 19".`],
    ["Can my bill run away?", `No. Your budget is ${dollars(p.budget.defaultMinor)} for each billing month by default. You get an email at 50%, 80% and 100%, and at 100% sending pauses until you raise it. {{F-BUDGET}}`],
    ["Can I see the bill before I send?", "Yes. Bulk sends show a total and ask you to confirm, and so does anything over $5. The Billing page and GET /api/v1/usage show the running bill. {{F-USAGEAPI}}"],
    ["What does a payment cost?", "Stripe's fees go to Stripe. Docustay adds 2% on Free and Pay as you go and 0% on Pro and Lifetime. {{F-FEE}}"],
    ["What is an AI draft?", `One request that makes a document or a form from your words or a file. Free includes ${p.free.draftsPerMonth} a calendar month and Pay as you go ${p.payg.draftsIncluded} each billing month, Pro ${p.pro.draftsIncluded} and Lifetime ${p.lifetime.draftsIncluded}. Past that a draft is ${cents(p.payg.draftOverMinor)} on a paid plan. A failed or empty draft is never charged. {{F-AICREDITS}}`],
    ["How does Lifetime work?", `You pay ${dollars(p.lifetime.oneTimeMinor)} once, for the first ${p.lifetime.firstWorkspaces} workspaces. It is Pro for as long as Docustay runs the hosted service, and it keeps its 0% fee on payments for that whole time. {{F-LIFETIME}}`],
    ["How long does the founders price last?", "For as long as your Pro subscription stays active. If you cancel and Pro ends, the founders price ends with it. {{F-FOUNDERS}}"],
    ["Can I switch plans?", "Yes, from Billing. Moving up (Pay as you go to Pro, or either to Lifetime) takes effect at once and the unused part of what you already paid is credited against the new price; the confirm box shows the exact amount before you click. Moving down, from Pro to Pay as you go, happens at the end of the period you paid for, and you can cancel it before then. Usage is always billed."],
    ["Can I use my own AI key?", "Yes, on Pay as you go, Pro and Lifetime: your drafts then use your own provider account and do not count against the plan's allowance. Free uses Docustay's AI writer."],
    ["Is Pro really unlimited?", "For normal business use of one organisation, yes: unlimited documents, signers and team members. A login belongs to one person. We look at, and may ask about, a workspace with more than 50 team members or 2,000 documents in a month, or one that stores more than 10 GB on any plan, and we pause sending that harms other people (for example mail that draws spam complaints)."],
    ["Do you give refunds?", "No. Docustay does not give refunds. You can cancel at any time from the Billing page, and a paid plan stays on until the end of the period you have paid for; nothing further is charged. Moving up to a higher plan credits the unused time against the new plan instead."],
    ["Can I cancel any time?", "Yes, from the Billing page. A paid plan stays on until the end of the period you paid for, then the workspace moves to Free."],
    ["Can I run it myself?", "Yes. Self-host Community is free under the AGPL-3.0. Self-host Pro adds the paid features for one business. {{F-SELFHOST}}"],
  ];
</script>
<DeskHead title="E-signature pricing: pay for what you use, or get everything" description="E-signature pricing in plain numbers. Free sends 15 documents a month. Pay as you go is $5 per team member a month plus what you use. Signers are free. Pro is one flat price. Lifetime is $299 once. Self-host is free under the AGPL-3.0." crumbs={[["Docustay", "/"], ["Pricing", "/pricing"]]} />
<SceneHero scene="rings" cls="prh">
  {#if pro.founders}<p class="band" data-feature="F-FOUNDERS">FOUNDERS PRICE OPEN UNTIL {foundersLastDay(p).toUpperCase()}</p>{/if}
  <p class="d-eyebrow">PRICING</p>
  <h1 class="d-h1 sm">Pay for what you use, <em>or get everything.</em></h1>
  <p class="d-sub" data-feature="F-FREEPLAN F-PAYG F-PRO F-LIFETIME">E-signature pricing in plain numbers. Start free. Pay as you go if you send a little. Pro if you send a lot. Every price is on this page, and you set a monthly budget so the bill never surprises you.</p>
</SceneHero>
<section class="d-wrap pr" data-page="/pricing" data-voice="V3" data-template="T2">
  <div class="plans">
    <div class="plan"><p class="pn">FREE</p><p class="pp">$0</p><p class="pl" data-feature="F-FREEPLAN">For one team member, the owner.</p>
      <h3>What it costs</h3><ul><li>Nothing, ever</li><li>{p.free.docsPerMonth} documents and {p.free.draftsPerMonth} AI drafts a month</li><li>{p.free.signersPerMonth} different signers a month</li><li>{p.free.feeBps / 100}% fee on payments you collect</li></ul>
      <h3>What you unlock</h3><ul><li>Sign, send and seal, with the API and test mode</li><li>{p.free.templatesPerMonth} new templates a month</li><li>Send to a list of up to {p.free.bulkCap}</li></ul>
      <a class="d-btn alt" href="/signup">Start free</a></div>
    <div class="plan"><p class="pn">PAY AS YOU GO</p><p class="pp">{dollars(p.payg.personMonthlyMinor)}<span>per team member a month</span></p><p class="pl" data-feature="F-PAYG">Pay for the team members who send, and for what you use.</p>
      <h3>What it costs</h3><ul><li>{p.payg.docsIncluded} documents free, then {cents(p.payg.docOverMinor)} each</li><li>{p.payg.draftsIncluded} AI drafts free, then {cents(p.payg.draftOverMinor)} each</li><li>{p.payg.feeBps / 100}% fee on payments you collect</li></ul>
      <h3>What you unlock</h3><ul><li>As many team members as you add</li><li>Unlimited signers, free</li><li>{p.payg.templatesPerMonth} new templates a month</li><li>Send to a list of any size</li></ul>
      <a class="d-btn alt" href={go("payg")} data-testid="pricing-get-payg">Start Pay as you go</a></div>
    <div class="plan hot" id="pro"><p class="pn">PRO</p><span class="chip">MOST TEAMS</span>
      <p class="pp">{dollars(pro.monthlyMinor)}<span>{pro.founders ? "a month while Pro stays active" : "a month, flat"}</span></p>
      <p class="pl" data-feature="F-PRO F-FOUNDERS">{pro.founders ? `Founders price. Then ${dollars(pro.listMonthlyMinor)} a month for anyone who joins after ${foundersLastDay(p)}.` : "One price for the whole workspace."}</p>
      <h3>What it costs</h3><ul><li>Unlimited documents, signers and team members</li><li>{p.pro.draftsIncluded} AI drafts, then {cents(p.pro.draftOverMinor)} each</li><li>{p.pro.feeBps / 100}% fee on payments you collect</li></ul>
      <h3>What you unlock</h3><ul><li>Your own plays and playbooks</li><li>100 MB uploads</li><li>Unlimited templates</li></ul>
      <a class="d-btn main" href={go("pro")} data-feature="F-PRO" data-testid="pricing-get-pro">Get Pro</a></div>
    <div class="plan"><p class="pn">LIFETIME</p><span class="chip">LAUNCH OFFER</span><p class="pp">{dollars(p.lifetime.oneTimeMinor)}<span>once</span></p><p class="pl" data-feature="F-LIFETIME">For the first {p.lifetime.firstWorkspaces} workspaces. Pro for as long as Docustay runs the hosted service.</p>
      <h3>What it costs</h3><ul><li>Paid once, nothing monthly</li><li>{p.lifetime.draftsIncluded} AI drafts a month, then {cents(p.lifetime.draftOverMinor)} each</li><li>{p.lifetime.feeBps / 100}% fee on payments you collect</li></ul>
      <h3>What you unlock</h3><ul><li>Everything Pro unlocks</li><li>Unlimited documents, signers and team members</li><li>100 MB uploads</li></ul>
      <a class="d-btn alt" href={go("lifetime")} data-testid="pricing-get-lifetime">Get Lifetime</a></div>
  </div>
  <p class="d-fine" style="margin-top:22px">Prices are in US dollars. Stripe's own fees on payments are extra and go to Stripe. The server and app are licensed under the AGPL-3.0 and the SDKs under the MIT licence. Using the API or the SDKs never makes your own software AGPL. <a href="/licensing">Read the licensing page</a>.</p>
</section>
<Sec eyebrow="What you pay for" title="Three things, and you choose how many." tight>
  <ul class="pay">
    <li><b>{dollars(p.payg.personMonthlyMinor)}</b>Per team member a month on Pay as you go. Signers are always free.</li>
    <li><b>{cents(p.payg.docOverMinor)}</b>A document past the {p.payg.docsIncluded} included each billing month. It counts when it is sent.</li>
    <li><b>{cents(p.payg.draftOverMinor)}</b>An AI draft past the allowance. You see the price before you use it.</li>
  </ul>
</Sec>
<Sec eyebrow="Never charged" title="What never costs a thing." tight>
  <ul class="never"><li>Reminders</li><li>Test mode</li><li>Drafts, and signers on every paid plan</li><li>A failed or empty AI draft</li><li>API calls</li><li>Looking at or downloading your documents</li></ul>
</Sec>
<Sec eyebrow="Know your bill" title="A budget, alerts and a running total." tight>
  <div class="d-grid d-g2">
    <Figure caption="FIG. 01 · YOUR BUDGET"><ul class="kv"><li><b>DEFAULT</b><span data-feature="F-BUDGET">{dollars(p.budget.defaultMinor)} a month. You can change it any time.</span></li><li><b>ALERTS</b><span>An email at 50%, 80% and 100%.</span></li><li><b>AT 100%</b><span>Sending and AI drafting pause. Nothing is deleted. Raise the budget and they resume.</span></li><li><b>CONFIRM</b><span>Bulk sends and anything over {dollars(p.budget.confirmOverMinor)} show the total first.</span></li></ul></Figure>
    <Figure caption="FIG. 02 · WHEN YOU ARE BILLED"><ul class="kv"><li><b>MONTHLY</b><span>In arrears, with one line for team members, documents and drafts.</span></li><li><b>EARLY</b><span>An invoice goes out sooner if about {dollars(p.budget.earlyInvoiceMinor)} has built up.</span></li><li><b>MID-MONTH</b><span>Team members who join part way through are charged for the days they have.</span></li><li><b>RUNNING BILL</b><span data-feature="F-USAGEAPI">On the Billing page, and from the API at GET /api/v1/usage.</span></li></ul></Figure>
  </div>
</Sec>
<Sec eyebrow="Try it" title="Which plan fits you?" tight><PriceCalc {p} /></Sec>
<Sec eyebrow="Compare" title="Compare the plans." tight>
  <Figure caption="FIG. 03 · THE FOUR PLANS"><div class="tbl" role="table" aria-label="The four plans compared"><div class="tr th" role="row"><span role="columnheader">Feature</span><span role="columnheader">Free</span><span role="columnheader">Pay as you go</span><span role="columnheader">Pro</span><span role="columnheader">Lifetime</span></div>
    {#each rows as r}{#if r[0] === "grp"}<div class="tr grp" role="row"><span>{r[1]}</span></div>{:else}<div class="tr" role="row"><span role="rowheader">{r[0]}</span>{#each r.slice(1) as v}<span role="cell">{#if v === true}<SiteIcon name="check" size={18} /><i class="sr">Yes</i>{:else if v === false}<i class="no">—</i>{:else}{v}{/if}</span>{/each}</div>{/if}{/each}</div>
    <p class="d-fine" style="margin-top:14px" data-testid="compare-footnote">{WORDS.footnote}</p>
    <p class="d-fine" style="margin-top:6px" data-testid="compare-example">{WORDS.costExample.text}</p>
    <ul class="kv" style="margin-top:18px"><li><b>RUN IT YOURSELF</b><span data-feature="F-SELFHOST F-SELFHOSTPRO">Community: free. Self-host Pro: {dollars(SELFHOST_PRO_YEARLY_MINOR)} a year per install, for use in your own business. <a href="/self-host">The self-host guide</a></span></li>
      <li><b>COMMERCIAL LICENCE</b><span data-feature="F-LICENCE">For embedding Docustay in your product, white-labelling or reselling, from about {dollars(COMMERCIAL_FROM_MINOR)} a year. <a href="/contact">Talk to us</a></span></li></ul></Figure>
</Sec>
<Blocks blocks={[
  { t: "cols", id: "teams", eyebrow: "Teams and roles", h2: "Add the team members who send.", sub: "Free is for one team member, the owner. Pay as you go charges for each team member you add. Pro and Lifetime have unlimited team members. Signers are never charged. {{F-TEAMS}}", cols: [{ h: "Roles", p: "Owner, admin and member roles decide who can send, who can change settings and who can only look. {{F-TEAMS}}" }, { h: "Teams", p: "Group people into teams so each team sees its own documents and its own reports. {{F-TEAMS}}" }, { h: "Accountable", p: "The audit log records who sent, changed or voided a document, and who made or revoked an API key. It exports as a CSV, and two-step sign-in can be required for the workspace. {{F-AUDIT}}" }] },
  { t: "cols", id: "cancel", eyebrow: "What happens when you cancel", h2: "Cancel any time. Your plan runs to the end of the period.", cols: [{ h: "From the Billing page", p: "Press Cancel. Your plan stays on to the end of the period you paid for and the page shows the end date. Resume undoes it until then. {{F-PRO}}" }, { h: "After it ends", p: "The workspace moves to Free. You keep read and download access to sent and signed documents, and you can export everything at any time. {{F-FREEPLAN}}" }, { h: "No refunds", p: "Docustay does not give refunds. Nothing further is charged once you cancel. The founders price ends with Pro and does not come back. {{F-FOUNDERS}}" }] },
  { t: "twofig", id: "fee", eyebrow: "The payments fee", h2: "Stripe's fee, and ours.", a: { caption: "FIG. 04 · WHAT YOU PAY", rows: [["Stripe", "Its own fees, charged to your Stripe account as usual"], ["Free and Pay as you go", "Docustay adds 2% on payments taken while signing"], ["Pro and Lifetime", "Docustay adds 0%"]] }, b: { caption: "FIG. 05 · WHERE THE MONEY GOES", rows: [["Signer", "Pays as part of signing"], ["Your Stripe", "Takes the money; Docustay never holds it"], ["Refunds", "Yours, in your own Stripe account"]] } },
]} />
<Sec eyebrow="Plain text" title="Are you an AI agent?" tight><p class="d-fine" style="margin:0">Read <a href="/pricing.md">pricing.md</a>: the same numbers, no styling.</p></Sec>
<Sec eyebrow="What counts" title="Limits, refunds and notice." tight><ul class="counts">{#each counts as c}<li>{c}</li>{/each}</ul></Sec>
<Sec eyebrow="Questions" title="Plain answers." tight><Faq items={faq} /></Sec>
<Closing title="Start sending this afternoon." label="Get started free" href="/signup" keep={[["Features", "/features"], ["Licensing", "/licensing"], ["Trust", "/trust"]]} />
<style>
  .pr { padding-top: 24px; } .plans { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; margin-top: 32px; align-items: stretch; }
  .plan { display: flex; flex-direction: column; gap: 12px; background: #faf8f3; color: #1b1b1b; border-radius: 22px; padding: 28px; box-shadow: 0 30px 60px rgb(60 40 140 / 0.248), inset 0 1px 0 #fff; position: relative; } .plan.hot { outline: 2px solid var(--v-700); box-shadow: 0 0 0 6px rgb(90 58 193 / 0.042), 0 30px 80px rgb(90 58 193 / .45); }
  .pn { margin: 0; font: 600 12px/1 var(--font-mono); letter-spacing: .12em; color: #5e5a52; } .chip { position: absolute; right: 14px; top: 14px; background: #5a3ac1; color: #f4f2ec; padding: 5px 8px; border-radius: 3px; font: 700 10px/1 var(--font-sans); letter-spacing: .1em; transform: rotate(4deg); }
  .pp { margin: 0; font: 600 38px/1.05 var(--font-sans); letter-spacing: -.03em; } .pp span { display: block; font: 500 13px/1.4 var(--font-sans); letter-spacing: 0; color: #5e5a52; margin-top: 4px; } .pl { margin: 0; font-size: 14.5px; line-height: 1.5; color: #4a4740; min-height: 3em; }
  .plan ul { margin: 4px 0 8px; padding: 0 0 0 18px; list-style: disc; display: grid; gap: 7px; font-size: 14.5px; line-height: 1.45; flex: 1; } .plan :global(.d-btn.main) { background: #1b1b1b; color: #f4f2ec; border-color: #1b1b1b; } .plan :global(.d-btn.main:hover) { background: #ece9f6; } .plan :global(.d-btn) { align-self: stretch; text-align: center; justify-content: center; } .plan :global(.d-btn.alt) { color: #1b1b1b; border-color: #1b1b1b; background: transparent; box-shadow: none; }
  .kv { list-style: none; margin: 0; padding: 0; display: grid; } .kv li { display: grid; grid-template-columns: 140px minmax(0, 1fr); gap: 14px; padding: 11px 0; border-top: 1px solid var(--ln-1); font-size: 15px; line-height: 1.5; } .kv li:first-child { border-top: 0; } .kv b { font: 500 11px/1.6 var(--font-mono); letter-spacing: .1em; color: var(--tx-3); } @media (max-width: 600px) { .kv li { grid-template-columns: minmax(0, 1fr); gap: 3px; } }
  .band { display: inline-block; margin: 0 0 18px; padding: 6px 10px; border-radius: 4px; background: #5a3ac1; color: #f4f2ec; font: 600 11px/1 var(--font-mono); letter-spacing: .12em; }
  .tbl { display: grid; } .tr { display: grid; grid-template-columns: minmax(0, 1.5fr) repeat(4, minmax(0, 1fr)); gap: 12px; padding: 12px 0; border-top: 1px solid var(--ln-1); font-size: 15px; line-height: 1.45; } .tr.th { border-top: 0; font: 600 12px/1 var(--font-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--tx-3); } .tr > :first-child { color: var(--tx-1); } .no { font-style: normal; color: var(--tx-3); } .sr { position: absolute; left: -9999px; }
  .counts { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; max-width: 78ch; } .counts li { padding-left: 22px; position: relative; color: var(--tx-2); line-height: 1.6; } .counts li::before { content: ""; position: absolute; left: 0; top: .6em; width: 8px; height: 8px; background: #8585fd; }
  @media (max-width: 1180px) { .plans { grid-template-columns: repeat(2, minmax(0, 1fr)); } } @media (max-width: 640px) { .plans { grid-template-columns: minmax(0, 1fr); } .tr { grid-template-columns: minmax(0, 1.2fr) repeat(4, minmax(0, 1fr)); font-size: 12px; gap: 4px; } }
  .plan h3 { margin: 6px 0 0; font: 600 11px/1 var(--font-mono); letter-spacing: .1em; color: #5e5a52; text-transform: uppercase; } .plan h3 + ul { margin-top: 0; }
  .never { display: flex; flex-wrap: wrap; gap: 10px; list-style: none; margin: 0; padding: 0; } .never li { padding: 8px 14px; border: 1px solid var(--ln-2); border-radius: 999px; font-size: 14.5px; color: var(--tx-1); }
  .pay { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 16px; } .pay li { padding: 16px 0; border-top: 1px solid var(--ln-1); font-size: 15px; line-height: 1.5; color: var(--tx-2); } .pay b { display: block; font: 600 26px/1.1 var(--font-sans); letter-spacing: -.02em; color: var(--tx-1); margin-bottom: 4px; }
  .tbl .grp { grid-template-columns: 1fr; font: 600 12px/1 var(--font-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--tx-3); padding-top: 22px; }
</style>
