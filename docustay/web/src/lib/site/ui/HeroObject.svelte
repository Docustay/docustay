<script>
  // B1 to B6, the one object on a first screen (BLUEPRINT §3.4). CSS 3D and SVG; the live three.js version of B1 is Scene3D (home only).
  //  B1 paper stack and seal · B2 glass seal medallion · B3 orbiting papers · B4 signature (in light on the dark site; a violet stroke with a soft shadow on cream) · B5 stacked glass panes · B6 folded paper and seal
  import Seal from "./Seal.svelte";
  let { kind = "B1", size = 1, label = "", class: cls = "" } = $props();
</script>
<div class="ho {kind} {cls}" style="--k:{size}" role={label ? "img" : undefined} aria-label={label || undefined} aria-hidden={label ? undefined : "true"}>
  {#if kind === "B1"}
    <div class="stack"><i class="p3"></i><i class="p2"></i>
      <div class="p1"><b>Lease addendum</b><s></s><s style="width:92%"></s><s style="width:96%"></s><s style="width:60%"></s>
        <div class="sig"><svg viewBox="0 0 150 46" width="150" height="46"><path class="draw" d="M4 30 C 14 4, 26 4, 24 24 S 34 40, 46 18 S 62 6, 66 24 S 84 40, 96 16 S 112 10, 124 26" fill="none" stroke="#4e30b2" stroke-width="2" stroke-linecap="round" /></svg></div>
        <small>JORDAN · SIGNED</small><span class="sl"><Seal size={78} /></span></div>
      <u class="glow"></u></div>
  {:else if kind === "B2"}
    <div class="med"><span class="halo"></span><span class="ring"><span class="core"><img src="/brand/docustay-favicon-D-white.svg" alt="" width="52" height="52" /></span></span></div>
  {:else if kind === "B3"}
    <div class="orb"><span class="path"></span><Seal size={56} /><i class="o a"></i><i class="o b"></i><i class="o c"></i></div>
  {:else if kind === "B4"}
    <svg class="sigl" viewBox="0 0 190 100" fill="none" stroke-linecap="round"><path d="M10 64 C 22 8, 44 8, 40 50 S 58 92, 80 36 S 108 12, 114 52 S 146 88, 178 30" stroke="#3c288c" stroke-width="8" opacity=".12" transform="translate(0 7)" style="filter:blur(5px)" /><path class="draw" d="M10 64 C 22 8, 44 8, 40 50 S 58 92, 80 36 S 108 12, 114 52 S 146 88, 178 30" stroke="#5a3ac1" stroke-width="3" /></svg>
  {:else if kind === "B5"}
    <div class="panes"><i></i><i></i><i></i></div>
  {:else if kind === "B6"}
    <div class="fold"><div class="sheet"><s></s><s style="width:70%"></s><s style="width:85%"></s></div><u></u><span class="sl"><Seal size={44} /></span></div>
  {/if}
</div>
<style>
  .ho { position: relative; display: flex; align-items: center; justify-content: center; width: calc(330px * var(--k)); height: calc(340px * var(--k)); max-width: 100%; }
  /* B1 */
  .stack { position: relative; width: 260px; height: 330px; transform-style: preserve-3d; transform: perspective(1500px) rotateX(16deg) rotateY(-12deg) scale(var(--k)); transition: transform var(--d-slow) var(--e-out); }
  .stack:hover { transform: perspective(1500px) rotateX(8deg) rotateY(-5deg) scale(var(--k)); }
  .stack i { position: absolute; width: 230px; height: 290px; border-radius: 6px; box-shadow: 0 30px 60px rgb(60 40 140 / 0.248); }
  .p3 { left: -30px; top: 60px; background: #dcd8cc; transform: rotate(-9deg) translateZ(-60px); } .p2 { left: -6px; top: 34px; background: #ebe8de; transform: rotate(4deg) translateZ(-30px); }
  .p1 { position: absolute; left: 20px; top: 8px; width: 230px; height: 290px; box-sizing: border-box; padding: 24px 22px; border-radius: 6px; background: var(--doc-paper); color: var(--doc-ink); box-shadow: 0 40px 80px rgb(60 40 140 / 0.27), 0 0 0 1px rgb(255 255 255 / .4); }
  .p1 b { display: block; font: 400 21px/1.1 var(--f-display); margin-bottom: 14px; } .p1 s { display: block; height: 6px; border-radius: 3px; background: var(--doc-line); margin-top: 8px; text-decoration: none; }
  .sig { margin-top: 26px; border-bottom: 1px solid var(--hairline); height: 46px; } .p1 small { display: block; margin-top: 6px; font: 9.5px var(--f-mono); color: #6b685f; }
  .sl { position: absolute; right: -22px; bottom: -24px; } .glow { position: absolute; left: -40px; top: 300px; width: 330px; height: 60px; background: radial-gradient(closest-side, rgb(90 58 193 / 0.1), transparent 75%); }
  .draw { stroke-dasharray: 400; stroke-dashoffset: 400; animation: hdraw 2.4s var(--e-out) .4s forwards; } @keyframes hdraw { to { stroke-dashoffset: 0; } }
  /* B2 */
  .med { position: relative; width: 150px; height: 150px; display: grid; place-items: center; transform: scale(calc(var(--k) * 1.5)); } .halo { position: absolute; inset: 0; border-radius: 50%; background: radial-gradient(closest-side, rgb(90 58 193 / 0.1), transparent); }
  .ring { position: relative; width: 118px; height: 118px; border-radius: 50%; padding: 3px; box-sizing: border-box; background: conic-gradient(from 210deg, rgb(255 255 255 / .55), rgb(90 58 193 / 0.1), rgb(90 58 193 / .5), rgb(255 255 255 / .55)); box-shadow: 0 0 50px rgb(90 58 193 / 0.158); animation: spin 18s linear infinite; }
  .core { width: 100%; height: 100%; border-radius: 50%; display: grid; place-items: center; background: radial-gradient(circle at 34% 28%, rgb(255 255 255 / .28), rgb(74 48 178 / .96) 70%); } .core img { filter: drop-shadow(0 2px 6px rgb(60 40 140 / .3)); animation: spin 18s linear infinite reverse; }
  @keyframes spin { to { transform: rotate(360deg); } }
  /* B3 */
  .orb { position: relative; width: 280px; height: 200px; display: grid; place-items: center; transform: scale(var(--k)); } .path { position: absolute; width: 230px; height: 78px; border-radius: 50%; border: 1px dashed rgb(90 58 193 / 0.5); transform: rotate(-14deg); }
  .o { position: absolute; width: 26px; height: 34px; border-radius: 2px; background: var(--doc-paper); box-shadow: 0 6px 12px rgb(60 40 140 / 0.225); } .o.a { left: 22px; top: 96px; transform: rotate(-20deg); animation: bob 5s ease-in-out infinite; } .o.b { left: 126px; top: 38px; background: #ebe8de; transform: rotate(12deg); animation: bob 6s ease-in-out -2s infinite; } .o.c { left: 226px; top: 104px; transform: rotate(24deg); animation: bob 7s ease-in-out -4s infinite; }
  @keyframes bob { 50% { translate: 0 -10px; } }
  /* B4 */
  .sigl { width: calc(300px * var(--k)); max-width: 100%; height: auto; overflow: visible; } .sigl .draw { stroke-dasharray: 360; stroke-dashoffset: 360; animation: hdraw 3s var(--e-inout) .3s infinite alternate; }
  /* B5 */
  .panes { position: relative; width: 240px; height: 200px; transform: scale(var(--k)); } .panes i { position: absolute; width: 150px; height: 92px; border-radius: 10px; border: 1px solid var(--hairline); background: rgb(90 58 193 / 0.07); transform: skewX(-20deg); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }
  .panes i:nth-child(1) { left: 12px; top: 100px; opacity: .7; } .panes i:nth-child(2) { left: 28px; top: 62px; opacity: .85; } .panes i:nth-child(3) { left: 44px; top: 24px; border-color: rgb(76 74 94 / .5); background: rgb(90 58 193 / 0.1); box-shadow: var(--sh-card); }
  /* B6 */
  .fold { position: relative; width: 190px; height: 190px; transform: scale(var(--k)); } .sheet { position: absolute; left: 30px; top: 10px; width: 112px; height: 144px; background: var(--doc-paper); clip-path: polygon(0 0, 72% 0, 100% 24%, 100% 100%, 0 100%); padding: 18px 14px; box-sizing: border-box; box-shadow: 0 18px 30px rgb(60 40 140 / 0.27); }
  .sheet s { display: block; height: 4px; margin-top: 9px; border-radius: 2px; background: var(--doc-line); } .fold u { position: absolute; left: 112px; top: 36px; border-style: solid; border-width: 0 0 32px 32px; border-color: transparent transparent #cfc9b8; filter: drop-shadow(-3px 4px 4px rgb(60 40 140 / 0.18)); } .fold .sl { right: 8px; bottom: 6px; }
  @media (prefers-reduced-motion: reduce) { .draw, .sigl .draw { animation: none; stroke-dashoffset: 0; } .ring, .core img, .o { animation: none; } .stack, .stack:hover { transition: none; } }
</style>
