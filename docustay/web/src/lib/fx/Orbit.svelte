<script>
  // MOTION 1 · THINKING (Run 8 board, piece 3): three sheets turning slowly in 3D while Scribe reads and plans. Only shown once the wait has passed one second (`after`), so a quick answer
  // never flashes it. Reduced motion or a slow device: one still sheet.
  import { onMount, untrack } from "svelte";
  let { size = 22, after = 1000, label = "" } = $props();
  const wait = untrack(() => after);
  let on = $state(wait <= 0);
  onMount(() => { if (on) return; const id = setTimeout(() => (on = true), wait); return () => clearTimeout(id); });
</script>
{#if on}
  <span class="ob" style="--s:{size}px" role="status" aria-live="polite" data-testid="fx-orbit"><span class="sp" aria-hidden="true"><i class="a"></i><i class="b"></i><i class="c"></i></span>{#if label}<span class="lb">{label}</span>{/if}</span>
{/if}
<style>
  .ob { display: inline-flex; align-items: center; gap: 10px; animation: ob-in 240ms var(--ease-out, ease-out); }
  .sp { position: relative; width: var(--s); height: calc(var(--s) * 1.25); perspective: calc(var(--s) * 5); flex: none; }
  .sp { transform-style: preserve-3d; animation: ob-turn 6s linear infinite; }
  i { position: absolute; inset: 0; border-radius: 3px; }
  .a { background: #fff; border: 1px solid #e3e1f5; transform: translateZ(calc(var(--s) * .55)); box-shadow: 0 4px 10px rgb(90 58 193 / .14); }
  .b { background: #efedff; transform: rotateY(120deg) translateZ(calc(var(--s) * .55)); }
  .c { background: #d9d4fb; transform: rotateY(240deg) translateZ(calc(var(--s) * .55)); }
  .lb { color: var(--mute); font-size: 13px; }
  @keyframes ob-turn { to { transform: rotateY(360deg); } }
  @keyframes ob-in { from { opacity: 0; } to { opacity: 1; } }
  @media (prefers-reduced-motion: reduce) { .sp, .ob { animation: none; } .b, .c { display: none; } .a { transform: none; } }
  :global(html[data-lite]) .sp { animation: none; } :global(html[data-lite]) .b, :global(html[data-lite]) .c { display: none; } :global(html[data-lite]) .a { transform: none; }
</style>
