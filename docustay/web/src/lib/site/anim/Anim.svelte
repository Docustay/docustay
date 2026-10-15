<script>
  // Wraps one vector animation. The picture is complete without script, with reduced motion, and on a page that is never scrolled to: animations are only ARMED on the client, when motion is allowed,
  // and then play once, when at least 40% of the figure is on screen, and rest on their last frame (which is the picture the page shows without them).
  import { onMount } from "svelte";
  let { label, children } = $props();
  let el = $state(null), armed = $state(false), play = $state(false);
  onMount(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;
    armed = true;
    const io = new IntersectionObserver((e) => { if (e[0].isIntersecting) { play = true; io.disconnect(); } }, { threshold: 0.4 });
    io.observe(el);
    return () => io.disconnect();
  });
</script>
<figure bind:this={el} class="anim" class:armed class:play role="img" aria-label={label}>{@render children?.()}</figure>
<style>
  .anim { margin: 0; }
  .anim :global(svg) { display: block; width: 100%; height: auto; }
  .anim.armed :global(*) { animation-play-state: paused; }
  .anim.armed.play :global(*) { animation-play-state: running; }
</style>
