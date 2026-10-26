<script>
  // A dialog (Ark Dialog, MIT): focus trap, Escape, scroll lock, restored focus. `open` is bindable. Body goes in children; buttons in the `footer` snippet.
  import { Dialog } from "@ark-ui/svelte/dialog";
  import { Portal } from "@ark-ui/svelte/portal";
  import Icon from "./Icon.svelte";
  import { t } from "$lib/i18n/index.svelte.js";
  let { open = $bindable(false), title = "", description = "", children, footer = null, onclose = () => {}, testid = "" } = $props();
</script>
<Dialog.Root {open} onOpenChange={(d) => { open = d.open; if (!d.open) onclose(); }} lazyMount unmountOnExit>
  <Portal>
    <Dialog.Backdrop />
    <Dialog.Positioner>
      <Dialog.Content data-testid={testid || undefined}>
        <div class="flex items-start justify-between gap-3">
          <div>{#if title}<Dialog.Title>{title}</Dialog.Title>{/if}{#if description}<Dialog.Description>{description}</Dialog.Description>{/if}</div>
          <Dialog.CloseTrigger class="btn quiet !min-h-0 !p-1.5" aria-label={t("Close")}><Icon name="x" size={18} /></Dialog.CloseTrigger>
        </div>
        <div class="mt-4">{@render children?.()}</div>
        {#if footer}<div class="mt-5 flex flex-wrap items-center justify-end gap-2">{@render footer()}</div>{/if}
      </Dialog.Content>
    </Dialog.Positioner>
  </Portal>
</Dialog.Root>
