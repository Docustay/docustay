<script>
  // THE PAYMENTS SETUP WIZARD (Billing > Payments > Set up payments; STRIPE-PAYMENTS-SPEC.md section 2). A focused page with a four-stage ribbon: Before you start, Your details, Verify with Stripe, Payments on.
  // It collects only NON-sensitive details and sends them to Stripe as pre-fill; Stripe's own page collects identity and bank. Progress is saved on the server, so closing the page loses nothing.
  import { onMount } from "svelte";
  import { api } from "$lib/api.js";
  import { t } from "$lib/i18n/index.svelte.js";
  import { inDemo } from "$lib/pro/plan.svelte.js";
  import Seal from "$lib/ui/Seal.svelte";
  import Icon from "$lib/ui/Icon.svelte";
  import { PayCard3D } from "$lib/fx3d/index.js";
  import StripeBadge from "./StripeBadge.svelte";
  const un = (r) => r.json?.data ?? r.json;
  let acct = $state(null), pay = $state(null), step = $state(1), link = $state(null), busy = $state(false), problem = $state(null), loaded = $state(false), demo = $state(false);
  let d = $state({ businessType: "company", name: "", firstName: "", lastName: "", website: "", email: "", purpose: "services" });
  const STAGES = $derived([t("Before you start"), t("Your details"), t("Verify with Stripe"), t("Payments on")]);
  const ready = $derived(acct?.status === "ready" || acct?.status === "paused");
  async function load(fresh = false) {
    if (await inDemo()) { demo = true; loaded = true; return; }
    const [r, p] = await Promise.all([api(`/api/product/docustay/payments/account${fresh ? "?fresh=1" : ""}`), api("/api/product/docustay/payments")]);
    loaded = true; if (p.ok) pay = un(p);
    if (!r.ok) { problem = r.status === 403 ? t("Only Admins and Owners can set up payments.") : (r.error ?? t("This could not be loaded.")); return; }
    acct = un(r);
    const saved = acct.wizard?.details;
    d = { ...d, name: acct.prefill?.name ?? "", email: acct.prefill?.email ?? "", ...Object.fromEntries(Object.entries(saved ?? {}).filter(([, v]) => v !== "" && v != null)) };
    if (ready) step = 4; else if (acct.status === "verifying") step = 4; else if (acct.account && acct.status !== "not_connected" && acct.status !== "disconnected") step = Math.max(3, acct.wizard?.step ?? 3); else step = acct.status === "disconnected" ? 1 : (acct.wizard?.step ?? 1);
  }
  onMount(() => { load(); });
  const save = (s) => api("/api/product/docustay/payments/wizard", { method: "POST", body: { step: s } });
  async function next(to) { step = to; problem = null; void save(to); }
  async function sendDetails() {
    busy = true; problem = null;
    const r = await api("/api/product/docustay/payments/wizard/continue", { method: "POST", body: { details: d } }); busy = false;
    const u = un(r); if (!r.ok) { problem = r.error ?? t("Stripe could not be reached. Try again."); return; }
    if (u?.state === "live") { await load(true); return; }
    link = u?.url ?? null; step = 3;
  }
  async function toStripe() {
    if (link) { location.href = link; return; }
    busy = true; const r = await api("/api/product/docustay/payments/connect", { method: "POST", body: { method: "hosted" } }); busy = false; const u = un(r);
    if (r.ok && u?.url) location.href = u.url; else problem = r.error ?? t("Stripe could not be reached. Try again.");
  }
  async function checkAgain() { busy = true; await api("/api/product/docustay/payments/refresh", { method: "POST", body: {} }); await load(true); busy = false; }
  const cancel = () => { location.href = "/billing?tab=payments"; };
