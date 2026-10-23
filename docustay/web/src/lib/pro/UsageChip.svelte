<script>
  // THE USAGE CHIP (v1 item 23; V1-PLATFORM-UI 7.1): a small bar in the sidebar that says what this month has cost so far against the budget, and opens Billing. A Free workspace has no money to show,
  // so it sees its documents instead ("7 of 15 documents this month"). Read from the one plan copy (GET /api/product/docustay/status); a self-hosted install has no plan and shows nothing.
  import { plan } from "$lib/pro/plan.svelte.js";
  import { t } from "$lib/i18n/index.svelte.js";
  import { usd } from "$lib/pro/money.js";
  const b = $derived(plan.data?.budget ?? null), u = $derived(plan.data?.usage ?? null), p = $derived(plan.data?.plan ?? null);
  const pct = $derived(b ? Math.min(100, b.percent) : u?.documentsLimit ? Math.min(100, Math.round((u.documentsThisMonth / u.documentsLimit) * 100)) : 0);
  const per = $derived(u?.periodKind === "billing"), ends = $derived(u?.periodEnd ? new Date(u.periodEnd).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "");
  const tone = $derived(pct >= 100 ? "bg-bad" : pct >= 80 ? "bg-warn" : "bg-ok");
</script>
{#if p && (b || u?.documentsLimit != null)}
  <a href="/billing" class="usage-chip hidden flex-col gap-1.5 border-t border-line px-1 pb-1 pt-3 text-[12.5px] no-underline text-mute hover:text-ink wide:flex" data-testid="usage-chip" aria-label={t("Usage this month. Open Billing.")}>
    {#if b}
      <span class="[text-wrap:balance]">{b.paused ? t("Paused: budget reached") : per && ends ? t("{used} of your {budget} budget · resets {date}", { used: usd(b.usedMinor), budget: usd(b.budgetMinor), date: ends }) : t("This month: {used} of your {budget} budget", { used: usd(b.usedMinor), budget: usd(b.budgetMinor) })}</span>
    {:else}
      <span class="[text-wrap:balance]">{ends ? t("{used} of {limit} documents · resets {date}", { used: u.documentsThisMonth, limit: u.documentsLimit, date: ends }) : t("{used} of {limit} documents this month", { used: u.documentsThisMonth, limit: u.documentsLimit })}</span>
    {/if}
    <span class="h-1 w-full overflow-hidden rounded-full" role="presentation" style="background: var(--line)"><span class="block h-full {tone}" style="width:{pct}%"></span></span>
  </a>
{/if}
