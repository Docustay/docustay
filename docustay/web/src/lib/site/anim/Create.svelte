<script>
  import Anim from "./Anim.svelte";
  let { label = "A page is written, fields are dropped on it, and a text tag turns into a signature field" } = $props();
</script>
<Anim {label}>
  <svg viewBox="0 0 320 200" aria-hidden="true">
    <g class="page"><rect x="58" y="12" width="136" height="176" rx="6" class="paper" /><clipPath id="cr"><rect x="60" y="14" width="132" height="172" rx="5" /></clipPath><image href="/starters/services-agreement/p1-sm.webp" x="60" y="14" width="132" height="172.0" preserveAspectRatio="xMidYMin slice" clip-path="url(#cr)" class="real" />
      <rect class="fld f1" x="84" y="38" width="46" height="9" rx="2" /><rect class="fld you f2" x="132" y="38" width="46" height="9" rx="2" />
      <rect class="fld f3" x="148" y="62" width="40" height="9" rx="2" /><rect class="fld f4" x="66" y="112" width="52" height="9" rx="2" /></g>
    <g class="chip"><rect x="222" y="151" width="86" height="24" rx="12" class="chipbg" /><text x="265" y="167" text-anchor="middle" class="code">[sig|signer_1]</text></g>
  </svg>
</Anim>
<style>
  .paper { fill: var(--card); stroke: var(--line-strong); stroke-width: 1.5; }
  .fld { fill: var(--brand-soft); stroke: var(--brand); stroke-width: 1.5; stroke-dasharray: 5 3; } .fld.you { fill: var(--tint); stroke: var(--mute); }
  .chipbg { fill: var(--ink); } .code { fill: var(--paper); font: 600 9.5px ui-monospace, Menlo, monospace; } .chip { opacity: 0; }
  :global(.anim.armed) .page { animation: slide .6s ease-out both; }
  :global(.anim.armed) .f1 { animation: drop .5s ease-out 2.2s both; } :global(.anim.armed) .f2 { animation: drop .5s ease-out 2.7s both; }
  :global(.anim.armed) .f3 { animation: drop .5s ease-out 4s both; } :global(.anim.armed) .f4 { animation: drop .5s ease-out 3.4s both; } :global(.anim.armed) .chip { animation: tag 1.2s ease-in-out 3s both; }
  @keyframes slide { from { transform: translateX(-24px); opacity: 0; } } @keyframes type { from { transform: scaleX(0); } } @keyframes drop { from { transform: translateY(-14px); opacity: 0; } }
  @keyframes tag { 0% { opacity: 0; transform: translateX(14px); } 25%, 70% { opacity: 1; transform: none; } 100% { opacity: 0; transform: translateX(-30px); } }
.real { filter: drop-shadow(0 1px 3px rgb(60 40 140 / 0.09)); }
</style>
