<script>
  // A sparkline: a hand-built SVG line (d3-free). The line draws left to right once, the area fades in. values: numbers.
  let { values = [], width = 120, height = 32, tone = "var(--brand)", label = "" } = $props();
  const pts = $derived.by(() => { if (values.length < 2) return []; const mx = Math.max(...values), mn = Math.min(...values), r = mx - mn || 1; return values.map((v, i) => [(i / (values.length - 1)) * width, height - 2 - ((v - mn) / r) * (height - 4)]); });
  const line = $derived(pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" "));
</script>
<svg {width} {height} viewBox="0 0 {width} {height}" role={label ? "img" : undefined} aria-label={label || undefined} aria-hidden={label ? undefined : "true"} class="overflow-visible">
  {#if pts.length}<path d="{line} L{width} {height} L0 {height} Z" fill={tone} fill-opacity=".12" class="fill-in" /><path d={line} fill="none" stroke={tone} stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" pathLength="1" class="draw" />{/if}
</svg>
