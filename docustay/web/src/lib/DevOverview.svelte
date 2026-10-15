<script>
  // Developers → Overview: where to start. The base address, the first three steps and the sample code. Nothing here changes anything.
  import { t } from "$lib/i18n/index.svelte.js";
  import Icon from "$lib/ui/Icon.svelte";
  import CopyField from "$lib/ui/CopyField.svelte";
  let { go } = $props();
  const base = typeof location !== "undefined" ? location.origin : "https://app.docustay.app";
  const steps = $derived([["keys", "key-round", t("Make a key"), t("Start with a test key: it sends nothing real and bills nothing.")], ["webhooks", "webhook", t("Add a webhook"), t("Get a signed call when a document is sent, signed or declined.")], ["apilog", "terminal", t("Watch the calls"), t("Every call your key makes, with its answer, for 30 days.")]]);
</script>
<div class="max-w-4xl space-y-6" data-testid="dev-overview">
  <div><h2 class="text-lg font-semibold">{t("Build with Docustay")}</h2><p class="text-sm text-mute">{t("Send, track and download documents from your own software, or let an AI agent draft them for you to approve.")}</p></div>
  <div class="min-w-0"><p class="label">{t("API address")}</p><CopyField value={base} /></div>
  <ol class="grid gap-3 md:grid-cols-3">{#each steps as [k, ic, h, p], i}<li><button class="card flex h-full w-full flex-col gap-1 p-4 text-left hover:bg-tint" onclick={() => go(k)}><span class="text-mute"><Icon name={ic} size={18} /></span><b class="mt-1">{i + 1}. {h}</b><span class="text-sm text-mute">{p}</span></button></li>{/each}</ol>
  <div class="grid gap-3 md:grid-cols-3">
    <a class="card flex items-center gap-2 p-4 no-underline hover:bg-tint" href="/docs/quickstart" target="_blank" rel="noopener"><Icon name="book-open" size={18} />{t("Quick start")}</a>
    <a class="card flex items-center gap-2 p-4 no-underline hover:bg-tint" href="/api/v1/openapi.json" target="_blank" rel="noopener"><Icon name="file-text" size={18} />{t("OpenAPI file")}</a>
    <a class="card flex items-center gap-2 p-4 no-underline hover:bg-tint" href="/docs/mcp-and-skills" target="_blank" rel="noopener"><Icon name="sparkles" size={18} />{t("AI agents and MCP")}</a>
  </div>
</div>
