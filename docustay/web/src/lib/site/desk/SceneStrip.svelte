<script>
  // A slim band with a caption above a working tool (V3: the tool itself is the hero, so there is no 3D here). `scene` is ignored.
  let { scene = undefined, eyebrow = "", children } = $props();
</script>
<div class="d-wrap ss"><div class="card"><div class="cap">{#if eyebrow}<p class="d-eyebrow">{eyebrow}</p>{/if}<div class="t">{@render children?.()}</div></div></div></div>
<style>
  .ss { padding-top: 112px; padding-bottom: 8px; } .card { border-bottom: 1px solid var(--ln-1); padding-bottom: 22px; }
  .cap .d-eyebrow { margin: 0 0 10px; } .t { font: 400 clamp(1.8rem, 3.2vw, 2.6rem)/1.1 var(--f-display); letter-spacing: -.01em; color: var(--tx-1); } .t :global(em) { color: var(--v-400); }
</style>
