<script>
  // MOTION 3 · SIGNED AND SEALED (Run 8 board, Done 3): a stamp comes down in 3D, presses, lifts away and leaves a violet SEALED on the page. Plays once (about 1.4 s). Reduced motion or a slow
  // device: the SEALED mark, still. The word is drawn with CSS text, so it reads in the page's language through `label`.
  let { label = "SEALED" } = $props();
</script>
<span class="stp" aria-hidden="true" data-testid="fx-stamp">
  <span class="paper"><span class="mark">{label}</span></span>
  <span class="head"><span class="grip"></span><span class="face"></span></span>
</span>
<style>
  .stp { position: relative; display: inline-block; width: 64px; height: 46px; perspective: 300px; flex: none; }
  .paper { position: absolute; inset: 14px 0 0; background: #fff; border: 1px solid #e3e1f5; border-radius: 4px; display: grid; place-items: center; transform: rotateX(38deg); box-shadow: 0 6px 14px rgb(40 25 100 / .1); }
  .mark { font: 700 9px/1 var(--font-mono, ui-monospace, monospace); letter-spacing: .14em; color: #5A3AC1; border: 1.5px solid #5A3AC1; border-radius: 3px; padding: 3px 5px; transform: rotate(-8deg); opacity: 0; animation: stp-ink 260ms ease-out 560ms forwards; }
  .head { position: absolute; left: 50%; top: -6px; width: 26px; margin-left: -13px; display: grid; justify-items: center; transform-style: preserve-3d; animation: stp-press 1.25s cubic-bezier(.2,.8,.2,1) both; }
  .grip { width: 10px; height: 12px; border-radius: 5px 5px 2px 2px; background: #3b2a87; }
  .face { width: 26px; height: 8px; border-radius: 3px; background: #5A3AC1; box-shadow: 0 6px 10px rgb(40 25 100 / .25); }
  @keyframes stp-press { 0% { transform: translateY(-14px) rotateX(20deg); opacity: 0; } 25% { opacity: 1; } 45% { transform: translateY(16px) rotateX(0); } 55% { transform: translateY(14px) scaleY(.92); } 80% { transform: translateY(-10px); opacity: 1; } 100% { transform: translateY(-18px); opacity: 0; } }
  @keyframes stp-ink { from { opacity: 0; transform: rotate(-8deg) scale(1.25); } to { opacity: 1; transform: rotate(-8deg) scale(1); } }
  @media (prefers-reduced-motion: reduce) { .head { display: none; } .mark { animation: none; opacity: 1; } }
  :global(html[data-lite]) .head { display: none; } :global(html[data-lite]) .mark { animation: none; opacity: 1; }
</style>
