<script>
  // PAY 2 · THE CARD: a payment card that tilts slowly while the signer pays. Decoration only — the real card is typed into Stripe's own secure box under it, and nothing here shows
  // a real card number. Reduced motion or a slow device: the card still.
  let { note = "", amount = "", testid = "fx-pay-card" } = $props();
</script>
<div class="pc" data-testid={testid}>
  <div class="card"><span class="shine" aria-hidden="true"></span><span class="chip" aria-hidden="true"></span><span class="no" aria-hidden="true">•••• •••• •••• ••••</span><span class="row"><span class="nt">{note}</span>{#if amount}<b>{amount}</b>{/if}</span></div>
</div>
<style>
  .pc { perspective: 900px; }
  .card { position: relative; display: grid; align-content: space-between; height: 124px; padding: 16px; border-radius: 14px; overflow: hidden; color: #fff; background: linear-gradient(135deg, #2a1a6b, #5a3ac1 60%, #8585fd); box-shadow: 0 20px 40px rgb(90 58 193 / .35); transform-style: preserve-3d; animation: pc-tilt 6s ease-in-out infinite; }
  .shine { position: absolute; inset: 0; background: linear-gradient(115deg, rgb(255 255 255 / 0) 30%, rgb(255 255 255 / .4) 50%, rgb(255 255 255 / 0) 70%); background-size: 200% 100%; animation: pc-shine 3s linear infinite; }
  .chip { width: 30px; height: 22px; border-radius: 4px; background: #e9d8a6; }
  .no { font: 500 14px/1 var(--font-mono, monospace); letter-spacing: .12em; }
  .row { display: flex; justify-content: space-between; align-items: end; gap: 12px; font-size: 11px; } .nt { opacity: .85; } .row b { font-size: 15px; }
  @keyframes pc-tilt { 0%, 100% { transform: rotateY(-18deg) rotateX(10deg); } 50% { transform: rotateY(12deg) rotateX(4deg) translateZ(16px); } }
  @keyframes pc-shine { from { background-position: -200% 0; } to { background-position: 200% 0; } }
  @media (prefers-reduced-motion: reduce) { .card, .shine { animation: none; } }
  :global(html[data-lite]) .card, :global(html[data-lite]) .shine { animation: none; }
</style>
