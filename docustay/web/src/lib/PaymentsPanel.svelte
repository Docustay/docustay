<script>
  import { live } from "$lib/live.js";
  import { onMount } from "svelte";
  import { api } from "$lib/api.js";
  import { t } from "$lib/i18n/index.svelte.js";
  import Rich from "$lib/i18n/Rich.svelte";
  import { inDemo } from "$lib/pro/plan.svelte.js";
  import { edition } from "$lib/edition.svelte.js";
  let st = $state(null), problem = $state(null), note = $state(null), busy = $state(false);
  const flag = typeof location !== "undefined" ? new URLSearchParams(location.search).get("payments") : null;
  const FLAGS = $derived({ live: t("Stripe is connected and can take payments."), connected: t("Stripe is connected and can take payments."), needs_info: t("Stripe needs more information before payments can start. Continue on Stripe to finish."), pending: t("Stripe needs more information before payments can start. Continue on Stripe to finish."), restricted: t("Stripe needs more information before payments can start. Continue on Stripe to finish."), none: t("Nothing was connected."), declined: t("The connection was cancelled on Stripe's page. Nothing was connected."), error: t("The connection could not be completed. Try again.") });
  const STATE = $derived({ not_connected: t("Not connected"), pending: t("Needs attention"), restricted: t("Needs attention"), live: t("Ready") });   // Pay 1: "Ready" — Docustay checked the account can take payments
  const load = async () => { if (await inDemo()) { st = { state: "not_connected", stripeAvailable: false, connectReady: false, fee: "" }; return; }   // R13-D020: the demo has no Stripe; the call would only answer 403
    const r = await api("/api/product/docustay/payments"); if (r.ok) st = r.json; else problem = r.error ?? t("Payments settings could not be loaded."); };
  onMount(() => live(["billing", "settings"], load));
  onMount(async () => { await load(); if (flag && FLAGS[flag]) note = FLAGS[flag]; if (flag) history.replaceState(null, "", "?tab=payments"); });
  async function connect(method = "hosted") { busy = true; note = null; const r = await api("/api/product/docustay/payments/connect", { method: "POST", body: { method } }); busy = false; if (r.ok && r.json?.url) location.href = r.json.url; else note = r.error ?? t("Stripe could not be reached. Try again."); }
  async function refresh() { busy = true; note = null; const r = await api("/api/product/docustay/payments/refresh", { method: "POST", body: {} }); busy = false; if (r.ok) { await load(); note = FLAGS[r.json?.state] ?? null; } else note = r.error ?? t("Stripe could not be reached. Try again."); }
  async function disconnect() { busy = true; note = null; const r = await api("/api/product/docustay/payments/disconnect", { method: "POST", body: {} }); busy = false; if (r.ok) { await load(); note = t("Disconnected. Your Stripe account itself is untouched — it is still yours."); } else note = r.error ?? t("That did not work. Try again."); }
  import { plan as planStore, loadPlan } from "$lib/pro/plan.svelte.js";
  import { askPreflight, showPlanSheet, report } from "$lib/pro/planPrompt.svelte.js";
  const feeBps = $derived(planStore.data?.plans?.find((p) => p.key === planStore.data?.plan?.key)?.feeBps ?? 0);
  onMount(() => { loadPlan(); });
  async function feeOptions() { const a = await askPreflight("connect_payments"); if (a?.options?.length) { report("prompt_clicked", a, { form: "sheet", option: "see_options" }); showPlanSheet(a); } }
