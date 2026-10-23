<script>
  import Glow from "$lib/site/Glow.svelte";
  // Frame "Home": a violet glow and a floating (-5deg) 280x360 paper, "Mutual Non-Disclosure Agreement", a signature that draws (1.8 s after .8 s) and an 86px violet seal that pops (.6 s after 2.4 s).
  // CSS only; with reduced motion the finished paper shows at once.
</script>
<div class="stage relative mx-auto h-[440px] w-[420px] max-w-full" aria-hidden="true">
  <Glow size={22} opacity={0.4} />
  <div class="paper absolute left-1/2 top-1/2 h-[360px] w-[280px] rounded-[6px] p-7" style="background:#faf9f6; color:#191919">
    <p class="text-[15px] font-semibold leading-snug" style="font-family: var(--font-serif); font-size: 19px">Mutual Non-Disclosure Agreement</p>
    <div class="mt-5 grid gap-[9px]">{#each [100, 92, 96, 70, 100, 88, 60] as w}<span class="h-[6px] rounded-full" style="width:{w}%; background:#d9d7d0"></span>{/each}</div>
    <svg class="absolute bottom-[58px] left-7" width="150" height="54" viewBox="0 0 150 54" fill="none"><path class="sig" pathLength="1" d="M4 38 C14 6 22 6 24 30 C26 46 34 12 44 20 C50 26 46 40 56 34 C70 24 72 14 84 26 C92 34 100 22 112 24 C124 26 128 34 146 18" stroke="#2a2a6a" stroke-width="2.4" stroke-linecap="round"/></svg>
    <span class="absolute bottom-[54px] left-7 right-7 h-px" style="background:#bdbab0"></span>
    <svg class="seal absolute -bottom-7 -right-5" width="86" height="86" viewBox="0 0 86 86"><circle cx="43" cy="43" r="41" fill="#6c5ce0"/><circle cx="43" cy="43" r="34" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="1.4" stroke-dasharray="2.4 2.4"/><path d="M27 44l11 11 22-24" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>
  </div>
</div>
<style>
  .paper { transform: translate(-50%, -50%) rotate(-5deg); box-shadow: 0 40px 80px -30px rgb(60 40 140 / 0.3), 0 0 0 1px rgb(60 40 140 / 0.027); animation: hp-float 6s ease-in-out infinite; }
  .sig { stroke-dasharray: 1; stroke-dashoffset: 1; animation: hp-draw 1.8s ease-out .8s forwards; }
  .seal { transform: scale(0); animation: hp-pop .6s cubic-bezier(.3, 1.5, .5, 1) 2.4s forwards; }
  @keyframes hp-float { 0%, 100% { transform: translate(-50%, -50%) rotate(-5deg); } 50% { transform: translate(-50%, calc(-50% - 10px)) rotate(-4deg); } }
  @keyframes hp-draw { to { stroke-dashoffset: 0; } }
  @keyframes hp-pop { 0% { transform: scale(.4); opacity: 0; } 70% { transform: scale(1.12); opacity: 1; } 100% { transform: scale(1); opacity: 1; } }
  @media (prefers-reduced-motion: reduce) { .paper { animation: none; } .sig { animation: none; stroke-dashoffset: 0; } .seal { animation: none; transform: scale(1); } }
</style>
