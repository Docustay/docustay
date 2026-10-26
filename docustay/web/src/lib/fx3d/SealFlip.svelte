<script>
  // MOTION 6 · THE SEAL TURNS OVER (Run 9 board): when a document completes, the seal flips to show its check code (the first and last four characters of the sealed file's fingerprint).
  // Used on the done screen and on Verify. Plays once after `delay`. Reduced motion or a slow device: the back (the code) still. The code is also in the page's own text.
  let { code = "", label = "SEALED", delay = 400, testid = "fx-seal" } = $props();
</script>
<span class="sf" style="--d:{delay}ms" aria-hidden="true" data-testid={testid}>
  <span class="disc"><span class="face front">{label}</span><span class="face back"><b>{label}</b><code>{code}</code></span></span>
</span>
<style>
  .sf { display: inline-block; width: 112px; height: 112px; perspective: 700px; }
  .disc { position: relative; display: block; width: 100%; height: 100%; transform-style: preserve-3d; animation: sf-turn 900ms cubic-bezier(.2,.8,.2,1) var(--d) both; }
  .face { position: absolute; inset: 0; border-radius: 50%; display: grid; place-items: center; align-content: center; gap: 6px; backface-visibility: hidden; border: 2px solid #7f7bf6; background: radial-gradient(circle at 35% 30%, #fff, #f1efff); box-shadow: 0 10px 30px rgb(90 58 193 / .18); }
  .front { font: 700 12px/1 var(--font-mono, monospace); letter-spacing: .18em; color: #5a3ac1; }
  .back { transform: rotateY(180deg); } .back b { font: 600 10px/1 var(--font-mono, monospace); letter-spacing: .16em; color: #5a3ac1; } .back code { font: 500 11px/1 var(--font-mono, monospace); color: #3b2a87; }
  @keyframes sf-turn { from { transform: rotateY(0); } to { transform: rotateY(180deg); } }
  @media (prefers-reduced-motion: reduce) { .disc { animation: none; transform: rotateY(180deg); } }
  :global(html[data-lite]) .disc { animation: none; transform: rotateY(180deg); }
</style>
