<script>
  // THE UPGRADE SHEET (Run 9 board B1): what Free has and what Pro adds, side by side, with the thing the person just tried named at the top and first in Pro's list; monthly or yearly; one
  // button to Stripe's secure checkout. Pressing it plays B2's leaving moment (the Pro card dives through a ring — under a second, the words stay) and then the browser goes to Stripe. Pro
  // switches on only when Stripe confirms (the billing page asks the server on the way back). Mounted once in the signed-in layout. Escape or Close shuts it; focus goes back.
  import { tick } from "svelte";
  import Icon from "$lib/ui/Icon.svelte";
  import { t } from "$lib/i18n/index.svelte.js";
  import { api, money } from "$lib/api.js";
  import { RingDive } from "$lib/fx3d/index.js";
  import { upgradeSheet, closeUpgrade } from "./proSheet.svelte.js";
  import { plan, loadPlan, EXPLORE_PRO_URL } from "./plan.svelte.js";
  let card = $state(null), opener = null, yearly = $state(false), leaving = $state(false), problem = $state(null);
  const TRIED = $derived({
    unlimited_documents: t("More documents"), document_limit: t("More documents"), unlimited_templates: t("More new templates"), template_limit: t("More new templates"), signer_limit: t("More signers"), team_roles: t("Adding your team"),
    custom_plays: t("Your own plays"), plays_api: t("The Plays API"),
  });
  const tried = $derived(upgradeSheet.item ? TRIED[upgradeSheet.item] ?? null : null);
  const up = $derived(plan.data?.upgrade?.plan ?? null);
  const free = $derived((plan.data?.plans ?? []).find((p) => p.key === "docustay_free") ?? null);
  const canYearly = $derived(up?.yearlyPriceMinor != null);
  const priceNow = $derived(up ? (yearly && canYearly ? up.yearlyPriceMinor : up.priceMinor) : null);
  const listNow = $derived(up ? (yearly && canYearly ? up.listYearlyPriceMinor : up.listPriceMinor) : null);
  const PRO = $derived([t("Unlimited documents and templates"), t("Unlimited signers and team members"), t("0% fee on payments"), t("100 AI drafts a month included"), t("Your own plays and playbooks, and the Plays API")]);
  const proList = $derived(tried ? [`${tried} (${t("what you just tried")})`, ...PRO.filter((x) => x !== tried)] : PRO);
  $effect(() => { if (upgradeSheet.open) { opener = document.activeElement; leaving = false; problem = null; loadPlan(); tick().then(() => card?.querySelector("[data-autofocus]")?.focus()); } });
  function close() { closeUpgrade(); tick().then(() => { if (opener instanceof HTMLElement && document.contains(opener)) opener.focus(); }); }
  function key(e) { if (upgradeSheet.open && e.key === "Escape" && !leaving) { e.preventDefault(); close(); } }
  async function go() {
    problem = null; leaving = true;
    try { sessionStorage.setItem("docustay:upgrade-from", location.pathname + location.search); } catch { /* the welcome screen then offers the documents list */ }
    const [r] = await Promise.all([api("/api/product/docustay/checkout", { method: "POST", body: { interval: yearly && canYearly ? "year" : "month" } }), new Promise((ok) => setTimeout(ok, 700))]);
    const url = r.json?.url ?? r.json?.data?.url;
    if (r.ok && url) { window.location.assign(url); return; }
    leaving = false; problem = r.error ?? t("That did not work. Try again.");
  }
