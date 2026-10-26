<script>
  // THE TEMPLATE METER, ON SCREEN (Run 8, the maintainer: Free makes 5 new templates a month). "2 of 5 new templates this month" and a bar. What to say about it (the last one, the limit, the options) is the plan prompt's job (PlanPrompt.svelte), once, in one place. The numbers are the server's (`usage.templatesThisMonth / templatesLimit / resetsAt` from /api/product/docustay/status); Pro and a
  // self-hosted install have no limit, so nothing is shown. The bar fills calmly (motion board 2 piece 6); no red until it is really used.
  import { onMount } from "svelte";
  import { t, whenText } from "$lib/i18n/index.svelte.js";
  import { plan, loadPlan } from "./plan.svelte.js";
  let { compact = false, testid = "template-usage" } = $props();
  onMount(() => { loadPlan({ force: true }); });
  const u = $derived(plan.data?.usage);
  const limit = $derived(u?.templatesLimit ?? null), used = $derived(u?.templatesThisMonth ?? 0);
  const state = $derived(limit == null ? "none" : used >= limit ? "used" : used >= limit - 1 ? "low" : "calm");
  const resets = $derived(u?.resetsAt ? whenText(u.resetsAt, { day: "numeric", month: "long", timeZone: "UTC" }) : "");
  const pct = $derived(limit ? Math.min(100, Math.round((used / limit) * 100)) : 0);
</script>
{#if plan.loaded && limit != null}
  <div class="tu" class:compact data-state={state} data-testid={testid}>
    <div class="row"><span class="lbl">{t("New templates this month")}</span><span class="num tabular-nums" data-testid="{testid}-count">{t("{used} of {limit}", { used, limit })}</span></div>
    <div class="bar" aria-hidden="true"><i style="transform:scaleX({pct / 100})"></i></div>
    {#if !compact}<p class="msg mute">{t("Resets on {date}. Editing a template never counts.", { date: resets })}</p>{/if}
    {#if state === "used" && !compact}<p class="msg" data-testid="{testid}-cap">{t("Your {plan} plan includes {n} new templates a month. Pro has no limit.", { plan: plan.data?.plan?.name ?? "Free", n: limit })} <a href="https://docustay.app/pricing#pro" data-testid="{testid}-explore">{t("Explore Pro")}</a></p>{/if}   <!-- R13-D531: the meter says why the doors are greyed and where to go -->
  </div>
{/if}
<style>
  .tu { display: grid; gap: 6px; font-size: 13px; }
  .row { display: flex; justify-content: space-between; gap: 12px; }
  .lbl { color: var(--ink); } .num { color: var(--mute); }
  .bar { height: 6px; border-radius: 6px; background: var(--tint); overflow: hidden; }
  .bar i { display: block; height: 100%; border-radius: 6px; transform-origin: left; background: linear-gradient(110deg, var(--brand) 30%, color-mix(in srgb, var(--brand) 55%, #fff) 50%, var(--brand) 70%); background-size: 220% 100%; transition: transform var(--dur-slow, 520ms) var(--ease-out, ease-out); animation: tu-sheen 3s linear infinite; }
  [data-state="low"] .bar i { background: var(--warn, #b45309); animation: none; }
  [data-state="used"] .bar i { background: var(--bad, #b42318); animation: none; }
  .msg { margin: 0; line-height: 1.45; } .mute { color: var(--mute); }
  @keyframes tu-sheen { 0% { background-position: -160% 0; } 100% { background-position: 160% 0; } }
  @media (prefers-reduced-motion: reduce) { .bar i { transition: none; animation: none; } }
  :global(html[data-lite]) .bar i { animation: none; }
</style>
