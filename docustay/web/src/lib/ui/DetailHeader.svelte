<script>
  // The top of a detail page (frame: Document page): breadcrumb room above, a 52px icon tile (radius 14, accent), a small label, the title at 24px/500, chips, and the actions on the right.
  import Icon from "./Icon.svelte";
  let { title, label = "", subtitle = "", icon = "file-text", chips = null, actions = null } = $props();
</script>
<header class="mb-6 mt-3 flex flex-wrap items-center gap-4">
  <span class="grid h-[52px] w-[52px] place-items-center rounded-[14px] border border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent)]"><Icon name={icon} size={22} /></span>
  <div class="min-w-0 flex-1">{#if label}<p class="font-mono text-[11px] uppercase tracking-wider text-faint">{label}</p>{/if}<h1 class="truncate text-[length:var(--t-title)] font-medium leading-tight tracking-[-0.01em]">{title}</h1><div class="mt-1 flex flex-wrap items-center gap-2 text-sm text-mute">{#if subtitle}<span>{subtitle}</span>{/if}{#if chips}{@render chips()}{/if}</div></div>
  {#if actions}<div class="flex flex-wrap items-center gap-2">{@render actions()}</div>{/if}
</header>
