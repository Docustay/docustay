<script>
  // A seal coin turning in CSS 3D (the visual kit). Decorative; still under reduced motion.
</script>
<div class="coin-wrap" aria-hidden="true"><div class="coin"><span class="face f"><b>D</b></span><span class="face bk"><b>✓</b></span></div></div>
<style>
  .coin-wrap { perspective: 700px; display: grid; place-items: center; height: 160px; } .coin { width: 112px; height: 112px; position: relative; transform-style: preserve-3d; animation: spin 6s linear infinite; }
  .face { position: absolute; inset: 0; border-radius: 50%; display: grid; place-items: center; backface-visibility: hidden; background: radial-gradient(circle at 35% 30%, #e4e0ff, #8585fd 60%, #4c2fb0); border: 4px solid #faf8f3; box-shadow: inset 0 0 0 6px rgb(0 0 0 / .12); }
  .face b { font: 700 44px/1 var(--font-sans); color: #faf8f3; letter-spacing: -.04em; } .bk { transform: rotateY(180deg); }
  @keyframes spin { to { transform: rotateY(360deg); } } @media (prefers-reduced-motion: reduce) { .coin { animation: none; transform: rotateY(-20deg); } }
</style>
