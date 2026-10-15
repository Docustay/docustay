<script>
  let { embedded = false } = $props();   // Launch step 7: shown inside another screen (Documents, Plays, Billing), which owns the page title
  // BILLING (Run 9 boards Pay 4, B2–B5; Part 2 decisions: Pro billing). Free: what this month used, the Pro card and how upgrading works. Back from Stripe (B2): the server re-reads the checkout
  // and Pro switches on only when Stripe confirms — the page waits, and says so after 20 seconds. Then Welcome to Pro (B3). On Pro (B4): the plan, the next payment, the card on file, what the
  // 0% fee saved this month, usage and the invoices — all read from Stripe. A failed payment (B5) only says to update the card; cancelling keeps Pro to the end of what was paid, and Resume
  // undoes it. Stripe's own portal stays one click away for everything else.
  import PageSkel from "$lib/ui/PageSkel.svelte";
  import TemplateUsage from "$lib/pro/TemplateUsage.svelte";
  import AiUsageBar from "$lib/ai/AiUsageBar.svelte";
  import StatTile from "$lib/ui/StatTile.svelte";
  import Icon from "$lib/ui/Icon.svelte";
  import { live } from "$lib/live.js";
  import { onMount } from "svelte";
  import { api, money } from "$lib/api.js";
  import { t, whenText } from "$lib/i18n/index.svelte.js";
  import PageHeader from "$lib/ui/PageHeader.svelte"; import ApiCall from "$lib/ui/ApiCall.svelte";
  import { ProCard3D, CardTurn, Coin } from "$lib/fx3d/index.js";
  import { openUpgrade } from "$lib/pro/proSheet.svelte.js";
  import { loadPlan, EXPLORE_PRO_URL } from "$lib/pro/plan.svelte.js";
  let st = $state(null), problem = $state(null), busy = $state(false), details = $state(null);
  let bEmail = $state(""), bSaved = $state(null), bBusy = $state(false), bMsg = $state(null);   // the workspace's separate billing email (receipts and billing emails also go here)
  const loadBillingEmail = async () => { const r = await api("/api/product/docustay/billing-email", { method: "POST", body: {} }); if (r.ok) { bSaved = un(r).email ?? null; bEmail = bSaved ?? ""; } };
  async function saveBillingEmail() { bBusy = true; bMsg = null; const r = await api("/api/product/docustay/billing-email", { method: "POST", body: { email: bEmail.trim() } }); bBusy = false; if (!r.ok) { bMsg = { bad: true, text: r.error ?? t("That did not work. Try again.") }; return; } bSaved = un(r).email ?? null; bEmail = bSaved ?? ""; bMsg = { bad: false, text: bSaved ? t("Saved. Receipts and billing emails also go to {email}.", { email: bSaved }) : t("Removed. Billing emails go to the workspace owners only.") }; }
  let confirming = $state(null), slow = $state(false), welcome = $state(false), lastCard = $state(null), turned = $state(false);
  const un = (r) => r.json?.data ?? r.json;
  const onPro = $derived(st?.plan?.key === "docustay_pro" && !st?.plan?.ended);
  const loadB = async () => {
    const d0 = await loadPlan({ force: true }); if (d0) st = d0; else { const why = await api("/api/product/docustay/status"); problem = why.status === 403 && why.error ? why.error : t("Could not load your plan."); }   // Run 10 (R10-49): a member was told "Could not load your plan." — a refusal by rank now says so, in the app's existing words (You do not have permission to do that. Ask an owner or an admin.)   // the one shared plan read (concurrent callers share the one request — the layout, this page and the billing notice were three identical calls)
    if (st?.billing?.canManage) { const d = await api("/api/product/docustay/billing-details"); if (d.ok) { const nd = un(d); if (lastCard && nd.card && (nd.card.last4 !== lastCard.last4 || nd.card.expYear !== lastCard.expYear)) turned = true; details = nd; lastCard = nd.card ?? lastCard; } }
  };
  onMount(() => {
    const q = new URLSearchParams(location.search);
    if (q.get("upgrade") === "success" && q.get("session")) { confirming = q.get("session"); history.replaceState(null, "", "/billing"); confirm(Date.now()); }
    else if (q.get("upgrade") === "cancelled") { history.replaceState(null, "", "/billing"); }
    loadB(); loadBillingEmail(); return live(["billing"], loadB);
  });
  // B2 · back in Docustay: ask the server (which asks Stripe) until Stripe says paid. After 20 seconds the words change; the asking goes on in the background.
  async function confirm(started) {
    if (!confirming) return;
    const r = await api("/api/product/docustay/checkout/confirm", { method: "POST", body: { sessionId: confirming } });
    const out = r.ok ? un(r) : null;
    if (out?.confirmed) { confirming = null; slow = false; welcome = true; await loadB(); return; }
    if (!r.ok && r.status && r.status < 500) { confirming = null; problem = r.error ?? t("That checkout could not be confirmed."); return; }
    if (out?.status === "expired") { confirming = null; problem = t("The checkout expired before it was paid. Nothing was charged."); return; }
    if (Date.now() - started > 20000) slow = true;
    setTimeout(() => confirm(started), Date.now() - started > 20000 ? 5000 : 2000);
  }
  function backTo() { let to = "/documents"; try { to = sessionStorage.getItem("docustay:upgrade-from") || to; sessionStorage.removeItem("docustay:upgrade-from"); } catch { /* the documents list */ } location.assign(to.startsWith("/billing") ? "/documents" : to); }
  async function go(path, body = {}) { busy = true; problem = null; const r = await api(path, { method: "POST", body }); busy = false; const url = r.json?.url ?? r.json?.data?.url; if (r.ok && url) window.location.assign(url); else problem = r.error ?? t("That did not work. Try again."); }
  async function act(path, body = {}) { busy = true; problem = null; const r = await api(path, { method: "POST", body }); busy = false; if (r.ok) { st = un(r) ?? st; await loadB(); } else problem = r.error ?? t("That did not work. Try again."); }
  const day = (iso) => whenText(iso, { dateStyle: "medium", timeZone: "UTC" });
  // Run 10 (R10-24): the failed-payment card said "Card expired" for any decline; it says so only when the card really is past its date
  const cardIsExpired = (c) => { const m = /(\d{1,2})\s*\/\s*(\d{2,4})/.exec(cardText(c) ?? ""); if (!m) return false; const y = Number(m[2]) < 100 ? 2000 + Number(m[2]) : Number(m[2]); const now = new Date(); return y < now.getUTCFullYear() || (y === now.getUTCFullYear() && Number(m[1]) < now.getUTCMonth() + 1); };
  const cardText = (c) => (c ? `•••• ${c.last4 ?? ""} · ${String(c.expMonth ?? "").padStart(2, "0")}/${String(c.expYear ?? "").slice(-2)}` : "");
