<script>
  let { embedded = false } = $props();   // Launch step 7: shown inside another screen (Documents, Plays, Billing), which owns the page title
  // PAYMENTS (Run 9 board "Pay 3"; ruling R9-l): every payment taken through a payment box in a document or form, newest first, with this month's figures as a dense strip. Refund full or part
  // from the right-hand sheet (the reason goes in the document's trail); a person still to pay can be reminded; a dispute is answered in Stripe (Docustay only shows it). Stripe is the record:
  // every amount and fee here is what Stripe said. Payouts are Stripe's, on its own schedule.
  import { onMount } from "svelte";
  import { api } from "$lib/api.js";
  import { inDemo } from "$lib/pro/plan.svelte.js";
  import { live } from "$lib/live.js";
  import { t, i18n } from "$lib/i18n/index.svelte.js";
  import StatTile from "$lib/ui/StatTile.svelte";
  import Sheet from "$lib/ui/Sheet.svelte";
  import PageSkel from "$lib/ui/PageSkel.svelte";
  const un = (r) => r.json?.data ?? r.json;
  let data = $state(null), stripe = $state(null), problem = $state(null), loaded = $state(false), note = $state(null), more = $state(false);
  let refund = $state(null), full = $state(true), part = $state(""), why = $state(""), busy = $state(false), sheetProblem = $state(null);
  async function load() {
    const demo = await inDemo();   // R13-D020: no Stripe call in the demo (it would only answer 403)
    const [r, s] = await Promise.all([api("/api/documents/payments"), demo ? { ok: false } : api("/api/product/docustay/payments")]);
    loaded = true;
    if (r.ok) { data = un(r); problem = null; } else problem = r.error ?? t("The payments could not be loaded.");
    if (s.ok) stripe = un(s);
  }
  async function loadMore() {
    if (!data?.next) return; more = true;
    const r = await api(`/api/documents/payments?before=${encodeURIComponent(data.next)}`); more = false;
    if (r.ok) { const d = un(r); data = { ...data, items: [...data.items, ...d.items], next: d.next }; }
  }
  onMount(() => { load(); return live(["documents", "billing"], load); });

  const day = (iso) => (iso ? new Date(iso).toLocaleDateString(i18n.lang, { day: "numeric", month: "short", year: "numeric" }) : "");
  const testMode = $derived(stripe?.mode === "test");
  const dash = (path = "") => `https://dashboard.stripe.com/${testMode ? "test/" : ""}${path}`;
  const STATUS = () => ({ paid: t("Paid"), waiting: t("Waiting to pay"), started: t("Payment started"), refunded: t("Refunded"), partially_refunded: t("Part refunded"), disputed: t("Disputed") });
  const TONE = { paid: "bg-ok", waiting: "bg-warn", started: "bg-faint", refunded: "bg-faint", partially_refunded: "bg-faint", disputed: "bg-bad" };

  function openRefund(p) { refund = p; full = true; part = ""; why = ""; sheetProblem = null; }
  const left = $derived(refund ? refund.amountMinor - (refund.refundedMinor ?? 0) : 0);
  const cash = (minor, cur) => { try { return new Intl.NumberFormat(i18n.lang, { style: "currency", currency: String(cur ?? "usd").toUpperCase() }).format(minor / 100); } catch { return (minor / 100).toFixed(2); } };
  async function doRefund() {
    sheetProblem = null;
    const amountMinor = full ? null : Math.round(Number(String(part).replace(/[^0-9.]/g, "")) * 100);
    if (!full && !(Number.isInteger(amountMinor) && amountMinor >= 1 && amountMinor <= left)) { sheetProblem = t("Type an amount up to {amount}.", { amount: cash(left, refund.currency) }); return; }
    if (!why.trim()) { sheetProblem = t("Say why it is being refunded."); return; }
    busy = true;
    const r = await api("/api/documents/pdf/refund-payment", { method: "POST", body: { paymentId: refund.id, amountMinor, reason: why.trim() } });
    busy = false;
    if (!r.ok) { sheetProblem = r.error ?? t("The refund did not go through."); return; }
    note = t("Refunded {amount} to {person}.", { amount: un(r)?.refundedLabel ?? "", person: refund.person }); refund = null; await load();
  }
  async function remind(p) {
    note = null;
    const r = await api("/api/documents/pdf/remind", { method: "POST", body: { instanceId: p.documentId, partyId: p.partyId } });
    note = r.ok ? t("Reminder sent to {person}.", { person: p.person }) : (r.error ?? t("The reminder could not be sent."));
  }
