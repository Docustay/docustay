<script>
  // Daily bars: hand-built SVG. Bars grow from the baseline with a 40 ms stagger. data: [{ label, value }]
  let { data = [], height = 120, tone = "var(--brand)", label = "" } = $props();
  const mx = $derived(Math.max(1, ...data.map((d) => d.value)));
</script>
<div class="flex items-end gap-1" style="height:{height}px" role={label ? "img" : undefined} aria-label={label || undefined}>
  {#each data as d, i (d.label ?? i)}<div class="group relative flex-1" style="height:100%"><div class="grow-y absolute bottom-0 w-full rounded-t-[3px]" style="--i:{i};height:{Math.max(2, (d.value / mx) * 100)}%;background:{tone};opacity:.85" title="{d.label}: {d.value}"></div></div>{/each}
</div>