</script>
{#if problem}<p class="mt-4 max-w-xl rounded-lg border border-bad-line bg-bad-bg px-3 py-2 text-sm text-bad" role="alert" data-testid="billing-problem">{problem}</p>{/if}

{#if confirming}
  <!-- B2 · 3: waiting for Stripe's word -->
  <section class="mt-8 grid max-w-xl justify-items-start gap-3" data-testid="billing-confirming"><Coin label={t("Confirming your payment")} size={52} testid="billing-coin" />
    <p class="text-sm text-mute">{slow ? t("This is taking longer than usual. You can keep working; we'll tell you the moment it's done.") : t("Pro switches on as soon as Stripe confirms the payment.")}</p></section>
{:else if welcome}
  <!-- B3 · Welcome to Pro -->
  <section class="mt-6 grid max-w-3xl gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] md:items-center" data-testid="billing-welcome">
    <ProCard3D><p class="font-mono text-[11px] uppercase tracking-wider opacity-80">{t("Payment confirmed")}</p><p class="mt-2 text-3xl font-semibold">Pro</p>{#if st?.plan?.founders}<p class="mt-1 text-sm opacity-90">{t("Founders price")}</p>{/if}</ProCard3D>
    <div><h2 class="text-2xl font-semibold">{t("Welcome to Pro")}</h2><p class="mt-2 text-[15px] text-mute">{t("Everything below is switched on for your whole workspace, right now. Your receipt is on its way to your email.")}</p>
      <ul class="mt-4 space-y-2 text-[15px]">{#each [t("Think harder"), t("Unlimited documents and templates"), t("0% fee on payments"), t("Send to a list, your own plays and playbooks"), t("Your own signing domain, no Docustay footer")] as x}<li class="flex gap-2"><span class="text-brand" aria-hidden="true"><Icon name="check" size={16} /></span>{x}</li>{/each}</ul>
      <div class="mt-5 flex flex-wrap gap-3"><button class="btn primary" onclick={backTo} data-testid="welcome-back">{t("Back to what I was doing")}</button><a class="btn quiet" href={EXPLORE_PRO_URL} target="_blank" rel="noopener">{t("See everything Pro adds")}</a></div></div>
  </section>
{:else if st?.plan}
  {#if st.paymentProblem || st.plan.ended === "payment"}
    <!-- B5 · a failed payment: one short sentence, nothing about how long Pro stays -->
    <section class="mt-6 flex max-w-3xl flex-wrap items-center gap-5 rounded-2xl border border-bad-line bg-bad-bg p-5" data-testid="billing-failed">
      {#if details?.card}<CardTurn last4={lastCard?.last4 ?? details.card.last4} exp={cardText(lastCard ?? details.card).split(" · ")[1] ?? ""} newLast4={details.card.last4} newExp={cardText(details.card).split(" · ")[1] ?? ""} {turned} expiredLabel={cardIsExpired(lastCard ?? details.card) ? t("Card expired") : t("Declined")} />{/if}
      <div class="min-w-0 flex-1"><p class="font-medium text-bad">{t("Your last payment didn't go through.")}</p>{#if turned}<p class="mt-1 text-sm">{t("New card saved.")}</p>{/if}</div>
      {#if st.billing.canManage}<button class="btn primary" disabled={busy} onclick={() => go("/api/product/docustay/portal")} data-testid="billing-update-card">{t("Update card")}</button>{/if}
    </section>
  {:else if st.plan.ended === "cancelled"}<p class="mt-6 text-sm text-mute" data-testid="billing-ended">{t("Your Pro subscription has ended. You can start it again at any time.")}</p>{/if}

  {#if onPro}
    <!-- B4 · Billing on Pro -->
    <p class="mt-2 text-mute" data-testid="billing-on-pro">{st.plan.founders ? t("You're on Pro. Thanks for being a founder.") : t("You're on Pro.")}</p>
    <section class="strip mt-5" aria-label={t("Your plan")} data-testid="billing-strip">
      <div class="min-w-0"><div class="font-mono text-[.7rem] uppercase tracking-wider text-faint">{t("Your plan")}</div><div class="mt-1 text-lg font-semibold">{t("Pro")}{details?.nextPayment ? ` · ${money(details.nextPayment.amountMinor, details.nextPayment.currency)} ${details.nextPayment.interval === "year" ? t("a year") : t("a month")}` : ""}</div>
        {#if st.plan.founders}<div class="text-xs text-mute">{t("Founders price, kept for the life of your subscription")}</div>{/if}</div>
      <div class="min-w-0"><div class="font-mono text-[.7rem] uppercase tracking-wider text-faint">{st.plan.cancelsAt ? t("Pro ends") : t("Next payment")}</div><div class="mt-1 text-lg font-semibold" data-testid="billing-next">{st.plan.cancelsAt ? day(st.plan.cancelsAt) : details?.nextPayment ? `${day(details.nextPayment.at)} · ${money(details.nextPayment.amountMinor, details.nextPayment.currency)}` : st.plan.renewsAt ? day(st.plan.renewsAt) : "—"}</div></div>
      <div class="min-w-0"><div class="font-mono text-[.7rem] uppercase tracking-wider text-faint">{t("Card on file")}</div><div class="mt-1 text-lg font-semibold tabular-nums" data-testid="billing-card">{details?.card ? cardText(details.card) : "—"}</div>
        {#if st.billing.canManage}<button class="text-xs text-brand underline" disabled={busy} onclick={() => go("/api/product/docustay/portal")} data-testid="billing-portal">{t("Update your card in the billing portal")} →</button>{/if}</div>
      <StatTile label={t("Saved in fees this month")} value={details ? money(details.savedThisMonth.minor, details.savedThisMonth.currency) : "—"} delta={t("The 2% Docustay fee you'd have paid on Free. Stripe's own fees still apply.")} />
    </section>
    {#if st.plan.cancelsAt}
      <section class="mt-5 flex max-w-3xl flex-wrap items-center gap-4 rounded-2xl border border-line bg-card p-5" data-testid="billing-cancelled">
        <div class="min-w-0 flex-1"><p class="font-medium">{t("Pro ends on {date}", { date: day(st.plan.cancelsAt) })}</p><p class="mt-1 text-sm text-mute">{t("Changed your mind? Resume Pro keeps everything as it was.")}</p></div>
        <button class="btn primary" disabled={busy} onclick={() => act("/api/product/docustay/resume")} data-testid="billing-resume">{t("Resume Pro")}</button></section>
    {/if}
  {:else if !st.plan.ended}
    <!-- Pay 4 · Billing on Free -->
    <p class="mt-2 text-mute" data-testid="billing-on-free">{t("You're on Free. Resets on {date}.", { date: st.usage?.resetsAt ? day(st.usage.resetsAt) : "—" })}</p>
  {/if}

  <section class="strip mt-5" aria-label={t("This month")} data-testid="billing-usage">
    {#if st.usage}<StatTile label={t("Documents this month (forms count too)")} value={st.usage.documentsLimit == null ? t("Unlimited") : t("{used} of {limit}", { used: st.usage.documentsThisMonth, limit: st.usage.documentsLimit })} tone={st.usage.documentsLimit != null && st.usage.documentsThisMonth >= st.usage.documentsLimit ? "bad" : ""} />
      <StatTile label={t("New templates this month")} value={st.usage.templatesLimit == null ? t("Unlimited") : t("{used} of {limit}", { used: st.usage.templatesThisMonth, limit: st.usage.templatesLimit })} />{/if}
    <div class="min-w-0" data-testid="billing-ai"><AiUsageBar compact /></div>
  </section>
  {#if st.usage?.templatesLimit != null}<div class="mt-4 max-w-xl" data-testid="billing-templates"><TemplateUsage /></div>{/if}
  {#if st.seats}<p class="mt-3 text-sm text-mute">{t("{count} of {included} included seats are in use.", { count: st.seats.used, included: st.seats.included })}{#if st.seats.extraSeatPriceMinor != null} {t("Each extra seat is {price} a month.", { price: money(st.seats.extraSeatPriceMinor) })}{/if}</p>{/if}

  {#if !onPro && st.billing.canUpgrade && st.upgrade.plan}
    <section class="mt-6 grid max-w-4xl gap-6 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]" data-testid="billing-pro-card">
      <ProCard3D><p class="font-mono text-[11px] uppercase tracking-wider opacity-80">Docustay Pro</p><p class="mt-2 text-4xl font-semibold">{money(st.upgrade.plan.priceMinor)} <span class="text-base font-normal opacity-90">{t("a month")}</span></p>
        <p class="mt-1 text-sm opacity-90">{st.upgrade.plan.founders ? t("Flat for the whole workspace, unlimited users. Founders pay {price} a month for life.", { price: money(st.upgrade.plan.priceMinor) }) : t("Flat for the whole workspace, unlimited users.")}</p>
        <ul class="mt-4 space-y-1.5 text-sm">{#each [t("Unlimited documents and templates"), t("0% fee on payments"), t("Think harder, send to a list, your own plays"), t("Signing on your own domain")] as x}<li>✓ {x}</li>{/each}</ul>
        <button class="mt-5 rounded-xl bg-white px-4 py-2.5 font-semibold text-[#3f2899]" onclick={() => openUpgrade(null)} data-testid="billing-upgrade">{t("Upgrade to Pro")}</button></ProCard3D>
      <div><h2 class="font-semibold">{t("How upgrading works")}</h2><ol class="mt-3 list-decimal space-y-2 pl-5 text-[15px]"><li>{t("Pay securely on Stripe's checkout page.")}</li><li>{t("Pro switches on the moment it's paid.")}</li><li>{t("Change your card or cancel any time, here or in the billing portal.")}</li><li>{t("Cancel and you keep Pro until the end of the period you paid for.")}</li></ol>
        <a class="mt-3 inline-block py-1 text-sm text-brand" href={EXPLORE_PRO_URL} target="_blank" rel="noopener">{t("Compare Free and Pro on the pricing page")} →</a></div>
    </section>
  {/if}

  <section class="mt-6 max-w-3xl" data-testid="billing-invoices"><h2 class="font-semibold">{t("Invoices")}</h2>
    {#if details?.invoices?.length}
      <div class="mt-2 overflow-x-auto rounded-xl border border-line bg-card"><table class="w-full min-w-[520px] text-left text-[14px]"><tbody>
        {#each details.invoices as inv (inv.id)}<tr class="h-10 border-t border-line first:border-t-0" data-testid="invoice-row"><td class="px-4">{day(inv.at)}</td><td class="px-4">Docustay Pro</td><td class="px-4 tabular-nums">{money(inv.totalMinor, inv.currency)} · {inv.status === "paid" ? t("Paid") : inv.status === "open" ? t("Due") : inv.status === "void" ? t("Void") : inv.status}</td>
          <td class="px-4 text-right">{#if inv.pdf}<a class="text-brand" href={inv.pdf} target="_blank" rel="noopener" data-testid="invoice-pdf">{t("Download PDF")}</a>{/if}</td></tr>{/each}
      </tbody></table></div>
    {:else}<p class="mt-2 text-sm text-mute" data-testid="billing-no-invoices">{t("No invoices yet. They appear here once you're on Pro.")}</p>{/if}
  </section>

  {#if st?.billing?.canManage}
    <section class="mt-8 max-w-xl" data-testid="billing-email-box">
      <h2 class="text-base font-semibold">{t("Billing email")}</h2>
      <p class="mt-1 text-sm text-mute">{t("Receipts and billing emails go to the workspace owners. Add one more address, for example a finance inbox, and they go there too.")}</p>
      <form class="mt-3 flex flex-wrap items-center gap-2" onsubmit={(e) => { e.preventDefault(); saveBillingEmail(); }}>
        <label class="sr-only" for="billing-email">{t("Billing email")}</label>
        <input id="billing-email" class="field min-w-0 flex-1" type="email" autocomplete="email" placeholder="finance@example.com" bind:value={bEmail} data-testid="billing-email-input" />
        <button class="btn" type="submit" disabled={bBusy || bEmail.trim() === (bSaved ?? "")} data-testid="billing-email-save">{bBusy ? t("Saving…") : t("Save")}</button>
      </form>
      {#if bMsg}<p class="mt-2 text-sm {bMsg.bad ? 'text-bad' : 'text-mute'}" role="status" data-testid="billing-email-msg">{bMsg.text}</p>{/if}
    </section>
  {/if}
  {#if onPro && !st.plan.cancelsAt}<p class="mt-6"><a class="btn quiet text-sm" href="/billing/cancel" data-testid="billing-cancel">{t("Cancel Pro")}</a></p><p class="mt-2 max-w-xl text-sm text-mute" data-testid="billing-no-refunds">{t("Docustay does not give refunds. You can cancel at any time, and Pro stays on until the end of the period you have paid for.")}</p>{/if}
{:else if st}<p class="mt-6 text-mute" data-testid="billing-noplan">{t("This workspace has no plan or charges, so there is nothing to bill.")}</p>
{:else if !problem}<div class="mt-6"><PageSkel kind="panel" testid="billing-loading" /></div>{/if}

<style>
  .strip { display: grid; gap: 18px 28px; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); padding: 14px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); align-items: end; }
  .strip > :global(*) { padding-left: 14px; border-left: 1px solid var(--line); } .strip > :global(*:first-child) { padding-left: 0; border-left: 0; }
</style>
