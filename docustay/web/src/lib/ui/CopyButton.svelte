<script>
  // Copy to the clipboard (Ark Clipboard, MIT) with a check that draws on success. `value` is what is copied; `label` is the visible text (empty = icon only).
  import { Clipboard } from "@ark-ui/svelte/clipboard";
  import Icon from "./Icon.svelte";
  import { t } from "$lib/i18n/index.svelte.js";
  // `copiedLabel` (Run 8, motion board Done 4): the words that replace the label for a moment after copying, such as "Link copied".
  let { value = "", label = "", copiedLabel = "", class: cls = "", testid = "" } = $props();
</script>
<Clipboard.Root {value} timeout={1600}>
  <Clipboard.Trigger class="btn quiet !min-h-0 !px-2 !py-1.5 text-sm {cls}" aria-label={label || t("Copy")} data-testid={testid || undefined}>
    <Clipboard.Indicator>{#snippet copied()}<Icon name="check" size={16} draw />{/snippet}<Icon name="copy" size={16} /></Clipboard.Indicator>
    {#if copiedLabel}<Clipboard.Context>{#snippet render(c)}<span class="text-sm" aria-live="polite">{c().copied ? copiedLabel : label || t("Copy")}</span>{/snippet}</Clipboard.Context>{:else if label}<span>{label}</span>{/if}
  </Clipboard.Trigger>
</Clipboard.Root>
