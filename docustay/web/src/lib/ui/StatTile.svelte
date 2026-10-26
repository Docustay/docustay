<script>
  // A number with a label (dense labelled strip item, not a boxed tile). Counts up on first view; `delta` shows a small change line.
  import Counter from "$lib/fx/Counter.svelte";
  let { label, value, suffix = "", delta = "", tone = "" } = $props();
</script>
<div class="min-w-0"><div class="text-[12px] text-mute">{label}</div>
<div class="mt-0.5 text-[22px] font-semibold leading-tight tracking-tight tabular-nums {tone === 'bad' ? 'text-bad' : tone === 'ok' ? 'text-ok' : ''}">{#if typeof value === "number"}<Counter to={value} />{:else}{value}{/if}{suffix}</div>
{#if delta}<div class="mt-0.5 text-xs text-mute">{delta}</div>{/if}</div>
