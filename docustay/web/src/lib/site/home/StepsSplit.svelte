<script>
  // The sticky split: the four steps scroll on the left while one large product picture stays pinned on the right and changes with the step in view, with a small floating card overlapping its corner.
  // Pinning is CSS (position: sticky); the only script is an IntersectionObserver that says which step is in the middle of the screen. Without script the first picture shows and each step carries its own picture on small screens.
  import { onMount } from "svelte";
  import Doodle from "$lib/doodle/Doodle.svelte";
  let { steps } = $props();
  let active = $state(0), host = $state(null);
  onMount(() => {
    if (typeof IntersectionObserver === "undefined" || !host) return;
    const io = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) active = Number(e.target.dataset.i); }, { rootMargin: "-45% 0px -45% 0px" });
    host.querySelectorAll("[data-i]").forEach((n) => io.observe(n)); return () => io.disconnect();
  });
</script>
<div class="split wrap-wide" bind:this={host}>
  <ol class="left">
    {#each steps as s, i}
      <li class="step" data-i={i} class:on={active === i} aria-current={active === i ? "step" : null}>
        <span class="num t-h1">{i + 1}</span>
        <div class="body">
          <Doodle name={s.doodle} size="5.5rem" />
          <h3 class="t-h2">{s.title}</h3>
          <p class="lede mt-3">{s.text}</p>
          <img class="inline" src="/screens/{s.shot}" alt={s.alt} loading="lazy" width="1280" height="800" />
        </div>
      </li>
    {/each}
  </ol>
  <div class="right" aria-hidden="true">
    <div class="frame">
      {#each steps as s, i}<img class="pic" class:on={active === i} src="/screens/{s.shot}" alt="" loading="lazy" width="1280" height="800" />{/each}
      <div class="floatcard" style="--n:{active}">
        {#each steps as s, i}<div class="fc" class:on={active === i}><Doodle name={s.card.doodle} size="2.4rem" animate={false} /><div><b>{s.card.title}</b><span>{s.card.sub}</span></div></div>{/each}
      </div>
    </div>
  </div>
</div>
<style>
  .split { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr); gap: clamp(1.5rem, 5vw, 5rem); align-items: start; }
  .left { list-style: none; margin: 0; padding: 0; }
  .step { min-height: 78svh; display: grid; grid-template-columns: auto 1fr; gap: 1.5rem; align-content: center; opacity: .9; transition: opacity var(--dur-slow) var(--ease-out); }
  .step.on { opacity: 1; }
  .num { color: var(--brand); line-height: 1; min-width: 1.4ch; }
  .inline { display: none; }
  .right { position: sticky; top: 17svh; }
  .frame { position: relative; aspect-ratio: 1280 / 800; border-radius: var(--r-5); background: var(--tint); box-shadow: var(--sh-3); overflow: visible; }
  .pic { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: top left; border-radius: var(--r-5); opacity: 0; transition: opacity var(--dur-slow) var(--ease-out); }
  .pic.on { opacity: 1; }
  .floatcard { position: absolute; left: -2.5rem; bottom: 2.5rem; width: 17rem; min-height: 4.5rem; background: var(--card); border-radius: var(--r-3); box-shadow: var(--sh-3); padding: .9rem 1.1rem; z-index: 2; }
  .fc { position: absolute; inset: .9rem 1.1rem; display: flex; align-items: center; gap: .8rem; opacity: 0; transform: translateY(8px); transition: opacity var(--dur-base) var(--ease-out), transform var(--dur-base) var(--ease-out); }
  .fc.on { opacity: 1; transform: none; }
  .fc b { display: block; font-size: .95rem; } .fc span { display: block; color: var(--mute); font-size: .82rem; }
  @media (max-width: 899px) {
    .split { display: block; } .right { display: none; } .step { min-height: 0; opacity: 1; padding-block: 2.5rem; }
    .inline { display: block; margin-top: 1.5rem; border-radius: var(--r-4); box-shadow: var(--sh-2); width: 100%; height: auto; }
  }
  @media (prefers-reduced-motion: reduce) { .step { opacity: 1; } }
</style>
