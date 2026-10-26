<script>
  // The closing card: a rounded card that grows to fill the width as it scrolls into view (a CSS view() timeline, transform and clip-path only), with the final call to action on it.
  import Doodle from "$lib/doodle/Doodle.svelte";
  let { title = "Send your first document", text = "Create a workspace, upload a document and send it. No card needed. The person signing needs no account.", cta = "Start free", href = "/signup", second = ["See how it works", "/features/how-it-works"] } = $props();
</script>
<section class="grow-wrap" aria-label="Get started">
  <div class="grow on-black">
    <div class="art" aria-hidden="true"><Doodle name="paper-plane" size="9rem" class="a1" /><Doodle name="sparkle" size="5rem" class="a2" /><Doodle name="w-yes" size="12rem" class="a3" /><Doodle name="stars" size="7rem" class="a4" /></div>
    <div class="in"><h2 class="t-xl mx-auto max-w-[16ch]">{title}</h2><p class="lede mt-4">{text}</p><div class="mt-7 flex flex-wrap justify-center gap-3"><a class="btn on-film" {href}>{cta}</a><a class="btn ghost-film" href={second[1]}>{second[0]}</a></div></div>
  </div>
</section>
<style>
  .grow-wrap { padding: clamp(2rem, 6vw, 5rem) clamp(.5rem, 2vw, 1.5rem); }
  .grow { position: relative; overflow: hidden; border-radius: var(--r-5); text-align: center; padding: clamp(4rem, 12vw, 9rem) clamp(1.25rem, 5vw, 4rem); max-width: 90rem; margin-inline: auto; }
  .in { position: relative; z-index: 1; } .in :global(.lede) { margin-inline: auto; color: var(--black-mute); }
  .art :global(.doodle) { position: absolute; color: var(--black-ink); opacity: .9; } .art :global(.a1) { left: 5%; top: 9%; transform: rotate(-8deg); width: 7rem; } .art :global(.a2) { right: 10%; top: 12%; } .art :global(.a3) { left: 10%; bottom: 8%; transform: rotate(-4deg); } .art :global(.a4) { right: 7%; bottom: 10%; }
  @media (max-width: 760px) { .art :global(.a3), .art :global(.a4) { display: none; } .art :global(.a1) { left: -1rem; } }
  @supports (animation-timeline: view()) {
    @media (prefers-reduced-motion: no-preference) {
      .grow { animation: grow linear both; animation-timeline: view(); animation-range: entry 0% cover 48%; }
    }
  }
  @keyframes grow { from { transform: scale(.82); clip-path: inset(0 round 5rem); } to { transform: none; clip-path: inset(0 round var(--r-5)); } }
</style>
