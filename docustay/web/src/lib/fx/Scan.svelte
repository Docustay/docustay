<script>
  // MOTION 1 · READING YOUR PDF (Run 8 board, piece 4): a soft violet band passes down the page while an uploaded file is read. Small beside a sentence, or large. Reduced motion: the page, still.
  let { size = "sm", label = "", testid = "fx-scan" } = $props();
</script>
<span class="sc {size}" role="status" aria-live="polite" data-testid={testid}>
  <span class="pg" aria-hidden="true"><i></i><i style="--w:70%"></i><i></i><i style="--w:85%"></i><i></i><i style="--w:60%"></i><b class="band"></b></span>
  {#if label}<span class="lb">{label}</span>{/if}
</span>
<style>
  .sc { display: inline-flex; align-items: center; gap: 12px; }
  .pg { position: relative; display: flex; flex-direction: column; gap: 4px; width: 34px; height: 42px; padding: 7px 6px; box-sizing: border-box; background: #fff; border-radius: 4px; box-shadow: 0 6px 14px rgb(40 25 100 / .14); overflow: hidden; flex: none; }
  .lg .pg { width: 170px; height: 210px; padding: 20px; gap: 9px; border-radius: 6px; box-shadow: 0 16px 36px rgb(40 25 100 / .14); }
  i { display: block; height: 2px; width: var(--w, 100%); border-radius: 2px; background: #e4e4ec; } .lg i { height: 4px; }
  .band { position: absolute; left: 0; right: 0; top: 0; height: 30%; background: linear-gradient(180deg, rgb(133 133 253 / 0), rgb(133 133 253 / .28), rgb(133 133 253 / 0)); animation: sc-scan 2.2s ease-in-out infinite alternate; }
  .lb { color: var(--ink); font-size: 14px; }
  @keyframes sc-scan { from { transform: translateY(-20%); } to { transform: translateY(260%); } }
  @media (prefers-reduced-motion: reduce) { .band { animation: none; transform: translateY(100%); } }
  :global(html[data-lite]) .band { animation-duration: 4s; }
</style>
