<script>
  // A masked secret with an eye to show it and a copy button. Shows the value only when `revealed`.
  import CopyButton from "./CopyButton.svelte";
  import Icon from "./Icon.svelte";
  import { t } from "$lib/i18n/index.svelte.js";
  let { value = "", label = "" } = $props();
  let shown = $state(false);
</script>
<div class="grid gap-1">{#if label}<span class="label !mb-0">{label}</span>{/if}<div class="flex items-center gap-1 rounded-lg border border-line-strong bg-card pl-3"><code class="min-w-0 flex-1 truncate py-2 text-sm" data-testid="secret-value">{shown ? value : "•".repeat(Math.min(28, Math.max(12, value.length)))}</code><button type="button" class="btn quiet !min-h-0 !p-2" onclick={() => (shown = !shown)} aria-pressed={shown} aria-label={shown ? t("Hide") : t("Show")}><Icon name={shown ? "eye-off" : "eye"} size={16} /></button><CopyButton {value} /></div></div>
