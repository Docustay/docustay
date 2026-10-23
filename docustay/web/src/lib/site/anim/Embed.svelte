<script>
  import Anim from "./Anim.svelte";
  let { label = "The signing form appears inside a website, and a completed event arrives as code" } = $props();
</script>
<Anim {label}>
  <svg viewBox="0 0 320 200" aria-hidden="true">
    <rect x="14" y="10" width="292" height="180" rx="9" class="win" /><circle cx="30" cy="25" r="3.5" class="dotc" /><circle cx="42" cy="25" r="3.5" class="dotc" /><circle cx="54" cy="25" r="3.5" class="dotc" /><rect x="70" y="19" width="200" height="12" rx="6" class="ln" />
    <rect x="28" y="48" width="70" height="8" rx="4" class="ln" /><rect x="28" y="64" width="60" height="6" rx="3" class="ln" /><rect x="28" y="76" width="66" height="6" rx="3" class="ln" /><rect x="28" y="88" width="52" height="6" rx="3" class="ln" />
    <rect class="region" x="112" y="44" width="180" height="84" rx="6" pathLength="1" />
    <g class="form"><clipPath id="em"><rect x="120" y="52" width="138" height="74" rx="3" /></clipPath><image href="/starters/services-agreement/p1-sm.webp" x="120" y="52" width="138" height="74" preserveAspectRatio="xMidYMin slice" clip-path="url(#em)" class="real" /><rect x="124" y="72" width="130" height="18" rx="4" class="sigbox" /><rect x="124" y="98" width="64" height="20" rx="5" class="btn" /></g>
    <g class="code"><rect x="28" y="142" width="264" height="32" rx="6" class="bar" /><circle class="okdot" cx="44" cy="158" r="5" /><rect class="cl" x="58" y="153" width="120" height="5" rx="2.5" /><rect class="cl" x="58" y="162" width="84" height="5" rx="2.5" /></g>
  </svg>
</Anim>
<style>
  .win { fill: var(--card); stroke: var(--line-strong); stroke-width: 1.5; } .dotc { fill: var(--line-strong); }
  .region { fill: none; stroke: var(--brand); stroke-width: 2; stroke-dasharray: 1; stroke-linecap: round; } .sigbox { fill: var(--brand-soft); stroke: var(--brand); stroke-width: 1.5; stroke-dasharray: 5 3; } .btn { fill: var(--brand); }
  .bar { fill: var(--ink); } .okdot { fill: var(--ok); } .cl { fill: var(--paper); opacity: .85; }
  :global(.anim.armed) .region { animation: draw 1s ease-in-out .5s both; } :global(.anim.armed) .form { animation: fadein .6s ease-out 1.6s both; }
  :global(.anim.armed) .code { animation: fadein .5s ease-out 3.2s both; } :global(.anim.armed) .cl { transform-box: fill-box; transform-origin: left; animation: type .7s ease-out 3.6s both; } :global(.anim.armed) .okdot { animation: fadein .3s ease-out 4.4s both; }
  @keyframes draw { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } } @keyframes fadein { from { opacity: 0; transform: translateY(6px); } } @keyframes type { from { transform: scaleX(0); } }
.real { filter: drop-shadow(0 1px 2px rgb(60 40 140 / 0.099)); }
</style>
