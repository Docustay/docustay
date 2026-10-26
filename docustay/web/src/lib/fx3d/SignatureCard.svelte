<script>
  // MOTION 6 · A SIGNATURE WITH DEPTH (Run 9 board): the saved signature turns gently in 3D with a light sheen, in Settings and when it is adopted. The signature itself is real text
  // (or the saved picture) so it is read as written. Reduced motion or a slow device: flat, no sheen.
  let { text = "", image = null, id = "", testid = "fx-signature-card" } = $props();
</script>
<figure class="sc" data-testid={testid}>
  <div class="card">{#if image}<img src={image} alt={text} />{:else}<span class="sig">{text}</span>{/if}{#if id}<figcaption>Signature ID {id}</figcaption>{/if}</div>
</figure>
<style>
  .sc { margin: 0; perspective: 1000px; display: inline-block; }
  .card { position: relative; overflow: hidden; padding: 22px 28px 16px; border-radius: var(--rad-m, 14px); background: linear-gradient(160deg, #ffffff, #f3f1ff); box-shadow: var(--surface-shadow); display: grid; gap: 10px; animation: sc-sway 7s ease-in-out infinite; transform-style: preserve-3d; }
  .card::after { content: ""; position: absolute; inset: -40%; background: linear-gradient(105deg, transparent 40%, rgb(255 255 255 / .7) 50%, transparent 60%); transform: translateX(-60%); animation: sc-sheen 7s ease-in-out infinite; pointer-events: none; }
  .sig { font: italic 600 32px/1.1 var(--font-serif, Georgia, serif); background: linear-gradient(90deg, #5a3ac1, #8f8af8); -webkit-background-clip: text; background-clip: text; color: transparent; }
  img { max-height: 56px; max-width: 260px; }
  figcaption { font: 500 11px/1 var(--font-mono, monospace); color: var(--mute); letter-spacing: .06em; }
  @keyframes sc-sway { 0%, 100% { transform: rotateY(-9deg) rotateX(3deg); } 50% { transform: rotateY(9deg) rotateX(-2deg); } }
  @keyframes sc-sheen { 0%, 30% { transform: translateX(-60%); } 60%, 100% { transform: translateX(60%); } }
  @media (prefers-reduced-motion: reduce) { .card, .card::after { animation: none; } .card::after { display: none; } }
  :global(html[data-lite]) .card, :global(html[data-lite]) .card::after { animation: none; } :global(html[data-lite]) .card::after { display: none; }
</style>
