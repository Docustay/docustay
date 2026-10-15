<script>
  // A number with a label (dense labelled strip item, not a boxed tile). Counts up on first view; `delta` shows a small change line.
  import Counter from "$lib/fx/Counter.svelte";
  let { label, value, suffix = "", delta = "", tone = "" } = $props();
</script>
<div class="min-w-0"><div class="font-mono text-[.7rem] uppercase tracking-wider text-faint">{label}</div>
<div class="mt-1 text-3xl font-semibold tracking-tight tabular-nums {tone === 'bad' ? 'text-bad' : tone === 'ok' ? 'text-ok' : ''}">{#if typeof value === "number"}<Counter to={value} />{:else}{value}{/if}{suffix}</div>
{#if delta}<div class="mt-0.5 text-xs text-mute">{delta}</div>{/if}</div>
