<script>
  // PAY 2 · PAID: the receipt prints out of the page and is stamped; then the seal moment plays (the page shows SealFlip after it). Real text: what was paid, to whom, the amount and the
  // date. Plays once. Reduced motion or a slow device: the printed, stamped receipt still.
  let { title = "RECEIPT", lines = [], stamp = "PAID", testid = "fx-receipt" } = $props();
</script>
<div class="rp" data-testid={testid}>
  <div class="slip"><b>{title}</b>{#each lines as l}<span>{l}</span>{/each}</div>
  <span class="stamp">{stamp}</span>
</div>
<style>
  .rp { position: relative; width: 168px; min-height: 128px; }
  .slip { display: flex; flex-direction: column; gap: 6px; padding: 12px; border: 1px solid var(--line, #ececf2); border-radius: 4px; background: var(--paper, #fff); box-shadow: 0 10px 24px rgb(0 0 0 / .08); font: 500 11px/1.3 var(--font-mono, monospace); color: var(--mute, #5d5d6b); animation: rp-print 1.4s cubic-bezier(.2,.8,.2,1) both; }
  .slip b { color: var(--ink, #16161d); font-weight: 600; letter-spacing: .06em; }
  .stamp { position: absolute; right: -10px; bottom: 6px; padding: 4px 8px; border: 2px solid #5a3ac1; border-radius: 6px; color: #5a3ac1; background: rgb(255 255 255 / .85); font: 700 12px/1 var(--font-mono, monospace); letter-spacing: .08em; transform: rotate(-14deg); animation: rp-stamp 1.4s cubic-bezier(.2,.8,.2,1) both; }
  @keyframes rp-print { 0% { clip-path: inset(0 0 100% 0); transform: translateY(-8px); } 60%, 100% { clip-path: inset(0 0 0 0); transform: none; } }
  @keyframes rp-stamp { 0%, 62% { transform: scale(1.6) rotate(-14deg); opacity: 0; } 76%, 100% { transform: scale(1) rotate(-14deg); opacity: 1; } }
  @media (prefers-reduced-motion: reduce) { .slip, .stamp { animation: none; } }
  :global(html[data-lite]) .slip, :global(html[data-lite]) .stamp { animation: none; }
</style>
