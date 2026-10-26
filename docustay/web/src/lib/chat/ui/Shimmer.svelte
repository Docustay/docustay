<script>
  // A "Thinking" label with a sheen that travels across it. Adapted from the Shimmer of Svelte AI Elements (MIT, Copyright (c) 2026 Sikandar Bhide); colours are Docustay's tokens, the motion is transform only,
  // and with reduced motion the sheen is not drawn at all (the text simply shows).
  let { text = "", class: cls = "" } = $props();
</script>
<span class="shimmer {cls}" role="status" aria-live="polite">{text}</span>
<style>
  .shimmer { position: relative; display: inline-block; overflow: hidden; color: var(--mute); }
  .shimmer::after { content: ""; position: absolute; inset: 0; transform: translateX(-100%); background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--card) 80%, transparent), transparent); animation: sheen var(--dur-hero, 900ms) var(--ease-inout, ease-in-out) infinite; animation-duration: 1500ms; }
  @keyframes sheen { to { transform: translateX(100%); } }
  @media (prefers-reduced-motion: reduce) { .shimmer::after { display: none; } }
</style>
