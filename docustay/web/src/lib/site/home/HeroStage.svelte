<script>
  // The home hero: a full-bleed film with the header floating clear over it, the headline and the drop box on the film. As the page scrolls, the film shrinks into a rounded card and a mosaic of photos and hand-drawn doodles fades in around it.
  // The shrink and the mosaic are CSS scroll timelines (animation-timeline: scroll()): no script runs during scroll, so they cost nothing on the main thread. Browsers without them, and people who ask for less motion, get the film full-bleed and no mosaic.
  import HeroFilm from "./HeroFilm.svelte";
  import DropBox from "../DropBox.svelte";
  import Words from "$lib/fx/Words.svelte";
  import Doodle from "$lib/doodle/Doodle.svelte";
  let { eyebrow = "Signing, without the chase", title = "Send it. Get it signed. Keep the proof.", lede = "For people who need documents signed, and for developers who want signing inside their product. Free to start; no account for the signer.", start = "Start free", how = "See how it works", howHref = "/features/how-it-works" } = $props();
  // The mosaic: positions are percentages of the stage; --d staggers the entrance, --r is a small playful tilt. Photos are the licensed film stills; doodles are ours.
  const tiles = [
    { p: "/media/uc-contracts.poster.jpg", l: 2, t: 10, w: 17, h: 30, d: 0, r: -2 }, { name: "seal", bg: "lilac", l: 4, t: 44, w: 14, h: 22, d: 1, r: 2 }, { p: "/media/uc-real-estate.poster.jpg", l: 1, t: 70, w: 19, h: 26, d: 2, r: 1 },
    { name: "w-signed", bg: "peri", l: 23, t: 3, w: 17, h: 16, d: 3, r: 1.5 }, { p: "/media/uc-ndas.poster.jpg", l: 44, t: 2, w: 13, h: 16, d: 4, r: -1.5 }, { name: "paper-plane", bg: "lilac", l: 61, t: 3, w: 15, h: 17, d: 5, r: -2 },
    { p: "/media/uc-education.poster.jpg", l: 81, t: 8, w: 17, h: 30, d: 6, r: 2 }, { name: "key", bg: "ink", l: 83, t: 42, w: 14, h: 22, d: 7, r: -1 }, { p: "/media/uc-hr-and-onboarding.poster.jpg", l: 79, t: 69, w: 19, h: 26, d: 8, r: -2 },
    { name: "w-done", bg: "lilac", l: 28, t: 83, w: 20, h: 14, d: 9, r: 1 }, { p: "/media/uc-agencies.poster.jpg", l: 52, t: 85, w: 16, h: 13, d: 10, r: -1 },
  ];
