<script>
  // Inside the canvas: when a card is added, removed or the screen's language changes the card heights, the view is fitted again so every card shows (never zoomed in past 100%).
  import { useSvelteFlow } from "@xyflow/svelte";
  let { count } = $props();
  const flow = useSvelteFlow();
  $effect(() => { void count; const id = setTimeout(() => { flow.fitView({ padding: 0.2, maxZoom: 1, duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 250 }); }, 60); return () => clearTimeout(id); });
</script>
