<script>
  // MOTION 1 · BUILDING A FORM (Run 8 board, piece 2): each field drops onto the page from above with a little depth, in the order Scribe adds it. Small (in the chat) or large (the live build).
  // `fields` (optional) are labels to show; `count` moves it on with real progress. Reduced motion: the finished page, still.
  let { size = "sm", fields = null, count = null, done = false } = $props();
  const rows = $derived(fields?.length ? fields : ["", "", "", ""]);
  const shown = $derived(count == null ? rows.length : Math.max(1, Math.min(rows.length, count)));
</script>
<span class="fd {size}" class:done aria-hidden="true">
  <span class="pg">
    {#each rows as f, i}<span class="row" class:off={i >= shown} class:file={i === rows.length - 1 && !fields} style="--d:{i * 0.5}s">{#if size === "lg" && f}<b>{f}</b>{/if}<i></i></span>{/each}
    <span class="sig" style="--d:{rows.length * 0.5}s"></span>
  </span>
</span>
<style>
  .fd { display: inline-grid; place-items: center; perspective: 800px; flex: none; }
  .pg { display: flex; flex-direction: column; gap: 5px; width: 34px; height: 42px; padding: 6px 5px; box-sizing: border-box; background: #fff; border: 1px solid #e3e1f5; border-radius: 4px; box-shadow: 0 6px 14px rgb(90 58 193 / .14); transform: rotateX(28deg); transform-style: preserve-3d; }
  .lg .pg { width: 200px; height: 230px; padding: 22px; gap: 12px; border-radius: 6px; box-shadow: 0 24px 50px rgb(40 25 100 / .16); }
  .row { display: grid; gap: 3px; animation: fd-drop 3.6s cubic-bezier(.2,.8,.2,1) var(--d) infinite; }
  .row i { display: block; height: 5px; border: 1px solid #c9c6f4; border-radius: 2px; }
  .lg .row i { height: 22px; border-width: 1.5px; border-radius: 5px; }
  .row.file i { border-style: dashed; border-color: #8585fd; background: #f8f7ff; }
  .lg .row.file i { height: 40px; }
  .row b { font-size: 10px; font-weight: 500; color: #5d5d6b; }
  .row.off { opacity: .15; animation: none; }
  .sig { display: block; height: 1px; background: #16161d; margin-top: auto; animation: fd-drop 3.6s cubic-bezier(.2,.8,.2,1) var(--d) infinite; }
  .lg .sig { height: 2px; }
  .done .row, .done .sig { animation: none; opacity: 1; }
  @keyframes fd-drop { 0%, 10% { opacity: 0; transform: translateZ(60px) translateY(-14px); } 30%, 100% { opacity: 1; transform: none; } }
  @media (prefers-reduced-motion: reduce) { .row, .sig { animation: none !important; } }
  :global(html[data-lite]) .row, :global(html[data-lite]) .sig { animation-duration: 1ms; animation-iteration-count: 1; }
</style>
