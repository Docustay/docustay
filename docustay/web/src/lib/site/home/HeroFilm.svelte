<script>
  // The full-bleed film behind the home hero. The poster is the page's first paint (and its largest image); the video loads only when that costs nothing: not on a data-saver or slow connection, not for people who ask for less motion.
  // A Pause control is always visible while it plays (WCAG 2.2.2). WebM first, MP4 for everything that cannot play it; a smaller copy for phones.
  import { onMount } from "svelte"; import { whenIdle } from "$lib/fx/index.js"; import { page } from "$app/state"; import { uiFor } from "../l10n-ui.js";
  const u = $derived(uiFor(page.url.pathname));
  let { label = "Hands signing, sending and keeping documents" } = $props();
  let video = $state(null), play = $state(false), phone = $state(false), paused = $state(false);
  onMount(() => {
    const c = navigator.connection; const slow = c?.saveData || ["slow-2g", "2g", "3g"].includes(c?.effectiveType); const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    phone = matchMedia("(max-width: 900px)").matches; if (!slow && !still) whenIdle(() => (play = true));
  });
  $effect(() => { if (play && video) video.play().catch(() => {}); });
  const toggle = () => { if (!video) return; if (video.paused) { video.play(); paused = false; } else { video.pause(); paused = true; } };
  const stem = $derived(`/media/hero${phone ? "-m" : ""}`);
</script>
<img src="/media/hero.poster.jpg" alt={label} class="absolute inset-0 h-full w-full object-cover" width="1280" height="720" fetchpriority="high" decoding="async" />
{#if play}{#key stem}<video bind:this={video} class="absolute inset-0 h-full w-full object-cover" muted loop playsinline preload="none" poster="/media/hero.poster.jpg" aria-hidden="true" tabindex="-1"><source src="{stem}.webm" type="video/webm; codecs=vp9" /><source src="{stem}.mp4" type="video/mp4" /></video>{/key}
  <button class="btn ghost-film absolute bottom-4 left-4 z-10 !min-h-9 !px-3 !py-1 text-xs" onclick={toggle} aria-label={paused ? u.playLabel : u.pauseLabel}>{paused ? u.play : u.pause}</button>{/if}
