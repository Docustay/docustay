<script>
  // LAUNCH · THE ENTRY STAGE (sign-up, sign-in, the demo's doors): a dark depth field with a gliding grid floor, a floating paper stack with a signature that draws itself, and a violet glow —
  // the shared 3D layer of the Run 9 boards (W3, Motion 6). CSS 3D only: transform and opacity, no image, no script before first paint, nothing to download. `mood` tells the scene what the
  // person is doing: "idle" (a slow float), "working" (the sheets gather and the floor speeds up), "done" (the stack settles and the seal shows), "error" (one short red pulse). Pointer parallax
  // is a few degrees at most and only with a fine pointer. Reduced motion or `html[data-lite]`: the finished still picture, nothing moves.
  import { onMount } from "svelte";
  let { mood = "idle" } = $props();
  let el;
  onMount(() => {
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.hasAttribute("data-lite") || !matchMedia("(hover: hover) and (pointer: fine)").matches;
    if (still) return;
    let raf = 0;
    const move = (e) => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; el.style.setProperty("--px", ((e.clientX / innerWidth) - 0.5).toFixed(3)); el.style.setProperty("--py", ((e.clientY / innerHeight) - 0.5).toFixed(3)); }); };
    addEventListener("pointermove", move, { passive: true });
    return () => { removeEventListener("pointermove", move); cancelAnimationFrame(raf); };
  });
</script>
<div class="st" bind:this={el} data-mood={mood} aria-hidden="true" data-testid="entry-stage">
  <div class="glow"></div>
  <div class="floor"><div class="grid"></div></div>
  <div class="scene">
    <div class="stack">
      <div class="sheet s3"><i></i><i></i><i class="short"></i></div>
      <div class="sheet s2"><i></i><i class="short"></i><i></i></div>
      <div class="sheet s1">
        <b class="head"></b><i></i><i></i><i class="short"></i>
        <svg class="sig" viewBox="0 0 120 34" fill="none"><path d="M4 24c8-14 14-16 18-8 3 6-2 12 4 10 8-3 10-12 16-10 6 2-3 10 4 10 9 0 10-8 18-8 6 0 4 6 10 6 5 0 8-4 12-6" /></svg>
        <span class="line"></span>
      </div>
      <div class="seal" aria-hidden="true"><svg viewBox="17.9 -5.1 283.5 283.5" width="46" height="46"><path d="M267 139.2V168.1C266.6 165.7 266.2 161.4 266 157.7C265.8 151.8 265.4 151.4 264.4 156.1C263.7 159 263.4 159.8 261.6 164.8C252.4 188.5 229.7 210.4 203.8 220.4C202.9 220.7 201.4 221.3 200.6 221.6C193.9 224.3 181.5 227.4 174.6 228.2C173.4 228.4 171.7 228.6 170.9 228.8C168.7 229.2 53.1 229.4 52.6 229C52.3 228.7 52.2 224.7 52.2 203.7C52.2 178.8 52.2 178.8 52.8 178.2C53.3 177.6 55 176.2 61.2 170.9C62.4 169.9 63.9 168.7 64.5 168.1C65.1 167.6 66 166.8 66.5 166.4C67 166 69.8 163.6 72.6 161.1C79.3 155.4 89.7 146.4 96.1 140.9C98.9 138.5 102 135.8 103.1 134.8C104.2 133.9 107.2 131.4 109.8 129.3C112.3 127.2 115.2 124.7 116.2 123.8C116.6 123.5 116.8 123.2 117.1 123C118.7 121.6 119.6 120.8 120.4 120.8C121.6 120.8 122.8 122.4 125.8 126C127.3 127.7 129.7 130.6 131.3 132.4C134.4 136.1 135 136.9 135 137.8C135 138.4 133.6 140.7 131.5 143.8C130.8 144.6 129 147.4 127.3 149.9C125.6 152.4 123.4 155.6 122.4 157.1C121.3 158.6 120 160.7 119.3 161.6C118.7 162.6 116.9 165.3 115.4 167.6C111.1 174 110 176 110.1 176.4C110.2 176.7 112.9 176.8 127.1 176.8H143.9L144.9 176C145.4 175.6 148.6 172.8 152 169.8C155.4 166.7 160.3 162.3 162.9 159.9C180.8 143.8 182.9 142.1 183.2 140.1C183.2 139.7 183.2 139.4 183.2 138.9C183.4 134.6 183 134 172 124.8C169.5 122.6 165.3 119.1 162.7 116.9C160.2 114.7 156.8 111.8 155.2 110.5C153.7 109.2 151.1 107 149.5 105.5C145.6 102 145.4 101.9 143.4 101.4C141.9 101 138 101 97.2 101C60 101 52.7 101 52.5 100.7C52.4 100.5 52.3 87.9 52.3 72.7V72.7C52.3 46.1 52.3 45.1 52.7 44.7C52.7 44.6 52.8 44.6 52.8 44.6C53.5 44 161 43.8 167.8 44.5C179.6 45.5 194.7 49.2 203.6 53.2C203.9 53.4 205 53.8 206 54.3C230.1 64.5 252.2 86.2 260.7 108C264.8 118.6 266.4 125.4 266.6 134.4C266.7 137.1 266.8 138.7 267 139.2Z"/></svg></div>
    </div>
  </div>
  <div class="vignette"></div>
