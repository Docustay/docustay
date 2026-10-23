<script>
  // A1 to A6, the object tiles (BLUEPRINT §3.4). CSS only. `kind` picks the recipe; the icon is a child (an inline svg, stroke="currentColor").
  //  A1 frosted glass · A2 gloss gem · A3 obsidian · A4 isometric slab · A5 wire cube · A6 soft render
  let { kind = "A1", size = 92, class: cls = "", children } = $props();
</script>
<span class="tile {kind} {cls}" style="--sz:{size}px" aria-hidden="true">
  {#if kind === "A1"}<i class="halo"></i>{/if}
  {#if kind === "A2"}<i class="spec"></i>{/if}
  {#if kind === "A5"}<svg viewBox="0 0 120 120" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M60 12l40 22v44L60 100 20 78V34L60 12z" /><path d="M20 34l40 22 40-22M60 56v44" /><path d="M40 23l40 22M40 67l40 22" stroke-opacity=".4" /></svg>{:else}<span class="ic">{@render children?.()}</span>{/if}
</span>
<style>
  .tile { position: relative; display: inline-flex; align-items: center; justify-content: center; width: var(--sz); height: var(--sz); flex: none; color: var(--v-700); transition: transform var(--d-base) var(--e-out); }
  .tile:hover { transform: perspective(500px) rotateX(8deg) rotateY(-10deg); }
  .ic { display: inline-flex; width: 42%; height: 42%; } .ic :global(svg) { width: 100%; height: 100%; }
  .A1 { border-radius: 28%; background: rgb(255 255 255 / .9); border: 1px solid var(--hairline); box-shadow: inset 0 1px 0 #fff, var(--sh-card); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); }
  .A1 .halo { display: none; }
  .A2 { color: #fff; border-radius: 28%; background: linear-gradient(145deg, #7d63dd, #5a3ac1 72%); box-shadow: 0 18px 30px -14px rgb(60 40 140 / .55), inset 0 2px 3px rgb(255 255 255 / .45); transform: perspective(500px) rotateX(10deg) rotateY(-12deg); }
  .A2:hover { transform: perspective(500px) rotateX(2deg) rotateY(0); }
  .A2 .spec { position: absolute; left: 11%; top: 9%; width: 50%; height: 24%; border-radius: 50%; background: linear-gradient(180deg, rgb(255 255 255 / .55), rgb(255 255 255 / 0)); }
  .A3 { border-radius: 28%; background: #fff; border: 1px solid var(--hairline); box-shadow: inset 0 -3px 0 var(--violet-tint), var(--sh-card); color: var(--v-700); }
  .A3 .ic :global(svg) { filter: none; }
  .A4 { perspective: 600px; } .A4::before { content: ""; width: 86%; height: 86%; border-radius: 20%; background: linear-gradient(145deg, #8f7ae6, #5a3ac1); transform: rotateX(56deg) rotateZ(-38deg); box-shadow: 1px 1px 0 #4e30b2, 2px 2px 0 #4e30b2, 3px 3px 0 #4e30b2, 4px 4px 0 #4e30b2, 5px 5px 0 #4e30b2, 6px 6px 0 #4e30b2, 7px 7px 0 #4e30b2, 8px 8px 0 #4e30b2, 9px 9px 0 #4e30b2, 10px 10px 0 #4e30b2, 22px 24px 36px rgb(60 40 140 / .3); }
  .A4 .ic { color: #fff; position: absolute; width: 30%; height: 30%; transform: translateY(-4%); }
  .A5 { color: var(--v-700); filter: none; } .A5 svg { width: 100%; height: 100%; }
  .A6 { border-radius: 46% 54% 52% 48% / 48% 46% 54% 52%; background: radial-gradient(circle at 34% 28%, #ece8fb, #9d8cf5 46%, #5a3ac1); color: #fff; box-shadow: inset -8px -10px 18px rgb(74 48 178 / .35), inset 6px 6px 12px rgb(255 255 255 / .5), 0 18px 24px -10px rgb(60 40 140 / .35); }
  @media (prefers-reduced-motion: reduce) { .tile, .tile:hover { transform: none; transition: none; } .A2, .A2:hover { transform: perspective(500px) rotateX(10deg) rotateY(-12deg); } }
</style>
