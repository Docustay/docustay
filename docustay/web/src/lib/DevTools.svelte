<script>
  // Developers → SDKs and CLI: how to install what talks to the API. Commands are copyable; nothing runs here.
  import { t } from "$lib/i18n/index.svelte.js";
  import CopyButton from "$lib/ui/CopyButton.svelte";
  const rows = $derived([[t("JavaScript and TypeScript"), "npm install @docustay2026/sdk"], [t("Python"), "pip install docustay"], [t("Command line"), "npx docustay login"], [t("Forward webhooks to your laptop"), "npx docustay listen --forward-to http://localhost:3000/webhooks"], [t("Signing form in your page"), "npm install @docustay2026/embed"], [t("Claude Code plugin and skills"), "see /docs/mcp-and-skills"]]);
</script>
<div class=" space-y-4" data-testid="dev-tools">
  <div><h2 class="text-lg font-semibold">{t("SDKs and command line")}</h2><p class="text-sm text-mute">{t("Use a test key while you try these. Every package is MIT licensed.")}</p></div>
  <ul class="divide-y divide-line rounded-xl border border-line">{#each rows as [name, cmd]}<li class="flex flex-wrap items-center gap-3 px-4 py-3"><span class="w-56 text-sm text-mute">{name}</span><code class="min-w-0 flex-1 truncate font-mono text-sm">{cmd}</code>{#if !cmd.startsWith("see")}<CopyButton value={cmd} />{/if}</li>{/each}</ul>
</div>
