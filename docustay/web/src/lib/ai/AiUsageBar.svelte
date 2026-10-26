<script>
  // THE USAGE BAR (AI-COST-AND-USAGE-SPEC §6): "6 of 10 credits used", the percent, "Resets on 1 Nov", a breakdown. Calm under 80 percent, amber from 80 ("You are running low"), red at 100 with the reason and what to do.
  // A workspace with its own provider key sees one line instead of a bar. Every number is read from the cost ledger. `compact` is the small form in the Scribe panel.
  import { onMount } from "svelte";
  import Meter from "$lib/ui/Meter.svelte";
  import { live } from "$lib/live.js";
  import { t, whenText } from "$lib/i18n/index.svelte.js";
  import { aiUsage, loadAiUsage } from "./usage.svelte.js";
  import PlanPrompt from "$lib/pro/PlanPrompt.svelte";
  import { plan as planStore } from "$lib/pro/plan.svelte.js";
  import { usd } from "$lib/pro/money.js";
  import { edition } from "$lib/edition.svelte.js";
  let { compact = false, preClick = false } = $props();
  onMount(() => { loadAiUsage(); return live(["ai", "billing", "settings"], () => loadAiUsage()); });
  const u = $derived(aiUsage.data);
  // v1 item 23: the price of one more draft past the included amount ($0.30 on Pay as you go, Pro and Lifetime; Free has none and stops)
  const over = $derived(planStore.data?.plans?.find((p) => p.key === planStore.data?.plan?.key)?.draftOverMinor ?? null);
  const num = (n) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n ?? 0);
  // R8-68: Free's window is the calendar month (midnight UTC, said as a UTC date like every other monthly limit); Pro's follows the billing period, so it is said in local time like "Renews …"
  const resets = $derived(u?.resetsAt ? whenText(u.resetsAt, { day: "numeric", month: "short", timeZone: "UTC" })   /* R13-D214: the period ends in UTC on every meter; a local date showed the day before */ : "");
  const rows = $derived(u?.byFeature ? [[t("Drafts"), u.byFeature.drafts], [t("Edits"), u.byFeature.edits], [t("File reading"), u.byFeature.file_reading]] : []);
</script>
{#if u}
  {#if u.mode === "own_key"}
    <p class="text-sm text-mute" data-testid="ai-usage-own">{t("Using your own provider key")} · <a class="underline" href="/settings?tab=ai">{t("Change it in Settings")}</a></p>
  {:else if u.mode === "unmetered"}
    <!-- R13-D290: a self-hosted install has no plan and no limit; the card said nothing under its heading. It says so, and what this month's drafting used. -->
    <div class="grid gap-1.5" data-testid="ai-usage-unmetered">
      <p class="text-sm text-mute">{edition.selfHost ? t("No limit on this install: drafts use the AI key in your server's settings.") : t("No AI drafting limit applies to this workspace.")}</p>
      <!-- R13-D334: with no plan nothing is priced in credits (every call counts 0), so the unmetered card counts the calls themselves -->
      {#if !compact && rows.length}
        <ul class="mt-1 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2" data-testid="ai-usage-breakdown">{#each rows as [name, r]}<li class="flex justify-between gap-3"><span class="text-mute">{name}</span><span class="tabular-nums">{num(r?.calls)}</span></li>{/each}</ul>
      {/if}
    </div>
  {:else if u.mode === "hosted"}
    <div class="grid gap-1.5" data-testid="ai-usage" data-state={u.state}>
      <Meter value={u.used} max={u.allowance} label={compact ? t("AI drafts") : t("AI drafts this month")} detail={compact ? `${num(u.used)} / ${num(u.allowance)} · ${t("resets {date}", { date: resets })}` : `${num(u.used)} / ${num(u.allowance)} · ${u.percent}%`} auto testid="ai-usage-meter" />
      <p class="text-sm tabular-nums" class:sr-only={compact} data-testid="ai-usage-line">{t("Drafts this month: {used} of {allowance} free", { used: num(u.used), allowance: num(u.allowance) })} <span class="text-mute">· {t("Resets on {date}", { date: resets })}</span></p>
      {#if u.state === "paused"}<p class="notice warn text-sm" role="alert" data-testid="ai-usage-paused">{t("AI is paused for everyone right now. Your documents are safe, and the guided builder still works. It will be back soon.")}</p>
      {/if}
      <PlanPrompt action="ai_draft" id="ai" watch={u.used} kinds={preClick ? ["blocked", "price", "soft", "info"] : ["blocked", "price", "soft"]} />
      {#if over != null && u.state !== "used"}<p class="text-xs text-mute" data-testid="ai-usage-price">{t("Past your included drafts, each costs {price}.", { price: usd(over) })}</p>{/if}
      {#if !compact && rows.length}
        <ul class="mt-1 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2" data-testid="ai-usage-breakdown">{#each rows as [name, r]}<li class="flex justify-between gap-3"><span class="text-mute">{name}</span><span class="tabular-nums">{num(r?.credits)}</span></li>{/each}</ul>
      {/if}
    </div>
  {/if}
{/if}
