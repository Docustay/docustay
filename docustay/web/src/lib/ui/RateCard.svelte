<script>
  // A rate (delivered, bounced, declined): a big percentage, a name, and a bar that grows. tone: ok | warn | bad
  let { label, rate = 0, count = null, tone = "ok" } = $props();
</script>
<div class="rounded-xl border border-line bg-card p-4"><div class="flex items-baseline justify-between"><span class="text-sm text-mute">{label}</span>{#if count !== null}<span class="font-mono text-xs text-faint tabular-nums">{count}</span>{/if}</div>
<div class="mt-1 text-2xl font-semibold tabular-nums">{rate}%</div>
<div class="mt-2 h-1.5 overflow-hidden rounded-full bg-tint"><div class="grow-x h-full rounded-full" style="width:{Math.min(100, rate)}%;background:var(--{tone})"></div></div></div>
