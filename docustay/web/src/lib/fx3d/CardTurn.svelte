<script>
  // BILLING 5 · WHEN A PAYMENT FAILS: the old (expired) card turns over into the new one once it is saved (`turned`). Real text on both faces. Reduced motion or a slow device: the
  // face that is true now, no turn.
  let { last4 = "", exp = "", newLast4 = "", newExp = "", turned = false, expiredLabel = "EXPIRED", testid = "fx-card-turn" } = $props();
</script>
<div class="ct" data-testid={testid}>
  <div class="cd" class:turned>
    <div class="f old"><span class="tag">{expiredLabel}</span><span class="no">•••• {last4} · {exp}</span></div>
    <div class="f new"><span class="chip"></span><span class="no">•••• {newLast4 || last4} · {newExp || exp}</span></div>
  </div>
</div>
<style>
  .ct { perspective: 900px; width: 220px; height: 136px; }
  .cd { position: relative; width: 100%; height: 100%; transform-style: preserve-3d; transition: transform 800ms cubic-bezier(.2,.8,.2,1); }
  .cd.turned { transform: rotateY(180deg); }
  .f { position: absolute; inset: 0; border-radius: 12px; padding: 14px 16px; display: grid; align-content: space-between; color: #fff; backface-visibility: hidden; font: 500 14px/1 var(--font-mono, monospace); }
  .old { background: linear-gradient(150deg, #6b6878, #8d8a99); } .tag { font-size: 11px; letter-spacing: .12em; opacity: .9; text-transform: uppercase; }
  .new { background: linear-gradient(150deg, #1c1b22, #34323d); transform: rotateY(180deg); } .chip { width: 30px; height: 22px; border-radius: 5px; background: #e8d9a0; }
  @media (prefers-reduced-motion: reduce) { .cd { transition: none; } }
  :global(html[data-lite]) .cd { transition: none; }
</style>
