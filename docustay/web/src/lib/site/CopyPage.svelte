<script>
  // "Copy page" split button for the docs: copy the page as Markdown, or open it in an AI. `markdown` is the page's own .md text; `url` the page address.
  import { Menu } from "@ark-ui/svelte/menu";
  import { Portal } from "@ark-ui/svelte/portal";
  import Icon from "$lib/ui/Icon.svelte";
  import { t } from "$lib/i18n/index.svelte.js";
  let { markdown = "", url = "" } = $props();
  let done = $state(false), blocked = $state(false);
  // R13-D248: when the browser blocks the clipboard the button used to do nothing visible; try the older copy path, then say it was blocked
  function legacyCopy(text) { const a = document.createElement("textarea"); a.value = text; a.setAttribute("readonly", ""); a.style.position = "fixed"; a.style.opacity = "0"; document.body.append(a); a.select(); let ok = false; try { ok = document.execCommand("copy"); } catch { ok = false; } a.remove(); return ok; }
  async function copy() {
    let ok = false; try { await navigator.clipboard.writeText(markdown); ok = true; } catch { ok = legacyCopy(markdown); }
    done = ok; blocked = !ok; setTimeout(() => { done = false; blocked = false; }, 2400);
  }
  const ask = (base) => window.open(`${base}${encodeURIComponent(`Read ${url} and answer questions about it.`)}`, "_blank", "noopener");
</script>
<div class="inline-flex overflow-hidden rounded-lg border border-line-strong"><button type="button" class="btn quiet !min-h-0 !rounded-none !px-3 !py-1.5 text-sm" onclick={copy}><Icon name={done ? "check" : "copy"} size={15} /><span class="sr-only" role="status">{done ? t("Copied") : blocked ? t("Copying is blocked") : ""}</span>{done ? t("Copied") : blocked ? t("Copying is blocked") : t("Copy page")}</button>
<Menu.Root positioning={{ placement: "bottom-end" }}><Menu.Trigger class="btn quiet !min-h-0 !rounded-none !border-l !border-line-strong !px-2 !py-1.5" aria-label={t("More")}><Icon name="chevron-down" size={15} /></Menu.Trigger>
<Portal><Menu.Positioner><Menu.Content><Menu.Item value="md" onSelect={copy}>{t("Copy as Markdown")}</Menu.Item><Menu.Item value="claude" onSelect={() => ask("https://claude.ai/new?q=")}>{t("Open in Claude")}</Menu.Item><Menu.Item value="chatgpt" onSelect={() => ask("https://chatgpt.com/?q=")}>{t("Open in ChatGPT")}</Menu.Item></Menu.Content></Menu.Positioner></Portal></Menu.Root></div>
