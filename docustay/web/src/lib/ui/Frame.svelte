<script>
  // A window with three dots, a title and a glass border: product pictures and the hero object.
  let { title = "", children, class: cls = "" } = $props();
</script>
<figure class="overflow-hidden rounded-2xl border border-line-strong bg-card shadow-[var(--shadow)] {cls}"><figcaption class="flex items-center gap-2 border-b border-line bg-tint px-3.5 py-2.5"><span class="flex gap-1.5" aria-hidden="true"><i class="h-2.5 w-2.5 rounded-full bg-line-strong"></i><i class="h-2.5 w-2.5 rounded-full bg-line-strong"></i><i class="h-2.5 w-2.5 rounded-full bg-line-strong"></i></span>{#if title}<span class="font-mono text-xs text-faint">{title}</span>{/if}</figcaption><div>{@render children?.()}</div></figure>
