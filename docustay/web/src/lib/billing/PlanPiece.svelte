<script>
  // The four small 3D plan pieces of the Billing page (Option B): Free = one sheet, Pay as you go = a fan of three sheets, Pro = a bound stack with a seal, Lifetime = a sealed block.
  // Pure CSS 3D (transform-style: preserve-3d, perspective on the frame): no script, no network, nothing to download. Everything is sized in em from the one `size`, so a 170px glowing piece and
  // a 44px column header are the same markup. Only transform and opacity animate. A still picture under reduced motion, in lite mode, and when `still` is set (the Billing page keeps at most
  // five pieces moving; a browser does not draw animations in a hidden tab). Decorative: hidden from screen readers (the plan's name is always written next to it).
  let { plan = "free", size = 56, glow = false, still = false, testid = "plan-piece" } = $props();
  const kind = $derived(["free", "payg", "pro", "lifetime"].includes(plan) ? plan : "free");
</script>
<span class="pp" class:glow class:still style="font-size:{size}px" aria-hidden="true" data-testid={testid} data-plan={kind}>
  {#if glow}<i class="halo"></i>{/if}
  <span class="stage k-{kind}">
    {#if kind === "free"}
      <b class="sh a"></b>
    {:else if kind === "payg"}
      <b class="sh a"></b><b class="sh b"></b><b class="sh c"></b>
    {:else if kind === "pro"}
      <b class="sh s0"></b><b class="sh s1"></b><b class="sh s2"></b><b class="sh s3"></b><b class="sh s4"></b><b class="spine"></b><b class="seal"></b>
    {:else}
      <b class="face f"><b class="seal"></b></b><b class="face bk"></b><b class="face l"></b><b class="face r"></b><b class="face t"></b>
    {/if}
  </span>
</span>
<style>
  .pp { position: relative; display: inline-block; width: 1em; height: 1em; perspective: 7em; contain: layout paint; flex: none; vertical-align: middle; }
  .stage { position: absolute; inset: 0; transform-style: preserve-3d; transform: rotateX(14deg) rotateY(-24deg); will-change: transform; }
  .k-free { animation: pp-sway 9s ease-in-out infinite alternate; }
  .k-payg { animation: pp-sway 10s ease-in-out infinite alternate; }
  .k-pro { animation: pp-sway 12s ease-in-out infinite alternate; }
  .k-lifetime { animation: pp-spin 16s linear infinite; }
  @keyframes pp-sway { from { transform: rotateX(14deg) rotateY(-34deg); } to { transform: rotateX(14deg) rotateY(22deg); } }
  @keyframes pp-spin { from { transform: rotateX(-14deg) rotateY(0deg); } to { transform: rotateX(-14deg) rotateY(360deg); } }
  .still .stage, :global(html[data-lite]) .stage { animation: none; }
  @media (prefers-reduced-motion: reduce) { .stage { animation: none; } .halo { animation: none; } }

  .halo { position: absolute; inset: -.18em; border-radius: 50%; background: radial-gradient(closest-side, color-mix(in srgb, var(--brand) 42%, transparent), transparent 72%); animation: pp-glow 5s ease-in-out infinite alternate; pointer-events: none; }
  .still .halo, :global(html[data-lite]) .halo { animation: none; }
  @keyframes pp-glow { from { opacity: .55; } to { opacity: 1; } }

  /* a sheet of paper: white, faint ruled lines, a hairline edge */
  .sh { position: absolute; left: 25%; top: 15%; width: 50%; height: 70%; border-radius: .03em; border: .008em solid color-mix(in srgb, var(--brand) 28%, #cfcbe6); background:
      repeating-linear-gradient(to bottom, transparent 0 .075em, color-mix(in srgb, var(--brand) 20%, transparent) .075em .09em) 12% 22% / 76% 66% no-repeat,
      linear-gradient(160deg, #ffffff, #f1eefb); box-shadow: 0 .02em .05em rgb(40 20 100 / .22); backface-visibility: visible; }
  .k-payg .a { transform: translateX(-.1em) rotateZ(-14deg) translateZ(-.05em); }
  .k-payg .b { transform: translateZ(0); }
  .k-payg .c { transform: translateX(.1em) rotateZ(14deg) translateZ(.05em); }
  .k-pro .sh { left: 22%; width: 48%; }
  .k-pro .s0 { transform: translateZ(-.1em); } .k-pro .s1 { transform: translateZ(-.05em) rotateZ(.8deg); } .k-pro .s2 { transform: translateZ(0); }
  .k-pro .s3 { transform: translateZ(.05em) rotateZ(-.8deg); } .k-pro .s4 { transform: translateZ(.1em); }
  .spine { position: absolute; left: 22%; top: 15%; width: .2em; height: 70%; transform-origin: left center; transform: rotateY(-90deg) translateZ(0); background: linear-gradient(to right, var(--brand), color-mix(in srgb, var(--brand) 60%, #000)); border-radius: .02em; }
  .seal { position: absolute; width: .26em; height: .26em; border-radius: 50%; background: radial-gradient(circle at 34% 30%, #cdc8fb, var(--brand) 58%, #3b2490); box-shadow: 0 .02em .06em rgb(40 20 100 / .45), inset 0 0 0 .02em rgb(255 255 255 / .35); }
  .k-pro .seal { left: 50%; top: 52%; margin: -.13em 0 0 -.13em; transform: translateZ(.13em); }

  .k-lifetime .face { position: absolute; display: block; }
  .k-lifetime .f, .k-lifetime .bk { left: 27%; top: 19%; width: 46%; height: 62%; }
  .k-lifetime .f { transform: translateZ(.11em); background: linear-gradient(160deg, #6f4fd6, var(--brand) 55%, #3b2490); border-radius: .02em; }
  .k-lifetime .bk { transform: rotateY(180deg) translateZ(.11em); background: #3b2490; }
  .k-lifetime .l, .k-lifetime .r { left: 50%; top: 19%; width: .22em; height: 62%; margin-left: -.11em; background: linear-gradient(to bottom, #5a3ac1, #35208a); }
  .k-lifetime .l { transform: rotateY(-90deg) translateZ(.23em); } .k-lifetime .r { transform: rotateY(90deg) translateZ(.23em); }
  .k-lifetime .t { left: 27%; top: 19%; width: 46%; height: .22em; margin-top: -.11em; transform: rotateX(90deg) translateZ(.0em); background: #8a6df0; }
  .k-lifetime .seal { left: 50%; top: 50%; margin: -.13em 0 0 -.13em; background: radial-gradient(circle at 34% 30%, #fff7d6, #e8b94a 58%, #a87814); }
</style>
