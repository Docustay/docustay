<script>
  // The announcement pill with the rotating rainbow border (30 s). `href` makes it a link.
  let { href = null, children, class: cls = "" } = $props();
</script>
{#if href}<a {href} class="rainbow-pill inline-flex items-center gap-2 bg-[var(--card)] px-3.5 py-1.5 text-sm no-underline {cls}">{@render children()}</a>{:else}<span class="rainbow-pill inline-flex items-center gap-2 bg-[var(--card)] px-3.5 py-1.5 text-sm {cls}">{@render children()}</span>{/if}