</script>
<section class="wz" aria-label={t("Set up payments")} data-testid="pay-wizard" data-step={step}>
  <header class="top"><h1 class="ttl">{t("Set up payments")}</h1><button class="btn quiet" onclick={cancel} data-testid="wizard-cancel">{t("Cancel")}</button></header>
  <ol class="rib" data-testid="wizard-ribbon" aria-label={t("Setup progress")}>
    {#each STAGES as s, i (s)}<li class:done={i + 1 < step || (i + 1 === 4 && ready)} class:cur={i + 1 === step} aria-current={i + 1 === step ? "step" : undefined}><span class="dot">{#if i + 1 < step || (i + 1 === 4 && ready)}<Icon name="check" size={12} />{:else}{i + 1}{/if}</span><span class="lbl">{s}</span></li>{/each}
  </ol>
  {#if !loaded}<p class="text-mute">{t("Loading…")}</p>
  {:else if demo}<p class="text-mute">{t("The demo has no Stripe account.")}</p>
  {:else if problem && !acct}<p class="text-bad" role="alert" data-testid="wizard-problem">{problem}</p>
  {:else}
    {#if pay && !pay.connectReady && step < 4}<p class="note" data-testid="payments-not-ready">{t("Connecting is not switched on for this server yet. Ask the person who runs it.")}</p>{/if}
    {#if step === 1}
      <div class="cols" data-testid="wizard-step-1">
        <div class="card"><h2 class="h">{t("What you will need")}</h2>
          <ul class="need"><li>{t("A photo ID")}</li><li>{t("A bank account (account and routing number)")}</li><li>{t("Your business number (an EIN), or the last 4 digits of your SSN if you are an individual")}</li><li>{t("About 5 minutes. You can stop and come back any time.")}</li></ul>
          <div class="mt-4 flex flex-wrap items-center gap-3"><button class="btn primary" onclick={() => next(2)} data-testid="wizard-start">{t("Continue")}</button>{#if pay?.oauthAvailable}<a class="lnk" href="/billing?tab=payments" data-testid="wizard-existing">{t("I already have a Stripe account. Connect it instead.")}</a>{/if}</div></div>
        <aside class="card aside"><h2 class="h3">{t("Safe by design")}</h2><ul class="safe"><li>{t("Docustay never sees your ID or bank details. Stripe collects them.")}</li><li>{t("Stripe pays you directly. Docustay never holds your money.")}</li><li>{t("We save your place, so you can leave and come back.")}</li></ul><div class="mt-3" aria-hidden="true"><PayCard3D note="" amount="" /></div><p class="mt-3"><StripeBadge /></p></aside>
      </div>
    {:else if step === 2}
      <div class="cols" data-testid="wizard-step-2">
        <form class="card" onsubmit={(e) => { e.preventDefault(); sendDetails(); }}>
          <h2 class="h">{t("Your details")}</h2><p class="mt-1 text-[14px] text-mute">{t("Stripe will not ask for these again.")}</p>
          <fieldset class="mt-3"><legend class="lab">{t("You are")}</legend><div class="radios"><label><input type="radio" name="bt" value="company" bind:group={d.businessType} data-testid="wizard-company" /> {t("A company")}</label><label><input type="radio" name="bt" value="individual" bind:group={d.businessType} data-testid="wizard-individual" /> {t("An individual")}</label></div></fieldset>
          {#if d.businessType === "company"}<label class="fld"><span class="lab">{t("Business name")}</span><input class="field" bind:value={d.name} autocomplete="organization" data-testid="wizard-name" /></label>
          {:else}<div class="two"><label class="fld"><span class="lab">{t("First name")}</span><input class="field" bind:value={d.firstName} autocomplete="given-name" data-testid="wizard-first" /></label><label class="fld"><span class="lab">{t("Last name")}</span><input class="field" bind:value={d.lastName} autocomplete="family-name" data-testid="wizard-last" /></label></div>{/if}
          <label class="fld"><span class="lab">{t("Website")}</span><input class="field" bind:value={d.website} placeholder="yourbusiness.com" autocomplete="url" data-testid="wizard-website" /></label>
          <label class="fld"><span class="lab">{t("Email")}</span><input class="field" type="email" bind:value={d.email} autocomplete="email" data-testid="wizard-email" /></label>
          <label class="fld"><span class="lab">{t("What will you collect payments for?")}</span><select class="field" bind:value={d.purpose} data-testid="wizard-purpose"><option value="deposits">{t("Deposits and fees")}</option><option value="services">{t("Services")}</option><option value="other">{t("Other")}</option></select></label>
          <p class="fld text-[14px]"><span class="lab">{t("Country")}</span>{t("United States")}</p>
          {#if problem}<p class="mt-3 text-bad" role="alert" data-testid="wizard-problem">{problem}</p>{/if}
          <div class="mt-4 flex gap-2"><button type="button" class="btn" onclick={() => next(1)} data-testid="wizard-back">{t("Back")}</button><button class="btn primary" disabled={busy || (pay && !pay.connectReady)} data-testid="wizard-continue">{t("Continue")}</button></div>
        </form>
        <aside class="card aside"><h2 class="h3">{t("Only the basics")}</h2><p class="text-[14px] text-mute">{t("We never ask for your ID, your birth date, your address or your bank details. Those go to Stripe, on Stripe's own page, in the next step.")}</p></aside>
      </div>
    {:else if step === 3}
      <div class="cols" data-testid="wizard-step-3">
        <div class="card"><h2 class="h">{t("Finish on Stripe's secure page")}</h2><p class="mt-1 text-[14px]">{t("Stripe verifies you and sets up your payouts. It already has the details you just gave us, so it will skip those questions.")}</p>
          <p class="flow" aria-hidden="true"><span>Docustay</span><i>→</i><span>Stripe</span><i>→</i><span>{t("Back to Docustay")}</span></p>
          <h3 class="h3 mt-3">{t("Stripe will ask for")}</h3><ul class="need"><li>{t("Your date of birth and home address")}</li><li>{t("The last 4 digits of your SSN, or your EIN")}</li><li>{t("Your bank account")}</li><li>{t("A photo of your ID, only if Stripe asks")}</li></ul>
          {#if problem}<p class="mt-3 text-bad" role="alert" data-testid="wizard-problem">{problem}</p>{/if}
          <div class="mt-4 flex flex-wrap items-center gap-3"><button class="btn" onclick={() => next(2)}>{t("Back")}</button><button class="btn primary" disabled={busy} onclick={toStripe} data-testid="wizard-to-stripe">{t("Continue on Stripe")}</button><StripeBadge /></div></div>
        <aside class="card aside"><h2 class="h3">{t("Safe by design")}</h2><ul class="safe"><li>{t("Docustay never sees your ID or bank details. Stripe collects them.")}</li><li>{t("Stripe pays you directly.")}</li></ul></aside>
      </div>
    {:else if ready}
      <div class="card done" data-testid="wizard-step-4b"><Seal size={84} stamp /><h2 class="h">{t("Payments are on")}</h2><p class="mt-1 max-w-[46ch] text-center text-[15px]">{t("Stripe has verified you. You can now add a payment box to any document, and signers can pay as they sign.")}</p>
        <ul class="facts"><li>{t("Charges")}: <b>{t("On")}</b></li><li>{t("Payouts to your bank")}: <b>{acct?.panel?.payouts ? t("On") : t("Off")}</b></li><li>{t("Docustay fee")}: <b>{acct?.fee?.percent}%</b></li></ul>
        <div class="mt-4 flex flex-wrap justify-center gap-3"><a class="btn primary" href="/billing?tab=payments" data-testid="wizard-go-payments">{t("Go to Payments")}</a><a class="btn" href="/templates">{t("Add a payment to a template")}</a></div></div>
    {:else}
      <div class="card done" data-testid="wizard-step-4a"><h2 class="h">{t("Stripe is verifying you")}</h2><p class="mt-1 max-w-[50ch] text-center text-[15px]">{t("This usually takes a few minutes, and sometimes up to a day. You do not need to wait here. We will email you the moment it is done.")}</p>
        <ul class="facts"><li>{t("Business")}: <b>{acct?.panel?.business ?? d.name ?? "—"}</b></li><li>{t("Status")}: <b data-testid="wizard-status">{acct?.label ?? "—"}</b></li></ul>
        {#if acct?.attention?.items?.length}<p class="mt-2 text-center text-[14px]">{t("Stripe still needs:")} {acct.attention.items.join("; ")}.</p><button class="btn primary mt-3" onclick={toStripe} data-testid="wizard-to-stripe">{t("Continue on Stripe")}</button>{/if}
        <div class="mt-4 flex flex-wrap justify-center gap-3"><button class="btn" disabled={busy} onclick={checkAgain} data-testid="payments-refresh">{t("Check again")}</button><a class="btn" href="/billing?tab=payments">{t("Close")}</a></div></div>
    {/if}
  {/if}
</section>
<style>
  .wz { display: grid; gap: 18px; min-width: 0; }
  .top { display: flex; align-items: center; justify-content: space-between; gap: 12px; } .ttl { font-size: 22px; font-weight: 600; letter-spacing: -.02em; }
  .rib { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; list-style: none; padding: 0; margin: 0; }
  .rib li { display: flex; align-items: center; gap: 8px; border-top: 3px solid var(--line-strong, #d8d4ea); padding-top: 8px; color: var(--mute); font-size: 13px; } .rib li.cur { border-color: var(--brand); color: var(--ink); font-weight: 600; } .rib li.done { border-color: var(--seal, var(--brand)); color: var(--ink); }
  .dot { display: inline-grid; place-items: center; width: 20px; height: 20px; border-radius: 50%; border: 1.5px solid currentColor; font-size: 11px; flex: none; } .rib li.done .dot { background: var(--seal, var(--brand)); border-color: transparent; color: #fff; }
  .cols { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); gap: 16px; align-items: start; }
  .card { border: 1px solid var(--line); border-radius: 14px; background: var(--card); padding: 22px 24px; min-width: 0; } .aside { background: color-mix(in srgb, var(--brand) 5%, var(--card)); }
  .h { font-size: 19px; font-weight: 600; letter-spacing: -.01em; } .h3 { font-size: 14.5px; font-weight: 600; }
  .need, .safe { display: grid; gap: 8px; margin-top: 10px; padding-left: 18px; list-style: disc; font-size: 14.5px; }
  .fld { display: grid; gap: 5px; margin-top: 12px; } .lab { font-size: 13px; font-weight: 500; color: var(--mute); } .two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .radios { display: flex; flex-wrap: wrap; gap: 18px; margin-top: 6px; font-size: 14.5px; } .radios label { display: inline-flex; align-items: center; gap: 6px; min-height: 36px; }
  .flow { display: flex; align-items: center; gap: 10px; margin: 14px 0; font-size: 13px; } .flow span { border: 1px solid var(--line); border-radius: 8px; padding: 6px 12px; background: var(--card); } .flow i { font-style: normal; color: var(--mute); }
  .done { display: grid; justify-items: center; gap: 4px; text-align: center; padding: 34px 24px; } .facts { display: grid; gap: 4px; margin-top: 12px; font-size: 14px; list-style: none; padding: 0; }
  .note { border-left: 3px solid var(--brand); padding: 4px 12px; font-size: 14px; } .lnk { color: var(--brand); text-decoration: underline; text-underline-offset: 2px; font-size: 14px; }
  @media (max-width: 820px) { .cols, .rib { grid-template-columns: minmax(0, 1fr); } .rib li { border-top-width: 2px; } .rib li:not(.cur) .lbl { display: none; } .two { grid-template-columns: minmax(0, 1fr); } .btn { min-height: 44px; } }
</style>
