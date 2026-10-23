<script>
  // BILLING — the plan and what was collected (Launch step 7): "Plan" is the subscription, usage and invoices; "Payments" is the money collected through payment fields in documents and forms (it was a sidebar row of its own).
  import PageHeader from "$lib/ui/PageHeader.svelte"; import ApiCall from "$lib/ui/ApiCall.svelte"; import Tabs from "$lib/ui/Tabs.svelte";
  import { t } from "$lib/i18n/index.svelte.js";
  import { edition } from "$lib/edition.svelte.js";
  import BillingPlan from "$lib/screens/BillingPlan.svelte";
  import Payments from "$lib/screens/Payments.svelte";
  import StripeAccount from "$lib/payments/StripeAccount.svelte";
  let want = $state(typeof location !== "undefined" && ["payments", "invoices"].includes(new URLSearchParams(location.search).get("tab")) ? new URLSearchParams(location.search).get("tab") : "plan");
  const tab = $derived(edition.selfHost ? "payments" : want);   // a self-hosted install has no plan: only the money collected through payment fields
  const pick = (k) => { want = k; history.replaceState(null, "", k === "plan" ? location.pathname : `?tab=${k}`); };
</script>
<svelte:head><title>{tab === "payments" ? t("Payments") : tab === "invoices" ? t("Invoices") : t("Plan")} · {t("Billing")} · Docustay</title></svelte:head>
<PageHeader title={edition.selfHost ? t("Payments") : t("Billing")}>{#snippet actions()}<ApiCall path="/api/v1/usage" />{/snippet}</PageHeader>
{#if !edition.selfHost}
<Tabs class="mb-4" label={t("Billing sections")} testid="billing-tabs" idPrefix="billing-tab" value={tab} onchange={pick} items={[{ value: "plan", label: t("Plan") }, { value: "invoices", label: t("Invoices") }, { value: "payments", label: t("Payments") }]} />
{/if}
{#if !edition.selfHost}<p class="mb-4 text-[13px] text-mute" data-testid="billing-tab-line">{tab === "payments" ? t("What signers pay you.") : t("What you pay Docustay.")}</p>{/if}
{#if tab === "payments"}{#if !edition.selfHost}<StripeAccount />{/if}{#if edition.rank !== "member"}<Payments embedded />{:else if edition.selfHost}<p class="max-w-2xl text-[13px] text-mute" role="status" data-testid="payments-member">{t("Payments collected through documents are kept by an owner or an admin of this workspace. Ask one of them for a payment's details.")}</p>{/if}{:else}<BillingPlan embedded part={tab} />{/if}
