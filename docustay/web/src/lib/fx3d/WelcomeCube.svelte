<script>
  // MOTION 6 · THE WELCOME CUBE (Run 9 board): a slow-turning cube on the first-time home screen; each face is a place to start. The faces are pictures; the real links are the list
  // `places` beside it (so a keyboard or a screen reader never has to chase a turning face). Pauses on hover. Reduced motion or a slow device: one face, still.
  let { places = [], testid = "fx-welcome-cube" } = $props();   // [{ label, href }] — four used, one per side face
  const four = $derived([...places, ...places, ...places, ...places].slice(0, 4));
</script>
<div class="wc" aria-hidden="true" data-testid={testid}>
  <div class="cube">{#each four as p, i}<span class="f f{i}">{p.label}</span>{/each}<span class="f top"></span><span class="f bot"></span></div>
</div>
<style>
  .wc { width: 170px; height: 170px; perspective: 900px; display: grid; place-items: center; }
  .cube { position: relative; width: 120px; height: 120px; transform-style: preserve-3d; animation: wc-turn 24s linear infinite; }
  .wc:hover .cube { animation-play-state: paused; }
  .f { position: absolute; inset: 0; display: grid; align-items: end; padding: 12px; border-radius: 12px; font: 600 13px/1.1 var(--font-sans); color: #fff; backface-visibility: hidden; box-shadow: inset 0 0 0 1px rgb(255 255 255 / .25); }
  .f0 { background: linear-gradient(160deg, #d9d6fb, #b7b2f6); color: #3b2a87; transform: translateZ(60px); }
  .f1 { background: linear-gradient(160deg, #6b4fd0, #5a3ac1); transform: rotateY(90deg) translateZ(60px); }
  .f2 { background: linear-gradient(160deg, #8f8af8, #7f7bf6); transform: rotateY(180deg) translateZ(60px); }
  .f3 { background: linear-gradient(160deg, #4a3299, #3b2a87); transform: rotateY(-90deg) translateZ(60px); }
  .top { background: #ece9fb; transform: rotateX(90deg) translateZ(60px); } .bot { background: #3b2a87; transform: rotateX(-90deg) translateZ(60px); }
  @keyframes wc-turn { from { transform: rotateX(-16deg) rotateY(0); } to { transform: rotateX(-16deg) rotateY(-360deg); } }
  @media (prefers-reduced-motion: reduce) { .cube { animation: none; transform: rotateX(-16deg) rotateY(-28deg); } }
  :global(html[data-lite]) .cube { animation: none; transform: rotateX(-16deg) rotateY(-28deg); }
</style>