</script>
<div class="flex flex-wrap items-start gap-3">
  <div class="min-w-0">{#if !embedded}<h1 class="text-[length:var(--t-title)] font-medium leading-tight tracking-[-0.02em]">{t("Payments")}</h1>{/if}
    <p class="mt-1 text-mute">{t("Money collected through payment fields in your documents.")}</p></div>
  {#if stripe?.state === "live"}<a class="btn quiet ml-auto" href={dash("payments")} target="_blank" rel="noopener" data-testid="payments-dashboard">{t("Open your Stripe dashboard")} →</a>{/if}
</div>
{#if problem}<p class="notice warn mt-3" role="alert" data-testid="payments-problem">{problem}</p>{/if}
{#if testMode}<p class="notice warn mt-3" data-testid="payments-test-note">{t("Stripe test mode: these are test payments, and no real money moves.")}</p>{/if}
{#if note}<p class="notice mt-3" role="status" data-testid="payments-note">{note}</p>{/if}
<section class="strip mt-5" aria-label={t("This month")} data-testid="payments-strip">
  <StatTile label={t("Collected this month")} value={data?.month?.collected ?? "—"} />
  <StatTile label={t("Docustay fee")} value={data?.month?.fee ?? "—"} delta={t("2% on Free and Pay as you go · 0% on Pro and Lifetime")} />
  <StatTile label={t("Stripe fees")} value={data?.month?.stripeFee ?? "—"} delta={data?.month?.stripeFeePending ? t("{n} still settling at Stripe", { n: data.month.stripeFeePending }) : t("Charged by Stripe")} />
  <StatTile label={t("Refunded")} value={data?.month?.refunded ?? "—"} delta={t("{n} this month", { n: data?.month?.refunds ?? 0 })} />
</section>
<div class="mt-4 overflow-x-auto rounded-xl border border-line bg-card">
  <table class="w-full min-w-[720px] text-left text-[14px]" data-testid="payments-table">
    <thead class="font-mono text-[.7rem] uppercase tracking-wider text-faint"><tr><th class="h-9 px-4">{t("From")}</th><th class="px-4">{t("Document")}</th><th class="px-4">{t("Amount")}</th><th class="px-4">{t("Status")}</th><th class="px-4"></th></tr></thead>
    <tbody>
      {#if !loaded}<tr><td colspan="5" class="p-4"><PageSkel kind="list" testid="payments-skel" /></td></tr>
      {:else}
        {#each data?.items ?? [] as p (p.id)}
          <tr class="h-10 border-t border-line" data-testid="payment-row" data-id={p.id} data-status={p.status}>
            <td class="px-4 py-2 font-medium">{p.person}</td>
            <td class="px-4 py-2"><a class="text-ink no-underline hover:underline" href={`/documents/${p.documentId}`}>{p.title}</a>{#if p.form}<span class="text-mute"> ({t("form")})</span>{/if}{#if p.test}<span class="ml-1 text-xs text-mute">· {t("test")}</span>{/if}</td>
            <td class="px-4 py-2 tabular-nums">{p.describe ?? p.label}{#if p.refundedLabel && p.status !== "refunded"}<span class="block text-xs text-mute">{t("{amount} refunded", { amount: p.refundedLabel })}</span>{/if}</td>
            <td class="px-4 py-2"><span class="inline-flex items-center gap-1.5"><span class="h-2 w-2 rounded-full {TONE[p.status] ?? 'bg-faint'}" aria-hidden="true"></span><span data-testid="payment-status">{STATUS()[p.status] ?? p.status}</span></span>
              {#if p.status === "waiting" && p.holdExpiresAt}<span class="block text-xs text-mute">{t("Signature kept until {date}", { date: day(p.holdExpiresAt) })}</span>{:else if p.paidAt}<span class="block text-xs text-mute">{day(p.paidAt)}</span>{/if}</td>
            <td class="px-4 py-2 text-right">
              {#if p.status === "disputed" && p.disputeId}<a class="btn quiet !min-h-8 !py-0.5 text-sm" href={dash(`disputes/${p.disputeId}`)} target="_blank" rel="noopener" data-testid="payment-dispute">{t("Respond in Stripe")}</a>
              {:else if p.canRefund}<button class="btn quiet !min-h-8 !py-0.5 text-sm" onclick={() => openRefund(p)} data-testid="payment-refund">{t("Refund")}</button>
              {:else if p.canRemind}<button class="btn quiet !min-h-8 !py-0.5 text-sm" onclick={() => remind(p)} data-testid="payment-remind">{t("Remind")}</button>{/if}</td>
          </tr>
        {:else}
          <tr><td colspan="5" class="px-4 py-8 text-left md:text-center" data-testid="payments-empty"><div class="sticky left-4 max-w-[17rem] md:static md:mx-auto md:max-w-none">{t("When someone pays through a payment field in a document or form, it shows here.")}{#if stripe && stripe.state !== "live"}{" "}<a class="underline" href="/settings?tab=payments">{t("Connect Stripe")}</a>{/if}</div></td></tr>
        {/each}
      {/if}
    </tbody>
  </table>
</div>
{#if data?.next}<p class="mt-3"><button class="btn quiet" disabled={more} onclick={loadMore} data-testid="payments-more">{more ? t("Loading…") : t("Show more")}</button></p>{/if}
<p class="mt-3 text-sm text-mute" data-testid="payments-payouts">{t("Payouts to your bank are made by Stripe on its own schedule. Docustay never holds your money.")}</p>

<Sheet open={Boolean(refund)} title={refund ? t("Refund {person}", { person: refund.person }) : ""} onclose={() => (refund = null)}>
  {#if refund}
    <div class="grid gap-3" data-testid="refund-sheet">
      <p class="text-sm text-mute">{refund.title} · {t("paid {amount} on {date}", { amount: refund.label, date: day(refund.paidAt) })}</p>
      <label class="flex items-center gap-2 text-sm"><input type="radio" name="refund-kind" checked={full} onchange={() => (full = true)} data-testid="refund-full" />{t("Full refund")} · {cash(left, refund.currency)}</label>
      <label class="flex items-center gap-2 text-sm"><input type="radio" name="refund-kind" checked={!full} onchange={() => (full = false)} data-testid="refund-part" />{t("Part of it")}</label>
      {#if !full}<label class="grid grid-cols-[9rem_minmax(0,1fr)] items-center gap-3"><span class="text-sm font-medium">{t("Amount")}</span><input class="field" inputmode="decimal" bind:value={part} placeholder="0.00" data-testid="refund-amount" /></label>{/if}
      <label class="grid grid-cols-[9rem_minmax(0,1fr)] items-start gap-3"><span class="pt-2 text-sm font-medium">{t("Reason")}</span><span class="grid gap-0.5"><textarea class="field" rows="3" maxlength="500" bind:value={why} data-testid="refund-reason"></textarea><span class="text-xs text-mute">{t("Shown on their receipt from Stripe, and kept in the document's audit trail.")}</span></span></label>
      <p class="text-sm text-mute">{t("The signed document stays signed. The refund is added to its audit trail.")}</p>
      {#if sheetProblem}<p class="text-sm text-bad" role="alert" data-testid="refund-problem">{sheetProblem}</p>{/if}
    </div>
  {/if}
  {#snippet footer()}<div class="flex justify-end gap-2"><button class="btn quiet" onclick={() => (refund = null)}>{t("Cancel")}</button><button class="btn primary" disabled={busy} onclick={doRefund} data-testid="refund-go">{busy ? t("Refunding…") : refund ? t("Refund {amount}", { amount: full ? cash(left, refund.currency) : part ? cash(Math.round(Number(String(part).replace(/[^0-9.]/g, "")) * 100) || 0, refund.currency) : "" }) : ""}</button></div>{/snippet}
</Sheet>
<style>
  .strip { display: grid; gap: 18px 28px; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); padding: 14px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); align-items: end; }
  .strip > :global(*) { padding-left: 14px; border-left: 1px solid var(--line); } .strip > :global(*:first-child) { padding-left: 0; border-left: 0; }
</style>
