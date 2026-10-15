<script>
  // A heading that fades toward the muted colour; `accent` words italicise in the display serif.
  let { children, accent = "", class: cls = "" } = $props();
</script>
<span class="bg-gradient-to-b from-[var(--ink)] to-[var(--mute)] bg-clip-text text-transparent {cls}">{@render children?.()}{#if accent}{" "}<em class="font-serif italic" style="-webkit-text-fill-color: var(--brand)">{accent}</em>{/if}</span>
