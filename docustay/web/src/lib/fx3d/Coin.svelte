<script>
  // PAY 2 / BILLING 2 · PROCESSING: a coin turns while the bank (or Stripe) confirms. Shown with the words that say what is happening (`label`, a live region). Reduced motion or a slow
  // device: the coin still.
  let { label = "", size = 48, testid = "fx-coin" } = $props();
</script>
<span class="cn" style="--s:{size}px" role="status" aria-live="polite" data-testid={testid}><span class="c" aria-hidden="true"></span>{#if label}<span class="lb">{label}</span>{/if}</span>
<style>
  .cn { display: inline-flex; align-items: center; gap: 14px; }
  .c { width: var(--s); height: var(--s); border-radius: 50%; background: radial-gradient(circle at 34% 30%, #b7b2f6, #7f7bf6 55%, #5a3ac1); box-shadow: 0 10px 24px rgb(90 58 193 / .3); animation: cn-spin 1.6s cubic-bezier(.45,0,.55,1) infinite; }
  .lb { font-size: var(--t-body, 15px); color: var(--ink); }
  @keyframes cn-spin { 0% { transform: rotateY(0); } 100% { transform: rotateY(360deg); } }
  @media (prefers-reduced-motion: reduce) { .c { animation: none; } }
  :global(html[data-lite]) .c { animation: none; }
</style>
