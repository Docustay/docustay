<script>
  // The announcement pill: a violet-tint pill on the cream site (the rainbow border is gone). `href` makes it a link.
  let { href = null, children, class: cls = "" } = $props();
</script>
{#if href}<a {href} class="inline-flex items-center gap-2 rounded-full border border-[rgb(90_58_193/.25)] bg-[#f3f0fe] px-3.5 py-1.5 text-sm text-[#4a2fa3] no-underline {cls}">{@render children()}</a>{:else}<span class="inline-flex items-center gap-2 rounded-full border border-[rgb(90_58_193/.25)] bg-[#f3f0fe] px-3.5 py-1.5 text-sm text-[#4a2fa3] {cls}">{@render children()}</span>{/if}
