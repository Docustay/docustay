<script>
  // A small collapsible (Ark UI, already installed; replaces the bits-ui Collapsible the Svelte AI Elements Reasoning and Tool parts use). The summary row is always shown; the detail opens on press.
  import { Collapsible } from "@ark-ui/svelte/collapsible";
  let { open = false, label = "", testid = "", summary, children, class: cls = "" } = $props();
  let isOpen = $state(false);
  $effect.pre(() => { isOpen = open; });
</script>
<Collapsible.Root bind:open={isOpen} class={cls}>
  <Collapsible.Trigger class="collapse-trigger" data-testid={testid} aria-label={label || undefined}>{@render summary?.(isOpen)}</Collapsible.Trigger>
  <Collapsible.Content class="collapse-content">{@render children?.()}</Collapsible.Content>
</Collapsible.Root>
<style>
  :global(.collapse-trigger) { display: flex; width: 100%; align-items: center; gap: .5rem; text-align: left; background: none; border: 0; padding: 0; color: inherit; font: inherit; cursor: pointer; min-height: 28px; }
  :global(.collapse-content[data-state="open"]) { animation: collapse-in var(--dur-fast, 160ms) var(--ease-out, ease-out); }
  :global(.collapse-content[data-state="closed"]) { display: none; }
  @keyframes collapse-in { from { opacity: 0; } to { opacity: 1; } }
  @media (prefers-reduced-motion: reduce) { :global(.collapse-content[data-state="open"]) { animation: none; } }
</style>
