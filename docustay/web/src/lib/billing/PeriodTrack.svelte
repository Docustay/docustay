<script>
  // "This period" as a track from the period's first day to its last, with a marker for today (combined style, Billing). The dates are the status payload's own (usage.periodStart and
  // usage.periodEnd, the billing period for paying workspaces); nothing here is computed from a plan. `sentence` is the one line under the track.
  import { t, whenText } from "$lib/i18n/index.svelte.js";
  let { start = "", end = "", sentence = "", testid = "billing-period" } = $props();
  const a = $derived(start ? Date.parse(start) : NaN), b = $derived(end ? Date.parse(end) : NaN);
  const frac = $derived(Number.isFinite(a) && Number.isFinite(b) && b > a ? Math.min(1, Math.max(0, (Date.now() - a) / (b - a))) : null);
  const fmt = (d) => whenText(d, { month: "short", day: "numeric", timeZone: "UTC" });
</script>
{#if frac !== null}
  <div class="period" data-testid={testid}>
    <div class="flex items-baseline justify-between text-[12px] text-mute"><span>{fmt(start)}</span><span>{fmt(end)}</span></div>
    <div class="track" role="img" aria-label={t("Today is {pct}% of the way through this period", { pct: Math.round(frac * 100) })}><i class="fill" style="width:{frac * 100}%"></i><b class="today" style="left:{frac * 100}%"></b></div>
    {#if sentence}<p class="mt-1.5 text-[12.5px] text-mute">{sentence}</p>{/if}
  </div>
{/if}
<style>
  .track { position: relative; height: 2px; margin: 10px 0 4px; background: var(--stage-off); }
  .fill { position: absolute; inset: 0 auto 0 0; background: var(--brand); }
  .today { position: absolute; top: 50%; width: 10px; height: 10px; margin: -5px 0 0 -5px; border-radius: 9999px; background: var(--card); border: 2px solid var(--brand); }
</style>
