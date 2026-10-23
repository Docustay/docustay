<script>
  // The seal pressing down: a big hand-drawn seal drops onto the page with a small bounce when it scrolls into view, then the words. CSS only (transform and opacity); with reduced motion it is just there.
  import Doodle from "$lib/doodle/Doodle.svelte";
  import Words from "$lib/fx/Words.svelte";
  import { shown } from "$lib/fx/index.js";
</script>
<div class="wrap seal">
  <div class="stampwrap" {@attach shown(0.5)}>
    <div class="ring"></div>
    <Doodle name="seal-d" size="min(22rem, 60vw)" class="press" />
  </div>
  <div class="words"><Words tag="h2" class="t-xl" text="Signed. Sealed. Done." /><p class="lede mt-4 mx-auto">Every signed file carries its own certificate and a digital seal, so anyone can check it a year later without asking us.</p><a class="btn mt-6" href="/verify">Check a signed PDF</a></div>
</div>
<style>
  .seal { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: clamp(1.5rem, 6vw, 5rem); align-items: center; }
  .stampwrap { position: relative; display: grid; place-items: center; padding: 1.5rem; }
  .ring { position: absolute; inset: 0; border-radius: 50%; border: 2px solid var(--periwinkle); opacity: 0; }
  .words { text-align: left; } .words :global(.lede) { margin-left: 0; }
  .stampwrap :global(.press) { transform-origin: 50% 60%; }
  :global(.js) .stampwrap:not([data-shown]) :global(.press) { opacity: 0; transform: scale(1.7) rotate(-10deg); }
  :global(.js) .stampwrap:global([data-shown]) :global(.press) { animation: press 700ms cubic-bezier(.3, 1.4, .5, 1) both 120ms; }
  :global(.js) .stampwrap:global([data-shown]) .ring { animation: ripple 900ms var(--ease-out) both 640ms; }
  @keyframes press { 0% { opacity: 0; transform: scale(1.7) rotate(-10deg); } 55% { opacity: 1; transform: scale(.94) rotate(2deg); } 100% { opacity: 1; transform: none; } }
  @keyframes ripple { 0% { opacity: .9; transform: scale(.7); } 100% { opacity: 0; transform: scale(1.25); } }
  @media (max-width: 760px) { .seal { grid-template-columns: minmax(0, 1fr); text-align: center; } .words { text-align: center; } .words :global(.lede) { margin-inline: auto; } }
  @media (prefers-reduced-motion: reduce) { :global(.js) .stampwrap :global(.press) { opacity: 1 !important; transform: none !important; animation: none !important; } .ring { display: none; } }
</style>
