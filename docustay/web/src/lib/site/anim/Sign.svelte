<script>
  import Anim from "./Anim.svelte";
  let { label = "A person ticks a box, draws a signature with a finger and presses Finish" } = $props();
</script>
<Anim {label}>
  <svg viewBox="0 0 320 200" aria-hidden="true">
    <rect x="104" y="8" width="112" height="186" rx="14" class="phone" /><rect x="112" y="22" width="96" height="158" rx="6" class="screen" />
    <clipPath id="sg"><rect x="114" y="24" width="92" height="154" rx="3" /></clipPath><image href="/starters/services-agreement/p7-sm.webp" x="114" y="24" width="92" height="154" preserveAspectRatio="xMidYMin slice" clip-path="url(#sg)" class="real" />
    <rect x="122" y="66" width="14" height="14" rx="3" class="box" /><path class="tick" d="M125 73 l4 4 l7 -9" pathLength="1" />
    <rect x="122" y="92" width="76" height="36" rx="4" class="sigbox" />
    <path class="sig" d="M128 118 q8 -24 16 -4 q6 12 12 -6 q6 -14 12 2 q4 8 12 -8" pathLength="1" />
    <rect class="btn" x="122" y="144" width="76" height="24" rx="6" />
    <path class="btnck" d="M150 156 l5 5 l9 -11" pathLength="1" />
  </svg>
</Anim>
<style>
  .phone { fill: var(--ink); } .screen { fill: var(--card); } .box { fill: none; stroke: var(--mute); stroke-width: 2; }
  .tick { fill: none; stroke: var(--brand); stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 1; }
  .sigbox { fill: var(--brand-soft); stroke: var(--brand); stroke-width: 1.5; stroke-dasharray: 5 3; }
  .sig { fill: none; stroke: var(--ink); stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 1; }
  .btn { fill: var(--brand); transform-box: fill-box; transform-origin: center; } .btnck { fill: none; stroke: var(--brand-ink); stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 1; }
  :global(.anim.armed) .tick { animation: draw .5s ease-out .6s both; } :global(.anim.armed) .sig { animation: draw 1.8s ease-in-out 1.4s both; }
  :global(.anim.armed) .btn { animation: press .35s ease-in-out 3.7s both; } :global(.anim.armed) .btnck { animation: draw .4s ease-out 4s both; }
  @keyframes draw { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } } @keyframes press { 50% { transform: scale(.94); } }
.real { filter: drop-shadow(0 1px 2px rgb(60 40 140 / 0.099)); }
</style>
