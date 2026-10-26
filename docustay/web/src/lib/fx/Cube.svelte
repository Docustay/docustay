<script>
  // MOTION 4 · A LONG JOB (Run 8 board, Load 2): a small violet cube turning in 3D — shown only once a job has taken over two seconds (`after`), so ordinary waits never show it. CSS 3D (six faces,
  // preserve-3d), transform only. Reduced motion or a slow device: one still face. The words beside it carry what is happening.
  import { onMount, untrack } from "svelte";
  let { after = 2000, label = "", size = 22, testid = "fx-cube" } = $props();
  const wait = untrack(() => after);
  let on = $state(wait <= 0);
  onMount(() => { if (on) return; const id = setTimeout(() => (on = true), wait); return () => clearTimeout(id); });
</script>
{#if on}
  <span class="cb" style="--s:{size}px" role="status" aria-live="polite" data-testid={testid}>
    <span class="sc" aria-hidden="true"><span class="cube"><i class="f1"></i><i class="f2"></i><i class="f3"></i><i class="f4"></i><i class="f5"></i><i class="f6"></i></span></span>
    {#if label}<span class="lb">{label}</span>{/if}
  </span>
{/if}
<style>
  .cb { display: inline-flex; align-items: center; gap: 12px; animation: cb-in 260ms ease-out; }
  .sc { width: var(--s); height: var(--s); perspective: calc(var(--s) * 6); flex: none; }
  .cube { position: relative; display: block; width: 100%; height: 100%; transform-style: preserve-3d; animation: cb-turn 3.2s cubic-bezier(.45,0,.55,1) infinite; }
  i { position: absolute; inset: 0; border: 1px solid rgb(255 255 255 / .5); border-radius: 3px; }
  .f1 { background: #5A3AC1; transform: translateZ(calc(var(--s) / 2)); }
  .f2 { background: #6b4fd0; transform: rotateY(180deg) translateZ(calc(var(--s) / 2)); }
  .f3 { background: #8585fd; transform: rotateY(90deg) translateZ(calc(var(--s) / 2)); }
  .f4 { background: #7766e8; transform: rotateY(-90deg) translateZ(calc(var(--s) / 2)); }
  .f5 { background: #c9c6f4; transform: rotateX(90deg) translateZ(calc(var(--s) / 2)); }
  .f6 { background: #3b2a87; transform: rotateX(-90deg) translateZ(calc(var(--s) / 2)); }
  .lb { color: var(--mute); font-size: 14px; }
  @keyframes cb-turn { 0% { transform: rotateX(-24deg) rotateY(0); } 100% { transform: rotateX(-24deg) rotateY(360deg); } }
  @keyframes cb-in { from { opacity: 0; } to { opacity: 1; } }
  @media (prefers-reduced-motion: reduce) { .cube, .cb { animation: none; } .cube { transform: none; } }
  :global(html[data-lite]) .cube { animation: none; transform: rotateX(-24deg) rotateY(30deg); }
</style>
