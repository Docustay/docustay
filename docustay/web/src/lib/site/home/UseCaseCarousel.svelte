<script>
  // A big horizontal carousel of the use cases. Scroll-snap does the work (CSS); the buttons are for keyboard and mouse people, and move one card. It is a labelled region the keyboard can reach.
  import Doodle from "$lib/doodle/Doodle.svelte";
  let { items } = $props();
  let rail = $state(null), at = $state(0);
  const step = (dir) => { if (!rail) return; const card = rail.querySelector("li"); rail.scrollBy({ left: dir * (card?.getBoundingClientRect().width ?? 320) * 1.04, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); };
  // A mouse or trackpad over a sideways scroller used to swallow the page's scroll: a trackpad always sends a little sideways movement, the browser then latched the whole gesture onto this rail (scroll-snap made it worse) and the page barely moved (measured: 99 px of 1,573). So on a mouse or trackpad the rail does not scroll by wheel on its own; this handler moves it only for a clearly sideways swipe and lets everything else reach the page. Touch screens keep native swiping.
  const sideways = (node) => { const h = (e) => { if (Math.abs(e.deltaX) > Math.abs(e.deltaY) * 2 && Math.abs(e.deltaX) > 1) { e.preventDefault(); node.scrollBy({ left: e.deltaX }); } }; node.addEventListener("wheel", h, { passive: false }); return () => node.removeEventListener("wheel", h); };
  const onscroll = () => { if (!rail) return; const w = rail.querySelector("li")?.getBoundingClientRect().width || 1; at = Math.round(rail.scrollLeft / (w * 1.04)); };
</script>
<div class="car">
  <div class="rail" bind:this={rail} onscroll={onscroll} role="region" aria-label="Use cases, scrolls sideways" {@attach sideways}>
    <ul>
      {#each items as u, i}
        <li><a class="card2 lift" href="/use-cases/{u.slug}">
          <div class="pic"><img src="/media/uc-{u.slug}.poster.jpg" alt="" loading="lazy" decoding="async" width="960" height="540" /><span class="chip"><Doodle name={u.doodle} size="3.4rem" animate={false} /></span></div>
          <div class="txt"><span class="eyebrow">{u.title}</span><h3 class="t-h3 mt-1">{u.job}</h3><span class="more">Open</span></div>
        </a></li>
      {/each}
    </ul>
  </div>
  <div class="ctl"><button class="btn" onclick={() => step(-1)} aria-label="Previous use case" disabled={at <= 0}>←</button><button class="btn" onclick={() => step(1)} aria-label="Next use case" disabled={at >= items.length - 1}>→</button><span class="count" aria-hidden="true">{Math.min(at + 1, items.length)} / {items.length}</span></div>
</div>
<style>
  .rail { overflow-x: auto; scroll-snap-type: x mandatory; scrollbar-width: none; padding: 0 max(1rem, calc((100vw - 72rem) / 2 + 2rem)) 1rem; scroll-padding-inline: max(1rem, calc((100vw - 72rem) / 2 + 2rem)); outline-offset: -4px; }
  .rail::-webkit-scrollbar { display: none; }
  @media (hover: hover) and (pointer: fine) { .rail { overflow-x: hidden; } }
  ul { display: flex; gap: 1.25rem; list-style: none; margin: 0; padding: 0; }
  li { flex: 0 0 min(78vw, 26rem); scroll-snap-align: start; }
  .card2 { display: block; height: 100%; text-decoration: none; background: var(--card); border: 1px solid var(--line); border-radius: var(--r-5); overflow: hidden; }
  .pic { position: relative; aspect-ratio: 4 / 3; background: var(--tint); } .pic img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .chip { position: absolute; right: .9rem; bottom: .9rem; background: var(--lilac); border-radius: var(--r-3); padding: .35rem; line-height: 0; }
  .txt { padding: 1.25rem 1.4rem 1.5rem; } .more { display: inline-block; margin-top: .9rem; font-weight: 600; color: var(--brand); } .more::after { content: " →"; }
  .ctl { display: flex; align-items: center; gap: .6rem; padding: 1rem max(1rem, calc((100vw - 72rem) / 2 + 2rem)) 0; } .count { margin-left: .6rem; color: var(--mute); font-variant-numeric: tabular-nums; }
</style>
