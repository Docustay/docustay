<script>
  // A read-only field with a copy button: DNS records, ids, endpoints.
  import CopyButton from "./CopyButton.svelte";
  // `unroll` (Run 8, motion board Done 4): the field unrolls from the left as it appears (clip-path, nothing moves), and the button says `copiedLabel` once pressed. Reduced motion: shown at once.
  let { value = "", label = "", mono = true, unroll = false, copiedLabel = "", testid = "" } = $props();
</script>
<div class="grid min-w-0 gap-1">{#if label}<span class="label !mb-0">{label}</span>{/if}<div class="flex min-w-0 items-center gap-1 rounded-lg border border-line-strong bg-card pl-3" class:unroll data-testid={testid || undefined}><code class="min-w-0 flex-1 truncate py-2 text-sm {mono ? '' : '!font-sans'}">{value}</code><CopyButton {value} {copiedLabel} /></div></div>
<style>
  .unroll { animation: unroll 620ms cubic-bezier(.2,.8,.2,1) both; }
  @keyframes unroll { from { clip-path: inset(0 100% 0 0 round 8px); } to { clip-path: inset(0 0 0 0 round 8px); } }
  @media (prefers-reduced-motion: reduce) { .unroll { animation: none; } }
</style>
