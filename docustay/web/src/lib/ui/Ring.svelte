<script>
  // A small progress ring (SVG): usage. The arc sweeps to its value.
  let { value = 0, max = 100, size = 44, stroke = 5, tone = "var(--brand)", label = "" } = $props();
  const r = $derived((size - stroke) / 2), c = $derived(2 * Math.PI * r), pct = $derived(max > 0 ? Math.min(1, value / max) : 0);
</script>
<svg width={size} height={size} viewBox="0 0 {size} {size}" role="img" aria-label={label || `${Math.round(pct * 100)}%`}>
  <circle cx={size / 2} cy={size / 2} {r} fill="none" stroke="var(--line-strong)" stroke-width={stroke} />
  <circle cx={size / 2} cy={size / 2} {r} fill="none" stroke={tone} stroke-width={stroke} stroke-linecap="round" stroke-dasharray={c} stroke-dashoffset={c * (1 - pct)} transform="rotate(-90 {size / 2} {size / 2})" style="transition: stroke-dashoffset var(--dur-hero) var(--ease-out)" />
</svg>
