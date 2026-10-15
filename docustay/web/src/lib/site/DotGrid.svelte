<script>
  // A dot or line grid behind a section; `glow` adds a soft accent glow at the top.
  let { children, lines = false, glow = false, class: cls = "" } = $props();
</script>
<div class="relative isolate {lines ? 'line-grid' : 'dot-grid'} {cls}">{#if glow}<div class="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[28rem]" style="background: radial-gradient(50% 60% at 50% 0%, var(--accent-soft), transparent 75%)"></div>{/if}{@render children?.()}</div>
