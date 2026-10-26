<script>
  // MOTION 5 + 6 · REPORTS ON A MOVING FLOOR (Run 9 boards): bars stand up out of a gliding grid floor when the view opens, then the floor slows and stops. `bars` are 0–1 heights with a label
  // each (the numbers themselves are in the page's own table). Once per opening. Reduced motion or a slow device: the bars standing, the floor still.
  import { shown } from "../fx/index.js";
  let { bars = [], testid = "fx-floor" } = $props();   // [{ h: 0..1, label, strong? }]
</script>
<div class="fl" aria-hidden="true" data-testid={testid} {@attach shown(0.3)}>
  <div class="grid"></div>
  <div class="bars">{#each bars as b, i}<span class="bar" class:strong={b.strong} style="--h:{Math.max(0.04, Math.min(1, b.h))};--i:{i}" title={b.label}></span>{/each}</div>
</div>
<style>
  .fl { position: relative; height: 150px; perspective: 520px; overflow: hidden; }
  .grid { position: absolute; left: -20%; right: -20%; bottom: -30px; height: 140px; transform: rotateX(68deg); transform-origin: 50% 100%;
    background-image: linear-gradient(var(--hair, rgb(24 20 60 / .07)) 1px, transparent 1px), linear-gradient(90deg, var(--hair, rgb(24 20 60 / .07)) 1px, transparent 1px); background-size: 34px 34px; }
  .fl:global([data-shown]) .grid { animation: fl-glide 2.4s cubic-bezier(.15,.7,.25,1) both; }
  .bars { position: absolute; inset: 0 0 18px; display: flex; align-items: flex-end; justify-content: center; gap: 14px; }
  .bar { width: 26px; height: calc(var(--h) * 110px); border-radius: 6px 6px 3px 3px; background: linear-gradient(180deg, #b7b2f6, #8f8af8); transform-origin: 50% 100%; }
  .bar.strong { background: linear-gradient(180deg, #6b4fd0, #5a3ac1); }
  :global(html.js) .fl:not([data-shown]) .bar { transform: scaleY(.02); }
  .fl:global([data-shown]) .bar { animation: fl-stand 700ms cubic-bezier(.2,.8,.2,1) calc(300ms + var(--i) * 90ms) both; }
  @keyframes fl-glide { from { background-position: 0 -170px; } to { background-position: 0 0; } }
  @keyframes fl-stand { from { transform: perspective(400px) rotateX(-80deg) scaleY(.02); } to { transform: none; } }
  @media (prefers-reduced-motion: reduce) { .grid, .bar { animation: none !important; transform: none !important; } .grid { transform: rotateX(68deg) !important; } }
  :global(html[data-lite]) .grid, :global(html[data-lite]) .bar { animation: none !important; } :global(html[data-lite]) .bar { transform: none !important; }
</style>
