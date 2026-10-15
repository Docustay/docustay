<script>
  // BILLING — the plan and what was collected (Launch step 7): "Plan" is the subscription, usage and invoices; "Payments" is the money collected through payment fields in documents and forms (it was a sidebar row of its own).
  import PageHeader from "$lib/ui/PageHeader.svelte"; import ApiCall from "$lib/ui/ApiCall.svelte";
  import { t } from "$lib/i18n/index.svelte.js";
  import { edition } from "$lib/edition.svelte.js";
  import BillingPlan from "$lib/screens/BillingPlan.svelte";
  import Payments from "$lib/screens/Payments.svelte";
  let want = $state(typeof location !== "undefined" && new URLSearchParams(location.search).get("tab") === "payments" ? "payments" : "plan");
  const tab = $derived(edition.selfHost ? "payments" : want);   // a self-hosted install has no plan: only the money collected through payment fields
  const pick = (k) => { want = k; history.replaceState(null, "", k === "payments" ? "?tab=payments" : location.pathname); };
</script>
<svelte:head><title>{tab === "payments" ? t("Payments") : t("Plan")} · {t("Billing")} · Docustay</title></svelte:head>
<PageHeader title={edition.selfHost ? t("Payments") : t("Billing")}>{#snippet actions()}<ApiCall path="/api/v1/usage" />{/snippet}</PageHeader>
{#if !edition.selfHost}
<nav class="-mt-2 mb-5 flex gap-1 border-b border-line pb-2" role="tablist" aria-label={t("Billing sections")} data-testid="billing-tabs">{#each [["plan", t("Plan")], ["payments", t("Payments")]] as [k, l]}<button role="tab" aria-selected={tab === k} class="btab {tab === k ? 'on' : ''}" onclick={() => pick(k)} data-testid="billing-tab-{k}">{l}</button>{/each}</nav>
{/if}
{#if tab === "payments"}<Payments embedded />{:else}<BillingPlan embedded />{/if}
<style>
  .btab { padding: 7px 12px; border-radius: 9px; font-size: 13.5px; color: var(--mute); } .btab:hover { color: var(--ink); background: var(--tint); } .btab.on { background: var(--tint); color: var(--ink); font-weight: 500; }
</style>
