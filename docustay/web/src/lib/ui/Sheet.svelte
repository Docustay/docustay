<script>
  // A right-hand sheet (a drawer on a phone, a panel on a desktop): sticky header, scrolling body, sticky footer.
  // Opens with focus inside it, keeps Tab inside it, locks the page behind it from scrolling, closes on Escape or the backdrop, and hands focus back to whatever opened it (Part 31 item 8, proved in a browser).
  import Icon from "./Icon.svelte";
  import { t } from "$lib/i18n/index.svelte.js";
  let { open = false, title = "", onclose = () => {}, children, footer = null } = $props();
  let panel = $state(null);
  const FOCUSABLE = 'a[href], button:not([disabled]):not([tabindex="-1"]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  $effect(() => {
    if (!open || !panel) return;
    const opener = document.activeElement;
    const was = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    (panel.querySelector("[data-autofocus]") ?? panel).focus();
    return () => { document.body.style.overflow = was; if (opener instanceof HTMLElement && document.contains(opener)) opener.focus(); };
  });
  function keydown(e) {
    if (e.key === "Escape") { e.stopPropagation(); onclose(); return; }
    if (e.key !== "Tab" || !panel) return;
    const items = [...panel.querySelectorAll(FOCUSABLE)].filter((x) => x.offsetParent !== null);
    if (items.length === 0) { e.preventDefault(); panel.focus(); return; }
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
</script>
{#if open}
  <div class="fixed inset-0 z-40" role="presentation">
    <button class="sheet-backdrop absolute inset-0 bg-black/40" aria-label={t("Close")} tabindex="-1" onclick={onclose}></button>
    <div bind:this={panel} tabindex="-1" role="dialog" aria-modal="true" aria-label={title} onkeydown={keydown}
      class="sheet-panel absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-card shadow-2xl outline-none">
      <header class="flex items-center gap-2 border-b border-line px-4 py-3"><h2 class="text-lg font-semibold">{title}</h2><button class="btn quiet ml-auto !min-h-0 !p-2" onclick={onclose} aria-label={t("Close")}><Icon name="close" /></button></header>
      <div class="min-h-0 flex-1 overflow-y-auto p-4">{@render children?.()}</div>
      {#if footer}<footer class="flex items-center justify-end gap-2 border-t border-line px-4 py-3">{@render footer()}</footer>{/if}
    </div>
  </div>
{/if}
<style>
  .sheet-panel { animation: sheet-in .18s ease-out; }
  .sheet-backdrop { animation: sheet-fade .18s ease-out; }
  @keyframes sheet-in { from { transform: translateX(2rem); opacity: 0; } to { transform: none; opacity: 1; } }
  @keyframes sheet-fade { from { opacity: 0; } to { opacity: 1; } }
  @media (prefers-reduced-motion: reduce) { .sheet-panel, .sheet-backdrop { animation: none; } }
</style>
