<script>
  import Page from "$lib/ui/Page.svelte";
  import { appEvent } from "$lib/appEvents.js";
  let { embedded = false, part = "plan" } = $props();   // `part`: "plan" draws everything but the invoices, "invoices" draws only them (the Billing tabs)   // Launch step 7: shown inside another screen (Documents, Plays, Billing), which owns the page title
  // BILLING (Run 9 boards Pay 4, B2–B5; Part 2 decisions: Pro billing; Option B of 20 Oct 2026). The Plan tab: top row "Your plan" (left) and "This billing month" (right), then "Compare plans" in full width, then Billing
  // email and Cancel. Free: what this month used and how upgrading works. Back from Stripe (B2): the server re-reads the checkout and the plan switches on only when Stripe confirms — the page waits, and says so
  // after 20 seconds. Then Welcome to {plan} (B3). A failed payment (B5) only says to update the card; cancelling keeps the plan to the end of what was paid, and Resume undoes it. Stripe's own portal stays
  // one click away for everything else. SCREEN ONLY: every number is read from the status payload (which reads the one price list), and the actions are the routes that were always here.
  import PageSkel from "$lib/ui/PageSkel.svelte";
  import Dialog from "$lib/ui/Dialog.svelte";
  import StatusChip from "$lib/ui/StatusChip.svelte";
  import { live } from "$lib/live.js";
  import { onMount } from "svelte";
  import { api, money } from "$lib/api.js";
  import { t, whenText } from "$lib/i18n/index.svelte.js";
  import { Coin, CardTurn } from "$lib/fx3d/index.js";
  import { loadPlan, plan, EXPLORE_PRO_URL } from "$lib/pro/plan.svelte.js";
  import PlanPanel from "$lib/billing/PlanPanel.svelte";
  import MonthPanel from "$lib/billing/MonthPanel.svelte";
  import ComparePlans from "$lib/billing/ComparePlans.svelte";
  import PlanPiece from "$lib/billing/PlanPiece.svelte";
  import { SHORT, columns, bullets, cardText, cardExpired } from "$lib/billing/billingModel.js";
  let st = $state(null), problem = $state(null), busy = $state(false), details = $state(null), detailsFailed = $state(null);
  let bEmail = $state(""), bSaved = $state(null), bBusy = $state(false), bMsg = $state(null);   // the workspace's separate billing email (receipts and billing emails also go here)
  const loadBillingEmail = async () => { const r = await api("/api/product/docustay/billing-email", { method: "POST", body: {} }); if (r.ok) { bSaved = un(r).email ?? null; bEmail = bSaved ?? ""; } };
  async function saveBillingEmail() {
    // R13-D215: our own lasting message (the browser's bubble vanished and the page said nothing); an empty box removes the address
    if (bEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(bEmail.trim())) { bMsg = { bad: true, text: t("Type a full email address, like finance@yourcompany.com.") }; return; }
    bBusy = true; bMsg = null; const r = await api("/api/product/docustay/billing-email", { method: "POST", body: { email: bEmail.trim() } }); bBusy = false; if (!r.ok) { bMsg = { bad: true, text: r.error ?? t("That did not work. Try again.") }; return; } bSaved = un(r).email ?? null; bEmail = bSaved ?? ""; bMsg = { bad: false, text: bSaved ? t("Saved. Receipts and billing emails also go to {email}.", { email: bSaved }) : t("Removed. Billing emails go to the workspace owners only.") }; }
  let confirming = $state(null), slow = $state(false), welcome = $state(false), lastCard = $state(null), turned = $state(false);
  const un = (r) => r.json?.data ?? r.json;
  const short = $derived(SHORT[st?.plan?.key] ?? "free");
  const isSub = $derived(["pro", "payg"].includes(short) && !st?.plan?.ended), isLife = $derived(short === "lifetime");
  const planName = $derived(st?.plan?.name ?? "");
  const cols = $derived(columns(st));
  // switching between Pay as you go and Pro in place: asks first (a dialog), says what happens, then Stripe starts the new period today
  let switching = $state(null), dlg = $state(false);
  const switchTo = $derived(st?.plan?.key === "docustay_payg" ? "pro" : st?.plan?.key === "docustay_pro" ? "payg" : null);
  const canSwitch = $derived(isSub && !st?.plan?.cancelsAt && switchTo != null && !st?.plan?.pendingSwitch);
  // 21 Oct 2026 (the maintainer, pricing integrity): the dialog shows Stripe's own numbers, read when it opens (nothing is typed here): the credit for unused paid time, what is paid today, and for a downgrade the date it takes effect
  let pv = $state(null), pvBusy = $state(false), pvProblem = $state(null);
  const pending = $derived(st?.plan?.pendingSwitch ?? null);
  const openSwitch = async (to) => {
    switching = to; pv = null; pvProblem = null; dlg = true; pvBusy = true;
    const r = await api("/api/product/docustay/switch-plan/preview", { method: "POST", body: { plan: to } });
    pvBusy = false; if (r.ok) pv = un(r); else pvProblem = r.error ?? t("We could not read the amount just now. Try again in a moment.");
  };
  async function doSwitch() {
    const to = switching, due = pv?.dueTodayMinor ?? null; dlg = false; switching = null;
    if (to === "lifetime") { await go("/api/product/docustay/checkout", { plan: "lifetime" }); return; }
    busy = true; problem = null; const r = await api("/api/product/docustay/switch-plan", { method: "POST", body: { plan: to, ...(due != null ? { expectedDueMinor: due } : {}) } }); busy = false;
    if (r.ok) { st = un(r) ?? st; await loadB(); return; }
    problem = r.error ?? t("That did not work. Try again.");
    if (r.json?.error?.code === "switch_numbers_changed" || r.json?.error?.detail?.code === "switch_numbers_changed") { switching = to; await openSwitch(to); }
  }
  const dayOf = (iso) => (iso ? whenText(iso, { dateStyle: "long", timeZone: "UTC" }) : "");
  const fromName = $derived(pv?.from === "docustay_pro" ? "Pro" : "Pay as you go");
  const swTitle = $derived(switching === "lifetime" ? t("Switch to Lifetime?") : switching === "pro" ? t("Switch to Pro?") : t("Switch to Pay as you go?"));
  const target = $derived(cols.find((c) => c.short === switching) ?? null);
  const buy = (plan) => go("/api/product/docustay/checkout", { plan });
  const loadB = async () => {
    problem = null; const d0 = await loadPlan({ force: true }); if (d0 && !plan.error) st = d0; else { st = null;   /* R13-D456: a failed re-read is not the plan (an older copy showed dashes) */ const why = await api("/api/product/docustay/status"); problem = why.status === 403 && why.error ? why.error : t("Could not load your plan."); }   // Run 10 (R10-49): a member was told "Could not load your plan." — a refusal by rank now says so, in the app's existing words (You do not have permission to do that. Ask an owner or an admin.)   // the one shared plan read (concurrent callers share the one request — the layout, this page and the billing notice were three identical calls)
    if (st?.billing?.canManage || st?.plan?.key === "docustay_lifetime") { const d = await api("/api/product/docustay/billing-details"); detailsFailed = d.ok ? null : (d.error ?? t("Your invoices could not be loaded.")); if (d.ok) { const nd = un(d); if (lastCard && nd.card && (nd.card.last4 !== lastCard.last4 || nd.card.expYear !== lastCard.expYear)) turned = true; details = nd; lastCard = nd.card ?? lastCard; } }
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
    if (out?.confirmed) { void appEvent("upgrade_completed"); confirming = null; slow = false; welcome = true; await loadB(); return; }
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
  const INV = () => ({ paid: ["ok", t("Paid")], open: ["warn", t("Due")], void: ["mute", t("Void")], refunded: ["mute", t("Refunded")], uncollectible: ["bad", t("Declined")] });
  const budgetEl = () => document.getElementById("budget-input");
</script>
{#if problem}<p class="mt-4 border-l-2 border-bad pl-3 text-[13px] text-bad" role="alert" data-testid="billing-problem">{problem}{#if !st} <button class="btn quiet" onclick={loadB} data-testid="billing-retry">{t("Try again")}</button>{/if}</p>{/if}

{#if confirming}
  <!-- B2 · 3: waiting for Stripe's word -->
  <section class="mt-8 grid justify-items-start gap-3" data-testid="billing-confirming"><Coin label={t("Confirming your payment")} size={52} testid="billing-coin" />
    <p class="text-sm text-mute">{slow ? t("This is taking longer than usual. You can keep working; we'll tell you the moment it's done.") : t("Pro switches on as soon as Stripe confirms the payment.")}</p></section>
{:else if welcome}
  <!-- B3 · Welcome to {plan} -->
  <section class="welcome mt-6" data-testid="billing-welcome">
    <div class="piece"><PlanPiece plan={short} size={190} glow testid="welcome-piece" /><p class="font-mono text-[11px] uppercase tracking-wider text-mute">{t("Payment confirmed")}</p></div>
    <div><h2 class="text-2xl font-semibold">{t("Welcome to {plan}", { plan: planName })}</h2><p class="mt-2 text-[15px] text-mute">{t("Everything below is switched on for your whole workspace, right now. Your receipt is on its way to your email.")}</p>
      <ul class="mt-4 space-y-2 text-[15px]">{#each bullets(cols.find((c) => c.current)) as x}<li class="flex gap-2"><span class="text-brand" aria-hidden="true">✓</span>{x}</li>{/each}</ul>
      <div class="mt-5 flex flex-wrap gap-3"><button class="btn primary" onclick={backTo} data-testid="welcome-back">{t("Back to what I was doing")}</button><a class="btn quiet" href={EXPLORE_PRO_URL} target="_blank" rel="noopener">{t("See everything Pro adds")}</a></div></div>
  </section>
{:else if st?.plan}
<Page type="list">
{#if part === "plan"}
  <div class="stackv" data-testid="billing-plan-tab">
    <!-- the alerts, in the words they have always had -->
    {#if st.hold}
      <section class="alert bad" data-testid="billing-hold"><div class="min-w-0 flex-1"><p class="font-medium text-bad">{st.hold.message}</p></div></section>
    {/if}
    {#if st.paymentProblem || st.plan.ended === "payment"}
      <section class="alert bad" data-testid="billing-failed">
        {#if details?.card}<CardTurn last4={lastCard?.last4 ?? details.card.last4} exp={cardText(lastCard ?? details.card).split(" · ")[1] ?? ""} newLast4={details.card.last4} newExp={cardText(details.card).split(" · ")[1] ?? ""} {turned} expiredLabel={cardExpired(lastCard ?? details.card) ? t("Card expired") : t("Declined")} />{/if}
        <div class="min-w-0 flex-1"><p class="font-medium text-bad">{t("Your last payment didn't go through.")}</p>{#if turned}<p class="mt-1 text-sm">{t("New card saved.")}</p>{/if}</div>
        {#if st.billing.canManage}<button class="btn primary" disabled={busy} onclick={() => go("/api/product/docustay/portal")} data-testid="billing-update-card">{t("Update card")}</button>{/if}
      </section>
    {:else if st.plan.ended === "cancelled"}<p class="alert mute" data-testid="billing-ended">{t("Your Pro subscription has ended. You can start it again at any time.")}</p>{/if}
    {#if st.plan.cancelsAt}
      <section class="alert warn" data-testid="billing-cancelled">
        <div class="min-w-0 flex-1"><p class="font-medium">{t("{plan} ends on {date}", { plan: planName, date: day(st.plan.cancelsAt) })}</p><p class="mt-1 text-sm text-mute">{t("Changed your mind? Resuming keeps everything as it was.")}</p></div>
        <button class="btn primary" disabled={busy} onclick={() => act("/api/product/docustay/resume")} data-testid="billing-resume">{t("Resume {plan}", { plan: planName })}</button></section>
    {/if}
    {#if pending}
      <section class="alert warn" data-testid="billing-pending-switch">
        <div class="min-w-0 flex-1"><p class="font-medium">{t("Switches to Pay as you go on {date}. You keep Pro until then.", { date: dayOf(pending.at) })}</p><p class="mt-1 text-sm text-mute">{t("Nothing is charged or credited today. You can cancel the switch before then.")}</p></div>
        <button class="btn primary" disabled={busy} onclick={() => act("/api/product/docustay/switch-plan/cancel")} data-testid="billing-pending-cancel">{t("Cancel the switch")}</button></section>
    {/if}
    {#if st.budget?.paused}
      <section class="alert bad" role="alert" data-testid="billing-paused">
        <p class="min-w-0 flex-1">{t("Sending and AI drafting are paused because this month's usage reached your {budget} budget. Raise the budget below to go on. Nothing is deleted.", { budget: money(st.budget.budgetMinor) })}</p>
        <button class="btn primary" onclick={() => { const el = budgetEl(); el?.scrollIntoView({ block: "center" }); el?.focus(); }}>{t("Raise the budget")}</button></section>
    {/if}

    <div class="top-row">
      <PlanPanel {st} {details} {busy} {switchTo} {canSwitch} onSwitch={openSwitch} onPortal={() => go("/api/product/docustay/portal")} />
      <MonthPanel {st} onChanged={loadB} />
    </div>

    <ComparePlans {st} {busy} {canSwitch} onBuy={buy} onSwitch={openSwitch} />

    {#if st.billing?.canManage || (isSub && !st.plan.cancelsAt)}
      <div class="bottom-row">
        {#if st.billing?.canManage}
          <section class="box" data-testid="billing-email-box">
            <h2 class="head">{t("Billing email")}</h2>
            <p class="mt-1 text-sm text-mute">{t("Receipts and billing emails go to the workspace owners. Add one more address, for example a finance inbox, and they go there too.")}</p>
            <form class="mt-3 flex flex-wrap items-center gap-2" novalidate onsubmit={(e) => { e.preventDefault(); saveBillingEmail(); }}>
              <label class="sr-only" for="billing-email">{t("Billing email")}</label>
              <input id="billing-email" class="field min-w-0 flex-1" type="email" autocomplete="email" placeholder="finance@example.com" bind:value={bEmail} oninput={() => (bMsg = null)} aria-invalid={bMsg?.bad ? "true" : undefined} aria-describedby="billing-email-msg" data-testid="billing-email-input" />
              <button class="btn" type="submit" disabled={bBusy || bEmail.trim() === (bSaved ?? "")} data-testid="billing-email-save">{bBusy ? t("Saving…") : t("Save")}</button>
            </form>
            {#if bMsg}<p id="billing-email-msg" class="mt-2 text-sm {bMsg.bad ? 'text-bad' : 'text-mute'}" role="status" data-testid="billing-email-msg">{bMsg.text}</p>{/if}
          </section>
        {/if}
        {#if isSub && !st.plan.cancelsAt}
          <section class="box" data-testid="billing-cancel-box">
            <h2 class="head">{t("Cancel {plan}", { plan: planName })}</h2>
            <p class="mt-1 max-w-xl text-sm text-mute" data-testid="billing-no-refunds">{t("Docustay does not give refunds. You can cancel at any time, and your plan stays on until the end of the period you have paid for.")}</p>
            <p class="mt-3"><a class="btn" href="/billing/cancel" data-testid="billing-cancel">{t("Cancel {plan}", { plan: planName })}</a></p>
          </section>
        {/if}
      </div>
    {/if}
  </div>
{:else}
  <section data-testid="billing-invoices"><h2 class="sr-only">{t("Invoices")}</h2>
    {#if details?.invoices?.length}
      <div class="overflow-x-auto rounded-xl border border-line bg-card"><table class="inv w-full text-left text-[14px]">
        <thead><tr><th scope="col">{t("Date")}</th><th scope="col" class="hidden sm:table-cell">{t("What it was for")}</th><th scope="col" class="num">{t("Amount")}</th><th scope="col">{t("Status")}</th><th scope="col"><span class="sr-only">{t("Download")}</span></th></tr></thead>
        <tbody>
        {#each details.invoices as inv (inv.id)}{@const s = INV()[inv.status] ?? ["mute", inv.status]}<tr data-testid="invoice-row"><td>{day(inv.at)}</td><td class="hidden sm:table-cell">{inv.label ?? `Docustay ${planName}`}</td><td class="num tabular-nums">{money(inv.dueMinor ?? inv.totalMinor, inv.currency)}{#if inv.creditMinor > 0}<span class="block text-[12px] text-mute" data-testid="invoice-credit">{t("{total} less {credit} credit", { total: money(inv.totalMinor, inv.currency), credit: money(inv.creditMinor, inv.currency) })}</span>{/if}</td>
          <td><StatusChip tone={s[0]}>{s[1]}</StatusChip></td>
          <td class="text-right">{#if inv.pdf}<a class="text-brand" href={inv.pdf} target="_blank" rel="noopener" data-testid="invoice-pdf">{t("Download PDF")}</a>{/if}</td></tr>{/each}
        </tbody></table></div>
    {:else}
      <div class="empty">
        <PlanPiece plan={short} size={96} still testid="invoices-piece" />
        {#if details?.stale}<p class="text-sm text-mute" data-testid="billing-stale">{t("Your earlier invoices are not available here. Choose a plan above to start billing fresh; nothing was deleted.")}</p>
        {:else if detailsFailed}<p class="text-sm" role="alert" data-testid="billing-invoices-failed">{detailsFailed} <button class="btn quiet" onclick={loadB}>{t("Try again")}</button></p>   <!-- R13-D448: a failed read is not "No invoices yet" -->
        {:else}<p class="text-sm text-mute" data-testid="billing-no-invoices">{t("No invoices yet. They appear here once you're on a paid plan.")}</p>{/if}
      </div>
    {/if}
  </section>
{/if}
</Page>

<Dialog bind:open={dlg} title={swTitle} onclose={() => (switching = null)} testid="billing-switch">
  <div class="flex gap-4">
    {#if switching}<PlanPiece plan={switching} size={72} still testid="switch-piece" />{/if}
    <div class="min-w-0 text-sm" aria-live="polite">
      {#if pvBusy}<p class="text-mute" data-testid="switch-loading">{t("Reading the amount from Stripe…")}</p>
      {:else if pvProblem}<p class="text-bad" role="alert" data-testid="switch-problem">{pvProblem}</p>
      {:else if pv?.kind === "downgrade"}
        <p class="font-medium" data-testid="switch-line">{t("You keep Pro until {date}. Then your plan changes to Pay as you go.", { date: dayOf(pv.effectiveAt) })}</p>
        <p class="mt-2 text-mute">{t("Nothing is charged or credited today. You can cancel the switch any time before then.")}</p>
      {:else if pv}
        <p class="font-medium" data-testid="switch-line">{#if pv.creditMinor > 0}{t("Pay {due} today: {plan} {first} minus a {credit} credit for unused {from} days.", { due: money(pv.dueTodayMinor), plan: switching === "lifetime" ? "Lifetime" : "Pro", first: money(pv.firstChargeMinor), credit: money(Math.min(pv.creditMinor, pv.firstChargeMinor)), from: fromName })}{:else}{t("Pay {due} today for {plan}.", { due: money(pv.dueTodayMinor), plan: switching === "lifetime" ? "Lifetime" : "Pro" })}{/if}</p>
        {#if pv.accountCreditMinor > 0}<p class="mt-2 text-mute" data-testid="switch-leftover">{t("The rest of your credit, {amount}, stays on your account for your next invoices.", { amount: money(pv.accountCreditMinor) })}</p>{/if}
        {#if target}<ul class="mt-2 list-disc space-y-1 pl-5 text-mute">{#each bullets(target) as x}<li>{x}</li>{/each}</ul>{/if}
        <p class="mt-3 text-mute">{switching === "lifetime" ? t("Stripe opens next to take the payment. Your {from} plan ends once it is paid, and what it used so far this period is invoiced then. A promotion code cannot be added to a payment that already carries your credit.", { from: fromName }) : t("Your new plan starts today and your allowance starts fresh. What this period has used so far is invoiced now. The credit is only for time you paid for and have not used; it is never paid out in cash.")}</p>
      {/if}
    </div>
  </div>
  {#snippet footer()}<button class="btn quiet" onclick={() => (dlg = false)}>{t("Not now")}</button><button class="btn primary" disabled={busy || pvBusy || !pv} onclick={doSwitch} data-testid="billing-switch-confirm">{pv?.kind === "downgrade" ? t("Switch on {date}", { date: dayOf(pv.effectiveAt) }) : switching === "lifetime" ? t("Continue to payment") : pv ? t("Pay {due} and switch", { due: money(pv.dueTodayMinor) }) : t("Switch now")}</button>{/snippet}
</Dialog>

{:else if st}<p class="mt-6 text-mute" data-testid="billing-noplan">{t("This workspace has no plan or charges, so there is nothing to bill.")}</p>
{:else if !problem}<div class="mt-6"><PageSkel kind="panel" testid="billing-loading" /></div>{/if}

<style>
  .stackv { display: grid; gap: 28px; }
  .top-row { display: grid; gap: 22px; grid-template-columns: minmax(0, 1fr); align-items: stretch; }
  @media (min-width: 1100px) { .top-row { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } }
  .bottom-row { display: grid; gap: 22px; grid-template-columns: minmax(0, 1fr); }
  @media (min-width: 900px) { .bottom-row { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } .bottom-row > :only-child { grid-column: 1 / -1; } }
  .box { border: 1px solid var(--line); border-radius: 14px; background: var(--card); padding: 22px 26px; min-width: 0; }
  .head { font-size: 17px; font-weight: 600; letter-spacing: -.01em; }
  .alert { display: flex; flex-wrap: wrap; align-items: center; gap: 14px 20px; border-radius: 12px; border: 1px solid var(--line); background: var(--card); padding: 14px 18px; }
  .alert.bad { background: var(--bad-bg); border-color: var(--bad-line); } .alert.warn { background: var(--warn-bg); border-color: var(--warn-line); } .alert.mute { color: var(--mute); font-size: 14px; }
  .welcome { display: grid; gap: 28px; grid-template-columns: minmax(0, 1fr); align-items: center; } .welcome .piece { display: grid; justify-items: center; gap: 14px; padding: 18px 0; }
  @media (min-width: 760px) { .welcome { grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr); } }
  .inv th, .inv td { padding: 11px 16px; border-top: 1px solid var(--line); } .inv thead th { border-top: 0; font-size: 12.5px; font-weight: 500; color: var(--mute); background: var(--tint); } .inv .num { text-align: right; }
  .empty { display: grid; justify-items: center; gap: 12px; padding: 48px 16px; border: 1px dashed var(--line-strong); border-radius: 14px; text-align: center; }
</style>
