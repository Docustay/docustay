<script>
  import { live } from "$lib/live.js";
  import { onMount } from "svelte";
  import { api } from "$lib/api.js";
  import { t } from "$lib/i18n/index.svelte.js";
  import Rich from "$lib/i18n/Rich.svelte";
  let st = $state(null), problem = $state(null), note = $state(null), busy = $state(false);
  const flag = typeof location !== "undefined" ? new URLSearchParams(location.search).get("payments") : null;
  const FLAGS = $derived({ live: t("Stripe is connected and can take payments."), connected: t("Stripe is connected and can take payments."), needs_info: t("Stripe needs more information before payments can start. Continue on Stripe to finish."), pending: t("Stripe needs more information before payments can start. Continue on Stripe to finish."), restricted: t("Stripe needs more information before payments can start. Continue on Stripe to finish."), none: t("Nothing was connected."), declined: t("The connection was cancelled on Stripe's page. Nothing was connected."), error: t("The connection could not be completed. Try again.") });
  const STATE = $derived({ not_connected: t("Not connected"), pending: t("Needs attention"), restricted: t("Needs attention"), live: t("Ready") });   // Pay 1: "Ready" — Docustay checked the account can take payments
  const load = async () => { const r = await api("/api/product/docustay/payments"); if (r.ok) st = r.json; else problem = r.error ?? t("Payments settings could not be loaded."); };
  onMount(() => live(["billing", "settings"], load));
  onMount(async () => { await load(); if (flag && FLAGS[flag]) note = FLAGS[flag]; if (flag) history.replaceState(null, "", "?tab=payments"); });
  async function connect() { busy = true; note = null; const r = await api("/api/product/docustay/payments/connect", { method: "POST", body: {} }); busy = false; if (r.ok && r.json?.url) location.href = r.json.url; else note = r.error ?? t("Stripe could not be reached. Try again."); }
  async function refresh() { busy = true; note = null; const r = await api("/api/product/docustay/payments/refresh", { method: "POST", body: {} }); busy = false; if (r.ok) { await load(); note = FLAGS[r.json?.state] ?? null; } else note = r.error ?? t("Stripe could not be reached. Try again."); }
  async function disconnect() { busy = true; note = null; const r = await api("/api/product/docustay/payments/disconnect", { method: "POST", body: {} }); busy = false; if (r.ok) { await load(); note = t("Disconnected. Your Stripe account itself is untouched — it is still yours."); } else note = r.error ?? t("That did not work. Try again."); }
</script>
{#if problem}<p class="text-bad" role="alert">{problem}</p>{:else if !st}<p class="text-mute">{t("Loading…")}</p>{:else}
<div class="max-w-3xl space-y-6" data-testid="payments-panel">
  <section class="rounded-xl border border-line p-5"><h2 class="font-semibold">{t("Take payments while people sign")}</h2>
    <p class="mt-2 text-[15px]"><Rich text={t("Add a payment box to a document and the signer pays in Stripe's own secure box as the last step of signing; the document completes once the payment goes through. The money goes straight to <b>a Stripe account in your name</b>, which you manage in the normal Stripe Dashboard.")} parts={{ b: { strong: true } }} /></p>
    <p class="mt-2 text-[15px]" data-testid="payments-fee"><strong>{st.fee}</strong> {t("Stripe's fees are charged to your Stripe account as usual.")}</p>
    {#if st.mode === "test"}<p class="mt-3 rounded-lg border border-warn-line bg-warn-bg px-3 py-2 text-sm" data-testid="payments-test-mode"><Rich text={t("This server is in Stripe's <b>test mode</b>: no real card is charged and nothing here moves real money. Stripe's test cards work, for example 4242 4242 4242 4242 with any future date.")} parts={{ b: { strong: true } }} /></p>{/if}
  </section>
  <section class="rounded-xl border border-line p-5"><h2 class="font-semibold">{t("Your Stripe account")}</h2>
    <p class="mt-2 text-[15px]" data-testid="payments-state"><strong>{st.disconnected ? t("Disconnected") : (STATE[st.state] ?? st.state)}</strong>{#if st.account} · {st.account}{/if}</p>
    {#if st.disconnected}<p class="mt-1 text-sm text-mute">{t("Docustay no longer has access to a Stripe account. Documents with a payment box cannot be paid until you connect Stripe again.")}</p>{/if}
    {#if !st.stripeAvailable}<p class="mt-2 text-sm text-mute">{t("Payments are not set up on this server yet.")}</p>
    {:else if st.state === "not_connected" && !st.connectReady}<p class="mt-2 text-sm text-mute" data-testid="payments-not-ready">{t("Connecting is not switched on for this server yet. Ask the person who runs it.")}</p>{/if}
    <div class="mt-3 flex flex-wrap gap-2">
      {#if st.state === "not_connected"}<button class="btn primary" disabled={busy || !st.stripeAvailable || !st.connectReady} onclick={connect} data-testid="payments-connect">{t("Connect Stripe")}</button>{/if}
      {#if st.state === "pending" || st.state === "restricted"}<button class="btn primary" disabled={busy} onclick={connect} data-testid="payments-continue">{t("Continue on Stripe")}</button><button class="btn" disabled={busy} onclick={refresh} data-testid="payments-refresh">{t("Check again")}</button>{/if}
      {#if st.state !== "not_connected"}<button class="btn" disabled={busy} onclick={disconnect} data-testid="payments-disconnect">{t("Disconnect")}</button>{/if}
    </div>
    <p class="mt-3 text-sm text-mute" data-testid="payments-what-happens"><Rich text={t("<b>What Connect Stripe does:</b> it creates a <em>new</em> Stripe account for your business through Stripe's own sign-up page. If you already have a Stripe login you can sign in with it, and Stripe may offer to reuse your verified business details, but the new account is separate: the history of an account you already have does not move into it. Disconnecting stops Docustay using the account. Docustay never deletes it; it stays in your Stripe login.")} parts={{ b: { strong: true }, em: { em: true } }} /></p>
    {#if st.state === "live" && !st.chargesOpen}<p class="mt-3 text-sm text-mute">{t("Your account is ready. This server has not opened payments for use yet, so a payment box will say so when someone tries to pay.")}</p>{/if}
  </section>
  {#if note}<p class="text-sm" role="status" data-testid="payments-note">{note}</p>{/if}
</div>{/if}
