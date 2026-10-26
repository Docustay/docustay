<script>
  // MOTION 1 · WRITING A DOCUMENT (Run 8 board, piece 1): a page tilted in 3D; its lines are written one by one. Scribe drafting and Describe. Stops the moment the work stops (`done`).
  // CSS 3D only (perspective + rotateX/Z), transform and opacity only. Reduced motion or a slow device: the page shows its lines, still.
  let { size = "sm", done = false } = $props();
</script>
<span class="ink {size}" class:done aria-hidden="true">
  <span class="pg"><i class="h"></i><i style="--d:0s"></i><i style="--d:.3s;--w:70%"></i><i style="--d:.6s"></i><i style="--d:.9s;--w:50%"></i>{#if size === "lg"}<i style="--d:1.2s;--w:84%"></i><i style="--d:1.5s;--w:62%"></i>{/if}</span>
</span>
<style>
  .ink { display: inline-grid; place-items: center; perspective: 240px; flex: none; }
  .pg { display: flex; flex-direction: column; gap: 4px; width: 34px; height: 42px; padding: 7px 6px; box-sizing: border-box; background: #fff; border: 1px solid #e3e1f5; border-radius: 4px; box-shadow: 0 6px 14px rgb(90 58 193 / .14); transform: rotateX(18deg) rotateZ(-6deg); animation: ink-tilt 3.2s ease-in-out infinite; }
  .lg .pg { width: 120px; height: 150px; padding: 18px 16px; gap: 9px; border-radius: 6px; box-shadow: 0 24px 50px rgb(40 25 100 / .18); transform: rotateX(22deg) rotateZ(-8deg); }
  i { display: block; height: 2px; width: var(--w, 100%); border-radius: 2px; background: #c9c6f4; transform-origin: left; animation: ink-write 2.4s cubic-bezier(.2,.8,.2,1) var(--d, 0s) infinite; }
  .lg i { height: 4px; }
  i.h { background: #8585fd; width: 100%; animation: none; } .lg i.h { width: 55%; height: 6px; background: #5A3AC1; }
  .done .pg, .done i { animation: none; }
  @keyframes ink-write { 0% { transform: scaleX(0); } 60%, 100% { transform: scaleX(1); } }
  @keyframes ink-tilt { 0%, 100% { transform: rotateX(18deg) rotateZ(-6deg); } 50% { transform: rotateX(10deg) rotateZ(-2deg); } }
  @media (prefers-reduced-motion: reduce) { .pg, i { animation: none !important; } }
  :global(html[data-lite]) .pg { animation: none; }
</style>
