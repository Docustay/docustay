<script> import Blocks from "$lib/site/desk/Blocks.svelte"; import { DEV_ADD } from "$lib/site/pages/pass3-dev.js"; import Hero from "$lib/site/Hero.svelte"; import Cta from "$lib/site/Cta.svelte";
  import { dollars, SELFHOST_PRO_YEARLY_MINOR, COMMERCIAL_FROM_MINOR } from "$lib/site/plans.js";
  import { api } from "$lib/api.js";
  let email = $state(""), busy = $state(false), problem = $state(null);
  const bought = typeof location !== "undefined" && new URLSearchParams(location.search).get("bought") === "1";
  async function buy() { busy = true; problem = null; const r = await api("/api/public/docustay/selfhost/checkout", { method: "POST", body: { email: email.trim() } }); busy = false; if (r.ok && r.json?.url) location.assign(r.json.url); else problem = r.error ?? "That could not be started — try again shortly."; }
  let file = $state(null), sent = $state(null), upProblem = $state(null);
  async function upload() {
    upProblem = null; sent = null; if (!file) return;
    let report; try { report = JSON.parse(await file.text()); } catch { upProblem = "That file is not readable — choose the .json file you downloaded from Settings."; return; }
    busy = true; const r = await api("/api/public/docustay/usage-report", { method: "POST", body: { report } }); busy = false;
    if (r.ok) sent = "Thank you — your report was received."; else upProblem = r.error ?? "That report could not be accepted.";
  }
</script>
<svelte:head><title>Self-host | Docustay</title><meta name="description" content="Run Docustay on your own server under the AGPL-3.0: your database, your email, your files. Community is free, Self-host Pro is $390 a year per install, and a commercial licence covers embedding and resale." /></svelte:head>
<Hero eyebrow="SELF-HOST" title="Run Docustay on your own server" lede="The same software as the hosted service, on a machine you control. Licensed under the AGPL-3.0." />
<section class="tiers" aria-label="The three ways to run it">
  <article><p class="eyebrow">Community</p><p class="t-xl">Free</p><p>Unlimited documents and templates, with no monthly limits. Everything in the hosted Free plan, on your server.</p></article>
  <article id="licence"><p class="eyebrow">Self-host Pro</p><p class="t-xl">{dollars(SELFHOST_PRO_YEARLY_MINOR)}<span class="per"> a year</span></p><p>Per install, for your own business. Unlocks the Pro items. Not for embedding in a product or for resale.</p></article>
  <article><p class="eyebrow">Commercial licence</p><p class="t-xl">From about {dollars(COMMERCIAL_FROM_MINOR)}<span class="per"> a year</span></p><p>Embed, white-label, resell, or keep a private fork without publishing it. <a href="/contact">Contact us</a>.</p></article>
</section>
<section class="install"><h2 class="t-h2">Start in three commands</h2>
  <pre tabindex="0"><code>cd docustay
./init.sh
docker compose up -d</code></pre><p class="mute">Then open <code>http://localhost:8080/setup</code> and enter the setup token <code>init.sh</code> printed. The install files are in the repository's <code>docustay</code> folder; the repository's address is shown here when it is published.</p></section>
<section class="inside"><h2 class="t-h2">What is inside</h2>
  <div class="tw" data-lenis-prevent-wheel tabindex="0" role="region" aria-label="The six containers, scrolls sideways on a small screen"><table><thead><tr><th scope="col">Container</th><th scope="col">What it does</th></tr></thead><tbody><tr><th scope="row">Database</th><td>PostgreSQL 16, with row-level security on every table that holds workspace data</td></tr><tr><th scope="row">File store</th><td>Keeps signed PDFs (S3-compatible)</td></tr><tr><th scope="row">PDF converter</th><td>Gotenberg, which draws template and text-built documents as PDF pages</td></tr><tr><th scope="row">App</th><td>The API (reachable only from the other containers)</td></tr><tr><th scope="row">Web app</th><td>Every screen: sign-in, documents, templates, settings and signing. The only container that is reachable from outside</td></tr><tr><th scope="row">Worker</th><td>Sends email, runs reminders, seals documents</td></tr></tbody></table></div>
  <p class="mute">There is nothing of ours in it: every key and certificate is created on your machine the first time it starts. Once a day it sends an anonymous usage ping (a random install id, the version and five counts, never content). Switch it off with <code>DOCUSTAY_TELEMETRY=off</code>, or send a report by hand. Pro is a closed add-on: your install downloads it with your licence key the first time it starts (the key is checked on our side, and the download is for your install only), then checks the licence once a day and keeps working up to 30 days offline. When the licence ends the install is the Community build again and nothing is deleted.</p></section>
