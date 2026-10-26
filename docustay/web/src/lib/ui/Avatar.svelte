<script>
  // A 20px avatar: initials on the accent tint. `size` changes the box; the colour never varies by person (one accent).
  let { name = "", size = 20, class: cls = "" } = $props();
  const initials = $derived(String(name).trim().split(/\s+/).map((w) => w[0] ?? "").slice(0, 2).join("").toUpperCase() || "?");
</script>
<span class="inline-grid shrink-0 place-items-center rounded-full bg-accent-soft font-semibold text-accent-ink {cls}" style="width:{size}px;height:{size}px;font-size:{Math.max(9, Math.round(size * 0.42))}px" title={name || undefined} aria-hidden="true">{initials}</span>
