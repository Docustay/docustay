<script>
  import Anim from "./Anim.svelte";
  let { label = "The document goes into an envelope and a link arrives on a phone" } = $props();
</script>
<Anim {label}>
  <svg viewBox="0 0 320 200" aria-hidden="true">
    <path d="M100 118 Q162 36 222 112" class="arc" />
    <g class="pg"><clipPath id="sd"><rect x="34" y="56" width="54" height="68" rx="3" /></clipPath><image href="/starters/services-agreement/p1-sm.webp" x="34" y="56" width="54" height="68" preserveAspectRatio="xMidYMin slice" clip-path="url(#sd)" class="real" /></g>
    <rect x="26" y="92" width="80" height="54" rx="6" class="env" /><path class="flap" d="M26 92 L66 122 L106 92 Z" />
    <circle class="dot" cx="0" cy="0" r="6" />
    <rect x="226" y="30" width="62" height="124" rx="10" class="phone" /><rect x="234" y="46" width="46" height="92" rx="4" class="screen" />
    <rect x="240" y="60" width="34" height="8" rx="4" class="link" /><rect x="240" y="76" width="26" height="6" rx="3" class="ln" />
    <g class="ok"><circle cx="257" cy="112" r="11" /><path d="M251 112 l4 4 l8 -9" /></g>
  </svg>
</Anim>
<style>
  .arc { fill: none; stroke: var(--line-strong); stroke-width: 2; stroke-dasharray: 4 5; }
  .pg { fill: var(--card); stroke: var(--line-strong); stroke-width: 1.5; opacity: 0; } .env { fill: var(--card); stroke: var(--ink); stroke-width: 2; } .flap { fill: var(--tint); stroke: var(--ink); stroke-width: 2; stroke-linejoin: round; transform-box: fill-box; transform-origin: top; }
  .dot { fill: var(--brand); opacity: 0; } .phone { fill: var(--ink); } .screen { fill: var(--card); } .link { fill: var(--brand); } .ln { fill: var(--tint); }
  .ok circle { fill: var(--ok); } .ok path { fill: none; stroke: var(--card); stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; } .ok { transform-box: fill-box; transform-origin: center; }
  :global(.anim.armed) .pg { animation: into 1s ease-in .3s both; } :global(.anim.armed) .flap { animation: close .4s ease-out 1.3s both; }
  :global(.anim.armed) .ok { animation: pop .4s cubic-bezier(.3,1.6,.5,1) 3.1s both; }
  @supports (offset-path: path("M0 0")) { :global(.anim.armed) .dot { offset-path: path("M104 108 Q162 36 222 108"); animation: fly 1.4s ease-in-out 1.7s both; } }
  @keyframes into { 0% { opacity: 1; transform: translateY(-8px); } 70% { opacity: 1; transform: translateY(30px); } 100% { opacity: 0; transform: translateY(30px); } }
  @keyframes close { from { transform: scaleY(-1); } } @keyframes pop { from { transform: scale(0); } }
  @keyframes fly { 0% { opacity: 1; offset-distance: 0%; } 92% { opacity: 1; } 100% { opacity: 0; offset-distance: 100%; } }
.real { filter: drop-shadow(0 1px 2px rgb(60 40 140 / 0.099)); }
</style>
