<script>
  // C1 to C4 and C6: the room a section sits in (BLUEPRINT §3.4). Pure CSS, aria-hidden, behind the content (position: absolute; inset: 0).
  //  C1 perspective grid floor · C2 light beams · C3 dot field · C4 aurora mesh · C6 spotlight on grid.  On cream (16 Oct 2026) depth comes from shadow, not light: the bloom is a faint violet wash, the grid and dots are light violet lines, no beams of light.
  let { kind = "C1", bloom = true, grain = true, class: cls = "" } = $props();
</script>
<div class="bd {kind} {cls}" aria-hidden="true">
  {#if bloom}<i class="bloom"></i>{/if}
  {#if kind === "C1"}<div class="floor"><i></i></div>
  {:else if kind === "C2"}<div class="beams"><i></i><i></i><i></i><i></i></div>
  {:else if kind === "C3"}<i class="dots"></i>
  {:else if kind === "C4"}<div class="aur"><i></i><i></i><i></i><i></i></div>
  {:else if kind === "C6"}<i class="spot"></i>{/if}
  {#if grain}<svg class="grain" width="100%" height="100%"><filter id="bdg"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" stitchTiles="stitch" /></filter><rect width="100%" height="100%" filter="url(#bdg)" /></svg>{/if}
</div>
<style>
  .bd { position: absolute; inset: 0; overflow: hidden; pointer-events: none; z-index: 0; }
  .bloom { position: absolute; left: 50%; top: -380px; width: 1700px; max-width: 160%; height: 1000px; transform: translateX(-50%); background: radial-gradient(closest-side, rgb(90 58 193 / .07), transparent 72%); }
  .floor { position: absolute; left: 0; right: 0; bottom: 0; height: 420px; perspective: 760px; overflow: hidden; }
  .floor i { position: absolute; left: -480px; top: 0; width: 2400px; height: 1300px; transform: rotateX(68deg); transform-origin: 50% 0; background-image: radial-gradient(circle, rgb(90 58 193 / .22) 1.2px, transparent 1.8px); background-size: 32px 32px; -webkit-mask-image: linear-gradient(to bottom, transparent 0%, #000 28%, transparent 100%); mask-image: linear-gradient(to bottom, transparent 0%, #000 28%, transparent 100%);  }
  .beams i { position: absolute; top: -40px; height: 70%; border-radius: 40px; filter: blur(3px); transform-origin: 50% 0; }
  .beams i:nth-child(1) { left: 40%; width: 18px; background: linear-gradient(to bottom, rgb(90 58 193 / .07), transparent); transform: rotate(-24deg); } .beams i:nth-child(2) { left: 46%; width: 30px; background: linear-gradient(to bottom, rgb(90 58 193 / .06), transparent); transform: rotate(-8deg); }
  .beams i:nth-child(3) { left: 53%; width: 16px; background: linear-gradient(to bottom, rgb(90 58 193 / .05), transparent); transform: rotate(10deg); } .beams i:nth-child(4) { left: 58%; width: 26px; background: linear-gradient(to bottom, rgb(90 58 193 / .06), transparent); transform: rotate(26deg); }
  .dots { position: absolute; inset: 0; background: radial-gradient(circle, rgb(90 58 193 / .2) 1px, transparent 1.6px) 0 0 / 22px 22px; -webkit-mask-image: radial-gradient(closest-side at 50% 30%, #000, transparent); mask-image: radial-gradient(closest-side at 50% 30%, #000, transparent); }
  /* C4 on cream: the aurora is a quiet dot field, so no section reads as a different colour */
  .aur { position: absolute; inset: 0; background: radial-gradient(circle, rgb(90 58 193 / .16) 1px, transparent 1.6px) 0 0 / 24px 24px; -webkit-mask-image: radial-gradient(closest-side at 50% 40%, #000, transparent); mask-image: radial-gradient(closest-side at 50% 40%, #000, transparent); } .aur i { display: none; }
  .spot { position: absolute; inset: 0; background-image: linear-gradient(rgb(90 58 193 / .08) 1px, transparent 1px), linear-gradient(90deg, rgb(90 58 193 / .08) 1px, transparent 1px); background-size: 40px 40px; -webkit-mask-image: radial-gradient(closest-side at 50% 36%, #000, transparent); mask-image: radial-gradient(closest-side at 50% 36%, #000, transparent); }
  .grain { position: absolute; inset: 0; opacity: .025; mix-blend-mode: multiply; }
  @media (prefers-reduced-motion: reduce) { .floor i, .aur i { animation: none; } }
</style>
