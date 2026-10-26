<script>
  // The "</>" icon button of the page header (frames: every portal screen): shows the API call that does what this screen shows, with a copy button. Ark Popover (MIT) around a CodeWindow.
  import { Popover } from "@ark-ui/svelte/popover";
  import { Portal } from "@ark-ui/svelte/portal";
  import Icon from "./Icon.svelte";
  import CodeWindow from "./CodeWindow.svelte";
  import { t } from "$lib/i18n/index.svelte.js";
  let { method = "GET", path, body = null } = $props();
  const code = $derived(`curl${method === "GET" ? "" : ` -X ${method}`} https://app.docustay.app${path} \\\n  -H "Authorization: Bearer $DOCUSTAY_API_KEY"${body ? ` \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify(body)}'` : ""}`);
</script>
<Popover.Root positioning={{ placement: "bottom-end", gutter: 8 }}>
  <Popover.Trigger class="btn !min-h-0 !h-9 !w-9 !p-0 !justify-center" aria-label={t("Show the API call")} data-testid="api-call"><Icon name="code" size={16} /></Popover.Trigger>
  <Portal><Popover.Positioner><Popover.Content class="api-call-pop"><p class="mb-2 text-[12.5px] text-mute">{t("The same thing from your code:")}</p><CodeWindow title="{method} {path}" tabs={[{ id: "curl", label: "curl", code }]} /></Popover.Content></Popover.Positioner></Portal>
</Popover.Root>
<style>
  :global(.api-call-pop) { width: min(32rem, 92vw); background: var(--card); border: 1px solid var(--line-strong); border-radius: 14px; padding: .9rem; box-shadow: var(--shadow); z-index: 60; }
</style>
