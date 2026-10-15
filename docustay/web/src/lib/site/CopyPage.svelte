<script>
  // "Copy page" split button for the docs: copy the page as Markdown, or open it in an AI. `markdown` is the page's own .md text; `url` the page address.
  import { Menu } from "@ark-ui/svelte/menu";
  import { Portal } from "@ark-ui/svelte/portal";
  import Icon from "$lib/ui/Icon.svelte";
  import { t } from "$lib/i18n/index.svelte.js";
  let { markdown = "", url = "" } = $props();
  let done = $state(false);
  async function copy() { try { await navigator.clipboard.writeText(markdown); done = true; setTimeout(() => (done = false), 1600); } catch { /* clipboard blocked */ } }
  const ask = (base) => window.open(`${base}${encodeURIComponent(`Read ${url} and answer questions about it.`)}`, "_blank", "noopener");
</script>
<div class="inline-flex overflow-hidden rounded-lg border border-line-strong"><button type="button" class="btn quiet !min-h-0 !rounded-none !px-3 !py-1.5 text-sm" onclick={copy}><Icon name={done ? "check" : "copy"} size={15} />{done ? t("Copied") : t("Copy page")}</button>
<Menu.Root positioning={{ placement: "bottom-end" }}><Menu.Trigger class="btn quiet !min-h-0 !rounded-none !border-l !border-line-strong !px-2 !py-1.5" aria-label={t("More")}><Icon name="chevron-down" size={15} /></Menu.Trigger>
<Portal><Menu.Positioner><Menu.Content><Menu.Item value="md" onSelect={copy}>{t("Copy as Markdown")}</Menu.Item><Menu.Item value="claude" onSelect={() => ask("https://claude.ai/new?q=")}>{t("Open in Claude")}</Menu.Item><Menu.Item value="chatgpt" onSelect={() => ask("https://chatgpt.com/?q=")}>{t("Open in ChatGPT")}</Menu.Item></Menu.Content></Menu.Positioner></Portal></Menu.Root></div>
