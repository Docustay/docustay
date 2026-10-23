<script>
  import Anim from "./Anim.svelte";
  let { label = "Three signed pages are stacked, sealed together, and a certificate with a code is added beneath" } = $props();
</script>
<Anim {label}>
  <svg viewBox="0 0 320 200" aria-hidden="true">
    <g class="stack s1"><clipPath id="k1"><rect x="60" y="26" width="56" height="72" rx="5" /></clipPath><image href="/starters/services-agreement/p1-sm.webp" x="60" y="26" width="56" height="72.0" preserveAspectRatio="xMidYMin slice" clip-path="url(#k1)" class="real" /></g><g class="stack s2"><clipPath id="k2"><rect x="132" y="26" width="56" height="72" rx="5" /></clipPath><image href="/starters/services-agreement/p3-sm.webp" x="132" y="26" width="56" height="72.0" preserveAspectRatio="xMidYMin slice" clip-path="url(#k2)" class="real" /></g><g class="stack s3"><clipPath id="k3"><rect x="204" y="26" width="56" height="72" rx="5" /></clipPath><image href="/starters/services-agreement/p7-sm.webp" x="204" y="26" width="56" height="72.0" preserveAspectRatio="xMidYMin slice" clip-path="url(#k3)" class="real" /></g>
    <rect class="ring" x="44" y="12" width="232" height="100" rx="14" pathLength="1" />
    <g class="cert"><rect x="60" y="126" width="200" height="62" rx="6" class="paper" /><text x="74" y="146" class="ctitle">Certificate of Completion</text><text x="74" y="158" class="cline">Signed by Provider and Client</text><text x="74" y="169" class="cline">Sealed 5 Oct 2026, 14:02 UTC</text><text x="74" y="180" class="cline">SHA-256 9f2c1a7e…</text>
      {#each [0, 1, 2, 3, 4] as r}{#each [0, 1, 2, 3, 4] as c}{#if (r * 7 + c * 3) % 4 !== 1}<rect x={204 + c * 9} y={138 + r * 9} width="7" height="7" class="qr" />{/if}{/each}{/each}</g>
  </svg>
</Anim>
<style>
  .stack { fill: var(--card); stroke: var(--line-strong); stroke-width: 1.5; } .paper { fill: var(--card); stroke: var(--line-strong); stroke-width: 1.5; } .qr { fill: var(--ink); }
  .ring { fill: none; stroke: var(--brand); stroke-width: 3; stroke-dasharray: 1; stroke-linecap: round; }
  :global(.anim.armed) .s1 { animation: rise .5s ease-out .2s both; } :global(.anim.armed) .s2 { animation: rise .5s ease-out .5s both; } :global(.anim.armed) .s3 { animation: rise .5s ease-out .8s both; }
  :global(.anim.armed) .ring { animation: draw 1.2s ease-in-out 1.5s both; } :global(.anim.armed) .cert { animation: slideup .6s ease-out 3s both; }
  @keyframes rise { from { transform: translateY(22px); opacity: 0; } } @keyframes draw { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } } @keyframes slideup { from { transform: translateY(26px); opacity: 0; } }
.real { filter: drop-shadow(0 1px 2px rgb(60 40 140 / 0.126)); } .ctitle { font: 600 7.5px Georgia, serif; fill: var(--ink); } .cline { font: 5.6px Inter, system-ui, sans-serif; fill: var(--mute); }
</style>
