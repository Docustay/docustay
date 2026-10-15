<script>
  // The Docustay logo (final, 13 Oct 2026; specs/brand/docustay-logo/README.md): the forward-cut wordmark "Docustay" as the vector files, violet on light, white on dark; `mark` shows the cut D alone (the narrow sidebar).
  // Vector only, never redrawn, stretched or recoloured. Wordmark about 26px tall on desktop, 22 on phones. Alt text is "Docustay" (capital D). Never next to the the platform tile.
  import Mark from "$lib/Mark.svelte";
  import DrawnMark from "$lib/fx/Mark.svelte";
  // `play`: the sign-in pages (the D alone draws itself in the narrow rail; the wordmark is never given a second D beside it).
  let { light = false, mark = false, play = false } = $props();
</script>
<a href="/" class="lg inline-flex items-center no-underline" aria-label="Docustay home" data-light={light ? "" : undefined}>
  {#if mark}{#if play}<DrawnMark size={28} />{:else}<Mark size={28} class="lg-d" />{/if}
  {:else}
    <img class="lg-w lg-on-light" src="/brand/docustay-wordmark-violet.svg" alt="Docustay" width="129" height="26" />
    <img class="lg-w lg-on-dark" src="/brand/docustay-wordmark-white.svg" alt="" aria-hidden="true" width="129" height="26" />
  {/if}
</a>
<style>
  .lg { gap: .55rem; min-height: 24px; }   /* R10-58: a link target is at least 24 px tall at every width (WCAG 2.5.8) */
  .lg-w { height: 26px; width: auto; display: block; }
  .lg-on-dark { display: none; }
  :global(:root[data-theme="dark"]) .lg-on-light, :global(:root[data-surface="site"]) .lg-on-light, .lg[data-light] .lg-on-light { display: none; }
  :global(:root[data-theme="dark"]) .lg-on-dark, :global(:root[data-surface="site"]) .lg-on-dark, .lg[data-light] .lg-on-dark { display: block; }
  @media (max-width: 640px) { .lg-w { height: 22px; } }
</style>