</script>
{#if !edition.selfHost}
<div class="rounded-xl border border-line p-5" data-testid="payments-moved"><h2 class="font-semibold">{t("Payments has moved to Billing")}</h2><p class="mt-2 text-[15px] text-mute">{t("Set up Stripe, see your balance and payouts, and manage payments in Billing, under Payments.")}</p><a class="btn primary mt-3" href="/billing?tab=payments" data-testid="payments-moved-go">{t("Go to Billing, Payments")}</a></div>
{:else if problem}<p class="text-bad" role="alert">{problem}</p>{:else if !st}<p class="text-mute">{t("Loading…")}</p>{:else}
<div class="pg-sections" style="--col: 30rem; --row: 1.5rem" data-testid="payments-panel">
  <section class="rounded-xl border border-line p-5"><h2 class="font-semibold">{t("Take payments while people sign")}</h2>
    <p class="mt-2 text-[15px]"><Rich text={t("Add a payment box to a document and the signer pays in Stripe's own secure box as the last step of signing; the document completes once the payment goes through. The money goes straight to <b>a Stripe account in your name</b>, which you manage in the normal Stripe Dashboard.")} parts={{ b: { strong: true } }} /></p>
    <p class="mt-2 text-[15px]" data-testid="payments-fee"><strong>{st.fee}</strong> {t("Stripe's fees are charged to your Stripe account as usual.")}</p>
    {#if feeBps > 0}<p class="mt-1 text-sm"><button type="button" class="text-brand underline underline-offset-2" onclick={feeOptions} data-testid="payments-fee-options">{t("See how to lower the fee")}</button></p>{/if}
    {#if st.mode === "test"}<p class="mt-3 rounded-lg border border-warn-line bg-warn-bg px-3 py-2 text-sm" data-testid="payments-test-mode"><Rich text={t("This server is in Stripe's <b>test mode</b>: no real card is charged and nothing here moves real money. Stripe's test cards work, for example 4242 4242 4242 4242 with any future date.")} parts={{ b: { strong: true } }} /></p>{/if}
  </section>
  <section class="rounded-xl border border-line p-5"><h2 class="font-semibold">{t("Your Stripe account")}</h2>
    <p class="mt-2 text-[15px]" data-testid="payments-state"><strong>{st.disconnected ? t("Disconnected") : (STATE[st.state] ?? st.state)}</strong>{#if st.account} · {st.account}{/if}</p>
    {#if st.disconnected}<p class="mt-1 text-sm text-mute">{t("Docustay no longer has access to a Stripe account. Documents with a payment box cannot be paid until you connect Stripe again.")}</p>{/if}
    {#if !st.stripeAvailable}<p class="mt-2 text-sm text-mute">{t("Payments are not set up on this server yet.")}</p>
    {:else if st.state === "not_connected" && !st.connectReady}<p class="mt-2 text-sm text-mute" data-testid="payments-not-ready">{t("Connecting is not switched on for this server yet. Ask the person who runs it.")}</p>{/if}
    {#if st.state === "not_connected"}
      <div class="mt-4 grid gap-3 sm:grid-cols-2" data-testid="payments-choices">
        <div class="rounded-lg border border-line p-4"><h3 class="font-medium">{t("Set up payments")} <span class="chip ok ml-1" data-testid="payments-recommended">{t("Recommended")}</span></h3>
          <p class="mt-1 text-sm text-mute">{t("Docustay creates a Stripe account for you on Stripe's own secure form. It takes a few minutes. If you already have a Stripe login, sign in there and Stripe reuses your verified details. This makes a new, separate account; any Stripe account you already have stays untouched.")}</p>
          <button class="btn primary mt-3" disabled={busy || !st.stripeAvailable || !st.connectReady} onclick={() => connect("hosted")} data-testid="payments-connect">{t("Set up payments")}</button></div>
        {#if st.oauthAvailable}
          <div class="rounded-lg border border-line p-4" data-testid="payments-existing"><h3 class="font-medium">{t("I already have a Stripe account")}</h3>
            <p class="mt-1 text-sm text-mute">{t("Sign in to your existing Stripe account and approve the connection. That same account takes the payments, so its customers and history stay where they are. You can disconnect it here at any time.")}</p>
            <button class="btn mt-3" disabled={busy || !st.stripeAvailable || !st.connectReady} onclick={() => connect("oauth")} data-testid="payments-connect-existing">{t("Connect my existing Stripe account")}</button></div>
        {/if}
      </div>
      {#if !st.oauthAvailable}<p class="mt-3 text-sm text-mute" data-testid="payments-what-happens">{t("Already on Stripe? Sign in on the next screen and Stripe will reuse your verified details. This creates a separate payments account for Docustay; your existing Stripe account stays untouched.")}</p>{/if}
    {/if}
    <div class="mt-3 flex flex-wrap gap-2">
      {#if st.state === "pending" || st.state === "restricted"}<button class="btn primary" disabled={busy} onclick={() => connect(st.method === "oauth" ? "oauth" : "hosted")} data-testid="payments-continue">{t("Continue on Stripe")}</button><button class="btn" disabled={busy} onclick={refresh} data-testid="payments-refresh">{t("Check again")}</button>{/if}
      {#if st.state === "live"}<a class="btn" href={`https://dashboard.stripe.com/${st.mode === "test" ? "test/" : ""}dashboard`} target="_blank" rel="noopener" data-testid="payments-dashboard">{t("Open your Stripe dashboard")} →</a>{/if}
      {#if st.state !== "not_connected"}<button class="btn" disabled={busy} onclick={disconnect} data-testid="payments-disconnect">{t("Disconnect")}</button>{/if}
    </div>
    <p class="mt-3 text-sm text-mute" data-testid="payments-receipts">{t("If Stripe already emails receipts for you, signers may get two.")}</p>
    {#if st.state === "live" && !st.chargesOpen}<p class="mt-3 text-sm text-mute">{t("Your account is ready. This server has not opened payments for use yet, so a payment box will say so when someone tries to pay.")}</p>{/if}
  </section>
  {#if note}<p class="pg-wide text-sm" role="status" data-testid="payments-note">{note}</p>{/if}
</div>{/if}
