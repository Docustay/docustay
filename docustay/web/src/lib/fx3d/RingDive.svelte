<script>
  // BILLING 2 · TAKING YOU TO SECURE CHECKOUT: the Pro card dives through a turning ring into Stripe — under a second, and the page never goes blank (the words stay). Plays once.
  // Reduced motion or a slow device: the card and the ring, still.
  let { label = "", testid = "fx-ring-dive" } = $props();
</script>
<div class="rd" role="status" aria-live="polite" data-testid={testid}>
  <div class="scene" aria-hidden="true"><span class="ring r1"></span><span class="ring r2"></span><span class="card"></span></div>
  {#if label}<p class="lb">{label}</p>{/if}
</div>
<style>
  .rd { display: grid; justify-items: center; gap: 18px; }
  .scene { position: relative; width: 220px; height: 220px; perspective: 700px; display: grid; place-items: center; }
  .ring { position: absolute; border-radius: 50%; border: 2px dashed #8f8af8; background: radial-gradient(circle, rgb(127 123 246 / .12), transparent 70%); }
  .r1 { inset: 0; animation: rd-turn 6s linear infinite; } .r2 { inset: 34px 22px; border-style: solid; border-color: #d9d6fb; transform: rotateX(62deg); }
  .card { width: 26px; height: 38px; border-radius: 4px; background: linear-gradient(160deg, #b7b2f6, #7f7bf6); box-shadow: 0 8px 18px rgb(90 58 193 / .3); animation: rd-dive 900ms cubic-bezier(.5,0,.2,1) 150ms both; }
  .lb { margin: 0; font-size: var(--t-body, 15px); color: var(--ink); }
  @keyframes rd-turn { to { transform: rotate(360deg); } }
  @keyframes rd-dive { 0% { transform: translateZ(140px) scale(1.6); opacity: 0; } 30% { opacity: 1; } 100% { transform: translateZ(-260px) scale(.4); opacity: .2; } }
  @media (prefers-reduced-motion: reduce) { .r1, .card { animation: none; } }
  :global(html[data-lite]) .r1, :global(html[data-lite]) .card { animation: none; }
</style>
