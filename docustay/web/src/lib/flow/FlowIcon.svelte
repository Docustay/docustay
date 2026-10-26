<script>
  // One Lucide icon by the name the flow definition gives it. An unknown name draws nothing (never a broken square).
  import { ICONS } from "./icons.js";
  let { name, size = 16, class: cls = "" } = $props();
  const C = $derived(ICONS[name] ?? null);
</script>
{#if C}<C {size} class={cls} aria-hidden="true" />{/if}
