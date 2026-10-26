<script>
  // One parameter in the API reference: name, type, required chip, description.
  let { name, type = "string", required = false, children } = $props();
</script>
<div class="grid gap-1 border-t border-line py-3 first:border-0"><div class="flex flex-wrap items-center gap-2"><code class="text-sm font-medium text-ink">{name}</code><span class="font-mono text-xs text-faint">{type}</span>{#if required}<span class="chip warn !py-0 !text-[.65rem]">required</span>{/if}</div><div class="text-sm text-mute">{@render children?.()}</div></div>
