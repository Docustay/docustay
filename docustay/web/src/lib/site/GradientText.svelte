<script>
  // A heading in solid ink on the cream site (it used to fade); `accent` words italicise in the display serif.
  let { children, accent = "", class: cls = "" } = $props();
</script>
<span class="text-[var(--ink)] {cls}">{@render children?.()}{#if accent}{" "}<em class="font-serif italic" style="-webkit-text-fill-color: var(--brand)">{accent}</em>{/if}</span>
