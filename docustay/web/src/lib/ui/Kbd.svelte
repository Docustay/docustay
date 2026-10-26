<script>
  // A keyboard hint chip: ⌘ K, Esc, ⌘↵. Shows ⌘ on a Mac and Ctrl elsewhere when `mod` is used.
  let { children, mod = false, class: cls = "" } = $props();
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform ?? "");
</script>
<kbd class="inline-flex min-w-[1.4rem] items-center justify-center rounded-md border border-line-strong bg-tint px-1.5 py-0.5 font-mono text-[.7rem] leading-none text-mute {cls}">{#if mod}{isMac ? "⌘" : "Ctrl"}{/if}{@render children?.()}</kbd>