<section class="buy"><h2 class="t-h2">Self-host Pro</h2><p>The Pro items on your server are {dollars(SELFHOST_PRO_YEARLY_MINOR)} a year per install, for use in your own business: unlimited documents, reminders, bulk send, team roles and no Docustay footer. Pay once a year; your licence key arrives by email, covers one install and renews itself while the subscription is paid. It does not cover embedding Docustay in a product you sell, white-labelling or resale: those need a <a href="/licensing">commercial licence</a>.</p>
    {#if bought}<p class="mt-3 rounded-lg bg-tint p-3 text-sm" role="status">Thank you. Your licence key is on its way to the email address you paid with — it is shown only in that email.</p>{/if}
    <form class="mt-3 flex flex-wrap gap-2" onsubmit={(e) => { e.preventDefault(); buy(); }}><input class="field !w-72 !py-1.5" type="email" required placeholder="Email for the licence key" bind:value={email} aria-label="Email for the licence key" data-testid="selfhost-email" /><button class="btn primary" disabled={busy || !email.trim()} data-testid="selfhost-buy">Buy a licence — {dollars(SELFHOST_PRO_YEARLY_MINOR)} a year</button></form>
    {#if problem}<p class="mt-2 text-sm text-bad" role="alert">{problem}</p>{/if}</section>
<section class="report"><h2 class="t-h3">Send a usage report</h2><p class="text-sm text-mute">If your install cannot reach us, it can still be counted: in the install go to Settings → Usage report, download the file, and upload it here. It holds five whole numbers, a random install id and the version — nothing about your documents or people.</p>
    <form class="mt-3 flex flex-wrap items-center gap-2" onsubmit={(e) => { e.preventDefault(); upload(); }}><input type="file" accept=".json,application/json" onchange={(e) => (file = e.currentTarget.files?.[0] ?? null)} aria-label="Usage report file" data-testid="report-file" /><button class="btn" disabled={busy || !file} data-testid="report-send">Send the report</button></form>
    {#if sent}<p class="mt-2 text-sm" role="status" data-testid="report-ok">{sent}</p>{/if}{#if upProblem}<p class="mt-2 text-sm text-bad" role="alert">{upProblem}</p>{/if}</section>
<Blocks blocks={DEV_ADD["/self-host"]} />
<Cta title="Not sure which licence you need?" text="The Licensing page says in plain words what each one allows." href="/licensing" label="Read about licensing" keep={[["Ask about a commercial licence", "/contact"], ["Open source", "/open-source"], ["Pricing", "/pricing"]]} />
<style>
  .tiers, .install, .inside, .buy, .report { width: min(1152px, 100% - 48px); margin-inline: auto; } .tiers { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; margin-top: 30px; }
  .tiers article { padding: 24px; border-radius: 6px; background: #131315; border: 1px solid #2a2a2c; display: flex; flex-direction: column; gap: 10px; } .tiers article:nth-child(2) { border-color: #8585fd; } .tiers p { color: #a8a39a; line-height: 1.55; margin: 0; } .tiers .eyebrow { font: 500 11px/1 var(--font-mono); letter-spacing: .12em; text-transform: uppercase; } .tiers .t-xl { font: 600 34px/1.1 var(--font-sans); letter-spacing: -.03em; color: #f4f2ec; } .per { font: 500 14px/1 var(--font-sans); color: #a8a39a; letter-spacing: 0; }
  .install, .inside, .buy, .report { margin-top: 64px; } .install, .inside, .buy, .report { max-width: 860px; margin-left: max(24px, calc((100% - 1152px) / 2)); } h2 { font: 600 28px/1.15 var(--font-sans); letter-spacing: -.02em; }
  pre { margin: 16px 0 0; padding: 18px 20px; overflow-x: auto; border-radius: 6px; background: #0f0f11; border: 1px solid #2a2a2c; color: #e6e2d8; line-height: 1.7; font-family: var(--font-mono); font-size: 13.5px; } .mute { margin-top: 14px; color: #a8a39a; line-height: 1.65; } code { font-family: var(--font-mono); }
  .tw { margin-top: 16px; overflow-x: auto; border-radius: 6px; border: 1px solid #2a2a2c; background: #131315; } table { width: 100%; border-collapse: collapse; min-width: 30rem; } th, td { text-align: left; padding: 12px 16px; border-top: 1px solid #222224; } tbody th { width: 11rem; }
  @media (max-width: 899px) { .tiers { grid-template-columns: 1fr; } }
</style>
