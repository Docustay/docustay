<script>
  // A strip that slides sideways forever (CSS only: transform), paused on hover and focus, and still when motion is reduced. The items are duplicated once for the loop; the copy is hidden from readers.
  let { items = [], speed = 38, class: cls = "" } = $props();
</script>
<div class="marquee {cls}" role="group" aria-label="Kinds of document">
  <ul class="track" style="--speed:{speed}s">{#each items as it}<li>{it}</li>{/each}</ul>
  <ul class="track" style="--speed:{speed}s" aria-hidden="true">{#each items as it}<li>{it}</li>{/each}</ul>
</div>
<style>
  .marquee { display: flex; overflow: hidden; gap: 0; }
  .track { display: flex; flex: none; align-items: center; gap: 2.5rem; padding-right: 2.5rem; min-width: 100%; justify-content: space-around; animation: slide var(--speed) linear infinite; list-style: none; margin: 0; }
  .marquee:hover .track, .marquee:focus-within .track { animation-play-state: paused; }
  li { white-space: nowrap; font-family: var(--font-serif); font-size: clamp(1.6rem, 1.2rem + 2vw, 3rem); font-weight: 600; }
  @keyframes slide { to { transform: translateX(-100%); } }
  @media (prefers-reduced-motion: reduce) { .track { animation: none; } .track[aria-hidden="true"] { display: none; } .marquee { flex-wrap: wrap; } .track { flex-wrap: wrap; justify-content: center; padding: 0; } }
</style>