</script>
<svelte:window onkeydown={key} />
{#if upgradeSheet.open}
  <div class="fixed inset-0 z-[90] flex items-end justify-center bg-black/40 sm:items-center sm:p-4" role="presentation" onpointerdown={(e) => { if (e.target === e.currentTarget && !leaving) close(); }}>
    <div bind:this={card} class="w-full max-w-[760px] overflow-hidden rounded-t-2xl bg-card text-ink shadow-[0_30px_80px_rgb(30_20_70/.3)] sm:rounded-2xl" role="dialog" aria-modal="true" aria-labelledby="up-title" data-testid="upgrade-sheet">
      {#if leaving}
        <div class="grid place-items-center gap-2 px-6 py-14" data-testid="upgrade-leaving"><RingDive label={t("Taking you to secure checkout")} /></div>
      {:else}
        <div class="flex items-start justify-between gap-3 px-6 pt-5">
          <div>{#if tried}<p class="font-mono text-[11px] uppercase tracking-wider text-brand" data-testid="upgrade-tried">{t("You tried: {thing}", { thing: tried })}</p>{/if}
            <h2 id="up-title" class="mt-1 text-xl font-semibold">{t("Do more with Docustay Pro")}</h2><p class="mt-0.5 text-sm text-mute">{t("One flat price for the whole workspace, with unlimited team members. Or pay as you go, or once for Lifetime, in Billing.")}</p></div>
          <button type="button" class="btn quiet !min-h-9 !px-2" aria-label={t("Close")} onclick={close} data-testid="upgrade-close"><Icon name="close" size={16} /></button>
        </div>
        {#if canYearly}<div class="mx-6 mt-3 inline-flex rounded-full border border-line p-0.5 text-sm" role="group" aria-label={t("How often to pay")}><button type="button" class="rounded-full px-3 py-1 {yearly ? '' : 'bg-brand text-white'}" aria-pressed={!yearly} onclick={() => (yearly = false)} data-testid="upgrade-monthly">{t("Monthly")}</button><button type="button" class="rounded-full px-3 py-1 {yearly ? 'bg-brand text-white' : ''}" aria-pressed={yearly} onclick={() => (yearly = true)} data-testid="upgrade-yearly">{t("Yearly")}</button></div>{/if}
        <div class="grid gap-4 px-6 py-4 sm:grid-cols-2">
          <section class="rounded-xl border border-line p-4" aria-label={t("Free")}><p class="font-semibold">{t("Free")} <span class="text-sm font-normal text-mute">· {t("your plan")}</span></p><p class="mt-1 text-2xl font-semibold">{money(0)}</p>
            <ul class="mt-3 space-y-1.5 text-sm text-mute">{#if free?.docsPerMonth != null}<li>{t("{n} documents a month", { n: free.docsPerMonth })}</li>{/if}{#if free?.templatesPerMonth != null}<li>{t("{n} new templates a month", { n: free.templatesPerMonth })}</li>{/if}<li>{t("10 AI drafts a month")}</li><li>{t("2% fee on payments")}</li></ul></section>
          <section class="rounded-xl border-2 border-brand p-4" aria-label={t("Pro")} data-testid="upgrade-pro"><p class="flex items-center gap-2 font-semibold">{t("Pro")}{#if up?.founders}<span class="rounded-full bg-brand-soft px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-brand">{t("Founders price")}</span>{/if}</p>
            {#if priceNow != null}<p class="mt-1 text-2xl font-semibold" data-testid="upgrade-price">{money(priceNow)} <span class="text-sm font-normal text-mute">{yearly && canYearly ? t("a year") : up?.founders ? t("a month, for life") : t("a month")}</span>{#if up?.founders && listNow != null && listNow !== priceNow}<span class="ml-1 text-sm font-normal text-mute line-through">{money(listNow)}</span>{/if}</p>{/if}
            {#if up?.founders && up.foundersUntil}<p class="text-xs text-mute">{t("Founders price open until {date}", { date: new Date(up.foundersUntil).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) })}</p>{/if}
            <ul class="mt-3 space-y-1.5 text-sm">{#each proList as x, i}<li class="flex gap-2 {i === 0 && tried ? 'font-semibold' : ''}"><span class="text-brand" aria-hidden="true"><Icon name="check" size={14} /></span>{x}</li>{/each}</ul></section>
        </div>
        {#if problem}<p class="mx-6 text-sm text-bad" role="alert" data-testid="upgrade-problem">{problem}</p>{/if}
        <div class="flex flex-wrap items-center gap-3 border-t border-line px-6 py-4">
          <button class="btn primary" data-autofocus disabled={!up || plan.data?.billing?.canUpgrade !== true} onclick={go} data-testid="upgrade-go">{t("Continue to secure checkout")}</button>
          <span class="text-xs text-mute">{t("Paid on Stripe's secure page")} · {t("Cancel any time")}</span>
          <a class="ml-auto text-sm text-brand" href={EXPLORE_PRO_URL} target="_blank" rel="noopener">{t("See everything on the pricing page")} →</a>
        </div>
      {/if}
    </div>
  </div>
{/if}