</script>
<section class="stage" aria-label="Docustay">
  <div class="pin">
    <div class="film-card">
      <HeroFilm />
      <div class="scrim" aria-hidden="true"></div>
      <div class="dropwrap"><div class="wrap dropgrid"><div class="drop"><DropBox variant="film" /></div></div></div>
    </div>
    <div class="copy">
      <div class="wrap copygrid"><div class="copyin on-film">
        <p class="eyebrow">{eyebrow}</p>
        <Words tag="h1" text={title} class="t-xl mt-3 text-white" />
        <p class="mt-5 max-w-xl text-[1.15rem] leading-relaxed text-white/90 sm:text-xl">{lede}</p>
        <div class="mt-7 flex flex-wrap gap-3"><a class="btn on-film" href="/signup">{start}</a><a class="btn ghost-film" href={howHref}>{how}</a></div>
      </div></div>
    </div>
    <div class="mosaic" aria-hidden="true">
      {#each tiles as t}
        <div class="mt {t.name ? 'tile-doodle bg-' + t.bg : 'tile'}" style="--l:{t.l}; --t:{t.t}; --w:{t.w}; --h:{t.h}; --d:{t.d}; --r:{t.r}deg">
          {#if t.name}<Doodle name={t.name} animate={false} size={t.name.startsWith("w-") ? "86%" : "62%"} />{:else}<img src={t.p} alt="" loading="lazy" decoding="async" width="480" height="270" />{/if}
        </div>
      {/each}
    </div>
  </div>
</section>
<style>
  .stage { position: relative; height: 100svh; background: var(--black-section); }
  .pin { position: relative; height: 100svh; overflow: clip; }
  .film-card { position: absolute; inset: 0; overflow: hidden; background: var(--black-section); transform-origin: 50% 46%; }
  .scrim { position: absolute; inset: 0; background: var(--scrim); }
  .dropwrap { position: absolute; inset: 0; display: grid; align-items: center; }
  .dropgrid { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr); }
  .drop { grid-column: 2; max-width: 30rem; justify-self: end; width: 100%; }
  .copy { position: absolute; inset: 0; display: grid; align-items: center; pointer-events: none; }
  .copygrid { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr); }
  .copyin { grid-column: 1; padding-top: 3.5rem; pointer-events: auto; max-width: 47rem; }
  .mosaic { position: absolute; inset: 0; pointer-events: none; }
  .mt { position: absolute; left: calc(var(--l) * 1%); top: calc(var(--t) * 1%); width: calc(var(--w) * 1%); height: calc(var(--h) * 1%); opacity: 0; transform: rotate(var(--r)); }
  .bg-lilac { background: var(--lilac); } .bg-peri { background: var(--periwinkle); } .bg-ink { background: #ece9f6; color: var(--tx-1); } .bg-ink :global(.doodle) { color: var(--tx-1); }
  .mt :global(.doodle) { max-width: 100%; max-height: 100%; }
  @media (max-width: 899px) {
    .stage { height: auto; }
    .pin { height: 100svh; min-height: 40rem; }
    .dropgrid, .copygrid { grid-template-columns: minmax(0, 1fr); } .drop { grid-column: 1; justify-self: stretch; max-width: none; } .copyin { grid-column: 1; padding-top: 0; }
    .copy { align-items: start; padding-top: 6.5rem; } .dropwrap { align-items: end; padding-bottom: 1.5rem; }
  }
  /* the scroll-linked part: only where the browser can do it, and only when motion is welcome */
  @supports (animation-timeline: scroll()) {
    @media (prefers-reduced-motion: no-preference) and (min-width: 900px) {
      .stage { height: 235svh; }
      .pin { position: sticky; top: 0; }
      .film-card { animation: shrink linear both; animation-timeline: scroll(root); animation-range: 0 62svh; }
      .copy { animation: lift linear both; animation-timeline: scroll(root); animation-range: 0 34svh; }
      .dropwrap { animation: fadeout linear both; animation-timeline: scroll(root); animation-range: 18svh 48svh; }
      .mt { animation: tile-in cubic-bezier(.2, .8, .2, 1) both; animation-timeline: scroll(root); animation-range: calc(22svh + var(--d) * 3.4svh) calc(62svh + var(--d) * 3.4svh); }
      .mt :global(.doodle .ink), .mt :global(.doodle .ink2) { stroke-dasharray: 1; stroke-dashoffset: 1; animation: d-draw linear both !important; animation-timeline: scroll(root) !important; animation-range: calc(38svh + var(--d) * 3.4svh) calc(78svh + var(--d) * 3.4svh) !important; }
      .mt :global(.doodle .blk), .mt :global(.doodle .dot) { animation: none !important; opacity: 1 !important; }
    }
  }
  @keyframes shrink { from { transform: none; clip-path: inset(0 round 0); } to { transform: scale(.56) translateY(1svh); clip-path: inset(0 round 5.5rem); } }
  @keyframes lift { 0% { opacity: 1; transform: none; } 100% { opacity: 0; transform: translateY(-7svh); } }
  @keyframes fadeout { from { opacity: 1; } to { opacity: 0; } }
  @keyframes tile-in { from { opacity: 0; transform: translateY(7svh) scale(.82) rotate(var(--r)); } to { opacity: 1; transform: translateY(0) scale(1) rotate(var(--r)); } }
</style>
