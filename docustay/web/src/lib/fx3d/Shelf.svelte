<script>
  // MOTION 5 · THE TEMPLATE SHELF (Run 9 board): ready-made templates and forms slide past in 3D; the one in front comes forward. A plain horizontally scrolling list (keyboard and
  // touch scroll it as usual); on scroll each card's distance from the middle sets its turn and depth. Reduced motion or a slow device: a flat row, nothing turns.
  import { onMount } from "svelte";
  let { children, label = "", testid = "fx-shelf" } = $props();
  let el = $state(null);
  onMount(() => {
    if (!el || matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.hasAttribute("data-lite")) return;
    let raf = 0;
    const paint = () => { raf = 0; const mid = el.scrollLeft + el.clientWidth / 2;
      for (const c of el.children) { const d = Math.max(-1, Math.min(1, (c.offsetLeft + c.offsetWidth / 2 - mid) / (el.clientWidth / 2)));
        c.style.transform = `perspective(1200px) rotateY(${(-d * 26).toFixed(2)}deg) translateZ(${((1 - Math.abs(d)) * 36).toFixed(1)}px)`; c.style.opacity = String(1 - Math.abs(d) * 0.35); } };
    const on = () => { if (!raf) raf = requestAnimationFrame(paint); };
    paint(); el.addEventListener("scroll", on, { passive: true }); addEventListener("resize", on);
    return () => { el.removeEventListener("scroll", on); removeEventListener("resize", on); cancelAnimationFrame(raf); };
  });
</script>
<div class="shelf" bind:this={el} tabindex="0" role="list" aria-label={label} data-testid={testid}>{@render children?.()}</div>
<style>
  .shelf { display: flex; gap: var(--s-4); overflow-x: auto; scroll-snap-type: x mandatory; padding: var(--s-5) var(--s-2); scrollbar-width: thin; transform-style: preserve-3d; }
  .shelf > :global(*) { flex: none; scroll-snap-align: center; transition: transform 120ms linear, opacity 120ms linear; will-change: transform; }
</style>