</div>
<style>
  .st { position: fixed; inset: 0; overflow: hidden; background: #09090f; --px: 0; --py: 0; contain: strict; }
  .glow { position: absolute; inset: -10%; background: radial-gradient(60% 50% at 70% 30%, rgb(112 84 232 / .30), transparent 70%), radial-gradient(45% 40% at 20% 78%, rgb(90 58 193 / .22), transparent 70%); }
  .floor { position: absolute; left: -30%; right: -30%; bottom: -8%; height: 62%; perspective: 520px; perspective-origin: 50% 0; overflow: hidden; -webkit-mask-image: linear-gradient(180deg, transparent, #000 38%); mask-image: linear-gradient(180deg, transparent, #000 38%); }
  .grid { position: absolute; left: 0; right: 0; top: -40px; height: calc(100% + 120px); transform-origin: 50% 0; transform: rotateX(68deg);
    background-image: linear-gradient(rgb(143 138 248 / .26) 1px, transparent 1px), linear-gradient(90deg, rgb(143 138 248 / .26) 1px, transparent 1px); background-size: 56px 56px; animation: st-glide 3.2s linear infinite; }
  .scene { position: absolute; inset: 0; perspective: 1100px; display: grid; place-items: center; }
  .stack { position: relative; width: clamp(260px, 19vw, 440px); aspect-ratio: 3 / 4; transform-style: preserve-3d; transform: translate3d(calc(var(--px) * -26px), calc(var(--py) * -18px), 0) rotateX(calc(14deg + var(--py) * -6deg)) rotateY(calc(-26deg + var(--px) * 10deg)) rotateZ(4deg); animation: st-float 7s ease-in-out infinite; margin-left: 46vw; margin-top: -4vh; }
  .sheet { position: absolute; inset: 0; border-radius: 14px; padding: 9% 9%; display: flex; flex-direction: column; gap: 8%; background: linear-gradient(160deg, #fff, #ecebfb); box-shadow: 0 12px 24px rgb(0 0 0 / .5), inset 0 0 0 1px rgb(143 138 248 / .35);   /* R10-62: a 60px blur on three floating 3D sheets was re-drawn every frame (p95 33 ms on the sign-in page without a GPU); 24px measured clean (17 ms) */ }
  .sheet i { display: block; height: 7px; border-radius: 4px; background: #d3d0f5; } .sheet i.short { width: 55%; } .sheet .head { display: block; width: 38%; height: 12px; border-radius: 4px; background: #5a3ac1; }
  .s3 { transform: translateZ(-70px) translateY(10px); opacity: .55; } .s2 { transform: translateZ(-34px) translateY(5px); opacity: .8; } .s1 { transform: translateZ(0); }
  .sig { margin-top: auto; width: 62%; height: auto; } .sig path { stroke: #4b2fb3; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 260; stroke-dashoffset: 260; animation: st-ink 5.5s ease-in-out infinite; }
  .line { display: block; height: 2px; background: #9a96e8; margin-top: 2%; width: 74%; }
  .seal { position: absolute; right: -9%; bottom: -7%; width: 88px; height: 88px; border-radius: 50%; display: grid; place-items: center; transform: translateZ(60px) scale(.6); opacity: 0; background: #5a3ac1; border: 2px solid #7f7bf6; box-shadow: 0 18px 30px rgb(0 0 0 / .4); transition: opacity 420ms ease-out, transform 700ms cubic-bezier(.2,.8,.2,1); }
  .seal svg { display: block; } .seal svg path { fill: #f3f2fa; }
  .vignette { position: absolute; inset: 0; background: radial-gradient(120% 90% at 50% 40%, transparent 55%, rgb(0 0 0 / .55)); }
  [data-mood="working"] .grid { animation-duration: 1.1s; } [data-mood="working"] .stack { animation-duration: 3s; } [data-mood="working"] .s2 { transform: translateZ(-14px) translateY(2px); } [data-mood="working"] .s3 { transform: translateZ(-28px) translateY(4px); }
  [data-mood="done"] .stack { animation: none; } [data-mood="done"] .seal { opacity: 1; transform: translateZ(60px) scale(1); } [data-mood="done"] .sig path { animation: none; stroke-dashoffset: 0; } [data-mood="done"] .grid { animation-duration: 8s; }
  [data-mood="error"] .glow { animation: st-pulse 700ms ease-out 1; } [data-mood="error"] .glow { background: radial-gradient(60% 50% at 70% 30%, rgb(214 70 90 / .28), transparent 70%), radial-gradient(45% 40% at 20% 78%, rgb(90 58 193 / .22), transparent 70%); }
  .sheet, .seal, .grid { transition: transform 600ms cubic-bezier(.2,.8,.2,1), opacity 500ms ease-out; }
  @keyframes st-glide { to { transform: rotateX(68deg) translateY(56px); } }
  @keyframes st-float { 0%, 100% { translate: 0 0; } 50% { translate: 0 -14px; } }
  @keyframes st-ink { 0% { stroke-dashoffset: 260; } 35%, 80% { stroke-dashoffset: 0; } 100% { stroke-dashoffset: -260; } }
  @keyframes st-pulse { 0% { opacity: .2; } 100% { opacity: 1; } }
  @media (max-width: 1100px) { .stack { width: min(46vw, 220px); margin-left: 0; margin-top: -36vh; opacity: .55; } .seal { width: 64px; height: 64px; } .st { --px: 0; --py: 0; } }
  @media (prefers-reduced-motion: reduce) { .grid, .stack, .sig path, .glow { animation: none !important; } .sig path { stroke-dashoffset: 0; } .seal { transition: none; } }
  :global(html[data-lite]) .grid, :global(html[data-lite]) .stack, :global(html[data-lite]) .sig path { animation: none !important; } :global(html[data-lite]) .sig path { stroke-dashoffset: 0; }
</style>
