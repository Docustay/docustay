<script>
  // An integration or connection: icon, name, one line, a status chip and an action.
  import Icon from "./Icon.svelte";
  import StatusChip from "./StatusChip.svelte";
  import Brand from "./Brand.svelte";
  let { name, line = "", icon = "plug", brand = "", status = "", tone = "mute", action = null } = $props();
</script>
<div class="glow-hover flex min-w-0 items-center gap-3 rounded-xl border border-line bg-card p-4"><span class="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-line-strong bg-tint text-brand">{#if brand}<Brand name={brand} size={20} />{:else}<Icon name={icon} size={20} />{/if}</span><div class="min-w-0 flex-1"><div class="font-medium">{name}</div>{#if line}<div class="truncate text-sm text-mute">{line}</div>{/if}</div>{#if status}<StatusChip {tone}>{status}</StatusChip>{/if}{#if action}{@render action()}{/if}</div>
