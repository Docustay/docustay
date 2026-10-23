<script>
  import Page from "$lib/ui/Page.svelte";
  // CANCEL PRO — one designed page, never a drawer (13 Oct 2026, after the $1 live test where one click on a drawer cancelled the plan).
  // Billing's "Cancel Pro" is a plain link to here and does nothing else. Opening this page asks the server for a one-time confirm token (nothing is cancelled); only the "Confirm cancellation"
  // button below sends it back, with the optional reason. "Keep Pro" and "Confirm cancellation" are the same size and weight of honesty: no maze, no phone call, no guilt.
  import { goto } from "$app/navigation";
  import { onMount } from "svelte";
  import PageHeader from "$lib/ui/PageHeader.svelte";
  import { api, money } from "$lib/api.js";
  import { t, whenText } from "$lib/i18n/index.svelte.js";
  import { loadPlan } from "$lib/pro/plan.svelte.js";
  import PlanPiece from "$lib/billing/PlanPiece.svelte";
  import { SHORT } from "$lib/billing/billingModel.js";
  let st = $state(null), details = $state(null), problem = $state(null), busy = $state(false), token = $state(null), ready = $state(false), why = $state(null), text = $state(""), loaded = $state(false);
  const un = (r) => r.json?.data ?? r.json;
  const day = (iso) => (iso ? whenText(iso, { dateStyle: "long", timeZone: "UTC" }) : "—");
  const REASONS = () => [["too_expensive", t("Too expensive")], ["missing_feature", t("Missing a feature")], ["testing", t("Just testing")], ["other", t("Other")]];
  const onPro = $derived(["docustay_pro", "docustay_payg"].includes(st?.plan?.key) && !st?.plan?.ended);   // a plan that lives on a subscription (Lifetime is one payment: nothing to cancel)
  const ends = $derived(st?.plan?.renewsAt ?? st?.plan?.cancelsAt ?? null);
  async function prepare() {
    ready = false; token = null;
    const r = await api("/api/product/docustay/cancel/prepare", { method: "POST", body: {} });
    if (!r.ok) { problem = r.error ?? t("That did not work. Try again."); return; }
    token = un(r).token; setTimeout(() => (ready = true), 1700);   // the server also refuses a confirm sooner than 1.5 s after the page opened
  }
  onMount(async () => {
    st = await loadPlan({ force: true });
    if (st?.billing?.canManage) { const d = await api("/api/product/docustay/billing-details"); if (d.ok) details = un(d); }
    loaded = true;
    if (onPro && !st.plan.cancelsAt) await prepare();
  });
  async function confirm() {
    if (!token || !ready || busy) return;
    busy = true; problem = null;
    const r = await api("/api/product/docustay/cancel", { method: "POST", body: { token, reason: why, reasonText: why === "other" ? text : null } });
    if (r.ok) { await goto("/billing/cancelled"); return; }
    busy = false;
    const code = r.json?.error?.detail?.code;
    problem = r.error ?? t("That did not work. Try again.");
    if (code === "cancel_expired" || code === "cancel_needs_confirmation" || code === "cancel_too_quick") await prepare();
  }
