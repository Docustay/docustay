<script>
  // One icon family (Lucide, ISC) behind one name map (lib/ui/icons.js). Decorative unless a label is given.
  // `draw` plays a draw-in once when the icon scrolls into view; `open` cross-rotates a menu/close pair; reduced motion shows the finished icon.
  import { ICONS } from "./icons.js";
  let { name, size = 18, label = null, strokeWidth = 1.8, draw = false, open = undefined, class: cls = "" } = $props();
  const Cmp = $derived(ICONS[name] ?? ICONS.info);
  let el = $state(null), play = $state(false);
  $effect(() => {
    if (!draw || !el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { play = true; io.disconnect(); } }, { threshold: 0.6 });
    io.observe(el); return () => io.disconnect();
  });
</script>
<span bind:this={el} class="inline-flex shrink-0 {draw ? 'icon-draw' : ''} {open !== undefined ? 'icon-swap' : ''} {cls}" data-play={play ? "" : undefined} data-open={open === undefined ? undefined : String(open)} style="width:{size}px;height:{size}px" role={label ? "img" : undefined} aria-label={label ?? undefined} aria-hidden={label ? undefined : "true"}>
  <Cmp {size} {strokeWidth} />
</span>
