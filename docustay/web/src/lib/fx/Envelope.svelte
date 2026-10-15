<script>
  // MOTION 3 · DOCUMENT SENT (Run 8 board, Done 2): the page drops into an envelope, the flap folds shut in 3D, and the envelope glides off. Plays once, about 1.6 s, beside the words — never in
  // front of a control. CSS 3D (perspective + rotateX on the flap), transform and opacity only. Reduced motion or a slow device: the closed envelope, still.
</script>
<span class="env" aria-hidden="true" data-testid="fx-envelope">
  <span class="back"></span>
  <span class="page"><i></i><i style="width:70%"></i><i></i></span>
  <span class="front"></span>
  <span class="flap"></span>
</span>
<style>
  .env { position: relative; display: inline-block; width: 46px; height: 40px; perspective: 260px; flex: none; animation: env-go 1.7s cubic-bezier(.2,.8,.2,1) both; }
  .back, .front { position: absolute; left: 0; right: 0; bottom: 4px; height: 26px; border-radius: 4px; }
  .back { background: #d9d4fb; }
  .front { background: linear-gradient(160deg, #efedff, #e2ddfc); clip-path: polygon(0 0, 50% 55%, 100% 0, 100% 100%, 0 100%); z-index: 2; }
  .page { position: absolute; left: 7px; right: 7px; bottom: 8px; height: 30px; padding: 5px; display: grid; gap: 3px; align-content: start; background: #fff; border: 1px solid #e3e1f5; border-radius: 3px; z-index: 1; animation: env-drop 600ms cubic-bezier(.2,.8,.2,1) both; }
  .page i { display: block; height: 2px; border-radius: 2px; background: #c9c6f4; }
  .flap { position: absolute; left: 0; right: 0; top: 10px; height: 16px; background: #c9c3f8; clip-path: polygon(0 0, 100% 0, 50% 100%); transform-origin: 50% 0; transform: rotateX(180deg); z-index: 3; animation: env-fold 420ms cubic-bezier(.2,.8,.2,1) 620ms forwards; backface-visibility: visible; }
  @keyframes env-drop { from { transform: translateY(-22px); } to { transform: translateY(6px); } }
  @keyframes env-fold { to { transform: rotateX(0deg); } }
  @keyframes env-go { 0%, 70% { transform: none; opacity: 1; } 100% { transform: translate(26px, -8px) rotate(-6deg); opacity: 0; } }
  @media (prefers-reduced-motion: reduce) { .env, .page, .flap { animation: none !important; } .flap { transform: none; } .page { transform: translateY(6px); } }
  :global(html[data-lite]) .env { animation: none; } :global(html[data-lite]) .page { animation: none; transform: translateY(6px); } :global(html[data-lite]) .flap { animation: none; transform: none; }
</style>
