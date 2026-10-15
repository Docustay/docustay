<script>
  import Anim from "./Anim.svelte";
  let { label = "A seal presses onto a signature and the document reads as sealed" } = $props();
</script>
<Anim {label}>
  <svg viewBox="0 0 320 200" aria-hidden="true">
    <rect x="70" y="8" width="130" height="184" rx="6" class="paper" /><clipPath id="se"><rect x="72" y="10" width="126" height="180" rx="5" /></clipPath><image href="/starters/services-agreement/p7-sm.webp" x="72" y="10" width="126" height="180.0" preserveAspectRatio="xMidYMin slice" clip-path="url(#se)" class="real" />
    <path class="sig" d="M84 78 q8 -22 16 -4 q5 11 11 -5 q6 -13 11 2 q4 8 11 -7" />
    <circle class="pulse" cx="222" cy="128" r="30" />
    <g class="seal"><circle cx="222" cy="128" r="30" class="sealbg" /><circle cx="222" cy="128" r="22" class="sealring" /><path transform="translate(206.4 112.4) scale(.1129) translate(-17.9 5.1)" d="M267 139.2V168.1C266.6 165.7 266.2 161.4 266 157.7C265.8 151.8 265.4 151.4 264.4 156.1C263.7 159 263.4 159.8 261.6 164.8C252.4 188.5 229.7 210.4 203.8 220.4C202.9 220.7 201.4 221.3 200.6 221.6C193.9 224.3 181.5 227.4 174.6 228.2C173.4 228.4 171.7 228.6 170.9 228.8C168.7 229.2 53.1 229.4 52.6 229C52.3 228.7 52.2 224.7 52.2 203.7C52.2 178.8 52.2 178.8 52.8 178.2C53.3 177.6 55 176.2 61.2 170.9C62.4 169.9 63.9 168.7 64.5 168.1C65.1 167.6 66 166.8 66.5 166.4C67 166 69.8 163.6 72.6 161.1C79.3 155.4 89.7 146.4 96.1 140.9C98.9 138.5 102 135.8 103.1 134.8C104.2 133.9 107.2 131.4 109.8 129.3C112.3 127.2 115.2 124.7 116.2 123.8C116.6 123.5 116.8 123.2 117.1 123C118.7 121.6 119.6 120.8 120.4 120.8C121.6 120.8 122.8 122.4 125.8 126C127.3 127.7 129.7 130.6 131.3 132.4C134.4 136.1 135 136.9 135 137.8C135 138.4 133.6 140.7 131.5 143.8C130.8 144.6 129 147.4 127.3 149.9C125.6 152.4 123.4 155.6 122.4 157.1C121.3 158.6 120 160.7 119.3 161.6C118.7 162.6 116.9 165.3 115.4 167.6C111.1 174 110 176 110.1 176.4C110.2 176.7 112.9 176.8 127.1 176.8H143.9L144.9 176C145.4 175.6 148.6 172.8 152 169.8C155.4 166.7 160.3 162.3 162.9 159.9C180.8 143.8 182.9 142.1 183.2 140.1C183.2 139.7 183.2 139.4 183.2 138.9C183.4 134.6 183 134 172 124.8C169.5 122.6 165.3 119.1 162.7 116.9C160.2 114.7 156.8 111.8 155.2 110.5C153.7 109.2 151.1 107 149.5 105.5C145.6 102 145.4 101.9 143.4 101.4C141.9 101 138 101 97.2 101C60 101 52.7 101 52.5 100.7C52.4 100.5 52.3 87.9 52.3 72.7V72.7C52.3 46.1 52.3 45.1 52.7 44.7C52.7 44.6 52.8 44.6 52.8 44.6C53.5 44 161 43.8 167.8 44.5C179.6 45.5 194.7 49.2 203.6 53.2C203.9 53.4 205 53.8 206 54.3C230.1 64.5 252.2 86.2 260.7 108C264.8 118.6 266.4 125.4 266.6 134.4C266.7 137.1 266.8 138.7 267 139.2Z" class="sealD" /></g>
    <g class="pill"><rect x="98" y="158" width="64" height="14" rx="7" class="pillbg" /><path d="M108 165 l4 4 l8 -9" class="pillck" /><rect x="128" y="163" width="26" height="4" rx="2" class="pillln" /></g>
  </svg>
</Anim>
<style>
  .paper { fill: var(--card); stroke: var(--line-strong); stroke-width: 1.5; } .sig { fill: none; stroke: var(--ink); stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
  .sealbg { fill: var(--brand); } .sealring { fill: none; stroke: var(--brand-ink); stroke-width: 2; stroke-dasharray: 3 3; } .sealD { fill: #f3f2fa; }
  .pulse { fill: none; stroke: var(--brand); stroke-width: 3; opacity: 0; transform-box: fill-box; transform-origin: center; }
  .pillbg { fill: var(--ok-bg); stroke: var(--ok-line); } .pillck { fill: none; stroke: var(--ok); stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; } .pillln { fill: var(--ok); opacity: .5; }
  :global(.anim.armed) .seal { transform-box: fill-box; transform-origin: center; animation: press .7s cubic-bezier(.5,0,.8,1) .3s both; }
  :global(.anim.armed) .pulse { animation: ring .8s ease-out 1s both; } :global(.anim.armed) .pill { animation: fadein .5s ease-out 1.6s both; }
  @keyframes press { from { transform: translateY(-40px) scale(1.25); opacity: 0; } 60% { opacity: 1; } } @keyframes ring { 0% { opacity: .6; transform: scale(1); } 100% { opacity: 0; transform: scale(1.7); } } @keyframes fadein { from { opacity: 0; transform: translateY(6px); } }
.real { filter: drop-shadow(0 1px 3px rgb(0 0 0 / .25)); }
</style>