</script>
<svelte:head><title>{t("Cancel {plan}", { plan: st?.plan?.name ?? "Pro" })} · {t("Billing")} · Docustay</title></svelte:head>
<PageHeader title={t("Cancel {plan}", { plan: st?.plan?.name ?? "Pro" })} />
{#if !loaded}
  <p class="mt-6 text-mute" role="status">{t("Loading…")}</p>
{:else if !onPro}
  <section class="mt-6" data-testid="cancel-not-pro"><p class="text-[15px]">{t("This workspace is not on a paid Pro plan, so there is nothing to cancel.")}</p><p class="mt-4"><a class="btn" href="/billing">{t("Back to Billing")}</a></p></section>
{:else if st.plan.cancelsAt}
  <section class="mt-6" data-testid="cancel-already"><p class="text-[15px]">{t("Pro is already cancelled and stays on until {date}.", { date: day(st.plan.cancelsAt) })}</p><p class="mt-4"><a class="btn primary" href="/billing">{t("Back to Billing")}</a></p></section>
{:else}
  <section class="mt-2" data-testid="cancel-page">
    <div class="flex items-center gap-4"><PlanPiece plan={SHORT[st?.plan?.key] ?? "pro"} size={64} glow still testid="cancel-piece" /><p class="text-[15px] text-mute">{st?.plan?.name ?? "Pro"}{details?.nextPayment ? ` · ${money(details.nextPayment.amountMinor, details.nextPayment.currency)} ${details.nextPayment.interval === "year" ? t("a year") : t("a month")}` : ""}{st.plan.founders ? `, ${t("founders price")}` : ""}</p></div>
    <Page type="split" asideWidth="24rem" class="mt-5" sticky={false}>
    <div class="grid content-start gap-5 md:grid-cols-2">
      <div class="rounded-2xl border border-line bg-card p-5">
        <h2 class="text-lg font-semibold">{t("What you keep until {date}", { date: day(ends) })}</h2>
        <ul class="mt-3 list-disc space-y-2 pl-5 text-[15px]">
          <li>{t("Everything in {plan}, exactly as it is now.", { plan: st?.plan?.name ?? "Pro" })}</li>
          <li>{t("You will not be charged again.")}</li>
          <li data-testid="cancel-no-refunds">{t("Docustay does not give refunds. The period you have paid for stays on until {date}.", { date: day(ends) })}</li>
          <li>{t("You can resume {plan} any time before that date and nothing changes.", { plan: st?.plan?.name ?? "Pro" })}</li>
        </ul>
      </div>
      <div class="rounded-2xl border border-line bg-card p-5">
        <h2 class="text-lg font-semibold">{t("What changes after that")}</h2>
        <ul class="mt-3 list-disc space-y-2 pl-5 text-[15px]">
          <li>{t("Your workspace moves to the Free plan and its limits.")}</li>
          <li>{t("Extra team members become read-only. Nobody is deleted.")}</li>
          <li>{t("Documents already sent still finish. Signing links keep working. Signed copies stay downloadable.")}</li>
          {#if st.plan.founders}<li><b>{t("Your founders price is gone for good once Pro ends.")}</b></li>{/if}
        </ul>
      </div>
    </div>
    {#snippet aside()}<div class="min-w-0">
    <fieldset class="grid gap-2"><legend class="mb-1 text-sm font-medium">{t("Why are you cancelling? (optional)")}</legend>
      {#each REASONS() as [k, label]}<label class="flex items-center gap-2 text-[15px]"><input type="radio" name="why" checked={why === k} onchange={() => (why = k)} data-testid={`cancel-why-${k}`} />{label}</label>{/each}
      {#if why === "other"}<label class="grid gap-1 text-sm"><span class="text-mute">{t("Tell us more (optional)")}</span><textarea class="field" rows="3" maxlength="500" bind:value={text} data-testid="cancel-why-text"></textarea></label>{/if}
    </fieldset>
    {#if problem}<p class="mt-4 rounded-lg border border-bad-line bg-bad-bg px-3 py-2 text-sm text-bad" role="alert" data-testid="cancel-problem">{problem}</p>{/if}
    <div class="mt-6 flex flex-wrap gap-3">
      <a class="btn primary" href="/billing" data-testid="cancel-keep">{t("Keep {plan}", { plan: st?.plan?.name ?? "Pro" })}</a>
      <button class="btn" onclick={confirm} disabled={busy || !ready} data-testid="cancel-confirm">{busy ? t("Cancelling…") : t("Confirm cancellation")}</button>
    </div>
    <p class="mt-4 text-sm text-mute">{t("Cancelling takes this one step, online. You do not need to call anyone.")}</p>
    </div>{/snippet}
    </Page>
  </section>
{/if}
